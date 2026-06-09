-- Migration v4.6: Store retail order RPC + delete adaptation
-- Execute after migrate-v4.5-retail-delete-rollback-and-unpaid-cleanup.sql
-- Purpose:
-- 1) add create_store_retail_order_atomic that deducts from store_inventory,
--    creates accepted retail orders, and leaves public.inventory untouched.
--    Orders are tagged with 'msr:' prefix on request_id so the delete RPC
--    can distinguish mobile-store-retail from Web POS retail orders.
-- 2) adapt delete_order_with_inventory_restore_atomic so orders with
--    order_kind='retail' + store_id + request_id LIKE 'msr:%' restore to
--    store_inventory, while all other orders preserve existing v4.5 behavior

-- ============================================================
-- NEW RPC: create_store_retail_order_atomic
-- Mobile store retail: deducts from store_inventory, creates accepted
-- retail order, does NOT touch public.inventory.
-- Uses product.price as retail price (looked up server-side for integrity).
-- p_store_id is required — no auto-fallback.
-- ============================================================
CREATE OR REPLACE FUNCTION public.create_store_retail_order_atomic(
  p_items JSONB,
  p_store_id UUID,
  p_request_id TEXT DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_role TEXT;
  v_order_id UUID;
  v_total_retail NUMERIC(10, 2) := 0;
  v_store_city UUID;
  v_store_status TEXT;
  v_agg RECORD;
  v_store_stock INTEGER;
  v_existing_order_id UUID;
  v_effective_request_id TEXT;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION '未登录';
  END IF;

  SELECT role INTO v_role
  FROM public.profiles
  WHERE id = v_user_id;

  IF v_role IS NULL THEN
    RAISE EXCEPTION '用户资料不存在';
  END IF;

  IF v_role NOT IN ('admin', 'super_admin') THEN
    RAISE EXCEPTION '当前角色无店铺零售建单权限';
  END IF;

  IF p_store_id IS NULL THEN
    RAISE EXCEPTION '店铺ID不能为空';
  END IF;

  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION '购物车为空';
  END IF;

  -- Normalize request_id with 'msr:' prefix to mark store-retail-mobile orders.
  -- This allows the delete RPC to distinguish them from Web POS retail orders
  -- without adding a new order_kind or schema column.
  IF p_request_id IS NOT NULL THEN
    IF p_request_id LIKE 'msr:%' THEN
      v_effective_request_id := p_request_id;
    ELSE
      v_effective_request_id := 'msr:' || p_request_id;
    END IF;
  ELSE
    v_effective_request_id := 'msr:' || gen_random_uuid()::text;
  END IF;

  -- Idempotency: return existing order if same effective request_id
  IF v_effective_request_id IS NOT NULL THEN
    SELECT o.id
    INTO v_existing_order_id
    FROM public.orders o
    WHERE o.request_id = v_effective_request_id
    LIMIT 1;

    IF v_existing_order_id IS NOT NULL THEN
      RETURN v_existing_order_id;
    END IF;
  END IF;

  -- Validate store exists and is active
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

  -- Parse items into temp table (caller passes product_id + quantity only;
  -- prices are looked up from products table for integrity)
  CREATE TEMP TABLE IF NOT EXISTS _store_retail_items_tmp (
    product_id UUID NOT NULL,
    quantity INTEGER NOT NULL
  ) ON COMMIT DROP;

  TRUNCATE TABLE _store_retail_items_tmp;

  INSERT INTO _store_retail_items_tmp (product_id, quantity)
  SELECT x.product_id, x.quantity
  FROM jsonb_to_recordset(p_items) AS x(
    product_id UUID,
    quantity INTEGER
  );

  IF NOT EXISTS (SELECT 1 FROM _store_retail_items_tmp) THEN
    RAISE EXCEPTION '购物车为空';
  END IF;

  IF EXISTS (SELECT 1 FROM _store_retail_items_tmp WHERE quantity <= 0) THEN
    RAISE EXCEPTION '订单数量必须大于0';
  END IF;

  -- Validate products exist
  IF EXISTS (
    SELECT 1
    FROM _store_retail_items_tmp bi
    LEFT JOIN public.products p ON p.id = bi.product_id
    WHERE p.id IS NULL
  ) THEN
    RAISE EXCEPTION '商品不存在';
  END IF;

  -- Validate products belong to store's city
  IF EXISTS (
    SELECT 1
    FROM _store_retail_items_tmp bi
    JOIN public.products p ON p.id = bi.product_id
    WHERE p.city_id IS DISTINCT FROM v_store_city
  ) THEN
    RAISE EXCEPTION '店铺只能接收所属城市商品';
  END IF;

  -- Lock store_inventory rows and validate stock (prevent concurrent oversell)
  FOR v_agg IN
    SELECT bi.product_id, SUM(bi.quantity)::INTEGER AS total_qty
    FROM _store_retail_items_tmp bi
    GROUP BY bi.product_id
    ORDER BY bi.product_id
  LOOP
    SELECT si.quantity
    INTO v_store_stock
    FROM public.store_inventory si
    WHERE si.store_id = p_store_id
      AND si.product_id = v_agg.product_id
    FOR UPDATE;

    IF v_store_stock IS NULL THEN
      RAISE EXCEPTION '店铺库存记录不存在';
    END IF;

    IF v_store_stock < v_agg.total_qty THEN
      RAISE EXCEPTION '店铺库存不足';
    END IF;
  END LOOP;

  -- Calculate totals using product.price as retail price
  SELECT COALESCE(SUM(p.price * bi.quantity), 0)
  INTO v_total_retail
  FROM _store_retail_items_tmp bi
  JOIN public.products p ON p.id = bi.product_id;

  -- Create order: order_kind = 'retail', accepted immediately
  INSERT INTO public.orders (
    distributor_id,
    city_id,
    store_id,
    request_id,
    order_kind,
    status,
    total_retail_amount,
    total_discount_amount
  ) VALUES (
    v_user_id,
    v_store_city,
    p_store_id,
    v_effective_request_id,
    'retail',
    'accepted',
    v_total_retail,
    v_total_retail
  )
  RETURNING id INTO v_order_id;

  -- Create order items: retail_price = discount_price = product.price
  INSERT INTO public.order_items (
    order_id,
    product_id,
    quantity,
    retail_price,
    discount_price,
    unit_cost,
    one_time_cost
  )
  SELECT
    v_order_id,
    bi.product_id,
    bi.quantity,
    p.price,
    p.price,
    p.cost,
    p.one_time_cost
  FROM _store_retail_items_tmp bi
  JOIN public.products p ON p.id = bi.product_id;

  -- Deduct from store_inventory (NOT from public.inventory)
  FOR v_agg IN
    SELECT bi.product_id, SUM(bi.quantity)::INTEGER AS total_qty
    FROM _store_retail_items_tmp bi
    GROUP BY bi.product_id
    ORDER BY bi.product_id
  LOOP
    UPDATE public.store_inventory
    SET quantity = quantity - v_agg.total_qty,
        updated_at = NOW()
    WHERE store_id = p_store_id
      AND product_id = v_agg.product_id;
  END LOOP;

  RETURN v_order_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_store_retail_order_atomic(JSONB, UUID, TEXT) TO authenticated;

-- ============================================================
-- ADAPTED RPC: delete_order_with_inventory_restore_atomic
-- Branch 1: retail + store_id IS NOT NULL + request_id LIKE 'msr:%'
--   (mobile store retail, identified by msr: prefix on request_id)
--   → restore quantity to store_inventory only
--   → do NOT touch public.inventory (it was never debited)
-- Branch 2: all other orders (distribution / Web POS retail / legacy)
--   → preserve existing v4.5 behavior:
--     always restore to public.inventory;
--     subtract from store_inventory only for distribution + store_id
-- ============================================================
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
    v_role IN ('admin', 'super_admin', 'inventory_manager')
    OR v_order.distributor_id = v_uid
  ) THEN
    RAISE EXCEPTION '当前账号无删除订单权限';
  END IF;

  -- Branch 1: Store retail mobile order (retail + store_id + msr: prefix)
  -- Restore to store_inventory only; public.inventory was never debited
  IF COALESCE(v_order.order_kind::TEXT, 'distribution') = 'retail'
     AND v_order.store_id IS NOT NULL
     AND v_order.request_id LIKE 'msr:%' THEN
    INSERT INTO public.store_inventory (store_id, product_id, quantity, updated_at)
    SELECT
      v_order.store_id,
      agg.product_id,
      agg.total_qty,
      NOW()
    FROM (
      SELECT oi.product_id, COALESCE(SUM(oi.quantity), 0)::INTEGER AS total_qty
      FROM public.order_items oi
      WHERE oi.order_id = p_order_id
      GROUP BY oi.product_id
    ) agg
    ON CONFLICT (store_id, product_id)
    DO UPDATE SET
      quantity = public.store_inventory.quantity + EXCLUDED.quantity,
      updated_at = NOW();

  -- Branch 2: Global-source orders (distribution / non-store retail / legacy)
  -- Preserve existing v4.5 behavior exactly
  ELSE
    -- Always restore to public.inventory
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

    -- For distribution orders with store_id, subtract from store_inventory
    IF v_order.store_id IS NOT NULL
       AND COALESCE(v_order.order_kind::TEXT, 'distribution') = 'distribution' THEN
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
  END IF;

  DELETE FROM public.orders WHERE id = p_order_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.delete_order_with_inventory_restore_atomic(UUID) TO authenticated;

-- Schema version gate
INSERT INTO public.app_schema_meta (key, value)
VALUES ('schema_version', '4.6.0')
ON CONFLICT (key)
DO UPDATE SET
  value = EXCLUDED.value,
  updated_at = NOW();
