-- Migration v6.6: Complete total-warehouse inventory movement logs
-- Execute after migrate-v6.5-inventory-slow-moving-alert.sql

-- Pre-check: Ensure schema version is at least 6.5.0
DO $$
BEGIN
  IF public.get_app_schema_version() < '6.5.0' THEN
    RAISE EXCEPTION 'Migration v6.5.0 must be applied before v6.6.0';
  END IF;
END $$;

-- Purpose:
-- 1) Extend inventory_logs action CHECK for total-warehouse sell/refund/outbound movements.
-- 2) Override the latest total-warehouse stock mutation RPCs to add logs only for public.inventory changes.
-- 3) Add an atomic retail refund item restore RPC for the Worker refund path.
--
-- Mirrored sources:
-- - create_batch_order_atomic: migrate-v5.4-quantity-rules.sql
-- - create_retail_order_atomic: migrate-v4.4-retail-default-yunchuang-store.sql
-- - outbound_stock_atomic: migrate-v2.4-atomic-order-workflows.sql
-- - inventory_logs constraint/log shape: migrate-v6.3-finance-integration.sql

-- ============================================================
-- 1. inventory_logs: extend action CHECK safely
-- ============================================================
DO $$
DECLARE
  v_constraint_def TEXT;
BEGIN
  SELECT pg_get_constraintdef(c.oid)
    INTO v_constraint_def
    FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = c.connamespace
   WHERE n.nspname = 'public'
     AND t.relname = 'inventory_logs'
     AND c.contype = 'c'
     AND c.conname = 'inventory_logs_action_check';

  IF v_constraint_def IS NULL
     OR v_constraint_def NOT ILIKE '%breakage%'
     OR v_constraint_def NOT ILIKE '%purchase_receive%'
     OR v_constraint_def NOT ILIKE '%sell%'
     OR v_constraint_def NOT ILIKE '%refund_restore%'
     OR v_constraint_def NOT ILIKE '%outbound%'
  THEN
    ALTER TABLE public.inventory_logs
      DROP CONSTRAINT IF EXISTS inventory_logs_action_check;

    ALTER TABLE public.inventory_logs
      ADD CONSTRAINT inventory_logs_action_check
      CHECK (action IN (
        'inbound',
        'manual_adjust',
        'quick_add',
        'quick_reduce',
        'breakage',
        'purchase_receive',
        'sell',
        'refund_restore',
        'outbound'
      ));
  END IF;
END $$;

-- ============================================================
-- 2. create_batch_order_atomic override
--    Distribution/supply orders deduct from public.inventory and now log as outbound.
--    Store_inventory receipt side remains unlogged by design.
-- ============================================================
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

  IF v_role NOT IN ('admin', 'super_admin', 'distributor') THEN
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

    IF NOT FOUND THEN
      RAISE EXCEPTION '店铺不存在';
    END IF;

    IF v_store_status <> 'active' THEN
      RAISE EXCEPTION '店铺已停用';
    END IF;

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

  CREATE TEMP TABLE IF NOT EXISTS _inventory_log_movements_tmp (
    product_id UUID PRIMARY KEY,
    total_qty INTEGER NOT NULL,
    before_quantity INTEGER NOT NULL,
    after_quantity INTEGER NOT NULL
  ) ON COMMIT DROP;

  TRUNCATE TABLE _batch_order_items_tmp;
  TRUNCATE TABLE _inventory_log_movements_tmp;

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

  IF v_role = 'distributor' AND EXISTS (
    SELECT 1
    FROM _batch_order_items_tmp
    WHERE NOT is_sample
      AND quantity < 30
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

  INSERT INTO _inventory_log_movements_tmp (product_id, total_qty, before_quantity, after_quantity)
  SELECT
    bi.product_id,
    SUM(bi.quantity)::INTEGER AS total_qty,
    i.quantity AS before_quantity,
    i.quantity - SUM(bi.quantity)::INTEGER AS after_quantity
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

  UPDATE public.inventory i
  SET quantity = m.after_quantity,
      updated_at = NOW()
  FROM _inventory_log_movements_tmp m
  WHERE i.product_id = m.product_id;

  INSERT INTO public.inventory_logs (
    product_id,
    operator_id,
    action,
    delta_quantity,
    before_quantity,
    after_quantity,
    note
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

-- ============================================================
-- 3. create_retail_order_atomic override
--    Web cashier retail orders deduct from public.inventory and now log as sell.
--    Store_inventory receipt side remains unlogged by design.
-- ============================================================
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
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION '未登录';
  END IF;

  SELECT role, city_id
  INTO v_role, v_user_city
  FROM public.profiles
  WHERE id = v_user_id;

  IF v_role IS NULL THEN
    RAISE EXCEPTION '用户资料不存在';
  END IF;

  IF v_role NOT IN ('admin', 'super_admin', 'inventory_manager') THEN
    RAISE EXCEPTION '当前角色无收款建单权限';
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

  IF p_store_id IS NULL THEN
    SELECT (
      ARRAY_AGG(
        s.id
        ORDER BY CASE WHEN s.status = 'active' THEN 0 ELSE 1 END, s.created_at, s.id::text
      )
    )[1]::uuid
    INTO v_effective_store_id
    FROM public.stores s
    WHERE s.name = '云窗';

    IF v_effective_store_id IS NULL THEN
      RAISE EXCEPTION '默认零售店铺不存在';
    END IF;
  ELSE
    v_effective_store_id := p_store_id;
  END IF;

  SELECT s.status
  INTO v_store_status
  FROM public.stores s
  WHERE s.id = v_effective_store_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION '店铺不存在';
  END IF;

  IF v_store_status <> 'active' THEN
    RAISE EXCEPTION '店铺已停用';
  END IF;

  CREATE TEMP TABLE IF NOT EXISTS _retail_order_items_tmp (
    product_id UUID NOT NULL,
    quantity INTEGER NOT NULL,
    retail_price NUMERIC(10, 2) NOT NULL,
    unit_cost NUMERIC(10, 2) NOT NULL,
    one_time_cost NUMERIC(10, 2) NOT NULL
  ) ON COMMIT DROP;

  CREATE TEMP TABLE IF NOT EXISTS _inventory_log_movements_tmp (
    product_id UUID PRIMARY KEY,
    total_qty INTEGER NOT NULL,
    before_quantity INTEGER NOT NULL,
    after_quantity INTEGER NOT NULL
  ) ON COMMIT DROP;

  TRUNCATE TABLE _retail_order_items_tmp;
  TRUNCATE TABLE _inventory_log_movements_tmp;

  INSERT INTO _retail_order_items_tmp (
    product_id,
    quantity,
    retail_price,
    unit_cost,
    one_time_cost
  )
  SELECT
    x.product_id,
    x.quantity,
    x.retail_price,
    x.unit_cost,
    x.one_time_cost
  FROM jsonb_to_recordset(p_items) AS x(
    product_id UUID,
    quantity INTEGER,
    retail_price NUMERIC(10, 2),
    unit_cost NUMERIC(10, 2),
    one_time_cost NUMERIC(10, 2)
  );

  IF NOT EXISTS (SELECT 1 FROM _retail_order_items_tmp) THEN
    RAISE EXCEPTION '购物车为空';
  END IF;

  IF EXISTS (SELECT 1 FROM _retail_order_items_tmp WHERE quantity <= 0) THEN
    RAISE EXCEPTION '订单数量必须大于0';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM _retail_order_items_tmp bi
    LEFT JOIN public.products p ON p.id = bi.product_id
    WHERE p.id IS NULL
  ) THEN
    RAISE EXCEPTION '商品不存在';
  END IF;

  FOR v_agg IN
    SELECT bi.product_id, SUM(bi.quantity)::INTEGER AS total_qty
    FROM _retail_order_items_tmp bi
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

  INSERT INTO _inventory_log_movements_tmp (product_id, total_qty, before_quantity, after_quantity)
  SELECT
    bi.product_id,
    SUM(bi.quantity)::INTEGER AS total_qty,
    i.quantity AS before_quantity,
    i.quantity - SUM(bi.quantity)::INTEGER AS after_quantity
  FROM _retail_order_items_tmp bi
  JOIN public.inventory i ON i.product_id = bi.product_id
  GROUP BY bi.product_id, i.quantity;

  SELECT COALESCE(SUM(bi.retail_price * bi.quantity), 0)
  INTO v_total_retail
  FROM _retail_order_items_tmp bi;

  SELECT COALESCE(
    v_user_city,
    (SELECT p.city_id
     FROM _retail_order_items_tmp bi
     JOIN public.products p ON p.id = bi.product_id
     LIMIT 1)
  )
  INTO v_order_city;

  INSERT INTO public.orders (
    distributor_id,
    city_id,
    request_id,
    store_id,
    order_kind,
    status,
    total_retail_amount,
    total_discount_amount
  ) VALUES (
    v_user_id,
    v_order_city,
    p_request_id,
    v_effective_store_id,
    'retail',
    'accepted',
    v_total_retail,
    v_total_retail
  )
  RETURNING id INTO v_order_id;

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
    bi.retail_price,
    bi.retail_price,
    bi.unit_cost,
    bi.one_time_cost
  FROM _retail_order_items_tmp bi;

  UPDATE public.inventory i
  SET quantity = m.after_quantity,
      updated_at = NOW()
  FROM _inventory_log_movements_tmp m
  WHERE i.product_id = m.product_id;

  INSERT INTO public.inventory_logs (
    product_id,
    operator_id,
    action,
    delta_quantity,
    before_quantity,
    after_quantity,
    note
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

  INSERT INTO public.store_inventory (store_id, product_id, quantity, updated_at)
  SELECT
    v_effective_store_id,
    bi.product_id,
    SUM(bi.quantity)::INTEGER,
    NOW()
  FROM _retail_order_items_tmp bi
  GROUP BY bi.product_id
  ON CONFLICT (store_id, product_id)
  DO UPDATE SET
    quantity = public.store_inventory.quantity + EXCLUDED.quantity,
    updated_at = NOW();

  RETURN v_order_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_retail_order_atomic(JSONB, TEXT, UUID) TO authenticated;

-- ============================================================
-- 4. outbound_stock_atomic override
--    Barcode outbound deducts from public.inventory and now logs as outbound.
-- ============================================================
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
  v_unit_cost NUMERIC(10, 2);
  v_one_time_cost NUMERIC(10, 2);
  v_order_id UUID;
  v_existing_order_id UUID;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION '未登录';
  END IF;

  IF p_quantity IS NULL OR p_quantity <= 0 THEN
    RAISE EXCEPTION '出库数量必须大于0';
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

  SELECT role, city_id
  INTO v_role, v_user_city
  FROM public.profiles
  WHERE id = v_user_id;

  IF v_role IS NULL THEN
    RAISE EXCEPTION '用户资料不存在';
  END IF;

  IF v_role NOT IN ('admin', 'inventory_manager') THEN
    RAISE EXCEPTION '当前角色无出库权限';
  END IF;

  SELECT
    p.id,
    p.city_id,
    i.quantity,
    p.price,
    p.cost,
    p.one_time_cost
  INTO
    v_product_id,
    v_product_city,
    v_current_qty,
    v_retail_price,
    v_unit_cost,
    v_one_time_cost
  FROM public.products p
  JOIN public.inventory i ON i.product_id = p.id
  WHERE p.barcode = p_barcode
  FOR UPDATE OF i;

  IF v_product_id IS NULL THEN
    RAISE EXCEPTION '未找到对应条码商品';
  END IF;

  IF v_current_qty < p_quantity THEN
    RAISE EXCEPTION '库存不足';
  END IF;

  v_after_qty := v_current_qty - p_quantity;

  INSERT INTO public.orders (
    distributor_id,
    city_id,
    request_id,
    total_retail_amount,
    total_discount_amount
  ) VALUES (
    v_user_id,
    COALESCE(v_user_city, v_product_city),
    p_request_id,
    v_retail_price * p_quantity,
    v_retail_price * p_quantity
  )
  RETURNING id INTO v_order_id;

  INSERT INTO public.order_items (
    order_id,
    product_id,
    quantity,
    retail_price,
    discount_price,
    unit_cost,
    one_time_cost
  ) VALUES (
    v_order_id,
    v_product_id,
    p_quantity,
    v_retail_price,
    v_retail_price,
    COALESCE(v_unit_cost, 0),
    COALESCE(v_one_time_cost, 0)
  );

  UPDATE public.inventory
  SET quantity = v_after_qty,
      updated_at = NOW()
  WHERE product_id = v_product_id;

  INSERT INTO public.inventory_logs (
    product_id,
    operator_id,
    action,
    delta_quantity,
    before_quantity,
    after_quantity,
    note
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

-- ============================================================
-- 5. apply_retail_refund_items_atomic
--    Worker refund item restore path: restore selected retail order item
--    quantities to public.inventory and log as refund_restore.
-- ============================================================
CREATE OR REPLACE FUNCTION public.apply_retail_refund_items_atomic(
  p_order_id UUID,
  p_order_item_ids UUID[],
  p_operator_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order public.orders%ROWTYPE;
  v_operator_id UUID;
  v_requested_count INTEGER := 0;
  v_matched_count INTEGER := 0;
  v_remaining_count INTEGER := 0;
  v_remaining_retail NUMERIC(12, 2) := 0;
  v_remaining_discount NUMERIC(12, 2) := 0;
  v_payment_status TEXT;
BEGIN
  IF p_order_id IS NULL THEN
    RAISE EXCEPTION '订单ID不能为空';
  END IF;

  IF p_order_item_ids IS NULL OR ARRAY_LENGTH(p_order_item_ids, 1) IS NULL THEN
    RAISE EXCEPTION '退款商品行不能为空';
  END IF;

  SELECT * INTO v_order
  FROM public.orders
  WHERE id = p_order_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION '订单不存在';
  END IF;

  IF COALESCE(v_order.order_kind::TEXT, 'distribution') <> 'retail' THEN
    RAISE EXCEPTION '仅零售订单支持按商品退款';
  END IF;

  IF LOWER(COALESCE(v_order.payment_status::TEXT, '')) NOT IN ('paid', 'partial_refunded') THEN
    RAISE EXCEPTION '仅已支付或部分退款订单可退款';
  END IF;

  v_operator_id := COALESCE(p_operator_id, v_order.distributor_id);

  IF v_operator_id IS NULL OR NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = v_operator_id) THEN
    RAISE EXCEPTION '退款操作人不存在';
  END IF;

  CREATE TEMP TABLE IF NOT EXISTS _refund_item_ids_tmp (
    id UUID PRIMARY KEY
  ) ON COMMIT DROP;

  CREATE TEMP TABLE IF NOT EXISTS _refund_restore_items_tmp (
    product_id UUID PRIMARY KEY,
    total_qty INTEGER NOT NULL,
    before_quantity INTEGER NOT NULL DEFAULT 0,
    after_quantity INTEGER NOT NULL DEFAULT 0
  ) ON COMMIT DROP;

  TRUNCATE TABLE _refund_item_ids_tmp;
  TRUNCATE TABLE _refund_restore_items_tmp;

  INSERT INTO _refund_item_ids_tmp (id)
  SELECT DISTINCT item_id
  FROM UNNEST(p_order_item_ids) AS item_id
  WHERE item_id IS NOT NULL;

  SELECT COUNT(*) INTO v_requested_count
  FROM _refund_item_ids_tmp;

  IF v_requested_count = 0 THEN
    RAISE EXCEPTION '退款商品行不能为空';
  END IF;

  SELECT COUNT(*) INTO v_matched_count
  FROM public.order_items oi
  JOIN _refund_item_ids_tmp ids ON ids.id = oi.id
  WHERE oi.order_id = p_order_id
    AND COALESCE(oi.quantity, 0) > 0;

  IF v_matched_count <> v_requested_count THEN
    RAISE EXCEPTION '存在无效退款商品行';
  END IF;

  INSERT INTO _refund_restore_items_tmp (product_id, total_qty, before_quantity, after_quantity)
  SELECT
    oi.product_id,
    SUM(COALESCE(oi.quantity, 0))::INTEGER AS total_qty,
    i.quantity AS before_quantity,
    i.quantity + SUM(COALESCE(oi.quantity, 0))::INTEGER AS after_quantity
  FROM public.order_items oi
  JOIN _refund_item_ids_tmp ids ON ids.id = oi.id
  JOIN public.inventory i ON i.product_id = oi.product_id
  WHERE oi.order_id = p_order_id
    AND COALESCE(oi.quantity, 0) > 0
  GROUP BY oi.product_id, i.quantity;

  UPDATE public.inventory i
  SET quantity = r.after_quantity,
      updated_at = NOW()
  FROM _refund_restore_items_tmp r
  WHERE i.product_id = r.product_id;

  INSERT INTO public.inventory_logs (
    product_id,
    operator_id,
    action,
    delta_quantity,
    before_quantity,
    after_quantity,
    note
  )
  SELECT
    r.product_id,
    v_operator_id,
    'refund_restore',
    r.total_qty,
    r.before_quantity,
    r.after_quantity,
    FORMAT('零售退款库存恢复；order_id=%s；item_count=%s；inventory_pool=inventory', p_order_id, v_requested_count)
  FROM _refund_restore_items_tmp r;

  UPDATE public.order_items oi
  SET quantity = 0
  FROM _refund_item_ids_tmp ids
  WHERE oi.id = ids.id
    AND oi.order_id = p_order_id;

  SELECT
    COUNT(*),
    COALESCE(SUM(COALESCE(oi.retail_price, 0) * COALESCE(oi.quantity, 0)), 0),
    COALESCE(SUM(COALESCE(oi.discount_price, 0) * COALESCE(oi.quantity, 0)), 0)
  INTO v_remaining_count, v_remaining_retail, v_remaining_discount
  FROM public.order_items oi
  WHERE oi.order_id = p_order_id
    AND COALESCE(oi.quantity, 0) > 0;

  IF v_remaining_count = 0 THEN
    v_payment_status := 'refunded';

    UPDATE public.orders
    SET total_retail_amount = 0,
        total_discount_amount = 0,
        payment_amount = 0,
        payment_status = v_payment_status
    WHERE id = p_order_id;

    RETURN jsonb_build_object(
      'order_deleted', FALSE,
      'remaining_discount_amount', 0,
      'payment_status', v_payment_status
    );
  END IF;

  v_payment_status := 'partial_refunded';

  UPDATE public.orders
  SET total_retail_amount = ROUND(v_remaining_retail, 2),
      total_discount_amount = ROUND(v_remaining_discount, 2),
      payment_amount = ROUND(v_remaining_retail, 2),
      payment_status = v_payment_status
  WHERE id = p_order_id;

  RETURN jsonb_build_object(
    'order_deleted', FALSE,
    'remaining_discount_amount', ROUND(v_remaining_discount, 2),
    'payment_status', v_payment_status
  );
END;
$$;

-- Restrict direct invocation to the Worker/service-role path only.
-- This function is SECURITY DEFINER and mutates orders/inventory, so ordinary
-- authenticated clients must not be able to call it directly.
DO $$
BEGIN
  IF to_regprocedure('public.apply_retail_refund_items_atomic(uuid,uuid[])') IS NOT NULL THEN
    EXECUTE 'REVOKE EXECUTE ON FUNCTION public.apply_retail_refund_items_atomic(UUID, UUID[]) FROM authenticated';
  END IF;

  EXECUTE 'REVOKE EXECUTE ON FUNCTION public.apply_retail_refund_items_atomic(UUID, UUID[], UUID) FROM authenticated';
END $$;

GRANT EXECUTE ON FUNCTION public.apply_retail_refund_items_atomic(UUID, UUID[], UUID) TO service_role;

-- ============================================================
-- 6. Schema version gate
-- ============================================================
INSERT INTO public.app_schema_meta (key, value)
VALUES ('schema_version', '6.6.0')
ON CONFLICT (key)
DO UPDATE SET
  value = EXCLUDED.value,
  updated_at = NOW();
