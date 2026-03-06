-- Migration v2.2: lock unit_cost snapshot into order_items
-- Execute in Supabase SQL Editor

ALTER TABLE public.order_items
  ADD COLUMN IF NOT EXISTS unit_cost DECIMAL(10,2) NOT NULL DEFAULT 0;

-- Backfill existing rows using current product unit cost (best-effort baseline)
UPDATE public.order_items oi
SET unit_cost = COALESCE(p.cost, 0)
FROM public.products p
WHERE oi.product_id = p.id
  AND (oi.unit_cost IS NULL OR oi.unit_cost = 0);
