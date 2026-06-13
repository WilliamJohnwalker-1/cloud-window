-- Migration v4.7: Batch order nullable-distributor fix + cost-sync trigger + historical backfill
-- Execute after migrate-v4.6-store-retail-order.sql
--
-- Three changes in this migration:
-- 1) Fix create_batch_order_atomic: after v4.1 made stores.distributor_id nullable,
--    a valid store with distributor_id = NULL was incorrectly rejected as "店铺不存在".
--    The fix uses IF NOT FOUND for existence check and skips distributor ownership
--    matching when distributor_id IS NULL (super_admin-managed stores).
-- 2) Add a trigger on products UPDATE that syncs cost/one_time_cost to all matching
--    order_items when the product's cost fields actually change (IS DISTINCT FROM guard).
-- 3) One-time historical backfill of order_items.unit_cost and one_time_cost from products.
--    This intentionally overrides the v2.2 snapshot philosophy: the product's current cost
--    is now the authoritative source. This is a user-approved decision to correct historical
--    orders that received zero or stale costs from client-supplied values.

-- ============================================================
-- 1) Fix create_batch_order_atomic: nullable distributor_id handling
-- ============================================================
-- The original v4.0 code (lines 307-324) did:
--   SELECT ... INTO v_store_distributor_id FROM stores WHERE id = p_store_id;
--   IF v_store_distributor_id IS NULL THEN RAISE EXCEPTION '店铺不存在';
--   IF v_store_distributor_id IS DISTINCT FROM v_user_id THEN RAISE EXCEPTION '店铺不属于当前分销商';
--
-- After v4.1 (ALTER COLUMN distributor_id DROP NOT NULL), a store CAN have
-- distributor_id = NULL. The SELECT sets the variable to NULL but FOUND stays TRUE,
-- so the NULL check incorrectly rejects valid stores.
--
-- Fix: use IF NOT FOUND for existence, and only check distributor ownership
-- when distributor_id IS NOT NULL (i.e., the store actually has a distributor binding).
-- Admin/super_admin users can order for any store regardless of distributor binding.

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

    -- FIX: Use IF NOT FOUND instead of checking nullable column for NULL.
    -- After v4.1, stores.distributor_id can be NULL for super_admin-managed stores.
    -- A row exists but distributor_id = NULL is a valid state, not "store not found".
    IF NOT FOUND THEN
      RAISE EXCEPTION '店铺不存在';
    END IF;

    IF v_store_status <> 'active' THEN
      RAISE EXCEPTION '店铺已停用';
    END IF;

    -- FIX: Only enforce distributor ownership when the store has a distributor binding.
    -- Stores with distributor_id = NULL are managed by admin/super_admin and should
    -- not be restricted to a specific distributor.
    IF v_store_distributor_id IS NOT NULL AND v_store_distributor_id IS DISTINCT FROM v_user_id THEN
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

-- ============================================================
-- 2) Cost-sync trigger: keep order_items in sync with products
-- ============================================================
-- When a product's cost or one_time_cost changes, update all matching
-- order_items to reflect the new values. This ensures profit reports
-- always use the product's current cost, which is the authoritative source.
--
-- The IS DISTINCT FROM guard prevents unnecessary writes when the values
-- haven't actually changed (e.g., other product columns updated).

CREATE OR REPLACE FUNCTION public.sync_product_cost_to_order_items()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Only fire when cost fields actually change
  IF NEW.cost IS DISTINCT FROM OLD.cost OR NEW.one_time_cost IS DISTINCT FROM OLD.one_time_cost THEN
    UPDATE public.order_items
    SET unit_cost = NEW.cost,
        one_time_cost = NEW.one_time_cost
    WHERE product_id = NEW.id;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_product_cost_to_order_items ON public.products;

CREATE TRIGGER trg_sync_product_cost_to_order_items
AFTER UPDATE ON public.products
FOR EACH ROW
EXECUTE FUNCTION public.sync_product_cost_to_order_items();

-- ============================================================
-- 3) Historical backfill: rewrite ALL order_items costs from products
-- ============================================================
-- This intentionally overrides the v2.2 snapshot philosophy.
-- The v2.2 migration backfilled unit_cost from products.cost, but subsequent
-- orders created via create_batch_order_atomic and create_retail_order_atomic
-- received client-supplied costs that could be zero, stale, or incorrect.
-- The cost-sync trigger above will keep future order_items correct going forward.
-- This is a FULL backfill: every order_items row gets its cost fields overwritten
-- from the current products row, regardless of whether the existing value is
-- NULL, 0, or non-zero.
--
-- User-approved decision: product's current cost is the authoritative source
-- for profit reporting, overriding the original "snapshot at order time" design.

-- Full backfill: unit_cost <- products.cost for ALL matching order_items
UPDATE public.order_items oi
SET unit_cost = COALESCE(p.cost, 0)
  FROM public.products p
WHERE oi.product_id = p.id;

-- Full backfill: one_time_cost <- products.one_time_cost for ALL matching order_items
UPDATE public.order_items oi
SET one_time_cost = COALESCE(p.one_time_cost, 0)
FROM public.products p
  WHERE oi.product_id = p.id;

-- ============================================================
-- Schema version gate
-- ============================================================
INSERT INTO public.app_schema_meta (key, value)
VALUES ('schema_version', '4.7.0')
ON CONFLICT (key)
DO UPDATE SET
  value = EXCLUDED.value,
  updated_at = NOW();