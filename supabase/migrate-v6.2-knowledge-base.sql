-- Migration v6.2: Knowledge Base (knowledge_base_files table + storage bucket)
-- Execute in Supabase SQL Editor
-- Purpose:
-- 1) Add knowledge_base_files table for internal document management
-- 2) Add RLS: admin/super_admin can write; finance and inventory_manager can read; distributor cannot read
-- 3) Bump schema_version to 6.2.0
--
-- Storage bucket policies for the 'knowledge-base' bucket are in storage-policies.sql.
-- The 'knowledge-base' bucket is PRIVATE (public = false) so that storage RLS enforces
-- role-gated reads. Do NOT make it public — that would bypass the intended access control.

-- ============================================================
-- 1. knowledge_base_files table
-- ============================================================
CREATE TABLE IF NOT EXISTS public.knowledge_base_files (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  file_name TEXT NOT NULL,
  file_path TEXT NOT NULL,
  file_size BIGINT NOT NULL DEFAULT 0,
  file_type TEXT,
  category TEXT NOT NULL DEFAULT 'other'
    CHECK (category IN ('contract_template', 'internal_contract', 'business_license', 'other')),
  uploaded_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

COMMENT ON TABLE public.knowledge_base_files IS 'Knowledge base document registry (internal contracts, templates, licenses)';

-- ============================================================
-- 2. Indexes
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_knowledge_base_files_category
  ON public.knowledge_base_files(category);

CREATE INDEX IF NOT EXISTS idx_knowledge_base_files_uploaded_by
  ON public.knowledge_base_files(uploaded_by);

CREATE INDEX IF NOT EXISTS idx_knowledge_base_files_created_at
  ON public.knowledge_base_files(created_at DESC);

-- ============================================================
-- 3. Enable RLS
-- ============================================================
ALTER TABLE public.knowledge_base_files ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- 4. RLS policies for knowledge_base_files
--    Write: admin / super_admin (via is_admin())
--    Read: finance and inventory_manager (and admin/super_admin via write policy FOR ALL)
--    Distributor: cannot read (no matching policy)
-- ============================================================

-- Admin / super_admin can perform all operations (includes read).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'knowledge_base_files'
      AND policyname = 'Admins can manage knowledge base files'
  ) THEN
    CREATE POLICY "Admins can manage knowledge base files" ON public.knowledge_base_files
      FOR ALL USING (public.is_admin())
      WITH CHECK (public.is_admin());
  END IF;
END $$;

-- Finance can read.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'knowledge_base_files'
      AND policyname = 'Finance can view knowledge base files'
  ) THEN
    CREATE POLICY "Finance can view knowledge base files" ON public.knowledge_base_files
      FOR SELECT TO authenticated
      USING (public.is_finance());
  END IF;
END $$;

-- Inventory managers can read.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'knowledge_base_files'
      AND policyname = 'Inventory managers can view knowledge base files'
  ) THEN
    CREATE POLICY "Inventory managers can view knowledge base files" ON public.knowledge_base_files
      FOR SELECT TO authenticated
      USING (public.is_inventory_manager());
  END IF;
END $$;

-- ============================================================
-- 5. Bump schema_version to 6.2.0
-- ============================================================
INSERT INTO public.app_schema_meta (key, value)
VALUES ('schema_version', '6.2.0')
ON CONFLICT (key)
DO UPDATE SET
  value = EXCLUDED.value,
  updated_at = NOW();