-- Migration v6.1: Finance (financial_transactions + finance_categories + cash_balance)
-- Execute after migrate-v6.0-foundation.sql
-- Purpose:
-- 1) Add finance_categories table (system preset income/expense categories)
-- 2) Add financial_transactions table (income/expense ledger with category/profile/store/supplier FKs)
-- 3) Add cash_balance table (single-row cash on hand tracker)
-- 4) Seed the plan's preset system finance categories (idempotent)
-- 5) RLS: finance can write financial_transactions + cash_balance; admin/super_admin can read
-- 6) Bump schema_version to 6.1.0
--
-- Scope: finance tables + RLS + seed only. No UI, no RPCs, no triggers.
-- Depends on: migrate-v6.0-foundation.sql (suppliers table + finance role + is_finance() helper).

-- ============================================================
-- 1. finance_categories table
-- ============================================================
CREATE TABLE IF NOT EXISTS public.finance_categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('income', 'expense')),
  is_system BOOLEAN NOT NULL DEFAULT FALSE,
  sort_index INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_finance_categories_type_sort
  ON public.finance_categories(type, sort_index);

-- Unique name per type to prevent duplicate system categories
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'finance_categories_name_type_key'
      AND conrelid = 'public.finance_categories'::regclass
  ) THEN
    ALTER TABLE public.finance_categories
      ADD CONSTRAINT finance_categories_name_type_key UNIQUE (name, type);
  END IF;
END $$;

-- ============================================================
-- 2. financial_transactions table
-- ============================================================
CREATE TABLE IF NOT EXISTS public.financial_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  transaction_type TEXT NOT NULL CHECK (transaction_type IN ('income', 'expense')),
  category_id UUID NOT NULL REFERENCES public.finance_categories(id) ON DELETE RESTRICT,
  amount DECIMAL(12, 2) NOT NULL DEFAULT 0,
  transaction_date DATE NOT NULL DEFAULT CURRENT_DATE,
  store_id UUID REFERENCES public.stores(id) ON DELETE SET NULL,
  supplier_id UUID REFERENCES public.suppliers(id) ON DELETE SET NULL,
  channel_name TEXT,
  description TEXT,
  is_recurring BOOLEAN NOT NULL DEFAULT FALSE,
  created_by UUID NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_financial_transactions_category_id
  ON public.financial_transactions(category_id);

CREATE INDEX IF NOT EXISTS idx_financial_transactions_transaction_type_date
  ON public.financial_transactions(transaction_type, transaction_date DESC);

CREATE INDEX IF NOT EXISTS idx_financial_transactions_created_by
  ON public.financial_transactions(created_by);

CREATE INDEX IF NOT EXISTS idx_financial_transactions_store_id
  ON public.financial_transactions(store_id);

CREATE INDEX IF NOT EXISTS idx_financial_transactions_supplier_id
  ON public.financial_transactions(supplier_id);

-- ============================================================
-- 3. cash_balance table (single-row cash on hand tracker)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.cash_balance (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  balance DECIMAL(12, 2) NOT NULL DEFAULT 0,
  last_updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL
);

-- ============================================================
-- 4. Enable RLS
-- ============================================================
ALTER TABLE public.finance_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.financial_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cash_balance ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- 5. RLS policies for finance_categories
--    Readable by all authenticated users (finance needs categories to file transactions;
--    admin/super_admin need them for reporting). Writable by admin/super_admin only.
-- ============================================================
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'finance_categories'
      AND policyname = 'Authenticated users can view finance categories'
  ) THEN
    CREATE POLICY "Authenticated users can view finance categories" ON public.finance_categories
      FOR SELECT TO authenticated USING (true);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'finance_categories'
      AND policyname = 'Admins can manage finance categories'
  ) THEN
    CREATE POLICY "Admins can manage finance categories" ON public.finance_categories
      FOR ALL USING (public.is_admin())
      WITH CHECK (public.is_admin());
  END IF;
END $$;

-- ============================================================
-- 6. RLS policies for financial_transactions
--    Finance can write (insert/update/delete); admin/super_admin can read.
--    is_admin() already includes super_admin (redefined in migrate-v4.3).
-- ============================================================
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'financial_transactions'
      AND policyname = 'Admins can view financial transactions'
  ) THEN
    CREATE POLICY "Admins can view financial transactions" ON public.financial_transactions
      FOR SELECT TO authenticated USING (public.is_admin());
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'financial_transactions'
      AND policyname = 'Finance can insert financial transactions'
  ) THEN
    CREATE POLICY "Finance can insert financial transactions" ON public.financial_transactions
      FOR INSERT TO authenticated
      WITH CHECK (public.is_finance());
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'financial_transactions'
      AND policyname = 'Finance can update financial transactions'
  ) THEN
    CREATE POLICY "Finance can update financial transactions" ON public.financial_transactions
      FOR UPDATE TO authenticated
      USING (public.is_finance())
      WITH CHECK (public.is_finance());
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'financial_transactions'
      AND policyname = 'Finance can delete financial transactions'
  ) THEN
    CREATE POLICY "Finance can delete financial transactions" ON public.financial_transactions
      FOR DELETE TO authenticated
      USING (public.is_finance());
  END IF;
END $$;

-- ============================================================
-- 7. RLS policies for cash_balance
--    Finance can write (insert/update); admin/super_admin can read.
-- ============================================================
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'cash_balance'
      AND policyname = 'Admins can view cash balance'
  ) THEN
    CREATE POLICY "Admins can view cash balance" ON public.cash_balance
      FOR SELECT TO authenticated USING (public.is_admin());
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'cash_balance'
      AND policyname = 'Finance can insert cash balance'
  ) THEN
    CREATE POLICY "Finance can insert cash balance" ON public.cash_balance
      FOR INSERT TO authenticated
      WITH CHECK (public.is_finance());
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'cash_balance'
      AND policyname = 'Finance can update cash balance'
  ) THEN
    CREATE POLICY "Finance can update cash balance" ON public.cash_balance
      FOR UPDATE TO authenticated
      USING (public.is_finance())
      WITH CHECK (public.is_finance());
  END IF;
END $$;

-- ============================================================
-- 8. Seed preset system finance categories (idempotent)
--    ON CONFLICT (name, type) DO NOTHING preserves user edits to sort_index/is_system.
-- ============================================================
INSERT INTO public.finance_categories (name, type, is_system, sort_index)
VALUES
  -- income
  ('线上渠道收入', 'income',  TRUE, 1),
  ('线下店铺回款', 'income',  TRUE, 2),
  -- expense
  ('线上佣金', 'expense', TRUE, 1),
  ('线下返利', 'expense', TRUE, 2),
  ('采购成本', 'expense', TRUE, 3),
  ('设计成本', 'expense', TRUE, 4),
  ('损耗',     'expense', TRUE, 5),
  ('辅料成本', 'expense', TRUE, 6),
  ('差旅费',   'expense', TRUE, 7),
  ('工资',     'expense', TRUE, 8),
  ('房租',     'expense', TRUE, 9)
ON CONFLICT (name, type) DO NOTHING;

-- ============================================================
-- 9. Bump schema_version to 6.1.0
-- ============================================================
INSERT INTO public.app_schema_meta (key, value)
VALUES ('schema_version', '6.1.0')
ON CONFLICT (key)
DO UPDATE SET
  value = EXCLUDED.value,
  updated_at = NOW();