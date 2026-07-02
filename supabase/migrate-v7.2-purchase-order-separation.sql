-- Migration v7.2: Purchase Order Separation — Tables + RPCs
-- Execute in Supabase SQL Editor
-- Purpose:
-- 1) Create purchase_orders and purchase_order_items as the V2 purchase workflow tables
-- 2) Add financial_transactions.source_purchase_order_id without changing source_order_id
-- 3) Add RLS: admin/super_admin CRUD, finance read-only
-- 4) Add V2 RPCs for create, per-item delivery confirmation, and delete/rollback
-- 5) Migrate historical orders.order_kind='purchase' rows while preserving legacy tables/RPCs
-- 6) Bump schema_version to 7.2.0
--
-- Scope: additive only. Legacy orders/order_items purchase rows, order_kind='purchase',
-- and confirm_purchase_delivery_atomic remain intact for backward compatibility.

-- ============================================================
-- 0. Pre-check
-- ============================================================
DO $$
BEGIN
  IF public.get_app_schema_version() < '6.8.0' THEN
    RAISE EXCEPTION 'Migration v6.8.0 must be applied before v7.2.0';
  END IF;
END $$;

-- ============================================================
-- 1. purchase_orders table
-- ============================================================
CREATE TABLE IF NOT EXISTS public.purchase_orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id UUID NOT NULL REFERENCES public.stores(id) ON DELETE RESTRICT,
  city_id UUID NOT NULL REFERENCES public.cities(id) ON DELETE RESTRICT,
  supplier_id UUID REFERENCES public.suppliers(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'partially_delivered', 'delivered')),
  created_by UUID NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  notes TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

COMMENT ON TABLE public.purchase_orders IS 'V2 purchase order headers separated from legacy orders/order_items';
COMMENT ON COLUMN public.purchase_orders.status IS 'Purchase delivery status: pending, partially_delivered, delivered';

-- ============================================================
-- 2. purchase_order_items table
--    unit_cost is a cost snapshot for downstream types and finance posting.
-- ============================================================
CREATE TABLE IF NOT EXISTS public.purchase_order_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  purchase_order_id UUID NOT NULL REFERENCES public.purchase_orders(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES public.products(id) ON DELETE RESTRICT,
  ordered_quantity INTEGER NOT NULL CHECK (ordered_quantity > 0),
  delivered_quantity INTEGER NOT NULL DEFAULT 0 CHECK (delivered_quantity >= 0),
  delivery_status TEXT NOT NULL DEFAULT 'pending' CHECK (delivery_status IN ('pending', 'delivered')),
  delivered_at TIMESTAMP WITH TIME ZONE,
  confirmed_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  unit_cost DECIMAL(10, 2) NOT NULL DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

COMMENT ON TABLE public.purchase_order_items IS 'V2 purchase order item lines with per-item delivery state';
COMMENT ON COLUMN public.purchase_order_items.unit_cost IS 'Product cost snapshot at purchase order creation time';

-- ============================================================
-- 3. financial_transactions linkage for V2 purchase orders
-- ============================================================
ALTER TABLE public.financial_transactions
  ADD COLUMN IF NOT EXISTS source_purchase_order_id UUID;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'financial_transactions_source_purchase_order_id_fkey'
      AND conrelid = 'public.financial_transactions'::regclass
  ) THEN
    ALTER TABLE public.financial_transactions
      ADD CONSTRAINT financial_transactions_source_purchase_order_id_fkey
      FOREIGN KEY (source_purchase_order_id) REFERENCES public.purchase_orders(id) ON DELETE SET NULL;
  END IF;
END $$;

COMMENT ON COLUMN public.financial_transactions.source_purchase_order_id IS 'Linked V2 purchase order that originated this transaction (nullable); additive to source_order_id';

-- ============================================================
-- 4. Indexes
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_purchase_orders_status_created_at
  ON public.purchase_orders(status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_purchase_orders_store_id
  ON public.purchase_orders(store_id);

CREATE INDEX IF NOT EXISTS idx_purchase_orders_city_id
  ON public.purchase_orders(city_id);

CREATE INDEX IF NOT EXISTS idx_purchase_orders_supplier_id
  ON public.purchase_orders(supplier_id);

CREATE INDEX IF NOT EXISTS idx_purchase_orders_created_by
  ON public.purchase_orders(created_by);

CREATE INDEX IF NOT EXISTS idx_purchase_order_items_purchase_order_id
  ON public.purchase_order_items(purchase_order_id);

CREATE INDEX IF NOT EXISTS idx_purchase_order_items_product_id
  ON public.purchase_order_items(product_id);

CREATE INDEX IF NOT EXISTS idx_purchase_order_items_delivery_status
  ON public.purchase_order_items(delivery_status);

CREATE INDEX IF NOT EXISTS idx_financial_transactions_source_purchase_order_id
  ON public.financial_transactions(source_purchase_order_id);

-- ============================================================
-- 5. RLS policies
-- ============================================================
ALTER TABLE public.purchase_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.purchase_order_items ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'purchase_orders'
      AND policyname = 'Admins can manage purchase orders'
  ) THEN
    CREATE POLICY "Admins can manage purchase orders" ON public.purchase_orders
      FOR ALL TO authenticated
      USING (public.is_admin())
      WITH CHECK (public.is_admin());
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'purchase_orders'
      AND policyname = 'Finance can view purchase orders'
  ) THEN
    CREATE POLICY "Finance can view purchase orders" ON public.purchase_orders
      FOR SELECT TO authenticated
      USING (public.is_finance());
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'purchase_order_items'
      AND policyname = 'Admins can manage purchase order items'
  ) THEN
    CREATE POLICY "Admins can manage purchase order items" ON public.purchase_order_items
      FOR ALL TO authenticated
      USING (public.is_admin())
      WITH CHECK (public.is_admin());
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'purchase_order_items'
      AND policyname = 'Finance can view purchase order items'
  ) THEN
    CREATE POLICY "Finance can view purchase order items" ON public.purchase_order_items
      FOR SELECT TO authenticated
      USING (public.is_finance());
  END IF;
END $$;

-- ============================================================
-- 6. create_purchase_order_v2
--    Creates V2 purchase order rows only; no inventory mutation.
-- ============================================================
CREATE OR REPLACE FUNCTION public.create_purchase_order_v2(
  p_user_id UUID,
  p_store_id UUID,
  p_city_id UUID,
  p_items JSONB,
  p_supplier_id UUID DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor_id UUID := auth.uid();
  v_actor_role TEXT;
  v_created_by_role TEXT;
  v_store_city UUID;
  v_store_status TEXT;
  v_purchase_order_id UUID;
BEGIN
  IF v_actor_id IS NULL THEN
    RAISE EXCEPTION '未登录';
  END IF;

  SELECT role INTO v_actor_role
  FROM public.profiles
  WHERE id = v_actor_id;

  IF v_actor_role IS NULL THEN
    RAISE EXCEPTION '用户资料不存在';
  END IF;

  IF v_actor_role NOT IN ('admin', 'super_admin') THEN
    RAISE EXCEPTION '当前角色无进货建单权限';
  END IF;

  IF p_user_id IS NULL THEN
    RAISE EXCEPTION '建单用户不能为空';
  END IF;

  SELECT role INTO v_created_by_role
  FROM public.profiles
  WHERE id = p_user_id;

  IF v_created_by_role IS NULL THEN
    RAISE EXCEPTION '建单用户不存在';
  END IF;

  IF p_store_id IS NULL THEN
    RAISE EXCEPTION '店铺ID不能为空';
  END IF;

  IF p_city_id IS NULL THEN
    RAISE EXCEPTION '城市ID不能为空';
  END IF;

  SELECT s.city_id, s.status
  INTO v_store_city, v_store_status
  FROM public.stores s
  WHERE s.id = p_store_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION '店铺不存在';
  END IF;

  IF v_store_status <> 'active' THEN
    RAISE EXCEPTION '店铺已停用';
  END IF;

  IF v_store_city IS DISTINCT FROM p_city_id THEN
    RAISE EXCEPTION '店铺不属于所选城市';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.cities c WHERE c.id = p_city_id) THEN
    RAISE EXCEPTION '城市不存在';
  END IF;

  IF p_supplier_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM public.suppliers s WHERE s.id = p_supplier_id) THEN
    RAISE EXCEPTION '供应商不存在';
  END IF;

  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION '进货项不能为空';
  END IF;

  CREATE TEMP TABLE IF NOT EXISTS _purchase_order_v2_items_tmp (
    product_id UUID NOT NULL,
    quantity INTEGER NOT NULL
  ) ON COMMIT DROP;

  TRUNCATE TABLE _purchase_order_v2_items_tmp;

  INSERT INTO _purchase_order_v2_items_tmp (product_id, quantity)
  SELECT x.product_id, x.quantity
  FROM jsonb_to_recordset(p_items) AS x(
    product_id UUID,
    quantity INTEGER
  );

  IF NOT EXISTS (SELECT 1 FROM _purchase_order_v2_items_tmp) THEN
    RAISE EXCEPTION '进货项不能为空';
  END IF;

  IF EXISTS (SELECT 1 FROM _purchase_order_v2_items_tmp WHERE quantity <= 0) THEN
    RAISE EXCEPTION '进货数量必须大于0';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM _purchase_order_v2_items_tmp pi
    LEFT JOIN public.products p ON p.id = pi.product_id
    WHERE p.id IS NULL
  ) THEN
    RAISE EXCEPTION '商品不存在';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM _purchase_order_v2_items_tmp pi
    JOIN public.products p ON p.id = pi.product_id
    WHERE p.city_id IS DISTINCT FROM p_city_id
  ) THEN
    RAISE EXCEPTION '只能进货所选城市商品';
  END IF;

  INSERT INTO public.purchase_orders (
    store_id,
    city_id,
    supplier_id,
    status,
    created_by
  ) VALUES (
    p_store_id,
    p_city_id,
    p_supplier_id,
    'pending',
    p_user_id
  )
  RETURNING id INTO v_purchase_order_id;

  INSERT INTO public.purchase_order_items (
    purchase_order_id,
    product_id,
    ordered_quantity,
    delivered_quantity,
    delivery_status,
    unit_cost
  )
  SELECT
    v_purchase_order_id,
    pi.product_id,
    pi.quantity,
    0,
    'pending',
    COALESCE(p.cost, 0)
  FROM _purchase_order_v2_items_tmp pi
  JOIN public.products p ON p.id = pi.product_id;

  RETURN v_purchase_order_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_purchase_order_v2(UUID, UUID, UUID, JSONB, UUID) TO authenticated;

-- ============================================================
-- 7. confirm_purchase_item_delivery
--    Per-item delivery confirmation. 云窗 receives into public.inventory;
--    other stores receive into public.store_inventory.
-- ============================================================
CREATE OR REPLACE FUNCTION public.confirm_purchase_item_delivery(
  p_purchase_order_id UUID,
  p_item_id UUID,
  p_delivered_quantity INTEGER,
  p_confirmed_by UUID
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor_id UUID := auth.uid();
  v_actor_role TEXT;
  v_confirmed_role TEXT;
  v_order public.purchase_orders%ROWTYPE;
  v_item public.purchase_order_items%ROWTYPE;
  v_store_name TEXT;
  v_store_status TEXT;
  v_inventory_pool TEXT;
  v_before_quantity INTEGER := 0;
  v_after_quantity INTEGER := 0;
  v_billable_quantity INTEGER := 0;
  v_category_id UUID;
  v_purchase_amount DECIMAL(12, 2) := 0;
  v_transaction_id UUID;
BEGIN
  IF v_actor_id IS NULL THEN
    RAISE EXCEPTION '未登录';
  END IF;

  SELECT role INTO v_actor_role
  FROM public.profiles
  WHERE id = v_actor_id;

  IF v_actor_role IS NULL THEN
    RAISE EXCEPTION '用户资料不存在';
  END IF;

  IF v_actor_role NOT IN ('admin', 'super_admin') THEN
    RAISE EXCEPTION '当前角色无确认进货权限';
  END IF;

  IF p_purchase_order_id IS NULL THEN
    RAISE EXCEPTION '进货单ID不能为空';
  END IF;

  IF p_item_id IS NULL THEN
    RAISE EXCEPTION '进货商品行不能为空';
  END IF;

  IF p_confirmed_by IS NULL THEN
    RAISE EXCEPTION '确认人不能为空';
  END IF;

  SELECT role INTO v_confirmed_role
  FROM public.profiles
  WHERE id = p_confirmed_by;

  IF v_confirmed_role IS NULL THEN
    RAISE EXCEPTION '确认人不存在';
  END IF;

  IF p_delivered_quantity IS NULL OR p_delivered_quantity <= 0 THEN
    RAISE EXCEPTION '到货数量必须大于0';
  END IF;

  SELECT * INTO v_order
  FROM public.purchase_orders
  WHERE id = p_purchase_order_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION '进货单不存在';
  END IF;

  SELECT * INTO v_item
  FROM public.purchase_order_items
  WHERE id = p_item_id
    AND purchase_order_id = p_purchase_order_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION '进货商品行不存在';
  END IF;

  -- Idempotency guard: a delivered item has already mutated inventory/finance/logs.
  IF v_item.delivery_status = 'delivered' THEN
    RETURN;
  END IF;

  IF v_order.status = 'delivered' THEN
    RAISE EXCEPTION '进货单已全部到货';
  END IF;

  SELECT s.name, s.status
  INTO v_store_name, v_store_status
  FROM public.stores s
  WHERE s.id = v_order.store_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION '店铺不存在';
  END IF;

  IF v_store_status <> 'active' THEN
    RAISE EXCEPTION '店铺已停用';
  END IF;

  SELECT id INTO v_category_id
  FROM public.finance_categories
  WHERE name = '采购成本'
    AND type = 'expense';

  IF v_category_id IS NULL THEN
    RAISE EXCEPTION '采购成本分类不存在';
  END IF;

  IF v_store_name = '云窗' THEN
    v_inventory_pool := 'inventory';

    INSERT INTO public.inventory (product_id, quantity, updated_at)
    VALUES (v_item.product_id, p_delivered_quantity, NOW())
    ON CONFLICT (product_id)
    DO UPDATE SET
      quantity = public.inventory.quantity + EXCLUDED.quantity,
      updated_at = NOW()
    RETURNING quantity INTO v_after_quantity;
  ELSE
    v_inventory_pool := 'store_inventory';

    INSERT INTO public.store_inventory (store_id, product_id, quantity, updated_at)
    VALUES (v_order.store_id, v_item.product_id, p_delivered_quantity, NOW())
    ON CONFLICT (store_id, product_id)
    DO UPDATE SET
      quantity = public.store_inventory.quantity + EXCLUDED.quantity,
      updated_at = NOW()
    RETURNING quantity INTO v_after_quantity;
  END IF;

  v_before_quantity := v_after_quantity - p_delivered_quantity;
  v_billable_quantity := LEAST(p_delivered_quantity, v_item.ordered_quantity);
  v_purchase_amount := (v_billable_quantity::NUMERIC * COALESCE(v_item.unit_cost, 0))::DECIMAL(12, 2);

  UPDATE public.purchase_order_items
  SET delivered_quantity = p_delivered_quantity,
      delivery_status = 'delivered',
      delivered_at = NOW(),
      confirmed_by = p_confirmed_by
  WHERE id = p_item_id;

  INSERT INTO public.financial_transactions (
    transaction_type,
    category_id,
    amount,
    transaction_date,
    store_id,
    supplier_id,
    product_id,
    description,
    created_by,
    source_purchase_order_id
  ) VALUES (
    'expense',
    v_category_id,
    v_purchase_amount,
    CURRENT_DATE,
    v_order.store_id,
    v_order.supplier_id,
    v_item.product_id,
    FORMAT(
      '进货单V2单品确认到货；purchase_order_id=%s；purchase_order_item_id=%s；store_name=%s；delivered_quantity=%s；billable_quantity=%s',
      p_purchase_order_id,
      p_item_id,
      v_store_name,
      p_delivered_quantity,
      v_billable_quantity
    ),
    p_confirmed_by,
    p_purchase_order_id
  )
  RETURNING id INTO v_transaction_id;

  INSERT INTO public.inventory_logs (
    product_id,
    operator_id,
    action,
    delta_quantity,
    before_quantity,
    after_quantity,
    note
  ) VALUES (
    v_item.product_id,
    p_confirmed_by,
    'purchase_receive',
    p_delivered_quantity,
    v_before_quantity,
    v_after_quantity,
    FORMAT(
      '进货单V2到货入库；purchase_order_id=%s；purchase_order_item_id=%s；store_id=%s；store_name=%s；inventory_pool=%s；financial_transaction_id=%s',
      p_purchase_order_id,
      p_item_id,
      v_order.store_id,
      v_store_name,
      v_inventory_pool,
      v_transaction_id
    )
  );

  UPDATE public.purchase_orders po
  SET status = CASE
        WHEN NOT EXISTS (
          SELECT 1
          FROM public.purchase_order_items poi
          WHERE poi.purchase_order_id = p_purchase_order_id
            AND poi.delivery_status <> 'delivered'
        ) THEN 'delivered'
        WHEN EXISTS (
          SELECT 1
          FROM public.purchase_order_items poi
          WHERE poi.purchase_order_id = p_purchase_order_id
            AND poi.delivered_quantity > 0
        ) THEN 'partially_delivered'
        ELSE 'pending'
      END,
      updated_at = NOW()
  WHERE po.id = p_purchase_order_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.confirm_purchase_item_delivery(UUID, UUID, INTEGER, UUID) TO authenticated;

-- ============================================================
-- 8. delete_purchase_order_v2
--    Reverses only delivered quantities, deletes linked V2 finance records,
--    removes V2 purchase_receive logs, then deletes the purchase order.
-- ============================================================
CREATE OR REPLACE FUNCTION public.delete_purchase_order_v2(
  p_purchase_order_id UUID
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor_id UUID := auth.uid();
  v_actor_role TEXT;
  v_order public.purchase_orders%ROWTYPE;
  v_store_name TEXT;
  v_purchase_tx_ids UUID[] := ARRAY[]::UUID[];
BEGIN
  IF v_actor_id IS NULL THEN
    RAISE EXCEPTION '未登录';
  END IF;

  SELECT role INTO v_actor_role
  FROM public.profiles
  WHERE id = v_actor_id;

  IF v_actor_role IS NULL THEN
    RAISE EXCEPTION '用户资料不存在';
  END IF;

  IF v_actor_role NOT IN ('admin', 'super_admin') THEN
    RAISE EXCEPTION '当前账号无删除进货单权限';
  END IF;

  IF p_purchase_order_id IS NULL THEN
    RAISE EXCEPTION '进货单ID不能为空';
  END IF;

  SELECT * INTO v_order
  FROM public.purchase_orders
  WHERE id = p_purchase_order_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION '进货单不存在';
  END IF;

  SELECT s.name INTO v_store_name
  FROM public.stores s
  WHERE s.id = v_order.store_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION '店铺不存在';
  END IF;

  IF v_store_name = '云窗' THEN
    UPDATE public.inventory i
    SET quantity = i.quantity - agg.delivered_qty,
        updated_at = NOW()
    FROM (
      SELECT poi.product_id, COALESCE(SUM(poi.delivered_quantity), 0)::INTEGER AS delivered_qty
      FROM public.purchase_order_items poi
      WHERE poi.purchase_order_id = p_purchase_order_id
        AND poi.delivered_quantity > 0
      GROUP BY poi.product_id
    ) agg
    WHERE i.product_id = agg.product_id;
  ELSE
    UPDATE public.store_inventory si
    SET quantity = si.quantity - agg.delivered_qty,
        updated_at = NOW()
    FROM (
      SELECT poi.product_id, COALESCE(SUM(poi.delivered_quantity), 0)::INTEGER AS delivered_qty
      FROM public.purchase_order_items poi
      WHERE poi.purchase_order_id = p_purchase_order_id
        AND poi.delivered_quantity > 0
      GROUP BY poi.product_id
    ) agg
    WHERE si.store_id = v_order.store_id
      AND si.product_id = agg.product_id;
  END IF;

  WITH deleted_tx AS (
    DELETE FROM public.financial_transactions ft
    WHERE ft.source_purchase_order_id = p_purchase_order_id
    RETURNING ft.id
  )
  SELECT COALESCE(ARRAY_AGG(id), ARRAY[]::UUID[])
  INTO v_purchase_tx_ids
  FROM deleted_tx;

  DELETE FROM public.inventory_logs il
  WHERE il.action = 'purchase_receive'
    AND (
      il.note LIKE FORMAT('%%purchase_order_id=%s%%', p_purchase_order_id)
      OR EXISTS (
        SELECT 1
        FROM UNNEST(v_purchase_tx_ids) AS tx(id)
        WHERE il.note LIKE FORMAT('%%financial_transaction_id=%s%%', tx.id::TEXT)
      )
    );

  DELETE FROM public.purchase_orders
  WHERE id = p_purchase_order_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.delete_purchase_order_v2(UUID) TO authenticated;

-- ============================================================
-- 9. Historical migration from legacy purchase orders
--    Legacy rows are preserved in orders/order_items for compatibility.
--    Historical purchase_orders.id intentionally equals orders.id so
--    financial_transactions.source_order_id can be mapped safely to
--    source_purchase_order_id without uuid min/max selection.
-- ============================================================
INSERT INTO public.purchase_orders (
  id,
  store_id,
  city_id,
  supplier_id,
  status,
  created_by,
  notes,
  created_at,
  updated_at
)
SELECT
  o.id,
  o.store_id,
  o.city_id,
  o.supplier_id,
  CASE WHEN o.status = 'accepted' THEN 'delivered' ELSE 'pending' END,
  o.distributor_id,
  FORMAT('Migrated from legacy orders.order_kind=purchase; legacy_order_id=%s', o.id),
  o.created_at,
  COALESCE(o.created_at, NOW())
FROM public.orders o
WHERE COALESCE(o.order_kind::TEXT, 'distribution') = 'purchase'
  AND NOT EXISTS (
    SELECT 1
    FROM public.purchase_orders po
    WHERE po.id = o.id
  );

INSERT INTO public.purchase_order_items (
  id,
  purchase_order_id,
  product_id,
  ordered_quantity,
  delivered_quantity,
  delivery_status,
  delivered_at,
  confirmed_by,
  unit_cost,
  created_at
)
SELECT
  oi.id,
  oi.order_id,
  oi.product_id,
  oi.quantity,
  CASE WHEN o.status = 'accepted' THEN oi.quantity ELSE 0 END,
  CASE WHEN o.status = 'accepted' THEN 'delivered' ELSE 'pending' END,
  CASE WHEN o.status = 'accepted' THEN COALESCE(o.created_at, NOW()) ELSE NULL END,
  NULL,
  COALESCE(oi.unit_cost, 0),
  COALESCE(o.created_at, NOW())
FROM public.order_items oi
JOIN public.orders o ON o.id = oi.order_id
JOIN public.purchase_orders po ON po.id = o.id
WHERE COALESCE(o.order_kind::TEXT, 'distribution') = 'purchase'
  AND NOT EXISTS (
    SELECT 1
    FROM public.purchase_order_items poi
    WHERE poi.id = oi.id
  );

UPDATE public.financial_transactions ft
SET source_purchase_order_id = ft.source_order_id
FROM public.orders o
WHERE ft.source_order_id = o.id
  AND COALESCE(o.order_kind::TEXT, 'distribution') = 'purchase'
  AND ft.source_purchase_order_id IS NULL
  AND EXISTS (
    SELECT 1
    FROM public.purchase_orders po
    WHERE po.id = o.id
  );

-- ============================================================
-- 10. Bump schema_version to 7.2.0
-- ============================================================
INSERT INTO public.app_schema_meta (key, value)
VALUES ('schema_version', '7.2.0')
ON CONFLICT (key)
DO UPDATE SET
  value = EXCLUDED.value,
  updated_at = NOW();

-- ============================================================
-- Manual verification queries (do not execute as part of migration)
-- ============================================================
-- SELECT COUNT(*) FROM public.purchase_orders;
-- SELECT COUNT(*) FROM public.orders WHERE COALESCE(order_kind::TEXT, 'distribution') = 'purchase';
-- SELECT COUNT(*) FROM public.purchase_order_items;
-- SELECT COUNT(*)
-- FROM public.order_items oi
-- JOIN public.orders o ON o.id = oi.order_id
-- WHERE COALESCE(o.order_kind::TEXT, 'distribution') = 'purchase';
-- SELECT po.id, po.status, COUNT(poi.id) AS item_count, SUM(poi.delivered_quantity) AS delivered_quantity
-- FROM public.purchase_orders po
-- LEFT JOIN public.purchase_order_items poi ON poi.purchase_order_id = po.id
-- GROUP BY po.id, po.status;
