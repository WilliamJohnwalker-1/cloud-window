-- Migration v7.3: Retail single-pool correction + inventory log completion
-- Execute in Supabase SQL Editor
-- Purpose:
-- 1) Align Web retail create/delete with single-pool global-inventory semantics
--    (non-msr retail mutates public.inventory only).
-- 2) Keep mobile store retail (msr) on store_inventory-only semantics.
-- 3) Add missing inventory_logs records for:
--    - mobile store retail sell (store pool)
--    - order delete rollback that restores public.inventory (incl. stale retail cleanup)
-- 4) Bump schema_version to 7.3.0

-- ============================================================
-- 0. Pre-check
-- ============================================================
DO $$
BEGIN
  IF public.get_app_schema_version() < '7.2.0' THEN
    RAISE EXCEPTION 'Migration v7.2.0 must be applied before v7.3.0';
  END IF;
END $$;

-- ============================================================
-- 1. Web cashier create_retail_order_atomic override
--    Single-pool semantics: mutate public.inventory only.
-- ============================================================
CREATE OR REPLACE FUNCTION public.create_retail_order_atomic(
  p_items JSONB,
  p_request_id TEXT DEFAULT NULL,
  p_store_id UUID DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_role TEXT;
  v_user_city UUID;
  v_order_id UUID;
  v_total_retail NUMERIC(10, 2) := 0;
  v_order_city UUID;
  v_agg RECORD;
  v_stock INTEGER;
  v_existing_order_id UUID;
  v_store_status TEXT;
  v_effective_store_id UUID;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION '未登录';
  END IF;

  SELECT role, city_id
  INTO v_role, v_user_city
  FROM public.profiles
  WHERE id = v_user_id;

  IF v_role IS NULL THEN
    RAISE EXCEPTION '用户资料不存在';
  END IF;

  IF v_role NOT IN ('admin', 'super_admin', 'inventory_manager') THEN
    RAISE EXCEPTION '当前角色无收款建单权限';
  END IF;

  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION '购物车为空';
  END IF;

  IF p_request_id IS NOT NULL THEN
    SELECT o.id
    INTO v_existing_order_id
    FROM public.orders o
    WHERE o.request_id = p_request_id
    LIMIT 1;

    IF v_existing_order_id IS NOT NULL THEN
      RETURN v_existing_order_id;
    END IF;
  END IF;

  IF p_store_id IS NULL THEN
    SELECT (
      ARRAY_AGG(
        s.id
        ORDER BY CASE WHEN s.status = 'active' THEN 0 ELSE 1 END, s.created_at, s.id::text
      )
    )[1]::uuid
    INTO v_effective_store_id
    FROM public.stores s
    WHERE s.name = '云窗';

    IF v_effective_store_id IS NULL THEN
      RAISE EXCEPTION '默认零售店铺不存在';
    END IF;
  ELSE
    v_effective_store_id := p_store_id;
  END IF;

  SELECT s.status
  INTO v_store_status
  FROM public.stores s
  WHERE s.id = v_effective_store_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION '店铺不存在';
  END IF;

  IF v_store_status <> 'active' THEN
    RAISE EXCEPTION '店铺已停用';
  END IF;

  CREATE TEMP TABLE IF NOT EXISTS _retail_order_items_tmp (
    product_id UUID NOT NULL,
    quantity INTEGER NOT NULL,
    retail_price NUMERIC(10, 2) NOT NULL,
    unit_cost NUMERIC(10, 2) NOT NULL,
    one_time_cost NUMERIC(10, 2) NOT NULL
  ) ON COMMIT DROP;

  CREATE TEMP TABLE IF NOT EXISTS _inventory_log_movements_tmp (
    product_id UUID PRIMARY KEY,
    total_qty INTEGER NOT NULL,
    before_quantity INTEGER NOT NULL,
    after_quantity INTEGER NOT NULL
  ) ON COMMIT DROP;

  TRUNCATE TABLE _retail_order_items_tmp;
  TRUNCATE TABLE _inventory_log_movements_tmp;

  INSERT INTO _retail_order_items_tmp (
    product_id,
    quantity,
    retail_price,
    unit_cost,
    one_time_cost
  )
  SELECT
    x.product_id,
    x.quantity,
    x.retail_price,
    x.unit_cost,
    x.one_time_cost
  FROM jsonb_to_recordset(p_items) AS x(
    product_id UUID,
    quantity INTEGER,
    retail_price NUMERIC(10, 2),
    unit_cost NUMERIC(10, 2),
    one_time_cost NUMERIC(10, 2)
  );

  IF NOT EXISTS (SELECT 1 FROM _retail_order_items_tmp) THEN
    RAISE EXCEPTION '购物车为空';
  END IF;

  IF EXISTS (SELECT 1 FROM _retail_order_items_tmp WHERE quantity <= 0) THEN
    RAISE EXCEPTION '订单数量必须大于0';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM _retail_order_items_tmp bi
    LEFT JOIN public.products p ON p.id = bi.product_id
    WHERE p.id IS NULL
  ) THEN
    RAISE EXCEPTION '商品不存在';
  END IF;

  FOR v_agg IN
    SELECT bi.product_id, SUM(bi.quantity)::INTEGER AS total_qty
    FROM _retail_order_items_tmp bi
    GROUP BY bi.product_id
    ORDER BY bi.product_id
  LOOP
    SELECT i.quantity
    INTO v_stock
    FROM public.inventory i
    WHERE i.product_id = v_agg.product_id
    FOR UPDATE;

    IF v_stock IS NULL THEN
      RAISE EXCEPTION '库存记录不存在';
    END IF;

    IF v_stock < v_agg.total_qty THEN
      RAISE EXCEPTION '库存不足';
    END IF;
  END LOOP;

  INSERT INTO _inventory_log_movements_tmp (product_id, total_qty, before_quantity, after_quantity)
  SELECT
    bi.product_id,
    SUM(bi.quantity)::INTEGER AS total_qty,
    i.quantity AS before_quantity,
    i.quantity - SUM(bi.quantity)::INTEGER AS after_quantity
  FROM _retail_order_items_tmp bi
  JOIN public.inventory i ON i.product_id = bi.product_id
  GROUP BY bi.product_id, i.quantity;

  SELECT COALESCE(SUM(bi.retail_price * bi.quantity), 0)
  INTO v_total_retail
  FROM _retail_order_items_tmp bi;

  SELECT COALESCE(
    v_user_city,
    (SELECT p.city_id
     FROM _retail_order_items_tmp bi
     JOIN public.products p ON p.id = bi.product_id
     LIMIT 1)
  )
  INTO v_order_city;

  INSERT INTO public.orders (
    distributor_id,
    city_id,
    request_id,
    store_id,
    order_kind,
    status,
    total_retail_amount,
    total_discount_amount
  ) VALUES (
    v_user_id,
    v_order_city,
    p_request_id,
    v_effective_store_id,
    'retail',
    'accepted',
    v_total_retail,
    v_total_retail
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
    bi.product_id,
    bi.quantity,
    bi.retail_price,
    bi.retail_price,
    bi.unit_cost,
    bi.one_time_cost
  FROM _retail_order_items_tmp bi;

  UPDATE public.inventory i
  SET quantity = m.after_quantity,
      updated_at = NOW()
  FROM _inventory_log_movements_tmp m
  WHERE i.product_id = m.product_id;

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
    m.product_id,
    v_user_id,
    'sell',
    -m.total_qty,
    m.before_quantity,
    m.after_quantity,
    '零售售出'
  FROM _inventory_log_movements_tmp m;

  RETURN v_order_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_retail_order_atomic(JSONB, TEXT, UUID) TO authenticated;

-- ============================================================
-- 2. Mobile create_store_retail_order_atomic override
--    Keep store-pool semantics and add inventory_logs coverage.
-- ============================================================
CREATE OR REPLACE FUNCTION public.create_store_retail_order_atomic(
  p_items JSONB,
  p_store_id UUID,
  p_request_id TEXT DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_role TEXT;
  v_order_id UUID;
  v_total_retail NUMERIC(10, 2) := 0;
  v_store_city UUID;
  v_store_status TEXT;
  v_agg RECORD;
  v_store_stock INTEGER;
  v_existing_order_id UUID;
  v_effective_request_id TEXT;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION '未登录';
  END IF;

  SELECT role INTO v_role
  FROM public.profiles
  WHERE id = v_user_id;

  IF v_role IS NULL THEN
    RAISE EXCEPTION '用户资料不存在';
  END IF;

  IF v_role NOT IN ('admin', 'super_admin') THEN
    RAISE EXCEPTION '当前角色无店铺零售建单权限';
  END IF;

  IF p_store_id IS NULL THEN
    RAISE EXCEPTION '店铺ID不能为空';
  END IF;

  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION '购物车为空';
  END IF;

  IF p_request_id IS NOT NULL THEN
    IF p_request_id LIKE 'msr:%' THEN
      v_effective_request_id := p_request_id;
    ELSE
      v_effective_request_id := 'msr:' || p_request_id;
    END IF;
  ELSE
    v_effective_request_id := 'msr:' || gen_random_uuid()::text;
  END IF;

  IF v_effective_request_id IS NOT NULL THEN
    SELECT o.id
    INTO v_existing_order_id
    FROM public.orders o
    WHERE o.request_id = v_effective_request_id
    LIMIT 1;

    IF v_existing_order_id IS NOT NULL THEN
      RETURN v_existing_order_id;
    END IF;
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

  CREATE TEMP TABLE IF NOT EXISTS _store_retail_items_tmp (
    product_id UUID NOT NULL,
    quantity INTEGER NOT NULL
  ) ON COMMIT DROP;

  CREATE TEMP TABLE IF NOT EXISTS _store_retail_log_movements_tmp (
    product_id UUID PRIMARY KEY,
    total_qty INTEGER NOT NULL,
    before_quantity INTEGER NOT NULL,
    after_quantity INTEGER NOT NULL
  ) ON COMMIT DROP;

  TRUNCATE TABLE _store_retail_items_tmp;
  TRUNCATE TABLE _store_retail_log_movements_tmp;

  INSERT INTO _store_retail_items_tmp (product_id, quantity)
  SELECT x.product_id, x.quantity
  FROM jsonb_to_recordset(p_items) AS x(
    product_id UUID,
    quantity INTEGER
  );

  IF NOT EXISTS (SELECT 1 FROM _store_retail_items_tmp) THEN
    RAISE EXCEPTION '购物车为空';
  END IF;

  IF EXISTS (SELECT 1 FROM _store_retail_items_tmp WHERE quantity <= 0) THEN
    RAISE EXCEPTION '订单数量必须大于0';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM _store_retail_items_tmp bi
    LEFT JOIN public.products p ON p.id = bi.product_id
    WHERE p.id IS NULL
  ) THEN
    RAISE EXCEPTION '商品不存在';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM _store_retail_items_tmp bi
    JOIN public.products p ON p.id = bi.product_id
    WHERE p.city_id IS DISTINCT FROM v_store_city
  ) THEN
    RAISE EXCEPTION '店铺只能接收所属城市商品';
  END IF;

  FOR v_agg IN
    SELECT bi.product_id, SUM(bi.quantity)::INTEGER AS total_qty
    FROM _store_retail_items_tmp bi
    GROUP BY bi.product_id
    ORDER BY bi.product_id
  LOOP
    SELECT si.quantity
    INTO v_store_stock
    FROM public.store_inventory si
    WHERE si.store_id = p_store_id
      AND si.product_id = v_agg.product_id
    FOR UPDATE;

    IF v_store_stock IS NULL THEN
      RAISE EXCEPTION '店铺库存记录不存在';
    END IF;

    IF v_store_stock < v_agg.total_qty THEN
      RAISE EXCEPTION '店铺库存不足';
    END IF;

    INSERT INTO _store_retail_log_movements_tmp (product_id, total_qty, before_quantity, after_quantity)
    VALUES (
      v_agg.product_id,
      v_agg.total_qty,
      v_store_stock,
      v_store_stock - v_agg.total_qty
    )
    ON CONFLICT (product_id)
    DO UPDATE SET
      total_qty = EXCLUDED.total_qty,
      before_quantity = EXCLUDED.before_quantity,
      after_quantity = EXCLUDED.after_quantity;
  END LOOP;

  SELECT COALESCE(SUM(p.price * bi.quantity), 0)
  INTO v_total_retail
  FROM _store_retail_items_tmp bi
  JOIN public.products p ON p.id = bi.product_id;

  INSERT INTO public.orders (
    distributor_id,
    city_id,
    store_id,
    request_id,
    order_kind,
    status,
    total_retail_amount,
    total_discount_amount
  ) VALUES (
    v_user_id,
    v_store_city,
    p_store_id,
    v_effective_request_id,
    'retail',
    'accepted',
    v_total_retail,
    v_total_retail
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
    bi.product_id,
    bi.quantity,
    p.price,
    p.price,
    p.cost,
    p.one_time_cost
  FROM _store_retail_items_tmp bi
  JOIN public.products p ON p.id = bi.product_id;

  UPDATE public.store_inventory si
  SET quantity = m.after_quantity,
      updated_at = NOW()
  FROM _store_retail_log_movements_tmp m
  WHERE si.store_id = p_store_id
    AND si.product_id = m.product_id;

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
    m.product_id,
    v_user_id,
    'sell',
    -m.total_qty,
    m.before_quantity,
    m.after_quantity,
    '店铺零售售出'
  FROM _store_retail_log_movements_tmp m;

  RETURN v_order_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_store_retail_order_atomic(JSONB, UUID, TEXT) TO authenticated;

-- ============================================================
-- 3. delete_order_with_inventory_restore_atomic override
--    Retail single-pool rollback + delete rollback logging.
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

  IF LOWER(COALESCE(v_order.payment_status::TEXT, '')) = 'refunded' THEN
    DELETE FROM public.orders WHERE id = p_order_id;
    RETURN;
  END IF;

  IF COALESCE(v_order.order_kind::TEXT, 'distribution') = 'purchase' THEN
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

  ELSE
    CREATE TEMP TABLE IF NOT EXISTS _delete_inventory_log_movements_tmp (
      product_id UUID PRIMARY KEY,
      total_qty INTEGER NOT NULL,
      before_quantity INTEGER NOT NULL,
      after_quantity INTEGER NOT NULL
    ) ON COMMIT DROP;

    TRUNCATE TABLE _delete_inventory_log_movements_tmp;

    INSERT INTO _delete_inventory_log_movements_tmp (product_id, total_qty, before_quantity, after_quantity)
    SELECT
      agg.product_id,
      agg.total_qty,
      i.quantity,
      i.quantity + agg.total_qty
    FROM (
      SELECT oi.product_id, COALESCE(SUM(oi.quantity), 0)::INTEGER AS total_qty
      FROM public.order_items oi
      WHERE oi.order_id = p_order_id
      GROUP BY oi.product_id
    ) agg
    JOIN public.inventory i ON i.product_id = agg.product_id;

    UPDATE public.inventory i
    SET quantity = m.after_quantity,
        updated_at = NOW()
    FROM _delete_inventory_log_movements_tmp m
    WHERE i.product_id = m.product_id;

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
      m.product_id,
      v_uid,
      'refund_restore',
      m.total_qty,
      m.before_quantity,
      m.after_quantity,
      '删单回滚'
    FROM _delete_inventory_log_movements_tmp m;

    -- Distribution-only store pool rollback (retail non-msr no longer touches store_inventory)
    IF v_order.store_id IS NOT NULL
       AND COALESCE(v_order.order_kind::TEXT, 'distribution') = 'distribution' THEN
      CREATE TEMP TABLE IF NOT EXISTS _delete_store_pool_rollback_tmp (
        product_id UUID PRIMARY KEY,
        total_qty INTEGER NOT NULL,
        before_quantity INTEGER NOT NULL,
        after_quantity INTEGER NOT NULL
      ) ON COMMIT DROP;

      TRUNCATE TABLE _delete_store_pool_rollback_tmp;

      INSERT INTO _delete_store_pool_rollback_tmp (product_id, total_qty, before_quantity, after_quantity)
      SELECT
        agg.product_id,
        agg.store_qty,
        si.quantity AS before_quantity,
        si.quantity - agg.store_qty AS after_quantity
      FROM (
        SELECT
          oi.product_id,
          COALESCE(SUM(CASE WHEN oi.is_sample THEN 0 ELSE oi.quantity END), 0)::INTEGER AS store_qty
        FROM public.order_items oi
        WHERE oi.order_id = p_order_id
        GROUP BY oi.product_id
      ) agg
      JOIN public.store_inventory si
        ON si.store_id = v_order.store_id
       AND si.product_id = agg.product_id
      WHERE agg.store_qty > 0;

      UPDATE public.store_inventory si
      SET quantity = m.after_quantity,
          updated_at = NOW()
      FROM _delete_store_pool_rollback_tmp m
      WHERE si.store_id = v_order.store_id
        AND si.product_id = m.product_id;

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
        m.product_id,
        v_uid,
        'refund_restore',
        -m.total_qty,
        m.before_quantity,
        m.after_quantity,
        '删单回滚(店铺池)'
      FROM _delete_store_pool_rollback_tmp m;
    END IF;
  END IF;

  DELETE FROM public.orders WHERE id = p_order_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.delete_order_with_inventory_restore_atomic(UUID) TO authenticated;

-- ============================================================
-- 4. Bump schema_version to 7.3.0
-- ============================================================
INSERT INTO public.app_schema_meta (key, value)
VALUES ('schema_version', '7.3.0')
ON CONFLICT (key)
DO UPDATE SET
  value = EXCLUDED.value,
  updated_at = NOW();
