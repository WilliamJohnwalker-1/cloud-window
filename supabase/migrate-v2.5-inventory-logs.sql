-- Migration v2.5: Inventory logs for inbound/adjust operations
-- Execute in Supabase SQL Editor

CREATE TABLE IF NOT EXISTS public.inventory_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id UUID NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  operator_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  action TEXT NOT NULL CHECK (action IN ('inbound', 'manual_adjust', 'quick_add', 'quick_reduce')),
  delta_quantity INTEGER NOT NULL,
  before_quantity INTEGER NOT NULL,
  after_quantity INTEGER NOT NULL,
  note TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

ALTER TABLE public.inventory_logs ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "Admins and inventory managers can view inventory logs" ON public.inventory_logs
    FOR SELECT TO authenticated
    USING (
      EXISTS (
        SELECT 1
        FROM public.profiles
        WHERE id = auth.uid()
          AND role IN ('admin', 'inventory_manager')
      )
    );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "Admins and inventory managers can insert inventory logs" ON public.inventory_logs
    FOR INSERT TO authenticated
    WITH CHECK (
      EXISTS (
        SELECT 1
        FROM public.profiles
        WHERE id = auth.uid()
          AND role IN ('admin', 'inventory_manager')
      )
      AND auth.uid() = operator_id
    );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS idx_inventory_logs_product_id ON public.inventory_logs(product_id);
CREATE INDEX IF NOT EXISTS idx_inventory_logs_created_at ON public.inventory_logs(created_at DESC);
