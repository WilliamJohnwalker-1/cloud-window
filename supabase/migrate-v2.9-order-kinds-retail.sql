-- Migration v2.9: Order kinds + retail cashier atomic RPC
-- Execute in Supabase SQL Editor

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS order_kind TEXT;

ALTER TABLE public.orders
  DROP CONSTRAINT IF EXISTS orders_order_kind_check;

ALTER TABLE public.orders
  ADD CONSTRAINT orders_order_kind_check
  CHECK (order_kind IN ('distribution', 'retail'));

UPDATE public.orders
SET order_kind = 'distribution'
WHERE order_kind IS NULL;

ALTER TABLE public.orders
  ALTER COLUMN order_kind SET DEFAULT 'distribution';

CREATE INDEX IF NOT EXISTS idx_orders_order_kind_created_at
  ON public.orders(order_kind, created_at DESC);

CREATE OR REPLACE FUNCTION public.create_retail_order_atomic(
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
  v_order_id UUID;
  v_total_retail NUMERIC(10, 2) := 0;
  v_order_city UUID;
  v_agg RECORD;
  v_stock INTEGER;
  v_existing_order_id UUID;
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

  IF v_role NOT IN ('admin', 'inventory_manager') THEN
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

  CREATE TEMP TABLE IF NOT EXISTS _retail_order_items_tmp (
    product_id UUID NOT NULL,
    quantity INTEGER NOT NULL,
    retail_price NUMERIC(10, 2) NOT NULL,
    unit_cost NUMERIC(10, 2) NOT NULL,
    one_time_cost NUMERIC(10, 2) NOT NULL
  ) ON COMMIT DROP;

  TRUNCATE TABLE _retail_order_items_tmp;

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
    order_kind,
    status,
    total_retail_amount,
    total_discount_amount
  ) VALUES (
    v_user_id,
    v_order_city,
    p_request_id,
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

  FOR v_agg IN
    SELECT bi.product_id, SUM(bi.quantity)::INTEGER AS total_qty
    FROM _retail_order_items_tmp bi
    GROUP BY bi.product_id
    ORDER BY bi.product_id
  LOOP
    UPDATE public.inventory
    SET quantity = quantity - v_agg.total_qty,
        updated_at = NOW()
    WHERE product_id = v_agg.product_id;
  END LOOP;

  RETURN v_order_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_retail_order_atomic(JSONB, TEXT) TO authenticated;
