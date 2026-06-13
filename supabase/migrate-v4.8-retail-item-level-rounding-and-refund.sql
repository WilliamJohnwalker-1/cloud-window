-- Migration v4.8: retail item-level rounding + item-level refund inventory restore
-- Execute after migrate-v4.7-batch-order-fix-and-cost-sync.sql

-- ============================================================
-- 1) Item-level rounding for retail order items (before collect)
-- ============================================================
CREATE OR REPLACE FUNCTION public.set_retail_order_item_prices_atomic(
  p_order_id UUID,
  p_items JSONB,
  p_payment_note TEXT DEFAULT NULL
)
RETURNS TABLE(total_discount_amount NUMERIC)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_role TEXT;
  v_order public.orders%ROWTYPE;
  v_row RECORD;
  v_trimmed_note TEXT;
  v_new_total_discount NUMERIC(10, 2);
BEGIN
  IF p_order_id IS NULL THEN
    RAISE EXCEPTION '订单不能为空';
  END IF;

  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION '抹零项不能为空';
  END IF;

  SELECT role INTO v_role
  FROM public.profiles
  WHERE id = v_uid;

  IF v_role NOT IN ('admin', 'super_admin', 'inventory_manager') THEN
    RAISE EXCEPTION '当前角色无抹零权限';
  END IF;

  SELECT *
  INTO v_order
  FROM public.orders
  WHERE id = p_order_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION '订单不存在';
  END IF;

  IF COALESCE(v_order.order_kind::TEXT, 'distribution') <> 'retail' THEN
    RAISE EXCEPTION '仅支持零售订单抹零';
  END IF;

  IF COALESCE(v_order.payment_status, 'pending') IN ('paid', 'partial_refunded', 'partial_refund_pending', 'refunded', 'refund_pending') THEN
    RAISE EXCEPTION '已支付/退款中的订单不允许修改抹零';
  END IF;

  CREATE TEMP TABLE IF NOT EXISTS _retail_item_price_tmp (
    order_item_id UUID PRIMARY KEY,
    new_discount_price NUMERIC(10, 2) NOT NULL
  ) ON COMMIT DROP;

  TRUNCATE TABLE _retail_item_price_tmp;

  INSERT INTO _retail_item_price_tmp (order_item_id, new_discount_price)
  SELECT x.order_item_id, x.new_discount_price
  FROM jsonb_to_recordset(p_items) AS x(order_item_id UUID, new_discount_price NUMERIC(10, 2));

  IF EXISTS (SELECT 1 FROM _retail_item_price_tmp WHERE new_discount_price < 0) THEN
    RAISE EXCEPTION '商品实收单价不能小于0';
  END IF;

  FOR v_row IN
    SELECT oi.id, oi.retail_price, t.new_discount_price
    FROM _retail_item_price_tmp t
    JOIN public.order_items oi ON oi.id = t.order_item_id
    WHERE oi.order_id = p_order_id
    FOR UPDATE
  LOOP
    IF v_row.new_discount_price > v_row.retail_price THEN
      RAISE EXCEPTION '商品实收单价不能高于零售价';
    END IF;

    UPDATE public.order_items
    SET discount_price = v_row.new_discount_price
    WHERE id = v_row.id;
  END LOOP;

  IF EXISTS (
    SELECT 1
    FROM _retail_item_price_tmp t
    LEFT JOIN public.order_items oi ON oi.id = t.order_item_id AND oi.order_id = p_order_id
    WHERE oi.id IS NULL
  ) THEN
    RAISE EXCEPTION '存在不属于该订单的商品行';
  END IF;

  SELECT COALESCE(SUM(oi.discount_price * oi.quantity), 0)::NUMERIC(10, 2)
  INTO v_new_total_discount
  FROM public.order_items oi
  WHERE oi.order_id = p_order_id;

  v_trimmed_note := NULLIF(BTRIM(COALESCE(p_payment_note, '')), '');

  UPDATE public.orders o
  SET total_discount_amount = v_new_total_discount,
      payment_amount = v_new_total_discount,
      payment_note = v_trimmed_note,
      updated_at = NOW()
  WHERE o.id = p_order_id;

  RETURN QUERY SELECT v_new_total_discount;
END;
$$;

GRANT EXECUTE ON FUNCTION public.set_retail_order_item_prices_atomic(UUID, JSONB, TEXT) TO authenticated;

-- ============================================================
-- 2) Apply item-level refund mutation with inventory restore
-- ============================================================
CREATE OR REPLACE FUNCTION public.apply_retail_refund_items_atomic(
  p_order_id UUID,
  p_order_item_ids UUID[]
)
RETURNS TABLE(order_deleted BOOLEAN, remaining_discount_amount NUMERIC)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_role TEXT;
  v_order public.orders%ROWTYPE;
  v_remaining_count INTEGER;
  v_remaining_discount NUMERIC(10, 2);
BEGIN
  IF p_order_id IS NULL THEN
    RAISE EXCEPTION '订单不能为空';
  END IF;

  IF p_order_item_ids IS NULL OR COALESCE(array_length(p_order_item_ids, 1), 0) = 0 THEN
    RAISE EXCEPTION '退款商品行不能为空';
  END IF;

  SELECT role INTO v_role
  FROM public.profiles
  WHERE id = v_uid;

  IF v_role NOT IN ('admin', 'super_admin', 'inventory_manager') THEN
    RAISE EXCEPTION '当前角色无退款权限';
  END IF;

  SELECT *
  INTO v_order
  FROM public.orders
  WHERE id = p_order_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION '订单不存在';
  END IF;

  IF COALESCE(v_order.order_kind::TEXT, 'distribution') <> 'retail' THEN
    RAISE EXCEPTION '仅支持零售订单按商品退款';
  END IF;

  CREATE TEMP TABLE IF NOT EXISTS _retail_refund_items_tmp (
    order_item_id UUID PRIMARY KEY,
    product_id UUID NOT NULL,
    quantity INTEGER NOT NULL
  ) ON COMMIT DROP;

  TRUNCATE TABLE _retail_refund_items_tmp;

  INSERT INTO _retail_refund_items_tmp (order_item_id, product_id, quantity)
  SELECT oi.id, oi.product_id, oi.quantity
  FROM public.order_items oi
  WHERE oi.order_id = p_order_id
    AND oi.id = ANY(p_order_item_ids)
  FOR UPDATE;

  IF (SELECT COUNT(*) FROM _retail_refund_items_tmp) <> COALESCE(array_length(p_order_item_ids, 1), 0) THEN
    RAISE EXCEPTION '存在不属于该订单的退款商品行';
  END IF;

  -- Branch 1: mobile store retail order (identified by request_id msr: prefix)
  IF COALESCE(v_order.order_kind::TEXT, 'distribution') = 'retail'
     AND v_order.store_id IS NOT NULL
     AND v_order.request_id IS NOT NULL
     AND v_order.request_id LIKE 'msr:%' THEN
    INSERT INTO public.store_inventory (store_id, product_id, quantity, updated_at)
    SELECT v_order.store_id, t.product_id, SUM(t.quantity)::INTEGER, NOW()
    FROM _retail_refund_items_tmp t
    GROUP BY t.product_id
    ON CONFLICT (store_id, product_id)
    DO UPDATE SET
      quantity = public.store_inventory.quantity + EXCLUDED.quantity,
      updated_at = NOW();
  ELSE
    -- Branch 2: web cashier retail orders restore to global inventory
    UPDATE public.inventory i
    SET quantity = i.quantity + agg.total_qty,
        updated_at = NOW()
    FROM (
      SELECT t.product_id, SUM(t.quantity)::INTEGER AS total_qty
      FROM _retail_refund_items_tmp t
      GROUP BY t.product_id
    ) agg
    WHERE i.product_id = agg.product_id;
  END IF;

  DELETE FROM public.order_items oi
  WHERE oi.order_id = p_order_id
    AND oi.id IN (SELECT t.order_item_id FROM _retail_refund_items_tmp t);

  SELECT COUNT(*) INTO v_remaining_count
  FROM public.order_items oi
  WHERE oi.order_id = p_order_id;

  IF v_remaining_count = 0 THEN
    DELETE FROM public.orders
    WHERE id = p_order_id;

    RETURN QUERY SELECT TRUE, 0::NUMERIC;
    RETURN;
  END IF;

  SELECT COALESCE(SUM(oi.discount_price * oi.quantity), 0)::NUMERIC(10, 2)
  INTO v_remaining_discount
  FROM public.order_items oi
  WHERE oi.order_id = p_order_id;

  UPDATE public.orders o
  SET total_retail_amount = totals.total_retail,
      total_discount_amount = totals.total_discount,
      updated_at = NOW()
  FROM (
    SELECT
      COALESCE(SUM(oi.retail_price * oi.quantity), 0)::NUMERIC(10, 2) AS total_retail,
      COALESCE(SUM(oi.discount_price * oi.quantity), 0)::NUMERIC(10, 2) AS total_discount
    FROM public.order_items oi
    WHERE oi.order_id = p_order_id
  ) totals
  WHERE o.id = p_order_id;

  RETURN QUERY SELECT FALSE, v_remaining_discount;
END;
$$;

GRANT EXECUTE ON FUNCTION public.apply_retail_refund_items_atomic(UUID, UUID[]) TO authenticated;

-- Schema version gate
INSERT INTO public.app_schema_meta (key, value)
VALUES ('schema_version', '4.8.0')
ON CONFLICT (key)
DO UPDATE SET
  value = EXCLUDED.value,
  updated_at = NOW();
