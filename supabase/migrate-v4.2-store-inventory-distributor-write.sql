-- Migration v4.2: allow distributors to write own store inventory rows
-- Execute after migrate-v4.1-store-optional-distributor.sql

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'store_inventory'
      AND policyname = 'Distributors can insert own store inventory'
  ) THEN
    CREATE POLICY "Distributors can insert own store inventory" ON public.store_inventory
      FOR INSERT TO authenticated
      WITH CHECK (
        EXISTS (
          SELECT 1
          FROM public.stores s
          WHERE s.id = store_inventory.store_id
            AND s.distributor_id = auth.uid()
        )
      );
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'store_inventory'
      AND policyname = 'Distributors can update own store inventory'
  ) THEN
    CREATE POLICY "Distributors can update own store inventory" ON public.store_inventory
      FOR UPDATE TO authenticated
      USING (
        EXISTS (
          SELECT 1
          FROM public.stores s
          WHERE s.id = store_inventory.store_id
            AND s.distributor_id = auth.uid()
        )
      )
      WITH CHECK (
        EXISTS (
          SELECT 1
          FROM public.stores s
          WHERE s.id = store_inventory.store_id
            AND s.distributor_id = auth.uid()
        )
      );
  END IF;
END $$;
