-- Migration v8.0: Product Development + Order Date
-- Execute after migrate-v7.5-external-channel-orders.sql
-- Purpose:
-- 1) Create product_developments table (product dev project tracking with stages)
-- 2) Create product_dev_logs table (dev project log entries, cascade on delete)
-- 3) Add order_date to purchase_orders and orders tables
-- 4) Update create_purchase_order_v2 to accept optional p_order_date
-- 5) Update create_settlement_order_atomic to accept optional p_order_date + fix role check
-- 6) Add RLS for product_developments and product_dev_logs
-- 7) Bump schema_version to 8.0.0

-- ============================================================
-- 0. Pre-check
-- ============================================================
DO $$
BEGIN
  IF public.get_app_schema_version() < '7.5.0' THEN
    RAISE EXCEPTION 'Migration v7.5.0 must be applied before v8.0.0';
  END IF;
END $$;

-- ============================================================
-- 1. product_developments table
-- ============================================================
CREATE TABLE IF NOT EXISTS public.product_developments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  description TEXT,
  stage TEXT NOT NULL DEFAULT 'concept'
    CHECK (stage IN ('concept', 'artist_search', 'design_finalize', 'factory_search', 'launched')),
  target_date DATE,
  product_id UUID REFERENCES public.products(id) ON DELETE SET NULL,
  notes TEXT,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

COMMENT ON TABLE public.product_developments IS 'Product development project tracker';
COMMENT ON COLUMN public.product_developments.description IS 'Project description (nullable)';
COMMENT ON COLUMN public.product_developments.stage IS 'Dev stage: concept, artist_search, design_finalize, factory_search, launched';
COMMENT ON COLUMN public.product_developments.target_date IS 'Target launch/completion date (nullable)';
COMMENT ON COLUMN public.product_developments.product_id IS 'Linked product once launched (nullable, set NULL on product delete)';

-- ============================================================
-- 2. product_dev_logs table
--    project_id cascades on delete of the parent development row.
-- ============================================================
CREATE TABLE IF NOT EXISTS public.product_dev_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES public.product_developments(id) ON DELETE CASCADE,
  from_stage TEXT,
  to_stage TEXT,
  notes TEXT,
  target_date DATE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

COMMENT ON TABLE public.product_dev_logs IS 'Product development stage transition logs';
COMMENT ON COLUMN public.product_dev_logs.project_id IS 'FK to product_developments, cascades on delete';
COMMENT ON COLUMN public.product_dev_logs.from_stage IS 'Previous stage before transition (nullable for initial creation)';
COMMENT ON COLUMN public.product_dev_logs.to_stage IS 'New stage after transition (nullable)';

-- ============================================================
-- 3. Indexes
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_product_developments_stage
  ON public.product_developments(stage);

CREATE INDEX IF NOT EXISTS idx_product_developments_target_date
  ON public.product_developments(target_date);

CREATE INDEX IF NOT EXISTS idx_product_dev_logs_project_id
  ON public.product_dev_logs(project_id);

-- ============================================================
-- 4. Enable RLS
-- ============================================================
ALTER TABLE public.product_developments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.product_dev_logs ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- 5. RLS policies for product_developments
--    Admin/super_admin only (SELECT/INSERT/UPDATE/DELETE via role checks).
--    Follows v6.0 foundation RLS style using profiles.role helper functions.
-- ============================================================
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'product_developments'
      AND policyname = 'Admins can manage product developments'
  ) THEN
    CREATE POLICY "Admins can manage product developments" ON public.product_developments
      FOR ALL TO authenticated
      USING (public.is_admin())
      WITH CHECK (public.is_admin());
  END IF;
END $$;

-- ============================================================
-- 6. RLS policies for product_dev_logs
--    Admin/super_admin only (SELECT/INSERT/UPDATE/DELETE via role checks).
-- ============================================================
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'product_dev_logs'
      AND policyname = 'Admins can manage product dev logs'
  ) THEN
    CREATE POLICY "Admins can manage product dev logs" ON public.product_dev_logs
      FOR ALL TO authenticated
      USING (public.is_admin())
      WITH CHECK (public.is_admin());
  END IF;
END $$;

-- ============================================================
-- 7. Add order_date to purchase_orders
--    No column-level DEFAULT; the RPC insert path uses
--    COALESCE(p_order_date, CURRENT_DATE).
-- ============================================================
ALTER TABLE public.purchase_orders
  ADD COLUMN IF NOT EXISTS order_date DATE;

COMMENT ON COLUMN public.purchase_orders.order_date IS 'Order date (defaults to CURRENT_DATE via RPC insert path)';

-- ============================================================
-- 8. Add order_date to orders
--    No column-level DEFAULT; the RPC insert path uses
--    COALESCE(p_order_date, CURRENT_DATE).
-- ============================================================
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS order_date DATE;

COMMENT ON COLUMN public.orders.order_date IS 'Order date (defaults to CURRENT_DATE via RPC insert path)';

-- ============================================================
-- 9. Update create_purchase_order_v2 to accept optional p_order_date
--    Preserves v7.6/v7.7 line_total -> unit_cost snapshot logic.
--    Signature changes (new DATE param), so DROP + CREATE is required.
-- ============================================================
DROP FUNCTION IF EXISTS public.create_purchase_order_v2(UUID, UUID, UUID, JSONB, UUID);

CREATE OR REPLACE FUNCTION public.create_purchase_order_v2(
  p_user_id UUID,
  p_store_id UUID,
  p_city_id UUID,
  p_items JSONB,
  p_supplier_id UUID DEFAULT NULL,
  p_order_date DATE DEFAULT NULL
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
    created_by,
    order_date
  ) VALUES (
    p_store_id,
    p_city_id,
    p_supplier_id,
    'pending',
    p_user_id,
    COALESCE(p_order_date, CURRENT_DATE)
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

GRANT EXECUTE ON FUNCTION public.create_purchase_order_v2(UUID, UUID, UUID, JSONB, UUID, DATE) TO authenticated;

-- ============================================================
-- 10. Update create_settlement_order_atomic
--     - Accept optional p_order_date
--     - Fix role check bug: allow admin/super_admin/finance
--       (v5.0 only allowed 'admin', blocking super_admin and finance)
--     Signature changes (new DATE param), so DROP + CREATE is required.
-- ============================================================
DROP FUNCTION IF EXISTS public.create_settlement_order_atomic(JSONB, UUID, TEXT);

CREATE OR REPLACE FUNCTION public.create_settlement_order_atomic(
  p_items JSONB,
  p_store_id UUID,
  p_request_id TEXT DEFAULT NULL,
  p_order_date DATE DEFAULT NULL
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

  -- Fixed: allow admin, super_admin, and finance (v5.0 only allowed 'admin')
  IF v_role NOT IN ('admin', 'super_admin', 'finance') THEN
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
    total_discount_amount,
    order_date
  ) VALUES (
    v_user_id,
    v_store_city,
    p_store_id,
    p_request_id,
    'settlement',
    'accepted',
    'paid',
    v_total_retail,
    v_total_discount,
    COALESCE(p_order_date, CURRENT_DATE)
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

GRANT EXECUTE ON FUNCTION public.create_settlement_order_atomic(JSONB, UUID, TEXT, DATE) TO authenticated;

-- ============================================================
-- 11. Bump schema_version to 8.0.0
-- ============================================================
INSERT INTO public.app_schema_meta (key, value)
VALUES ('schema_version', '8.0.0')
ON CONFLICT (key)
DO UPDATE SET
  value = EXCLUDED.value,
  updated_at = NOW();
