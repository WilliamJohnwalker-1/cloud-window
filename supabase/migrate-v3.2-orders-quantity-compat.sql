-- Migration v3.2: orders.quantity compatibility + auto-sync from order_items
-- Execute in Supabase SQL Editor

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS quantity INTEGER;

UPDATE public.orders o
SET quantity = agg.total_qty
FROM (
  SELECT oi.order_id, COALESCE(SUM(oi.quantity), 0)::INTEGER AS total_qty
  FROM public.order_items oi
  GROUP BY oi.order_id
) agg
WHERE o.id = agg.order_id
  AND (o.quantity IS NULL OR o.quantity IS DISTINCT FROM agg.total_qty);

UPDATE public.orders
SET quantity = 0
WHERE quantity IS NULL;

ALTER TABLE public.orders
  ALTER COLUMN quantity SET DEFAULT 0;

ALTER TABLE public.orders
  ALTER COLUMN quantity SET NOT NULL;

CREATE OR REPLACE FUNCTION public.recalculate_order_quantity(p_order_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_order_id IS NULL THEN
    RETURN;
  END IF;

  UPDATE public.orders o
  SET quantity = COALESCE(sub.total_qty, 0)
  FROM (
    SELECT oi.order_id, COALESCE(SUM(oi.quantity), 0)::INTEGER AS total_qty
    FROM public.order_items oi
    WHERE oi.order_id = p_order_id
    GROUP BY oi.order_id
  ) sub
  WHERE o.id = p_order_id;

  IF NOT FOUND THEN
    UPDATE public.orders
    SET quantity = 0
    WHERE id = p_order_id;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.sync_order_quantity_from_items()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM public.recalculate_order_quantity(NEW.order_id);
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF NEW.order_id IS DISTINCT FROM OLD.order_id THEN
      PERFORM public.recalculate_order_quantity(OLD.order_id);
    END IF;
    PERFORM public.recalculate_order_quantity(NEW.order_id);
    RETURN NEW;
  END IF;

  IF TG_OP = 'DELETE' THEN
    PERFORM public.recalculate_order_quantity(OLD.order_id);
    RETURN OLD;
  END IF;

  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_order_quantity_from_items ON public.order_items;

CREATE TRIGGER trg_sync_order_quantity_from_items
AFTER INSERT OR UPDATE OR DELETE ON public.order_items
FOR EACH ROW
EXECUTE FUNCTION public.sync_order_quantity_from_items();

INSERT INTO public.app_schema_meta (key, value)
VALUES ('schema_version', '3.2.0')
ON CONFLICT (key)
DO UPDATE SET
  value = EXCLUDED.value,
  updated_at = NOW();
