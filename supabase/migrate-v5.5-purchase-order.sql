-- Migration v5.5: Purchase order workflow
-- Execute after migrate-v5.4-quantity-rules.sql
-- Purpose:
-- 1) Add 'purchase' to orders.order_kind CHECK while preserving existing values
-- 2) Create create_purchase_order_atomic RPC (pending purchase, cost pricing, no inventory mutation)
-- 3) Create confirm_purchase_delivery_atomic RPC (idempotent pending -> accepted inventory receipt)
-- 4) Extend delete_order_with_inventory_restore_atomic for purchase rollback
-- 5) Bump schema_version to 5.5.0

-- ============================================================
-- 1. Extend order_kind CHECK to include 'purchase'
-- ============================================================
ALTER TABLE public.orders
  DROP CONSTRAINT IF EXISTS orders_order_kind_check;

ALTER TABLE public.orders
  ADD CONSTRAINT orders_order_kind_check
  CHECK (order_kind IN ('distribution', 'retail', 'settlement', 'purchase'));

-- ============================================================
-- 2. Create purchase order (pending only; no inventory mutation)
--    Pricing path uses products.cost as retail/discount/unit_cost.
-- ============================================================
CREATE OR REPLACE FUNCTION public.create_purchase_order_atomic(
  p_user_id UUID,
  p_store_id UUID,
  p_city_id UUID,
  p_items JSONB
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor_id UUID := auth.uid();
  v_actor_role TEXT;
  v_target_role TEXT;
  v_store_city UUID;
  v_store_status TEXT;
  v_order_id UUID;
  v_total_cost NUMERIC(10, 2) := 0;
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
    RAISE EXCEPTION '当前角色无进货建单权限';
  END IF;

  IF p_user_id IS NULL THEN
    RAISE EXCEPTION '建单用户不能为空';
  END IF;

  SELECT role INTO v_target_role
  FROM public.profiles
  WHERE id = p_user_id;

  IF v_target_role IS NULL THEN
    RAISE EXCEPTION '建单用户不存在';
  END IF;

  IF p_store_id IS NULL THEN
    RAISE EXCEPTION '店铺ID不能为空';
  END IF;

  IF p_city_id IS NULL THEN
    RAISE EXCEPTION '城市ID不能为空';
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

  IF v_store_city IS DISTINCT FROM p_city_id THEN
    RAISE EXCEPTION '店铺不属于所选城市';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.cities c WHERE c.id = p_city_id) THEN
    RAISE EXCEPTION '城市不存在';
  END IF;

  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION '进货项不能为空';
  END IF;

  CREATE TEMP TABLE IF NOT EXISTS _purchase_order_items_tmp (
    product_id UUID NOT NULL,
    quantity INTEGER NOT NULL
  ) ON COMMIT DROP;

  TRUNCATE TABLE _purchase_order_items_tmp;

  INSERT INTO _purchase_order_items_tmp (product_id, quantity)
  SELECT x.product_id, x.quantity
  FROM jsonb_to_recordset(p_items) AS x(
    product_id UUID,
    quantity INTEGER
  );

  IF NOT EXISTS (SELECT 1 FROM _purchase_order_items_tmp) THEN
    RAISE EXCEPTION '进货项不能为空';
  END IF;

  IF EXISTS (SELECT 1 FROM _purchase_order_items_tmp WHERE quantity <= 0) THEN
    RAISE EXCEPTION '进货数量必须大于0';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM _purchase_order_items_tmp pi
    LEFT JOIN public.products p ON p.id = pi.product_id
    WHERE p.id IS NULL
  ) THEN
    RAISE EXCEPTION '商品不存在';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM _purchase_order_items_tmp pi
    JOIN public.products p ON p.id = pi.product_id
    WHERE p.city_id IS DISTINCT FROM p_city_id
  ) THEN
    RAISE EXCEPTION '只能进货所选城市商品';
  END IF;

  SELECT COALESCE(SUM(COALESCE(p.cost, 0) * pi.quantity), 0)
  INTO v_total_cost
  FROM _purchase_order_items_tmp pi
  JOIN public.products p ON p.id = pi.product_id;

  INSERT INTO public.orders (
    distributor_id,
    city_id,
    store_id,
    order_kind,
    status,
    total_retail_amount,
    total_discount_amount
  ) VALUES (
    p_user_id,
    p_city_id,
    p_store_id,
    'purchase',
    'pending',
    v_total_cost,
    v_total_cost
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
    pi.product_id,
    pi.quantity,
    COALESCE(p.cost, 0),
    COALESCE(p.cost, 0),
    COALESCE(p.cost, 0),
    COALESCE(p.one_time_cost, 0)
  FROM _purchase_order_items_tmp pi
  JOIN public.products p ON p.id = pi.product_id;

  RETURN v_order_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_purchase_order_atomic(UUID, UUID, UUID, JSONB) TO authenticated;

-- ============================================================
-- 3. Confirm purchase delivery (idempotent inventory receipt)
--    云窗 receives into public.inventory only; other stores receive
--    into store_inventory only.
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

  UPDATE public.orders
  SET status = 'accepted'
  WHERE id = p_order_id;

  IF v_store_name = '云窗' THEN
    INSERT INTO public.inventory (product_id, quantity, updated_at)
    SELECT
      agg.product_id,
      agg.total_qty,
      NOW()
    FROM (
      SELECT oi.product_id, COALESCE(SUM(oi.quantity), 0)::INTEGER AS total_qty
      FROM public.order_items oi
      WHERE oi.order_id = p_order_id
      GROUP BY oi.product_id
    ) agg
    ON CONFLICT (product_id)
    DO UPDATE SET
      quantity = public.inventory.quantity + EXCLUDED.quantity,
      updated_at = NOW();
  ELSE
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
END;
$$;

GRANT EXECUTE ON FUNCTION public.confirm_purchase_delivery_atomic(UUID, UUID) TO authenticated;

-- ============================================================
-- 4. Extend delete_order_with_inventory_restore_atomic for purchase
--    Accepted purchase deletion rolls inventory back in the opposite
--    direction; pending purchase deletion only removes records.
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
-- 5. Schema version gate
-- ============================================================
INSERT INTO public.app_schema_meta (key, value)
VALUES ('schema_version', '5.5.0')
ON CONFLICT (key)
DO UPDATE SET
  value = EXCLUDED.value,
  updated_at = NOW();
