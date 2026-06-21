-- Migration v5.2: Add province column to cities
-- Execute after migrate-v5.1-default-store-selection.sql
-- Purpose:
-- 1) Add nullable province TEXT column to cities table
-- 2) Create index on cities.province for filtering

-- Add province column (idempotent)
ALTER TABLE public.cities
  ADD COLUMN IF NOT EXISTS province TEXT DEFAULT NULL;

-- Create index on province for filtering (idempotent)
CREATE INDEX IF NOT EXISTS idx_cities_province
  ON public.cities(province);

-- Column comment for documentation
COMMENT ON COLUMN public.cities.province IS 'Province/state where the city is located (nullable, to be backfilled)';