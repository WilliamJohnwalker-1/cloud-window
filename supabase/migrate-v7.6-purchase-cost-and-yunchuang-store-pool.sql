-- Migration v7.6: purchase line-total cost capture + 云窗到货入店铺池
-- Execute after migrate-v7.5-external-channel-orders.sql

-- ============================================================
-- 1) create_purchase_order_v2: support optional line_total per item
--    and derive unit_cost from line_total/quantity when provided.
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
    quantity INTEGER NOT NULL,
    line_total NUMERIC(12, 2)
  ) ON COMMIT DROP;

  TRUNCATE TABLE _purchase_order_v2_items_tmp;

  INSERT INTO _purchase_order_v2_items_tmp (product_id, quantity, line_total)
  SELECT x.product_id, x.quantity, x.line_total
  FROM jsonb_to_recordset(p_items) AS x(
    product_id UUID,
    quantity INTEGER,
    line_total NUMERIC(12, 2)
  );

  IF NOT EXISTS (SELECT 1 FROM _purchase_order_v2_items_tmp) THEN
    RAISE EXCEPTION '进货项不能为空';
  END IF;

  IF EXISTS (SELECT 1 FROM _purchase_order_v2_items_tmp WHERE quantity <= 0) THEN
    RAISE EXCEPTION '进货数量必须大于0';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM _purchase_order_v2_items_tmp
    WHERE line_total IS NOT NULL AND line_total <= 0
  ) THEN
    RAISE EXCEPTION '进货总价必须大于0';
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
    CASE
      WHEN pi.line_total IS NOT NULL THEN ROUND(pi.line_total / pi.quantity::NUMERIC, 2)
      ELSE COALESCE(p.cost, 0)
    END
  FROM _purchase_order_v2_items_tmp pi
  JOIN public.products p ON p.id = pi.product_id;

  RETURN v_purchase_order_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_purchase_order_v2(UUID, UUID, UUID, JSONB, UUID) TO authenticated;

-- ============================================================
-- 2) confirm_purchase_item_delivery: 云窗到货入总库存，其他店铺入店铺库存池
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
-- 3) delete_purchase_order_v2: rollback pool follows delivery pool rule
--    云窗回滚总库存，其他店铺回滚店铺库存池。
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
  v_purchase_tx_ids UUID[] := ARRAY[]::UUID[];
  v_store_name TEXT;
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
-- 4) Bump schema_version to 7.6.0
-- ============================================================
INSERT INTO public.app_schema_meta (key, value)
VALUES ('schema_version', '7.6.0')
ON CONFLICT (key)
DO UPDATE SET
  value = EXCLUDED.value,
  updated_at = NOW();
