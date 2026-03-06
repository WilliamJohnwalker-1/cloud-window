-- 简化初始化脚本（v2）
-- 特点：结构与主 schema 一致，但 RLS 使用宽松策略便于本地演示

CREATE TABLE public.cities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

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

CREATE TABLE public.distributor_product_prices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  distributor_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  discount_price DECIMAL(10, 2) NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(distributor_id, product_id)
);

CREATE TABLE public.inventory (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id UUID UNIQUE REFERENCES public.products(id) ON DELETE CASCADE,
  quantity INTEGER NOT NULL DEFAULT 0,
  min_quantity INTEGER DEFAULT 10,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE public.orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  distributor_id UUID NOT NULL REFERENCES public.profiles(id),
  city_id UUID REFERENCES public.cities(id),
  total_retail_amount DECIMAL(10, 2) NOT NULL DEFAULT 0,
  total_discount_amount DECIMAL(10, 2) NOT NULL DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

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

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cities ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.distributor_product_prices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventory ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.order_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "allow_all_profiles" ON public.profiles FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "allow_all_cities" ON public.cities FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "allow_all_products" ON public.products FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "allow_all_distributor_prices" ON public.distributor_product_prices FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "allow_all_inventory" ON public.inventory FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "allow_all_orders" ON public.orders FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "allow_all_order_items" ON public.order_items FOR ALL USING (true) WITH CHECK (true);

INSERT INTO public.cities (name) VALUES ('北京'), ('上海'), ('广州'), ('深圳'), ('杭州')
ON CONFLICT (name) DO NOTHING;

INSERT INTO public.products (name, price, cost, one_time_cost, discount_price, city_id)
SELECT p.name, p.price, p.cost, p.one_time_cost, p.discount_price, c.id
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
