-- Migration v5.3: Simple field additions for products, stores, store_inventory
--                + notifications type CHECK expansion (inventory_alert)
-- Execute after migrate-v5.2-province.sql
-- Purpose:
-- 1) Add products.sku TEXT (nullable)
-- 2) Add products.category TEXT (nullable)
-- 3) Add stores.settlement_day INTEGER (1..31, nullable)
-- 4) Add stores.cooperation_mode TEXT (consignment/buyout/direct, nullable)
-- 5) Add store_inventory.min_quantity INTEGER DEFAULT 30
-- 6) Expand notifications type CHECK to include 'inventory_alert'
--    (preserving all existing refund_* types from migrate-v4.9-refund-approval.sql)
-- 7) Bump schema_version to 5.3.0
--
-- Scope: fields + notification type constraint only. No RPCs, triggers, policies,
--        or unrelated schema changes. Inventory alert trigger logic belongs to T17.

-- ============================================================
-- 1. products.sku + products.category
-- ============================================================
ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS sku TEXT DEFAULT NULL;

ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS category TEXT DEFAULT NULL;

COMMENT ON COLUMN public.products.sku IS 'External SKU code for the product (nullable, free-form text)';
COMMENT ON COLUMN public.products.category IS 'Product category label for grouping/filtering (nullable, free-form text)';

-- ============================================================
-- 2. stores.settlement_day + stores.cooperation_mode
-- ============================================================
ALTER TABLE public.stores
  ADD COLUMN IF NOT EXISTS settlement_day INTEGER DEFAULT NULL;

ALTER TABLE public.stores
  ADD COLUMN IF NOT EXISTS cooperation_mode TEXT DEFAULT NULL;

-- Idempotent CHECK constraint for settlement_day (1..31)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'stores_settlement_day_check'
      AND conrelid = 'public.stores'::regclass
  ) THEN
    ALTER TABLE public.stores
      ADD CONSTRAINT stores_settlement_day_check
      CHECK (settlement_day IS NULL OR (settlement_day >= 1 AND settlement_day <= 31));
  END IF;
END $$;

-- Idempotent CHECK constraint for cooperation_mode
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'stores_cooperation_mode_check'
      AND conrelid = 'public.stores'::regclass
  ) THEN
    ALTER TABLE public.stores
      ADD CONSTRAINT stores_cooperation_mode_check
      CHECK (cooperation_mode IS NULL OR cooperation_mode IN ('consignment', 'buyout', 'direct'));
  END IF;
END $$;

COMMENT ON COLUMN public.stores.settlement_day IS 'Day of month (1..31) for settlement cycle, nullable when not applicable';
COMMENT ON COLUMN public.stores.cooperation_mode IS 'Cooperation mode: consignment | buyout | direct (nullable)';

-- ============================================================
-- 3. store_inventory.min_quantity (default 30)
-- ============================================================
ALTER TABLE public.store_inventory
  ADD COLUMN IF NOT EXISTS min_quantity INTEGER DEFAULT 30;

COMMENT ON COLUMN public.store_inventory.min_quantity IS 'Per-store low-stock alert threshold; default 30 (used by T17 inventory alert)';

-- ============================================================
-- 4. notifications type CHECK expansion (add 'inventory_alert')
--    Preserve all existing types from migrate-v4.9-refund-approval.sql:
--    new_order, order_accepted, refund_requested, refund_approved,
--    refund_rejected, refund_completed, refund_failed
-- ============================================================
DO $$
DECLARE
  v_constraint_name TEXT;
BEGIN
  SELECT con.conname
  INTO v_constraint_name
  FROM pg_constraint con
  JOIN pg_class rel ON rel.oid = con.conrelid
  JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
  WHERE nsp.nspname = 'public'
    AND rel.relname = 'notifications'
    AND con.contype = 'c'
    AND pg_get_constraintdef(con.oid) ILIKE '%type%';

  IF v_constraint_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE public.notifications DROP CONSTRAINT %I', v_constraint_name);
  END IF;
END $$;

ALTER TABLE public.notifications
  ADD CONSTRAINT notifications_type_check
  CHECK (
    type IN (
      'new_order',
      'order_accepted',
      'refund_requested',
      'refund_approved',
      'refund_rejected',
      'refund_completed',
      'refund_failed',
      'inventory_alert'
    )
  );

-- ============================================================
-- 5. Schema version gate
-- ============================================================
INSERT INTO public.app_schema_meta (key, value)
VALUES ('schema_version', '5.3.0')
ON CONFLICT (key)
DO UPDATE SET
  value = EXCLUDED.value,
  updated_at = NOW();