-- Migration v9.0: Settlement confirmation workflow, store-scoped inventory logs, and cost auto-calc
-- Execute after migrate-v8.8-return-order-kind-and-delete-wrapper.sql
-- Purpose:
-- 1) Add orders.confirmed_at for two-phase settlement confirmation.
-- 2) Add inventory_logs.store_id for store-pool movement auditability.
-- 3) Extend inventory_logs action CHECK for settlement_create / settlement_edit.
-- 4) Recreate recalc_product_cumulative_from_purchase with one_time_cost amortized into products.cost.
-- 5) Add a dedicated one_time_cost change trigger that recalculates products.cost inline.
-- 6) Override product cost sync so product updates keep order_items.unit_cost current without rewriting order_items.one_time_cost.
-- 7) Enforce one_time_cost = 0 for every newly inserted order_items row from live create RPCs.
-- 8) Recreate create_settlement_order_atomic as pending-at-create while preserving create-time store deduction.
-- 9) Add edit_settlement_order_atomic for pending settlements only.
-- 10) Add confirm_settlement_order_atomic to mark settlement paid and write finance income.
-- 11) Guard delete_order_with_inventory_restore_atomic against confirmed settlement deletion.
-- 12) Backfill historical settlement orders with confirmed_at = created_at.
--
-- Scope: settlement confirmation/schema/delete-guard plus purchase-cost auto-calc only.

-- ============================================================
-- 0. Pre-check
-- ============================================================
DO $$
BEGIN
  IF public.get_app_schema_version() < '8.8.0' THEN
    RAISE EXCEPTION 'Migration v8.8.0 must be applied before v9.0.0';
  END IF;
END $$;

-- ============================================================
-- 1. orders.confirmed_at
-- ============================================================
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS confirmed_at TIMESTAMP WITH TIME ZONE;

COMMENT ON COLUMN public.orders.confirmed_at IS 'Settlement confirmation timestamp; historical settlement orders are backfilled from created_at';

CREATE INDEX IF NOT EXISTS idx_orders_confirmed_at
  ON public.orders(confirmed_at)
  WHERE confirmed_at IS NOT NULL;

-- Historical settlement orders were previously created as accepted/paid.
-- Treat only those old finalized rows as already confirmed; leave any
-- new pending settlement rows untouched if this migration is re-run.
UPDATE public.orders
SET confirmed_at = created_at
WHERE order_kind = 'settlement'
  AND confirmed_at IS NULL
  AND status = 'accepted'
  AND LOWER(COALESCE(payment_status, '')) = 'paid';

-- ============================================================
-- 2. inventory_logs.store_id and settlement actions
-- ============================================================
ALTER TABLE public.inventory_logs
  ADD COLUMN IF NOT EXISTS store_id UUID REFERENCES public.stores(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.inventory_logs.store_id IS 'Store inventory pool affected by this movement (nullable for total-warehouse movements)';

CREATE INDEX IF NOT EXISTS idx_inventory_logs_store_id
  ON public.inventory_logs(store_id);

DO $$
DECLARE
  v_constraint_def TEXT;
BEGIN
  SELECT pg_get_constraintdef(c.oid)
    INTO v_constraint_def
    FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = c.connamespace
   WHERE n.nspname = 'public'
     AND t.relname = 'inventory_logs'
     AND c.contype = 'c'
     AND c.conname = 'inventory_logs_action_check';

  IF v_constraint_def IS NULL
     OR v_constraint_def NOT ILIKE '%settlement_create%'
     OR v_constraint_def NOT ILIKE '%settlement_edit%'
  THEN
    ALTER TABLE public.inventory_logs
      DROP CONSTRAINT IF EXISTS inventory_logs_action_check;

    ALTER TABLE public.inventory_logs
      ADD CONSTRAINT inventory_logs_action_check
      CHECK (action IN (
        'inbound',
        'manual_adjust',
        'quick_add',
        'quick_reduce',
        'breakage',
        'purchase_receive',
        'sell',
        'refund_restore',
        'outbound',
        'settlement_create',
        'settlement_edit'
      ));
  END IF;
END $$;

-- ============================================================
-- 3. Cost auto-calc overrides
--    Preserve v8.7 delivered purchase-history semantics based on
--    purchase_order_items.line_total, but fold one_time_cost into
--    products.cost exactly once at the product level.
-- ============================================================
CREATE OR REPLACE FUNCTION public.recalc_product_cumulative_from_purchase(
  p_product_id UUID
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_new_cum_qty INTEGER := 0;
  v_new_cum_cost NUMERIC(14, 2) := 0;
  v_one_time_cost NUMERIC(10, 2) := 0;
  v_new_product_cost NUMERIC(10, 2);
BEGIN
  IF p_product_id IS NULL THEN
    RETURN;
  END IF;

  SELECT
    COALESCE(SUM(COALESCE(poi.delivered_quantity, 0)), 0)::INTEGER,
    ROUND(COALESCE(SUM(COALESCE(poi.line_total, 0)), 0), 2)
  INTO v_new_cum_qty, v_new_cum_cost
  FROM public.purchase_order_items poi
  WHERE poi.product_id = p_product_id
    AND COALESCE(poi.delivered_quantity, 0) > 0;

  SELECT COALESCE(p.one_time_cost, 0)
  INTO v_one_time_cost
  FROM public.products p
  WHERE p.id = p_product_id;

  IF v_new_cum_qty > 0 THEN
    v_new_product_cost := ROUND((v_new_cum_cost + v_one_time_cost) / v_new_cum_qty::NUMERIC, 2);

    UPDATE public.products p
    SET cumulative_cost_quantity = v_new_cum_qty,
        cumulative_cost_amount = v_new_cum_cost,
        cost = v_new_product_cost,
        updated_at = NOW()
    WHERE p.id = p_product_id;

    UPDATE public.order_items oi
    SET unit_cost = v_new_product_cost
    WHERE oi.product_id = p_product_id;
  ELSE
    UPDATE public.products p
    SET cumulative_cost_quantity = 0,
        cumulative_cost_amount = 0,
        cost = NULL,
        updated_at = NOW()
    WHERE p.id = p_product_id;
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.recalc_product_cumulative_from_purchase(UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.recalc_product_cost_from_one_time_cost_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_new_product_cost NUMERIC(10, 2);
BEGIN
  IF NEW.one_time_cost IS NOT DISTINCT FROM OLD.one_time_cost THEN
    RETURN NEW;
  END IF;

  IF COALESCE(NEW.cumulative_cost_quantity, 0) > 0 THEN
    v_new_product_cost := ROUND(
      (COALESCE(NEW.cumulative_cost_amount, 0) + COALESCE(NEW.one_time_cost, 0))
      / NEW.cumulative_cost_quantity::NUMERIC,
      2
    );
  ELSE
    v_new_product_cost := NULL;
  END IF;

  UPDATE public.products p
  SET cost = v_new_product_cost,
      updated_at = NOW()
  WHERE p.id = NEW.id
    AND p.cost IS DISTINCT FROM v_new_product_cost;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_update_product_cost_from_one_time_cost ON public.products;

-- Keep this trigger name ordered after the existing v4.7 cost-sync trigger
-- so that downstream order_items propagation sees the final recomputed cost.
CREATE TRIGGER trg_update_product_cost_from_one_time_cost
AFTER UPDATE OF one_time_cost ON public.products
FOR EACH ROW
EXECUTE FUNCTION public.recalc_product_cost_from_one_time_cost_change();

CREATE OR REPLACE FUNCTION public.sync_product_cost_to_order_items()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.cost IS DISTINCT FROM OLD.cost OR NEW.one_time_cost IS DISTINCT FROM OLD.one_time_cost THEN
    UPDATE public.order_items
    SET unit_cost = NEW.cost
    WHERE product_id = NEW.id;
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.force_new_order_item_one_time_cost_zero()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  NEW.one_time_cost := 0;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_force_new_order_item_one_time_cost_zero ON public.order_items;

-- Covers all live order item creation RPCs without rewriting historical rows:
-- create_batch_order_atomic, create_retail_order_atomic,
-- create_store_retail_order_atomic, create_external_order_atomic,
-- outbound_stock_atomic, create_settlement_order_atomic, and
-- edit_settlement_order_atomic replacement inserts.
CREATE TRIGGER trg_force_new_order_item_one_time_cost_zero
BEFORE INSERT ON public.order_items
FOR EACH ROW
EXECUTE FUNCTION public.force_new_order_item_one_time_cost_zero();

-- ============================================================
-- 4. Recreate settlement create RPC
--    Pending-at-create workflow. Store inventory is still deducted at
--    creation time only, and confirm does NOT deduct inventory again.
-- ============================================================
DROP FUNCTION IF EXISTS public.create_settlement_order_atomic(JSONB, UUID, TEXT);

CREATE OR REPLACE FUNCTION public.create_settlement_order_atomic(
  p_items JSONB,
  p_store_id UUID,
  p_request_id TEXT DEFAULT NULL,
  p_order_date DATE DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_role TEXT;
  v_order_id UUID;
  v_total_retail NUMERIC(10, 2) := 0;
  v_total_discount NUMERIC(10, 2) := 0;
  v_store_city UUID;
  v_store_status TEXT;
  v_agg RECORD;
  v_store_stock INTEGER;
  v_existing_order_id UUID;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION '未登录';
  END IF;

  SELECT role INTO v_role
  FROM public.profiles
  WHERE id = v_user_id;

  IF v_role IS NULL THEN
    RAISE EXCEPTION '用户资料不存在';
  END IF;

  IF v_role NOT IN ('admin', 'super_admin', 'finance') THEN
    RAISE EXCEPTION '当前角色无结算建单权限';
  END IF;

  IF p_store_id IS NULL THEN
    RAISE EXCEPTION '店铺ID不能为空';
  END IF;

  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION '结算项不能为空';
  END IF;

  IF p_request_id IS NOT NULL THEN
    SELECT o.id
    INTO v_existing_order_id
    FROM public.orders o
    WHERE o.request_id = p_request_id
    LIMIT 1;

    IF v_existing_order_id IS NOT NULL THEN
      RETURN v_existing_order_id;
    END IF;
  END IF;

  SELECT s.city_id, s.status
  INTO v_store_city, v_store_status
  FROM public.stores s
  WHERE s.id = p_store_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION '店铺不存在';
  END IF;

  IF v_store_status <> 'active' THEN
    RAISE EXCEPTION '店铺已停用';
  END IF;

  CREATE TEMP TABLE IF NOT EXISTS _settlement_items_tmp (
    product_id UUID NOT NULL,
    quantity INTEGER NOT NULL
  ) ON COMMIT DROP;

  CREATE TEMP TABLE IF NOT EXISTS _settlement_create_movements_tmp (
    product_id UUID PRIMARY KEY,
    total_qty INTEGER NOT NULL,
    before_quantity INTEGER NOT NULL,
    after_quantity INTEGER NOT NULL
  ) ON COMMIT DROP;

  TRUNCATE TABLE _settlement_items_tmp;
  TRUNCATE TABLE _settlement_create_movements_tmp;

  INSERT INTO _settlement_items_tmp (product_id, quantity)
  SELECT x.product_id, x.quantity
  FROM jsonb_to_recordset(p_items) AS x(
    product_id UUID,
    quantity INTEGER
  );

  IF NOT EXISTS (SELECT 1 FROM _settlement_items_tmp) THEN
    RAISE EXCEPTION '结算项不能为空';
  END IF;

  IF EXISTS (SELECT 1 FROM _settlement_items_tmp WHERE quantity <= 0) THEN
    RAISE EXCEPTION '结算数量必须大于0';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM _settlement_items_tmp bi
    LEFT JOIN public.products p ON p.id = bi.product_id
    WHERE p.id IS NULL
  ) THEN
    RAISE EXCEPTION '商品不存在';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM _settlement_items_tmp bi
    JOIN public.products p ON p.id = bi.product_id
    WHERE p.city_id IS DISTINCT FROM v_store_city
  ) THEN
    RAISE EXCEPTION '店铺只能结算所属城市商品';
  END IF;

  FOR v_agg IN
    SELECT bi.product_id, SUM(bi.quantity)::INTEGER AS total_qty
    FROM _settlement_items_tmp bi
    GROUP BY bi.product_id
    ORDER BY bi.product_id
  LOOP
    SELECT si.quantity
    INTO v_store_stock
    FROM public.store_inventory si
    WHERE si.store_id = p_store_id
      AND si.product_id = v_agg.product_id
    FOR UPDATE;

    IF v_store_stock IS NULL THEN
      RAISE EXCEPTION '店铺库存记录不存在';
    END IF;

    IF v_store_stock < v_agg.total_qty THEN
      RAISE EXCEPTION '店铺库存不足';
    END IF;

    INSERT INTO _settlement_create_movements_tmp (product_id, total_qty, before_quantity, after_quantity)
    VALUES (
      v_agg.product_id,
      v_agg.total_qty,
      v_store_stock,
      v_store_stock - v_agg.total_qty
    );
  END LOOP;

  SELECT
    COALESCE(SUM(p.price * bi.quantity), 0),
    COALESCE(SUM(
      COALESCE(spp.override_price, s.discount_rate * p.price) * bi.quantity
    ), 0)
  INTO v_total_retail, v_total_discount
  FROM _settlement_items_tmp bi
  JOIN public.products p ON p.id = bi.product_id
  JOIN public.stores s ON s.id = p_store_id
  LEFT JOIN public.store_product_prices spp
    ON spp.store_id = p_store_id AND spp.product_id = bi.product_id;

  INSERT INTO public.orders (
    distributor_id,
    city_id,
    store_id,
    request_id,
    order_kind,
    status,
    payment_status,
    total_retail_amount,
    total_discount_amount,
    order_date
  ) VALUES (
    v_user_id,
    v_store_city,
    p_store_id,
    p_request_id,
    'settlement',
    'pending',
    'pending',
    v_total_retail,
    v_total_discount,
    COALESCE(p_order_date, CURRENT_DATE)
  )
  RETURNING id INTO v_order_id;

  INSERT INTO public.order_items (
    order_id,
    product_id,
    quantity,
    retail_price,
    discount_price,
    unit_cost,
    one_time_cost
  )
  SELECT
    v_order_id,
    bi.product_id,
    bi.quantity,
    p.price,
    COALESCE(spp.override_price, s.discount_rate * p.price),
    p.cost,
    0
  FROM _settlement_items_tmp bi
  JOIN public.products p ON p.id = bi.product_id
  JOIN public.stores s ON s.id = p_store_id
  LEFT JOIN public.store_product_prices spp
    ON spp.store_id = p_store_id AND spp.product_id = bi.product_id;

  UPDATE public.store_inventory si
  SET quantity = m.after_quantity,
      updated_at = NOW()
  FROM _settlement_create_movements_tmp m
  WHERE si.store_id = p_store_id
    AND si.product_id = m.product_id;

  INSERT INTO public.inventory_logs (
    product_id,
    operator_id,
    store_id,
    action,
    delta_quantity,
    before_quantity,
    after_quantity,
    note
  )
  SELECT
    m.product_id,
    v_user_id,
    p_store_id,
    'settlement_create',
    -m.total_qty,
    m.before_quantity,
    m.after_quantity,
    FORMAT('结算建单扣减；order_id=%s；store_id=%s', v_order_id, p_store_id)
  FROM _settlement_create_movements_tmp m;

  RETURN v_order_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_settlement_order_atomic(JSONB, UUID, TEXT, DATE) TO authenticated;

-- ============================================================
-- 5. Edit settlement order RPC
--    Pending settlements can be edited before confirmation. Because
--    settlement creation already deducted store inventory, edit applies
--    only the delta between old and new order quantities. Returns the
--    updated order row for callers that need the final server state.
-- ============================================================
DROP FUNCTION IF EXISTS public.edit_settlement_order_atomic(UUID, JSONB);

CREATE OR REPLACE FUNCTION public.edit_settlement_order_atomic(
  p_order_id UUID,
  p_items JSONB
)
RETURNS public.orders
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor_id UUID := auth.uid();
  v_actor_role TEXT;
  v_order public.orders%ROWTYPE;
  v_store_city UUID;
  v_store_status TEXT;
  v_total_retail NUMERIC(10, 2) := 0;
  v_total_discount NUMERIC(10, 2) := 0;
  v_agg RECORD;
  v_store_stock INTEGER;
BEGIN
  IF v_actor_id IS NULL THEN
    RAISE EXCEPTION '未登录';
  END IF;

  SELECT role INTO v_actor_role
  FROM public.profiles
  WHERE id = v_actor_id;

  IF v_actor_role IS NULL THEN
    RAISE EXCEPTION '用户资料不存在';
  END IF;

  IF v_actor_role NOT IN ('admin', 'super_admin', 'finance') THEN
    RAISE EXCEPTION '当前角色无修改结算单权限';
  END IF;

  IF p_order_id IS NULL THEN
    RAISE EXCEPTION '订单ID不能为空';
  END IF;

  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION '结算项不能为空';
  END IF;

  SELECT * INTO v_order
  FROM public.orders
  WHERE id = p_order_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION '订单不存在';
  END IF;

  IF COALESCE(v_order.order_kind::TEXT, 'distribution') <> 'settlement' THEN
    RAISE EXCEPTION '不是结算单';
  END IF;

  IF v_order.confirmed_at IS NOT NULL
     OR v_order.status <> 'pending'
     OR COALESCE(v_order.payment_status, 'pending') <> 'pending'
  THEN
    RAISE EXCEPTION '结算单已确认，不能修改';
  END IF;

  IF v_order.store_id IS NULL THEN
    RAISE EXCEPTION '结算单未绑定店铺';
  END IF;

  SELECT s.city_id, s.status
  INTO v_store_city, v_store_status
  FROM public.stores s
  WHERE s.id = v_order.store_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION '店铺不存在';
  END IF;

  IF v_store_status <> 'active' THEN
    RAISE EXCEPTION '店铺已停用';
  END IF;

  CREATE TEMP TABLE IF NOT EXISTS _settlement_edit_input_tmp (
    product_id UUID NOT NULL,
    quantity INTEGER NOT NULL
  ) ON COMMIT DROP;

  CREATE TEMP TABLE IF NOT EXISTS _settlement_edit_new_tmp (
    product_id UUID PRIMARY KEY,
    new_qty INTEGER NOT NULL
  ) ON COMMIT DROP;

  CREATE TEMP TABLE IF NOT EXISTS _settlement_edit_old_tmp (
    product_id UUID PRIMARY KEY,
    old_qty INTEGER NOT NULL
  ) ON COMMIT DROP;

  CREATE TEMP TABLE IF NOT EXISTS _settlement_edit_delta_tmp (
    product_id UUID PRIMARY KEY,
    old_qty INTEGER NOT NULL,
    new_qty INTEGER NOT NULL,
    inventory_delta INTEGER NOT NULL,
    before_quantity INTEGER NOT NULL DEFAULT 0,
    after_quantity INTEGER NOT NULL DEFAULT 0
  ) ON COMMIT DROP;

  TRUNCATE TABLE _settlement_edit_input_tmp;
  TRUNCATE TABLE _settlement_edit_new_tmp;
  TRUNCATE TABLE _settlement_edit_old_tmp;
  TRUNCATE TABLE _settlement_edit_delta_tmp;

  INSERT INTO _settlement_edit_input_tmp (product_id, quantity)
  SELECT x.product_id, x.quantity
  FROM jsonb_to_recordset(p_items) AS x(
    product_id UUID,
    quantity INTEGER
  );

  IF NOT EXISTS (SELECT 1 FROM _settlement_edit_input_tmp) THEN
    RAISE EXCEPTION '结算项不能为空';
  END IF;

  IF EXISTS (SELECT 1 FROM _settlement_edit_input_tmp WHERE quantity <= 0) THEN
    RAISE EXCEPTION '结算数量必须大于0';
  END IF;

  INSERT INTO _settlement_edit_new_tmp (product_id, new_qty)
  SELECT product_id, SUM(quantity)::INTEGER AS new_qty
  FROM _settlement_edit_input_tmp
  GROUP BY product_id;

  INSERT INTO _settlement_edit_old_tmp (product_id, old_qty)
  SELECT product_id, COALESCE(SUM(quantity), 0)::INTEGER AS old_qty
  FROM public.order_items
  WHERE order_id = p_order_id
  GROUP BY product_id;

  IF EXISTS (
    SELECT 1
    FROM _settlement_edit_new_tmp ni
    LEFT JOIN public.products p ON p.id = ni.product_id
    WHERE p.id IS NULL
  ) THEN
    RAISE EXCEPTION '商品不存在';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM _settlement_edit_new_tmp ni
    JOIN public.products p ON p.id = ni.product_id
    WHERE p.city_id IS DISTINCT FROM v_store_city
  ) THEN
    RAISE EXCEPTION '店铺只能结算所属城市商品';
  END IF;

  INSERT INTO _settlement_edit_delta_tmp (product_id, old_qty, new_qty, inventory_delta)
  SELECT
    COALESCE(o.product_id, n.product_id) AS product_id,
    COALESCE(o.old_qty, 0) AS old_qty,
    COALESCE(n.new_qty, 0) AS new_qty,
    COALESCE(o.old_qty, 0) - COALESCE(n.new_qty, 0) AS inventory_delta
  FROM _settlement_edit_old_tmp o
  FULL OUTER JOIN _settlement_edit_new_tmp n ON n.product_id = o.product_id
  WHERE COALESCE(o.old_qty, 0) <> COALESCE(n.new_qty, 0);

  INSERT INTO public.store_inventory (store_id, product_id, quantity, updated_at)
  SELECT v_order.store_id, d.product_id, 0, NOW()
  FROM _settlement_edit_delta_tmp d
  ON CONFLICT (store_id, product_id) DO NOTHING;

  FOR v_agg IN
    SELECT product_id, old_qty, new_qty, inventory_delta
    FROM _settlement_edit_delta_tmp
    ORDER BY product_id
  LOOP
    SELECT si.quantity
    INTO v_store_stock
    FROM public.store_inventory si
    WHERE si.store_id = v_order.store_id
      AND si.product_id = v_agg.product_id
    FOR UPDATE;

    IF v_store_stock IS NULL THEN
      RAISE EXCEPTION '店铺库存记录不存在';
    END IF;

    IF v_store_stock + v_agg.inventory_delta < 0 THEN
      RAISE EXCEPTION '店铺库存不足';
    END IF;

    UPDATE _settlement_edit_delta_tmp
    SET before_quantity = v_store_stock,
        after_quantity = v_store_stock + v_agg.inventory_delta
    WHERE product_id = v_agg.product_id;
  END LOOP;

  SELECT
    COALESCE(SUM(p.price * ni.new_qty), 0),
    COALESCE(SUM(
      COALESCE(spp.override_price, s.discount_rate * p.price) * ni.new_qty
    ), 0)
  INTO v_total_retail, v_total_discount
  FROM _settlement_edit_new_tmp ni
  JOIN public.products p ON p.id = ni.product_id
  JOIN public.stores s ON s.id = v_order.store_id
  LEFT JOIN public.store_product_prices spp
    ON spp.store_id = v_order.store_id AND spp.product_id = ni.product_id;

  UPDATE public.store_inventory si
  SET quantity = d.after_quantity,
      updated_at = NOW()
  FROM _settlement_edit_delta_tmp d
  WHERE si.store_id = v_order.store_id
    AND si.product_id = d.product_id;

  DELETE FROM public.order_items
  WHERE order_id = p_order_id;

  INSERT INTO public.order_items (
    order_id,
    product_id,
    quantity,
    retail_price,
    discount_price,
    unit_cost,
    one_time_cost
  )
  SELECT
    p_order_id,
    ni.product_id,
    ni.new_qty,
    p.price,
    COALESCE(spp.override_price, s.discount_rate * p.price),
    p.cost,
    0
  FROM _settlement_edit_new_tmp ni
  JOIN public.products p ON p.id = ni.product_id
  JOIN public.stores s ON s.id = v_order.store_id
  LEFT JOIN public.store_product_prices spp
    ON spp.store_id = v_order.store_id AND spp.product_id = ni.product_id;

  UPDATE public.orders
  SET total_retail_amount = v_total_retail,
      total_discount_amount = v_total_discount,
      city_id = v_store_city
  WHERE id = p_order_id;

  INSERT INTO public.inventory_logs (
    product_id,
    operator_id,
    store_id,
    action,
    delta_quantity,
    before_quantity,
    after_quantity,
    note
  )
  SELECT
    d.product_id,
    v_actor_id,
    v_order.store_id,
    'settlement_edit',
    d.inventory_delta,
    d.before_quantity,
    d.after_quantity,
    FORMAT(
      '结算改单库存调整；order_id=%s；store_id=%s；old_qty=%s；new_qty=%s',
      p_order_id,
      v_order.store_id,
      d.old_qty,
      d.new_qty
    )
  FROM _settlement_edit_delta_tmp d
  WHERE d.inventory_delta <> 0;

  SELECT * INTO v_order
  FROM public.orders
  WHERE id = p_order_id;

  RETURN v_order;
END;
$$;

GRANT EXECUTE ON FUNCTION public.edit_settlement_order_atomic(UUID, JSONB) TO authenticated;

-- ============================================================
-- 6. Confirm settlement order RPC
--    Admin/super_admin only. Confirmation marks the already-deducted
--    settlement as accepted/paid and writes one offline settlement
--    finance income row. It intentionally does not deduct inventory.
--    Returns the confirmed order row for callers that need the final
--    server state.
-- ============================================================
DROP FUNCTION IF EXISTS public.confirm_settlement_order_atomic(UUID);

CREATE OR REPLACE FUNCTION public.confirm_settlement_order_atomic(
  p_order_id UUID
)
RETURNS public.orders
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor_id UUID := auth.uid();
  v_actor_role TEXT;
  v_order public.orders%ROWTYPE;
  v_store_city UUID;
  v_store_status TEXT;
  v_category_id UUID;
  v_income_amount DECIMAL(12, 2) := 0;
  v_confirmed_at TIMESTAMP WITH TIME ZONE := NOW();
BEGIN
  IF v_actor_id IS NULL THEN
    RAISE EXCEPTION '未登录';
  END IF;

  SELECT role INTO v_actor_role
  FROM public.profiles
  WHERE id = v_actor_id;

  IF v_actor_role IS NULL THEN
    RAISE EXCEPTION '用户资料不存在';
  END IF;

  IF v_actor_role NOT IN ('admin', 'super_admin') THEN
    RAISE EXCEPTION '当前角色无确认结算单权限';
  END IF;

  SELECT * INTO v_order
  FROM public.orders
  WHERE id = p_order_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION '订单不存在';
  END IF;

  IF COALESCE(v_order.order_kind::TEXT, 'distribution') <> 'settlement' THEN
    RAISE EXCEPTION '不是结算单';
  END IF;

  IF v_order.confirmed_at IS NOT NULL THEN
    RAISE EXCEPTION '结算单已确认，不能重复确认';
  END IF;

  IF v_order.status <> 'pending' THEN
    RAISE EXCEPTION '结算单状态不可确认';
  END IF;

  IF COALESCE(v_order.payment_status, 'pending') <> 'pending' THEN
    RAISE EXCEPTION '结算单支付状态不可确认';
  END IF;

  IF v_order.store_id IS NULL THEN
    RAISE EXCEPTION '结算单未绑定店铺';
  END IF;

  SELECT s.city_id, s.status
  INTO v_store_city, v_store_status
  FROM public.stores s
  WHERE s.id = v_order.store_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION '店铺不存在';
  END IF;

  IF v_store_status <> 'active' THEN
    RAISE EXCEPTION '店铺已停用';
  END IF;

  SELECT id INTO v_category_id
  FROM public.finance_categories
  WHERE name = '线下店铺回款'
    AND type = 'income';

  IF v_category_id IS NULL THEN
    RAISE EXCEPTION '线下店铺回款分类不存在';
  END IF;

  SELECT COALESCE(SUM(COALESCE(oi.discount_price, oi.retail_price, 0) * oi.quantity), 0)::DECIMAL(12, 2)
  INTO v_income_amount
  FROM public.order_items oi
  WHERE oi.order_id = p_order_id;

  IF v_income_amount <= 0 THEN
    RAISE EXCEPTION '结算金额必须大于0';
  END IF;

  UPDATE public.orders
  SET status = 'accepted',
      payment_status = 'paid',
      payment_paid_at = COALESCE(payment_paid_at, v_confirmed_at),
      confirmed_at = v_confirmed_at,
      city_id = v_store_city,
      total_discount_amount = v_income_amount
  WHERE id = p_order_id;

  INSERT INTO public.financial_transactions (
    transaction_type,
    category_id,
    amount,
    transaction_date,
    store_id,
    city_id,
    channel_name,
    description,
    is_recurring,
    created_by,
    source_order_id
  ) VALUES (
    'income',
    v_category_id,
    v_income_amount,
    v_confirmed_at::date,
    v_order.store_id,
    v_store_city,
    'offline_settlement',
    FORMAT('结算单确认回款；order_id=%s；store_id=%s', p_order_id, v_order.store_id),
    FALSE,
    v_actor_id,
    p_order_id
  );

  SELECT * INTO v_order
  FROM public.orders
  WHERE id = p_order_id;

  RETURN v_order;
END;
$$;

GRANT EXECUTE ON FUNCTION public.confirm_settlement_order_atomic(UUID) TO authenticated;

-- ============================================================
-- 7. Delete guard wrapper
--    Preserve the v8.8 return-order wrapper by renaming the current
--    public function, then add a narrow confirmed-settlement guard.
-- ============================================================
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = 'delete_order_with_inventory_restore_atomic'
      AND pg_get_function_identity_arguments(p.oid) = 'p_order_id uuid'
  ) AND NOT EXISTS (
    SELECT 1
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = 'delete_order_with_inventory_restore_atomic_v88'
      AND pg_get_function_identity_arguments(p.oid) = 'p_order_id uuid'
  ) THEN
    ALTER FUNCTION public.delete_order_with_inventory_restore_atomic(UUID)
      RENAME TO delete_order_with_inventory_restore_atomic_v88;
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.delete_order_with_inventory_restore_atomic(
  p_order_id UUID
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_role TEXT;
  v_order public.orders%ROWTYPE;
  v_order_kind TEXT;
BEGIN
  SELECT role INTO v_role
  FROM public.profiles
  WHERE id = v_uid;

  SELECT * INTO v_order
  FROM public.orders
  WHERE id = p_order_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION '订单不存在';
  END IF;

  v_order_kind := COALESCE(v_order.order_kind::TEXT, 'distribution');

  IF v_order_kind = 'settlement' AND v_order.confirmed_at IS NOT NULL THEN
    IF NOT (
      v_role IN ('admin', 'super_admin', 'inventory_manager')
      OR v_order.distributor_id = v_uid
    ) THEN
      RAISE EXCEPTION '当前账号无删除订单权限';
    END IF;

    RAISE EXCEPTION '已确认结算单不能删除';
  END IF;

  PERFORM public.delete_order_with_inventory_restore_atomic_v88(p_order_id);
END;
$$;

GRANT EXECUTE ON FUNCTION public.delete_order_with_inventory_restore_atomic(UUID) TO authenticated;

-- ============================================================
-- 8. Bump schema_version to 9.0.0
-- ============================================================
INSERT INTO public.app_schema_meta (key, value)
VALUES ('schema_version', '9.0.0')
ON CONFLICT (key)
DO UPDATE SET
  value = EXCLUDED.value,
  updated_at = NOW();
