-- Migration v8.7: purchase order items switch from unit_cost to line_total

ALTER TABLE public.purchase_order_items
ADD COLUMN IF NOT EXISTS line_total NUMERIC(12, 2);

-- Backfill historical rows before dropping unit_cost.
-- Keep legacy semantics: historical row amount = ordered_quantity * unit_cost snapshot.
UPDATE public.purchase_order_items
SET line_total = ROUND(COALESCE(ordered_quantity, 0)::NUMERIC * COALESCE(unit_cost, 0), 2)
WHERE line_total IS NULL;

ALTER TABLE public.purchase_order_items
ALTER COLUMN line_total SET DEFAULT 0;

ALTER TABLE public.purchase_order_items
ALTER COLUMN line_total SET NOT NULL;

COMMENT ON COLUMN public.purchase_order_items.line_total IS 'Purchase item fixed line total amount snapshot';

COMMENT ON COLUMN public.purchase_orders.total_cost_amount IS 'Purchase order total procurement cost snapshot (sum of item line_total at creation)';

CREATE OR REPLACE FUNCTION public.recalc_product_cumulative_from_purchase(
  p_product_id UUID
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_new_cum_qty INTEGER := 0;
  v_new_cum_cost NUMERIC(14, 2) := 0;
  v_new_product_cost NUMERIC(10, 2) := 0;
BEGIN
  IF p_product_id IS NULL THEN
    RETURN;
  END IF;

  SELECT
    COALESCE(SUM(COALESCE(poi.delivered_quantity, 0)), 0)::INTEGER,
    ROUND(COALESCE(SUM(COALESCE(poi.line_total, 0)), 0), 2)
  INTO v_new_cum_qty, v_new_cum_cost
  FROM public.purchase_order_items poi
  WHERE poi.product_id = p_product_id
    AND COALESCE(poi.delivered_quantity, 0) > 0;

  IF v_new_cum_qty > 0 THEN
    v_new_product_cost := ROUND(v_new_cum_cost / v_new_cum_qty::NUMERIC, 2);

    UPDATE public.products p
    SET cumulative_cost_quantity = v_new_cum_qty,
        cumulative_cost_amount = v_new_cum_cost,
        cost = v_new_product_cost,
        updated_at = NOW()
    WHERE p.id = p_product_id;

    UPDATE public.order_items oi
    SET unit_cost = v_new_product_cost
    WHERE oi.product_id = p_product_id;
  ELSE
    UPDATE public.products p
    SET cumulative_cost_quantity = 0,
        cumulative_cost_amount = 0,
        updated_at = NOW()
    WHERE p.id = p_product_id;
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.recalc_product_cumulative_from_purchase(UUID) TO authenticated;

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
  v_total_cost_amount NUMERIC(12, 2) := 0;
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

  SELECT ROUND(
    SUM(
      CASE
        WHEN pi.line_total IS NOT NULL THEN pi.line_total
        ELSE pi.quantity::NUMERIC * COALESCE(p.cost, 0)
      END
    ),
    2
  )
  INTO v_total_cost_amount
  FROM _purchase_order_v2_items_tmp pi
  JOIN public.products p ON p.id = pi.product_id;

  INSERT INTO public.purchase_orders (
    store_id,
    city_id,
    supplier_id,
    status,
    created_by,
    order_date,
    total_cost_amount
  ) VALUES (
    p_store_id,
    p_city_id,
    p_supplier_id,
    'pending',
    p_user_id,
    COALESCE(p_order_date, CURRENT_DATE),
    COALESCE(v_total_cost_amount, 0)
  )
  RETURNING id INTO v_purchase_order_id;

  INSERT INTO public.purchase_order_items (
    purchase_order_id,
    product_id,
    ordered_quantity,
    delivered_quantity,
    delivery_status,
    line_total
  )
  SELECT
    v_purchase_order_id,
    pi.product_id,
    pi.quantity,
    0,
    'pending',
    CASE
      WHEN pi.line_total IS NOT NULL THEN ROUND(pi.line_total, 2)
      ELSE ROUND(pi.quantity::NUMERIC * COALESCE(p.cost, 0), 2)
    END
  FROM _purchase_order_v2_items_tmp pi
  JOIN public.products p ON p.id = pi.product_id;

  RETURN v_purchase_order_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_purchase_order_v2(UUID, UUID, UUID, JSONB, UUID, DATE) TO authenticated;

CREATE OR REPLACE FUNCTION public.confirm_purchase_item_delivery(
  p_purchase_order_id UUID,
  p_item_id UUID,
  p_delivered_quantity INTEGER,
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
  v_order public.purchase_orders%ROWTYPE;
  v_item public.purchase_order_items%ROWTYPE;
  v_store_name TEXT;
  v_store_status TEXT;
  v_inventory_pool TEXT;
  v_before_quantity INTEGER := 0;
  v_after_quantity INTEGER := 0;
  v_delta_quantity INTEGER := 0;
  v_category_id UUID;
  v_transaction_id UUID;
  v_has_delivered_items BOOLEAN := FALSE;
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
    RAISE EXCEPTION '当前角色无确认进货权限';
  END IF;

  IF p_purchase_order_id IS NULL THEN
    RAISE EXCEPTION '进货单ID不能为空';
  END IF;

  IF p_item_id IS NULL THEN
    RAISE EXCEPTION '进货商品行不能为空';
  END IF;

  IF p_confirmed_by IS NULL THEN
    RAISE EXCEPTION '确认人不能为空';
  END IF;

  SELECT role INTO v_confirmed_role
  FROM public.profiles
  WHERE id = p_confirmed_by;

  IF v_confirmed_role IS NULL THEN
    RAISE EXCEPTION '确认人不存在';
  END IF;

  IF p_delivered_quantity IS NULL OR p_delivered_quantity < 0 THEN
    RAISE EXCEPTION '到货数量不能小于0';
  END IF;

  SELECT * INTO v_order
  FROM public.purchase_orders
  WHERE id = p_purchase_order_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION '进货单不存在';
  END IF;

  SELECT * INTO v_item
  FROM public.purchase_order_items
  WHERE id = p_item_id
    AND purchase_order_id = p_purchase_order_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION '进货商品行不存在';
  END IF;

  SELECT s.name, s.status
  INTO v_store_name, v_store_status
  FROM public.stores s
  WHERE s.id = v_order.store_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION '店铺不存在';
  END IF;

  IF v_store_status <> 'active' THEN
    RAISE EXCEPTION '店铺已停用';
  END IF;

  v_delta_quantity := p_delivered_quantity - COALESCE(v_item.delivered_quantity, 0);

  IF v_store_name = '云窗' THEN
    v_inventory_pool := 'inventory';

    SELECT i.quantity
    INTO v_before_quantity
    FROM public.inventory i
    WHERE i.product_id = v_item.product_id
    FOR UPDATE;

    IF NOT FOUND THEN
      v_before_quantity := 0;
      IF v_delta_quantity < 0 THEN
        RAISE EXCEPTION '库存不足，无法下调到货数量';
      END IF;

      INSERT INTO public.inventory (product_id, quantity, updated_at)
      VALUES (v_item.product_id, v_delta_quantity, NOW());
      v_after_quantity := v_delta_quantity;
    ELSE
      v_after_quantity := v_before_quantity + v_delta_quantity;
      IF v_after_quantity < 0 THEN
        RAISE EXCEPTION '库存不足，无法下调到货数量';
      END IF;

      UPDATE public.inventory
      SET quantity = v_after_quantity,
          updated_at = NOW()
      WHERE product_id = v_item.product_id;
    END IF;
  ELSE
    v_inventory_pool := 'store_inventory';

    SELECT si.quantity
    INTO v_before_quantity
    FROM public.store_inventory si
    WHERE si.store_id = v_order.store_id
      AND si.product_id = v_item.product_id
    FOR UPDATE;

    IF NOT FOUND THEN
      v_before_quantity := 0;
      IF v_delta_quantity < 0 THEN
        RAISE EXCEPTION '库存不足，无法下调到货数量';
      END IF;

      INSERT INTO public.store_inventory (store_id, product_id, quantity, updated_at)
      VALUES (v_order.store_id, v_item.product_id, v_delta_quantity, NOW());
      v_after_quantity := v_delta_quantity;
    ELSE
      v_after_quantity := v_before_quantity + v_delta_quantity;
      IF v_after_quantity < 0 THEN
        RAISE EXCEPTION '库存不足，无法下调到货数量';
      END IF;

      UPDATE public.store_inventory
      SET quantity = v_after_quantity,
          updated_at = NOW()
      WHERE store_id = v_order.store_id
        AND product_id = v_item.product_id;
    END IF;
  END IF;

  UPDATE public.purchase_order_items
  SET delivered_quantity = p_delivered_quantity,
      delivery_status = CASE WHEN p_delivered_quantity > 0 THEN 'delivered' ELSE 'pending' END,
      delivered_at = CASE WHEN p_delivered_quantity > 0 THEN NOW() ELSE NULL END,
      confirmed_by = CASE WHEN p_delivered_quantity > 0 THEN p_confirmed_by ELSE NULL END
  WHERE id = p_item_id;

  SELECT EXISTS (
    SELECT 1
    FROM public.purchase_order_items poi
    WHERE poi.purchase_order_id = p_purchase_order_id
      AND COALESCE(poi.delivered_quantity, 0) > 0
  ) INTO v_has_delivered_items;

  SELECT id INTO v_category_id
  FROM public.finance_categories
  WHERE name = '采购成本'
    AND type = 'expense';

  IF v_category_id IS NULL THEN
    RAISE EXCEPTION '采购成本分类不存在';
  END IF;

  IF v_has_delivered_items THEN
    SELECT ft.id
    INTO v_transaction_id
    FROM public.financial_transactions ft
    WHERE ft.source_purchase_order_id = p_purchase_order_id
      AND ft.transaction_type = 'expense'
      AND ft.category_id = v_category_id
    ORDER BY ft.created_at DESC
    LIMIT 1
    FOR UPDATE;

    IF v_transaction_id IS NULL THEN
      INSERT INTO public.financial_transactions (
        transaction_type,
        category_id,
        amount,
        transaction_date,
        store_id,
        city_id,
        supplier_id,
        product_id,
        description,
        created_by,
        source_purchase_order_id
      ) VALUES (
        'expense',
        v_category_id,
        COALESCE(v_order.total_cost_amount, 0),
        CURRENT_DATE,
        v_order.store_id,
        v_order.city_id,
        v_order.supplier_id,
        NULL,
        FORMAT('进货单V2确认到货；purchase_order_id=%s', p_purchase_order_id),
        p_confirmed_by,
        p_purchase_order_id
      );
    ELSE
      UPDATE public.financial_transactions
      SET amount = COALESCE(v_order.total_cost_amount, 0),
          transaction_date = CURRENT_DATE,
          store_id = v_order.store_id,
          city_id = v_order.city_id,
          supplier_id = v_order.supplier_id,
          product_id = NULL,
          description = FORMAT('进货单V2确认到货；purchase_order_id=%s', p_purchase_order_id),
          updated_at = NOW()
      WHERE id = v_transaction_id;
    END IF;
  ELSE
    DELETE FROM public.financial_transactions ft
    WHERE ft.source_purchase_order_id = p_purchase_order_id
      AND ft.transaction_type = 'expense'
      AND ft.category_id = v_category_id;
  END IF;

  IF v_delta_quantity <> 0 THEN
    INSERT INTO public.inventory_logs (
      product_id,
      operator_id,
      action,
      delta_quantity,
      before_quantity,
      after_quantity,
      note
    ) VALUES (
      v_item.product_id,
      p_confirmed_by,
      'purchase_receive',
      v_delta_quantity,
      v_before_quantity,
      v_after_quantity,
      FORMAT(
        '进货单V2调整到货；purchase_order_id=%s；purchase_order_item_id=%s；store_id=%s；store_name=%s；inventory_pool=%s',
        p_purchase_order_id,
        p_item_id,
        v_order.store_id,
        v_store_name,
        v_inventory_pool
      )
    );
  END IF;

  PERFORM public.recalc_product_cumulative_from_purchase(v_item.product_id);

  UPDATE public.purchase_orders po
  SET status = CASE
        WHEN NOT EXISTS (
          SELECT 1
          FROM public.purchase_order_items poi
          WHERE poi.purchase_order_id = p_purchase_order_id
            AND COALESCE(poi.delivered_quantity, 0) <= 0
        ) THEN 'delivered'
        WHEN EXISTS (
          SELECT 1
          FROM public.purchase_order_items poi
          WHERE poi.purchase_order_id = p_purchase_order_id
            AND COALESCE(poi.delivered_quantity, 0) > 0
        ) THEN 'partially_delivered'
        ELSE 'pending'
      END,
      updated_at = NOW()
  WHERE po.id = p_purchase_order_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.confirm_purchase_item_delivery(UUID, UUID, INTEGER, UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.delete_purchase_order_v2(
  p_purchase_order_id UUID
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor_id UUID := auth.uid();
  v_actor_role TEXT;
  v_order public.purchase_orders%ROWTYPE;
  v_store_name TEXT;
  v_affected_product_ids UUID[] := ARRAY[]::UUID[];
  v_pid UUID;
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
    RAISE EXCEPTION '当前账号无删除进货单权限';
  END IF;

  IF p_purchase_order_id IS NULL THEN
    RAISE EXCEPTION '进货单ID不能为空';
  END IF;

  SELECT * INTO v_order
  FROM public.purchase_orders
  WHERE id = p_purchase_order_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION '进货单不存在';
  END IF;

  SELECT s.name INTO v_store_name
  FROM public.stores s
  WHERE s.id = v_order.store_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION '店铺不存在';
  END IF;

  SELECT COALESCE(ARRAY_AGG(DISTINCT poi.product_id), ARRAY[]::UUID[])
  INTO v_affected_product_ids
  FROM public.purchase_order_items poi
  WHERE poi.purchase_order_id = p_purchase_order_id;

  IF v_store_name = '云窗' THEN
    UPDATE public.inventory i
    SET quantity = i.quantity - agg.delivered_qty,
        updated_at = NOW()
    FROM (
      SELECT poi.product_id, COALESCE(SUM(poi.delivered_quantity), 0)::INTEGER AS delivered_qty
      FROM public.purchase_order_items poi
      WHERE poi.purchase_order_id = p_purchase_order_id
        AND poi.delivered_quantity > 0
      GROUP BY poi.product_id
    ) agg
    WHERE i.product_id = agg.product_id;
  ELSE
    UPDATE public.store_inventory si
    SET quantity = si.quantity - agg.delivered_qty,
        updated_at = NOW()
    FROM (
      SELECT poi.product_id, COALESCE(SUM(poi.delivered_quantity), 0)::INTEGER AS delivered_qty
      FROM public.purchase_order_items poi
      WHERE poi.purchase_order_id = p_purchase_order_id
        AND poi.delivered_quantity > 0
      GROUP BY poi.product_id
    ) agg
    WHERE si.store_id = v_order.store_id
      AND si.product_id = agg.product_id;
  END IF;

  DELETE FROM public.financial_transactions ft
  WHERE ft.source_purchase_order_id = p_purchase_order_id;

  DELETE FROM public.inventory_logs il
  WHERE il.action = 'purchase_receive'
    AND il.note LIKE FORMAT('%%purchase_order_id=%s%%', p_purchase_order_id);

  DELETE FROM public.purchase_orders
  WHERE id = p_purchase_order_id;

  FOREACH v_pid IN ARRAY v_affected_product_ids
  LOOP
    PERFORM public.recalc_product_cumulative_from_purchase(v_pid);
  END LOOP;
END;
$$;

GRANT EXECUTE ON FUNCTION public.delete_purchase_order_v2(UUID) TO authenticated;

ALTER TABLE public.purchase_order_items
DROP COLUMN IF EXISTS unit_cost;

INSERT INTO public.app_schema_meta (key, value)
VALUES ('schema_version', '8.7.0')
ON CONFLICT (key)
DO UPDATE SET
  value = EXCLUDED.value,
  updated_at = NOW();
