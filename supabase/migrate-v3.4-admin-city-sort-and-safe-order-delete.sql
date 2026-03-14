-- Migration v3.4: transactional city sort swap + safe order delete
-- Execute in Supabase SQL Editor

CREATE OR REPLACE FUNCTION public.swap_city_sort_order(
  p_city_id UUID,
  p_direction TEXT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_role TEXT;
  v_current public.cities%ROWTYPE;
  v_target public.cities%ROWTYPE;
BEGIN
  IF p_direction NOT IN ('up', 'down') THEN
    RAISE EXCEPTION 'invalid direction';
  END IF;

  SELECT role INTO v_role FROM public.profiles WHERE id = v_uid;
  IF v_role IS DISTINCT FROM 'admin' THEN
    RAISE EXCEPTION 'only admin can reorder cities';
  END IF;

  SELECT * INTO v_current
  FROM public.cities
  WHERE id = p_city_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'city not found';
  END IF;

  IF p_direction = 'up' THEN
    SELECT * INTO v_target
    FROM public.cities
    WHERE (sort_index, name, id) < (v_current.sort_index, v_current.name, v_current.id)
    ORDER BY sort_index DESC, name DESC, id DESC
    LIMIT 1
    FOR UPDATE;
  ELSE
    SELECT * INTO v_target
    FROM public.cities
    WHERE (sort_index, name, id) > (v_current.sort_index, v_current.name, v_current.id)
    ORDER BY sort_index ASC, name ASC, id ASC
    LIMIT 1
    FOR UPDATE;
  END IF;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  UPDATE public.cities SET sort_index = v_target.sort_index WHERE id = v_current.id;
  UPDATE public.cities SET sort_index = v_current.sort_index WHERE id = v_target.id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.swap_city_sort_order(UUID, TEXT) TO authenticated;

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
  v_kind TEXT;
BEGIN
  SELECT role INTO v_role FROM public.profiles WHERE id = v_uid;
  IF v_role NOT IN ('admin', 'inventory_manager') THEN
    RAISE EXCEPTION '当前账号无删除订单权限';
  END IF;

  SELECT * INTO v_order
  FROM public.orders
  WHERE id = p_order_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION '订单不存在';
  END IF;

  IF COALESCE(v_order.status, 'pending') <> 'pending' THEN
    RAISE EXCEPTION '仅允许删除待处理订单';
  END IF;

  v_kind := COALESCE(v_order.order_kind::TEXT, 'distribution');
  IF v_kind <> 'distribution' THEN
    RAISE EXCEPTION '仅允许删除分销订单';
  END IF;

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

  DELETE FROM public.orders WHERE id = p_order_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.delete_order_with_inventory_restore_atomic(UUID) TO authenticated;

INSERT INTO public.app_schema_meta (key, value)
VALUES ('schema_version', '3.4.0')
ON CONFLICT (key)
DO UPDATE SET
  value = EXCLUDED.value,
  updated_at = NOW();
