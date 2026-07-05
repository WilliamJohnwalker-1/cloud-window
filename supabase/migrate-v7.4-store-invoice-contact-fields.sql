-- Migration v7.4: Store invoice contact fields separation
-- Execute in Supabase SQL Editor
-- Purpose:
-- 1) Add dedicated invoice phone/address fields for admin-maintained invoice info.
-- 2) Keep stores.phone/stores.address semantics for contact/shipping only.
-- 3) Bump schema_version to 7.4.0

DO $$
BEGIN
  IF public.get_app_schema_version() < '7.3.0' THEN
    RAISE EXCEPTION 'Migration v7.3.0 must be applied before v7.4.0';
  END IF;
END $$;

ALTER TABLE public.stores
  ADD COLUMN IF NOT EXISTS invoice_phone TEXT,
  ADD COLUMN IF NOT EXISTS invoice_address TEXT;

COMMENT ON COLUMN public.stores.invoice_phone IS '开票联系电话（独立于店铺联系电话）';
COMMENT ON COLUMN public.stores.invoice_address IS '开票地址（独立于店铺详细地址/寄件地址）';

INSERT INTO public.app_schema_meta (key, value)
VALUES ('schema_version', '7.4.0')
ON CONFLICT (key)
DO UPDATE SET
  value = EXCLUDED.value,
  updated_at = NOW();
