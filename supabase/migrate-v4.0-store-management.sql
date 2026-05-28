-- Migration v4.0: Store management schema foundation
-- Execute in Supabase SQL Editor

CREATE TABLE IF NOT EXISTS public.stores (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  city_id UUID NOT NULL REFERENCES public.cities(id),
  distributor_id UUID NOT NULL REFERENCES public.profiles(id),
  discount_rate DECIMAL(5, 4) NOT NULL DEFAULT 1.0000,
  address TEXT,
  phone TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.store_inventory (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id UUID NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  quantity INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(store_id, product_id)
);

CREATE TABLE IF NOT EXISTS public.store_product_prices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id UUID NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  override_price DECIMAL(10, 2) NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(store_id, product_id)
);

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS store_id UUID;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'orders_store_id_fkey'
      AND conrelid = 'public.orders'::regclass
  ) THEN
    ALTER TABLE public.orders
      ADD CONSTRAINT orders_store_id_fkey
      FOREIGN KEY (store_id) REFERENCES public.stores(id);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_stores_city_id
  ON public.stores(city_id);

CREATE INDEX IF NOT EXISTS idx_stores_distributor_id
  ON public.stores(distributor_id);

CREATE INDEX IF NOT EXISTS idx_store_inventory_store_id
  ON public.store_inventory(store_id);

CREATE INDEX IF NOT EXISTS idx_store_inventory_product_id
  ON public.store_inventory(product_id);

CREATE INDEX IF NOT EXISTS idx_store_product_prices_store_id
  ON public.store_product_prices(store_id);

CREATE INDEX IF NOT EXISTS idx_store_product_prices_product_id
  ON public.store_product_prices(product_id);

CREATE INDEX IF NOT EXISTS idx_orders_store_id
  ON public.orders(store_id);

ALTER TABLE public.stores ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.store_inventory ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.store_product_prices ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'stores'
      AND policyname = 'Admins can manage stores'
  ) THEN
    CREATE POLICY "Admins can manage stores" ON public.stores
      FOR ALL USING (public.is_admin())
      WITH CHECK (public.is_admin());
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'stores'
      AND policyname = 'Distributors can view own stores'
  ) THEN
    CREATE POLICY "Distributors can view own stores" ON public.stores
      FOR SELECT TO authenticated
      USING (auth.uid() = distributor_id);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'store_inventory'
      AND policyname = 'Admins can manage store inventory'
  ) THEN
    CREATE POLICY "Admins can manage store inventory" ON public.store_inventory
      FOR ALL USING (public.is_admin())
      WITH CHECK (public.is_admin());
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'store_inventory'
      AND policyname = 'Inventory managers can view store inventory'
  ) THEN
    CREATE POLICY "Inventory managers can view store inventory" ON public.store_inventory
      FOR SELECT TO authenticated
      USING (public.is_admin_or_inventory_manager());
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'store_inventory'
      AND policyname = 'Distributors can view own store inventory'
  ) THEN
    CREATE POLICY "Distributors can view own store inventory" ON public.store_inventory
      FOR SELECT TO authenticated
      USING (
        EXISTS (
          SELECT 1
          FROM public.stores s
          WHERE s.id = store_inventory.store_id
            AND s.distributor_id = auth.uid()
        )
      );
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'store_product_prices'
      AND policyname = 'Admins can manage store product prices'
  ) THEN
    CREATE POLICY "Admins can manage store product prices" ON public.store_product_prices
      FOR ALL USING (public.is_admin())
      WITH CHECK (public.is_admin());
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'store_product_prices'
      AND policyname = 'Distributors can view own store product prices'
  ) THEN
    CREATE POLICY "Distributors can view own store product prices" ON public.store_product_prices
      FOR SELECT TO authenticated
      USING (
        EXISTS (
          SELECT 1
          FROM public.stores s
          WHERE s.id = store_product_prices.store_id
            AND s.distributor_id = auth.uid()
        )
      );
  END IF;
END $$;

-- Data bootstrap: copy legacy profile store names into stores.
-- Preserve profiles.store_name as the legacy source of truth for backward compatibility.
INSERT INTO public.stores (name, city_id, distributor_id, created_at, updated_at)
SELECT
  trim(p.store_name) AS name,
  p.city_id,
  p.id AS distributor_id,
  NOW() AS created_at,
  NOW() AS updated_at
FROM public.profiles p
WHERE p.role = 'distributor'
  AND p.store_name IS NOT NULL
  AND length(trim(p.store_name)) > 0
  AND NOT EXISTS (
    SELECT 1
    FROM public.stores s
    WHERE s.distributor_id = p.id
      AND s.name = trim(p.store_name)
  );

-- Data bootstrap: copy legacy distributor-level product prices to first store.
-- First-store selection is UUID-safe: ARRAY_AGG orders by timestamp then UUID text.
WITH first_stores AS (
  SELECT
    s.distributor_id,
    (ARRAY_AGG(s.id ORDER BY s.created_at, s.id::text))[1]::uuid AS store_id
  FROM public.stores s
  GROUP BY s.distributor_id
)
INSERT INTO public.store_product_prices (store_id, product_id, override_price, created_at, updated_at)
SELECT
  fs.store_id,
  dpp.product_id,
  dpp.discount_price AS override_price,
  dpp.created_at,
  dpp.updated_at
FROM public.distributor_product_prices dpp
JOIN first_stores fs ON fs.distributor_id = dpp.distributor_id
WHERE NOT EXISTS (
  SELECT 1
  FROM public.store_product_prices spp
  WHERE spp.store_id = fs.store_id
    AND spp.product_id = dpp.product_id
);

-- Store-aware distribution order creation.
-- Replaces the v3.6 two-argument signature so callers that omit p_store_id
-- still resolve through this implementation via the default NULL argument.
DROP FUNCTION IF EXISTS public.create_batch_order_atomic(JSONB, TEXT);

CREATE OR REPLACE FUNCTION public.create_batch_order_atomic(
  p_items JSONB,
  p_request_id TEXT DEFAULT NULL,
  p_store_id UUID DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_role TEXT;
  v_user_city UUID;
  v_user_email TEXT;
  v_user_store TEXT;
  v_order_id UUID;
  v_total_retail NUMERIC(10, 2) := 0;
  v_total_discount NUMERIC(10, 2) := 0;
  v_order_city UUID;
  v_store_city UUID;
  v_store_status TEXT;
  v_store_distributor_id UUID;
  v_agg RECORD;
  v_stock INTEGER;
  v_existing_order_id UUID;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION '未登录';
  END IF;

  SELECT role, city_id, email, store_name
  INTO v_role, v_user_city, v_user_email, v_user_store
  FROM public.profiles
  WHERE id = v_user_id;

  IF v_role IS NULL THEN
    RAISE EXCEPTION '用户资料不存在';
  END IF;

  IF v_role NOT IN ('admin', 'distributor') THEN
    RAISE EXCEPTION '当前角色无下单权限';
  END IF;

  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION '购物车为空';
  END IF;

  IF p_request_id IS NOT NULL THEN
    SELECT o.id
    INTO v_existing_order_id
    FROM public.orders o
    WHERE o.request_id = p_request_id
    LIMIT 1;

    IF v_existing_order_id IS NOT NULL THEN
      RETURN v_existing_order_id;
    END IF;
  END IF;

  IF p_store_id IS NOT NULL THEN
    SELECT s.city_id, s.status, s.distributor_id
    INTO v_store_city, v_store_status, v_store_distributor_id
    FROM public.stores s
    WHERE s.id = p_store_id;

    IF v_store_distributor_id IS NULL THEN
      RAISE EXCEPTION '店铺不存在';
    END IF;

    IF v_store_status <> 'active' THEN
      RAISE EXCEPTION '店铺已停用';
    END IF;

    IF v_store_distributor_id IS DISTINCT FROM v_user_id THEN
      RAISE EXCEPTION '店铺不属于当前分销商';
    END IF;
  END IF;

  CREATE TEMP TABLE IF NOT EXISTS _batch_order_items_tmp (
    product_id UUID NOT NULL,
    quantity INTEGER NOT NULL,
    retail_price NUMERIC(10, 2) NOT NULL,
    discount_price NUMERIC(10, 2) NOT NULL,
    unit_cost NUMERIC(10, 2) NOT NULL,
    one_time_cost NUMERIC(10, 2) NOT NULL,
    is_sample BOOLEAN NOT NULL DEFAULT FALSE
  ) ON COMMIT DROP;

  TRUNCATE TABLE _batch_order_items_tmp;

  INSERT INTO _batch_order_items_tmp (
    product_id,
    quantity,
    retail_price,
    discount_price,
    unit_cost,
    one_time_cost,
    is_sample
  )
  SELECT
    x.product_id,
    x.quantity,
    x.retail_price,
    x.discount_price,
    x.unit_cost,
    x.one_time_cost,
    COALESCE(x.is_sample, FALSE)
  FROM jsonb_to_recordset(p_items) AS x(
    product_id UUID,
    quantity INTEGER,
    retail_price NUMERIC(10, 2),
    discount_price NUMERIC(10, 2),
    unit_cost NUMERIC(10, 2),
    one_time_cost NUMERIC(10, 2),
    is_sample BOOLEAN
  );

  IF NOT EXISTS (SELECT 1 FROM _batch_order_items_tmp) THEN
    RAISE EXCEPTION '购物车为空';
  END IF;

  IF EXISTS (SELECT 1 FROM _batch_order_items_tmp WHERE quantity <= 0) THEN
    RAISE EXCEPTION '订单数量必须大于0';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM _batch_order_items_tmp
    WHERE NOT is_sample AND quantity % 5 <> 0
  ) THEN
    RAISE EXCEPTION '非样品数量必须是5的倍数';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM _batch_order_items_tmp bi
    LEFT JOIN public.products p ON p.id = bi.product_id
    WHERE p.id IS NULL
  ) THEN
    RAISE EXCEPTION '商品不存在';
  END IF;

  IF p_store_id IS NOT NULL THEN
    IF EXISTS (
      SELECT 1
      FROM _batch_order_items_tmp bi
      JOIN public.products p ON p.id = bi.product_id
      WHERE p.city_id IS DISTINCT FROM v_store_city
    ) THEN
      RAISE EXCEPTION '店铺只能接收所属城市商品';
    END IF;
  ELSIF v_role = 'distributor' THEN
    IF v_user_city IS NULL THEN
      RAISE EXCEPTION '分销商未绑定城市';
    END IF;

    IF EXISTS (
      SELECT 1
      FROM _batch_order_items_tmp bi
      JOIN public.products p ON p.id = bi.product_id
      WHERE p.city_id IS DISTINCT FROM v_user_city
    ) THEN
      RAISE EXCEPTION '分销商只能下所属城市商品';
    END IF;
  END IF;

  FOR v_agg IN
    SELECT bi.product_id, SUM(bi.quantity)::INTEGER AS total_qty
    FROM _batch_order_items_tmp bi
    GROUP BY bi.product_id
    ORDER BY bi.product_id
  LOOP
    SELECT i.quantity
    INTO v_stock
    FROM public.inventory i
    WHERE i.product_id = v_agg.product_id
    FOR UPDATE;

    IF v_stock IS NULL THEN
      RAISE EXCEPTION '库存记录不存在';
    END IF;

    IF v_stock < v_agg.total_qty THEN
      RAISE EXCEPTION '库存不足';
    END IF;
  END LOOP;

  SELECT
    COALESCE(SUM(CASE WHEN bi.is_sample THEN 0 ELSE bi.retail_price * bi.quantity END), 0),
    COALESCE(SUM(CASE WHEN bi.is_sample THEN 0 ELSE bi.discount_price * bi.quantity END), 0)
  INTO v_total_retail, v_total_discount
  FROM _batch_order_items_tmp bi;

  IF p_store_id IS NOT NULL THEN
    v_order_city := v_store_city;
  ELSE
    SELECT COALESCE(
      v_user_city,
      (SELECT p.city_id
       FROM _batch_order_items_tmp bi
       JOIN public.products p ON p.id = bi.product_id
       LIMIT 1)
    )
    INTO v_order_city;
  END IF;

  INSERT INTO public.orders (
    distributor_id,
    city_id,
    store_id,
    request_id,
    total_retail_amount,
    total_discount_amount
  ) VALUES (
    v_user_id,
    v_order_city,
    p_store_id,
    p_request_id,
    v_total_retail,
    v_total_discount
  )
  RETURNING id INTO v_order_id;

  INSERT INTO public.order_items (
    order_id,
    product_id,
    quantity,
    retail_price,
    discount_price,
    unit_cost,
    one_time_cost,
    is_sample
  )
  SELECT
    v_order_id,
    bi.product_id,
    bi.quantity,
    CASE WHEN bi.is_sample THEN 0 ELSE bi.retail_price END,
    CASE WHEN bi.is_sample THEN 0 ELSE bi.discount_price END,
    bi.unit_cost,
    bi.one_time_cost,
    bi.is_sample
  FROM _batch_order_items_tmp bi;

  FOR v_agg IN
    SELECT bi.product_id, SUM(bi.quantity)::INTEGER AS total_qty
    FROM _batch_order_items_tmp bi
    GROUP BY bi.product_id
    ORDER BY bi.product_id
  LOOP
    UPDATE public.inventory
    SET quantity = quantity - v_agg.total_qty,
        updated_at = NOW()
    WHERE product_id = v_agg.product_id;
  END LOOP;

  IF p_store_id IS NOT NULL THEN
    INSERT INTO public.store_inventory (store_id, product_id, quantity, updated_at)
    SELECT
      p_store_id,
      bi.product_id,
      SUM(bi.quantity)::INTEGER,
      NOW()
    FROM _batch_order_items_tmp bi
    WHERE NOT bi.is_sample
    GROUP BY bi.product_id
    ON CONFLICT (store_id, product_id)
    DO UPDATE SET
      quantity = public.store_inventory.quantity + EXCLUDED.quantity,
      updated_at = NOW();
  END IF;

  INSERT INTO public.notifications (user_id, type, order_id, message)
  SELECT
    p.id,
    'new_order',
    v_order_id,
    format('新订单 #%s 来自 %s', LEFT(v_order_id::text, 8), COALESCE(v_user_store, v_user_email, '未知用户'))
  FROM public.profiles p
  WHERE p.role = 'admin';

  RETURN v_order_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_batch_order_atomic(JSONB, TEXT, UUID) TO authenticated;

-- Store-aware order deletion with dual-pool inventory restore.
CREATE OR REPLACE FUNCTION public.delete_order_with_inventory_restore_atomic(
  p_order_id UUID
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_role TEXT;
  v_order public.orders%ROWTYPE;
  v_agg RECORD;
  v_inventory_qty INTEGER;
  v_store_qty INTEGER;
BEGIN
  SELECT role INTO v_role
  FROM public.profiles
  WHERE id = v_uid;

  SELECT * INTO v_order
  FROM public.orders
  WHERE id = p_order_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION '订单不存在';
  END IF;

  IF NOT (
    v_role IN ('admin', 'inventory_manager')
    OR v_order.distributor_id = v_uid
  ) THEN
    RAISE EXCEPTION '当前账号无删除订单权限';
  END IF;

  FOR v_agg IN
    SELECT
      oi.product_id,
      COALESCE(SUM(oi.quantity), 0)::INTEGER AS total_qty,
      COALESCE(SUM(CASE WHEN oi.is_sample THEN 0 ELSE oi.quantity END), 0)::INTEGER AS store_qty
    FROM public.order_items oi
    WHERE oi.order_id = p_order_id
    GROUP BY oi.product_id
    ORDER BY oi.product_id
  LOOP
    SELECT i.quantity
    INTO v_inventory_qty
    FROM public.inventory i
    WHERE i.product_id = v_agg.product_id
    FOR UPDATE;

    IF v_inventory_qty IS NULL THEN
      RAISE EXCEPTION '库存记录不存在';
    END IF;

    IF v_order.store_id IS NOT NULL AND v_agg.store_qty > 0 THEN
      SELECT si.quantity
      INTO v_store_qty
      FROM public.store_inventory si
      WHERE si.store_id = v_order.store_id
        AND si.product_id = v_agg.product_id
      FOR UPDATE;

      IF v_store_qty IS NULL THEN
        RAISE EXCEPTION '店铺库存记录不存在';
      END IF;

      IF v_store_qty < v_agg.store_qty THEN
        RAISE EXCEPTION '店铺库存不足，无法删除该订单';
      END IF;
    END IF;
  END LOOP;

  UPDATE public.inventory i
  SET quantity = i.quantity + agg.total_qty,
      updated_at = NOW()
  FROM (
    SELECT oi.product_id, COALESCE(SUM(oi.quantity), 0)::INTEGER AS total_qty
    FROM public.order_items oi
    WHERE oi.order_id = p_order_id
    GROUP BY oi.product_id
  ) agg
  WHERE i.product_id = agg.product_id;

  IF v_order.store_id IS NOT NULL THEN
    UPDATE public.store_inventory si
    SET quantity = si.quantity - agg.store_qty,
        updated_at = NOW()
    FROM (
      SELECT
        oi.product_id,
        COALESCE(SUM(CASE WHEN oi.is_sample THEN 0 ELSE oi.quantity END), 0)::INTEGER AS store_qty
      FROM public.order_items oi
      WHERE oi.order_id = p_order_id
      GROUP BY oi.product_id
    ) agg
    WHERE si.store_id = v_order.store_id
      AND si.product_id = agg.product_id
      AND agg.store_qty > 0;
  END IF;

  DELETE FROM public.orders WHERE id = p_order_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.delete_order_with_inventory_restore_atomic(UUID) TO authenticated;

-- Modify accepted distribution orders by reduction only (return-flow).
CREATE OR REPLACE FUNCTION public.modify_distribution_order_atomic(
  p_order_id UUID,
  p_items JSONB,
  p_request_id TEXT DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_role TEXT;
  v_order public.orders%ROWTYPE;
  v_item RECORD;
  v_current_item public.order_items%ROWTYPE;
  v_delta INTEGER;
  v_inventory_qty INTEGER;
  v_store_qty INTEGER;
BEGIN
  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION '修改项不能为空';
  END IF;

  SELECT role INTO v_role
  FROM public.profiles
  WHERE id = v_uid;

  IF v_role IS DISTINCT FROM 'admin' THEN
    RAISE EXCEPTION '仅管理员可修改分销订单';
  END IF;

  SELECT * INTO v_order
  FROM public.orders
  WHERE id = p_order_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION '订单不存在';
  END IF;

  IF COALESCE(v_order.order_kind::TEXT, 'distribution') <> 'distribution' THEN
    RAISE EXCEPTION '仅支持修改分销订单';
  END IF;

  IF COALESCE(v_order.status, 'pending') <> 'accepted' THEN
    RAISE EXCEPTION '仅支持修改已接单订单';
  END IF;

  IF v_order.store_id IS NULL THEN
    RAISE EXCEPTION '仅支持修改绑定店铺的分销订单';
  END IF;

  CREATE TEMP TABLE IF NOT EXISTS _modify_distribution_items_tmp (
    order_item_id UUID NOT NULL,
    new_quantity INTEGER NOT NULL
  ) ON COMMIT DROP;

  TRUNCATE TABLE _modify_distribution_items_tmp;

  INSERT INTO _modify_distribution_items_tmp (order_item_id, new_quantity)
  SELECT x.order_item_id, x.new_quantity
  FROM jsonb_to_recordset(p_items) AS x(order_item_id UUID, new_quantity INTEGER);

  IF EXISTS (
    SELECT 1
    FROM _modify_distribution_items_tmp
    GROUP BY order_item_id
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION '同一订单行不能重复修改';
  END IF;

  IF EXISTS (SELECT 1 FROM _modify_distribution_items_tmp WHERE new_quantity < 0) THEN
    RAISE EXCEPTION '新数量不能小于0';
  END IF;

  FOR v_item IN
    SELECT order_item_id, new_quantity
    FROM _modify_distribution_items_tmp
    ORDER BY order_item_id
  LOOP
    SELECT * INTO v_current_item
    FROM public.order_items oi
    WHERE oi.id = v_item.order_item_id
      AND oi.order_id = p_order_id
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION '订单行不存在或不属于该订单';
    END IF;

    IF v_item.new_quantity >= v_current_item.quantity THEN
      RAISE EXCEPTION '仅支持减量修改';
    END IF;

    v_delta := v_current_item.quantity - v_item.new_quantity;

    SELECT i.quantity INTO v_inventory_qty
    FROM public.inventory i
    WHERE i.product_id = v_current_item.product_id
    FOR UPDATE;

    IF v_inventory_qty IS NULL THEN
      RAISE EXCEPTION '库存记录不存在';
    END IF;

    IF NOT v_current_item.is_sample THEN
      SELECT si.quantity INTO v_store_qty
      FROM public.store_inventory si
      WHERE si.store_id = v_order.store_id
        AND si.product_id = v_current_item.product_id
      FOR UPDATE;

      IF v_store_qty IS NULL THEN
        RAISE EXCEPTION '店铺库存记录不存在';
      END IF;

      IF v_store_qty < v_delta THEN
        RAISE EXCEPTION '店铺库存不足，无法减量';
      END IF;
    END IF;

    UPDATE public.inventory
    SET quantity = quantity + v_delta,
        updated_at = NOW()
    WHERE product_id = v_current_item.product_id;

    IF NOT v_current_item.is_sample THEN
      UPDATE public.store_inventory
      SET quantity = quantity - v_delta,
          updated_at = NOW()
      WHERE store_id = v_order.store_id
        AND product_id = v_current_item.product_id;
    END IF;

    IF v_item.new_quantity = 0 THEN
      DELETE FROM public.order_items WHERE id = v_current_item.id;
    ELSE
      UPDATE public.order_items
      SET quantity = v_item.new_quantity
      WHERE id = v_current_item.id;
    END IF;
  END LOOP;

  IF NOT EXISTS (SELECT 1 FROM public.order_items WHERE order_id = p_order_id) THEN
    DELETE FROM public.orders WHERE id = p_order_id;
    RETURN;
  END IF;

  UPDATE public.orders o
  SET total_retail_amount = totals.total_retail,
      total_discount_amount = totals.total_discount
  FROM (
    SELECT
      COALESCE(SUM(oi.retail_price * oi.quantity), 0)::NUMERIC(10, 2) AS total_retail,
      COALESCE(SUM(oi.discount_price * oi.quantity), 0)::NUMERIC(10, 2) AS total_discount
    FROM public.order_items oi
    WHERE oi.order_id = p_order_id
  ) totals
  WHERE o.id = p_order_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.modify_distribution_order_atomic(UUID, JSONB, TEXT) TO authenticated;

INSERT INTO public.app_schema_meta (key, value)
VALUES ('schema_version', '4.0.0')
ON CONFLICT (key)
DO UPDATE SET
  value = EXCLUDED.value,
  updated_at = NOW();
