-- Migration v2.4: Atomic order workflows (transactional RPC)
-- Execute in Supabase SQL Editor

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS request_id TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_request_id_unique
  ON public.orders(request_id)
  WHERE request_id IS NOT NULL;

DROP FUNCTION IF EXISTS public.create_batch_order_atomic(JSONB);
DROP FUNCTION IF EXISTS public.outbound_stock_atomic(TEXT, INTEGER);

CREATE OR REPLACE FUNCTION public.create_batch_order_atomic(
  p_items JSONB,
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
  v_user_email TEXT;
  v_user_store TEXT;
  v_order_id UUID;
  v_total_retail NUMERIC(10, 2) := 0;
  v_total_discount NUMERIC(10, 2) := 0;
  v_order_city UUID;
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

  CREATE TEMP TABLE IF NOT EXISTS _batch_order_items_tmp (
    product_id UUID NOT NULL,
    quantity INTEGER NOT NULL,
    retail_price NUMERIC(10, 2) NOT NULL,
    discount_price NUMERIC(10, 2) NOT NULL,
    unit_cost NUMERIC(10, 2) NOT NULL,
    one_time_cost NUMERIC(10, 2) NOT NULL
  ) ON COMMIT DROP;

  TRUNCATE TABLE _batch_order_items_tmp;

  INSERT INTO _batch_order_items_tmp (
    product_id,
    quantity,
    retail_price,
    discount_price,
    unit_cost,
    one_time_cost
  )
  SELECT
    x.product_id,
    x.quantity,
    x.retail_price,
    x.discount_price,
    x.unit_cost,
    x.one_time_cost
  FROM jsonb_to_recordset(p_items) AS x(
    product_id UUID,
    quantity INTEGER,
    retail_price NUMERIC(10, 2),
    discount_price NUMERIC(10, 2),
    unit_cost NUMERIC(10, 2),
    one_time_cost NUMERIC(10, 2)
  );

  IF NOT EXISTS (SELECT 1 FROM _batch_order_items_tmp) THEN
    RAISE EXCEPTION '购物车为空';
  END IF;

  IF EXISTS (SELECT 1 FROM _batch_order_items_tmp WHERE quantity <= 0) THEN
    RAISE EXCEPTION '订单数量必须大于0';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM _batch_order_items_tmp bi
    LEFT JOIN public.products p ON p.id = bi.product_id
    WHERE p.id IS NULL
  ) THEN
    RAISE EXCEPTION '商品不存在';
  END IF;

  IF v_role = 'distributor' THEN
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
    COALESCE(SUM(bi.retail_price * bi.quantity), 0),
    COALESCE(SUM(bi.discount_price * bi.quantity), 0)
  INTO v_total_retail, v_total_discount
  FROM _batch_order_items_tmp bi;

  SELECT COALESCE(
    v_user_city,
    (SELECT p.city_id
     FROM _batch_order_items_tmp bi
     JOIN public.products p ON p.id = bi.product_id
     LIMIT 1)
  )
  INTO v_order_city;

  INSERT INTO public.orders (
    distributor_id,
    city_id,
    request_id,
    total_retail_amount,
    total_discount_amount
  ) VALUES (
    v_user_id,
    v_order_city,
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
    one_time_cost
  )
  SELECT
    v_order_id,
    bi.product_id,
    bi.quantity,
    bi.retail_price,
    bi.discount_price,
    bi.unit_cost,
    bi.one_time_cost
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

GRANT EXECUTE ON FUNCTION public.create_batch_order_atomic(JSONB, TEXT) TO authenticated;


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
  SET quantity = quantity - p_quantity,
      updated_at = NOW()
  WHERE product_id = v_product_id;

  RETURN v_order_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.outbound_stock_atomic(TEXT, INTEGER, TEXT) TO authenticated;
