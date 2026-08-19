-- v8.3: Ensure inventory upsert conflict targets exist before purchase delivery RPCs run.
-- Some upgraded databases may have store_inventory/inventory created before the latest
-- unique constraints were present, causing ON CONFLICT (...) to fail at confirm delivery.

-- Keep one total-inventory row per product before adding the uniqueness guarantee.
WITH ranked_inventory AS (
  SELECT
    id,
    product_id,
    ROW_NUMBER() OVER (
      PARTITION BY product_id
      ORDER BY updated_at DESC NULLS LAST, id::TEXT
    ) AS rn,
    SUM(quantity) OVER (PARTITION BY product_id) AS merged_quantity,
    MAX(min_quantity) OVER (PARTITION BY product_id) AS merged_min_quantity,
    MAX(updated_at) OVER (PARTITION BY product_id) AS merged_updated_at
  FROM public.inventory
  WHERE product_id IS NOT NULL
), merged_inventory AS (
  UPDATE public.inventory i
  SET quantity = ri.merged_quantity,
      min_quantity = COALESCE(ri.merged_min_quantity, i.min_quantity),
      updated_at = COALESCE(ri.merged_updated_at, NOW())
  FROM ranked_inventory ri
  WHERE i.id = ri.id
    AND ri.rn = 1
  RETURNING i.id
)
DELETE FROM public.inventory i
USING ranked_inventory ri
WHERE i.id = ri.id
  AND ri.rn > 1;

-- Keep one store-inventory row per store/product before adding the uniqueness guarantee.
WITH ranked_store_inventory AS (
  SELECT
    id,
    store_id,
    product_id,
    ROW_NUMBER() OVER (
      PARTITION BY store_id, product_id
      ORDER BY updated_at DESC NULLS LAST, id::TEXT
    ) AS rn,
    SUM(quantity) OVER (PARTITION BY store_id, product_id) AS merged_quantity,
    MAX(min_quantity) OVER (PARTITION BY store_id, product_id) AS merged_min_quantity,
    MAX(updated_at) OVER (PARTITION BY store_id, product_id) AS merged_updated_at
  FROM public.store_inventory
  WHERE store_id IS NOT NULL
    AND product_id IS NOT NULL
), merged_store_inventory AS (
  UPDATE public.store_inventory si
  SET quantity = rsi.merged_quantity,
      min_quantity = COALESCE(rsi.merged_min_quantity, si.min_quantity),
      updated_at = COALESCE(rsi.merged_updated_at, NOW())
  FROM ranked_store_inventory rsi
  WHERE si.id = rsi.id
    AND rsi.rn = 1
  RETURNING si.id
)
DELETE FROM public.store_inventory si
USING ranked_store_inventory rsi
WHERE si.id = rsi.id
  AND rsi.rn > 1;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_index i
    WHERE i.indrelid = 'public.inventory'::regclass
      AND i.indisunique
      AND (
        SELECT ARRAY_AGG(a.attname ORDER BY x.ord)
        FROM UNNEST(i.indkey) WITH ORDINALITY AS x(attnum, ord)
        JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = x.attnum
      ) = ARRAY['product_id']
  ) THEN
    ALTER TABLE public.inventory
      ADD CONSTRAINT inventory_product_id_unique UNIQUE (product_id);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_index i
    WHERE i.indrelid = 'public.store_inventory'::regclass
      AND i.indisunique
      AND (
        SELECT ARRAY_AGG(a.attname ORDER BY x.ord)
        FROM UNNEST(i.indkey) WITH ORDINALITY AS x(attnum, ord)
        JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = x.attnum
      ) = ARRAY['store_id', 'product_id']
  ) THEN
    ALTER TABLE public.store_inventory
      ADD CONSTRAINT store_inventory_store_product_unique UNIQUE (store_id, product_id);
  END IF;
END $$;

INSERT INTO public.app_schema_meta (key, value)
VALUES ('schema_version', '8.3.0')
ON CONFLICT (key)
DO UPDATE SET
  value = EXCLUDED.value,
  updated_at = NOW();
