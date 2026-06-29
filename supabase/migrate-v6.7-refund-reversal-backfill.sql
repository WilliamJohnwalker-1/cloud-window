-- Migration v6.7: refund reversal net-only correction backfill
-- Execute after migrate-v6.6-inventory-log-completion.sql

-- Pre-check: Ensure schema version is at least 6.6.0
DO $$
BEGIN
  IF public.get_app_schema_version() < '6.6.0' THEN
    RAISE EXCEPTION 'Migration v6.6.0 must be applied before v6.7.0';
  END IF;
END $$;

BEGIN;

-- Purpose:
-- 1) For historical retail refund events from online providers (wechat/alipay),
--    derive each refund reversal from payment_events.
-- 2) Reversal amount must be net-only: -(refund_amount - ROUND(refund_amount * 0.006, 2)).
-- 3) Insert missing reversal rows idempotently via exact source_order_id + description match.
-- 4) Correct only legacy buggy rows whose amount still equals the old full negative refund amount.
-- 5) Intentionally do NOT delete original retail income rows or fee rows here;
--    this migration is INSERT+UPDATE only on the reversal income row itself.
-- 6) Bump schema_version to 6.7.0.

-- ============================================================
-- 1. Insert missing retail refund reversal rows
--    Scope is online-provider refund events only.
-- ============================================================
WITH category_map AS (
  SELECT
    (ARRAY_REMOVE(ARRAY_AGG(CASE WHEN name = '线上渠道收入' AND type = 'income' THEN id END), NULL))[1]::uuid AS online_income_category_id
  FROM public.finance_categories
), fallback_user AS (
  SELECT id AS fallback_user_id
  FROM public.profiles
  ORDER BY created_at ASC
  LIMIT 1
), refund_candidates AS (
  SELECT
    o.id AS order_id,
    c.online_income_category_id AS income_category_id,
    o.store_id,
    COALESCE(NULLIF(BTRIM(pe.channel), ''), NULLIF(BTRIM(o.payment_method), ''), 'unknown') AS channel_name,
    COALESCE(o.distributor_id, store_owner.distributor_id, f.fallback_user_id) AS created_by,
    COALESCE(pe.created_at::date, CURRENT_DATE) AS transaction_date,
    ROUND(COALESCE(pe.amount, 0)::numeric, 2) AS refund_amount,
    ROUND(ROUND(COALESCE(pe.amount, 0)::numeric, 2) * 0.006, 2) AS fee_amount,
    ROUND((ROUND(COALESCE(pe.amount, 0)::numeric, 2) - ROUND(ROUND(COALESCE(pe.amount, 0)::numeric, 2) * 0.006, 2)) * -1, 2) AS expected_amount,
    ROUND(ROUND(COALESCE(pe.amount, 0)::numeric, 2) * -1, 2) AS legacy_full_amount,
    COALESCE(NULLIF(split_part(COALESCE(pe.idempotency_key, ''), ':', 4), '-'), '') AS refund_no,
    CASE
      WHEN COALESCE(NULLIF(split_part(COALESCE(pe.idempotency_key, ''), ':', 4), '-'), '') <> ''
        THEN FORMAT('零售退款自动冲减-收入-%s-%s', o.id, split_part(pe.idempotency_key, ':', 4))
      ELSE FORMAT('零售退款自动冲减-收入-%s', o.id)
    END AS description
  FROM public.orders o
  JOIN public.payment_events pe
    ON pe.event_type = 'refund'
   AND pe.processed = TRUE
   AND COALESCE(pe.amount, 0) > 0
   AND pe.out_trade_no IN (o.id::text, REPLACE(o.id::text, '-', ''))
   AND LOWER(COALESCE(pe.channel, '')) IN ('wechat', 'alipay')
  LEFT JOIN public.stores store_owner
    ON store_owner.id = o.store_id
  CROSS JOIN category_map c
  CROSS JOIN fallback_user f
  WHERE o.order_kind = 'retail'
    AND LOWER(COALESCE(pe.status, '')) NOT IN ('failed', 'timeout')
    AND c.online_income_category_id IS NOT NULL
    AND COALESCE(o.distributor_id, store_owner.distributor_id, f.fallback_user_id) IS NOT NULL
), dedup_refund_candidates AS (
  SELECT DISTINCT ON (order_id, description)
    order_id,
    income_category_id,
    store_id,
    channel_name,
    created_by,
    transaction_date,
    refund_amount,
    fee_amount,
    expected_amount,
    legacy_full_amount,
    refund_no,
    description
  FROM refund_candidates
  ORDER BY order_id, description, transaction_date DESC
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
  rc.income_category_id,
  rc.expected_amount,
  rc.transaction_date,
  rc.store_id,
  rc.order_id,
  rc.channel_name,
  rc.description,
  FALSE,
  rc.created_by
FROM dedup_refund_candidates rc
WHERE NOT EXISTS (
  SELECT 1
  FROM public.financial_transactions ft
  WHERE ft.source_order_id = rc.order_id
    AND ft.transaction_type = 'income'
    AND COALESCE(ft.description, '') = rc.description
);

-- ============================================================
-- 2. Correct legacy full-amount reversal rows to net-only
--    Scope is online-provider refund events only.
-- ============================================================
WITH category_map AS (
  SELECT
    (ARRAY_REMOVE(ARRAY_AGG(CASE WHEN name = '线上渠道收入' AND type = 'income' THEN id END), NULL))[1]::uuid AS online_income_category_id
  FROM public.finance_categories
), fallback_user AS (
  SELECT id AS fallback_user_id
  FROM public.profiles
  ORDER BY created_at ASC
  LIMIT 1
), refund_candidates AS (
  SELECT
    o.id AS order_id,
    ROUND(COALESCE(pe.amount, 0)::numeric, 2) AS refund_amount,
    ROUND(ROUND(COALESCE(pe.amount, 0)::numeric, 2) * 0.006, 2) AS fee_amount,
    ROUND((ROUND(COALESCE(pe.amount, 0)::numeric, 2) - ROUND(ROUND(COALESCE(pe.amount, 0)::numeric, 2) * 0.006, 2)) * -1, 2) AS expected_amount,
    ROUND(ROUND(COALESCE(pe.amount, 0)::numeric, 2) * -1, 2) AS legacy_full_amount,
    CASE
      WHEN COALESCE(NULLIF(split_part(COALESCE(pe.idempotency_key, ''), ':', 4), '-'), '') <> ''
        THEN FORMAT('零售退款自动冲减-收入-%s-%s', o.id, split_part(pe.idempotency_key, ':', 4))
      ELSE FORMAT('零售退款自动冲减-收入-%s', o.id)
    END AS description
  FROM public.orders o
  JOIN public.payment_events pe
    ON pe.event_type = 'refund'
   AND pe.processed = TRUE
   AND COALESCE(pe.amount, 0) > 0
   AND pe.out_trade_no IN (o.id::text, REPLACE(o.id::text, '-', ''))
   AND LOWER(COALESCE(pe.channel, '')) IN ('wechat', 'alipay')
  CROSS JOIN category_map c
  CROSS JOIN fallback_user f
  LEFT JOIN public.stores store_owner
    ON store_owner.id = o.store_id
  WHERE o.order_kind = 'retail'
    AND LOWER(COALESCE(pe.status, '')) NOT IN ('failed', 'timeout')
    AND c.online_income_category_id IS NOT NULL
    AND COALESCE(o.distributor_id, store_owner.distributor_id, f.fallback_user_id) IS NOT NULL
), dedup_refund_candidates AS (
  SELECT DISTINCT ON (order_id, description)
    order_id,
    refund_amount,
    fee_amount,
    expected_amount,
    legacy_full_amount,
    description
  FROM refund_candidates
  ORDER BY order_id, description, refund_amount DESC
)
UPDATE public.financial_transactions ft
SET amount = rc.expected_amount,
    updated_at = NOW()
FROM dedup_refund_candidates rc
WHERE ft.source_order_id = rc.order_id
  AND ft.transaction_type = 'income'
  AND COALESCE(ft.description, '') = rc.description
  AND ABS(COALESCE(ft.amount, 0)::numeric - rc.legacy_full_amount) < 0.01
  AND ABS(COALESCE(ft.amount, 0)::numeric - rc.expected_amount) >= 0.01;

-- ============================================================
-- 3. Bump schema_version to 6.7.0
-- ============================================================
INSERT INTO public.app_schema_meta (key, value)
VALUES ('schema_version', '6.7.0')
ON CONFLICT (key)
DO UPDATE SET
  value = EXCLUDED.value,
  updated_at = NOW();

COMMIT;
