-- Migration v9.2: physically remove order_items.unit_cost / order_items.one_time_cost
-- Execute after migrate-v9.1-return-order-date-and-store-log-hardening.sql

DO $$
BEGIN
  IF public.get_app_schema_version() < '9.1.0' THEN
    RAISE EXCEPTION 'Migration v9.1.0 must be applied before v9.2.0';
  END IF;
END $$;

-- 1) Batch order RPC: remove order_items cost columns from payload and insert
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
  IF v_user_id IS NULL THEN RAISE EXCEPTION '未登录'; END IF;

  SELECT role, city_id, email, store_name
  INTO v_role, v_user_city, v_user_email, v_user_store
  FROM public.profiles
  WHERE id = v_user_id;

  IF v_role IS NULL THEN RAISE EXCEPTION '用户资料不存在'; END IF;
  IF v_role NOT IN ('admin', 'super_admin', 'distributor') THEN RAISE EXCEPTION '当前角色无下单权限'; END IF;
  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION '购物车为空';
  END IF;

  IF p_request_id IS NOT NULL THEN
    SELECT o.id INTO v_existing_order_id FROM public.orders o WHERE o.request_id = p_request_id LIMIT 1;
    IF v_existing_order_id IS NOT NULL THEN RETURN v_existing_order_id; END IF;
  END IF;

  IF p_store_id IS NOT NULL THEN
    SELECT s.city_id, s.status, s.distributor_id
    INTO v_store_city, v_store_status, v_store_distributor_id
    FROM public.stores s
    WHERE s.id = p_store_id;
    IF NOT FOUND THEN RAISE EXCEPTION '店铺不存在'; END IF;
    IF v_store_status <> 'active' THEN RAISE EXCEPTION '店铺已停用'; END IF;
    IF v_store_distributor_id IS NOT NULL AND v_store_distributor_id IS DISTINCT FROM v_user_id THEN
      RAISE EXCEPTION '店铺不属于当前分销商';
    END IF;
  END IF;

  CREATE TEMP TABLE IF NOT EXISTS _batch_order_items_tmp (
    product_id UUID NOT NULL,
    quantity INTEGER NOT NULL,
    retail_price NUMERIC(10, 2) NOT NULL,
    discount_price NUMERIC(10, 2) NOT NULL,
    is_sample BOOLEAN NOT NULL DEFAULT FALSE
  ) ON COMMIT DROP;

  CREATE TEMP TABLE IF NOT EXISTS _inventory_log_movements_tmp (
    product_id UUID PRIMARY KEY,
    total_qty INTEGER NOT NULL,
    before_quantity INTEGER NOT NULL,
    after_quantity INTEGER NOT NULL
  ) ON COMMIT DROP;

  TRUNCATE TABLE _batch_order_items_tmp;
  TRUNCATE TABLE _inventory_log_movements_tmp;

  INSERT INTO _batch_order_items_tmp (
    product_id, quantity, retail_price, discount_price, is_sample
  )
  SELECT
    x.product_id, x.quantity, x.retail_price, x.discount_price, COALESCE(x.is_sample, FALSE)
  FROM jsonb_to_recordset(p_items) AS x(
    product_id UUID,
    quantity INTEGER,
    retail_price NUMERIC(10, 2),
    discount_price NUMERIC(10, 2),
    is_sample BOOLEAN
  );

  IF NOT EXISTS (SELECT 1 FROM _batch_order_items_tmp) THEN RAISE EXCEPTION '购物车为空'; END IF;
  IF EXISTS (SELECT 1 FROM _batch_order_items_tmp WHERE quantity <= 0) THEN RAISE EXCEPTION '订单数量必须大于0'; END IF;

  IF v_role = 'distributor' AND EXISTS (
    SELECT 1 FROM _batch_order_items_tmp WHERE NOT is_sample AND quantity < 30
  ) THEN
    RAISE EXCEPTION '分销订单非样品数量必须大于等于30';
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
    IF v_user_city IS NULL THEN RAISE EXCEPTION '分销商未绑定城市'; END IF;
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
    SELECT i.quantity INTO v_stock
    FROM public.inventory i
    WHERE i.product_id = v_agg.product_id
    FOR UPDATE;

    IF v_stock IS NULL THEN RAISE EXCEPTION '库存记录不存在'; END IF;
    IF v_stock < v_agg.total_qty THEN RAISE EXCEPTION '库存不足'; END IF;
  END LOOP;

  INSERT INTO _inventory_log_movements_tmp (product_id, total_qty, before_quantity, after_quantity)
  SELECT
    bi.product_id,
    SUM(bi.quantity)::INTEGER,
    i.quantity,
    i.quantity - SUM(bi.quantity)::INTEGER
  FROM _batch_order_items_tmp bi
  JOIN public.inventory i ON i.product_id = bi.product_id
  GROUP BY bi.product_id, i.quantity;

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
    ) INTO v_order_city;
  END IF;

  INSERT INTO public.orders (
    distributor_id, city_id, store_id, request_id, total_retail_amount, total_discount_amount
  ) VALUES (
    v_user_id, v_order_city, p_store_id, p_request_id, v_total_retail, v_total_discount
  ) RETURNING id INTO v_order_id;

  INSERT INTO public.order_items (
    order_id, product_id, quantity, retail_price, discount_price, is_sample
  )
  SELECT
    v_order_id,
    bi.product_id,
    bi.quantity,
    CASE WHEN bi.is_sample THEN 0 ELSE bi.retail_price END,
    CASE WHEN bi.is_sample THEN 0 ELSE bi.discount_price END,
    bi.is_sample
  FROM _batch_order_items_tmp bi;

  UPDATE public.inventory i
  SET quantity = m.after_quantity, updated_at = NOW()
  FROM _inventory_log_movements_tmp m
  WHERE i.product_id = m.product_id;

  INSERT INTO public.inventory_logs (
    product_id, operator_id, action, delta_quantity, before_quantity, after_quantity, note
  )
  SELECT
    m.product_id,
    v_user_id,
    'outbound',
    -m.total_qty,
    m.before_quantity,
    m.after_quantity,
    FORMAT('供货/分销出库；order_id=%s；store_id=%s；request_id=%s；inventory_pool=inventory', v_order_id, p_store_id, p_request_id)
  FROM _inventory_log_movements_tmp m;

  IF p_store_id IS NOT NULL THEN
    INSERT INTO public.store_inventory (store_id, product_id, quantity, updated_at)
    SELECT p_store_id, bi.product_id, SUM(bi.quantity)::INTEGER, NOW()
    FROM _batch_order_items_tmp bi
    WHERE NOT bi.is_sample
    GROUP BY bi.product_id
    ON CONFLICT (store_id, product_id)
    DO UPDATE SET quantity = public.store_inventory.quantity + EXCLUDED.quantity, updated_at = NOW();
  END IF;

  INSERT INTO public.notifications (user_id, type, order_id, message)
  SELECT p.id, 'new_order', v_order_id, format('新订单 #%s 来自 %s', LEFT(v_order_id::text, 8), COALESCE(v_user_store, v_user_email, '未知用户'))
  FROM public.profiles p
  WHERE p.role = 'admin';

  RETURN v_order_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_batch_order_atomic(JSONB, TEXT, UUID) TO authenticated;

-- 2) Retail order RPC (web cashier): remove order_items cost columns
CREATE OR REPLACE FUNCTION public.create_retail_order_atomic(
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
  v_order_id UUID;
  v_total_retail NUMERIC(10, 2) := 0;
  v_order_city UUID;
  v_agg RECORD;
  v_stock INTEGER;
  v_existing_order_id UUID;
  v_store_status TEXT;
  v_effective_store_id UUID;
BEGIN
  IF v_user_id IS NULL THEN RAISE EXCEPTION '未登录'; END IF;

  SELECT role, city_id INTO v_role, v_user_city FROM public.profiles WHERE id = v_user_id;
  IF v_role IS NULL THEN RAISE EXCEPTION '用户资料不存在'; END IF;
  IF v_role NOT IN ('admin', 'super_admin', 'inventory_manager') THEN RAISE EXCEPTION '当前角色无收款建单权限'; END IF;
  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) = 0 THEN RAISE EXCEPTION '购物车为空'; END IF;

  IF p_request_id IS NOT NULL THEN
    SELECT o.id INTO v_existing_order_id FROM public.orders o WHERE o.request_id = p_request_id LIMIT 1;
    IF v_existing_order_id IS NOT NULL THEN RETURN v_existing_order_id; END IF;
  END IF;

  IF p_store_id IS NULL THEN
    SELECT (ARRAY_AGG(s.id ORDER BY CASE WHEN s.status = 'active' THEN 0 ELSE 1 END, s.created_at, s.id::text))[1]::uuid
    INTO v_effective_store_id
    FROM public.stores s
    WHERE s.name = '云窗';
    IF v_effective_store_id IS NULL THEN RAISE EXCEPTION '默认零售店铺不存在'; END IF;
  ELSE
    v_effective_store_id := p_store_id;
  END IF;

  SELECT s.status INTO v_store_status FROM public.stores s WHERE s.id = v_effective_store_id;
  IF NOT FOUND THEN RAISE EXCEPTION '店铺不存在'; END IF;
  IF v_store_status <> 'active' THEN RAISE EXCEPTION '店铺已停用'; END IF;

  CREATE TEMP TABLE IF NOT EXISTS _retail_order_items_tmp (
    product_id UUID NOT NULL,
    quantity INTEGER NOT NULL,
    retail_price NUMERIC(10, 2) NOT NULL
  ) ON COMMIT DROP;

  CREATE TEMP TABLE IF NOT EXISTS _inventory_log_movements_tmp (
    product_id UUID PRIMARY KEY,
    total_qty INTEGER NOT NULL,
    before_quantity INTEGER NOT NULL,
    after_quantity INTEGER NOT NULL
  ) ON COMMIT DROP;

  TRUNCATE TABLE _retail_order_items_tmp;
  TRUNCATE TABLE _inventory_log_movements_tmp;

  INSERT INTO _retail_order_items_tmp (product_id, quantity, retail_price)
  SELECT x.product_id, x.quantity, x.retail_price
  FROM jsonb_to_recordset(p_items) AS x(
    product_id UUID,
    quantity INTEGER,
    retail_price NUMERIC(10, 2)
  );

  IF NOT EXISTS (SELECT 1 FROM _retail_order_items_tmp) THEN RAISE EXCEPTION '购物车为空'; END IF;
  IF EXISTS (SELECT 1 FROM _retail_order_items_tmp WHERE quantity <= 0) THEN RAISE EXCEPTION '订单数量必须大于0'; END IF;

  IF EXISTS (
    SELECT 1
    FROM _retail_order_items_tmp bi
    LEFT JOIN public.products p ON p.id = bi.product_id
    WHERE p.id IS NULL
  ) THEN RAISE EXCEPTION '商品不存在'; END IF;

  FOR v_agg IN
    SELECT bi.product_id, SUM(bi.quantity)::INTEGER AS total_qty
    FROM _retail_order_items_tmp bi
    GROUP BY bi.product_id
    ORDER BY bi.product_id
  LOOP
    SELECT i.quantity INTO v_stock
    FROM public.inventory i
    WHERE i.product_id = v_agg.product_id
    FOR UPDATE;
    IF v_stock IS NULL THEN RAISE EXCEPTION '库存记录不存在'; END IF;
    IF v_stock < v_agg.total_qty THEN RAISE EXCEPTION '库存不足'; END IF;
  END LOOP;

  INSERT INTO _inventory_log_movements_tmp (product_id, total_qty, before_quantity, after_quantity)
  SELECT bi.product_id, SUM(bi.quantity)::INTEGER, i.quantity, i.quantity - SUM(bi.quantity)::INTEGER
  FROM _retail_order_items_tmp bi
  JOIN public.inventory i ON i.product_id = bi.product_id
  GROUP BY bi.product_id, i.quantity;

  SELECT COALESCE(SUM(bi.retail_price * bi.quantity), 0)
  INTO v_total_retail
  FROM _retail_order_items_tmp bi;

  SELECT COALESCE(
    v_user_city,
    (SELECT p.city_id FROM _retail_order_items_tmp bi JOIN public.products p ON p.id = bi.product_id LIMIT 1)
  ) INTO v_order_city;

  INSERT INTO public.orders (
    distributor_id, city_id, request_id, store_id, order_kind, status, total_retail_amount, total_discount_amount
  ) VALUES (
    v_user_id, v_order_city, p_request_id, v_effective_store_id, 'retail', 'accepted', v_total_retail, v_total_retail
  ) RETURNING id INTO v_order_id;

  INSERT INTO public.order_items (
    order_id, product_id, quantity, retail_price, discount_price
  )
  SELECT v_order_id, bi.product_id, bi.quantity, bi.retail_price, bi.retail_price
  FROM _retail_order_items_tmp bi;

  UPDATE public.inventory i
  SET quantity = m.after_quantity, updated_at = NOW()
  FROM _inventory_log_movements_tmp m
  WHERE i.product_id = m.product_id;

  INSERT INTO public.inventory_logs (
    product_id, operator_id, action, delta_quantity, before_quantity, after_quantity, note
  )
  SELECT
    m.product_id,
    v_user_id,
    'sell',
    -m.total_qty,
    m.before_quantity,
    m.after_quantity,
    FORMAT('零售收款售出；order_id=%s；store_id=%s；request_id=%s；inventory_pool=inventory', v_order_id, v_effective_store_id, p_request_id)
  FROM _inventory_log_movements_tmp m;

  RETURN v_order_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_retail_order_atomic(JSONB, TEXT, UUID) TO authenticated;

-- 3) Store retail (mobile msr) RPC: remove order_items cost columns
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
  IF v_user_id IS NULL THEN RAISE EXCEPTION '未登录'; END IF;
  SELECT role INTO v_role FROM public.profiles WHERE id = v_user_id;
  IF v_role IS NULL THEN RAISE EXCEPTION '用户资料不存在'; END IF;
  IF v_role NOT IN ('admin', 'super_admin') THEN RAISE EXCEPTION '当前角色无店铺零售建单权限'; END IF;
  IF p_store_id IS NULL THEN RAISE EXCEPTION '店铺ID不能为空'; END IF;
  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) = 0 THEN RAISE EXCEPTION '购物车为空'; END IF;

  IF p_request_id IS NOT NULL THEN
    IF p_request_id LIKE 'msr:%' THEN
      v_effective_request_id := p_request_id;
    ELSE
      v_effective_request_id := 'msr:' || p_request_id;
    END IF;
  ELSE
    v_effective_request_id := 'msr:' || gen_random_uuid()::text;
  END IF;

  SELECT o.id INTO v_existing_order_id FROM public.orders o WHERE o.request_id = v_effective_request_id LIMIT 1;
  IF v_existing_order_id IS NOT NULL THEN RETURN v_existing_order_id; END IF;

  SELECT s.city_id, s.status INTO v_store_city, v_store_status FROM public.stores s WHERE s.id = p_store_id;
  IF NOT FOUND THEN RAISE EXCEPTION '店铺不存在'; END IF;
  IF v_store_status <> 'active' THEN RAISE EXCEPTION '店铺已停用'; END IF;

  CREATE TEMP TABLE IF NOT EXISTS _store_retail_items_tmp (
    product_id UUID NOT NULL,
    quantity INTEGER NOT NULL
  ) ON COMMIT DROP;

  CREATE TEMP TABLE IF NOT EXISTS _store_retail_log_movements_tmp (
    product_id UUID PRIMARY KEY,
    total_qty INTEGER NOT NULL,
    before_quantity INTEGER NOT NULL,
    after_quantity INTEGER NOT NULL
  ) ON COMMIT DROP;

  TRUNCATE TABLE _store_retail_items_tmp;
  TRUNCATE TABLE _store_retail_log_movements_tmp;

  INSERT INTO _store_retail_items_tmp (product_id, quantity)
  SELECT x.product_id, x.quantity
  FROM jsonb_to_recordset(p_items) AS x(product_id UUID, quantity INTEGER);

  IF NOT EXISTS (SELECT 1 FROM _store_retail_items_tmp) THEN RAISE EXCEPTION '购物车为空'; END IF;
  IF EXISTS (SELECT 1 FROM _store_retail_items_tmp WHERE quantity <= 0) THEN RAISE EXCEPTION '订单数量必须大于0'; END IF;

  IF EXISTS (
    SELECT 1
    FROM _store_retail_items_tmp bi
    LEFT JOIN public.products p ON p.id = bi.product_id
    WHERE p.id IS NULL
  ) THEN RAISE EXCEPTION '商品不存在'; END IF;

  IF EXISTS (
    SELECT 1
    FROM _store_retail_items_tmp bi
    JOIN public.products p ON p.id = bi.product_id
    WHERE p.city_id IS DISTINCT FROM v_store_city
  ) THEN RAISE EXCEPTION '店铺只能接收所属城市商品'; END IF;

  FOR v_agg IN
    SELECT bi.product_id, SUM(bi.quantity)::INTEGER AS total_qty
    FROM _store_retail_items_tmp bi
    GROUP BY bi.product_id
    ORDER BY bi.product_id
  LOOP
    SELECT si.quantity INTO v_store_stock
    FROM public.store_inventory si
    WHERE si.store_id = p_store_id AND si.product_id = v_agg.product_id
    FOR UPDATE;

    IF v_store_stock IS NULL THEN RAISE EXCEPTION '店铺库存记录不存在'; END IF;
    IF v_store_stock < v_agg.total_qty THEN RAISE EXCEPTION '店铺库存不足'; END IF;

    INSERT INTO _store_retail_log_movements_tmp (product_id, total_qty, before_quantity, after_quantity)
    VALUES (v_agg.product_id, v_agg.total_qty, v_store_stock, v_store_stock - v_agg.total_qty)
    ON CONFLICT (product_id)
    DO UPDATE SET total_qty = EXCLUDED.total_qty, before_quantity = EXCLUDED.before_quantity, after_quantity = EXCLUDED.after_quantity;
  END LOOP;

  SELECT COALESCE(SUM(p.price * bi.quantity), 0)
  INTO v_total_retail
  FROM _store_retail_items_tmp bi
  JOIN public.products p ON p.id = bi.product_id;

  INSERT INTO public.orders (
    distributor_id, city_id, store_id, request_id, order_kind, status, total_retail_amount, total_discount_amount
  ) VALUES (
    v_user_id, v_store_city, p_store_id, v_effective_request_id, 'retail', 'accepted', v_total_retail, v_total_retail
  ) RETURNING id INTO v_order_id;

  INSERT INTO public.order_items (
    order_id, product_id, quantity, retail_price, discount_price
  )
  SELECT
    v_order_id,
    bi.product_id,
    bi.quantity,
    p.price,
    p.price
  FROM _store_retail_items_tmp bi
  JOIN public.products p ON p.id = bi.product_id;

  UPDATE public.store_inventory si
  SET quantity = m.after_quantity, updated_at = NOW()
  FROM _store_retail_log_movements_tmp m
  WHERE si.store_id = p_store_id AND si.product_id = m.product_id;

  INSERT INTO public.inventory_logs (
    product_id, operator_id, action, delta_quantity, before_quantity, after_quantity, note
  )
  SELECT
    m.product_id,
    v_user_id,
    'sell',
    -m.total_qty,
    m.before_quantity,
    m.after_quantity,
    '店铺零售售出'
  FROM _store_retail_log_movements_tmp m;

  RETURN v_order_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_store_retail_order_atomic(JSONB, UUID, TEXT) TO authenticated;

-- 4) Barcode outbound RPC: remove order_items cost columns
CREATE OR REPLACE FUNCTION public.outbound_stock_atomic(
  p_barcode TEXT,
  p_quantity INTEGER,
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
  v_user_city UUID;
  v_product_id UUID;
  v_product_city UUID;
  v_current_qty INTEGER;
  v_after_qty INTEGER;
  v_retail_price NUMERIC(10, 2);
  v_order_id UUID;
  v_existing_order_id UUID;
BEGIN
  IF v_user_id IS NULL THEN RAISE EXCEPTION '未登录'; END IF;
  IF p_quantity IS NULL OR p_quantity <= 0 THEN RAISE EXCEPTION '出库数量必须大于0'; END IF;

  IF p_request_id IS NOT NULL THEN
    SELECT o.id INTO v_existing_order_id FROM public.orders o WHERE o.request_id = p_request_id LIMIT 1;
    IF v_existing_order_id IS NOT NULL THEN RETURN v_existing_order_id; END IF;
  END IF;

  SELECT role, city_id INTO v_role, v_user_city FROM public.profiles WHERE id = v_user_id;
  IF v_role IS NULL THEN RAISE EXCEPTION '用户资料不存在'; END IF;
  IF v_role NOT IN ('admin', 'inventory_manager') THEN RAISE EXCEPTION '当前角色无出库权限'; END IF;

  SELECT p.id, p.city_id, i.quantity, p.price
  INTO v_product_id, v_product_city, v_current_qty, v_retail_price
  FROM public.products p
  JOIN public.inventory i ON i.product_id = p.id
  WHERE p.barcode = p_barcode
  FOR UPDATE OF i;

  IF v_product_id IS NULL THEN RAISE EXCEPTION '未找到对应条码商品'; END IF;
  IF v_current_qty < p_quantity THEN RAISE EXCEPTION '库存不足'; END IF;

  v_after_qty := v_current_qty - p_quantity;

  INSERT INTO public.orders (
    distributor_id, city_id, request_id, total_retail_amount, total_discount_amount
  ) VALUES (
    v_user_id, COALESCE(v_user_city, v_product_city), p_request_id, v_retail_price * p_quantity, v_retail_price * p_quantity
  ) RETURNING id INTO v_order_id;

  INSERT INTO public.order_items (
    order_id, product_id, quantity, retail_price, discount_price
  ) VALUES (
    v_order_id, v_product_id, p_quantity, v_retail_price, v_retail_price
  );

  UPDATE public.inventory
  SET quantity = v_after_qty, updated_at = NOW()
  WHERE product_id = v_product_id;

  INSERT INTO public.inventory_logs (
    product_id, operator_id, action, delta_quantity, before_quantity, after_quantity, note
  ) VALUES (
    v_product_id,
    v_user_id,
    'outbound',
    -p_quantity,
    v_current_qty,
    v_after_qty,
    FORMAT('扫码出库；order_id=%s；barcode=%s；request_id=%s；inventory_pool=inventory', v_order_id, p_barcode, p_request_id)
  );

  RETURN v_order_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.outbound_stock_atomic(TEXT, INTEGER, TEXT) TO authenticated;

-- 5) External channel create RPC: remove order_items cost columns
CREATE OR REPLACE FUNCTION public.create_external_order_atomic(
  p_items JSONB,
  p_external_channel TEXT,
  p_external_order_no TEXT,
  p_store_id UUID DEFAULT NULL,
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
  v_store_city UUID;
  v_store_status TEXT;
  v_external_channel TEXT := NULLIF(BTRIM(p_external_channel), '');
  v_external_order_no TEXT := NULLIF(BTRIM(p_external_order_no), '');
  v_total_retail NUMERIC(10, 2) := 0;
  v_total_discount NUMERIC(10, 2) := 0;
  v_existing_order_id UUID;
  v_effective_store_id UUID;
BEGIN
  IF v_user_id IS NULL THEN RAISE EXCEPTION '未登录'; END IF;
  SELECT role INTO v_role FROM public.profiles WHERE id = v_user_id;
  IF v_role IS NULL THEN RAISE EXCEPTION '用户资料不存在'; END IF;
  IF v_role NOT IN ('admin', 'super_admin', 'inventory_manager') THEN RAISE EXCEPTION '当前角色无外部渠道建单权限'; END IF;
  IF v_external_channel IS NULL THEN RAISE EXCEPTION '外部渠道不能为空'; END IF;
  IF v_external_order_no IS NULL THEN RAISE EXCEPTION '外部订单号不能为空'; END IF;
  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) = 0 THEN RAISE EXCEPTION '外部渠道订单商品不能为空'; END IF;

  IF p_request_id IS NOT NULL THEN
    SELECT o.id INTO v_existing_order_id FROM public.orders o WHERE o.request_id = p_request_id LIMIT 1;
    IF v_existing_order_id IS NOT NULL THEN RETURN v_existing_order_id; END IF;
  END IF;

  SELECT o.id INTO v_existing_order_id FROM public.orders o WHERE o.external_order_no = v_external_order_no LIMIT 1;
  IF v_existing_order_id IS NOT NULL THEN RAISE EXCEPTION '外部渠道订单号已存在'; END IF;

  IF p_store_id IS NULL THEN
    SELECT (ARRAY_AGG(s.id ORDER BY CASE WHEN s.status = 'active' THEN 0 ELSE 1 END, s.created_at, s.id::text))[1]::uuid
    INTO v_effective_store_id
    FROM public.stores s
    WHERE s.name = '云窗';
    IF v_effective_store_id IS NULL THEN RAISE EXCEPTION '默认外部渠道店铺不存在'; END IF;
  ELSE
    v_effective_store_id := p_store_id;
  END IF;

  SELECT s.city_id, s.status INTO v_store_city, v_store_status FROM public.stores s WHERE s.id = v_effective_store_id;
  IF NOT FOUND THEN RAISE EXCEPTION '店铺不存在'; END IF;
  IF v_store_status <> 'active' THEN RAISE EXCEPTION '店铺已停用'; END IF;

  CREATE TEMP TABLE IF NOT EXISTS _external_order_items_tmp (
    product_id UUID NOT NULL,
    quantity INTEGER NOT NULL,
    retail_price NUMERIC(10, 2),
    discount_price NUMERIC(10, 2)
  ) ON COMMIT DROP;

  TRUNCATE TABLE _external_order_items_tmp;

  INSERT INTO _external_order_items_tmp (product_id, quantity, retail_price, discount_price)
  SELECT x.product_id, x.quantity, x.retail_price, x.discount_price
  FROM jsonb_to_recordset(p_items) AS x(
    product_id UUID,
    quantity INTEGER,
    retail_price NUMERIC(10, 2),
    discount_price NUMERIC(10, 2)
  );

  IF NOT EXISTS (SELECT 1 FROM _external_order_items_tmp) THEN RAISE EXCEPTION '外部渠道订单商品不能为空'; END IF;
  IF EXISTS (SELECT 1 FROM _external_order_items_tmp WHERE quantity <= 0) THEN RAISE EXCEPTION '外部渠道订单数量必须大于0'; END IF;

  IF EXISTS (
    SELECT 1 FROM _external_order_items_tmp ei
    LEFT JOIN public.products p ON p.id = ei.product_id
    WHERE p.id IS NULL
  ) THEN RAISE EXCEPTION '商品不存在'; END IF;

  IF EXISTS (
    SELECT 1
    FROM _external_order_items_tmp ei
    JOIN public.products p ON p.id = ei.product_id
    WHERE p.city_id IS DISTINCT FROM v_store_city
  ) THEN RAISE EXCEPTION '店铺只能销售所属城市商品'; END IF;

  SELECT
    COALESCE(SUM(COALESCE(ei.retail_price, p.price) * ei.quantity), 0),
    COALESCE(SUM(COALESCE(ei.discount_price, ei.retail_price, p.price) * ei.quantity), 0)
  INTO v_total_retail, v_total_discount
  FROM _external_order_items_tmp ei
  JOIN public.products p ON p.id = ei.product_id;

  INSERT INTO public.orders (
    distributor_id, city_id, store_id, request_id, order_kind, status, payment_status, external_channel, external_order_no, total_retail_amount, total_discount_amount
  ) VALUES (
    v_user_id, v_store_city, v_effective_store_id, p_request_id, 'external', 'pending', 'unpaid', v_external_channel, v_external_order_no, v_total_retail, v_total_discount
  ) RETURNING id INTO v_order_id;

  INSERT INTO public.order_items (
    order_id, product_id, quantity, retail_price, discount_price
  )
  SELECT
    v_order_id,
    ei.product_id,
    ei.quantity,
    COALESCE(ei.retail_price, p.price),
    COALESCE(ei.discount_price, ei.retail_price, p.price)
  FROM _external_order_items_tmp ei
  JOIN public.products p ON p.id = ei.product_id;

  RETURN v_order_id;
EXCEPTION
  WHEN unique_violation THEN
    RAISE EXCEPTION '外部渠道订单号已存在';
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_external_order_atomic(JSONB, TEXT, TEXT, UUID, TEXT) TO authenticated;

-- 6) Settlement create/edit RPCs: remove order_items cost columns
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
  IF v_user_id IS NULL THEN RAISE EXCEPTION '未登录'; END IF;
  SELECT role INTO v_role FROM public.profiles WHERE id = v_user_id;
  IF v_role IS NULL THEN RAISE EXCEPTION '用户资料不存在'; END IF;
  IF v_role NOT IN ('admin', 'super_admin', 'finance') THEN RAISE EXCEPTION '当前角色无结算建单权限'; END IF;
  IF p_store_id IS NULL THEN RAISE EXCEPTION '店铺ID不能为空'; END IF;
  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) = 0 THEN RAISE EXCEPTION '结算项不能为空'; END IF;

  IF p_request_id IS NOT NULL THEN
    SELECT o.id INTO v_existing_order_id FROM public.orders o WHERE o.request_id = p_request_id LIMIT 1;
    IF v_existing_order_id IS NOT NULL THEN RETURN v_existing_order_id; END IF;
  END IF;

  SELECT s.city_id, s.status INTO v_store_city, v_store_status FROM public.stores s WHERE s.id = p_store_id;
  IF NOT FOUND THEN RAISE EXCEPTION '店铺不存在'; END IF;
  IF v_store_status <> 'active' THEN RAISE EXCEPTION '店铺已停用'; END IF;

  CREATE TEMP TABLE IF NOT EXISTS _settlement_items_tmp (
    product_id UUID NOT NULL,
    quantity INTEGER NOT NULL
  ) ON COMMIT DROP;
  CREATE TEMP TABLE IF NOT EXISTS _settlement_create_movements_tmp (
    product_id UUID PRIMARY KEY,
    total_qty INTEGER NOT NULL,
    before_quantity INTEGER NOT NULL,
    after_quantity INTEGER NOT NULL
  ) ON COMMIT DROP;

  TRUNCATE TABLE _settlement_items_tmp;
  TRUNCATE TABLE _settlement_create_movements_tmp;

  INSERT INTO _settlement_items_tmp (product_id, quantity)
  SELECT x.product_id, x.quantity
  FROM jsonb_to_recordset(p_items) AS x(product_id UUID, quantity INTEGER);

  IF NOT EXISTS (SELECT 1 FROM _settlement_items_tmp) THEN RAISE EXCEPTION '结算项不能为空'; END IF;
  IF EXISTS (SELECT 1 FROM _settlement_items_tmp WHERE quantity <= 0) THEN RAISE EXCEPTION '结算数量必须大于0'; END IF;

  IF EXISTS (
    SELECT 1
    FROM _settlement_items_tmp bi
    LEFT JOIN public.products p ON p.id = bi.product_id
    WHERE p.id IS NULL
  ) THEN RAISE EXCEPTION '商品不存在'; END IF;

  IF EXISTS (
    SELECT 1
    FROM _settlement_items_tmp bi
    JOIN public.products p ON p.id = bi.product_id
    WHERE p.city_id IS DISTINCT FROM v_store_city
  ) THEN RAISE EXCEPTION '店铺只能结算所属城市商品'; END IF;

  FOR v_agg IN
    SELECT bi.product_id, SUM(bi.quantity)::INTEGER AS total_qty
    FROM _settlement_items_tmp bi
    GROUP BY bi.product_id
    ORDER BY bi.product_id
  LOOP
    SELECT si.quantity INTO v_store_stock
    FROM public.store_inventory si
    WHERE si.store_id = p_store_id AND si.product_id = v_agg.product_id
    FOR UPDATE;

    IF v_store_stock IS NULL THEN RAISE EXCEPTION '店铺库存记录不存在'; END IF;
    IF v_store_stock < v_agg.total_qty THEN RAISE EXCEPTION '店铺库存不足'; END IF;

    INSERT INTO _settlement_create_movements_tmp (product_id, total_qty, before_quantity, after_quantity)
    VALUES (v_agg.product_id, v_agg.total_qty, v_store_stock, v_store_stock - v_agg.total_qty);
  END LOOP;

  SELECT
    COALESCE(SUM(p.price * bi.quantity), 0),
    COALESCE(SUM(COALESCE(spp.override_price, s.discount_rate * p.price) * bi.quantity), 0)
  INTO v_total_retail, v_total_discount
  FROM _settlement_items_tmp bi
  JOIN public.products p ON p.id = bi.product_id
  JOIN public.stores s ON s.id = p_store_id
  LEFT JOIN public.store_product_prices spp
    ON spp.store_id = p_store_id AND spp.product_id = bi.product_id;

  INSERT INTO public.orders (
    distributor_id, city_id, store_id, request_id, order_kind, status, payment_status, total_retail_amount, total_discount_amount, order_date
  ) VALUES (
    v_user_id, v_store_city, p_store_id, p_request_id, 'settlement', 'pending', 'pending', v_total_retail, v_total_discount, COALESCE(p_order_date, CURRENT_DATE)
  ) RETURNING id INTO v_order_id;

  INSERT INTO public.order_items (
    order_id, product_id, quantity, retail_price, discount_price
  )
  SELECT
    v_order_id,
    bi.product_id,
    bi.quantity,
    p.price,
    COALESCE(spp.override_price, s.discount_rate * p.price)
  FROM _settlement_items_tmp bi
  JOIN public.products p ON p.id = bi.product_id
  JOIN public.stores s ON s.id = p_store_id
  LEFT JOIN public.store_product_prices spp
    ON spp.store_id = p_store_id AND spp.product_id = bi.product_id;

  UPDATE public.store_inventory si
  SET quantity = m.after_quantity, updated_at = NOW()
  FROM _settlement_create_movements_tmp m
  WHERE si.store_id = p_store_id AND si.product_id = m.product_id;

  INSERT INTO public.inventory_logs (
    product_id, operator_id, store_id, action, delta_quantity, before_quantity, after_quantity, note
  )
  SELECT
    m.product_id,
    v_user_id,
    p_store_id,
    'settlement_create',
    -m.total_qty,
    m.before_quantity,
    m.after_quantity,
    FORMAT('结算建单扣减；order_id=%s；store_id=%s', v_order_id, p_store_id)
  FROM _settlement_create_movements_tmp m;

  RETURN v_order_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_settlement_order_atomic(JSONB, UUID, TEXT, DATE) TO authenticated;

CREATE OR REPLACE FUNCTION public.edit_settlement_order_atomic(
  p_order_id UUID,
  p_items JSONB
)
RETURNS public.orders
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor_id UUID := auth.uid();
  v_actor_role TEXT;
  v_order public.orders%ROWTYPE;
  v_store_city UUID;
  v_store_status TEXT;
  v_total_retail NUMERIC(10, 2) := 0;
  v_total_discount NUMERIC(10, 2) := 0;
  v_agg RECORD;
  v_store_stock INTEGER;
BEGIN
  IF v_actor_id IS NULL THEN RAISE EXCEPTION '未登录'; END IF;
  SELECT role INTO v_actor_role FROM public.profiles WHERE id = v_actor_id;
  IF v_actor_role IS NULL THEN RAISE EXCEPTION '用户资料不存在'; END IF;
  IF v_actor_role NOT IN ('admin', 'super_admin', 'finance') THEN RAISE EXCEPTION '当前角色无修改结算单权限'; END IF;
  IF p_order_id IS NULL THEN RAISE EXCEPTION '订单ID不能为空'; END IF;
  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) = 0 THEN RAISE EXCEPTION '结算项不能为空'; END IF;

  SELECT * INTO v_order FROM public.orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION '订单不存在'; END IF;
  IF COALESCE(v_order.order_kind::TEXT, 'distribution') <> 'settlement' THEN RAISE EXCEPTION '不是结算单'; END IF;
  IF v_order.confirmed_at IS NOT NULL OR v_order.status <> 'pending' OR COALESCE(v_order.payment_status, 'pending') <> 'pending' THEN
    RAISE EXCEPTION '结算单已确认，不能修改';
  END IF;
  IF v_order.store_id IS NULL THEN RAISE EXCEPTION '结算单未绑定店铺'; END IF;

  SELECT s.city_id, s.status INTO v_store_city, v_store_status FROM public.stores s WHERE s.id = v_order.store_id;
  IF NOT FOUND THEN RAISE EXCEPTION '店铺不存在'; END IF;
  IF v_store_status <> 'active' THEN RAISE EXCEPTION '店铺已停用'; END IF;

  CREATE TEMP TABLE IF NOT EXISTS _settlement_edit_input_tmp (
    product_id UUID NOT NULL,
    quantity INTEGER NOT NULL
  ) ON COMMIT DROP;
  CREATE TEMP TABLE IF NOT EXISTS _settlement_edit_new_tmp (
    product_id UUID PRIMARY KEY,
    new_qty INTEGER NOT NULL
  ) ON COMMIT DROP;
  CREATE TEMP TABLE IF NOT EXISTS _settlement_edit_old_tmp (
    product_id UUID PRIMARY KEY,
    old_qty INTEGER NOT NULL
  ) ON COMMIT DROP;
  CREATE TEMP TABLE IF NOT EXISTS _settlement_edit_delta_tmp (
    product_id UUID PRIMARY KEY,
    old_qty INTEGER NOT NULL,
    new_qty INTEGER NOT NULL,
    inventory_delta INTEGER NOT NULL,
    before_quantity INTEGER NOT NULL DEFAULT 0,
    after_quantity INTEGER NOT NULL DEFAULT 0
  ) ON COMMIT DROP;

  TRUNCATE TABLE _settlement_edit_input_tmp;
  TRUNCATE TABLE _settlement_edit_new_tmp;
  TRUNCATE TABLE _settlement_edit_old_tmp;
  TRUNCATE TABLE _settlement_edit_delta_tmp;

  INSERT INTO _settlement_edit_input_tmp (product_id, quantity)
  SELECT x.product_id, x.quantity
  FROM jsonb_to_recordset(p_items) AS x(product_id UUID, quantity INTEGER);

  IF NOT EXISTS (SELECT 1 FROM _settlement_edit_input_tmp) THEN RAISE EXCEPTION '结算项不能为空'; END IF;
  IF EXISTS (SELECT 1 FROM _settlement_edit_input_tmp WHERE quantity <= 0) THEN RAISE EXCEPTION '结算数量必须大于0'; END IF;

  INSERT INTO _settlement_edit_new_tmp (product_id, new_qty)
  SELECT product_id, SUM(quantity)::INTEGER FROM _settlement_edit_input_tmp GROUP BY product_id;

  INSERT INTO _settlement_edit_old_tmp (product_id, old_qty)
  SELECT product_id, COALESCE(SUM(quantity), 0)::INTEGER
  FROM public.order_items
  WHERE order_id = p_order_id
  GROUP BY product_id;

  IF EXISTS (
    SELECT 1
    FROM _settlement_edit_new_tmp ni
    LEFT JOIN public.products p ON p.id = ni.product_id
    WHERE p.id IS NULL
  ) THEN RAISE EXCEPTION '商品不存在'; END IF;

  IF EXISTS (
    SELECT 1
    FROM _settlement_edit_new_tmp ni
    JOIN public.products p ON p.id = ni.product_id
    WHERE p.city_id IS DISTINCT FROM v_store_city
  ) THEN RAISE EXCEPTION '店铺只能结算所属城市商品'; END IF;

  INSERT INTO _settlement_edit_delta_tmp (product_id, old_qty, new_qty, inventory_delta)
  SELECT
    COALESCE(o.product_id, n.product_id),
    COALESCE(o.old_qty, 0),
    COALESCE(n.new_qty, 0),
    COALESCE(o.old_qty, 0) - COALESCE(n.new_qty, 0)
  FROM _settlement_edit_old_tmp o
  FULL OUTER JOIN _settlement_edit_new_tmp n ON n.product_id = o.product_id
  WHERE COALESCE(o.old_qty, 0) <> COALESCE(n.new_qty, 0);

  INSERT INTO public.store_inventory (store_id, product_id, quantity, updated_at)
  SELECT v_order.store_id, d.product_id, 0, NOW()
  FROM _settlement_edit_delta_tmp d
  ON CONFLICT (store_id, product_id) DO NOTHING;

  FOR v_agg IN
    SELECT product_id, old_qty, new_qty, inventory_delta
    FROM _settlement_edit_delta_tmp
    ORDER BY product_id
  LOOP
    SELECT si.quantity INTO v_store_stock
    FROM public.store_inventory si
    WHERE si.store_id = v_order.store_id AND si.product_id = v_agg.product_id
    FOR UPDATE;

    IF v_store_stock IS NULL THEN RAISE EXCEPTION '店铺库存记录不存在'; END IF;
    IF v_store_stock + v_agg.inventory_delta < 0 THEN RAISE EXCEPTION '店铺库存不足'; END IF;

    UPDATE _settlement_edit_delta_tmp
    SET before_quantity = v_store_stock,
        after_quantity = v_store_stock + v_agg.inventory_delta
    WHERE product_id = v_agg.product_id;
  END LOOP;

  SELECT
    COALESCE(SUM(p.price * ni.new_qty), 0),
    COALESCE(SUM(COALESCE(spp.override_price, s.discount_rate * p.price) * ni.new_qty), 0)
  INTO v_total_retail, v_total_discount
  FROM _settlement_edit_new_tmp ni
  JOIN public.products p ON p.id = ni.product_id
  JOIN public.stores s ON s.id = v_order.store_id
  LEFT JOIN public.store_product_prices spp
    ON spp.store_id = v_order.store_id AND spp.product_id = ni.product_id;

  UPDATE public.store_inventory si
  SET quantity = d.after_quantity, updated_at = NOW()
  FROM _settlement_edit_delta_tmp d
  WHERE si.store_id = v_order.store_id AND si.product_id = d.product_id;

  DELETE FROM public.order_items WHERE order_id = p_order_id;

  INSERT INTO public.order_items (
    order_id, product_id, quantity, retail_price, discount_price
  )
  SELECT
    p_order_id,
    ni.product_id,
    ni.new_qty,
    p.price,
    COALESCE(spp.override_price, s.discount_rate * p.price)
  FROM _settlement_edit_new_tmp ni
  JOIN public.products p ON p.id = ni.product_id
  JOIN public.stores s ON s.id = v_order.store_id
  LEFT JOIN public.store_product_prices spp
    ON spp.store_id = v_order.store_id AND spp.product_id = ni.product_id;

  UPDATE public.orders
  SET total_retail_amount = v_total_retail,
      total_discount_amount = v_total_discount,
      city_id = v_store_city
  WHERE id = p_order_id;

  INSERT INTO public.inventory_logs (
    product_id, operator_id, store_id, action, delta_quantity, before_quantity, after_quantity, note
  )
  SELECT
    d.product_id,
    v_actor_id,
    v_order.store_id,
    'settlement_edit',
    d.inventory_delta,
    d.before_quantity,
    d.after_quantity,
    FORMAT('结算改单库存调整；order_id=%s；store_id=%s；old_qty=%s；new_qty=%s', p_order_id, v_order.store_id, d.old_qty, d.new_qty)
  FROM _settlement_edit_delta_tmp d
  WHERE d.inventory_delta <> 0;

  SELECT * INTO v_order FROM public.orders WHERE id = p_order_id;
  RETURN v_order;
END;
$$;

GRANT EXECUTE ON FUNCTION public.edit_settlement_order_atomic(UUID, JSONB) TO authenticated;

-- 7) Legacy purchase create RPC: remove order_items cost columns
CREATE OR REPLACE FUNCTION public.create_purchase_order_atomic(
  p_user_id UUID,
  p_store_id UUID,
  p_city_id UUID,
  p_items JSONB
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor_id UUID := auth.uid();
  v_actor_role TEXT;
  v_target_role TEXT;
  v_store_city UUID;
  v_store_status TEXT;
  v_order_id UUID;
  v_total_cost NUMERIC(10, 2) := 0;
BEGIN
  IF v_actor_id IS NULL THEN RAISE EXCEPTION '未登录'; END IF;
  SELECT role INTO v_actor_role FROM public.profiles WHERE id = v_actor_id;
  IF v_actor_role IS NULL THEN RAISE EXCEPTION '用户资料不存在'; END IF;
  IF v_actor_role NOT IN ('admin', 'super_admin') THEN RAISE EXCEPTION '当前角色无进货建单权限'; END IF;
  IF p_user_id IS NULL THEN RAISE EXCEPTION '建单用户不能为空'; END IF;
  SELECT role INTO v_target_role FROM public.profiles WHERE id = p_user_id;
  IF v_target_role IS NULL THEN RAISE EXCEPTION '建单用户不存在'; END IF;
  IF p_store_id IS NULL THEN RAISE EXCEPTION '店铺ID不能为空'; END IF;
  IF p_city_id IS NULL THEN RAISE EXCEPTION '城市ID不能为空'; END IF;

  SELECT s.city_id, s.status INTO v_store_city, v_store_status FROM public.stores s WHERE s.id = p_store_id;
  IF NOT FOUND THEN RAISE EXCEPTION '店铺不存在'; END IF;
  IF v_store_status <> 'active' THEN RAISE EXCEPTION '店铺已停用'; END IF;
  IF v_store_city IS DISTINCT FROM p_city_id THEN RAISE EXCEPTION '店铺不属于所选城市'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.cities c WHERE c.id = p_city_id) THEN RAISE EXCEPTION '城市不存在'; END IF;
  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) = 0 THEN RAISE EXCEPTION '进货项不能为空'; END IF;

  CREATE TEMP TABLE IF NOT EXISTS _purchase_order_items_tmp (
    product_id UUID NOT NULL,
    quantity INTEGER NOT NULL
  ) ON COMMIT DROP;

  TRUNCATE TABLE _purchase_order_items_tmp;

  INSERT INTO _purchase_order_items_tmp (product_id, quantity)
  SELECT x.product_id, x.quantity
  FROM jsonb_to_recordset(p_items) AS x(product_id UUID, quantity INTEGER);

  IF NOT EXISTS (SELECT 1 FROM _purchase_order_items_tmp) THEN RAISE EXCEPTION '进货项不能为空'; END IF;
  IF EXISTS (SELECT 1 FROM _purchase_order_items_tmp WHERE quantity <= 0) THEN RAISE EXCEPTION '进货数量必须大于0'; END IF;

  IF EXISTS (
    SELECT 1
    FROM _purchase_order_items_tmp pi
    LEFT JOIN public.products p ON p.id = pi.product_id
    WHERE p.id IS NULL
  ) THEN RAISE EXCEPTION '商品不存在'; END IF;

  IF EXISTS (
    SELECT 1
    FROM _purchase_order_items_tmp pi
    JOIN public.products p ON p.id = pi.product_id
    WHERE p.city_id IS DISTINCT FROM p_city_id
  ) THEN RAISE EXCEPTION '只能进货所选城市商品'; END IF;

  SELECT COALESCE(SUM(COALESCE(p.cost, 0) * pi.quantity), 0)
  INTO v_total_cost
  FROM _purchase_order_items_tmp pi
  JOIN public.products p ON p.id = pi.product_id;

  INSERT INTO public.orders (
    distributor_id, city_id, store_id, order_kind, status, total_retail_amount, total_discount_amount
  ) VALUES (
    p_user_id, p_city_id, p_store_id, 'purchase', 'pending', v_total_cost, v_total_cost
  ) RETURNING id INTO v_order_id;

  INSERT INTO public.order_items (
    order_id, product_id, quantity, retail_price, discount_price
  )
  SELECT
    v_order_id,
    pi.product_id,
    pi.quantity,
    COALESCE(p.cost, 0),
    COALESCE(p.cost, 0)
  FROM _purchase_order_items_tmp pi
  JOIN public.products p ON p.id = pi.product_id;

  RETURN v_order_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_purchase_order_atomic(UUID, UUID, UUID, JSONB) TO authenticated;

-- 8) Legacy purchase confirm RPC: switch cost aggregation to products table
CREATE OR REPLACE FUNCTION public.confirm_purchase_delivery_atomic(
  p_order_id UUID,
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
  v_order public.orders%ROWTYPE;
  v_store_name TEXT;
  v_store_status TEXT;
  v_inventory_pool TEXT;
  v_category_id UUID;
  v_purchase_amount DECIMAL(12, 2) := 0;
  v_transaction_id UUID;
BEGIN
  IF v_actor_id IS NULL THEN RAISE EXCEPTION '未登录'; END IF;
  SELECT role INTO v_actor_role FROM public.profiles WHERE id = v_actor_id;
  IF v_actor_role IS NULL THEN RAISE EXCEPTION '用户资料不存在'; END IF;
  IF v_actor_role NOT IN ('admin', 'super_admin') THEN RAISE EXCEPTION '当前角色无确认进货权限'; END IF;
  IF p_confirmed_by IS NULL THEN RAISE EXCEPTION '确认人不能为空'; END IF;
  SELECT role INTO v_confirmed_role FROM public.profiles WHERE id = p_confirmed_by;
  IF v_confirmed_role IS NULL THEN RAISE EXCEPTION '确认人不存在'; END IF;

  SELECT * INTO v_order FROM public.orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION '订单不存在'; END IF;
  IF COALESCE(v_order.order_kind::TEXT, 'distribution') <> 'purchase' THEN RAISE EXCEPTION '不是进货单'; END IF;
  IF v_order.status = 'accepted' THEN RETURN; END IF;
  IF v_order.status <> 'pending' THEN RAISE EXCEPTION '进货单状态不可确认'; END IF;
  IF v_order.store_id IS NULL THEN RAISE EXCEPTION '进货单未绑定店铺'; END IF;

  SELECT s.name, s.status INTO v_store_name, v_store_status FROM public.stores s WHERE s.id = v_order.store_id;
  IF NOT FOUND THEN RAISE EXCEPTION '店铺不存在'; END IF;
  IF v_store_status <> 'active' THEN RAISE EXCEPTION '店铺已停用'; END IF;

  SELECT id INTO v_category_id
  FROM public.finance_categories
  WHERE name = '采购成本' AND type = 'expense';
  IF v_category_id IS NULL THEN RAISE EXCEPTION '采购成本分类不存在'; END IF;

  SELECT COALESCE(
    SUM((COALESCE(oi.quantity, 0)::NUMERIC * COALESCE(p.cost, 0)) + COALESCE(p.one_time_cost, 0)),
    0
  )::DECIMAL(12, 2)
  INTO v_purchase_amount
  FROM public.order_items oi
  JOIN public.products p ON p.id = oi.product_id
  WHERE oi.order_id = p_order_id;

  CREATE TEMP TABLE IF NOT EXISTS _purchase_receive_items_tmp (
    product_id UUID PRIMARY KEY,
    total_qty INTEGER NOT NULL,
    before_quantity INTEGER NOT NULL DEFAULT 0,
    after_quantity INTEGER NOT NULL DEFAULT 0
  ) ON COMMIT DROP;
  TRUNCATE TABLE _purchase_receive_items_tmp;

  INSERT INTO _purchase_receive_items_tmp (product_id, total_qty)
  SELECT oi.product_id, COALESCE(SUM(oi.quantity), 0)::INTEGER
  FROM public.order_items oi
  WHERE oi.order_id = p_order_id
  GROUP BY oi.product_id;

  UPDATE public.orders SET status = 'accepted' WHERE id = p_order_id;

  IF v_store_name = '云窗' THEN
    v_inventory_pool := 'inventory';
    WITH received AS (
      INSERT INTO public.inventory (product_id, quantity, updated_at)
      SELECT t.product_id, t.total_qty, NOW()
      FROM _purchase_receive_items_tmp t
      ON CONFLICT (product_id)
      DO UPDATE SET quantity = public.inventory.quantity + EXCLUDED.quantity, updated_at = NOW()
      RETURNING product_id, quantity AS after_quantity
    )
    UPDATE _purchase_receive_items_tmp t
    SET before_quantity = received.after_quantity - t.total_qty,
        after_quantity = received.after_quantity
    FROM received
    WHERE received.product_id = t.product_id;
  ELSE
    v_inventory_pool := 'store_inventory';
    WITH received AS (
      INSERT INTO public.store_inventory (store_id, product_id, quantity, updated_at)
      SELECT v_order.store_id, t.product_id, t.total_qty, NOW()
      FROM _purchase_receive_items_tmp t
      ON CONFLICT (store_id, product_id)
      DO UPDATE SET quantity = public.store_inventory.quantity + EXCLUDED.quantity, updated_at = NOW()
      RETURNING product_id, quantity AS after_quantity
    )
    UPDATE _purchase_receive_items_tmp t
    SET before_quantity = received.after_quantity - t.total_qty,
        after_quantity = received.after_quantity
    FROM received
    WHERE received.product_id = t.product_id;
  END IF;

  INSERT INTO public.financial_transactions (
    transaction_type, category_id, amount, transaction_date, store_id, supplier_id, description, created_by, source_order_id
  ) VALUES (
    'expense',
    v_category_id,
    v_purchase_amount,
    CURRENT_DATE,
    v_order.store_id,
    v_order.supplier_id,
    FORMAT('进货单确认入库；order_id=%s；store_name=%s', p_order_id, v_store_name),
    p_confirmed_by,
    p_order_id
  ) RETURNING id INTO v_transaction_id;

  INSERT INTO public.inventory_logs (
    product_id, operator_id, action, delta_quantity, before_quantity, after_quantity, note
  )
  SELECT
    t.product_id,
    p_confirmed_by,
    'purchase_receive',
    t.total_qty,
    t.before_quantity,
    t.after_quantity,
    FORMAT(
      '进货到货入库；order_id=%s；store_id=%s；store_name=%s；inventory_pool=%s；financial_transaction_id=%s',
      p_order_id,
      v_order.store_id,
      v_store_name,
      v_inventory_pool,
      v_transaction_id
    )
  FROM _purchase_receive_items_tmp t;
END;
$$;

GRANT EXECUTE ON FUNCTION public.confirm_purchase_delivery_atomic(UUID, UUID) TO authenticated;

-- 9) Remove obsolete order_items one_time_cost force trigger/function
DROP TRIGGER IF EXISTS trg_force_new_order_item_one_time_cost_zero ON public.order_items;
DROP FUNCTION IF EXISTS public.force_new_order_item_one_time_cost_zero();

-- Optional cleanup: old products->order_items sync trigger is no longer needed
DROP TRIGGER IF EXISTS trg_sync_product_cost_to_order_items ON public.products;
DROP FUNCTION IF EXISTS public.sync_product_cost_to_order_items();

-- 10) Physical drop
ALTER TABLE public.order_items
  DROP COLUMN IF EXISTS unit_cost,
  DROP COLUMN IF EXISTS one_time_cost;

-- 11) Bump schema version
INSERT INTO public.app_schema_meta (key, value)
VALUES ('schema_version', '9.2.0')
ON CONFLICT (key)
DO UPDATE SET
  value = EXCLUDED.value,
  updated_at = NOW();
