-- Migration v8.8: support return order kind and safe delete rollback for return orders

ALTER TABLE public.orders
  DROP CONSTRAINT IF EXISTS orders_order_kind_check;

ALTER TABLE public.orders
  ADD CONSTRAINT orders_order_kind_check
  CHECK (order_kind IN ('distribution', 'return', 'retail', 'settlement', 'purchase', 'external'));

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_proc
    WHERE proname = 'delete_order_with_inventory_restore_atomic'
      AND pg_function_is_visible(oid)
  ) AND NOT EXISTS (
    SELECT 1
    FROM pg_proc
    WHERE proname = 'delete_order_with_inventory_restore_atomic_legacy'
      AND pg_function_is_visible(oid)
  ) THEN
    ALTER FUNCTION public.delete_order_with_inventory_restore_atomic(UUID)
      RENAME TO delete_order_with_inventory_restore_atomic_legacy;
  END IF;
END;
$$;

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

  v_order_kind := COALESCE(v_order.order_kind::TEXT, 'distribution');

  IF v_order_kind <> 'return' THEN
    PERFORM public.delete_order_with_inventory_restore_atomic_legacy(p_order_id);
    RETURN;
  END IF;

  IF NOT (
    v_role IN ('admin', 'super_admin', 'inventory_manager')
    OR v_order.distributor_id = v_uid
  ) THEN
    RAISE EXCEPTION '当前账号无删除订单权限';
  END IF;

  IF v_order.store_id IS NULL THEN
    RAISE EXCEPTION '退货单缺少店铺信息';
  END IF;

  IF v_order.status = 'accepted' THEN
    CREATE TEMP TABLE IF NOT EXISTS _delete_return_agg_tmp (
      product_id UUID PRIMARY KEY,
      total_qty INTEGER NOT NULL
    ) ON COMMIT DROP;

    TRUNCATE TABLE _delete_return_agg_tmp;

    INSERT INTO _delete_return_agg_tmp (product_id, total_qty)
    SELECT
      oi.product_id,
      COALESCE(SUM(oi.quantity), 0)::INTEGER AS total_qty
    FROM public.order_items oi
    WHERE oi.order_id = p_order_id
    GROUP BY oi.product_id;

    IF EXISTS (
      SELECT 1
      FROM _delete_return_agg_tmp a
      JOIN public.inventory i ON i.product_id = a.product_id
      WHERE COALESCE(i.quantity, 0) < a.total_qty
    ) THEN
      RAISE EXCEPTION '总仓库存不足，无法删除退货单';
    END IF;

    CREATE TEMP TABLE IF NOT EXISTS _delete_return_before_tmp (
      product_id UUID PRIMARY KEY,
      total_qty INTEGER NOT NULL,
      before_main_quantity INTEGER NOT NULL,
      before_store_quantity INTEGER NOT NULL
    ) ON COMMIT DROP;

    TRUNCATE TABLE _delete_return_before_tmp;

    INSERT INTO _delete_return_before_tmp (
      product_id,
      total_qty,
      before_main_quantity,
      before_store_quantity
    )
    SELECT
      a.product_id,
      a.total_qty,
      COALESCE(i.quantity, 0) AS before_main_quantity,
      COALESCE(si.quantity, 0) AS before_store_quantity
    FROM _delete_return_agg_tmp a
    LEFT JOIN public.inventory i
      ON i.product_id = a.product_id
    LEFT JOIN public.store_inventory si
      ON si.store_id = v_order.store_id
     AND si.product_id = a.product_id;

    UPDATE public.inventory i
    SET quantity = b.before_main_quantity - b.total_qty,
        updated_at = NOW()
    FROM _delete_return_before_tmp b
    WHERE i.product_id = b.product_id;

    INSERT INTO public.store_inventory (store_id, product_id, quantity, updated_at)
    SELECT
      v_order.store_id,
      b.product_id,
      b.before_store_quantity + b.total_qty,
      NOW()
    FROM _delete_return_before_tmp b
    ON CONFLICT (store_id, product_id)
    DO UPDATE SET
      quantity = EXCLUDED.quantity,
      updated_at = NOW();

    INSERT INTO public.inventory_logs (
      product_id,
      operator_id,
      action,
      delta_quantity,
      before_quantity,
      after_quantity,
      note
    )
    SELECT
      b.product_id,
      v_uid,
      'refund_restore',
      -b.total_qty,
      b.before_main_quantity,
      b.before_main_quantity - b.total_qty,
      '删单回滚(退货总仓)'
    FROM _delete_return_before_tmp b;

    INSERT INTO public.inventory_logs (
      product_id,
      operator_id,
      action,
      delta_quantity,
      before_quantity,
      after_quantity,
      note
    )
    SELECT
      b.product_id,
      v_uid,
      'refund_restore',
      b.total_qty,
      b.before_store_quantity,
      b.before_store_quantity + b.total_qty,
      '删单回滚(退货店铺池)'
    FROM _delete_return_before_tmp b;
  ELSIF v_order.status <> 'pending' THEN
    RAISE EXCEPTION '退货单状态不可删除';
  END IF;

  DELETE FROM public.order_items
  WHERE order_id = p_order_id;

  DELETE FROM public.orders
  WHERE id = p_order_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.delete_order_with_inventory_restore_atomic(UUID) TO authenticated;

INSERT INTO public.app_schema_meta (key, value)
VALUES ('schema_version', '8.8.0')
ON CONFLICT (key)
DO UPDATE SET
  value = EXCLUDED.value,
  updated_at = NOW();
