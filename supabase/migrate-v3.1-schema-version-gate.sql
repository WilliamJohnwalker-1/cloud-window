-- Migration v3.1: Schema version gate for Web client
-- Execute in Supabase SQL Editor

CREATE TABLE IF NOT EXISTS public.app_schema_meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.app_schema_meta ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS app_schema_meta_read_authenticated ON public.app_schema_meta;
CREATE POLICY app_schema_meta_read_authenticated
  ON public.app_schema_meta
  FOR SELECT
  TO authenticated
  USING (true);

INSERT INTO public.app_schema_meta (key, value)
VALUES ('schema_version', '3.1.0')
ON CONFLICT (key)
DO UPDATE SET
  value = EXCLUDED.value,
  updated_at = NOW();

CREATE OR REPLACE FUNCTION public.get_app_schema_version()
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_version TEXT;
BEGIN
  SELECT value
  INTO v_version
  FROM public.app_schema_meta
  WHERE key = 'schema_version'
  LIMIT 1;

  RETURN COALESCE(v_version, '0.0.0');
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_app_schema_version() TO authenticated;
