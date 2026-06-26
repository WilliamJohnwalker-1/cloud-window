-- Migration v6.0: Foundation (suppliers + product_series + stores enhancement + finance role)
-- Execute in Supabase SQL Editor
-- Purpose:
-- 1) Add suppliers table (vendor master data)
-- 2) Add product_series table (product grouping by series)
-- 3) Add products.series_id FK column
-- 4) Add stores.contract_expiry_date / stores.grade / stores.contract_file_url
-- 5) Expand profiles.role CHECK to include 'finance'
-- 6) Add RLS for suppliers and product_series
-- 7) Seed 4 initial product series rows
-- 8) Bump schema_version to 6.0.0

-- ============================================================
-- 1. suppliers table
-- ============================================================
CREATE TABLE IF NOT EXISTS public.suppliers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_name TEXT NOT NULL,
  delivery_cycle_days INTEGER,
  avg_unit_price DECIMAL(10, 2),
  contact TEXT,
  phone TEXT,
  address TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ============================================================
-- 2. product_series table
-- ============================================================
CREATE TABLE IF NOT EXISTS public.product_series (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE,
  sort_index INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ============================================================
-- 3. products.series_id FK column
-- ============================================================
ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS series_id UUID REFERENCES public.product_series(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.products.series_id IS 'Product series grouping (nullable, set NULL on series delete)';

-- ============================================================
-- 4. stores enhancement columns
-- ============================================================
ALTER TABLE public.stores
  ADD COLUMN IF NOT EXISTS contract_expiry_date DATE;

ALTER TABLE public.stores
  ADD COLUMN IF NOT EXISTS grade TEXT;

ALTER TABLE public.stores
  ADD COLUMN IF NOT EXISTS contract_file_url TEXT;

COMMENT ON COLUMN public.stores.contract_expiry_date IS 'Store contract expiry date (nullable)';
COMMENT ON COLUMN public.stores.grade IS 'Store grade tier (nullable, S/A/B/C/D/E)';
COMMENT ON COLUMN public.stores.contract_file_url IS 'URL to stored contract file (nullable)';

-- Idempotent CHECK constraint for stores.grade (S/A/B/C/D/E, nullable)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'stores_grade_check'
      AND conrelid = 'public.stores'::regclass
  ) THEN
    ALTER TABLE public.stores
      ADD CONSTRAINT stores_grade_check
      CHECK (grade IS NULL OR grade IN ('S', 'A', 'B', 'C', 'D', 'E'));
  END IF;
END $$;

-- ============================================================
-- 5. Expand profiles.role CHECK to include 'finance'
-- ============================================================
ALTER TABLE public.profiles
  DROP CONSTRAINT IF EXISTS profiles_role_check;

ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_role_check
  CHECK (role IN ('admin', 'super_admin', 'distributor', 'inventory_manager', 'finance'));

-- ============================================================
-- 6. Helper functions for new roles (follows v3.9 pattern)
-- ============================================================
CREATE OR REPLACE FUNCTION public.is_super_admin(
  p_uid UUID DEFAULT auth.uid()
)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(public.current_user_role(p_uid) = 'super_admin', FALSE)
$$;

CREATE OR REPLACE FUNCTION public.is_finance(
  p_uid UUID DEFAULT auth.uid()
)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(public.current_user_role(p_uid) = 'finance', FALSE)
$$;

GRANT EXECUTE ON FUNCTION public.is_super_admin(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_finance(UUID) TO authenticated;

-- ============================================================
-- 7. Indexes
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_suppliers_status
  ON public.suppliers(status);

CREATE INDEX IF NOT EXISTS idx_product_series_sort_index
  ON public.product_series(sort_index);

CREATE INDEX IF NOT EXISTS idx_products_series_id
  ON public.products(series_id);

-- ============================================================
-- 8. Enable RLS
-- ============================================================
ALTER TABLE public.suppliers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.product_series ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- 9. RLS policies for suppliers
--    Writable by super_admin only; readable by finance and super_admin.
-- ============================================================
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'suppliers'
      AND policyname = 'Super admins can manage suppliers'
  ) THEN
    CREATE POLICY "Super admins can manage suppliers" ON public.suppliers
      FOR ALL USING (public.is_super_admin())
      WITH CHECK (public.is_super_admin());
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'suppliers'
      AND policyname = 'Finance can view suppliers'
  ) THEN
    CREATE POLICY "Finance can view suppliers" ON public.suppliers
      FOR SELECT TO authenticated
      USING (public.is_finance());
  END IF;
END $$;

-- ============================================================
-- 10. RLS policies for product_series
--     Writable by admin/super_admin; readable by all authenticated users
--     (distributors need series names when viewing product details).
-- ============================================================
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'product_series'
      AND policyname = 'Admins can manage product series'
  ) THEN
    CREATE POLICY "Admins can manage product series" ON public.product_series
      FOR ALL USING (public.is_admin())
      WITH CHECK (public.is_admin());
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'product_series'
      AND policyname = 'Authenticated users can view product series'
  ) THEN
    CREATE POLICY "Authenticated users can view product series" ON public.product_series
      FOR SELECT TO authenticated USING (true);
  END IF;
END $$;

-- ============================================================
-- 11. Seed 4 initial product series rows (idempotent)
-- ============================================================
INSERT INTO public.product_series (name, sort_index)
VALUES
  ('朋友圈', 1),
  ('九宫格明信片', 2),
  ('地标四件套', 3),
  ('美食四件套', 4)
ON CONFLICT (name) DO NOTHING;

-- ============================================================
-- 12. Bump schema_version to 6.0.0
-- ============================================================
INSERT INTO public.app_schema_meta (key, value)
VALUES ('schema_version', '6.0.0')
ON CONFLICT (key)
DO UPDATE SET
  value = EXCLUDED.value,
  updated_at = NOW();