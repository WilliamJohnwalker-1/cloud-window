-- Migration v6.5: slow-moving inventory alert notifications
-- Execute after migrate-v6.4-financial-backfill.sql

-- Pre-check: Ensure schema version is at least 6.4.0
DO $$
BEGIN
  IF public.get_app_schema_version() < '6.4.0' THEN
    RAISE EXCEPTION 'Migration v6.4.0 must be applied before v6.5.0';
  END IF;
END $$;

-- ============================================================
-- Execute after migrate-v6.4-financial-backfill.sql

-- ============================================================
-- 1) Expand notifications type CHECK to include inventory_slow_moving_alert
-- ============================================================
DO $$
DECLARE
  v_constraint_name TEXT;
BEGIN
  SELECT con.conname
  INTO v_constraint_name
  FROM pg_constraint con
  JOIN pg_class rel ON rel.oid = con.conrelid
  JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
  WHERE nsp.nspname = 'public'
    AND rel.relname = 'notifications'
    AND con.contype = 'c'
    AND pg_get_constraintdef(con.oid) ILIKE '%type%';

  IF v_constraint_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE public.notifications DROP CONSTRAINT %I', v_constraint_name);
  END IF;
END $$;

ALTER TABLE public.notifications
  ADD CONSTRAINT notifications_type_check
  CHECK (
    type IN (
      'new_order',
      'order_accepted',
      'refund_requested',
      'refund_approved',
      'refund_rejected',
      'refund_completed',
      'refund_failed',
      'inventory_alert',
      'inventory_slow_moving_alert'
    )
  );

-- ============================================================
-- 2) Slow-moving inventory alert notification RPC
--    Dedupes once per day per scope so mobile/web can both trigger safely.
-- ============================================================
CREATE OR REPLACE FUNCTION public.create_inventory_slow_moving_alert_notifications(
  p_scope_label TEXT,
  p_slow_value_ratio NUMERIC,
  p_slow_inventory_cost NUMERIC,
  p_total_inventory_cost NUMERIC
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_scope_label TEXT := NULLIF(BTRIM(COALESCE(p_scope_label, '')), '');
  v_actor_role TEXT;
  v_ratio NUMERIC := COALESCE(p_slow_value_ratio, 0);
  v_slow_inventory_cost NUMERIC := GREATEST(COALESCE(p_slow_inventory_cost, 0), 0);
  v_total_inventory_cost NUMERIC := GREATEST(COALESCE(p_total_inventory_cost, 0), 0);
  v_message_prefix TEXT;
  v_message TEXT;
  v_inserted_count INTEGER := 0;
BEGIN
  SELECT role
  INTO v_actor_role
  FROM public.profiles
  WHERE id = auth.uid();

  IF v_actor_role NOT IN ('admin', 'super_admin', 'inventory_manager') THEN
    RAISE EXCEPTION '当前角色无滞销告警权限';
  END IF;

  IF v_total_inventory_cost <= 0 OR v_ratio <= 0.15 THEN
    RETURN 0;
  END IF;

  IF v_scope_label IS NULL THEN
    v_scope_label := '全部范围';
  END IF;

  v_message_prefix := format('滞销库存告警：%s', v_scope_label);
  v_message := format(
    '%s 滞销库存成本占比 %s%%，已超过 15%% 阈值（滞销货值 ¥%s / 总库存货值 ¥%s）',
    v_message_prefix,
    TO_CHAR(ROUND(v_ratio * 100, 2), 'FM999999990.00'),
    TO_CHAR(ROUND(v_slow_inventory_cost, 2), 'FM999999990.00'),
    TO_CHAR(ROUND(v_total_inventory_cost, 2), 'FM999999990.00')
  );

  INSERT INTO public.notifications (user_id, type, message, is_read)
  SELECT
    prof.id,
    'inventory_slow_moving_alert',
    v_message,
    FALSE
  FROM public.profiles prof
  WHERE prof.role IN ('admin', 'super_admin')
    AND NOT EXISTS (
      SELECT 1
      FROM public.notifications notif
      WHERE notif.user_id = prof.id
        AND notif.type = 'inventory_slow_moving_alert'
        AND notif.created_at >= date_trunc('day', NOW())
        AND LEFT(notif.message, CHAR_LENGTH(v_message_prefix)) = v_message_prefix
    );

  GET DIAGNOSTICS v_inserted_count = ROW_COUNT;
  RETURN v_inserted_count;
END;
$$;

REVOKE ALL ON FUNCTION public.create_inventory_slow_moving_alert_notifications(TEXT, NUMERIC, NUMERIC, NUMERIC) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_inventory_slow_moving_alert_notifications(TEXT, NUMERIC, NUMERIC, NUMERIC) TO authenticated;

-- ============================================================
-- 3) Schema version gate
-- ============================================================
INSERT INTO public.app_schema_meta (key, value)
VALUES ('schema_version', '6.5.0')
ON CONFLICT (key)
DO UPDATE SET
  value = EXCLUDED.value,
  updated_at = NOW();
