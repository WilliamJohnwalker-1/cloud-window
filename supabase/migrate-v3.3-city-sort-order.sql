-- Migration v3.3: admin-managed city sort order
-- Execute in Supabase SQL Editor

ALTER TABLE public.cities
  ADD COLUMN IF NOT EXISTS sort_index INTEGER NOT NULL DEFAULT 0;

WITH ranked AS (
  SELECT id, ROW_NUMBER() OVER (ORDER BY name ASC, created_at ASC) AS rn
  FROM public.cities
)
UPDATE public.cities c
SET sort_index = ranked.rn
FROM ranked
WHERE c.id = ranked.id
  AND (c.sort_index IS NULL OR c.sort_index = 0);

CREATE INDEX IF NOT EXISTS idx_cities_sort_index
  ON public.cities(sort_index, name);

INSERT INTO public.app_schema_meta (key, value)
VALUES ('schema_version', '3.3.0')
ON CONFLICT (key)
DO UPDATE SET
  value = EXCLUDED.value,
  updated_at = NOW();
