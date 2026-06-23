-- Migration v5.7: inventory alert notifications (inventory + store_inventory)
-- Execute after migrate-v5.6-province-sort-order.sql

-- ============================================================
-- 1) Inventory alert trigger function (global inventory table)
--    Trigger only when quantity crosses from >= threshold to < threshold.
-- ============================================================
CREATE OR REPLACE FUNCTION public.notify_inventory_alert_on_inventory_crossing()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_threshold INTEGER := COALESCE(NEW.min_quantity, 0);
  v_product_name TEXT := '';
BEGIN
  IF TG_OP <> 'UPDATE' THEN
    RETURN NEW;
  END IF;

  IF OLD.quantity IS NULL OR NEW.quantity IS NULL THEN
    RETURN NEW;
  END IF;

  IF OLD.quantity < v_threshold OR NEW.quantity >= v_threshold THEN
    RETURN NEW;
  END IF;

  SELECT p.name
  INTO v_product_name
  FROM public.products p
  WHERE p.id = NEW.product_id;

  INSERT INTO public.notifications (user_id, type, message, is_read)
  SELECT
    prof.id,
    'inventory_alert',
    format('库存告警：商品「%s」当前库存 %s，低于阈值 %s', COALESCE(v_product_name, '未知商品'), NEW.quantity, v_threshold),
    FALSE
  FROM public.profiles prof
  WHERE prof.role IN ('admin', 'super_admin');

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notify_inventory_alert_on_inventory_crossing ON public.inventory;
CREATE TRIGGER trg_notify_inventory_alert_on_inventory_crossing
AFTER UPDATE ON public.inventory
FOR EACH ROW
EXECUTE FUNCTION public.notify_inventory_alert_on_inventory_crossing();

-- ============================================================
-- 2) Store inventory alert trigger function (store_inventory table)
--    Trigger only when quantity crosses from >= threshold to < threshold.
-- ============================================================
CREATE OR REPLACE FUNCTION public.notify_inventory_alert_on_store_inventory_crossing()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_threshold INTEGER := COALESCE(NEW.min_quantity, 30);
  v_product_name TEXT := '';
  v_store_name TEXT := '';
BEGIN
  IF TG_OP <> 'UPDATE' THEN
    RETURN NEW;
  END IF;

  IF OLD.quantity IS NULL OR NEW.quantity IS NULL THEN
    RETURN NEW;
  END IF;

  IF OLD.quantity < v_threshold OR NEW.quantity >= v_threshold THEN
    RETURN NEW;
  END IF;

  SELECT p.name
  INTO v_product_name
  FROM public.products p
  WHERE p.id = NEW.product_id;

  SELECT s.name
  INTO v_store_name
  FROM public.stores s
  WHERE s.id = NEW.store_id;

  INSERT INTO public.notifications (user_id, type, message, is_read)
  SELECT
    prof.id,
    'inventory_alert',
    format(
      '库存告警：店铺「%s」商品「%s」当前库存 %s，低于阈值 %s',
      COALESCE(v_store_name, '未知店铺'),
      COALESCE(v_product_name, '未知商品'),
      NEW.quantity,
      v_threshold
    ),
    FALSE
  FROM public.profiles prof
  WHERE prof.role IN ('admin', 'super_admin');

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notify_inventory_alert_on_store_inventory_crossing ON public.store_inventory;
CREATE TRIGGER trg_notify_inventory_alert_on_store_inventory_crossing
AFTER UPDATE ON public.store_inventory
FOR EACH ROW
EXECUTE FUNCTION public.notify_inventory_alert_on_store_inventory_crossing();

-- ============================================================
-- 3) Schema version gate
-- ============================================================

INSERT INTO public.app_schema_meta (key, value)
VALUES ('schema_version', '5.7.0')
ON CONFLICT (key)
DO UPDATE SET
  value = EXCLUDED.value,
  updated_at = NOW();
