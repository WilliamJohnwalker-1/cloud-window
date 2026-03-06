-- Database Schema for Inventory Management App (v2)
-- Run this in Supabase SQL Editor for a fresh setup

-- Cities table
CREATE TABLE public.cities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Users table (extends Supabase auth.users)
CREATE TABLE public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  full_name TEXT,
  role TEXT NOT NULL CHECK (role IN ('admin', 'distributor', 'inventory_manager')),
  city_id UUID REFERENCES public.cities(id),
  store_name TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Products table
CREATE TABLE public.products (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  price DECIMAL(10, 2) NOT NULL,
  cost DECIMAL(10, 2) DEFAULT 0,
  one_time_cost DECIMAL(10, 2) DEFAULT 0,
  discount_price DECIMAL(10, 2) DEFAULT 0,
  image_url TEXT,
  city_id UUID REFERENCES public.cities(id) ON DELETE CASCADE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Distributor custom discount price per product
CREATE TABLE public.distributor_product_prices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  distributor_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  discount_price DECIMAL(10, 2) NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(distributor_id, product_id)
);

-- Inventory table
CREATE TABLE public.inventory (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id UUID UNIQUE REFERENCES public.products(id) ON DELETE CASCADE,
  quantity INTEGER NOT NULL DEFAULT 0,
  min_quantity INTEGER DEFAULT 10,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Orders header table (one order record per checkout)
CREATE TABLE public.orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  distributor_id UUID NOT NULL REFERENCES public.profiles(id),
  city_id UUID REFERENCES public.cities(id),
  total_retail_amount DECIMAL(10, 2) NOT NULL DEFAULT 0,
  total_discount_amount DECIMAL(10, 2) NOT NULL DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Order items table (multiple products per order)
CREATE TABLE public.order_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES public.products(id),
  quantity INTEGER NOT NULL,
  retail_price DECIMAL(10, 2) NOT NULL,
  discount_price DECIMAL(10, 2) NOT NULL,
  unit_cost DECIMAL(10, 2) NOT NULL DEFAULT 0,
  one_time_cost DECIMAL(10, 2) NOT NULL DEFAULT 0
);

-- Row Level Security
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cities ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.distributor_product_prices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventory ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.order_items ENABLE ROW LEVEL SECURITY;

-- Profiles policies
CREATE POLICY "Users can view own profile" ON public.profiles
  FOR SELECT USING (auth.uid() = id);

CREATE POLICY "Admins can manage all profiles" ON public.profiles
  FOR ALL USING (
    EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin')
  );

CREATE POLICY "Inventory managers can view profiles" ON public.profiles
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role IN ('admin', 'inventory_manager'))
  );

-- Cities policies
CREATE POLICY "Authenticated users can view cities" ON public.cities
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "Admins can manage cities" ON public.cities
  FOR ALL USING (
    EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin')
  );

-- Products policies
CREATE POLICY "Authenticated users can view products" ON public.products
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "Admins and inventory managers can manage products" ON public.products
  FOR ALL USING (
    EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role IN ('admin', 'inventory_manager'))
  );

-- Distributor custom prices policies
CREATE POLICY "Users can view relevant distributor product prices" ON public.distributor_product_prices
  FOR SELECT USING (
    EXISTS (
      SELECT 1
      FROM public.profiles p
      WHERE p.id = auth.uid()
      AND (
        p.role IN ('admin', 'inventory_manager')
        OR p.id = distributor_id
      )
    )
  );

CREATE POLICY "Admins can manage distributor product prices" ON public.distributor_product_prices
  FOR ALL USING (
    EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin')
  );

-- Inventory policies
CREATE POLICY "Admins and inventory managers can view inventory" ON public.inventory
  FOR SELECT TO authenticated USING (
    EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role IN ('admin', 'inventory_manager'))
  );

CREATE POLICY "Inventory managers can manage inventory" ON public.inventory
  FOR ALL USING (
    EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role IN ('admin', 'inventory_manager'))
  );

-- Orders policies
CREATE POLICY "Admins can view all orders" ON public.orders
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin')
  );

CREATE POLICY "Distributors can view own orders" ON public.orders
  FOR SELECT USING (auth.uid() = distributor_id);

CREATE POLICY "Distributors and admins can create orders" ON public.orders
  FOR INSERT WITH CHECK (
    auth.uid() = distributor_id
    OR EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin')
  );

CREATE POLICY "Admins and owners can delete orders" ON public.orders
  FOR DELETE USING (
    auth.uid() = distributor_id
    OR EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin')
  );

-- Order items policies
CREATE POLICY "Users can view own or admin order items" ON public.order_items
  FOR SELECT USING (
    EXISTS (
      SELECT 1
      FROM public.orders o
      WHERE o.id = order_items.order_id
        AND (
          o.distributor_id = auth.uid()
          OR EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin')
        )
    )
  );

CREATE POLICY "Users can create own/admin order items" ON public.order_items
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.orders o
      WHERE o.id = order_items.order_id
        AND (
          o.distributor_id = auth.uid()
          OR EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin')
        )
    )
  );

CREATE POLICY "Users can delete own/admin order items" ON public.order_items
  FOR DELETE USING (
    EXISTS (
      SELECT 1
      FROM public.orders o
      WHERE o.id = order_items.order_id
        AND (
          o.distributor_id = auth.uid()
          OR EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin')
        )
    )
  );

-- Trigger to create profile on user signup
-- Uses auth metadata:
-- role (optional), city_id (for distributor), store_name (for distributor)
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
DECLARE
  signup_role TEXT;
  default_hangzhou UUID;
  selected_city UUID;
  selected_store TEXT;
BEGIN
  signup_role := COALESCE(NEW.raw_user_meta_data->>'role', 'distributor');
  selected_city := NULLIF(NEW.raw_user_meta_data->>'city_id', '')::uuid;
  selected_store := NULLIF(NEW.raw_user_meta_data->>'store_name', '');

  SELECT id INTO default_hangzhou FROM public.cities WHERE name = '杭州' LIMIT 1;

  IF signup_role = 'admin' THEN
    selected_city := COALESCE(selected_city, default_hangzhou);
  END IF;

  IF signup_role = 'distributor' AND selected_city IS NULL THEN
    RAISE EXCEPTION 'Distributor city is required';
  END IF;

  IF signup_role = 'distributor' AND selected_store IS NULL THEN
    RAISE EXCEPTION 'Distributor store_name is required';
  END IF;

  INSERT INTO public.profiles (id, email, role, city_id, store_name)
  VALUES (NEW.id, NEW.email, signup_role, selected_city, selected_store);

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Storage bucket for product images
INSERT INTO storage.buckets (id, name, public)
VALUES ('product-images', 'product-images', true)
ON CONFLICT (id) DO UPDATE SET public = excluded.public;

DROP POLICY IF EXISTS "Public can view product images" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated users can upload own product images" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated users can update own product images" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated users can delete own product images" ON storage.objects;

CREATE POLICY "Public can view product images" ON storage.objects
  FOR SELECT USING (bucket_id = 'product-images');

CREATE POLICY "Authenticated users can upload own product images" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'product-images'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

CREATE POLICY "Authenticated users can update own product images" ON storage.objects
  FOR UPDATE TO authenticated
  USING (
    bucket_id = 'product-images'
    AND (storage.foldername(name))[1] = auth.uid()::text
  )
  WITH CHECK (
    bucket_id = 'product-images'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

CREATE POLICY "Authenticated users can delete own product images" ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'product-images'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

-- Sample data
INSERT INTO public.cities (name)
VALUES ('北京'), ('上海'), ('广州'), ('深圳'), ('杭州')
ON CONFLICT (name) DO NOTHING;

INSERT INTO public.products (name, price, cost, one_time_cost, discount_price, city_id)
SELECT
  p.name,
  p.price,
  p.cost,
  p.one_time_cost,
  p.discount_price,
  c.id
FROM (VALUES
  ('文创书签', 25.00, 8.00, 2.00, 22.00),
  ('文创笔记本', 58.00, 20.00, 5.00, 52.00),
  ('文创冰箱贴', 15.00, 5.00, 1.00, 13.00),
  ('文创帆布包', 68.00, 25.00, 6.00, 60.00),
  ('文创明信片', 12.00, 3.00, 1.00, 10.00)
) AS p(name, price, cost, one_time_cost, discount_price)
CROSS JOIN (SELECT id FROM public.cities LIMIT 3) AS c;

INSERT INTO public.inventory (product_id, quantity, min_quantity)
SELECT id, floor(random() * 100 + 20)::int, 15
FROM public.products
ON CONFLICT (product_id) DO NOTHING;
