-- Migration v5.6: Province sort persistence for admin UI
-- Execute after migrate-v5.5-purchase-order.sql

CREATE TABLE IF NOT EXISTS public.province_sort_orders (
  province TEXT PRIMARY KEY,
  sort_index INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_province_sort_orders_sort
  ON public.province_sort_orders(sort_index, province);

ALTER TABLE public.province_sort_orders ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated users can read province sort orders" ON public.province_sort_orders;
CREATE POLICY "Authenticated users can read province sort orders"
ON public.province_sort_orders
FOR SELECT
TO authenticated
USING (true);

CREATE OR REPLACE FUNCTION public.swap_province_sort_order(
  p_province TEXT,
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
  v_current public.province_sort_orders%ROWTYPE;
  v_target public.province_sort_orders%ROWTYPE;
  v_temp_sort INTEGER;
BEGIN
  IF p_direction NOT IN ('up', 'down') THEN
    RAISE EXCEPTION 'invalid direction';
  END IF;

  SELECT role INTO v_role
  FROM public.profiles
  WHERE id = v_uid;

  IF v_role NOT IN ('admin', 'super_admin') THEN
    RAISE EXCEPTION 'only admin can reorder provinces';
  END IF;

  IF p_province IS NULL OR btrim(p_province) = '' THEN
    RAISE EXCEPTION 'province is required';
  END IF;

  INSERT INTO public.province_sort_orders (province, sort_index)
  SELECT btrim(p_province), COALESCE(MAX(sort_index), 0) + 1
  FROM public.province_sort_orders
  WHERE NOT EXISTS (
    SELECT 1
    FROM public.province_sort_orders
    WHERE province = btrim(p_province)
  );

  SELECT *
  INTO v_current
  FROM public.province_sort_orders
  WHERE province = btrim(p_province)
  FOR UPDATE;

  IF p_direction = 'up' THEN
    SELECT *
    INTO v_target
    FROM public.province_sort_orders
    WHERE (sort_index, province) < (v_current.sort_index, v_current.province)
    ORDER BY sort_index DESC, province DESC
    LIMIT 1
    FOR UPDATE;
  ELSE
    SELECT *
    INTO v_target
    FROM public.province_sort_orders
    WHERE (sort_index, province) > (v_current.sort_index, v_current.province)
    ORDER BY sort_index ASC, province ASC
    LIMIT 1
    FOR UPDATE;
  END IF;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  v_temp_sort := -ABS((EXTRACT(EPOCH FROM clock_timestamp())::BIGINT % 2000000000)::INTEGER);

  UPDATE public.province_sort_orders
  SET sort_index = v_temp_sort,
      updated_at = NOW()
  WHERE province = v_current.province;

  UPDATE public.province_sort_orders
  SET sort_index = v_current.sort_index,
      updated_at = NOW()
  WHERE province = v_target.province;

  UPDATE public.province_sort_orders
  SET sort_index = v_target.sort_index,
      updated_at = NOW()
  WHERE province = v_current.province;
END;
$$;

GRANT SELECT ON TABLE public.province_sort_orders TO authenticated;
GRANT EXECUTE ON FUNCTION public.swap_province_sort_order(TEXT, TEXT) TO authenticated;

INSERT INTO public.app_schema_meta (key, value)
VALUES ('schema_version', '5.6.0')
ON CONFLICT (key)
DO UPDATE SET
  value = EXCLUDED.value,
  updated_at = NOW();
