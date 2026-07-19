-- Migration v7.5: External channel order support
-- Execute after migrate-v7.4-store-invoice-contact-fields.sql
-- Purpose:
-- 1) Add 'external' to orders.order_kind CHECK while preserving existing values
-- 2) Add external_channel and external_order_no to orders
-- 3) Create create_external_order_atomic RPC (pending only; no inventory/finance side effects)
-- 4) Create confirm_external_order_atomic RPC (global inventory deduction + logs + finance income)
-- 5) Extend delete_order_with_inventory_restore_atomic for explicit external rollback
-- 6) Bump schema_version to 7.5.0

-- ============================================================
-- 0. Pre-check
-- ============================================================
DO $$
BEGIN
  IF public.get_app_schema_version() < '7.4.0' THEN
    RAISE EXCEPTION 'Migration v7.4.0 must be applied before v7.5.0';
  END IF;
END $$;

-- ============================================================
-- 1. Extend order_kind CHECK to include 'external'
-- ============================================================
ALTER TABLE public.orders
  DROP CONSTRAINT IF EXISTS orders_order_kind_check;

ALTER TABLE public.orders
  ADD CONSTRAINT orders_order_kind_check
  CHECK (order_kind IN ('distribution', 'retail', 'settlement', 'purchase', 'external'));

-- ============================================================
-- 2. External channel order identity fields
-- ============================================================
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS external_channel TEXT;

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS external_order_no TEXT;

COMMENT ON COLUMN public.orders.external_channel IS 'External sales channel for external orders (nullable)';
COMMENT ON COLUMN public.orders.external_order_no IS 'External platform order number for external orders (nullable)';

CREATE UNIQUE INDEX idx_orders_external_order_no ON orders(external_order_no) WHERE external_order_no IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_orders_external_channel
  ON public.orders(external_channel)
  WHERE order_kind = 'external';

-- ============================================================
-- 3. Create external order (pending only; no inventory/finance mutation)
--    Items accept product_id, quantity, optional retail_price and optional
--    discount_price. Missing prices resolve from products.price.
-- ============================================================
CREATE OR REPLACE FUNCTION public.create_external_order_atomic(
  p_items JSONB,
  p_external_channel TEXT,
  p_external_order_no TEXT,
  p_store_id UUID DEFAULT NULL,
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
  v_store_city UUID;
  v_store_status TEXT;
  v_external_channel TEXT := NULLIF(BTRIM(p_external_channel), '');
  v_external_order_no TEXT := NULLIF(BTRIM(p_external_order_no), '');
  v_total_retail NUMERIC(10, 2) := 0;
  v_total_discount NUMERIC(10, 2) := 0;
  v_existing_order_id UUID;
  v_effective_store_id UUID;
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

  IF v_role NOT IN ('admin', 'super_admin', 'inventory_manager') THEN
    RAISE EXCEPTION '当前角色无外部渠道建单权限';
  END IF;

  IF v_external_channel IS NULL THEN
    RAISE EXCEPTION '外部渠道不能为空';
  END IF;

  IF v_external_order_no IS NULL THEN
    RAISE EXCEPTION '外部订单号不能为空';
  END IF;

  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION '外部渠道订单商品不能为空';
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

  SELECT o.id
  INTO v_existing_order_id
  FROM public.orders o
  WHERE o.external_order_no = v_external_order_no
  LIMIT 1;

  IF v_existing_order_id IS NOT NULL THEN
    RAISE EXCEPTION '外部渠道订单号已存在';
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
      RAISE EXCEPTION '默认外部渠道店铺不存在';
    END IF;
  ELSE
    v_effective_store_id := p_store_id;
  END IF;

  SELECT s.city_id, s.status
  INTO v_store_city, v_store_status
  FROM public.stores s
  WHERE s.id = v_effective_store_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION '店铺不存在';
  END IF;

  IF v_store_status <> 'active' THEN
    RAISE EXCEPTION '店铺已停用';
  END IF;

  CREATE TEMP TABLE IF NOT EXISTS _external_order_items_tmp (
    product_id UUID NOT NULL,
    quantity INTEGER NOT NULL,
    retail_price NUMERIC(10, 2),
    discount_price NUMERIC(10, 2)
  ) ON COMMIT DROP;

  TRUNCATE TABLE _external_order_items_tmp;

  INSERT INTO _external_order_items_tmp (
    product_id,
    quantity,
    retail_price,
    discount_price
  )
  SELECT
    x.product_id,
    x.quantity,
    x.retail_price,
    x.discount_price
  FROM jsonb_to_recordset(p_items) AS x(
    product_id UUID,
    quantity INTEGER,
    retail_price NUMERIC(10, 2),
    discount_price NUMERIC(10, 2)
  );

  IF NOT EXISTS (SELECT 1 FROM _external_order_items_tmp) THEN
    RAISE EXCEPTION '外部渠道订单商品不能为空';
  END IF;

  IF EXISTS (SELECT 1 FROM _external_order_items_tmp WHERE quantity <= 0) THEN
    RAISE EXCEPTION '外部渠道订单数量必须大于0';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM _external_order_items_tmp ei
    LEFT JOIN public.products p ON p.id = ei.product_id
    WHERE p.id IS NULL
  ) THEN
    RAISE EXCEPTION '商品不存在';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM _external_order_items_tmp ei
    JOIN public.products p ON p.id = ei.product_id
    WHERE p.city_id IS DISTINCT FROM v_store_city
  ) THEN
    RAISE EXCEPTION '店铺只能销售所属城市商品';
  END IF;

  SELECT
    COALESCE(SUM(COALESCE(ei.retail_price, p.price) * ei.quantity), 0),
    COALESCE(SUM(COALESCE(ei.discount_price, ei.retail_price, p.price) * ei.quantity), 0)
  INTO v_total_retail, v_total_discount
  FROM _external_order_items_tmp ei
  JOIN public.products p ON p.id = ei.product_id;

  INSERT INTO public.orders (
    distributor_id,
    city_id,
    store_id,
    request_id,
    order_kind,
    status,
    payment_status,
    external_channel,
    external_order_no,
    total_retail_amount,
    total_discount_amount
  ) VALUES (
    v_user_id,
    v_store_city,
    v_effective_store_id,
    p_request_id,
    'external',
    'pending',
    'unpaid',
    v_external_channel,
    v_external_order_no,
    v_total_retail,
    v_total_discount
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
    ei.product_id,
    ei.quantity,
    COALESCE(ei.retail_price, p.price),
    COALESCE(ei.discount_price, ei.retail_price, p.price),
    COALESCE(p.cost, 0),
    COALESCE(p.one_time_cost, 0)
  FROM _external_order_items_tmp ei
  JOIN public.products p ON p.id = ei.product_id;

  RETURN v_order_id;
EXCEPTION
  WHEN unique_violation THEN
    RAISE EXCEPTION '外部渠道订单号已存在';
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_external_order_atomic(JSONB, TEXT, TEXT, UUID, TEXT) TO authenticated;

-- ============================================================
-- 4. Confirm external order (atomic global-inventory deduction + finance income)
-- ============================================================
CREATE OR REPLACE FUNCTION public.confirm_external_order_atomic(
  p_order_id UUID
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor_id UUID := auth.uid();
  v_actor_role TEXT;
  v_order public.orders%ROWTYPE;
  v_store_city UUID;
  v_store_status TEXT;
  v_category_id UUID;
  v_income_amount DECIMAL(12, 2) := 0;
  v_agg RECORD;
  v_stock INTEGER;
  v_product_name TEXT;
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

  IF v_actor_role NOT IN ('admin', 'super_admin', 'inventory_manager') THEN
    RAISE EXCEPTION '当前角色无确认外部渠道订单权限';
  END IF;

  SELECT * INTO v_order
  FROM public.orders
  WHERE id = p_order_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION '订单不存在';
  END IF;

  IF COALESCE(v_order.order_kind::TEXT, 'distribution') <> 'external' THEN
    RAISE EXCEPTION '不是外部渠道订单';
  END IF;

  IF v_order.status = 'accepted' THEN
    RETURN;
  END IF;

  IF v_order.status <> 'pending' THEN
    RAISE EXCEPTION '外部渠道订单状态不可确认';
  END IF;

  IF v_order.store_id IS NULL THEN
    RAISE EXCEPTION '外部渠道订单未绑定店铺';
  END IF;

  SELECT s.city_id, s.status
  INTO v_store_city, v_store_status
  FROM public.stores s
  WHERE s.id = v_order.store_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION '店铺不存在';
  END IF;

  IF v_store_status <> 'active' THEN
    RAISE EXCEPTION '店铺已停用';
  END IF;

  SELECT id INTO v_category_id
  FROM public.finance_categories
  WHERE name = '线上渠道收入'
    AND type = 'income';

  IF v_category_id IS NULL THEN
    RAISE EXCEPTION '线上渠道收入分类不存在';
  END IF;

  CREATE TEMP TABLE IF NOT EXISTS _external_confirm_movements_tmp (
    product_id UUID PRIMARY KEY,
    total_qty INTEGER NOT NULL,
    before_quantity INTEGER NOT NULL,
    after_quantity INTEGER NOT NULL
  ) ON COMMIT DROP;

  TRUNCATE TABLE _external_confirm_movements_tmp;

  FOR v_agg IN
    SELECT oi.product_id, COALESCE(SUM(oi.quantity), 0)::INTEGER AS total_qty
    FROM public.order_items oi
    WHERE oi.order_id = p_order_id
    GROUP BY oi.product_id
    ORDER BY oi.product_id
  LOOP
    SELECT i.quantity, COALESCE(p.name, v_agg.product_id::TEXT)
    INTO v_stock, v_product_name
    FROM public.inventory i
    LEFT JOIN public.products p ON p.id = i.product_id
    WHERE i.product_id = v_agg.product_id
    FOR UPDATE;

    IF v_stock IS NULL THEN
      RAISE EXCEPTION '库存记录不存在：商品ID %', v_agg.product_id;
    END IF;

    IF v_stock < v_agg.total_qty THEN
      RAISE EXCEPTION '库存不足：商品%，需要%，当前%', v_product_name, v_agg.total_qty, v_stock;
    END IF;

    INSERT INTO _external_confirm_movements_tmp (product_id, total_qty, before_quantity, after_quantity)
    VALUES (
      v_agg.product_id,
      v_agg.total_qty,
      v_stock,
      v_stock - v_agg.total_qty
    );
  END LOOP;

  IF NOT EXISTS (SELECT 1 FROM _external_confirm_movements_tmp) THEN
    RAISE EXCEPTION '外部渠道订单商品不能为空';
  END IF;

  SELECT COALESCE(SUM(COALESCE(oi.discount_price, oi.retail_price, 0) * oi.quantity), 0)::DECIMAL(12, 2)
  INTO v_income_amount
  FROM public.order_items oi
  WHERE oi.order_id = p_order_id;

  UPDATE public.inventory i
  SET quantity = m.after_quantity,
      updated_at = NOW()
  FROM _external_confirm_movements_tmp m
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
    v_actor_id,
    'sell',
    -m.total_qty,
    m.before_quantity,
    m.after_quantity,
    FORMAT(
      '外部渠道售出；order_id=%s；store_id=%s；external_channel=%s；external_order_no=%s',
      p_order_id,
      v_order.store_id,
      v_order.external_channel,
      v_order.external_order_no
    )
  FROM _external_confirm_movements_tmp m;

  INSERT INTO public.financial_transactions (
    transaction_type,
    category_id,
    amount,
    transaction_date,
    store_id,
    city_id,
    channel_name,
    description,
    created_by,
    source_order_id
  ) VALUES (
    'income',
    v_category_id,
    v_income_amount,
    CURRENT_DATE,
    v_order.store_id,
    v_store_city,
    v_order.external_channel,
    FORMAT('外部渠道订单确认收入；order_id=%s；external_channel=%s；external_order_no=%s', p_order_id, v_order.external_channel, v_order.external_order_no),
    v_actor_id,
    p_order_id
  );

  UPDATE public.orders
  SET status = 'accepted',
      city_id = v_store_city
  WHERE id = p_order_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.confirm_external_order_atomic(UUID) TO authenticated;

-- ============================================================
-- 5. delete_order_with_inventory_restore_atomic override
--    Adds explicit external branch before the generic distribution fallback.
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
  v_order_kind TEXT;
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

  v_order_kind := COALESCE(v_order.order_kind::TEXT, 'distribution');

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

  ELSIF v_order_kind = 'external' THEN
    IF v_order.status = 'accepted' THEN
      CREATE TEMP TABLE IF NOT EXISTS _delete_external_rollback_tmp (
        product_id UUID PRIMARY KEY,
        total_qty INTEGER NOT NULL,
        before_quantity INTEGER NOT NULL,
        after_quantity INTEGER NOT NULL
      ) ON COMMIT DROP;

      TRUNCATE TABLE _delete_external_rollback_tmp;

      INSERT INTO _delete_external_rollback_tmp (product_id, total_qty, before_quantity, after_quantity)
      SELECT
        agg.product_id,
        agg.total_qty,
        COALESCE(i.quantity, 0) AS before_quantity,
        COALESCE(i.quantity, 0) + agg.total_qty AS after_quantity
      FROM (
        SELECT oi.product_id, COALESCE(SUM(oi.quantity), 0)::INTEGER AS total_qty
        FROM public.order_items oi
        WHERE oi.order_id = p_order_id
        GROUP BY oi.product_id
      ) agg
      LEFT JOIN public.inventory i ON i.product_id = agg.product_id;

      INSERT INTO public.inventory (product_id, quantity, updated_at)
      SELECT
        m.product_id,
        m.total_qty,
        NOW()
      FROM _delete_external_rollback_tmp m
      ON CONFLICT (product_id)
      DO UPDATE SET
        quantity = public.inventory.quantity + EXCLUDED.quantity,
        updated_at = NOW();

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
        '外部渠道删单回滚'
      FROM _delete_external_rollback_tmp m;
    ELSIF v_order.status <> 'pending' THEN
      RAISE EXCEPTION '外部渠道订单状态不可删除';
    END IF;

    DELETE FROM public.financial_transactions
    WHERE source_order_id = p_order_id;

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

  IF v_order_kind = 'external' THEN
    DELETE FROM public.order_items WHERE order_id = p_order_id;
  END IF;

  DELETE FROM public.orders WHERE id = p_order_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.delete_order_with_inventory_restore_atomic(UUID) TO authenticated;

-- ============================================================
-- 6. Bump schema_version to 7.5.0
-- ============================================================
INSERT INTO public.app_schema_meta (key, value)
VALUES ('schema_version', '7.5.0')
ON CONFLICT (key)
DO UPDATE SET
  value = EXCLUDED.value,
  updated_at = NOW();
