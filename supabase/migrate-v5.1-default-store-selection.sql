-- v5.1: allow distributor to set own default_store_id safely

CREATE OR REPLACE FUNCTION public.set_my_default_store(p_store_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  current_user_id UUID := auth.uid();
  matched_store_id UUID;
BEGIN
  IF current_user_id IS NULL THEN
    RAISE EXCEPTION 'UNAUTHORIZED';
  END IF;

  SELECT s.id
  INTO matched_store_id
  FROM public.stores s
  WHERE s.id = p_store_id
    AND s.distributor_id = current_user_id
    AND s.status = 'active'
  LIMIT 1;

  IF matched_store_id IS NULL THEN
    RAISE EXCEPTION 'STORE_NOT_ALLOWED';
  END IF;

  UPDATE public.profiles
  SET default_store_id = matched_store_id,
      updated_at = NOW()
  WHERE id = current_user_id
    AND role = 'distributor';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'PROFILE_NOT_FOUND_OR_NOT_DISTRIBUTOR';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.set_my_default_store(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_my_default_store(UUID) TO authenticated;
