-- Migration v3.0: request_id compatibility hotfix for atomic order RPC
-- Execute in Supabase SQL Editor

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS request_id TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_request_id_unique
  ON public.orders(request_id)
  WHERE request_id IS NOT NULL;
