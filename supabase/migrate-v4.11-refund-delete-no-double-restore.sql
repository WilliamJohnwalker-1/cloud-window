-- Migration v4.11: avoid duplicate inventory restore when deleting fully refunded orders
-- Execute in Supabase SQL Editor

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

  IF NOT (
    v_role IN ('admin', 'super_admin', 'inventory_manager')
    OR v_order.distributor_id = v_uid
  ) THEN
    RAISE EXCEPTION '当前账号无删除订单权限';
  END IF;

  -- Fully refunded orders already returned inventory via refund workflow.
  -- Delete only, without another restore, to prevent duplicate rollback.
  IF LOWER(COALESCE(v_order.payment_status::TEXT, '')) = 'refunded' THEN
    DELETE FROM public.orders WHERE id = p_order_id;
    RETURN;
  END IF;

  -- Branch 1: Store retail mobile order (retail + store_id + msr: prefix)
  -- Restore to store_inventory only; public.inventory was never debited
  IF COALESCE(v_order.order_kind::TEXT, 'distribution') = 'retail'
     AND v_order.store_id IS NOT NULL
     AND v_order.request_id LIKE 'msr:%' THEN
    INSERT INTO public.store_inventory (store_id, product_id, quantity, updated_at)
    SELECT
      v_order.store_id,
      agg.product_id,
      agg.total_qty,
      NOW()
    FROM (
      SELECT oi.product_id, COALESCE(SUM(oi.quantity), 0)::INTEGER AS total_qty
      FROM public.order_items oi
      WHERE oi.order_id = p_order_id
      GROUP BY oi.product_id
    ) agg
    ON CONFLICT (store_id, product_id)
    DO UPDATE SET
      quantity = public.store_inventory.quantity + EXCLUDED.quantity,
      updated_at = NOW();

  -- Branch 2: Global-source orders (distribution / non-store retail / legacy)
  ELSE
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

    IF v_order.store_id IS NOT NULL
       AND COALESCE(v_order.order_kind::TEXT, 'distribution') = 'distribution' THEN
      UPDATE public.store_inventory si
      SET quantity = si.quantity - agg.store_qty,
          updated_at = NOW()
      FROM (
        SELECT
          oi.product_id,
          COALESCE(SUM(CASE WHEN oi.is_sample THEN 0 ELSE oi.quantity END), 0)::INTEGER AS store_qty
        FROM public.order_items oi
        WHERE oi.order_id = p_order_id
        GROUP BY oi.product_id
      ) agg
      WHERE si.store_id = v_order.store_id
        AND si.product_id = agg.product_id
        AND agg.store_qty > 0;
    END IF;
  END IF;

  DELETE FROM public.orders WHERE id = p_order_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.delete_order_with_inventory_restore_atomic(UUID) TO authenticated;

INSERT INTO public.app_schema_meta (key, value)
VALUES ('schema_version', '4.11.0')
ON CONFLICT (key)
DO UPDATE SET
  value = EXCLUDED.value,
  updated_at = NOW();
