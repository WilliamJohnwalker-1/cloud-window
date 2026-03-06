-- Migration for existing projects (v1 -> v2)
-- Execute in Supabase SQL Editor

-- 1) Profiles extensions
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS city_id UUID REFERENCES public.cities(id),
  ADD COLUMN IF NOT EXISTS store_name TEXT;

-- 2) Products extensions
ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS one_time_cost DECIMAL(10,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS discount_price DECIMAL(10,2) DEFAULT 0;

UPDATE public.products SET discount_price = price WHERE discount_price IS NULL OR discount_price = 0;

-- 3) Distributor custom discount table
CREATE TABLE IF NOT EXISTS public.distributor_product_prices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  distributor_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  discount_price DECIMAL(10,2) NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(distributor_id, product_id)
);

ALTER TABLE public.distributor_product_prices ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "Users can view relevant distributor product prices" ON public.distributor_product_prices
    FOR SELECT USING (
      EXISTS (
        SELECT 1
        FROM public.profiles p
        WHERE p.id = auth.uid()
          AND (p.role IN ('admin','inventory_manager') OR p.id = distributor_id)
      )
    );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "Admins can manage distributor product prices" ON public.distributor_product_prices
    FOR ALL USING (
      EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin')
    );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 4) New orders header + items
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS city_id UUID REFERENCES public.cities(id),
  ADD COLUMN IF NOT EXISTS total_retail_amount DECIMAL(10,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS total_discount_amount DECIMAL(10,2) DEFAULT 0;

CREATE TABLE IF NOT EXISTS public.order_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES public.products(id),
  quantity INTEGER NOT NULL,
  retail_price DECIMAL(10,2) NOT NULL,
  discount_price DECIMAL(10,2) NOT NULL,
  unit_cost DECIMAL(10,2) NOT NULL DEFAULT 0,
  one_time_cost DECIMAL(10,2) NOT NULL DEFAULT 0
);

ALTER TABLE public.order_items
  ADD COLUMN IF NOT EXISTS unit_cost DECIMAL(10,2) NOT NULL DEFAULT 0;

ALTER TABLE public.order_items ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "Users can view own or admin order items" ON public.order_items
    FOR SELECT USING (
      EXISTS (
        SELECT 1 FROM public.orders o
        WHERE o.id = order_items.order_id
          AND (
            o.distributor_id = auth.uid()
            OR EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin')
          )
      )
    );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "Users can create own/admin order items" ON public.order_items
    FOR INSERT WITH CHECK (
      EXISTS (
        SELECT 1 FROM public.orders o
        WHERE o.id = order_items.order_id
          AND (
            o.distributor_id = auth.uid()
            OR EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin')
          )
      )
    );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "Users can delete own/admin order items" ON public.order_items
    FOR DELETE USING (
      EXISTS (
        SELECT 1 FROM public.orders o
        WHERE o.id = order_items.order_id
          AND (
            o.distributor_id = auth.uid()
            OR EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin')
          )
      )
    );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 5) Backfill existing line-item style orders into order_items
INSERT INTO public.order_items (order_id, product_id, quantity, retail_price, discount_price, unit_cost, one_time_cost)
SELECT
  o.id,
  o.product_id,
  o.quantity,
  COALESCE(o.unit_price, p.price),
  COALESCE(o.unit_price, p.discount_price, p.price),
  COALESCE(p.cost, 0),
  COALESCE(p.one_time_cost, 0)
FROM public.orders o
LEFT JOIN public.products p ON p.id = o.product_id
WHERE o.product_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM public.order_items oi WHERE oi.order_id = o.id
  );

-- 5.1) Backfill unit_cost for existing order_items rows created before unit_cost snapshot
UPDATE public.order_items oi
SET unit_cost = COALESCE(p.cost, 0)
FROM public.products p
WHERE oi.product_id = p.id
  AND (oi.unit_cost IS NULL OR oi.unit_cost = 0);

-- 6) Recompute order totals
UPDATE public.orders o
SET
  total_retail_amount = COALESCE(sub.retail_total, 0),
  total_discount_amount = COALESCE(sub.discount_total, 0),
  city_id = COALESCE(o.city_id, sub.city_id)
FROM (
  SELECT
    oi.order_id,
    SUM(oi.quantity * oi.retail_price) AS retail_total,
    SUM(oi.quantity * oi.discount_price) AS discount_total,
    (ARRAY_REMOVE(ARRAY_AGG(p.city_id::text ORDER BY p.city_id::text), NULL))[1]::uuid AS city_id
  FROM public.order_items oi
  LEFT JOIN public.products p ON p.id = oi.product_id
  GROUP BY oi.order_id
) sub
WHERE sub.order_id = o.id;
