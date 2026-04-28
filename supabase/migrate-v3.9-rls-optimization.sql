-- Migration v3.9: RLS optimization and hardening
-- Execute in Supabase SQL Editor

CREATE OR REPLACE FUNCTION public.current_user_role(
  p_uid UUID DEFAULT auth.uid()
)
RETURNS TEXT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT p.role
  FROM public.profiles p
  WHERE p.id = p_uid
  LIMIT 1
$$;

CREATE OR REPLACE FUNCTION public.is_admin(
  p_uid UUID DEFAULT auth.uid()
)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(public.current_user_role(p_uid) = 'admin', FALSE)
$$;

CREATE OR REPLACE FUNCTION public.is_inventory_manager(
  p_uid UUID DEFAULT auth.uid()
)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(public.current_user_role(p_uid) = 'inventory_manager', FALSE)
$$;

CREATE OR REPLACE FUNCTION public.is_admin_or_inventory_manager(
  p_uid UUID DEFAULT auth.uid()
)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(public.current_user_role(p_uid) IN ('admin', 'inventory_manager'), FALSE)
$$;

GRANT EXECUTE ON FUNCTION public.current_user_role(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_admin(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_inventory_manager(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_admin_or_inventory_manager(UUID) TO authenticated;

DROP POLICY IF EXISTS "Users can view own profile" ON public.profiles;
DROP POLICY IF EXISTS "Admins can manage all profiles" ON public.profiles;
DROP POLICY IF EXISTS "Inventory managers can view profiles" ON public.profiles;

CREATE POLICY "Users can view own profile" ON public.profiles
  FOR SELECT USING (auth.uid() = id);

CREATE POLICY "Admins can manage all profiles" ON public.profiles
  FOR ALL USING (public.is_admin())
  WITH CHECK (public.is_admin());

CREATE POLICY "Inventory managers can view profiles" ON public.profiles
  FOR SELECT USING (public.is_admin_or_inventory_manager());

DROP POLICY IF EXISTS "Authenticated users can view cities" ON public.cities;
DROP POLICY IF EXISTS "Admins can manage cities" ON public.cities;

CREATE POLICY "Authenticated users can view cities" ON public.cities
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "Admins can manage cities" ON public.cities
  FOR ALL USING (public.is_admin())
  WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "Authenticated users can view products" ON public.products;
DROP POLICY IF EXISTS "Admins and inventory managers can manage products" ON public.products;

CREATE POLICY "Authenticated users can view products" ON public.products
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "Admins and inventory managers can manage products" ON public.products
  FOR ALL USING (public.is_admin_or_inventory_manager())
  WITH CHECK (public.is_admin_or_inventory_manager());

DROP POLICY IF EXISTS "Users can view relevant distributor product prices" ON public.distributor_product_prices;
DROP POLICY IF EXISTS "Admins can manage distributor product prices" ON public.distributor_product_prices;

CREATE POLICY "Users can view relevant distributor product prices" ON public.distributor_product_prices
  FOR SELECT USING (
    public.is_admin_or_inventory_manager()
    OR auth.uid() = distributor_id
  );

CREATE POLICY "Admins can manage distributor product prices" ON public.distributor_product_prices
  FOR ALL USING (public.is_admin())
  WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "Admins and inventory managers can view inventory" ON public.inventory;
DROP POLICY IF EXISTS "Inventory managers can manage inventory" ON public.inventory;

CREATE POLICY "Admins and inventory managers can view inventory" ON public.inventory
  FOR SELECT TO authenticated USING (public.is_admin_or_inventory_manager());

CREATE POLICY "Inventory managers can manage inventory" ON public.inventory
  FOR ALL USING (public.is_admin_or_inventory_manager())
  WITH CHECK (public.is_admin_or_inventory_manager());

DROP POLICY IF EXISTS "Admins can view all orders" ON public.orders;
DROP POLICY IF EXISTS "Distributors can view own orders" ON public.orders;
DROP POLICY IF EXISTS "Distributors and admins can create orders" ON public.orders;
DROP POLICY IF EXISTS "Admins and owners can delete orders" ON public.orders;
DROP POLICY IF EXISTS "Admins can update order status" ON public.orders;

CREATE POLICY "Admins can view all orders" ON public.orders
  FOR SELECT USING (public.is_admin());

CREATE POLICY "Distributors can view own orders" ON public.orders
  FOR SELECT USING (auth.uid() = distributor_id);

CREATE POLICY "Distributors and admins can create orders" ON public.orders
  FOR INSERT WITH CHECK (
    auth.uid() = distributor_id
    OR public.is_admin()
  );

CREATE POLICY "Admins and owners can delete orders" ON public.orders
  FOR DELETE USING (
    auth.uid() = distributor_id
    OR public.is_admin()
  );

CREATE POLICY "Admins can update order status" ON public.orders
  FOR UPDATE USING (public.is_admin())
  WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "Users can view own or admin order items" ON public.order_items;
DROP POLICY IF EXISTS "Users can create own/admin order items" ON public.order_items;
DROP POLICY IF EXISTS "Users can delete own/admin order items" ON public.order_items;

CREATE POLICY "Users can view own or admin order items" ON public.order_items
  FOR SELECT USING (
    EXISTS (
      SELECT 1
      FROM public.orders o
      WHERE o.id = order_items.order_id
        AND (
          o.distributor_id = auth.uid()
          OR public.is_admin()
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
          OR public.is_admin()
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
          OR public.is_admin()
        )
    )
  );

DROP POLICY IF EXISTS "Users can view own notifications" ON public.notifications;
DROP POLICY IF EXISTS "Authenticated users can create notifications" ON public.notifications;
DROP POLICY IF EXISTS "Users can update own notifications" ON public.notifications;

CREATE POLICY "Users can view own notifications" ON public.notifications
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Authenticated users can create notifications" ON public.notifications
  FOR INSERT TO authenticated
  WITH CHECK (
    auth.uid() = user_id
    OR public.is_admin()
  );

CREATE POLICY "Users can update own notifications" ON public.notifications
  FOR UPDATE USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Admins and inventory managers can view inventory logs" ON public.inventory_logs;
DROP POLICY IF EXISTS "Admins and inventory managers can insert inventory logs" ON public.inventory_logs;

CREATE POLICY "Admins and inventory managers can view inventory logs" ON public.inventory_logs
  FOR SELECT TO authenticated
  USING (public.is_admin_or_inventory_manager());

CREATE POLICY "Admins and inventory managers can insert inventory logs" ON public.inventory_logs
  FOR INSERT TO authenticated
  WITH CHECK (
    public.is_admin_or_inventory_manager()
    AND auth.uid() = operator_id
  );

DROP POLICY IF EXISTS "Admins can view payment events" ON public.payment_events;

CREATE POLICY "Admins can view payment events" ON public.payment_events
  FOR SELECT TO authenticated
  USING (public.is_admin());

INSERT INTO public.app_schema_meta (key, value)
VALUES ('schema_version', '3.9.0')
ON CONFLICT (key)
DO UPDATE SET
  value = EXCLUDED.value,
  updated_at = NOW();
