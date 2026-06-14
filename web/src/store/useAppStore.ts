import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { supabase, supabaseConfigError } from '../lib/supabase';
import { applyOrdersDateFilters } from '../utils/fetchOrdersDateParams';
import { generateEAN13 } from '../utils/barcode';
import { calculateRetailOrderTotals, getRetailUnitPrice } from '../utils/orderPricing';
import { resolvePrice } from '../utils/priceResolver';
import type {
  City,
  InventoryLog,
  Notification,
  Order,
  OrderItem,
  RefundedOrderItem,
  ProductCreateInput,
  ProfileUpdateInput,
  ProductWithDetails,
  Profile,
  Store,
  StoreInventory,
  StoreProductPrice,
} from '../types';

interface ProfileRow {
  id: string;
  email: string;
  full_name?: string;
  avatar_url?: string | null;
  role: Profile['role'];
  city_id?: string | null;
  cities?: { name: string } | null;
  store_name?: string | null;
  created_at: string;
  updated_at: string;
}

interface ProductRow {
  id: string;
  name: string;
  price?: number | string | null;
  cost?: number | string | null;
  one_time_cost?: number | string | null;
  discount_price?: number | string | null;
  barcode?: string | null;
  image_url?: string | null;
  city_id: string;
  created_at: string;
  updated_at: string;
  cities?: { name: string } | null;
  inventory?: Array<{ quantity?: number | null; min_quantity?: number | null }>;
}

interface OrderItemRow {
  id: string;
  order_id: string;
  product_id: string;
  quantity: number;
  retail_price?: number | string | null;
  discount_price?: number | string | null;
  unit_cost?: number | string | null;
  one_time_cost?: number | string | null;
  is_sample?: boolean | null;
  product?: { name?: string; cities?: { name: string } | null } | null;
  products?: { name?: string; cities?: { name: string } | null } | null;
}

interface OrderRow {
  id: string;
  distributor_id: string;
  profiles?: { email?: string; store_name?: string | null } | Array<{ email?: string; store_name?: string | null }> | null;
  store_id?: string | null;
  stores?: { name?: string | null } | Array<{ name?: string | null }> | null;
  city_id?: string | null;
  cities?: { name: string } | Array<{ name: string }> | null;
  status: Order['status'];
  order_kind?: Order['order_kind'] | null;
  total_retail_amount?: number | string | null;
  total_discount_amount?: number | string | null;
  payment_amount?: number | string | null;
  payment_status?: string | null;
  payment_method?: string | null;
  payment_transaction_id?: string | null;
  payment_paid_at?: string | null;
  payment_note?: string | null;
  product_id?: string | null;
  quantity?: number | string | null;
  unit_price?: number | string | null;
  total_amount?: number | string | null;
  created_at: string;
  order_items?: OrderItemRow[];
}

interface InventoryLogRow {
  id: string;
  product_id: string;
  operator_id: string;
  action: InventoryLog['action'];
  delta_quantity: number;
  before_quantity: number;
  after_quantity: number;
  note?: string | null;
  created_at: string;
  products?: { name?: string } | null;
}

interface StoreRow {
  id: string;
  name: string;
  city_id: string;
  distributor_id?: string | null;
  discount_rate?: number | string | null;
  contact?: string | null;
  address?: string | null;
  phone?: string | null;
  status?: Store['status'] | null;
  created_at: string;
  updated_at: string;
  cities?: { name: string } | Array<{ name: string }> | null;
  profiles?: { email?: string } | Array<{ email?: string }> | null;
}

interface StoreInventoryRow {
  id: string;
  store_id: string;
  product_id: string;
  quantity?: number | string | null;
  updated_at: string;
  products?: { name?: string } | Array<{ name?: string }> | null;
}

interface StoreProductPriceRow {
  id: string;
  store_id: string;
  product_id: string;
  override_price?: number | string | null;
  created_at: string;
  updated_at: string;
}

interface StoreCreateInput {
  name: string;
  city_id: string;
  distributor_id?: string | null;
  discount_rate?: number;
  contact?: string;
  address?: string;
  phone?: string;
}

interface StoreUpdateInput {
  name?: string;
  city_id?: string;
  distributor_id?: string | null;
  discount_rate?: number;
  contact?: string;
  address?: string;
  phone?: string;
  status?: Store['status'];
}

interface CartCreateItem {
  productId: string;
  quantity: number;
  isSample?: boolean;
}

interface CashierCreateItem {
  productId: string;
  quantity: number;
}

interface RpcErrorLike {
  code?: string;
  message?: string;
}

const requiredSchemaVersion = '4.3.0';
const sessionActivationGraceMs = 20000;
const sessionRetryDelayMs = 600;
const sessionRetryTimes = 2;
const unpaidRetailAutoDeleteMs = 30 * 60 * 1000;
const paidRetailStatuses = new Set(['paid', 'partial_refunded', 'partial_refund_pending', 'refunded', 'refund_pending']);

let sessionGraceUntil = 0;

const createRequestId = (userId: string): string => {
  const randomPart = Math.random().toString(36).slice(2, 10);
  return `batch-${userId}-${Date.now()}-${randomPart}`;
};

const shouldFallbackToLegacyFlow = (error: RpcErrorLike | null): boolean => {
  if (!error) return false;
  const message = String(error.message || '').toLowerCase();
  const missingByCode = error.code === '42883' || error.code === 'PGRST202';
  if (missingByCode) return true;

  const onOrdersTable = message.includes('relation "orders"') || message.includes('table "orders"');
  const legacyColumnHit =
    message.includes('column "quantity"')
    || message.includes('column "unit_price"')
    || message.includes('column "product_id"')
    || message.includes('column "total_amount"')
    || message.includes('column "total-amount"')
    || message.includes('column quantity')
    || message.includes('column unit_price')
    || message.includes('column product_id')
    || message.includes('column total_amount')
    || message.includes('column total-amount');
  const legacyNotNullHit = error.code === '23502' && onOrdersTable && legacyColumnHit;
  if (legacyNotNullHit) return true;

  return message.includes('could not find the function public.create_batch_order_atomic')
    || message.includes('could not find the function public.create_retail_order_atomic');
};

const parseSemver = (input: string): [number, number, number] | null => {
  const match = input.trim().match(/^(\d+)\.(\d+)\.(\d+)$/);
  if (!match) return null;
  return [Number(match[1]), Number(match[2]), Number(match[3])];
};

const isSchemaVersionAtLeast = (currentVersion: string, minVersion: string): boolean => {
  const current = parseSemver(currentVersion);
  const min = parseSemver(minVersion);
  if (!current || !min) return false;

  if (current[0] !== min[0]) return current[0] > min[0];
  if (current[1] !== min[1]) return current[1] > min[1];
  return current[2] >= min[2];
};

const isMissingRpcFunction = (error: RpcErrorLike | null): boolean => {
  if (!error) return false;
  const message = String(error.message || '').toLowerCase();
  return error.code === '42883'
    || error.code === 'PGRST202'
    || message.includes('could not find the function');
};

const shouldAutoDeleteStaleRetailOrder = (row: Pick<OrderRow, 'order_kind' | 'payment_status' | 'created_at'>): boolean => {
  if ((row.order_kind || 'distribution') !== 'retail') return false;

  const paymentStatus = String(row.payment_status || '').toLowerCase();
  if (paidRetailStatuses.has(paymentStatus)) return false;

  const createdAtMs = new Date(row.created_at).getTime();
  if (!Number.isFinite(createdAtMs)) return false;

  return Date.now() - createdAtMs >= unpaidRetailAutoDeleteMs;
};

interface AppState {
  user: Profile | null;
  cities: City[];
  products: ProductWithDetails[];
  orders: Order[];
  stores: Store[];
  storeInventory: StoreInventory[];
  storeProductPrices: StoreProductPrice[];
  notifications: Notification[];
  inventoryLogs: InventoryLog[];
  isLoading: boolean;
  schemaVersion: string | null;
  schemaError: string | null;

  setLoading: (loading: boolean) => void;
  checkSchemaVersion: () => Promise<{ error: Error | null }>;
  ensureActiveSession: () => Promise<Error | null>;
  signIn: (email: string, password: string) => Promise<{ error: Error | null }>;
  signOut: () => Promise<void>;

  fetchCities: () => Promise<void>;
  moveCityOrder: (cityId: string, direction: 'up' | 'down') => Promise<{ error: Error | null }>;
  fetchProducts: () => Promise<void>;
  fetchOrders: (startDate?: string, endDate?: string) => Promise<void>;
  fetchStores: () => Promise<void>;
  fetchStoreInventory: (storeId: string) => Promise<void>;
  fetchStoreProductPrices: (storeId: string) => Promise<void>;
  fetchNotifications: () => Promise<void>;
  fetchInventoryLogs: () => Promise<void>;
  fetchOrderDetail: (orderId: string) => Promise<Order | null>;
  fetchAllData: () => Promise<void>;

  addStore: (store: StoreCreateInput) => Promise<{ error: Error | null }>;
  updateStore: (id: string, updates: StoreUpdateInput) => Promise<{ error: Error | null }>;
  deactivateStore: (id: string) => Promise<{ error: Error | null }>;
  deleteStore: (id: string) => Promise<{ error: Error | null }>;
  addProduct: (payload: ProductCreateInput) => Promise<{ error: Error | null }>;
  updateProduct: (productId: string, payload: ProductCreateInput) => Promise<{ error: Error | null }>;
  setStoreProductPrice: (storeId: string, productId: string, price: number) => Promise<{ error: Error | null }>;
  updateInventoryByProduct: (
    productId: string,
    nextQty: number,
    options?: { action?: InventoryLog['action']; note?: string },
  ) => Promise<{ error: Error | null }>;
  updateStoreInventoryByProduct: (
    storeId: string,
    productId: string,
    nextQty: number,
  ) => Promise<{ error: Error | null }>;
  inboundStockByBarcode: (barcode: string, quantity: number) => Promise<{ error: Error | null }>;
  createBatchOrders: (items: CartCreateItem[], storeId?: string | null) => Promise<{ error: Error | null }>;
  createRetailOrders: (items: CashierCreateItem[]) => Promise<{ orderId?: string; error: Error | null }>;
  acceptOrder: (orderId: string) => Promise<{ error: Error | null }>;
  deleteOrder: (orderId: string) => Promise<{ error: Error | null }>;
  modifyDistributionOrder: (orderId: string, items: Array<{ order_item_id: string; new_quantity: number }>) => Promise<{ error: Error | null }>;
  updateOwnProfile: (payload: ProfileUpdateInput) => Promise<{ error: Error | null }>;
  updateOwnStoreName: (storeName: string) => Promise<{ error: Error | null }>;
  updateOwnAvatar: (avatarUrl: string) => Promise<{ error: Error | null }>;
  markNotificationRead: (notificationId: string) => Promise<void>;
  markAllNotificationsRead: () => Promise<void>;
}

const orderSelect = `
  *,
  cities(name),
  profiles:distributor_id(email,store_name),
  stores(name),
  order_items(
    *,
    products(
      name,
      cities(name)
    )
  )
`;

const pickFirstRelation = <T>(value: T | T[] | null | undefined): T | null => {
  if (!value) return null;
  return Array.isArray(value) ? value[0] ?? null : value;
};

const mapProfile = (row: ProfileRow): Profile => ({
  id: row.id,
  email: row.email,
  full_name: row.full_name,
  avatar_url: row.avatar_url ?? undefined,
  role: row.email?.toLowerCase() === '2330605169@qq.com' ? 'super_admin' : row.role,
  city_id: row.city_id,
  city_name: row.cities?.name,
  store_name: row.store_name,
  created_at: row.created_at,
  updated_at: row.updated_at,
});

const mapProducts = (rows: ProductRow[]): ProductWithDetails[] => {
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    price: Number(row.price || 0),
    cost: Number(row.cost || 0),
    one_time_cost: Number(row.one_time_cost || 0),
    discount_price: Number(row.discount_price || row.price || 0),
    barcode: row.barcode ?? undefined,
    image_url: row.image_url ?? undefined,
    city_id: row.city_id,
    created_at: row.created_at,
    updated_at: row.updated_at,
    city_name: row.cities?.name,
    quantity: row.inventory?.[0]?.quantity !== undefined && row.inventory?.[0]?.quantity !== null
      ? Number(row.inventory[0].quantity)
      : undefined,
    min_quantity: row.inventory?.[0]?.min_quantity !== undefined && row.inventory?.[0]?.min_quantity !== null
      ? Number(row.inventory[0].min_quantity)
      : undefined,
  }));
};

const mapStore = (row: StoreRow): Store => {
  const cityData = pickFirstRelation(row.cities);
  const distributorData = pickFirstRelation(row.profiles);

  return {
    id: row.id,
    name: row.name,
    city_id: row.city_id,
    city_name: cityData?.name,
    distributor_id: row.distributor_id ?? null,
    distributor_email: distributorData?.email ?? null,
    discount_rate: Number(row.discount_rate ?? 1),
    contact: row.contact ?? undefined,
    address: row.address ?? undefined,
    phone: row.phone ?? undefined,
    status: row.status || 'active',
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
};

const mapStoreInventory = (row: StoreInventoryRow): StoreInventory => {
  const productData = pickFirstRelation(row.products);

  return {
    id: row.id,
    store_id: row.store_id,
    product_id: row.product_id,
    product_name: productData?.name,
    quantity: Number(row.quantity || 0),
    updated_at: row.updated_at,
  };
};

const mapStoreProductPrice = (row: StoreProductPriceRow): StoreProductPrice => ({
  id: row.id,
  store_id: row.store_id,
  product_id: row.product_id,
  override_price: Number(row.override_price || 0),
  created_at: row.created_at,
  updated_at: row.updated_at,
});

const mapOrder = (row: OrderRow): Order => {
  const itemsFromRelation: OrderItem[] = (row.order_items || []).map((item) => {
    const productInfo = item.products || item.product;
    return {
    id: item.id,
    order_id: item.order_id,
    product_id: item.product_id,
    product_name: productInfo?.name,
    city_name: productInfo?.cities?.name,
    is_sample: Boolean(item.is_sample),
    quantity: Number(item.quantity || 0),
    retail_price: Number(item.retail_price || 0),
    discount_price: Number(item.discount_price || 0),
    unit_cost: Number(item.unit_cost || 0),
    one_time_cost: Number(item.one_time_cost || 0),
  };
  });

  const profileData = pickFirstRelation(row.profiles);
  const cityData = pickFirstRelation(row.cities);
  const storeData = pickFirstRelation(row.stores);

  return {
    id: row.id,
    distributor_id: row.distributor_id,
    distributor_email: profileData?.email,
    distributor_store: profileData?.store_name ?? undefined,
    store_id: row.store_id ?? null,
    store_name: storeData?.name ?? null,
    city_id: row.city_id ?? undefined,
    city_name: cityData?.name,
    status: row.status,
    order_kind: row.order_kind || 'distribution',
    total_retail_amount: Number(row.total_retail_amount || 0),
    total_discount_amount: Number(row.total_discount_amount || 0),
    payment_amount: row.payment_amount !== undefined && row.payment_amount !== null ? Number(row.payment_amount) : undefined,
    payment_status: row.payment_status ?? undefined,
    payment_method: row.payment_method ?? undefined,
    payment_transaction_id: row.payment_transaction_id ?? undefined,
    payment_paid_at: row.payment_paid_at ?? undefined,
    payment_note: row.payment_note ?? undefined,
    created_at: row.created_at,
    items: itemsFromRelation,
  };
};

const mapInventoryLog = (row: InventoryLogRow): InventoryLog => ({
  id: row.id,
  product_id: row.product_id,
  product_name: row.products?.name,
  operator_id: row.operator_id,
  action: row.action,
  delta_quantity: Number(row.delta_quantity || 0),
  before_quantity: Number(row.before_quantity || 0),
  after_quantity: Number(row.after_quantity || 0),
  note: row.note ?? undefined,
  created_at: row.created_at,
});

export const useAppStore = create<AppState>()(
  persist(
    (set, get) => ({
      user: null,
      cities: [],
      products: [],
      orders: [],
      stores: [],
      storeInventory: [],
      storeProductPrices: [],
      notifications: [],
      inventoryLogs: [],
      isLoading: false,
      schemaVersion: null,
      schemaError: null,

      setLoading: (isLoading) => set({ isLoading }),

      checkSchemaVersion: async () => {
        try {
          const { data, error } = await supabase.rpc('get_app_schema_version');
          if (error) {
            if (isMissingRpcFunction(error)) {
              const missingMessage = `数据库缺少版本门禁函数 get_app_schema_version，请执行迁移（>= ${requiredSchemaVersion}）`;
              set({ schemaError: missingMessage });
              return { error: new Error(missingMessage) };
            }

            const dbError = error as Error;
            set({ schemaError: dbError.message });
            return { error: dbError };
          }

          const currentVersion = String(data || '').trim();
          if (!isSchemaVersionAtLeast(currentVersion, requiredSchemaVersion)) {
            const versionError = `数据库版本过低（当前 ${currentVersion || 'unknown'}，要求 >= ${requiredSchemaVersion}）`;
            set({ schemaVersion: currentVersion || null, schemaError: versionError });
            return { error: new Error(versionError) };
          }

          set({ schemaVersion: currentVersion, schemaError: null });
          return { error: null };
        } catch (error) {
          const schemaError = error as Error;
          set({ schemaError: schemaError.message });
          return { error: schemaError };
        }
      },

      ensureActiveSession: async () => {
        if (Date.now() < sessionGraceUntil) {
          return null;
        }

        const checkOnce = async (): Promise<{ ok: boolean; error: Error | null }> => {
          const { data: checkResult, error: checkError } = await supabase.rpc('is_current_session_active');
          if (checkError) {
            if (isMissingRpcFunction(checkError)) {
              return { ok: true, error: null };
            }
            return { ok: false, error: checkError as Error };
          }
          return { ok: Boolean(checkResult), error: null };
        };

        const firstCheck = await checkOnce();
        if (firstCheck.error) return firstCheck.error;
        if (firstCheck.ok) return null;

        for (let attempt = 0; attempt < sessionRetryTimes; attempt += 1) {
          await new Promise((resolve) => {
            window.setTimeout(resolve, sessionRetryDelayMs);
          });
          const retryCheck = await checkOnce();
          if (retryCheck.error) return retryCheck.error;
          if (retryCheck.ok) return null;
        }

        if (Date.now() < sessionGraceUntil) {
          return null;
        }

        return new Error('账号已在其他设备登录，请重新登录');
      },

      signIn: async (email, password) => {
        set({ isLoading: true });
        try {
          if (supabaseConfigError) {
            throw new Error(supabaseConfigError);
          }

          const { data, error } = await supabase.auth.signInWithPassword({ email, password });
          if (error) throw error;

          if (data.user) {
            sessionGraceUntil = Date.now() + sessionActivationGraceMs;
            const { data: profile, error: profileError } = await supabase
              .from('profiles')
              .select('*, cities(name)')
              .eq('id', data.user.id)
              .single();
            if (profileError) throw profileError;
            set({ user: mapProfile(profile as ProfileRow) });

            const { error: activateError } = await supabase.rpc('activate_current_session');
            if (activateError && !isMissingRpcFunction(activateError)) {
              await get().signOut();
              throw activateError;
            }

            sessionGraceUntil = Date.now() + sessionActivationGraceMs;
          }

          return { error: null };
        } catch (error) {
          return { error: error as Error };
        } finally {
          set({ isLoading: false });
        }
      },

      signOut: async () => {
        try {
          await supabase.auth.signOut();
        } finally {
          sessionGraceUntil = 0;
          set({
            user: null,
            cities: [],
            products: [],
            orders: [],
            stores: [],
            storeInventory: [],
            storeProductPrices: [],
            notifications: [],
            inventoryLogs: [],
            schemaVersion: null,
            schemaError: null,
          });
        }
      },

      fetchCities: async () => {
        const { data, error } = await supabase
          .from('cities')
          .select('*')
          .order('sort_index', { ascending: true })
          .order('name', { ascending: true });
        if (!error && data) set({ cities: data as City[] });
      },

      moveCityOrder: async (cityId, direction) => {
        try {
          const { user, cities } = get();
          if (!user) throw new Error('未登录');
          if (user.role !== 'admin') throw new Error('仅管理员可调整城市排序');

          const currentIndex = cities.findIndex((city) => city.id === cityId);
          if (currentIndex < 0) throw new Error('城市不存在');
          const atBoundary = direction === 'up' ? currentIndex === 0 : currentIndex === cities.length - 1;
          if (atBoundary) {
            return { error: null };
          }

          const { error } = await supabase.rpc('swap_city_sort_order', {
            p_city_id: cityId,
            p_direction: direction,
          });
          if (error) throw error;

          await get().fetchCities();
          return { error: null };
        } catch (error) {
          return { error: error as Error };
        }
      },

      fetchProducts: async () => {
        const { user } = get();
        if (!user) return;
        const { data, error } = await supabase
          .from('products')
          .select('*, cities(name), inventory(quantity, min_quantity)')
          .order('name');
        if (error || !data) return;

        const all = mapProducts(data as ProductRow[]);
        set({
          products: user.role === 'distributor'
            ? all.filter((p) => p.city_id === user.city_id)
            : all,
        });
      },

      fetchOrders: async (startDate?: string, endDate?: string) => {
        const { user } = get();
        if (!user) return;

        let query = supabase
          .from('orders')
          .select(orderSelect);

        query = applyOrdersDateFilters(query, startDate, endDate);

        const { data, error } = await query
          .order('created_at', { ascending: false })
          .limit(200);
        if (error || !data) return;

        let rows = data as OrderRow[];
        const canAutoCleanupUnpaidRetail = user.role === 'admin' || user.role === 'super_admin' || user.role === 'inventory_manager';
        if (canAutoCleanupUnpaidRetail) {
          const staleRetailOrderIds = rows
            .filter((row) => shouldAutoDeleteStaleRetailOrder(row))
            .map((row) => row.id);

          if (staleRetailOrderIds.length > 0) {
            await Promise.allSettled(
              staleRetailOrderIds.map((orderId) => (
                supabase.rpc('delete_order_with_inventory_restore_atomic', { p_order_id: orderId })
              )),
            );

            let refreshQuery = supabase
              .from('orders')
              .select(orderSelect);

            refreshQuery = applyOrdersDateFilters(refreshQuery, startDate, endDate);

            const { data: refreshedRows, error: refreshedError } = await refreshQuery
              .order('created_at', { ascending: false })
              .limit(200);

            if (!refreshedError && refreshedRows) {
              rows = refreshedRows as OrderRow[];
            }
          }
        }

        const mapped = rows
          .map(mapOrder)
          .filter((order) => (user.role === 'distributor' ? order.distributor_id === user.id : true));
        set({ orders: mapped });
      },

      fetchStores: async () => {
        const { user } = get();
        if (!user) {
          set({ stores: [] });
          return;
        }

        let query = supabase
          .from('stores')
          .select('*, cities(name), profiles:distributor_id(email)')
          .order('created_at', { ascending: false });

        if (user.role === 'distributor') {
          query = query.eq('status', 'active');
        }

        const { data, error } = await query;
        if (error || !data) {
          set({ stores: [] });
          return;
        }

        set({ stores: (data as StoreRow[]).map(mapStore) });
      },

      fetchStoreInventory: async (storeId) => {
        if (!storeId) {
          set({ storeInventory: [] });
          return;
        }

        const { data, error } = await supabase
          .from('store_inventory')
          .select('*, products(name)')
          .eq('store_id', storeId)
          .order('updated_at', { ascending: false });

        if (error || !data) {
          set({ storeInventory: [] });
          return;
        }

        set({ storeInventory: (data as StoreInventoryRow[]).map(mapStoreInventory) });
      },

      fetchStoreProductPrices: async (storeId) => {
        if (!storeId) {
          set({ storeProductPrices: [] });
          return;
        }

        const { data, error } = await supabase
          .from('store_product_prices')
          .select('*')
          .eq('store_id', storeId)
          .order('updated_at', { ascending: false });

        if (error || !data) {
          set({ storeProductPrices: [] });
          return;
        }

        set({ storeProductPrices: (data as StoreProductPriceRow[]).map(mapStoreProductPrice) });
      },

      fetchNotifications: async () => {
        const { user } = get();
        if (!user) return;
        const { data, error } = await supabase
          .from('notifications')
          .select('*')
          .eq('user_id', user.id)
          .order('created_at', { ascending: false })
          .limit(50);
        if (!error && data) set({ notifications: data as Notification[] });
      },

      fetchInventoryLogs: async () => {
        const { user } = get();
        if (!user || user.role === 'distributor') {
          set({ inventoryLogs: [] });
          return;
        }

        const { data, error } = await supabase
          .from('inventory_logs')
          .select('*, products(name)')
          .order('created_at', { ascending: false })
          .limit(200);

        if (!error && data) {
          set({ inventoryLogs: (data as InventoryLogRow[]).map(mapInventoryLog) });
        }
      },

      fetchOrderDetail: async (orderId) => {
        const { data: orderRow, error: orderError } = await supabase
          .from('orders')
          .select('id, distributor_id, store_id, city_id, status, order_kind, total_retail_amount, total_discount_amount, payment_amount, payment_status, payment_method, payment_transaction_id, payment_paid_at, payment_note, created_at, profiles:distributor_id(email,store_name), stores(name), cities(name), product_id, quantity, unit_price, total_amount')
          .eq('id', orderId)
          .maybeSingle();
        if (orderError || !orderRow) return null;

        const base = mapOrder(orderRow as OrderRow);
        const row = orderRow as OrderRow;
        const wechatOutTradeNo = orderId.replace(/-/g, '');
        const { data: refundEvents } = await supabase
          .from('payment_events')
          .select('created_at,payload,status,out_trade_no,event_type,processed')
          .eq('event_type', 'refund')
          .eq('processed', true)
          .in('out_trade_no', [orderId, wechatOutTradeNo])
          .order('created_at', { ascending: false })
          .limit(50);

        const refundedItemsFromEvents: RefundedOrderItem[] = (refundEvents || [])
          .flatMap((event: {
            created_at?: string;
            payload?: {
              refundedItems?: Array<{
                order_item_id?: string;
                product_id?: string;
                product_name?: string;
                quantity?: number | string;
                retail_price?: number | string;
                discount_price?: number | string;
              }>;
            } | null;
          }) => {
            const items = Array.isArray(event?.payload?.refundedItems) ? event.payload.refundedItems : [];
            return items.map((item) => ({
              order_item_id: String(item.order_item_id || ''),
              product_id: String(item.product_id || ''),
              product_name: item.product_name ? String(item.product_name) : undefined,
              quantity: Number(item.quantity || 0),
              retail_price: Number(item.retail_price || 0),
              discount_price: Number(item.discount_price || 0),
              refunded_at: event.created_at,
            }));
          })
          .filter((item) => item.order_item_id && item.product_id && item.quantity > 0);

        const { data: itemRows, error: itemError } = await supabase
          .from('order_items')
          .select('id, order_id, product_id, quantity, retail_price, discount_price, unit_cost, one_time_cost, is_sample')
          .eq('order_id', orderId)
          .order('id', { ascending: true });

        if (!itemError && itemRows && itemRows.length > 0) {
          const productIds = Array.from(new Set(itemRows.map((row) => row.product_id)));
          const { data: productRows } = await supabase
            .from('products')
            .select('id, name, cities(name)')
            .in('id', productIds);

          const productMap = new Map<string, { name?: string; city?: string }>();
          (productRows || []).forEach((product: { id: string; name?: string; cities?: { name: string }[] | { name: string } }) => {
            const cityName = Array.isArray(product.cities) ? product.cities[0]?.name : product.cities?.name;
            productMap.set(product.id, { name: product.name, city: cityName });
          });

          const items: OrderItem[] = itemRows.map((item) => {
            const product = productMap.get(item.product_id);
            return {
              id: item.id,
              order_id: item.order_id,
              product_id: item.product_id,
              product_name: product?.name,
              city_name: product?.city || base.city_name,
              quantity: Number(item.quantity || 0),
              is_sample: Boolean(item.is_sample),
              retail_price: Number(item.retail_price || 0),
              discount_price: Number(item.discount_price || 0),
              unit_cost: Number(item.unit_cost || 0),
              one_time_cost: Number(item.one_time_cost || 0),
            };
          });

          const legacyQty = Number(row.quantity || 0);
          const legacyProductId = row.product_id || '';
          if (legacyProductId && legacyQty > 0) {
            const legacyRetail = Number(row.unit_price || 0);
            const legacyDiscountTotal = Number(
              row.total_amount || row.total_discount_amount || legacyRetail * legacyQty || 0,
            );
            const legacyDiscount = legacyQty > 0 ? legacyDiscountTotal / legacyQty : legacyRetail;

            const hasSameLegacyItem = items.some((item) => (
              item.product_id === legacyProductId
              && item.quantity === legacyQty
              && Math.abs(item.discount_price - legacyDiscount) < 0.01
            ));

            const detailDiscountSum = items.reduce(
              (sum, item) => sum + Number(item.discount_price || 0) * Number(item.quantity || 0),
              0,
            );
            const orderDiscountTotal = Number(row.total_discount_amount || row.total_amount || detailDiscountSum || 0);
            const discountMismatch = Math.abs(detailDiscountSum - orderDiscountTotal) > 0.01;

            if (!hasSameLegacyItem && discountMismatch) {
              const legacyProduct = productMap.get(legacyProductId);
              items.unshift({
                id: `legacy-${orderId}`,
                order_id: orderId,
                product_id: legacyProductId,
                product_name: legacyProduct?.name,
                city_name: legacyProduct?.city || base.city_name,
                quantity: legacyQty,
                retail_price: legacyRetail,
                discount_price: legacyDiscount,
                unit_cost: 0,
                one_time_cost: 0,
              });
            }
          }

          return {
            ...base,
            items,
            refunded_items: refundedItemsFromEvents,
          };
        }

        if (row.product_id && Number(row.quantity || 0) > 0) {
          const { data: legacyProduct } = await supabase
            .from('products')
            .select('name')
            .eq('id', row.product_id)
            .maybeSingle();

          const qty = Number(row.quantity || 0);
          const retailPrice = Number(row.unit_price || 0);
          const discountTotal = Number(row.total_discount_amount || row.total_amount || retailPrice * qty || 0);
          const discountPrice = qty > 0 ? discountTotal / qty : retailPrice;

          return {
            ...base,
            items: [
              {
                id: `legacy-${orderId}`,
                order_id: orderId,
                product_id: row.product_id,
                product_name: legacyProduct?.name,
                city_name: base.city_name,
                quantity: qty,
                retail_price: retailPrice,
                discount_price: discountPrice,
                unit_cost: 0,
                one_time_cost: 0,
              },
            ],
            refunded_items: refundedItemsFromEvents,
          };
        }

        return {
          ...base,
          items: [],
          refunded_items: refundedItemsFromEvents,
        };
      },

      fetchAllData: async () => {
        set({ isLoading: true });
        const sessionError = await get().ensureActiveSession();
        if (sessionError) {
          set({ isLoading: false });
          return;
        }

        const { error: schemaCheckError } = await get().checkSchemaVersion();
        if (schemaCheckError) {
          set({ isLoading: false });
          return;
        }

        await Promise.all([
          get().fetchCities(),
          get().fetchProducts(),
          get().fetchOrders(),
          get().fetchStores(),
          get().fetchNotifications(),
          get().fetchInventoryLogs(),
        ]);
        set({ isLoading: false });
      },

      addStore: async (store) => {
        try {
          const { user } = get();
          if (!user) throw new Error('未登录');
          if (!(user.role === 'admin' || user.role === 'super_admin')) throw new Error('仅管理员可创建店铺');

          const payload = {
            name: store.name.trim(),
            city_id: store.city_id,
            distributor_id: store.distributor_id || null,
            discount_rate: store.discount_rate !== undefined ? Number(store.discount_rate) : 1,
            contact: store.contact?.trim() || null,
            address: store.address?.trim() || null,
            phone: store.phone?.trim() || null,
            status: 'active' as const,
          };

          const { error } = await supabase.from('stores').insert(payload);
          if (error) throw error;

          await get().fetchStores();
          return { error: null };
        } catch (error) {
          return { error: error as Error };
        }
      },

      updateStore: async (id, updates) => {
        try {
          const { user } = get();
          if (!user) throw new Error('未登录');
          if (!(user.role === 'admin' || user.role === 'super_admin')) throw new Error('仅管理员可编辑店铺');

          const payload: Record<string, string | number | null> = {
            updated_at: new Date().toISOString(),
          };

          if (updates.name !== undefined) payload.name = updates.name.trim();
          if (updates.city_id !== undefined) payload.city_id = updates.city_id;
          if (updates.distributor_id !== undefined) payload.distributor_id = updates.distributor_id || null;
          if (updates.discount_rate !== undefined) payload.discount_rate = Number(updates.discount_rate);
          if (updates.contact !== undefined) payload.contact = updates.contact.trim() || null;
          if (updates.address !== undefined) payload.address = updates.address.trim() || null;
          if (updates.phone !== undefined) payload.phone = updates.phone.trim() || null;
          if (updates.status !== undefined) payload.status = updates.status;

          const { error } = await supabase.from('stores').update(payload).eq('id', id);
          if (error) throw error;

          await get().fetchStores();
          return { error: null };
        } catch (error) {
          return { error: error as Error };
        }
      },

      deactivateStore: async (id) => {
        try {
          const { user } = get();
          if (!user) throw new Error('未登录');
          if (!(user.role === 'admin' || user.role === 'super_admin')) throw new Error('仅管理员可停用店铺');

          const { error } = await supabase
            .from('stores')
            .update({ status: 'inactive', updated_at: new Date().toISOString() })
            .eq('id', id);
          if (error) throw error;

          await get().fetchStores();
          return { error: null };
        } catch (error) {
          return { error: error as Error };
        }
      },

      deleteStore: async (id) => {
        try {
          const { user } = get();
          if (!user) throw new Error('未登录');
          if (!(user.role === 'admin' || user.role === 'super_admin')) throw new Error('仅管理员可删除店铺');

          const { error } = await supabase.from('stores').delete().eq('id', id);
          if (error) throw error;

          await get().fetchStores();
          return { error: null };
        } catch (error) {
          return { error: error as Error };
        }
      },

      addProduct: async (payload) => {
        try {
          const { data: createdProduct, error: insertError } = await supabase.from('products').insert({
            name: payload.name,
            price: Number(payload.price),
            cost: Number(payload.cost),
            one_time_cost: Number(payload.one_time_cost || 0),
            discount_price: Number(payload.discount_price),
            city_id: payload.city_id,
            image_url: payload.image_url ?? null,
          }).select('id').single();
          if (insertError) throw insertError;

          const { data: latestBarcodeRow } = await supabase
            .from('products')
            .select('barcode')
            .like('barcode', '200%')
            .order('barcode', { ascending: false })
            .limit(1)
            .maybeSingle();

          const latestBarcode = latestBarcodeRow?.barcode;
          const latestSequence = latestBarcode && /^\d{13}$/.test(latestBarcode)
            ? Number.parseInt(latestBarcode.slice(7, 12), 10)
            : 0;
          const nextSequence = Number.isFinite(latestSequence) ? latestSequence + 1 : 1;
          const barcode = generateEAN13(nextSequence);

          const { error: updateBarcodeError } = await supabase
            .from('products')
            .update({ barcode })
            .eq('id', createdProduct.id);
          if (updateBarcodeError) throw updateBarcodeError;

          await supabase.from('inventory').insert({
            product_id: createdProduct.id,
            quantity: 0,
            min_quantity: 10,
          });

          await get().fetchProducts();
          return { error: null };
        } catch (error) {
          return { error: error as Error };
        }
      },

      updateProduct: async (productId, payload) => {
        try {
          const { error } = await supabase
            .from('products')
            .update({
              name: payload.name,
              price: Number(payload.price),
              cost: Number(payload.cost),
              one_time_cost: Number(payload.one_time_cost || 0),
              discount_price: Number(payload.discount_price),
              city_id: payload.city_id,
              image_url: payload.image_url ?? null,
              updated_at: new Date().toISOString(),
            })
            .eq('id', productId);
          if (error) throw error;

          await get().fetchProducts();
          return { error: null };
        } catch (error) {
          return { error: error as Error };
        }
      },

      setStoreProductPrice: async (storeId, productId, price) => {
        try {
          const { user } = get();
          if (!user) throw new Error('未登录');
          if (!(user.role === 'admin' || user.role === 'super_admin')) throw new Error('仅管理员可设置店铺定价');

          const { error } = await supabase
            .from('store_product_prices')
            .upsert(
              {
                store_id: storeId,
                product_id: productId,
                override_price: Number(price),
                updated_at: new Date().toISOString(),
              },
              { onConflict: 'store_id,product_id' },
            );
          if (error) throw error;

          await get().fetchStoreProductPrices(storeId);
          return { error: null };
        } catch (error) {
          return { error: error as Error };
        }
      },

      updateInventoryByProduct: async (productId, nextQty, options) => {
        try {
          if (nextQty < 0) throw new Error('库存不能为负数');
          const { user, products } = get();
          if (!user) throw new Error('未登录');

          const currentProduct = products.find((item) => item.id === productId);
          const beforeQty = Number(currentProduct?.quantity || 0);

          const { data: existing } = await supabase
            .from('inventory')
            .select('id')
            .eq('product_id', productId)
            .maybeSingle();

          if (existing?.id) {
            const { error } = await supabase
              .from('inventory')
              .update({ quantity: nextQty, updated_at: new Date().toISOString() })
              .eq('product_id', productId);
            if (error) throw error;
          } else {
            const { error } = await supabase
              .from('inventory')
              .insert({ product_id: productId, quantity: nextQty, min_quantity: 10 });
            if (error) throw error;
          }

          const delta = nextQty - beforeQty;
          if (delta !== 0) {
            const { error: logError } = await supabase.from('inventory_logs').insert({
              product_id: productId,
              operator_id: user.id,
              action: options?.action || 'manual_adjust',
              delta_quantity: delta,
              before_quantity: beforeQty,
              after_quantity: nextQty,
              note: options?.note ?? null,
            });
            if (logError) throw logError;
          }

          await Promise.all([get().fetchProducts(), get().fetchInventoryLogs()]);
          return { error: null };
        } catch (error) {
          return { error: error as Error };
        }
      },

      updateStoreInventoryByProduct: async (storeId, productId, nextQty) => {
        try {
          const { user, storeInventory } = get();
          if (!user) throw new Error('未登录');
          if (user.role !== 'super_admin') throw new Error('仅超级管理员可调整店铺池库存');
          if (!storeId) throw new Error('店铺不能为空');
          if (nextQty < 0) throw new Error('库存不能为负数');

          const beforeQty = Number(
            storeInventory.find((item) => item.store_id === storeId && item.product_id === productId)?.quantity || 0,
          );

          const currentItem = storeInventory.find((item) => item.store_id === storeId && item.product_id === productId);
          if (currentItem?.id) {
            const { error } = await supabase
              .from('store_inventory')
              .update({ quantity: nextQty, updated_at: new Date().toISOString() })
              .eq('id', currentItem.id);
            if (error) throw error;
          } else {
            const { error } = await supabase
              .from('store_inventory')
              .insert({ store_id: storeId, product_id: productId, quantity: nextQty });
            if (error) throw error;
          }

          const delta = nextQty - beforeQty;
          if (delta !== 0) {
            const { error: logError } = await supabase.from('inventory_logs').insert({
              product_id: productId,
              operator_id: user.id,
              action: 'manual_adjust',
              delta_quantity: delta,
              before_quantity: beforeQty,
              after_quantity: nextQty,
              note: `店铺池库存调整 store:${storeId}`,
            });
            if (logError) throw logError;
          }

          await Promise.all([get().fetchStoreInventory(storeId), get().fetchInventoryLogs()]);
          return { error: null };
        } catch (error) {
          return { error: error as Error };
        }
      },

      inboundStockByBarcode: async (barcode, quantity) => {
        try {
          const normalized = barcode.trim();
          if (!normalized) throw new Error('条码不能为空');
          if (quantity <= 0) throw new Error('入库数量必须大于 0');

          const product = get().products.find((p) => p.barcode === normalized);
          if (!product) throw new Error('未找到对应条码商品');

          const currentQty = Number(product.quantity || 0);
          const result = await get().updateInventoryByProduct(product.id, currentQty + quantity, {
            action: 'inbound',
            note: `条码入库 ${normalized}`,
          });
          if (result.error) throw result.error;
          return { error: null };
        } catch (error) {
          return { error: error as Error };
        }
      },

      createBatchOrders: async (items, storeId = null) => {
        const { user, products, stores, storeProductPrices } = get();
        if (!user) return { error: new Error('未登录') };
        if (items.length === 0) return { error: new Error('购物车为空') };

        try {
          const selectedStore = storeId
            ? stores.find((store) => store.id === storeId) || null
            : null;

          if (storeId && !selectedStore) {
            throw new Error('店铺不存在或未加载');
          }

          if (selectedStore?.status === 'inactive') {
            throw new Error('店铺已停用');
          }

          if (user.role === 'distributor' && selectedStore?.distributor_id && selectedStore.distributor_id !== user.id) {
            throw new Error('店铺不属于当前分销商');
          }

          const distributorOrderCityId = selectedStore?.city_id ?? user.city_id;

          if (user.role === 'distributor') {
            const outOfCity = items.find((item) => {
              const product = products.find((p) => p.id === item.productId);
              return product && product.city_id !== distributorOrderCityId;
            });
            if (outOfCity) return { error: new Error('分销商只能下所属城市商品') };
          }

          let totalRetail = 0;
          let totalDiscount = 0;
          let totalQuantity = 0;
          let orderCityId: string | undefined = selectedStore?.city_id;

          const orderItemsPayload = items.map((item) => {
            const product = products.find((p) => p.id === item.productId);
            if (!product) throw new Error('商品不存在');
            const isSample = Boolean(item.isSample);
            if (item.quantity <= 0) throw new Error(`${product.name} 数量必须大于0`);
            if (!isSample && item.quantity % 5 !== 0) throw new Error(`${product.name} 数量必须是5的倍数`);

            const available = Number(product.quantity || 0);
            if (available < item.quantity) throw new Error(`${product.name} 库存不足`);

            const retailPrice = Number(product.price || 0);
            const storeOverride = storeId
              ? storeProductPrices.find((entry) => entry.store_id === storeId && entry.product_id === product.id)
              : undefined;
            const discountPrice = resolvePrice({
              price: retailPrice,
              discount_price: product.discount_price,
              discount_rate: selectedStore?.discount_rate,
              override_price: storeOverride?.override_price,
            }).price;
            const unitCost = Number(product.cost || 0);
            const oneTimeCost = Number(product.one_time_cost || 0);

            if (!isSample) {
              totalRetail += retailPrice * item.quantity;
              totalDiscount += discountPrice * item.quantity;
            }
            totalQuantity += item.quantity;
            orderCityId = product.city_id;

            return {
              product_id: product.id,
              quantity: item.quantity,
              retail_price: isSample ? 0 : retailPrice,
              discount_price: isSample ? 0 : discountPrice,
              unit_cost: unitCost,
              one_time_cost: oneTimeCost,
              is_sample: isSample,
            };
          });

          const requestId = createRequestId(user.id);
          const { error: rpcError } = await supabase.rpc('create_batch_order_atomic', {
            p_items: orderItemsPayload,
            p_request_id: requestId,
            p_store_id: storeId,
          });

          if (!rpcError) {
            const refreshTasks: Array<Promise<void>> = [
              get().fetchOrders(),
              get().fetchProducts(),
              get().fetchNotifications(),
            ];
            if (storeId) {
              refreshTasks.push(get().fetchStoreInventory(storeId));
            }
            await Promise.all(refreshTasks);
            return { error: null };
          }

          if (!shouldFallbackToLegacyFlow(rpcError as RpcErrorLike)) {
            throw rpcError;
          }

          const baseOrderPayload = {
            distributor_id: user.id,
            city_id: selectedStore?.city_id ?? user.city_id ?? orderCityId,
            store_id: storeId,
            total_retail_amount: totalRetail,
            total_discount_amount: totalDiscount,
            quantity: totalQuantity,
            order_kind: 'distribution' as const,
          };

          let orderInsert = await supabase
            .from('orders')
            .insert(baseOrderPayload)
            .select('id')
            .single();

          if (orderInsert.error && orderItemsPayload.length > 0) {
            const message = String(orderInsert.error.message || '').toLowerCase();
            const details = String((orderInsert.error as { details?: string }).details || '').toLowerCase();
            const combined = `${message} ${details}`;
            const legacyColumnHit =
              combined.includes('column "quantity"')
              || combined.includes('column "unit_price"')
              || combined.includes('column "product_id"')
              || combined.includes('column "total_amount"')
              || combined.includes('column "total-amount"')
              || combined.includes('column quantity')
              || combined.includes('column unit_price')
              || combined.includes('column product_id')
              || combined.includes('column total_amount')
              || combined.includes('column total-amount');
            const onOrdersTable = combined.includes('relation "orders"') || combined.includes('table "orders"');
            const legacyConstraintHit = orderInsert.error.code === '23502' && legacyColumnHit && onOrdersTable;

            if (legacyConstraintHit) {
              const primaryItem = orderItemsPayload[0];
              const legacyOrderPayload = {
                ...baseOrderPayload,
                product_id: primaryItem.product_id,
                quantity: primaryItem.quantity,
                unit_price: primaryItem.retail_price,
                total_amount: totalDiscount,
              };

              orderInsert = await supabase
                .from('orders')
                .insert(legacyOrderPayload)
                .select('id')
                .single();

              if (orderInsert.error) {
                const retryMessage = String(orderInsert.error.message || '').toLowerCase();
                const retryDetails = String((orderInsert.error as { details?: string }).details || '').toLowerCase();
                const retryCombined = `${retryMessage} ${retryDetails}`;
                const legacyDashTotalAmountHit =
                  orderInsert.error.code === '23502'
                  && (retryCombined.includes('column "total-amount"') || retryCombined.includes('column total-amount'))
                  && (retryCombined.includes('relation "orders"') || retryCombined.includes('table "orders"'));

                if (legacyDashTotalAmountHit) {
                  const legacyDashPayloadBase = {
                    distributor_id: legacyOrderPayload.distributor_id,
                    city_id: legacyOrderPayload.city_id,
                    total_retail_amount: legacyOrderPayload.total_retail_amount,
                    total_discount_amount: legacyOrderPayload.total_discount_amount,
                    product_id: legacyOrderPayload.product_id,
                    quantity: legacyOrderPayload.quantity,
                    unit_price: legacyOrderPayload.unit_price,
                  };
                  orderInsert = await supabase
                    .from('orders')
                    .insert({
                      ...legacyDashPayloadBase,
                      'total-amount': totalDiscount,
                    })
                    .select('id')
                    .single();
                }
              }
            }
          }

          const { data: orderData, error: orderError } = orderInsert;
          if (orderError) throw orderError;

          const { error: itemError } = await supabase
            .from('order_items')
            .insert(orderItemsPayload.map((item) => ({ ...item, order_id: orderData.id })));
          if (itemError) throw itemError;

          for (const item of items) {
            const product = products.find((p) => p.id === item.productId);
            if (!product) continue;

            const nextQty = Number(product.quantity || 0) - item.quantity;
            const { error: inventoryError } = await supabase
              .from('inventory')
              .update({ quantity: nextQty, updated_at: new Date().toISOString() })
              .eq('product_id', product.id);
            if (inventoryError) throw inventoryError;
          }

          if (storeId) {
            const storeInventoryPayload = orderItemsPayload
              .filter((item) => !item.is_sample)
              .reduce<Array<{ store_id: string; product_id: string; quantity: number; updated_at: string }>>((acc, item) => {
                const existing = acc.find((entry) => entry.product_id === item.product_id);
                if (existing) {
                  existing.quantity += item.quantity;
                  return acc;
                }

                acc.push({
                  store_id: storeId,
                  product_id: item.product_id,
                  quantity: item.quantity,
                  updated_at: new Date().toISOString(),
                });
                return acc;
              }, []);

            if (storeInventoryPayload.length > 0) {
              const { data: existingStoreInventory, error: existingStoreInventoryError } = await supabase
                .from('store_inventory')
                .select('product_id, quantity')
                .eq('store_id', storeId)
                .in('product_id', storeInventoryPayload.map((entry) => entry.product_id));
              if (existingStoreInventoryError) throw existingStoreInventoryError;

              const existingQuantityMap = new Map(
                (existingStoreInventory || []).map((row) => [row.product_id as string, Number(row.quantity || 0)]),
              );

              const { error: storeInventoryError } = await supabase
                .from('store_inventory')
                .upsert(
                  storeInventoryPayload.map((entry) => ({
                    ...entry,
                    quantity: (existingQuantityMap.get(entry.product_id) || 0) + entry.quantity,
                  })),
                  { onConflict: 'store_id,product_id' },
                );
              if (storeInventoryError) throw storeInventoryError;
            }
          }

          const { data: admins } = await supabase.from('profiles').select('id').in('role', ['admin', 'super_admin']);
          if (admins && admins.length > 0) {
            const notifications = admins.map((admin: { id: string }) => ({
              user_id: admin.id,
              type: 'new_order' as const,
              order_id: orderData.id,
              message: `新订单 #${orderData.id.slice(0, 8)} 来自 ${selectedStore?.name || user.store_name || user.email}`,
            }));
            await supabase.from('notifications').insert(notifications);
          }

          const refreshTasks: Array<Promise<void>> = [
            get().fetchOrders(),
            get().fetchProducts(),
            get().fetchNotifications(),
          ];
          if (storeId) {
            refreshTasks.push(get().fetchStoreInventory(storeId));
          }
          await Promise.all(refreshTasks);
          return { error: null };
        } catch (error) {
          return { error: error as Error };
        }
      },

      createRetailOrders: async (items: CashierCreateItem[]) => {
        const { user, products } = get();
        if (!user) return { error: new Error('未登录') };
        if (items.length === 0) return { error: new Error('购物车为空') };
        if (!(user.role === 'admin' || user.role === 'super_admin' || user.role === 'inventory_manager')) {
          return { error: new Error('当前角色无收款建单权限') };
        }

        // Resolve 云窗 store robustly: fetch if stale/empty, error if unresolvable
        let stores = get().stores;
        if (!stores.find((s) => s.name === '云窗' && s.status === 'active')) {
          await get().fetchStores();
          stores = get().stores;
        }
        const yunChuangStore = stores.find((s) => s.name === '云窗' && s.status === 'active') || null;
        if (!yunChuangStore) {
          return { error: new Error('未找到云窗店铺，请确认店铺数据已初始化') };
        }

        try {
          let orderCityId: string | undefined;
          const retailTotalLines: Array<{ product: ProductWithDetails; quantity: number }> = [];
          let totalQuantity = 0;

          const orderItemsPayload = items.map((item) => {
            const product = products.find((p) => p.id === item.productId);
            if (!product) throw new Error('商品不存在');
            if (item.quantity <= 0) throw new Error(`${product.name} 数量必须大于 0`);

            const available = Number(product.quantity || 0);
            if (available < item.quantity) throw new Error(`${product.name} 库存不足`);

            const retailPrice = getRetailUnitPrice(product);
            const unitCost = Number(product.cost || 0);
            const oneTimeCost = Number(product.one_time_cost || 0);
            orderCityId = product.city_id;
            retailTotalLines.push({ product, quantity: item.quantity });
            totalQuantity += item.quantity;

            return {
              product_id: product.id,
              quantity: item.quantity,
              retail_price: retailPrice,
              discount_price: retailPrice,
              unit_cost: unitCost,
              one_time_cost: oneTimeCost,
            };
          });

          const retailTotals = calculateRetailOrderTotals(retailTotalLines);

          const requestId = createRequestId(user.id);
          const retailRpcPayload = orderItemsPayload.map((item) => ({
            product_id: item.product_id,
            quantity: item.quantity,
            retail_price: item.retail_price,
            unit_cost: item.unit_cost,
            one_time_cost: item.one_time_cost,
          }));
          const { data: rpcOrderId, error: rpcError } = await supabase.rpc('create_retail_order_atomic', {
            p_items: retailRpcPayload,
            p_request_id: requestId,
            p_store_id: yunChuangStore.id,
          });

          if (!rpcError) {
            void Promise.all([get().fetchOrders(), get().fetchProducts(), get().fetchNotifications()]);
            return { orderId: rpcOrderId ? String(rpcOrderId) : undefined, error: null };
          }

          if (!shouldFallbackToLegacyFlow(rpcError as RpcErrorLike)) {
            const message = String((rpcError as RpcErrorLike).message || '');
            if (message.includes('当前角色无收款建单权限')) {
              throw new Error('当前数据库函数未开放收款建单权限，请先执行最新迁移');
            }
            throw rpcError;
          }

          const baseOrderPayload = {
            distributor_id: user.id,
            city_id: user.city_id ?? orderCityId,
            store_id: yunChuangStore.id,
            total_retail_amount: retailTotals.totalRetail,
            total_discount_amount: retailTotals.totalDiscount,
            quantity: totalQuantity,
            order_kind: 'retail' as const,
            status: 'accepted' as const,
          };

          let orderInsert = await supabase
            .from('orders')
            .insert(baseOrderPayload)
            .select('id')
            .single();

          if (orderInsert.error && orderItemsPayload.length > 0) {
            const message = String(orderInsert.error.message || '').toLowerCase();
            const details = String((orderInsert.error as { details?: string }).details || '').toLowerCase();
            const combined = `${message} ${details}`;
            const legacyColumnHit =
              combined.includes('column "quantity"')
              || combined.includes('column "unit_price"')
              || combined.includes('column "product_id"')
              || combined.includes('column "total_amount"')
              || combined.includes('column "total-amount"')
              || combined.includes('column quantity')
              || combined.includes('column unit_price')
              || combined.includes('column product_id')
              || combined.includes('column total_amount')
              || combined.includes('column total-amount');
            const onOrdersTable = combined.includes('relation "orders"') || combined.includes('table "orders"');
            const legacyConstraintHit = orderInsert.error.code === '23502' && legacyColumnHit && onOrdersTable;

            if (legacyConstraintHit) {
              const primaryItem = orderItemsPayload[0];
              const legacyOrderPayload = {
                ...baseOrderPayload,
                product_id: primaryItem.product_id,
                quantity: primaryItem.quantity,
                unit_price: primaryItem.retail_price,
                total_amount: retailTotals.totalDiscount,
              };

              orderInsert = await supabase
                .from('orders')
                .insert(legacyOrderPayload)
                .select('id')
                .single();

              if (orderInsert.error) {
                const retryMessage = String(orderInsert.error.message || '').toLowerCase();
                const retryDetails = String((orderInsert.error as { details?: string }).details || '').toLowerCase();
                const retryCombined = `${retryMessage} ${retryDetails}`;
                const legacyDashTotalAmountHit =
                  orderInsert.error.code === '23502'
                  && (retryCombined.includes('column "total-amount"') || retryCombined.includes('column total-amount'))
                  && (retryCombined.includes('relation "orders"') || retryCombined.includes('table "orders"'));

                if (legacyDashTotalAmountHit) {
                  const legacyDashPayloadBase = {
                    distributor_id: legacyOrderPayload.distributor_id,
                    city_id: legacyOrderPayload.city_id,
                    total_retail_amount: legacyOrderPayload.total_retail_amount,
                    total_discount_amount: legacyOrderPayload.total_discount_amount,
                    product_id: legacyOrderPayload.product_id,
                    quantity: legacyOrderPayload.quantity,
                    unit_price: legacyOrderPayload.unit_price,
                  };
                  orderInsert = await supabase
                    .from('orders')
                    .insert({
                      ...legacyDashPayloadBase,
                      'total-amount': retailTotals.totalDiscount,
                    })
                    .select('id')
                    .single();
                }
              }
            }
          }

          const { data: orderData, error: orderError } = orderInsert;
          if (orderError) throw orderError;

          const { error: itemError } = await supabase
            .from('order_items')
            .insert(orderItemsPayload.map((item) => ({ ...item, order_id: orderData.id })));
          if (itemError) throw itemError;

          const inventoryDeltas = items.reduce((map, item) => {
            const current = map.get(item.productId) || 0;
            map.set(item.productId, current + item.quantity);
            return map;
          }, new Map<string, number>());

          await Promise.all(Array.from(inventoryDeltas.entries()).map(async ([productId, deltaQty]) => {
            const product = products.find((p) => p.id === productId);
            if (!product) return;
            const nextQty = Number(product.quantity || 0) - deltaQty;
            const { error: inventoryError } = await supabase
              .from('inventory')
              .update({ quantity: nextQty, updated_at: new Date().toISOString() })
              .eq('product_id', product.id);
            if (inventoryError) throw inventoryError;
          }));

          void Promise.all([get().fetchOrders(), get().fetchProducts(), get().fetchNotifications()]);
          return { orderId: orderData.id, error: null };
        } catch (error) {
          return { error: error as Error };
        }
      },

      acceptOrder: async (orderId) => {
        try {
          const { error } = await supabase.from('orders').update({ status: 'accepted' }).eq('id', orderId);
          if (error) throw error;
          await Promise.all([get().fetchOrders(), get().fetchNotifications()]);
          return { error: null };
        } catch (error) {
          return { error: error as Error };
        }
      },
      modifyDistributionOrder: async (orderId, items) => {
        try {
          const { error } = await supabase.rpc('modify_distribution_order_atomic', {
            p_order_id: orderId,
            p_items: items,
          });
          if (error) throw error;

          await Promise.all([get().fetchOrders(), get().fetchProducts()]);
          return { error: null };
        } catch (error) {
          return { error: error as Error };
        }
      },

      deleteOrder: async (orderId) => {
        try {
          const { error } = await supabase.rpc('delete_order_with_inventory_restore_atomic', {
            p_order_id: orderId,
          });
          if (error) throw error;

          await Promise.all([get().fetchOrders(), get().fetchProducts()]);
          return { error: null };
        } catch (error) {
          return { error: error as Error };
        }
      },

      updateOwnProfile: async (payload) => {
        try {
          const { user } = get();
          if (!user) throw new Error('未登录');

          const updatePayload: Record<string, string> = {
            updated_at: new Date().toISOString(),
          };
          if (payload.full_name !== undefined) updatePayload.full_name = payload.full_name.trim();
          if (payload.store_name !== undefined) updatePayload.store_name = payload.store_name.trim();

          const { error } = await supabase.from('profiles').update(updatePayload).eq('id', user.id);
          if (error) throw error;

          set({
            user: {
              ...user,
              full_name: payload.full_name !== undefined ? payload.full_name.trim() : user.full_name,
              store_name: payload.store_name !== undefined ? payload.store_name.trim() : user.store_name,
              updated_at: updatePayload.updated_at,
            },
          });
          return { error: null };
        } catch (error) {
          return { error: error as Error };
        }
      },

      updateOwnStoreName: async (storeName) => {
        return get().updateOwnProfile({ store_name: storeName });
      },

      updateOwnAvatar: async (avatarUrl) => {
        try {
          const { user } = get();
          if (!user) throw new Error('未登录');

          const updateAt = new Date().toISOString();
          const { error } = await supabase
            .from('profiles')
            .update({ avatar_url: avatarUrl, updated_at: updateAt })
            .eq('id', user.id);
          if (error) throw error;

          set({
            user: {
              ...user,
              avatar_url: avatarUrl,
              updated_at: updateAt,
            },
          });

          return { error: null };
        } catch (error) {
          return { error: error as Error };
        }
      },

      markNotificationRead: async (notificationId) => {
        await supabase.from('notifications').update({ is_read: true }).eq('id', notificationId);
        await get().fetchNotifications();
      },

      markAllNotificationsRead: async () => {
        const { user, notifications } = get();
        if (!user) return;
        const unreadIds = notifications.filter((n) => !n.is_read).map((n) => n.id);
        if (unreadIds.length === 0) return;
        await supabase.from('notifications').update({ is_read: true }).in('id', unreadIds);
        await get().fetchNotifications();
      },
    }),
    {
      name: 'inventory-web-storage',
      partialize: (state) => ({ user: state.user }),
    },
  ),
);
