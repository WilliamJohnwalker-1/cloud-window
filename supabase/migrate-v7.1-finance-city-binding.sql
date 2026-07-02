-- Migration v7.1: Finance Categories + City Binding
-- Execute after migrate-v7.0-store-invoice-fields.sql

-- Pre-check: Ensure schema version is at least 7.0.0 and not already 7.1.0 or higher
DO $$
BEGIN
  IF public.get_app_schema_version() < '7.0.0' THEN
    RAISE EXCEPTION 'Migration v7.0.0 must be applied before v7.1.0';
  END IF;
  IF public.get_app_schema_version() >= '7.1.0' THEN
    RAISE NOTICE 'Schema version is already 7.1.0 or higher. Migration is idempotent and will continue.';
  END IF;
END $$;

-- Purpose:
-- 1) Add two new system expense categories: 运输费 (sort_index 10) and 其他 (sort_index 11)
-- 2) Add financial_transactions.city_id (nullable FK to cities, ON DELETE SET NULL)
-- 3) Create index on financial_transactions.city_id
-- 4) Backfill city_id from stores.city_id for existing transactions where city_id IS NULL
-- 5) Bump schema_version to 7.1.0
--
-- Scope: additive category seed + column/index + backfill only. No RLS changes, no UI.
-- Depends on: migrate-v6.1-finance.sql (finance_categories + financial_transactions),
--             migrate-v4.0-store-management.sql (stores.city_id).

-- ============================================================
-- 1. Seed new system expense categories (idempotent)
--    ON CONFLICT (name, type) DO NOTHING preserves user edits to sort_index/is_system.
--    Does NOT modify existing category rows.
-- ============================================================
INSERT INTO public.finance_categories (name, type, is_system, sort_index)
VALUES
  ('运输费', 'expense', TRUE, 10),
  ('其他',   'expense', TRUE, 11)
ON CONFLICT (name, type) DO NOTHING;

-- ============================================================
-- 2. financial_transactions: add city_id
--    Nullable FK to cities; ON DELETE SET NULL so deleting a city
--    does not cascade-remove finance history.
-- ============================================================
ALTER TABLE public.financial_transactions
  ADD COLUMN IF NOT EXISTS city_id UUID REFERENCES public.cities(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.financial_transactions.city_id IS 'City binding for city-dimension finance reporting (nullable, backfilled from stores.city_id)';

CREATE INDEX IF NOT EXISTS idx_financial_transactions_city_id
  ON public.financial_transactions(city_id);

-- ============================================================
-- 3. Backfill city_id from stores.city_id
--    Only touches rows where city_id IS NULL and a store binding exists.
--    Idempotent: subsequent runs find no NULL city_id rows to update
--    (unless new rows are inserted without city_id).
-- ============================================================
UPDATE public.financial_transactions ft
SET city_id = s.city_id,
    updated_at = NOW()
FROM public.stores s
WHERE ft.store_id = s.id
  AND ft.city_id IS NULL;

-- ============================================================
-- 4. Bump schema_version to 7.1.0
-- ============================================================
INSERT INTO public.app_schema_meta (key, value)
VALUES ('schema_version', '7.1.0')
ON CONFLICT (key)
DO UPDATE SET
  value = EXCLUDED.value,
  updated_at = NOW();
