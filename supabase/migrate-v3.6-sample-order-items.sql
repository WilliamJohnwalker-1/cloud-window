-- Migration v3.6: support sample lines in distribution orders
-- Execute in Supabase SQL Editor

ALTER TABLE public.order_items
  ADD COLUMN IF NOT EXISTS is_sample BOOLEAN;

UPDATE public.order_items
SET is_sample = FALSE
WHERE is_sample IS NULL;

ALTER TABLE public.order_items
  ALTER COLUMN is_sample SET DEFAULT FALSE;

ALTER TABLE public.order_items
  ALTER COLUMN is_sample SET NOT NULL;

CREATE INDEX IF NOT EXISTS idx_order_items_is_sample
  ON public.order_items(is_sample);

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
    COALESCE(SUM(CASE WHEN bi.is_sample THEN 0 ELSE bi.retail_price * bi.quantity END), 0),
    COALESCE(SUM(CASE WHEN bi.is_sample THEN 0 ELSE bi.discount_price * bi.quantity END), 0)
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

INSERT INTO public.app_schema_meta (key, value)
VALUES ('schema_version', '3.6.0')
ON CONFLICT (key)
DO UPDATE SET
  value = EXCLUDED.value,
  updated_at = NOW();
