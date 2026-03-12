-- Migration v2.8: Payment fields + payment event ledger
-- Execute in Supabase SQL Editor

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS payment_amount DECIMAL(10, 2),
  ADD COLUMN IF NOT EXISTS payment_status TEXT,
  ADD COLUMN IF NOT EXISTS payment_method TEXT,
  ADD COLUMN IF NOT EXISTS payment_transaction_id TEXT,
  ADD COLUMN IF NOT EXISTS payment_paid_at TIMESTAMP WITH TIME ZONE;

CREATE TABLE IF NOT EXISTS public.payment_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  idempotency_key TEXT NOT NULL UNIQUE,
  channel TEXT NOT NULL,
  out_trade_no TEXT,
  transaction_id TEXT,
  notify_id TEXT,
  event_type TEXT NOT NULL,
  status TEXT NOT NULL,
  amount DECIMAL(10, 2),
  processed BOOLEAN NOT NULL DEFAULT false,
  payload JSONB,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

ALTER TABLE public.payment_events ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "Admins can view payment events" ON public.payment_events
    FOR SELECT TO authenticated
    USING (
      EXISTS (
        SELECT 1
        FROM public.profiles
        WHERE id = auth.uid()
          AND role = 'admin'
      )
    );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS idx_payment_events_created_at ON public.payment_events(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_payment_events_out_trade_no ON public.payment_events(out_trade_no);
CREATE INDEX IF NOT EXISTS idx_payment_events_transaction_id ON public.payment_events(transaction_id);
