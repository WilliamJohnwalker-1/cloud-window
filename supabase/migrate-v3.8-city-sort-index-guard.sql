-- Migration v3.8: prevent city sort_index conflicts and keep append-only inserts
-- Execute in Supabase SQL Editor

ALTER TABLE public.cities
  ADD COLUMN IF NOT EXISTS sort_index INTEGER;

WITH ordered AS (
  SELECT
    id,
    ROW_NUMBER() OVER (
      ORDER BY
        COALESCE(sort_index, 2147483647) ASC,
        created_at ASC,
        name ASC,
        id ASC
    ) AS rn
  FROM public.cities
)
UPDATE public.cities c
SET sort_index = ordered.rn
FROM ordered
WHERE c.id = ordered.id;

ALTER TABLE public.cities
  ALTER COLUMN sort_index SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'cities_sort_index_unique'
      AND conrelid = 'public.cities'::regclass
  ) THEN
    ALTER TABLE public.cities
      ADD CONSTRAINT cities_sort_index_unique
      UNIQUE (sort_index)
      DEFERRABLE INITIALLY IMMEDIATE;
  END IF;
END
$$;

CREATE OR REPLACE FUNCTION public.assign_city_sort_index_on_insert()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_max_sort_index INTEGER;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('public.cities.sort_index', 0));

  IF NEW.sort_index IS NULL OR NEW.sort_index <= 0 OR EXISTS (
    SELECT 1 FROM public.cities WHERE sort_index = NEW.sort_index
  ) THEN
    SELECT COALESCE(MAX(sort_index), 0)
    INTO v_max_sort_index
    FROM public.cities;

    NEW.sort_index := v_max_sort_index + 1;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_assign_city_sort_index_on_insert ON public.cities;

CREATE TRIGGER trg_assign_city_sort_index_on_insert
BEFORE INSERT ON public.cities
FOR EACH ROW
EXECUTE FUNCTION public.assign_city_sort_index_on_insert();

CREATE OR REPLACE FUNCTION public.swap_city_sort_order(
  p_city_id UUID,
  p_direction TEXT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_role TEXT;
  v_current public.cities%ROWTYPE;
  v_target public.cities%ROWTYPE;
BEGIN
  IF p_direction NOT IN ('up', 'down') THEN
    RAISE EXCEPTION 'invalid direction';
  END IF;

  SELECT role INTO v_role FROM public.profiles WHERE id = v_uid;
  IF v_role IS DISTINCT FROM 'admin' THEN
    RAISE EXCEPTION 'only admin can reorder cities';
  END IF;

  SELECT * INTO v_current
  FROM public.cities
  WHERE id = p_city_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'city not found';
  END IF;

  IF p_direction = 'up' THEN
    SELECT * INTO v_target
    FROM public.cities
    WHERE sort_index < v_current.sort_index
    ORDER BY sort_index DESC
    LIMIT 1
    FOR UPDATE;
  ELSE
    SELECT * INTO v_target
    FROM public.cities
    WHERE sort_index > v_current.sort_index
    ORDER BY sort_index ASC
    LIMIT 1
    FOR UPDATE;
  END IF;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  SET CONSTRAINTS cities_sort_index_unique DEFERRED;

  UPDATE public.cities
  SET sort_index = v_target.sort_index
  WHERE id = v_current.id;

  UPDATE public.cities
  SET sort_index = v_current.sort_index
  WHERE id = v_target.id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.swap_city_sort_order(UUID, TEXT) TO authenticated;

INSERT INTO public.app_schema_meta (key, value)
VALUES ('schema_version', '3.8.0')
ON CONFLICT (key)
DO UPDATE SET
  value = EXCLUDED.value,
  updated_at = NOW();
