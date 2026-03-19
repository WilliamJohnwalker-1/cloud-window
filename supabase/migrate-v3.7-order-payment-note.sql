-- Migration v3.7: add order payment note for cashier manual rounding
-- Execute in Supabase SQL Editor

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS payment_note TEXT;

CREATE OR REPLACE FUNCTION public.set_order_payment_note_atomic(
  p_order_id UUID,
  p_payment_note TEXT DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_role TEXT;
  v_trimmed_note TEXT;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION '未登录';
  END IF;

  SELECT role INTO v_role
  FROM public.profiles
  WHERE id = v_uid;

  IF v_role IS DISTINCT FROM 'admin' THEN
    RAISE EXCEPTION '仅管理员可更新收款备注';
  END IF;

  v_trimmed_note := NULLIF(BTRIM(COALESCE(p_payment_note, '')), '');

  UPDATE public.orders
  SET payment_note = v_trimmed_note
  WHERE id = p_order_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION '订单不存在';
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.set_order_payment_note_atomic(UUID, TEXT) TO authenticated;

INSERT INTO public.app_schema_meta (key, value)
VALUES ('schema_version', '3.7.0')
ON CONFLICT (key)
DO UPDATE SET
  value = EXCLUDED.value,
  updated_at = NOW();
