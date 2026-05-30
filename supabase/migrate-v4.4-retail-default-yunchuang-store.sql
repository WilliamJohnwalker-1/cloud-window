-- Migration v4.4: default retail cashier orders to 云窗 store
-- Execute after migrate-v4.3-store-super-admin-and-retail-store.sql

WITH default_store AS (
  SELECT (
    ARRAY_AGG(
      s.id
      ORDER BY CASE WHEN s.status = 'active' THEN 0 ELSE 1 END, s.created_at, s.id::text
    )
  )[1]::uuid AS store_id
  FROM public.stores s
  WHERE s.name = '云窗'
)
UPDATE public.orders o
SET store_id = ds.store_id
FROM default_store ds
WHERE COALESCE(o.order_kind::TEXT, 'distribution') = 'retail'
  AND ds.store_id IS NOT NULL
  AND o.store_id IS DISTINCT FROM ds.store_id;

-- Remove the legacy two-argument overload so callers that omit p_store_id
-- resolve to the defaulted three-argument implementation below.
DROP FUNCTION IF EXISTS public.create_retail_order_atomic(JSONB, TEXT);

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

INSERT INTO public.app_schema_meta (key, value)
VALUES ('schema_version', '4.4.0')
ON CONFLICT (key)
DO UPDATE SET
  value = EXCLUDED.value,
  updated_at = NOW();
