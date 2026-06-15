-- Migration v5.0: Settlement order kind + trigger update + profiles.default_store_id
-- Execute after migrate-v4.11-refund-delete-no-double-restore.sql
-- Purpose:
-- 1) Add 'settlement' to order_kind CHECK constraint
-- 2) Add profiles.default_store_id (nullable FK to stores)
-- 3) Update handle_new_user() to stop requiring store_name and stop auto-creating stores
-- 4) Update create_store_for_new_distributor() to stop auto-creating stores on profile insert
-- 5) Create create_settlement_order_atomic RPC (admin-only, quantity granularity 1,
--    no payment flow, only decrease store_inventory, status accepted immediately,
--    settlement pricing via store override_price or discount_rate)
-- 6) Update delete_order_with_inventory_restore_atomic to handle settlement order deletion
--    (restore to store_inventory only, since public.inventory was never debited)

-- ============================================================
-- 1. Extend order_kind CHECK to include 'settlement'
-- ============================================================
ALTER TABLE public.orders
  DROP CONSTRAINT IF EXISTS orders_order_kind_check;

ALTER TABLE public.orders
  ADD CONSTRAINT orders_order_kind_check
  CHECK (order_kind IN ('distribution', 'retail', 'settlement'));

-- ============================================================
-- 2. Add profiles.default_store_id (nullable FK to stores)
-- ============================================================
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS default_store_id UUID;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'profiles_default_store_id_fkey'
      AND conrelid = 'public.profiles'::regclass
  ) THEN
    ALTER TABLE public.profiles
      ADD CONSTRAINT profiles_default_store_id_fkey
      FOREIGN KEY (default_store_id) REFERENCES public.stores(id);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_profiles_default_store_id
  ON public.profiles(default_store_id);

-- ============================================================
-- 3. Update handle_new_user() — remove store_name requirement
--    and stop auto-creating stores on signup
-- ============================================================
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
DECLARE
  signup_role TEXT;
  default_hangzhou UUID;
  selected_city UUID;
BEGIN
  signup_role := COALESCE(NEW.raw_user_meta_data->>'role', 'distributor');
  selected_city := NULLIF(NEW.raw_user_meta_data->>'city_id', '')::uuid;

  SELECT id INTO default_hangzhou FROM public.cities WHERE name = '杭州' LIMIT 1;

  IF signup_role = 'admin' THEN
    selected_city := COALESCE(selected_city, default_hangzhou);
  END IF;

  IF signup_role = 'distributor' AND selected_city IS NULL THEN
    RAISE EXCEPTION 'Distributor city is required';
  END IF;

  -- Insert profile without store_name; store binding is now managed
  -- separately via profiles.default_store_id by an admin.
  INSERT INTO public.profiles (id, email, role, city_id)
  VALUES (NEW.id, NEW.email, signup_role, selected_city);

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================
-- 4. Update create_store_for_new_distributor() — no longer
--    auto-creates stores on profile insert. Store creation is
--    now an explicit admin action; default_store_id binding
--    is set separately.
-- ============================================================
CREATE OR REPLACE FUNCTION public.create_store_for_new_distributor()
RETURNS TRIGGER AS $$
BEGIN
  -- No-op: store creation is now an explicit admin action.
  -- The trigger is retained as a no-op for forward compatibility
  -- so that future store-binding logic can be added here if needed.
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================
-- 5. Update self-heal policy to no longer require store_name
--    (distributors can self-heal without a store_name)
-- ============================================================
DROP POLICY IF EXISTS "Users can insert own distributor profile" ON public.profiles;

CREATE POLICY "Users can insert own distributor profile" ON public.profiles
  FOR INSERT TO authenticated
  WITH CHECK (
    auth.uid() = id
    AND role = 'distributor'
    AND city_id IS NOT NULL
  );

-- ============================================================
-- 6. Create create_settlement_order_atomic RPC
--    Admin-only, quantity granularity 1, no payment flow,
--    only decrease store_inventory, status accepted immediately.
--    Settlement pricing: store_product_prices.override_price if present,
--    otherwise stores.discount_rate * products.price.
--    retail_price = products.price (always the list price reference).
--    discount_price = settlement price (override or discount_rate * price).
-- ============================================================
CREATE OR REPLACE FUNCTION public.create_settlement_order_atomic(
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
  v_total_discount NUMERIC(10, 2) := 0;
  v_store_city UUID;
  v_store_status TEXT;
  v_agg RECORD;
  v_store_stock INTEGER;
  v_existing_order_id UUID;
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

  IF v_role <> 'admin' THEN
    RAISE EXCEPTION '当前角色无结算建单权限';
  END IF;

  IF p_store_id IS NULL THEN
    RAISE EXCEPTION '店铺ID不能为空';
  END IF;

  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION '结算项不能为空';
  END IF;

  -- Idempotency: return existing order if same request_id
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

  -- Parse items into temp table (product_id + quantity only;
  -- prices are resolved server-side for integrity)
  CREATE TEMP TABLE IF NOT EXISTS _settlement_items_tmp (
    product_id UUID NOT NULL,
    quantity INTEGER NOT NULL
  ) ON COMMIT DROP;

  TRUNCATE TABLE _settlement_items_tmp;

  INSERT INTO _settlement_items_tmp (product_id, quantity)
  SELECT x.product_id, x.quantity
  FROM jsonb_to_recordset(p_items) AS x(
    product_id UUID,
    quantity INTEGER
  );

  IF NOT EXISTS (SELECT 1 FROM _settlement_items_tmp) THEN
    RAISE EXCEPTION '结算项不能为空';
  END IF;

  IF EXISTS (SELECT 1 FROM _settlement_items_tmp WHERE quantity <= 0) THEN
    RAISE EXCEPTION '结算数量必须大于0';
  END IF;

  -- Validate products exist
  IF EXISTS (
    SELECT 1
    FROM _settlement_items_tmp bi
    LEFT JOIN public.products p ON p.id = bi.product_id
    WHERE p.id IS NULL
  ) THEN
    RAISE EXCEPTION '商品不存在';
  END IF;

  -- Validate products belong to store's city
  IF EXISTS (
    SELECT 1
    FROM _settlement_items_tmp bi
    JOIN public.products p ON p.id = bi.product_id
    WHERE p.city_id IS DISTINCT FROM v_store_city
  ) THEN
    RAISE EXCEPTION '店铺只能结算所属城市商品';
  END IF;

  -- Lock store_inventory rows and validate stock (prevent concurrent oversell)
  FOR v_agg IN
    SELECT bi.product_id, SUM(bi.quantity)::INTEGER AS total_qty
    FROM _settlement_items_tmp bi
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

  -- Calculate totals:
  --   retail_price  = products.price (list price reference)
  --   discount_price = COALESCE(store_product_prices.override_price,
  --                              stores.discount_rate * products.price)
  --   total_retail_amount  = SUM(retail_price * quantity)
  --   total_discount_amount = SUM(discount_price * quantity)
  SELECT
    COALESCE(SUM(p.price * bi.quantity), 0),
    COALESCE(SUM(
      COALESCE(spp.override_price, s.discount_rate * p.price) * bi.quantity
    ), 0)
  INTO v_total_retail, v_total_discount
  FROM _settlement_items_tmp bi
  JOIN public.products p ON p.id = bi.product_id
  JOIN public.stores s ON s.id = p_store_id
  LEFT JOIN public.store_product_prices spp
    ON spp.store_id = p_store_id AND spp.product_id = bi.product_id;

  -- Create order: order_kind = 'settlement', accepted immediately, payment_status = 'paid'
  INSERT INTO public.orders (
    distributor_id,
    city_id,
    store_id,
    request_id,
    order_kind,
    status,
    payment_status,
    total_retail_amount,
    total_discount_amount
  ) VALUES (
    v_user_id,
    v_store_city,
    p_store_id,
    p_request_id,
    'settlement',
    'accepted',
    'paid',
    v_total_retail,
    v_total_discount
  )
  RETURNING id INTO v_order_id;

  -- Create order items:
  --   retail_price  = products.price
  --   discount_price = COALESCE(store override, store discount_rate * product price)
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
    COALESCE(spp.override_price, s.discount_rate * p.price),
    p.cost,
    p.one_time_cost
  FROM _settlement_items_tmp bi
  JOIN public.products p ON p.id = bi.product_id
  JOIN public.stores s ON s.id = p_store_id
  LEFT JOIN public.store_product_prices spp
    ON spp.store_id = p_store_id AND spp.product_id = bi.product_id;

  -- Deduct from store_inventory only (NOT from public.inventory)
  FOR v_agg IN
    SELECT bi.product_id, SUM(bi.quantity)::INTEGER AS total_qty
    FROM _settlement_items_tmp bi
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

GRANT EXECUTE ON FUNCTION public.create_settlement_order_atomic(JSONB, UUID, TEXT) TO authenticated;

-- ============================================================
-- 7. Update delete_order_with_inventory_restore_atomic to handle
--    settlement orders (restore to store_inventory only,
--    since public.inventory was never debited)
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

  -- Fully refunded orders already returned inventory via refund workflow.
  -- Delete only, without another restore, to prevent duplicate rollback.
  IF LOWER(COALESCE(v_order.payment_status::TEXT, '')) = 'refunded' THEN
    DELETE FROM public.orders WHERE id = p_order_id;
    RETURN;
  END IF;

  -- Branch 1: Settlement orders (order_kind = 'settlement')
  -- Only store_inventory was debited, so only restore to store_inventory
  IF COALESCE(v_order.order_kind::TEXT, 'distribution') = 'settlement' THEN
    IF v_order.store_id IS NOT NULL THEN
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
    END IF;

  -- Branch 2: Store retail mobile order (retail + store_id + msr: prefix)
  -- Restore to store_inventory only; public.inventory was never debited
  ELSIF COALESCE(v_order.order_kind::TEXT, 'distribution') = 'retail'
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

  -- Branch 3: Global-source orders (distribution / non-store retail / legacy)
  -- Preserve existing behavior exactly
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

-- ============================================================
-- 8. Schema version gate
-- ============================================================
INSERT INTO public.app_schema_meta (key, value)
VALUES ('schema_version', '5.0.0')
ON CONFLICT (key)
DO UPDATE SET
  value = EXCLUDED.value,
  updated_at = NOW();