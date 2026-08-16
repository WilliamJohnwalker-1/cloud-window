-- Migration v8.1: Product development pin support
-- Purpose:
-- 1) Add is_pinned to product_developments (max two pins enforced by app layer)

ALTER TABLE public.product_developments
  ADD COLUMN IF NOT EXISTS is_pinned BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN public.product_developments.is_pinned IS 'Whether this development project is pinned to top in UI';

CREATE INDEX IF NOT EXISTS idx_product_developments_is_pinned
  ON public.product_developments(is_pinned);
