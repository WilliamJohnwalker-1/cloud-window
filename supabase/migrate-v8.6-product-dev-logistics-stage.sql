-- v8.6: Product development stage adds logistics between factory_search and launched

ALTER TABLE public.product_developments
  DROP CONSTRAINT IF EXISTS product_developments_stage_check;

ALTER TABLE public.product_developments
  ADD CONSTRAINT product_developments_stage_check
  CHECK (stage IN ('concept', 'artist_search', 'design_finalize', 'factory_search', 'logistics', 'launched'));

COMMENT ON COLUMN public.product_developments.stage IS 'Dev stage: concept, artist_search, design_finalize, factory_search, logistics, launched';

-- Bump schema_version to 8.6.0 (repo convention uses app_schema_meta)
INSERT INTO public.app_schema_meta (key, value)
VALUES ('schema_version', '8.6.0')
ON CONFLICT (key)
DO UPDATE SET
  value = EXCLUDED.value,
  updated_at = NOW();
