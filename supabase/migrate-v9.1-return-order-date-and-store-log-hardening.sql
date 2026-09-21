-- Migration v9.1: return order hardening, distribution order_date backfill, and product-cost reference strategy update
-- Execute after migrate-v9.0-settlement-confirm-and-cost-autocalc.sql

DO $$
BEGIN
  IF public.get_app_schema_version() < '9.0.0' THEN
    RAISE EXCEPTION 'Migration v9.0.0 must be applied before v9.1.0';
  END IF;
END $$;

-- 1) Backfill historical distribution orders without business date
UPDATE public.orders
SET order_date = (created_at AT TIME ZONE 'Asia/Shanghai')::date
WHERE order_kind = 'distribution'
  AND order_date IS NULL;

-- 2) One-time product cost overwrite by historical delivered quantity/line_total.
--    Keep legacy manual cost when historical recomputed cost is 0.
WITH purchase_agg AS (
  SELECT
    poi.product_id,
    COALESCE(SUM(COALESCE(poi.delivered_quantity, 0)), 0)::INTEGER AS delivered_qty,
    ROUND(COALESCE(SUM(COALESCE(poi.line_total, 0)), 0), 2) AS delivered_cost
  FROM public.purchase_order_items poi
  WHERE COALESCE(poi.delivered_quantity, 0) > 0
  GROUP BY poi.product_id
), recompute AS (
  SELECT
    p.id AS product_id,
    a.delivered_qty,
    a.delivered_cost,
    COALESCE(p.one_time_cost, 0) AS one_time_cost,
    CASE
      WHEN a.delivered_qty > 0 THEN ROUND((a.delivered_cost + COALESCE(p.one_time_cost, 0)) / a.delivered_qty::NUMERIC, 2)
      ELSE NULL
    END AS recalculated_cost
  FROM public.products p
  JOIN purchase_agg a ON a.product_id = p.id
)
UPDATE public.products p
SET cumulative_cost_quantity = r.delivered_qty,
    cumulative_cost_amount = r.delivered_cost,
    cost = r.recalculated_cost,
    updated_at = NOW()
FROM recompute r
WHERE p.id = r.product_id
  AND r.recalculated_cost IS NOT NULL
  AND r.recalculated_cost > 0;

-- 3) Stop full-table order_items cost rewrite trigger.
--    Client/report read path should reference current products.cost/products.one_time_cost at query-time.
CREATE OR REPLACE FUNCTION public.sync_product_cost_to_order_items()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN NEW;
END;
$$;

-- 4) Keep purchase cumulative recompute on products only; do not rewrite historical order_items.
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
  v_one_time_cost NUMERIC(10, 2) := 0;
  v_new_product_cost NUMERIC(10, 2);
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

  SELECT COALESCE(p.one_time_cost, 0)
  INTO v_one_time_cost
  FROM public.products p
  WHERE p.id = p_product_id;

  IF v_new_cum_qty > 0 THEN
    v_new_product_cost := ROUND((v_new_cum_cost + v_one_time_cost) / v_new_cum_qty::NUMERIC, 2);

    UPDATE public.products p
    SET cumulative_cost_quantity = v_new_cum_qty,
        cumulative_cost_amount = v_new_cum_cost,
        cost = v_new_product_cost,
        updated_at = NOW()
    WHERE p.id = p_product_id;
  ELSE
    UPDATE public.products p
    SET cumulative_cost_quantity = 0,
        cumulative_cost_amount = 0,
        cost = NULL,
        updated_at = NOW()
    WHERE p.id = p_product_id;
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.recalc_product_cumulative_from_purchase(UUID) TO authenticated;

-- 5) Ensure delete rollback logs for store-pool always carry store_id (including supply rollback).
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
  v_order_kind TEXT;
  v_started_at TIMESTAMP WITH TIME ZONE := NOW();
  v_product_ids UUID[];
BEGIN
  SELECT role INTO v_role
  FROM public.profiles
  WHERE id = v_uid;

  SELECT * INTO v_order
  FROM public.orders
  WHERE id = p_order_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION '订单不存在';
  END IF;

  SELECT ARRAY_AGG(DISTINCT oi.product_id)
  INTO v_product_ids
  FROM public.order_items oi
  WHERE oi.order_id = p_order_id;

  v_order_kind := COALESCE(v_order.order_kind::TEXT, 'distribution');

  IF v_order_kind = 'settlement' AND v_order.confirmed_at IS NOT NULL THEN
    IF NOT (
      v_role IN ('admin', 'super_admin', 'inventory_manager')
      OR v_order.distributor_id = v_uid
    ) THEN
      RAISE EXCEPTION '当前账号无删除订单权限';
    END IF;

    RAISE EXCEPTION '已确认结算单不能删除';
  END IF;

  PERFORM public.delete_order_with_inventory_restore_atomic_v88(p_order_id);

  IF v_order.store_id IS NOT NULL THEN
    UPDATE public.inventory_logs il
    SET store_id = v_order.store_id
    WHERE il.store_id IS NULL
      AND il.operator_id = v_uid
      AND il.created_at >= v_started_at
      AND il.note IN ('删单回滚(店铺池)', '删单回滚(退货店铺池)')
      AND (
        v_product_ids IS NULL
        OR il.product_id = ANY(v_product_ids)
      );
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.delete_order_with_inventory_restore_atomic(UUID) TO authenticated;

INSERT INTO public.app_schema_meta (key, value)
VALUES ('schema_version', '9.1.0')
ON CONFLICT (key)
DO UPDATE SET
  value = EXCLUDED.value,
  updated_at = NOW();
