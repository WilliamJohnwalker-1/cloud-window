-- Allow authenticated users to self-heal missing distributor profile rows.
-- This is intentionally limited to distributor role to avoid privilege escalation.

DROP POLICY IF EXISTS "Users can insert own distributor profile" ON public.profiles;

CREATE POLICY "Users can insert own distributor profile" ON public.profiles
  FOR INSERT TO authenticated
  WITH CHECK (
    auth.uid() = id
    AND role = 'distributor'
    AND city_id IS NOT NULL
    AND store_name IS NOT NULL
    AND length(trim(store_name)) > 0
  );

-- Extend self-heal to support the new stores model (v4.0).
-- When a distributor self-heals their profile, this trigger automatically creates
-- a matching stores row, making the v3.10 self-heal path compatible with the new
-- store entity model.
--
-- Uses dynamic SQL (EXECUTE) for forward compatibility: the stores table may not
-- exist yet when this migration runs (it is created by migrate-v4.0). If stores
-- does not exist at runtime, the INSERT is skipped gracefully via exception handling.
-- SECURITY DEFINER ensures the trigger can insert into stores regardless of RLS.
CREATE OR REPLACE FUNCTION public.create_store_for_new_distributor()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.role = 'distributor' AND NEW.city_id IS NOT NULL AND NEW.store_name IS NOT NULL THEN
    BEGIN
      EXECUTE 'INSERT INTO public.stores (name, city_id, distributor_id) SELECT $1, $2, $3 WHERE NOT EXISTS (SELECT 1 FROM public.stores WHERE distributor_id = $3 AND name = $1 AND city_id = $2)'
      USING NEW.store_name, NEW.city_id, NEW.id;
    EXCEPTION WHEN undefined_table THEN
      RAISE NOTICE 'stores table not found; skipping store creation for distributor %', NEW.id;
    END;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Trigger: fires after every profile insert to auto-create a store for distributors.
-- Idempotent: NOT EXISTS guard prevents duplicate stores on repeated profile inserts.
-- This trigger also fires during handle_new_user() signup, where the explicit
-- stores INSERT in that function serves as a redundant but harmless fallback.
DROP TRIGGER IF EXISTS on_distributor_profile_created ON public.profiles;
CREATE TRIGGER on_distributor_profile_created
  AFTER INSERT ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.create_store_for_new_distributor();
