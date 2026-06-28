-- Migration v6.4: Historical financial backfill for retail/settlement orders
-- Execute after migrate-v6.3-finance-integration.sql

-- Pre-check: Ensure schema version is at least 6.3.0
DO $$
BEGIN
  IF public.get_app_schema_version() < '6.3.0' THEN
    RAISE EXCEPTION 'Migration v6.3.0 must be applied before v6.4.0';
  END IF;
END $$;

BEGIN;

-- Purpose:
-- Execute after migrate-v6.3-finance-integration.sql
-- Purpose:
-- 1) Backfill paid retail orders -> income(线上渠道收入) + fee expense(线上佣金)
-- 2) Backfill settlement orders -> income(线下店铺回款)
-- 3) Keep idempotent via source_order_id + category_id existence checks
-- 4) Bump schema_version to 6.4.0

-- ============================================================
-- 2. Retail paid orders: backfill online income records
-- ============================================================
WITH category_map AS (
  SELECT
    (ARRAY_REMOVE(ARRAY_AGG(CASE WHEN name = '线上渠道收入' AND type = 'income' THEN id END), NULL))[1]::uuid AS online_income_category_id,
    (ARRAY_REMOVE(ARRAY_AGG(CASE WHEN name = '线上佣金' AND type = 'expense' THEN id END), NULL))[1]::uuid AS online_fee_category_id,
    (ARRAY_REMOVE(ARRAY_AGG(CASE WHEN name = '线下店铺回款' AND type = 'income' THEN id END), NULL))[1]::uuid AS offline_settlement_income_category_id
  FROM public.finance_categories
), fallback_user AS (
  SELECT id AS fallback_user_id
  FROM public.profiles
  ORDER BY created_at ASC
  LIMIT 1
)
INSERT INTO public.financial_transactions (
  transaction_type,
  category_id,
  amount,
  transaction_date,
  store_id,
  source_order_id,
  channel_name,
  description,
  is_recurring,
  created_by
)
SELECT
  'income',
  c.online_income_category_id,
  ROUND(COALESCE(o.payment_amount, o.total_discount_amount, 0)::numeric, 2),
  o.created_at::date,
  o.store_id,
  o.id,
  COALESCE(o.payment_method, 'unknown'),
  '历史补录：零售收款收入',
  FALSE,
  COALESCE(o.distributor_id, f.fallback_user_id)
FROM public.orders o
CROSS JOIN category_map c
CROSS JOIN fallback_user f
WHERE o.order_kind = 'retail'
  AND LOWER(COALESCE(o.payment_status, '')) = 'paid'
  AND c.online_income_category_id IS NOT NULL
  AND COALESCE(o.distributor_id, f.fallback_user_id) IS NOT NULL
  AND COALESCE(o.payment_amount, o.total_discount_amount, 0) > 0
  AND NOT EXISTS (
    SELECT 1
    FROM public.financial_transactions ft
    WHERE ft.source_order_id = o.id
      AND ft.transaction_type = 'income'
      AND ft.category_id = c.online_income_category_id
  );

-- ============================================================
-- 3. Retail paid orders: backfill online fee expense records
-- ============================================================
WITH category_map AS (
  SELECT
    (ARRAY_REMOVE(ARRAY_AGG(CASE WHEN name = '线上渠道收入' AND type = 'income' THEN id END), NULL))[1]::uuid AS online_income_category_id,
    (ARRAY_REMOVE(ARRAY_AGG(CASE WHEN name = '线上佣金' AND type = 'expense' THEN id END), NULL))[1]::uuid AS online_fee_category_id,
    (ARRAY_REMOVE(ARRAY_AGG(CASE WHEN name = '线下店铺回款' AND type = 'income' THEN id END), NULL))[1]::uuid AS offline_settlement_income_category_id
  FROM public.finance_categories
), fallback_user AS (
  SELECT id AS fallback_user_id
  FROM public.profiles
  ORDER BY created_at ASC
  LIMIT 1
)
INSERT INTO public.financial_transactions (
  transaction_type,
  category_id,
  amount,
  transaction_date,
  store_id,
  source_order_id,
  channel_name,
  description,
  is_recurring,
  created_by
)
SELECT
  'expense',
  c.online_fee_category_id,
  ROUND(COALESCE(o.payment_amount, o.total_discount_amount, 0)::numeric * 0.006, 2),
  o.created_at::date,
  o.store_id,
  o.id,
  COALESCE(o.payment_method, 'unknown'),
  '历史补录：线上通道手续费',
  FALSE,
  COALESCE(o.distributor_id, f.fallback_user_id)
FROM public.orders o
CROSS JOIN category_map c
CROSS JOIN fallback_user f
WHERE o.order_kind = 'retail'
  AND LOWER(COALESCE(o.payment_status, '')) = 'paid'
  AND c.online_fee_category_id IS NOT NULL
  AND COALESCE(o.distributor_id, f.fallback_user_id) IS NOT NULL
  AND COALESCE(o.payment_amount, o.total_discount_amount, 0) > 0
  AND NOT EXISTS (
    SELECT 1
    FROM public.financial_transactions ft
    WHERE ft.source_order_id = o.id
      AND ft.transaction_type = 'expense'
      AND ft.category_id = c.online_fee_category_id
  );

-- ============================================================
-- 4. Settlement orders: backfill offline repayment income records
-- ============================================================
WITH category_map AS (
  SELECT
    (ARRAY_REMOVE(ARRAY_AGG(CASE WHEN name = '线上渠道收入' AND type = 'income' THEN id END), NULL))[1]::uuid AS online_income_category_id,
    (ARRAY_REMOVE(ARRAY_AGG(CASE WHEN name = '线上佣金' AND type = 'expense' THEN id END), NULL))[1]::uuid AS online_fee_category_id,
    (ARRAY_REMOVE(ARRAY_AGG(CASE WHEN name = '线下店铺回款' AND type = 'income' THEN id END), NULL))[1]::uuid AS offline_settlement_income_category_id
  FROM public.finance_categories
), fallback_user AS (
  SELECT id AS fallback_user_id
  FROM public.profiles
  ORDER BY created_at ASC
  LIMIT 1
)
INSERT INTO public.financial_transactions (
  transaction_type,
  category_id,
  amount,
  transaction_date,
  store_id,
  source_order_id,
  channel_name,
  description,
  is_recurring,
  created_by
)
SELECT
  'income',
  c.offline_settlement_income_category_id,
  ROUND(COALESCE(o.total_discount_amount, 0)::numeric, 2),
  o.created_at::date,
  o.store_id,
  o.id,
  'offline_settlement',
  '历史补录：线下店铺回款',
  FALSE,
  COALESCE(o.distributor_id, f.fallback_user_id)
FROM public.orders o
CROSS JOIN category_map c
CROSS JOIN fallback_user f
WHERE o.order_kind = 'settlement'
  AND c.offline_settlement_income_category_id IS NOT NULL
  AND COALESCE(o.distributor_id, f.fallback_user_id) IS NOT NULL
  AND COALESCE(o.total_discount_amount, 0) > 0
  AND NOT EXISTS (
    SELECT 1
    FROM public.financial_transactions ft
    WHERE ft.source_order_id = o.id
      AND ft.transaction_type = 'income'
      AND ft.category_id = c.offline_settlement_income_category_id
  );

-- ============================================================
-- 5. Bump schema_version to 6.4.0
-- ============================================================
INSERT INTO public.app_schema_meta (key, value)
VALUES ('schema_version', '6.4.0')
ON CONFLICT (key)
DO UPDATE SET
  value = EXCLUDED.value,
  updated_at = NOW();

COMMIT;
