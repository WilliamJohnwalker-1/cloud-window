-- Migration v6.3: Finance integration (product/order linkage + RLS fix + cash balance function)
-- Execute after migrate-v6.2-knowledge-base.sql

-- Pre-check: Ensure schema version is at least 6.2.0 and not already 6.3.0 or higher
DO $$
BEGIN
  IF public.get_app_schema_version() < '6.2.0' THEN
    RAISE EXCEPTION 'Migration v6.2.0 must be applied before v6.3.0';
  END IF;
  IF public.get_app_schema_version() >= '6.3.0' THEN
    RAISE NOTICE 'Schema version is already 6.3.0 or higher. Skipping migration.';
    -- In a real script we might want to exit, but for Supabase SQL Editor we just let the rest be idempotent.
  END IF;
END $$;

-- Purpose:
-- Execute after migrate-v6.2-knowledge-base.sql
-- Purpose:
-- 1) Add financial_transactions.product_id (nullable FK to products)
-- 2) Add financial_transactions.source_order_id (nullable FK to orders)
-- 3) Add orders.supplier_id (nullable FK to suppliers)
-- 4) Fix finance SELECT RLS: finance can now read financial_transactions + cash_balance
-- 5) Add finance SELECT access for products and stores
-- 6) Add cash_balance.initial_balance and migrate existing balance into it
-- 7) Add get_cash_balance() function (initial_balance + income - expense)
-- 8) Extend inventory_logs action CHECK to include 'breakage' and 'purchase_receive'
-- 9) Override confirm_purchase_delivery_atomic to auto-create procurement expense + receive logs
-- 10) Add create_breakage_transaction RPC
-- 11) Bump schema_version to 6.3.0
--
-- Scope: schema + RLS + targeted finance/inventory RPC overrides only. No UI.
-- Depends on: migrate-v6.0-foundation.sql, migrate-v6.1-finance.sql, migrate-v6.2-knowledge-base.sql.

-- ============================================================
-- 1. financial_transactions: add product_id + source_order_id
-- ============================================================
ALTER TABLE public.financial_transactions
  ADD COLUMN IF NOT EXISTS product_id UUID REFERENCES public.products(id) ON DELETE SET NULL;

ALTER TABLE public.financial_transactions
  ADD COLUMN IF NOT EXISTS source_order_id UUID REFERENCES public.orders(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.financial_transactions.product_id IS 'Linked product for product-level finance tracking (nullable)';
COMMENT ON COLUMN public.financial_transactions.source_order_id IS 'Linked order that originated this transaction (nullable)';

CREATE INDEX IF NOT EXISTS idx_financial_transactions_product_id
  ON public.financial_transactions(product_id);

CREATE INDEX IF NOT EXISTS idx_financial_transactions_source_order_id
  ON public.financial_transactions(source_order_id);

-- ============================================================
-- 2. orders: add supplier_id
-- ============================================================
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS supplier_id UUID REFERENCES public.suppliers(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.orders.supplier_id IS 'Supplier for purchase orders (nullable, set NULL on supplier delete)';

CREATE INDEX IF NOT EXISTS idx_orders_supplier_id
  ON public.orders(supplier_id);

-- ============================================================
-- 2.1 create_purchase_order_atomic supplier-aware wrapper
--     Keeps existing 4-arg RPC behavior and adds a 5th optional
--     supplier_id argument for purchase-order creation flows.
-- ============================================================
CREATE OR REPLACE FUNCTION public.create_purchase_order_atomic(
  p_user_id UUID,
  p_store_id UUID,
  p_city_id UUID,
  p_items JSONB,
  p_supplier_id UUID DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order_id UUID;
BEGIN
  v_order_id := public.create_purchase_order_atomic(
    p_user_id,
    p_store_id,
    p_city_id,
    p_items
  );

  IF p_supplier_id IS NOT NULL THEN
    UPDATE public.orders
    SET supplier_id = p_supplier_id
    WHERE id = v_order_id;
  END IF;

  RETURN v_order_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_purchase_order_atomic(UUID, UUID, UUID, JSONB, UUID) TO authenticated;

-- ============================================================
-- 3. Finance SELECT RLS fix for financial_transactions
--    Finance can read only the transactions they created (created_by = auth.uid()).
--    Admin-wide visibility remains via the existing "Admins can view financial transactions"
--    policy from migrate-v6.1-finance.sql. This policy is additive and does not touch it.
-- ============================================================
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'financial_transactions'
      AND policyname = 'Finance can view financial transactions'
  ) THEN
    CREATE POLICY "Finance can view financial transactions" ON public.financial_transactions
      FOR SELECT TO authenticated
      USING (public.is_finance() AND created_by = auth.uid());
  END IF;
END $$;

-- ============================================================
-- 4. Finance SELECT RLS fix for cash_balance
--    Same class of bug: finance could write but not read.
-- ============================================================
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'cash_balance'
      AND policyname = 'Finance can view cash balance'
  ) THEN
    CREATE POLICY "Finance can view cash balance" ON public.cash_balance
      FOR SELECT TO authenticated
      USING (public.is_finance());
  END IF;
END $$;

-- ============================================================
-- 5. Finance SELECT access for products
--    Products already has a blanket authenticated SELECT policy
--    (migrate-v3.9), so finance is already covered. We add an
--    explicit finance policy for clarity and future-proofing
--    against potential policy tightening.
-- ============================================================
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'products'
      AND policyname = 'Finance can view products'
  ) THEN
    CREATE POLICY "Finance can view products" ON public.products
      FOR SELECT TO authenticated
      USING (public.is_finance());
  END IF;
END $$;

-- ============================================================
-- 6. Finance SELECT access for stores
--    Stores currently allows admin (FOR ALL) and distributor
--    (own stores only). Finance needs read access for reporting.
-- ============================================================
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'stores'
      AND policyname = 'Finance can view stores'
  ) THEN
    CREATE POLICY "Finance can view stores" ON public.stores
      FOR SELECT TO authenticated
      USING (public.is_finance());
  END IF;
END $$;

-- ============================================================
-- 7. cash_balance: add initial_balance + migrate existing balance
-- ============================================================
ALTER TABLE public.cash_balance
  ADD COLUMN IF NOT EXISTS initial_balance DECIMAL(12, 2) NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.cash_balance.initial_balance IS 'Opening cash balance; get_cash_balance() adds income/expense transactions on top';

-- Migrate existing balance into initial_balance (idempotent).
-- Only touches rows where initial_balance is still the default 0 and
-- the legacy balance is non-zero, avoiding re-migration on subsequent runs.
UPDATE public.cash_balance
SET initial_balance = balance
WHERE initial_balance = 0 AND balance <> 0;

-- ============================================================
-- 8. get_cash_balance() function
--    Returns initial_balance + SUM(income) - SUM(expense).
--    SECURITY DEFINER bypasses RLS so any authenticated caller
--    gets the computed balance without needing direct table SELECT.
-- ============================================================
CREATE OR REPLACE FUNCTION public.get_cash_balance()
RETURNS DECIMAL(12, 2)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    COALESCE((SELECT initial_balance FROM public.cash_balance LIMIT 1), 0)
    + COALESCE((SELECT SUM(amount) FROM public.financial_transactions WHERE transaction_type = 'income'), 0)
    - COALESCE((SELECT SUM(amount) FROM public.financial_transactions WHERE transaction_type = 'expense'), 0);
$$;

GRANT EXECUTE ON FUNCTION public.get_cash_balance() TO authenticated;

-- ============================================================
-- 9. inventory_logs: extend action CHECK to include 'breakage' and 'purchase_receive'
--    Idempotent: only drops+re-adds the constraint when the current
--    definition is missing at least one of the new action values.
--    Preserves existing actions: inbound, manual_adjust, quick_add, quick_reduce.
-- ============================================================
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

  -- Replace only when the current constraint is missing at least one
  -- new value. If both 'breakage' and 'purchase_receive' are already
  -- present this block is a no-op (idempotent). If the constraint does
  -- not exist at all (v_constraint_def IS NULL) we add it fresh.
  IF v_constraint_def IS NULL
     OR v_constraint_def NOT ILIKE '%breakage%'
     OR v_constraint_def NOT ILIKE '%purchase_receive%'
  THEN
    ALTER TABLE public.inventory_logs
      DROP CONSTRAINT IF EXISTS inventory_logs_action_check;

    ALTER TABLE public.inventory_logs
      ADD CONSTRAINT inventory_logs_action_check
      CHECK (action IN ('inbound', 'manual_adjust', 'quick_add', 'quick_reduce', 'breakage', 'purchase_receive'));
  END IF;
END $$;

-- ============================================================
-- 10. confirm_purchase_delivery_atomic override
--     Preserves v5.5 inventory receipt routing/idempotency and now
--     auto-creates one 采购成本 expense plus one purchase_receive
--     inventory log per received product movement.
-- ============================================================
CREATE OR REPLACE FUNCTION public.confirm_purchase_delivery_atomic(
  p_order_id UUID,
  p_confirmed_by UUID
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor_id UUID := auth.uid();
  v_actor_role TEXT;
  v_confirmed_role TEXT;
  v_order public.orders%ROWTYPE;
  v_store_name TEXT;
  v_store_status TEXT;
  v_inventory_pool TEXT;
  v_category_id UUID;
  v_purchase_amount DECIMAL(12, 2) := 0;
  v_transaction_id UUID;
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
    RAISE EXCEPTION '当前角色无确认进货权限';
  END IF;

  IF p_confirmed_by IS NULL THEN
    RAISE EXCEPTION '确认人不能为空';
  END IF;

  SELECT role INTO v_confirmed_role
  FROM public.profiles
  WHERE id = p_confirmed_by;

  IF v_confirmed_role IS NULL THEN
    RAISE EXCEPTION '确认人不存在';
  END IF;

  SELECT * INTO v_order
  FROM public.orders
  WHERE id = p_order_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION '订单不存在';
  END IF;

  IF COALESCE(v_order.order_kind::TEXT, 'distribution') <> 'purchase' THEN
    RAISE EXCEPTION '不是进货单';
  END IF;

  -- Idempotency guard: accepted purchase orders have already applied inventory.
  IF v_order.status = 'accepted' THEN
    RETURN;
  END IF;

  IF v_order.status <> 'pending' THEN
    RAISE EXCEPTION '进货单状态不可确认';
  END IF;

  IF v_order.store_id IS NULL THEN
    RAISE EXCEPTION '进货单未绑定店铺';
  END IF;

  SELECT s.name, s.status
  INTO v_store_name, v_store_status
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
  WHERE name = '采购成本'
    AND type = 'expense';

  IF v_category_id IS NULL THEN
    RAISE EXCEPTION '采购成本分类不存在';
  END IF;

  SELECT COALESCE(
    SUM((COALESCE(oi.quantity, 0)::NUMERIC * COALESCE(oi.unit_cost, 0)) + COALESCE(oi.one_time_cost, 0)),
    0
  )::DECIMAL(12, 2)
  INTO v_purchase_amount
  FROM public.order_items oi
  WHERE oi.order_id = p_order_id;

  CREATE TEMP TABLE IF NOT EXISTS _purchase_receive_items_tmp (
    product_id UUID PRIMARY KEY,
    total_qty INTEGER NOT NULL,
    before_quantity INTEGER NOT NULL DEFAULT 0,
    after_quantity INTEGER NOT NULL DEFAULT 0
  ) ON COMMIT DROP;

  TRUNCATE TABLE _purchase_receive_items_tmp;

  INSERT INTO _purchase_receive_items_tmp (product_id, total_qty)
  SELECT
    oi.product_id,
    COALESCE(SUM(oi.quantity), 0)::INTEGER AS total_qty
  FROM public.order_items oi
  WHERE oi.order_id = p_order_id
  GROUP BY oi.product_id;

  UPDATE public.orders
  SET status = 'accepted'
  WHERE id = p_order_id;

  IF v_store_name = '云窗' THEN
    v_inventory_pool := 'inventory';

    WITH received AS (
      INSERT INTO public.inventory (product_id, quantity, updated_at)
      SELECT
        t.product_id,
        t.total_qty,
        NOW()
      FROM _purchase_receive_items_tmp t
      ON CONFLICT (product_id)
      DO UPDATE SET
        quantity = public.inventory.quantity + EXCLUDED.quantity,
        updated_at = NOW()
      RETURNING product_id, quantity AS after_quantity
    )
    UPDATE _purchase_receive_items_tmp t
    SET before_quantity = received.after_quantity - t.total_qty,
        after_quantity = received.after_quantity
    FROM received
    WHERE received.product_id = t.product_id;
  ELSE
    v_inventory_pool := 'store_inventory';

    WITH received AS (
      INSERT INTO public.store_inventory (store_id, product_id, quantity, updated_at)
      SELECT
        v_order.store_id,
        t.product_id,
        t.total_qty,
        NOW()
      FROM _purchase_receive_items_tmp t
      ON CONFLICT (store_id, product_id)
      DO UPDATE SET
        quantity = public.store_inventory.quantity + EXCLUDED.quantity,
        updated_at = NOW()
      RETURNING product_id, quantity AS after_quantity
    )
    UPDATE _purchase_receive_items_tmp t
    SET before_quantity = received.after_quantity - t.total_qty,
        after_quantity = received.after_quantity
    FROM received
    WHERE received.product_id = t.product_id;
  END IF;

  INSERT INTO public.financial_transactions (
    transaction_type,
    category_id,
    amount,
    transaction_date,
    store_id,
    supplier_id,
    description,
    created_by,
    source_order_id
  ) VALUES (
    'expense',
    v_category_id,
    v_purchase_amount,
    CURRENT_DATE,
    v_order.store_id,
    v_order.supplier_id,
    FORMAT('进货单确认入库；order_id=%s；store_name=%s', p_order_id, v_store_name),
    p_confirmed_by,
    p_order_id
  )
  RETURNING id INTO v_transaction_id;

  INSERT INTO public.inventory_logs (
    product_id,
    operator_id,
    action,
    delta_quantity,
    before_quantity,
    after_quantity,
    note
  )
  SELECT
    t.product_id,
    p_confirmed_by,
    'purchase_receive',
    t.total_qty,
    t.before_quantity,
    t.after_quantity,
    FORMAT(
      '进货到货入库；order_id=%s；store_id=%s；store_name=%s；inventory_pool=%s；financial_transaction_id=%s',
      p_order_id,
      v_order.store_id,
      v_store_name,
      v_inventory_pool,
      v_transaction_id
    )
  FROM _purchase_receive_items_tmp t;
END;
$$;

GRANT EXECUTE ON FUNCTION public.confirm_purchase_delivery_atomic(UUID, UUID) TO authenticated;

-- ============================================================
-- 11. delete_order_with_inventory_restore_atomic override
--     Extends purchase-order delete rollback to also remove
--     purchase-confirm auto-generated finance/log records.
-- ============================================================
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
  v_store_name TEXT;
  v_purchase_tx_ids UUID[] := ARRAY[]::UUID[];
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

  IF COALESCE(v_order.order_kind::TEXT, 'distribution') = 'purchase' THEN
    IF v_role NOT IN ('admin', 'super_admin') THEN
      RAISE EXCEPTION '当前账号无删除进货单权限';
    END IF;
  ELSIF NOT (
    v_role IN ('admin', 'super_admin', 'inventory_manager')
    OR v_order.distributor_id = v_uid
  ) THEN
    RAISE EXCEPTION '当前账号无删除订单权限';
  END IF;

  -- Fully refunded orders already returned inventory via refund workflow.
  -- Delete only, without another restore, to prevent duplicate rollback.
  IF LOWER(COALESCE(v_order.payment_status::TEXT, '')) = 'refunded' THEN
    DELETE FROM public.orders WHERE id = p_order_id;
    RETURN;
  END IF;

  -- Branch 1: Purchase orders (order_kind = 'purchase')
  -- Pending purchase orders have not mutated inventory. Accepted purchase
  -- orders are rolled back opposite to their confirm destination.
  IF COALESCE(v_order.order_kind::TEXT, 'distribution') = 'purchase' THEN
    -- Clean v6.3 purchase-confirm automation records for this order only.
    -- 1) Delete 采购成本 expense records linked by source_order_id.
    -- 2) Delete purchase_receive logs tied by order_id prefix or deleted tx id.
    WITH deleted_tx AS (
      DELETE FROM public.financial_transactions ft
      USING public.finance_categories fc
      WHERE ft.source_order_id = p_order_id
        AND ft.transaction_type = 'expense'
        AND ft.category_id = fc.id
        AND fc.name = '采购成本'
        AND fc.type = 'expense'
        AND ft.description LIKE FORMAT('进货单确认入库；order_id=%s%%', p_order_id)
      RETURNING ft.id
    )
    SELECT COALESCE(ARRAY_AGG(id), ARRAY[]::UUID[])
    INTO v_purchase_tx_ids
    FROM deleted_tx;

    DELETE FROM public.inventory_logs il
    WHERE il.action = 'purchase_receive'
      AND (
        il.note LIKE FORMAT('进货到货入库；order_id=%s%%', p_order_id)
        OR EXISTS (
          SELECT 1
          FROM UNNEST(v_purchase_tx_ids) AS tx(id)
          WHERE il.note LIKE FORMAT('%%financial_transaction_id=%s%%', tx.id::TEXT)
        )
      );

    IF v_order.status = 'accepted' THEN
      IF v_order.store_id IS NULL THEN
        RAISE EXCEPTION '进货单未绑定店铺';
      END IF;

      SELECT s.name INTO v_store_name
      FROM public.stores s
      WHERE s.id = v_order.store_id;

      IF NOT FOUND THEN
        RAISE EXCEPTION '店铺不存在';
      END IF;

      IF v_store_name = '云窗' THEN
        UPDATE public.inventory i
        SET quantity = i.quantity - agg.total_qty,
            updated_at = NOW()
        FROM (
          SELECT oi.product_id, COALESCE(SUM(oi.quantity), 0)::INTEGER AS total_qty
          FROM public.order_items oi
          WHERE oi.order_id = p_order_id
          GROUP BY oi.product_id
        ) agg
        WHERE i.product_id = agg.product_id;
      ELSE
        UPDATE public.store_inventory si
        SET quantity = si.quantity - agg.total_qty,
            updated_at = NOW()
        FROM (
          SELECT oi.product_id, COALESCE(SUM(oi.quantity), 0)::INTEGER AS total_qty
          FROM public.order_items oi
          WHERE oi.order_id = p_order_id
          GROUP BY oi.product_id
        ) agg
        WHERE si.store_id = v_order.store_id
          AND si.product_id = agg.product_id;
      END IF;
    ELSIF v_order.status <> 'pending' THEN
      RAISE EXCEPTION '进货单状态不可删除';
    END IF;

  -- Branch 2: Settlement orders (order_kind = 'settlement')
  -- Only store_inventory was debited, so only restore to store_inventory
  ELSIF COALESCE(v_order.order_kind::TEXT, 'distribution') = 'settlement' THEN
    IF v_order.store_id IS NOT NULL THEN
      INSERT INTO public.store_inventory (store_id, product_id, quantity, updated_at)
      SELECT
        v_order.store_id,
        agg.product_id,
        agg.total_qty,
        NOW()
      FROM (
        SELECT oi.product_id, COALESCE(SUM(oi.quantity), 0)::INTEGER AS total_qty
        FROM public.order_items oi
        WHERE oi.order_id = p_order_id
        GROUP BY oi.product_id
      ) agg
      ON CONFLICT (store_id, product_id)
      DO UPDATE SET
        quantity = public.store_inventory.quantity + EXCLUDED.quantity,
        updated_at = NOW();
    END IF;

  -- Branch 3: Store retail mobile order (retail + store_id + msr: prefix)
  -- Restore to store_inventory only; public.inventory was never debited
  ELSIF COALESCE(v_order.order_kind::TEXT, 'distribution') = 'retail'
     AND v_order.store_id IS NOT NULL
     AND v_order.request_id LIKE 'msr:%' THEN
    INSERT INTO public.store_inventory (store_id, product_id, quantity, updated_at)
    SELECT
      v_order.store_id,
      agg.product_id,
      agg.total_qty,
      NOW()
    FROM (
      SELECT oi.product_id, COALESCE(SUM(oi.quantity), 0)::INTEGER AS total_qty
      FROM public.order_items oi
      WHERE oi.order_id = p_order_id
      GROUP BY oi.product_id
    ) agg
    ON CONFLICT (store_id, product_id)
    DO UPDATE SET
      quantity = public.store_inventory.quantity + EXCLUDED.quantity,
      updated_at = NOW();

  -- Branch 4: Global-source orders (distribution / non-store retail / legacy)
  -- Preserve existing behavior exactly
  ELSE
    -- Always restore to public.inventory
    UPDATE public.inventory i
    SET quantity = i.quantity + agg.total_qty,
        updated_at = NOW()
    FROM (
      SELECT oi.product_id, COALESCE(SUM(oi.quantity), 0)::INTEGER AS total_qty
      FROM public.order_items oi
      WHERE oi.order_id = p_order_id
      GROUP BY oi.product_id
    ) agg
    WHERE i.product_id = agg.product_id;

    -- For distribution orders with store_id, subtract from store_inventory
    IF v_order.store_id IS NOT NULL
       AND COALESCE(v_order.order_kind::TEXT, 'distribution') = 'distribution' THEN
      UPDATE public.store_inventory si
      SET quantity = si.quantity - agg.store_qty,
          updated_at = NOW()
      FROM (
        SELECT
          oi.product_id,
          COALESCE(SUM(CASE WHEN oi.is_sample THEN 0 ELSE oi.quantity END), 0)::INTEGER AS store_qty
        FROM public.order_items oi
        WHERE oi.order_id = p_order_id
        GROUP BY oi.product_id
      ) agg
      WHERE si.store_id = v_order.store_id
        AND si.product_id = agg.product_id
        AND agg.store_qty > 0;
    END IF;
  END IF;

  DELETE FROM public.orders WHERE id = p_order_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.delete_order_with_inventory_restore_atomic(UUID) TO authenticated;

-- ============================================================
-- 12. create_breakage_transaction RPC
--     Deducts the correct inventory pool, creates one 损耗 expense,
--     and writes one legacy-shape inventory log entry atomically.
-- ============================================================
CREATE OR REPLACE FUNCTION public.create_breakage_transaction(
  p_product_id UUID,
  p_store_id UUID,
  p_quantity INTEGER,
  p_created_by UUID
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor_id UUID := auth.uid();
  v_created_by_role TEXT;
  v_store_name TEXT;
  v_store_status TEXT;
  v_product_cost NUMERIC(10, 2);
  v_category_id UUID;
  v_before_quantity INTEGER := 0;
  v_after_quantity INTEGER := 0;
  v_transaction_id UUID;
  v_inventory_pool TEXT;
BEGIN
  IF v_actor_id IS NULL THEN
    RAISE EXCEPTION '未登录';
  END IF;

  IF p_created_by IS NULL THEN
    RAISE EXCEPTION '操作人不能为空';
  END IF;

  IF v_actor_id IS DISTINCT FROM p_created_by THEN
    RAISE EXCEPTION '操作人不匹配';
  END IF;

  SELECT role INTO v_created_by_role
  FROM public.profiles
  WHERE id = p_created_by;

  IF v_created_by_role IS NULL THEN
    RAISE EXCEPTION '操作人不存在';
  END IF;

  IF v_created_by_role NOT IN ('admin', 'super_admin', 'inventory_manager', 'finance') THEN
    RAISE EXCEPTION '当前角色无报损权限';
  END IF;

  IF p_product_id IS NULL THEN
    RAISE EXCEPTION '商品ID不能为空';
  END IF;

  SELECT COALESCE(cost, 0)
  INTO v_product_cost
  FROM public.products
  WHERE id = p_product_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION '商品不存在';
  END IF;

  IF p_store_id IS NULL THEN
    RAISE EXCEPTION '店铺ID不能为空';
  END IF;

  SELECT name, status
  INTO v_store_name, v_store_status
  FROM public.stores
  WHERE id = p_store_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION '店铺不存在';
  END IF;

  IF v_store_status IS NOT NULL AND v_store_status <> 'active' THEN
    RAISE EXCEPTION '店铺已停用';
  END IF;

  IF p_quantity IS NULL OR p_quantity <= 0 THEN
    RAISE EXCEPTION '报损数量必须大于0';
  END IF;

  SELECT id INTO v_category_id
  FROM public.finance_categories
  WHERE name = '损耗'
    AND type = 'expense';

  IF v_category_id IS NULL THEN
    RAISE EXCEPTION '损耗分类不存在';
  END IF;

  IF v_store_name = '云窗' THEN
    v_inventory_pool := 'inventory';

    SELECT quantity
    INTO v_before_quantity
    FROM public.inventory
    WHERE product_id = p_product_id
    FOR UPDATE;

    v_before_quantity := COALESCE(v_before_quantity, 0);

    IF v_before_quantity < p_quantity THEN
      RAISE EXCEPTION '库存不足';
    END IF;

    v_after_quantity := v_before_quantity - p_quantity;

    UPDATE public.inventory
    SET quantity = v_after_quantity,
        updated_at = NOW()
    WHERE product_id = p_product_id;
  ELSE
    v_inventory_pool := 'store_inventory';

    SELECT quantity
    INTO v_before_quantity
    FROM public.store_inventory
    WHERE store_id = p_store_id
      AND product_id = p_product_id
    FOR UPDATE;

    v_before_quantity := COALESCE(v_before_quantity, 0);

    IF v_before_quantity < p_quantity THEN
      RAISE EXCEPTION '库存不足';
    END IF;

    v_after_quantity := v_before_quantity - p_quantity;

    UPDATE public.store_inventory
    SET quantity = v_after_quantity,
        updated_at = NOW()
    WHERE store_id = p_store_id
      AND product_id = p_product_id;
  END IF;

  INSERT INTO public.financial_transactions (
    transaction_type,
    category_id,
    amount,
    transaction_date,
    store_id,
    product_id,
    created_by
  ) VALUES (
    'expense',
    v_category_id,
    (p_quantity * v_product_cost)::DECIMAL(12, 2),
    CURRENT_DATE,
    p_store_id,
    p_product_id,
    p_created_by
  )
  RETURNING id INTO v_transaction_id;

  INSERT INTO public.inventory_logs (
    product_id,
    operator_id,
    action,
    delta_quantity,
    before_quantity,
    after_quantity,
    note
  ) VALUES (
    p_product_id,
    p_created_by,
    'breakage',
    -p_quantity,
    v_before_quantity,
    v_after_quantity,
    FORMAT('报损扣减；store_id=%s；store_name=%s；inventory_pool=%s；financial_transaction_id=%s',
      p_store_id,
      v_store_name,
      v_inventory_pool,
      v_transaction_id
    )
  );

  RETURN v_transaction_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_breakage_transaction(UUID, UUID, INTEGER, UUID) TO authenticated;

-- ============================================================
-- 13. Bump schema_version to 6.3.0
-- ============================================================
INSERT INTO public.app_schema_meta (key, value)
VALUES ('schema_version', '6.3.0')
ON CONFLICT (key)
DO UPDATE SET
  value = EXCLUDED.value,
  updated_at = NOW();
