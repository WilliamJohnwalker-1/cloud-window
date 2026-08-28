-- Migration v8.5: delete_purchase_order_v2 rollback cumulative cost fields safely

-- 1) delete_purchase_order_v2
--    - Keep existing inventory/finance/log rollback behavior
--    - Add cumulative cost rollback for products affected by delivered purchase items
--    - Guard: if cumulative baseline fields were never initialized (NULL / <=0), skip rollback
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
  v_purchase_tx_ids UUID[] := ARRAY[]::UUID[];
  v_store_name TEXT;

  v_product_rollback RECORD;
  v_old_cum_qty INTEGER;
  v_old_cum_cost NUMERIC(14, 2);
  v_new_cum_qty INTEGER;
  v_new_cum_cost NUMERIC(14, 2);
  v_new_product_cost NUMERIC(12, 2);
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

  -- Rollback cumulative cost fields for products impacted by delivered rows.
  -- Guard behavior:
  --  - If cumulative baseline was never initialized (NULL / <=0), skip rollback.
  --  - If rollback would underflow, clamp to 0.
  FOR v_product_rollback IN
    SELECT
      poi.product_id,
      COALESCE(SUM(poi.delivered_quantity), 0)::INTEGER AS rollback_qty,
      ROUND(SUM(COALESCE(poi.delivered_quantity, 0)::NUMERIC * COALESCE(poi.unit_cost, 0)), 2) AS rollback_cost
    FROM public.purchase_order_items poi
    WHERE poi.purchase_order_id = p_purchase_order_id
      AND poi.delivered_quantity > 0
    GROUP BY poi.product_id
  LOOP
    SELECT p.cumulative_cost_quantity, p.cumulative_cost_amount
    INTO v_old_cum_qty, v_old_cum_cost
    FROM public.products p
    WHERE p.id = v_product_rollback.product_id
    FOR UPDATE;

    IF v_old_cum_qty IS NULL
       OR v_old_cum_cost IS NULL
       OR v_old_cum_qty <= 0 THEN
      CONTINUE;
    END IF;

    v_new_cum_qty := GREATEST(0, v_old_cum_qty - COALESCE(v_product_rollback.rollback_qty, 0));
    v_new_cum_cost := ROUND(
      GREATEST(0::NUMERIC, COALESCE(v_old_cum_cost, 0) - COALESCE(v_product_rollback.rollback_cost, 0)),
      2
    );

    IF v_new_cum_qty > 0 THEN
      v_new_product_cost := ROUND(v_new_cum_cost / v_new_cum_qty::NUMERIC, 2);

      UPDATE public.products p
      SET cumulative_cost_quantity = v_new_cum_qty,
          cumulative_cost_amount = v_new_cum_cost,
          cost = v_new_product_cost,
          updated_at = NOW()
      WHERE p.id = v_product_rollback.product_id;

      UPDATE public.order_items oi
      SET unit_cost = v_new_product_cost
      WHERE oi.product_id = v_product_rollback.product_id;
    ELSE
      UPDATE public.products p
      SET cumulative_cost_quantity = v_new_cum_qty,
          cumulative_cost_amount = v_new_cum_cost,
          updated_at = NOW()
      WHERE p.id = v_product_rollback.product_id;
    END IF;
  END LOOP;

  WITH deleted_tx AS (
    DELETE FROM public.financial_transactions ft
    WHERE ft.source_purchase_order_id = p_purchase_order_id
    RETURNING ft.id
  )
  SELECT COALESCE(ARRAY_AGG(id), ARRAY[]::UUID[])
  INTO v_purchase_tx_ids
  FROM deleted_tx;

  DELETE FROM public.inventory_logs il
  WHERE il.action = 'purchase_receive'
    AND (
      il.note LIKE FORMAT('%%purchase_order_id=%s%%', p_purchase_order_id)
      OR EXISTS (
        SELECT 1
        FROM UNNEST(v_purchase_tx_ids) AS tx(id)
        WHERE il.note LIKE FORMAT('%%financial_transaction_id=%s%%', tx.id::TEXT)
      )
    );

  DELETE FROM public.purchase_orders
  WHERE id = p_purchase_order_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.delete_purchase_order_v2(UUID) TO authenticated;

-- 2) Bump schema_version to 8.5.0
INSERT INTO public.app_schema_meta (key, value)
VALUES ('schema_version', '8.5.0')
ON CONFLICT (key)
DO UPDATE SET
  value = EXCLUDED.value,
  updated_at = NOW();
