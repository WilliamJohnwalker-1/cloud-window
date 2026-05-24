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
