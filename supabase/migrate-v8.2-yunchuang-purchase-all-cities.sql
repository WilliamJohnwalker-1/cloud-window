-- v8.2: Allow 云窗 purchase orders to replenish total warehouse products from any city.
-- Normal stores remain city-bound; 云窗 orders are still created per product city by the clients.

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
  v_store_name TEXT;
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

  SELECT s.city_id, s.status, s.name
  INTO v_store_city, v_store_status, v_store_name
  FROM public.stores s
  WHERE s.id = p_store_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION '店铺不存在';
  END IF;

  IF v_store_status <> 'active' THEN
    RAISE EXCEPTION '店铺已停用';
  END IF;

  IF v_store_name <> '云窗' AND v_store_city IS DISTINCT FROM p_city_id THEN
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

INSERT INTO public.app_schema_meta (key, value)
VALUES ('schema_version', '8.2.0')
ON CONFLICT (key)
DO UPDATE SET
  value = EXCLUDED.value,
  updated_at = NOW();
