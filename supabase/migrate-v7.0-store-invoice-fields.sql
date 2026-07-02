-- Migration v7.0: Store Invoice Fields
-- Execute in Supabase SQL Editor
-- Purpose:
-- 1) Add stores.invoice_title TEXT (nullable)
-- 2) Add stores.tax_id TEXT (nullable)
-- 3) Add stores.bank_name TEXT (nullable)
-- 4) Add stores.bank_account TEXT (nullable)
-- 5) Bump schema_version to 7.0.0
--
-- Scope: invoice fields + comments only. No constraints, indexes, RLS policy
--        changes, or data backfills. Existing stores RLS policies already
--        cover the table and require no modification.

-- ============================================================
-- 1. stores invoice fields
-- ============================================================
ALTER TABLE public.stores
  ADD COLUMN IF NOT EXISTS invoice_title TEXT;

ALTER TABLE public.stores
  ADD COLUMN IF NOT EXISTS tax_id TEXT;

ALTER TABLE public.stores
  ADD COLUMN IF NOT EXISTS bank_name TEXT;

ALTER TABLE public.stores
  ADD COLUMN IF NOT EXISTS bank_account TEXT;

COMMENT ON COLUMN public.stores.invoice_title IS '发票抬头（可空，用于店铺开票信息展示与复制）';
COMMENT ON COLUMN public.stores.tax_id IS '纳税人识别号（可空，用于店铺开票信息展示与复制）';
COMMENT ON COLUMN public.stores.bank_name IS '开户银行名称（可空，用于店铺开票信息展示与复制）';
COMMENT ON COLUMN public.stores.bank_account IS '银行账号（可空，用于店铺开票信息展示与复制）';

-- ============================================================
-- 2. Bump schema_version to 7.0.0
-- ============================================================
INSERT INTO public.app_schema_meta (key, value)
VALUES ('schema_version', '7.0.0')
ON CONFLICT (key)
DO UPDATE SET
  value = EXCLUDED.value,
  updated_at = NOW();
