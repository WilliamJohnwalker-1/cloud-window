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
-- 1) Resolve paid retail orders into online-channel income vs offline-store income
--    using orders.payment_method and matching payment_events evidence.
-- 2) Do NOT use store_id alone for retail classification because v4.4 defaults
--    many retail orders to the 云窗 store.
-- 3) Backfill retail income into 线上渠道收入 (online) or 线下店铺回款 (offline).
-- 4) Backfill 线上佣金 only for retail orders with online payment evidence.
-- 5) If this migration is re-run, correct legacy v6.4 retail income category in place
--    and delete only the legacy fee rows that should not exist for offline retail orders.
-- 6) Backfill settlement orders -> income(线下店铺回款).
-- 7) Bump schema_version to 6.4.0.

CREATE TEMP TABLE IF NOT EXISTS _retail_finance_scope_v64 (
  order_id UUID PRIMARY KEY,
  income_category_id UUID NOT NULL,
  is_online_payment BOOLEAN NOT NULL,
  amount NUMERIC(10, 2) NOT NULL,
  transaction_date DATE NOT NULL,
  store_id UUID,
  source_order_id UUID NOT NULL,
  channel_name TEXT,
  created_by UUID NOT NULL
) ON COMMIT DROP;

TRUNCATE TABLE _retail_finance_scope_v64;

WITH category_map AS (
  SELECT
    (ARRAY_REMOVE(ARRAY_AGG(CASE WHEN name = '线上渠道收入' AND type = 'income' THEN id END), NULL))[1]::uuid AS online_income_category_id,
    (ARRAY_REMOVE(ARRAY_AGG(CASE WHEN name = '线上佣金' AND type = 'expense' THEN id END), NULL))[1]::uuid AS online_fee_category_id,
    (ARRAY_REMOVE(ARRAY_AGG(CASE WHEN name = '线下店铺回款' AND type = 'income' THEN id END), NULL))[1]::uuid AS offline_store_income_category_id
  FROM public.finance_categories
), fallback_user AS (
  SELECT id AS fallback_user_id
  FROM public.profiles
  ORDER BY created_at ASC
  LIMIT 1
), retail_candidates AS (
  SELECT
    o.id AS order_id,
    LOWER(NULLIF(BTRIM(o.payment_method), '')) AS normalized_payment_method,
    online_event.online_channel,
    ROUND(COALESCE(o.payment_amount, o.total_discount_amount, 0)::numeric, 2) AS amount,
    o.created_at::date AS transaction_date,
    o.store_id,
    o.id AS source_order_id,
    COALESCE(o.distributor_id, store_owner.distributor_id, f.fallback_user_id) AS created_by
  FROM public.orders o
  LEFT JOIN public.stores store_owner
    ON store_owner.id = o.store_id
  LEFT JOIN LATERAL (
    SELECT LOWER(NULLIF(BTRIM(pe.channel), '')) AS online_channel
    FROM public.payment_events pe
    WHERE pe.out_trade_no IN (o.id::text, REPLACE(o.id::text, '-', ''))
      AND LOWER(COALESCE(pe.channel, '')) IN ('wechat', 'alipay')
      AND LOWER(COALESCE(pe.event_type, '')) IN ('collect', 'notify', 'refund', 'finance', 'finance_refund')
      AND LOWER(COALESCE(pe.status, '')) NOT IN ('failed', 'timeout')
    ORDER BY COALESCE(pe.processed, FALSE) DESC, pe.created_at DESC
    LIMIT 1
  ) online_event ON TRUE
  CROSS JOIN fallback_user f
  WHERE o.order_kind = 'retail'
    AND LOWER(COALESCE(o.payment_status, '')) = 'paid'
    AND COALESCE(o.distributor_id, store_owner.distributor_id, f.fallback_user_id) IS NOT NULL
    AND COALESCE(o.payment_amount, o.total_discount_amount, 0) > 0
), resolved_scope AS (
  SELECT
    rc.order_id,
    CASE
      WHEN rc.normalized_payment_method IN ('wechat', 'alipay') OR rc.online_channel IS NOT NULL
        THEN c.online_income_category_id
      ELSE c.offline_store_income_category_id
    END AS income_category_id,
    CASE
      WHEN rc.normalized_payment_method IN ('wechat', 'alipay') OR rc.online_channel IS NOT NULL
        THEN TRUE
      ELSE FALSE
    END AS is_online_payment,
    rc.amount,
    rc.transaction_date,
    rc.store_id,
    rc.source_order_id,
    CASE
      WHEN rc.normalized_payment_method IN ('wechat', 'alipay')
        THEN rc.normalized_payment_method
      WHEN rc.online_channel IS NOT NULL
        THEN rc.online_channel
      ELSE COALESCE(rc.normalized_payment_method, 'offline_store_retail')
    END AS channel_name,
    rc.created_by
  FROM retail_candidates rc
  CROSS JOIN category_map c
  WHERE CASE
    WHEN rc.normalized_payment_method IN ('wechat', 'alipay') OR rc.online_channel IS NOT NULL
      THEN c.online_income_category_id IS NOT NULL
    ELSE c.offline_store_income_category_id IS NOT NULL
  END
)
INSERT INTO _retail_finance_scope_v64 (
  order_id,
  income_category_id,
  is_online_payment,
  amount,
  transaction_date,
  store_id,
  source_order_id,
  channel_name,
  created_by
)
SELECT
  order_id,
  income_category_id,
  is_online_payment,
  amount,
  transaction_date,
  store_id,
  source_order_id,
  channel_name,
  created_by
FROM resolved_scope;

-- Normalize legacy v6.4 retail income rows before inserting anything missing.
WITH category_map AS (
  SELECT
    (ARRAY_REMOVE(ARRAY_AGG(CASE WHEN name = '线上渠道收入' AND type = 'income' THEN id END), NULL))[1]::uuid AS online_income_category_id,
    (ARRAY_REMOVE(ARRAY_AGG(CASE WHEN name = '线下店铺回款' AND type = 'income' THEN id END), NULL))[1]::uuid AS offline_store_income_category_id
  FROM public.finance_categories
)
UPDATE public.financial_transactions ft
SET category_id = scope.income_category_id,
    channel_name = scope.channel_name,
    updated_at = NOW()
FROM _retail_finance_scope_v64 scope
CROSS JOIN category_map c
WHERE ft.source_order_id = scope.order_id
  AND ft.transaction_type = 'income'
  AND ft.description = '历史补录：零售收款收入'
  AND (
    ft.category_id = c.online_income_category_id
    OR ft.category_id = c.offline_store_income_category_id
  )
  AND (
    ft.category_id IS DISTINCT FROM scope.income_category_id
    OR COALESCE(ft.channel_name, '') IS DISTINCT FROM COALESCE(scope.channel_name, '')
  );

-- Offline retail orders should not carry the legacy online fee backfill row.
WITH category_map AS (
  SELECT
    (ARRAY_REMOVE(ARRAY_AGG(CASE WHEN name = '线上佣金' AND type = 'expense' THEN id END), NULL))[1]::uuid AS online_fee_category_id
  FROM public.finance_categories
)
DELETE FROM public.financial_transactions ft
USING _retail_finance_scope_v64 scope, category_map c
WHERE scope.is_online_payment = FALSE
  AND ft.source_order_id = scope.order_id
  AND ft.transaction_type = 'expense'
  AND ft.category_id = c.online_fee_category_id
  AND ft.description = '历史补录：线上通道手续费';

-- ============================================================
-- 2. Retail paid orders: backfill resolved income records
-- ============================================================
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
  scope.income_category_id,
  scope.amount,
  scope.transaction_date,
  scope.store_id,
  scope.source_order_id,
  scope.channel_name,
  '历史补录：零售收款收入',
  FALSE,
  scope.created_by
FROM _retail_finance_scope_v64 scope
WHERE NOT EXISTS (
  SELECT 1
  FROM public.financial_transactions ft
  WHERE ft.source_order_id = scope.order_id
    AND ft.transaction_type = 'income'
    AND ft.category_id = scope.income_category_id
);

-- ============================================================
-- 3. Retail paid orders: backfill online fee expense records only
--    for orders with online payment evidence
-- ============================================================
WITH category_map AS (
  SELECT
    (ARRAY_REMOVE(ARRAY_AGG(CASE WHEN name = '线上佣金' AND type = 'expense' THEN id END), NULL))[1]::uuid AS online_fee_category_id
  FROM public.finance_categories
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
  ROUND(scope.amount * 0.006, 2),
  scope.transaction_date,
  scope.store_id,
  scope.source_order_id,
  scope.channel_name,
  '历史补录：线上通道手续费',
  FALSE,
  scope.created_by
FROM _retail_finance_scope_v64 scope
CROSS JOIN category_map c
WHERE scope.is_online_payment = TRUE
  AND c.online_fee_category_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM public.financial_transactions ft
    WHERE ft.source_order_id = scope.order_id
      AND ft.transaction_type = 'expense'
      AND ft.category_id = c.online_fee_category_id
  );

-- ============================================================
-- 4. Settlement orders: backfill offline repayment income records
-- ============================================================
WITH category_map AS (
  SELECT
    (ARRAY_REMOVE(ARRAY_AGG(CASE WHEN name = '线下店铺回款' AND type = 'income' THEN id END), NULL))[1]::uuid AS offline_store_income_category_id
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
  c.offline_store_income_category_id,
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
  AND c.offline_store_income_category_id IS NOT NULL
  AND COALESCE(o.distributor_id, f.fallback_user_id) IS NOT NULL
  AND COALESCE(o.total_discount_amount, 0) > 0
  AND NOT EXISTS (
    SELECT 1
    FROM public.financial_transactions ft
    WHERE ft.source_order_id = o.id
      AND ft.transaction_type = 'income'
      AND ft.category_id = c.offline_store_income_category_id
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
