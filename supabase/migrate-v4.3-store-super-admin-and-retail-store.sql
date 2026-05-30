-- Migration v4.3: super admin + store contact + retail store binding
-- Execute in Supabase SQL Editor

ALTER TABLE public.profiles
  DROP CONSTRAINT IF EXISTS profiles_role_check;

ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_role_check
  CHECK (role IN ('admin', 'super_admin', 'distributor', 'inventory_manager'));

CREATE OR REPLACE FUNCTION public.is_admin(
  p_uid UUID DEFAULT auth.uid()
)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(public.current_user_role(p_uid) IN ('admin', 'super_admin'), FALSE)
$$;

CREATE OR REPLACE FUNCTION public.is_admin_or_inventory_manager(
  p_uid UUID DEFAULT auth.uid()
)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(public.current_user_role(p_uid) IN ('admin', 'super_admin', 'inventory_manager'), FALSE)
$$;

ALTER TABLE public.stores
  ADD COLUMN IF NOT EXISTS contact TEXT;

UPDATE public.profiles
SET role = 'super_admin', updated_at = NOW()
WHERE email = '2330605169@qq.com';

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

  IF p_store_id IS NOT NULL THEN
    SELECT s.status
    INTO v_store_status
    FROM public.stores s
    WHERE s.id = p_store_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION '店铺不存在';
    END IF;

    IF v_store_status <> 'active' THEN
      RAISE EXCEPTION '店铺已停用';
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
    store_id,
    order_kind,
    status,
    total_retail_amount,
    total_discount_amount
  ) VALUES (
    v_user_id,
    v_order_city,
    p_request_id,
    p_store_id,
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

  IF p_store_id IS NOT NULL THEN
    INSERT INTO public.store_inventory (store_id, product_id, quantity, updated_at)
    SELECT
      p_store_id,
      bi.product_id,
      SUM(bi.quantity)::INTEGER,
      NOW()
    FROM _retail_order_items_tmp bi
    GROUP BY bi.product_id
    ON CONFLICT (store_id, product_id)
    DO UPDATE SET
      quantity = public.store_inventory.quantity + EXCLUDED.quantity,
      updated_at = NOW();
  END IF;

  RETURN v_order_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_retail_order_atomic(JSONB, TEXT, UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.modify_distribution_order_atomic(
  p_order_id UUID,
  p_items JSONB,
  p_request_id TEXT DEFAULT NULL
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
  v_item RECORD;
  v_current_item public.order_items%ROWTYPE;
  v_delta INTEGER;
  v_inventory_qty INTEGER;
  v_store_qty INTEGER;
BEGIN
  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION '修改项不能为空';
  END IF;

  SELECT role INTO v_role
  FROM public.profiles
  WHERE id = v_uid;

  IF v_role NOT IN ('admin', 'super_admin') THEN
    RAISE EXCEPTION '仅管理员可修改分销订单';
  END IF;

  SELECT * INTO v_order
  FROM public.orders
  WHERE id = p_order_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION '订单不存在';
  END IF;

  IF COALESCE(v_order.order_kind::TEXT, 'distribution') <> 'distribution' THEN
    RAISE EXCEPTION '仅支持修改分销订单';
  END IF;

  IF COALESCE(v_order.status, 'pending') <> 'accepted' THEN
    RAISE EXCEPTION '仅支持修改已接单订单';
  END IF;

  CREATE TEMP TABLE IF NOT EXISTS _modify_distribution_items_tmp (
    order_item_id UUID NOT NULL,
    new_quantity INTEGER NOT NULL
  ) ON COMMIT DROP;

  TRUNCATE TABLE _modify_distribution_items_tmp;

  INSERT INTO _modify_distribution_items_tmp (order_item_id, new_quantity)
  SELECT x.order_item_id, x.new_quantity
  FROM jsonb_to_recordset(p_items) AS x(order_item_id UUID, new_quantity INTEGER);

  IF EXISTS (
    SELECT 1
    FROM _modify_distribution_items_tmp
    GROUP BY order_item_id
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION '同一订单行不能重复修改';
  END IF;

  IF EXISTS (SELECT 1 FROM _modify_distribution_items_tmp WHERE new_quantity < 0) THEN
    RAISE EXCEPTION '新数量不能小于0';
  END IF;

  FOR v_item IN
    SELECT order_item_id, new_quantity
    FROM _modify_distribution_items_tmp
    ORDER BY order_item_id
  LOOP
    SELECT * INTO v_current_item
    FROM public.order_items oi
    WHERE oi.id = v_item.order_item_id
      AND oi.order_id = p_order_id
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION '订单行不存在或不属于该订单';
    END IF;

    IF v_item.new_quantity >= v_current_item.quantity THEN
      RAISE EXCEPTION '仅支持减量修改';
    END IF;

    v_delta := v_current_item.quantity - v_item.new_quantity;

    SELECT i.quantity INTO v_inventory_qty
    FROM public.inventory i
    WHERE i.product_id = v_current_item.product_id
    FOR UPDATE;

    IF v_inventory_qty IS NULL THEN
      RAISE EXCEPTION '库存记录不存在';
    END IF;

    IF v_order.store_id IS NOT NULL AND NOT v_current_item.is_sample THEN
      SELECT si.quantity INTO v_store_qty
      FROM public.store_inventory si
      WHERE si.store_id = v_order.store_id
        AND si.product_id = v_current_item.product_id
      FOR UPDATE;

      IF v_store_qty IS NULL THEN
        RAISE EXCEPTION '店铺库存记录不存在';
      END IF;

      IF v_store_qty < v_delta THEN
        RAISE EXCEPTION '店铺库存不足，无法减量';
      END IF;
    END IF;

    UPDATE public.inventory
    SET quantity = quantity + v_delta,
        updated_at = NOW()
    WHERE product_id = v_current_item.product_id;

    IF v_order.store_id IS NOT NULL AND NOT v_current_item.is_sample THEN
      UPDATE public.store_inventory
      SET quantity = quantity - v_delta,
          updated_at = NOW()
      WHERE store_id = v_order.store_id
        AND product_id = v_current_item.product_id;
    END IF;

    IF v_item.new_quantity = 0 THEN
      DELETE FROM public.order_items WHERE id = v_current_item.id;
    ELSE
      UPDATE public.order_items
      SET quantity = v_item.new_quantity
      WHERE id = v_current_item.id;
    END IF;
  END LOOP;

  IF NOT EXISTS (SELECT 1 FROM public.order_items WHERE order_id = p_order_id) THEN
    DELETE FROM public.orders WHERE id = p_order_id;
    RETURN;
  END IF;

  UPDATE public.orders o
  SET total_retail_amount = totals.total_retail,
      total_discount_amount = totals.total_discount
  FROM (
    SELECT
      COALESCE(SUM(oi.retail_price * oi.quantity), 0)::NUMERIC(10, 2) AS total_retail,
      COALESCE(SUM(oi.discount_price * oi.quantity), 0)::NUMERIC(10, 2) AS total_discount
    FROM public.order_items oi
    WHERE oi.order_id = p_order_id
  ) totals
  WHERE o.id = p_order_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.modify_distribution_order_atomic(UUID, JSONB, TEXT) TO authenticated;

INSERT INTO public.app_schema_meta (key, value)
VALUES ('schema_version', '4.3.0')
ON CONFLICT (key)
DO UPDATE SET
  value = EXCLUDED.value,
  updated_at = NOW();
