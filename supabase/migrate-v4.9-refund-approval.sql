-- Migration v4.9: Refund request approval workflow + notification type expansion
-- Execute in Supabase SQL Editor

CREATE TABLE IF NOT EXISTS public.refund_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  requester_user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  approver_user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'completed', 'failed')),
  reason TEXT NOT NULL DEFAULT '门店退款',
  requested_item_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
  requested_amount DECIMAL(10, 2) NOT NULL DEFAULT 0,
  reject_reason TEXT,
  provider_response JSONB,
  approved_at TIMESTAMPTZ,
  rejected_at TIMESTAMPTZ,
  processed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_refund_requests_approver_status_created
  ON public.refund_requests(approver_user_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_refund_requests_order_status
  ON public.refund_requests(order_id, status);

ALTER TABLE public.refund_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS refund_requests_select_policy ON public.refund_requests;
CREATE POLICY refund_requests_select_policy
  ON public.refund_requests
  FOR SELECT
  TO authenticated
  USING (
    auth.uid() = requester_user_id
    OR auth.uid() = approver_user_id
    OR public.is_admin()
  );

DROP POLICY IF EXISTS refund_requests_insert_policy ON public.refund_requests;
CREATE POLICY refund_requests_insert_policy
  ON public.refund_requests
  FOR INSERT
  TO authenticated
  WITH CHECK (
    auth.uid() = requester_user_id
    OR public.is_admin()
  );

DROP POLICY IF EXISTS refund_requests_update_policy ON public.refund_requests;
CREATE POLICY refund_requests_update_policy
  ON public.refund_requests
  FOR UPDATE
  TO authenticated
  USING (
    auth.uid() = approver_user_id
    OR public.is_admin()
  )
  WITH CHECK (
    auth.uid() = approver_user_id
    OR public.is_admin()
  );

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
      'refund_failed'
    )
  );

INSERT INTO public.app_schema_meta (key, value)
VALUES ('schema_version', '4.9.0')
ON CONFLICT (key)
DO UPDATE SET
  value = EXCLUDED.value,
  updated_at = NOW();
