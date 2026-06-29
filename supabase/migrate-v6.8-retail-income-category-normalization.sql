-- Migration v6.8: normalize retail income category for online vs offline retail orders
-- Execute after migrate-v6.7-refund-reversal-backfill.sql

-- Pre-check: Ensure schema version is at least 6.7.0
DO $$
BEGIN
  IF public.get_app_schema_version() < '6.7.0' THEN
    RAISE EXCEPTION 'Migration v6.7.0 must be applied before v6.8.0';
  END IF;
END $$;

BEGIN;

-- Purpose:
-- 1) Resolve retail finance scope from orders.payment_method plus matching payment_events;
--    do NOT use store_id alone because v4.4 defaulted many retail orders to 云窗.
-- 2) Reclassify auto-generated retail income rows in place between 线上渠道收入 and 线下店铺回款.
-- 3) Ensure retail fee rows are kept under 线上佣金 while income/refund stay 线下口径.
-- 4) Intentionally do NOT delete income rows or refund reversal rows here;
--    v6.7 refund backfill remains INSERT+UPDATE only.
-- 5) Bump schema_version to 6.8.0.

-- NOTE: avoid temporary tables here because some execution paths may split
-- statements/transactions, making ON COMMIT DROP temp relations unavailable
-- to subsequent statements.

-- Reclassify auto-generated retail income rows in place; keep the row itself,
-- change only the category/channel classification.
WITH category_map AS (
  SELECT
    (ARRAY_REMOVE(ARRAY_AGG(CASE WHEN name = '线上渠道收入' AND type = 'income' THEN id END), NULL))[1]::uuid AS online_income_category_id,
    (ARRAY_REMOVE(ARRAY_AGG(CASE WHEN name = '线下店铺回款' AND type = 'income' THEN id END), NULL))[1]::uuid AS offline_store_income_category_id
  FROM public.finance_categories
), retail_candidates AS (
  SELECT
    o.id AS order_id,
    LOWER(NULLIF(BTRIM(o.payment_method), '')) AS normalized_payment_method,
    (POSITION('云窗' IN COALESCE(s.name, '')) > 0) AS is_yunchuang_store,
    online_event.online_channel
  FROM public.orders o
  LEFT JOIN public.stores s
    ON s.id = o.store_id
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
  WHERE o.order_kind = 'retail'
), resolved_scope AS (
  SELECT
    rc.order_id,
    c.offline_store_income_category_id AS income_category_id,
    TRUE AS is_online_payment,
    'offline_store_retail' AS channel_name
  FROM retail_candidates rc
  CROSS JOIN category_map c
  WHERE c.offline_store_income_category_id IS NOT NULL
)
UPDATE public.financial_transactions ft
SET category_id = scope.income_category_id,
    channel_name = scope.channel_name,
    updated_at = NOW()
FROM resolved_scope scope
CROSS JOIN category_map c
WHERE ft.source_order_id = scope.order_id
  AND ft.transaction_type = 'income'
  AND (
    ft.description = '历史补录：零售收款收入'
    OR ft.description LIKE '零售支付自动记账-收入-%'
    OR ft.description LIKE '零售退款自动冲减-收入-%'
  )
  AND (
    ft.category_id = c.online_income_category_id
    OR ft.category_id = c.offline_store_income_category_id
  )
  AND (
    ft.category_id IS DISTINCT FROM scope.income_category_id
    OR COALESCE(ft.channel_name, '') IS DISTINCT FROM COALESCE(scope.channel_name, '')
  );

-- Ensure retail fee rows exist under 线上佣金 for all retail payment流水.
WITH category_map AS (
  SELECT
    (ARRAY_REMOVE(ARRAY_AGG(CASE WHEN name = '线上佣金' AND type = 'expense' THEN id END), NULL))[1]::uuid AS online_fee_category_id
  FROM public.finance_categories
), fallback_user AS (
  SELECT id AS fallback_user_id
  FROM public.profiles
  ORDER BY created_at ASC
  LIMIT 1
), fee_candidates AS (
  SELECT
    o.id AS order_id,
    ROUND(COALESCE(o.payment_amount, o.total_discount_amount, 0)::numeric, 2) AS amount,
    o.created_at::date AS transaction_date,
    o.store_id,
    COALESCE(NULLIF(LOWER(BTRIM(o.payment_method)), ''), 'offline_store_retail') AS channel_name,
    COALESCE(o.distributor_id, s.distributor_id, f.fallback_user_id) AS created_by
  FROM public.orders o
  LEFT JOIN public.stores s
    ON s.id = o.store_id
  CROSS JOIN fallback_user f
  WHERE o.order_kind = 'retail'
    AND COALESCE(o.payment_amount, o.total_discount_amount, 0) > 0
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
  ROUND(fc.amount * 0.006, 2),
  fc.transaction_date,
  fc.store_id,
  fc.order_id,
  fc.channel_name,
  '历史补录：线上通道手续费',
  FALSE,
  fc.created_by
FROM fee_candidates fc
CROSS JOIN category_map c
WHERE c.online_fee_category_id IS NOT NULL
  AND fc.created_by IS NOT NULL
  AND ROUND(fc.amount * 0.006, 2) > 0
  AND NOT EXISTS (
    SELECT 1
    FROM public.financial_transactions ft
    WHERE ft.source_order_id = fc.order_id
      AND ft.transaction_type = 'expense'
      AND ft.category_id = c.online_fee_category_id
      AND (
        ft.description = '历史补录：线上通道手续费'
        OR ft.description LIKE '零售支付自动记账-佣金-%'
      )
  );

INSERT INTO public.app_schema_meta (key, value)
VALUES ('schema_version', '6.8.0')
ON CONFLICT (key)
DO UPDATE SET
  value = EXCLUDED.value,
  updated_at = NOW();

COMMIT;
