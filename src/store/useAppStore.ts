import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '../lib/supabase';
import { generateEAN13 } from '../utils/barcode';
import { applyOrdersDateFilters } from '../utils/fetchOrdersDateParams';
import { resolvePrice } from '../utils/priceResolver';
import { buildStoreRetailOrderRpcItems } from '../utils/storeRetailOrder';
import { getProvinceForCity } from '../utils/provinceMapping';
import type {
  Profile,
  City,
  Product,
  Inventory,
  Order,
  OrderItem,
  OrderKind,
  ProductWithDetails,
  Notification,
  Store,
  StoreInventory,
  StoreProductPrice,
} from '../types';

interface CartCreateItem {
  productId: string;
  quantity: number;
  isSample?: boolean;
}

interface StoreRetailCreateItem {
  product_id: string;
  quantity: number;
  price: number;
}

interface PurchaseOrderCreateItem {
  store_id: string;
  city_id: string;
  products: Array<{ product_id: string; quantity: number }>;
}

interface ProfileRow {
  id: string;
  email: string;
  full_name?: string;
  avatar_url?: string | null;
  active_session_id?: string | null;
  role: Profile['role'];
  city_id?: string | null;
  default_store_id?: string | null;
  cities?: { name: string } | null;
  store_name?: string | null;
  created_at: string;
  updated_at: string;
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
  products?: {
    name?: string;
    city_id?: string;
    cities?: { name: string } | null;
  } | null;
}

interface OrderRow {
  id: string;
  distributor_id: string;
  profiles?: { email?: string; store_name?: string | null } | Array<{ email?: string; store_name?: string | null }> | null;
  store_id?: string | null;
  stores?: { name?: string | null } | Array<{ name?: string | null }> | null;
  city_id?: string | null;
  cities?: { name: string } | Array<{ name: string }> | null;
  status?: Order['status'];
  order_kind?: Order['order_kind'] | null;
  payment_method?: Order['payment_method'];
  payment_status?: Order['payment_status'];
  payment_transaction_id?: string | null;
  payment_amount?: number | string | null;
  payment_paid_at?: string | null;
  payment_note?: string | null;
  total_retail_amount?: number | string | null;
  total_discount_amount?: number | string | null;
  created_at: string;
  order_items?: OrderItemRow[];
}

interface ProductRow {
  id: string;
  name: string;
  price?: number | string | null;
  cost?: number | string | null;
  one_time_cost?: number | string | null;
  discount_price?: number | string | null;
  city_id: string;
  sku?: string | null;
  category?: string | null;
  image_url?: string | null;
  barcode?: string | null;
  created_at: string;
  updated_at: string;
  cities?: { name: string } | null;
  inventory?: Array<{ quantity?: number | null; min_quantity?: number | null }>;
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
  settlement_day?: number | null;
  cooperation_mode?: Store['cooperation_mode'] | null;
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
  min_quantity?: number | string | null;
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

interface DistributorProductPriceRow {
  product_id: string;
  discount_price: number | string;
}

interface StoreCreateInput {
  name: string;
  city_id: string;
  distributor_id?: string | null;
  discount_rate?: number;
  contact?: string;
  address?: string;
  phone?: string;
  settlement_day?: number | null;
  cooperation_mode?: Store['cooperation_mode'] | null;
}

interface StoreUpdateInput {
  name?: string;
  city_id?: string;
  distributor_id?: string | null;
  discount_rate?: number;
  contact?: string;
  address?: string;
  phone?: string;
  settlement_day?: number | null;
  cooperation_mode?: Store['cooperation_mode'] | null;
  status?: Store['status'];
}

interface RpcErrorLike {
  code?: string;
  message?: string;
}

interface DetailedErrorLike {
  code?: string;
  message?: string;
  details?: string;
  hint?: string;
}

interface AuthUserLike {
  id: string;
  email?: string | null;
  user_metadata?: Record<string, unknown> | null;
}

const SESSION_GRACE_WINDOW_MS = 20_000;
const SESSION_RETRY_DELAY_MS = 600;
const SESSION_RETRY_TIMES = 2;
const UUID_LIKE_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const unpaidRetailAutoDeleteMs = 30 * 60 * 1000;
const paidRetailStatuses = new Set(['paid', 'partial_refunded', 'refunded']);
const unpaidRetailStatuses = new Set(['', 'pending', 'unpaid', 'failed', 'timeout', 'closed', 'cancelled']);

let sessionGuardGraceUntil = 0;

const isUuidLike = (value: string): boolean => UUID_LIKE_REGEX.test(value);

const normalizeError = (error: unknown): Error => {
  if (error instanceof Error) return error;
  return new Error(typeof error === 'string' ? error : '未知错误');
};

const formatSupabaseError = (error: unknown): Error => {
  const fallbackError = normalizeError(error);
  const raw = error as DetailedErrorLike | null;
  const message = raw?.message ?? fallbackError.message;
  const code = raw?.code ? ` [${raw.code}]` : '';
  const details = raw?.details ? ` ${raw.details}` : '';
  const hint = raw?.hint ? ` 提示: ${raw.hint}` : '';
  return new Error(`${message}${code}${details}${hint}`.trim());
};

const ensureProfileForAuthUser = async (authUser: AuthUserLike): Promise<ProfileRow> => {
  const { data: existingProfile, error: existingError } = await supabase
    .from('profiles')
    .select('*, cities(name)')
    .eq('id', authUser.id)
    .maybeSingle();

  if (existingError) throw formatSupabaseError(existingError);
  if (existingProfile) return existingProfile;

  const metadata = authUser.user_metadata || {};
  const cityIdRaw = typeof metadata.city_id === 'string' ? metadata.city_id.trim() : '';
  const storeNameRaw = typeof metadata.store_name === 'string' ? metadata.store_name.trim() : null;

  if (!isUuidLike(cityIdRaw)) {
    throw new Error('账号资料不完整（缺少城市），无法自动创建档案。请联系管理员处理该账号。');
  }

  const { data: insertedProfile, error: insertError } = await supabase
    .from('profiles')
    .insert({
      id: authUser.id,
      email: authUser.email || '',
      role: 'distributor',
      city_id: cityIdRaw,
    store_name: storeNameRaw || null,
    })
    .select('*, cities(name)')
    .single();

  if (insertError) throw formatSupabaseError(insertError);
  return insertedProfile;
};

const setSessionGuardGraceWindow = (): void => {
  sessionGuardGraceUntil = Date.now() + SESSION_GRACE_WINDOW_MS;
};

const isWithinSessionGuardGraceWindow = (): boolean => Date.now() <= sessionGuardGraceUntil;

const waitMs = async (ms: number): Promise<void> => {
  await new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
};

const createRequestId = (prefix: 'batch' | 'outbound', userId: string): string => {
  const randomPart = Math.random().toString(36).slice(2, 10);
  return `${prefix}-${userId}-${Date.now()}-${randomPart}`;
};

const coalesceOrderKind = (kind: OrderRow['order_kind']): OrderKind => (
  kind === 'retail' ? 'retail' :
  kind === 'settlement' ? 'settlement' :
  kind === 'purchase' ? 'purchase' :
  'distribution'
);

const shouldAutoDeleteStaleRetailOrder = (row: Pick<OrderRow, 'order_kind' | 'payment_status' | 'created_at'>): boolean => {
  if (coalesceOrderKind(row.order_kind) !== 'retail') return false;

  const paymentStatus = String(row.payment_status || '').toLowerCase();
  if (paidRetailStatuses.has(paymentStatus)) return false;
  if (!unpaidRetailStatuses.has(paymentStatus)) return false;

  const createdAtMs = new Date(row.created_at).getTime();
  if (!Number.isFinite(createdAtMs)) return false;

  return Date.now() - createdAtMs >= unpaidRetailAutoDeleteMs;
};

const shouldFallbackToLegacyFlow = (
  error: RpcErrorLike | null,
  rpcName: 'create_batch_order_atomic' | 'create_settlement_order_atomic' | 'outbound_stock_atomic',
): boolean => {
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

  if (rpcName === 'create_batch_order_atomic') {
    return message.includes('could not find the function public.create_batch_order_atomic');
  }

  if (rpcName === 'create_settlement_order_atomic') {
    return message.includes('could not find the function public.create_settlement_order_atomic');
  }

  return message.includes('could not find the function public.outbound_stock_atomic');
};

const isMissingRpcFunction = (error: RpcErrorLike | null): boolean => {
  if (!error) return false;
  const message = String(error.message || '').toLowerCase();
  return error.code === '42883'
    || error.code === 'PGRST202'
    || message.includes('could not find the function');
};

interface AppState {
  user: Profile | null;
  cities: City[];
  products: ProductWithDetails[];
  inventory: Inventory[];
  orders: Order[];
  distributors: Profile[];
  stores: Store[];
  storeInventory: StoreInventory[];
  storeProductPrices: StoreProductPrice[];
  notifications: Notification[];
  isLoading: boolean;
  isOfflineMode: boolean;
  isDarkMode: boolean;

  setUser: (user: Profile | null) => void;
  setLoading: (loading: boolean) => void;
  setOfflineMode: (offline: boolean) => void;
  setDarkMode: (darkMode: boolean) => void;
  ensureActiveSession: () => Promise<Error | null>;

  signIn: (email: string, password: string) => Promise<{ error: Error | null }>;
  signUp: (
    email: string,
    password: string,
    role?: string,
    cityId?: string,
  ) => Promise<{ error: Error | null }>;
  signOut: () => Promise<void>;

  fetchCities: () => Promise<void>;
  moveCityOrder: (cityId: string, direction: 'up' | 'down') => Promise<{ error: Error | null }>;
  fetchProducts: () => Promise<void>;
  fetchInventory: () => Promise<void>;
  fetchOrders: (startDate?: string, endDate?: string) => Promise<void>;
  fetchDistributors: () => Promise<void>;
  fetchStores: () => Promise<void>;
  fetchOwnedStores: () => Promise<Store[]>;
  setDefaultStore: (storeId: string) => Promise<{ error: Error | null }>;
  fetchStoreInventory: (storeId: string) => Promise<void>;
  fetchAllStoreInventory: () => Promise<void>;
  fetchStoreProductPrices: (storeId: string) => Promise<void>;
  fetchAllData: () => Promise<void>;
  generateCityChannelReport: () => CityChannelReportRow[];
  generateProductDetailReport: () => ProductDetailReportRow[];
  generatePaymentReport: () => PaymentReportRow[];

  addCity: (name: string) => Promise<{ error: Error | null }>;
  deleteCity: (id: string) => Promise<{ error: Error | null }>;
  addStore: (store: StoreCreateInput) => Promise<{ error: Error | null }>;
  updateStore: (id: string, updates: StoreUpdateInput) => Promise<{ error: Error | null }>;
  deactivateStore: (id: string) => Promise<{ error: Error | null }>;
  deleteStore: (id: string) => Promise<{ error: Error | null }>;
  updateDistributorProfile: (id: string, cityId: string, storeName?: string) => Promise<{ error: Error | null }>;
  updateOwnStoreName: (storeName: string) => Promise<{ error: Error | null }>;
  updateOwnAvatar: (avatarUrl: string) => Promise<{ error: Error | null }>;
  fetchNotifications: () => Promise<void>;
  acceptOrder: (orderId: string) => Promise<{ error: Error | null }>;
  markNotificationRead: (notificationId: string) => Promise<void>;
  markAllNotificationsRead: () => Promise<void>;

  addProduct: (product: Omit<Product, 'id' | 'created_at' | 'updated_at'>) => Promise<{ error: Error | null }>;
  updateProduct: (id: string, updates: Partial<Product>) => Promise<{ error: Error | null }>;
  deleteProduct: (id: string) => Promise<{ error: Error | null }>;
  setDistributorProductDiscount: (
    distributorId: string,
    productId: string,
    discountPrice: number,
  ) => Promise<{ error: Error | null }>;
  setStoreProductPrice: (storeId: string, productId: string, price: number) => Promise<{ error: Error | null }>;

  updateInventory: (
    productId: string,
    quantity: number,
    options?: { skipRefresh?: boolean },
  ) => Promise<{ error: Error | null }>;
  updateStoreInventory: (
    storeId: string,
    productId: string,
    quantity: number,
    options?: { skipRefresh?: boolean },
  ) => Promise<{ error: Error | null }>;
  updateInventorySettings: (
    productId: string,
    quantity: number,
    minQuantity: number,
  ) => Promise<{ error: Error | null }>;
  findProductByBarcode: (barcode: string) => ProductWithDetails | undefined;
  inboundStock: (barcode: string, quantity: number) => Promise<{ error: Error | null }>;
  outboundStock: (barcode: string, quantity: number) => Promise<{ error: Error | null }>;

  backfillBarcodes: () => Promise<{ count: number; error: Error | null }>;

  createStoreRetailOrder: (
    storeId: string,
    items: StoreRetailCreateItem[],
  ) => Promise<{ error: Error | null }>;
  createSettlementOrder: (
    storeId: string,
    items: StoreRetailCreateItem[],
  ) => Promise<{ error: Error | null }>;
  createPurchaseOrder: (items: PurchaseOrderCreateItem[]) => Promise<{ error: Error | null }>;
  confirmPurchaseDelivery: (orderId: string) => Promise<{ error: Error | null }>;
  fetchPurchaseOrders: () => Promise<void>;
  createBatchOrders: (items: CartCreateItem[], storeId?: string | null) => Promise<{ error: Error | null }>;
  modifyDistributionOrder: (orderId: string, items: { order_item_id: string; new_quantity: number }[]) => Promise<{ error: Error | null }>;
  deleteOrder: (orderId: string) => Promise<{ error: Error | null }>;
  uploadProductImage: (uri: string) => Promise<{ publicUrl: string | null; error: Error | null }>;
}

const pickFirstRelation = <T>(value: T | T[] | null | undefined): T | null => {
  if (!value) return null;
  return Array.isArray(value) ? value[0] ?? null : value;
};

const mapProfile = (raw: ProfileRow): Profile => ({
  id: raw.id,
  email: raw.email,
  full_name: raw.full_name,
  avatar_url: raw.avatar_url ?? undefined,
  role: raw.email === '2330605169@qq.com' ? 'super_admin' : raw.role,
  city_id: raw.city_id,
  city_name: raw.cities?.name,
  default_store_id: raw.default_store_id ?? null,
  store_name: raw.store_name,
  created_at: raw.created_at,
  updated_at: raw.updated_at,
});

const mapStore = (raw: StoreRow): Store => {
  const cityData = pickFirstRelation(raw.cities);
  const distributorData = pickFirstRelation(raw.profiles);

  return {
    id: raw.id,
    name: raw.name,
    city_id: raw.city_id,
    city_name: cityData?.name,
    distributor_id: raw.distributor_id ?? null,
    distributor_email: distributorData?.email ?? null,
    discount_rate: Number(raw.discount_rate ?? 1),
    contact: raw.contact ?? undefined,
    address: raw.address ?? undefined,
    phone: raw.phone ?? undefined,
    settlement_day: raw.settlement_day ?? null,
    cooperation_mode: raw.cooperation_mode ?? null,
    status: raw.status || 'active',
    created_at: raw.created_at,
    updated_at: raw.updated_at,
  };
};

const mapStoreInventory = (raw: StoreInventoryRow): StoreInventory => {
  const productData = pickFirstRelation(raw.products);

  return {
    id: raw.id,
    store_id: raw.store_id,
    product_id: raw.product_id,
    product_name: productData?.name,
    quantity: Number(raw.quantity || 0),
    min_quantity: raw.min_quantity === null || raw.min_quantity === undefined
      ? undefined
      : Number(raw.min_quantity),
    updated_at: raw.updated_at,
  };
};

const mapStoreProductPrice = (raw: StoreProductPriceRow): StoreProductPrice => ({
  id: raw.id,
  store_id: raw.store_id,
  product_id: raw.product_id,
  override_price: Number(raw.override_price || 0),
  created_at: raw.created_at,
  updated_at: raw.updated_at,
});

const mapOrder = (raw: OrderRow): Order => {
  const profileData = pickFirstRelation(raw.profiles);
  const cityData = pickFirstRelation(raw.cities);
  const storeData = pickFirstRelation(raw.stores);
  const items: OrderItem[] = (raw.order_items || []).map((it) => ({
    id: it.id,
    order_id: it.order_id,
    product_id: it.product_id,
    product_name: it.products?.name,
    city_name: it.products?.cities?.name,
    is_sample: Boolean(it.is_sample),
    quantity: it.quantity,
    retail_price: Number(it.retail_price || 0),
    discount_price: Number(it.discount_price || 0),
    unit_cost: Number(it.unit_cost || 0),
    one_time_cost: Number(it.one_time_cost || 0),
  }));

  return {
    id: raw.id,
    distributor_id: raw.distributor_id,
    distributor_email: profileData?.email,
    distributor_store: profileData?.store_name ?? undefined,
    store_id: raw.store_id ?? null,
    store_name: storeData?.name ?? null,
    city_id: raw.city_id ?? undefined,
    city_name: cityData?.name,
    status: raw.status || 'pending',
    order_kind: coalesceOrderKind(raw.order_kind),
    payment_method: raw.payment_method ?? null,
    payment_status: raw.payment_status ?? null,
    payment_transaction_id: raw.payment_transaction_id ?? null,
    payment_amount: raw.payment_amount == null ? null : Number(raw.payment_amount),
    payment_paid_at: raw.payment_paid_at ?? null,
    payment_note: raw.payment_note ?? null,
    total_retail_amount: Number(raw.total_retail_amount || 0),
    total_discount_amount: Number(raw.total_discount_amount || 0),
    created_at: raw.created_at,
    items,
  };
};

export interface CityChannelReportRow {
  序号: number;
  城市: string;
  城市分级: string;
  渠道门店名称: string;
  合作模式: string;
  月总销售件数: number;
  上月同期销量: number;
  环比增长率: string;
  供货营收: number;
  库存总货值: number;
  sku动销率: string;
  结算账期: number | null;
}

export interface ProductDetailReportRow {
  序号: number;
  城市: string;
  渠道门店: string;
  SKU编号: string;
  产品名称: string;
  品类: string;
  单位成本: number;
  供货价: number;
  终端售价: number;
  当前实物库存: number;
  预留库存: string;
  总可用库存: number;
  安全库存阈值: number;
  本月销量: number;
  上月销量: number;
  库存周转天数: number;
  滞销标记: string;
  单品毛利: number;
}

export interface PaymentReportRow {
  序号: number;
  城市渠道: string;
  对账周期: string;
  应收货款: number;
  已回款金额: null;
  未结欠款: number;
  逾期天数: number;
  渠道扣点费用: null;
  实际毛利额: null;
  回款状态: string;
}

interface BusinessReportInput {
  orders: Order[];
  stores: Store[];
  products: ProductWithDetails[];
  storeInventory: StoreInventory[];
  now?: Date;
}

const isSameMonth = (input: string, year: number, monthIndex: number): boolean => {
  const date = new Date(input);
  if (Number.isNaN(date.getTime())) return false;
  return date.getFullYear() === year && date.getMonth() === monthIndex;
};

const getMonthContext = (now: Date): {
  year: number;
  monthIndex: number;
  prevYear: number;
  prevMonthIndex: number;
  period: string;
} => {
  const year = now.getFullYear();
  const monthIndex = now.getMonth();
  const prevDate = new Date(year, monthIndex - 1, 1);
  return {
    year,
    monthIndex,
    prevYear: prevDate.getFullYear(),
    prevMonthIndex: prevDate.getMonth(),
    period: `${year}-${String(monthIndex + 1).padStart(2, '0')}`,
  };
};

const round2 = (value: number): number => Number(value.toFixed(2));

const calculateStoreOverdueDays = (settlementDay: number | null | undefined, now: Date): number => {
  if (!settlementDay || settlementDay <= 0) return 0;
  const dueDate = new Date(now.getFullYear(), now.getMonth(), settlementDay);
  const diffMs = now.getTime() - dueDate.getTime();
  if (diffMs <= 0) return 0;
  return Math.floor(diffMs / (24 * 60 * 60 * 1000));
};

const getRevenueOrdersForStore = (orders: Order[], storeName: string): Order[] => {
  if (storeName === '云窗') {
    return orders.filter((order) => order.order_kind === 'retail' && (order.store_name || '未指定店铺') === storeName);
  }
  return orders.filter((order) => order.order_kind === 'settlement' && (order.store_name || '未指定店铺') === storeName);
};

export const buildCityChannelReport = ({
  orders,
  stores,
  products,
  storeInventory,
  now = new Date(),
}: BusinessReportInput): CityChannelReportRow[] => {
  const month = getMonthContext(now);

  return stores
    .filter((store) => store.status === 'active')
    .map((store, index) => {
      const storeName = store.name || '未指定店铺';
      const revenueOrders = getRevenueOrdersForStore(orders, storeName);

      let monthSalesQty = 0;
      let prevMonthSalesQty = 0;
      let supplyRevenue = 0;
      const soldProductIds = new Set<string>();

      revenueOrders.forEach((order) => {
        const isCurrentMonth = isSameMonth(order.created_at, month.year, month.monthIndex);
        const isPreviousMonth = isSameMonth(order.created_at, month.prevYear, month.prevMonthIndex);
        if (isCurrentMonth) {
          supplyRevenue += Number(order.total_discount_amount || 0);
        }
        order.items.forEach((item) => {
          if (item.is_sample) return;
          if (isCurrentMonth) {
            monthSalesQty += Number(item.quantity || 0);
            soldProductIds.add(item.product_id);
          }
          if (isPreviousMonth) {
            prevMonthSalesQty += Number(item.quantity || 0);
          }
        });
      });

      const inventoryRows = storeInventory.filter((row) => row.store_id === store.id);
      const inventoryValue = inventoryRows.reduce((sum, row) => {
        const product = products.find((item) => item.id === row.product_id);
        const price = storeName === '云窗'
          ? Number(product?.price || 0)
          : Number(product?.discount_price || product?.price || 0);
        return sum + Number(row.quantity || 0) * price;
      }, 0);

      const stockedSkuCount = inventoryRows.length > 0
        ? inventoryRows.filter((row) => Number(row.quantity || 0) > 0).length
        : products.filter((item) => item.city_id === store.city_id).length;
      const skuRate = stockedSkuCount > 0 ? `${round2((soldProductIds.size / stockedSkuCount) * 100)}%` : '0%';
      const momRate = prevMonthSalesQty > 0
        ? `${round2(((monthSalesQty - prevMonthSalesQty) / prevMonthSalesQty) * 100)}%`
        : (monthSalesQty > 0 ? '100%' : '0%');

      return {
        序号: index + 1,
        城市: store.city_name || '未知城市',
        城市分级: '',
        渠道门店名称: storeName,
        合作模式: store.cooperation_mode || '',
        月总销售件数: monthSalesQty,
        上月同期销量: prevMonthSalesQty,
        环比增长率: momRate,
        供货营收: round2(supplyRevenue),
        库存总货值: round2(inventoryValue),
        sku动销率: skuRate,
        结算账期: store.settlement_day ?? null,
      };
    });
};

export const buildProductDetailReport = ({
  orders,
  stores,
  products,
  storeInventory,
  now = new Date(),
}: BusinessReportInput): ProductDetailReportRow[] => {
  const month = getMonthContext(now);
  const purchaseOrders = orders.filter((order) => order.order_kind === 'purchase');
  const rows: ProductDetailReportRow[] = [];

  stores
    .filter((store) => store.status === 'active')
    .forEach((store) => {
      const storeName = store.name || '未指定店铺';
      const revenueOrders = getRevenueOrdersForStore(orders, storeName);
      const productIds = new Set<string>();
      storeInventory.filter((row) => row.store_id === store.id).forEach((row) => productIds.add(row.product_id));
      revenueOrders.forEach((order) => {
        order.items.forEach((item) => {
          if (!item.is_sample) productIds.add(item.product_id);
        });
      });

      Array.from(productIds).forEach((productId) => {
        const product = products.find((item) => item.id === productId);
        if (!product) return;

        const inventoryRow = storeInventory.find((entry) => entry.store_id === store.id && entry.product_id === productId);
        const currentInventory = inventoryRow ? Number(inventoryRow.quantity || 0) : Number(product.quantity || 0);
        const safeThreshold = Number(inventoryRow?.min_quantity || product.min_quantity || 0);
        const terminalPrice = Number(product.price || 0);
        const supplyPrice = storeName === '云窗'
          ? terminalPrice
          : Number(product.discount_price || terminalPrice);
        const unitCost = Number(product.cost || 0);

        const monthSales = revenueOrders.reduce((sum, order) => {
          if (!isSameMonth(order.created_at, month.year, month.monthIndex)) return sum;
          return sum + order.items
            .filter((item) => !item.is_sample && item.product_id === productId)
            .reduce((itemSum, item) => itemSum + Number(item.quantity || 0), 0);
        }, 0);

        const prevSales = revenueOrders.reduce((sum, order) => {
          if (!isSameMonth(order.created_at, month.prevYear, month.prevMonthIndex)) return sum;
          return sum + order.items
            .filter((item) => !item.is_sample && item.product_id === productId)
            .reduce((itemSum, item) => itemSum + Number(item.quantity || 0), 0);
        }, 0);

        const purchaseDates = purchaseOrders
          .filter((order) => order.store_id === store.id)
          .filter((order) => order.items.some((item) => item.product_id === productId))
          .map((order) => new Date(order.created_at).getTime())
          .filter((timestamp) => Number.isFinite(timestamp))
          .sort((a, b) => b - a);
        const turnoverDays = purchaseDates.length >= 2
          ? Math.max(1, Math.floor((purchaseDates[0] - purchaseDates[1]) / (24 * 60 * 60 * 1000)))
          : 99;

        rows.push({
          序号: rows.length + 1,
          城市: store.city_name || product.city_name || '未知城市',
          渠道门店: storeName,
          SKU编号: product.sku || '',
          产品名称: product.name,
          品类: product.category || '',
          单位成本: round2(unitCost),
          供货价: round2(supplyPrice),
          终端售价: round2(terminalPrice),
          当前实物库存: currentInventory,
          预留库存: '',
          总可用库存: currentInventory,
          安全库存阈值: safeThreshold,
          本月销量: monthSales,
          上月销量: prevSales,
          库存周转天数: turnoverDays,
          滞销标记: turnoverDays > 60 ? '是' : '否',
          单品毛利: round2((supplyPrice - unitCost) * monthSales),
        });
      });
    });

  return rows;
};

export const buildPaymentReport = ({
  orders,
  stores,
  now = new Date(),
}: Omit<BusinessReportInput, 'products' | 'storeInventory'>): PaymentReportRow[] => {
  const month = getMonthContext(now);

  return stores
    .filter((store) => store.status === 'active')
    .map((store, index) => {
      const receivable = orders
        .filter((order) => order.order_kind === 'settlement' && order.store_id === store.id)
        .filter((order) => isSameMonth(order.created_at, month.year, month.monthIndex))
        .reduce((sum, order) => sum + Number(order.total_discount_amount || 0), 0);

      const outstanding = round2(receivable);
      const overdueDays = calculateStoreOverdueDays(store.settlement_day ?? null, now);
      const status = outstanding <= 0 ? '已结清' : (overdueDays > 0 ? '逾期' : '未到期');

      return {
        序号: index + 1,
        城市渠道: `${store.city_name || '未知城市'}-${store.name || '未指定店铺'}`,
        对账周期: month.period,
        应收货款: round2(receivable),
        已回款金额: null,
        未结欠款: outstanding,
        逾期天数: overdueDays,
        渠道扣点费用: null,
        实际毛利额: null,
        回款状态: status,
      };
    });
};

export const useAppStore = create<AppState>()(
  persist(
    (set, get) => ({
      user: null,
      cities: [],
      products: [],
      inventory: [],
      orders: [],
      distributors: [],
      stores: [],
      storeInventory: [],
      storeProductPrices: [],
      notifications: [],
      isLoading: false,
      isOfflineMode: false,
      isDarkMode: false,

      setUser: (user) => set({ user }),
      setLoading: (isLoading) => set({ isLoading }),
      setOfflineMode: (isOfflineMode) => set({ isOfflineMode }),
      setDarkMode: (isDarkMode) => set({ isDarkMode }),

      ensureActiveSession: async () => {
        const checkActiveSessionOnce = async (): Promise<{ ok: boolean; error: Error | null }> => {
          const { data: checkResult, error: checkError } = await supabase.rpc('is_current_session_active');
          if (checkError) {
            if (isMissingRpcFunction(checkError)) {
              return { ok: true, error: null };
            }
            return { ok: false, error: checkError as Error };
          }
          return { ok: Boolean(checkResult), error: null };
        };

        const firstCheck = await checkActiveSessionOnce();
        if (firstCheck.error) return firstCheck.error;
        if (firstCheck.ok) return null;

        for (let attempt = 0; attempt < SESSION_RETRY_TIMES; attempt += 1) {
          await waitMs(SESSION_RETRY_DELAY_MS);
          const retryCheck = await checkActiveSessionOnce();
          if (retryCheck.error) return retryCheck.error;
          if (retryCheck.ok) return null;
        }

        if (isWithinSessionGuardGraceWindow()) {
          return null;
        }

        await get().signOut();
        return new Error('账号已在其他设备登录，请重新登录');
      },

      signIn: async (email: string, password: string) => {
        set({ isLoading: true });
        try {
          const { data, error } = await supabase.auth.signInWithPassword({ email, password });
          if (error) throw error;

          if (data.user) {
            const profile = await ensureProfileForAuthUser(data.user);
            set({ user: mapProfile(profile) });

            const { error: activateError } = await supabase.rpc('activate_current_session');
            if (activateError && !isMissingRpcFunction(activateError)) {
              await get().signOut();
              throw activateError;
            }

            setSessionGuardGraceWindow();
          }

          return { error: null };
        } catch (error) {
          return { error: error as Error };
        } finally {
          set({ isLoading: false });
        }
      },

      signUp: async (
        email: string,
        password: string,
        role = 'distributor',
        cityId?: string,
      ) => {
        set({ isLoading: true });
        try {
          const normalizedCityId = cityId?.trim();

          if (role === 'distributor') {
            if (!normalizedCityId) throw new Error('请选择归属城市');
            if (!isUuidLike(normalizedCityId)) {
              throw new Error('城市数据格式异常，请联系管理员检查城市配置');
            }
          }

          const { data, error } = await supabase.auth.signUp({
            email,
            password,
            options: {
              data: {
                role,
                city_id: normalizedCityId,
              },
            },
          });
          if (error) throw formatSupabaseError(error);

          if (data.session && data.user) {
            const profile = await ensureProfileForAuthUser(data.user);
            set({ user: mapProfile(profile) });

            const { error: activateError } = await supabase.rpc('activate_current_session');
            if (activateError && !isMissingRpcFunction(activateError)) {
              await get().signOut();
              throw activateError;
            }

            setSessionGuardGraceWindow();
          }

          return { error: null };
        } catch (error) {
          return { error: normalizeError(error) };
        } finally {
          set({ isLoading: false });
        }
      },

      signOut: async () => {
        try {
          await supabase.auth.signOut();
        } finally {
          set({
            user: null,
            cities: [],
            products: [],
            inventory: [],
            orders: [],
            distributors: [],
            stores: [],
            storeInventory: [],
            storeProductPrices: [],
            notifications: [],
          });
        }
      },

      fetchCities: async () => {
        const { data, error } = await supabase
          .from('cities')
          .select('*')
          .order('sort_index', { ascending: true })
          .order('name', { ascending: true });
        if (!error && data) set({ cities: data });
      },

      moveCityOrder: async (cityId, direction) => {
        try {
          const { user } = get();
          if (!user) throw new Error('未登录');
          if (!(user.role === 'admin' || user.role === 'super_admin')) throw new Error('仅管理员可调整城市排序');

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

        let priceMap = new Map<string, number>();
        if (user.role === 'distributor') {
          const { data: customPrices } = await supabase
            .from('distributor_product_prices')
            .select('product_id, discount_price')
            .eq('distributor_id', user.id);

          const priceRows = (customPrices || []) as DistributorProductPriceRow[];
          priceMap = new Map(priceRows.map((row) => [row.product_id, Number(row.discount_price)]));
        }

        const productRows = data as ProductRow[];
        const productsWithDetails: ProductWithDetails[] = productRows
          .map((p) => {
            const baseDiscount = p.discount_price !== null && p.discount_price !== undefined
              ? Number(p.discount_price)
              : Number(p.price || 0);
            const distributorDiscount = priceMap.get(p.id);
            return {
              ...p,
              barcode: p.barcode ?? undefined,
              image_url: p.image_url ?? undefined,
              sku: p.sku ?? null,
              category: p.category ?? null,
              price: Number(p.price || 0),
              cost: Number(p.cost || 0),
              one_time_cost: Number(p.one_time_cost || 0),
              discount_price: distributorDiscount ?? baseDiscount,
              city_name: p.cities?.name,
              quantity: p.inventory?.[0]?.quantity !== null && p.inventory?.[0]?.quantity !== undefined
                ? Number(p.inventory[0].quantity)
                : undefined,
              min_quantity: p.inventory?.[0]?.min_quantity !== null && p.inventory?.[0]?.min_quantity !== undefined
                ? Number(p.inventory[0].min_quantity)
                : undefined,
            };
          });

        set({ products: productsWithDetails });
      },

      fetchInventory: async () => {
        const { user } = get();
        if (!user || user.role === 'distributor') {
          set({ inventory: [] });
          return;
        }
        const { data, error } = await supabase
          .from('inventory')
          .select('*')
          .order('updated_at', { ascending: false });
        if (!error && data) set({ inventory: data });
      },

      fetchOrders: async (startDate?: string, endDate?: string) => {
        const { user } = get();
        if (!user) return;

        const orderSelect = `
            *,
            cities(name),
            profiles:distributor_id(email,store_name),
            stores(name),
            order_items(
              *,
              products(name, city_id, cities(name))
            )
          `;

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

        const mapped = rows.map(mapOrder).filter((o) => (user.role === 'distributor' ? o.distributor_id === user.id : true));
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

        const mapped = (data as StoreRow[]).map(mapStore);
        // Pin 云窗 store to the top
        const yunchuangIdx = mapped.findIndex((s) => s.name === '云窗');
        const sorted = yunchuangIdx > 0
          ? [mapped[yunchuangIdx], ...mapped.filter((_, i) => i !== yunchuangIdx)]
          : mapped;
        set({ stores: sorted });
      },

      fetchOwnedStores: async () => {
        const { user } = get();
        if (!user || user.role !== 'distributor') {
          return [];
        }

        const { data, error } = await supabase
          .from('stores')
          .select('*, cities(name), profiles:distributor_id(email)')
          .eq('distributor_id', user.id)
          .eq('status', 'active')
          .order('name', { ascending: true });

        if (error || !data) {
          set({ stores: [] });
          return [];
        }

        const mappedStores = (data as StoreRow[]).map(mapStore);
        set({ stores: mappedStores });
        return mappedStores;
      },

      setDefaultStore: async (storeId: string) => {
        try {
          const { user } = get();
          if (!user) throw new Error('未登录');
          if (user.role !== 'distributor') throw new Error('仅分销商需要选择默认店铺');
          if (!storeId) throw new Error('请选择店铺');

          const { data: targetStore, error: storeError } = await supabase
            .from('stores')
            .select('id')
            .eq('id', storeId)
            .eq('distributor_id', user.id)
            .eq('status', 'active')
            .maybeSingle();
          if (storeError) throw formatSupabaseError(storeError);
          if (!targetStore) throw new Error('该店铺不可用，请重新选择');

          const { error: rpcError } = await supabase.rpc('set_my_default_store', {
            p_store_id: storeId,
          });
          if (rpcError) {
            if (isMissingRpcFunction(rpcError)) {
              throw new Error('数据库未部署默认店铺选择函数，请先执行最新迁移');
            }
            throw formatSupabaseError(rpcError);
          }

          const { data: refreshedProfile, error: refreshedError } = await supabase
            .from('profiles')
            .select('*, cities(name)')
            .eq('id', user.id)
            .single();
          if (refreshedError || !refreshedProfile) {
            throw formatSupabaseError(refreshedError || new Error('刷新用户信息失败'));
          }

          set({ user: mapProfile(refreshedProfile as ProfileRow) });
          return { error: null };
        } catch (error) {
          return { error: normalizeError(error) };
        }
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

      fetchAllStoreInventory: async () => {
        const { data, error } = await supabase
          .from('store_inventory')
          .select('*, products(name)')
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

      fetchDistributors: async () => {
        const { user } = get();
        if (!user || (user.role !== 'admin' && user.role !== 'super_admin')) {
          set({ distributors: [] });
          return;
        }

        const { data, error } = await supabase
          .from('profiles')
          .select('*, cities(name)')
          .eq('role', 'distributor')
          .order('created_at', { ascending: false });
        if (!error && data) set({ distributors: data.map(mapProfile) });
      },

      fetchAllData: async () => {
        set({ isLoading: true });
        const sessionError = await get().ensureActiveSession();
        if (sessionError) {
          set({ isLoading: false });
          return;
        }
        await Promise.all([
          get().fetchCities(),
          get().fetchProducts(),
          get().fetchInventory(),
          get().fetchOrders(),
          get().fetchDistributors(),
          get().fetchStores(),
          get().fetchNotifications(),
        ]);
        set({ isLoading: false });
      },

      generateCityChannelReport: () => {
        const { orders, stores, products, storeInventory } = get();
        return buildCityChannelReport({ orders, stores, products, storeInventory });
      },

      generateProductDetailReport: () => {
        const { orders, stores, products, storeInventory } = get();
        return buildProductDetailReport({ orders, stores, products, storeInventory });
      },

      generatePaymentReport: () => {
        const { orders, stores } = get();
        return buildPaymentReport({ orders, stores });
      },

      addCity: async (name: string) => {
        try {
          const { data: lastCity, error: lastCityError } = await supabase
            .from('cities')
            .select('sort_index')
            .order('sort_index', { ascending: false })
            .limit(1)
            .maybeSingle();
          if (lastCityError) throw lastCityError;

          const nextSortIndex = Number(lastCity?.sort_index || 0) + 1;

          const { error } = await supabase.from('cities').insert({
            name,
            sort_index: nextSortIndex,
            province: getProvinceForCity(name),
          });
          if (error) throw error;
          await get().fetchCities();
          return { error: null };
        } catch (error) {
          return { error: error as Error };
        }
      },

      deleteCity: async (id: string) => {
        try {
          const { error } = await supabase.from('cities').delete().eq('id', id);
          if (error) throw error;
          await get().fetchCities();
          return { error: null };
        } catch (error) {
          return { error: error as Error };
        }
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
            settlement_day: store.settlement_day ?? null,
            cooperation_mode: store.cooperation_mode ?? null,
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
          if (user.role !== 'super_admin') throw new Error('仅超级管理员可编辑店铺');

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
          if (updates.settlement_day !== undefined) payload.settlement_day = updates.settlement_day;
          if (updates.cooperation_mode !== undefined) payload.cooperation_mode = updates.cooperation_mode;
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

      updateDistributorProfile: async (id: string, cityId: string, storeName?: string) => {
        try {
          const payload: Record<string, unknown> = {
            city_id: cityId,
            updated_at: new Date().toISOString(),
          };
          if (storeName !== undefined && storeName.trim() !== '') {
            payload.store_name = storeName.trim();
          }
          const { error } = await supabase
            .from('profiles')
            .update(payload)
            .eq('id', id)
            .eq('role', 'distributor');
          if (error) throw error;
          await get().fetchDistributors();
          return { error: null };
        } catch (error) {
          return { error: error as Error };
        }
      },

      updateOwnStoreName: async (storeName: string) => {
        const { user } = get();
        if (!user) return { error: new Error('未登录') };
        try {
          const { error } = await supabase
            .from('profiles')
            .update({ store_name: storeName.trim(), updated_at: new Date().toISOString() })
            .eq('id', user.id);
          if (error) throw error;
          set({ user: { ...user, store_name: storeName.trim() } });
          return { error: null };
        } catch (error) {
          return { error: error as Error };
        }
      },

      updateOwnAvatar: async (avatarUrl: string) => {
        const { user } = get();
        if (!user) return { error: new Error('未登录') };
        const sessionError = await get().ensureActiveSession();
        if (sessionError) return { error: sessionError };
        try {
          const { error } = await supabase
            .from('profiles')
            .update({ avatar_url: avatarUrl, updated_at: new Date().toISOString() })
            .eq('id', user.id);
          if (error) throw error;
          set({ user: { ...user, avatar_url: avatarUrl } });
          return { error: null };
        } catch (error) {
          return { error: error as Error };
        }
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
        if (!error && data) set({ notifications: data });
      },

      acceptOrder: async (orderId: string) => {
        const { user } = get();
        if (!user) return { error: new Error('未登录') };
        const sessionError = await get().ensureActiveSession();
        if (sessionError) return { error: sessionError };
        try {
          const { error: updateError } = await supabase
            .from('orders')
            .update({ status: 'accepted' })
            .eq('id', orderId);
          if (updateError) throw updateError;

          const order = get().orders.find((o) => o.id === orderId);
          if (order && order.distributor_id !== user.id) {
            await supabase.from('notifications').insert({
              user_id: order.distributor_id,
              type: 'order_accepted',
              order_id: orderId,
              message: `您的订单 #${orderId.slice(0, 8)} 已被接单`,
            });
          }

          await Promise.all([get().fetchOrders(), get().fetchNotifications()]);
          return { error: null };
        } catch (error) {
          return { error: error as Error };
        }
      },

      markNotificationRead: async (notificationId: string) => {
        await supabase
          .from('notifications')
          .update({ is_read: true })
          .eq('id', notificationId);
        await get().fetchNotifications();
      },

      markAllNotificationsRead: async () => {
        const { user, notifications } = get();
        if (!user) return;
        const unreadIds = notifications.filter((n) => !n.is_read).map((n) => n.id);
        if (unreadIds.length === 0) return;
        await supabase
          .from('notifications')
          .update({ is_read: true })
          .in('id', unreadIds);
        await get().fetchNotifications();
      },

      addProduct: async (product) => {
        try {
          const unitCost = Number(product.cost);
          if (Number.isNaN(unitCost)) {
            throw new Error('单个成本为必填项');
          }
          const payload = {
            ...product,
            cost: unitCost,
            one_time_cost: Number(product.one_time_cost || 0),
            discount_price: Number(product.discount_price || product.price),
            sku: product.sku?.trim() || null,
            category: product.category?.trim() || null,
          };
          const { data, error } = await supabase.from('products').insert(payload).select().single();
          if (error) throw error;

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

          const { error: barcodeUpdateError } = await supabase
            .from('products')
            .update({ barcode })
            .eq('id', data.id);
          if (barcodeUpdateError) throw barcodeUpdateError;

          await supabase.from('inventory').insert({
            product_id: data.id,
            quantity: 0,
            min_quantity: 10,
          });

          await get().fetchProducts();
          return { error: null };
        } catch (error) {
          return { error: error as Error };
        }
      },

      updateProduct: async (id, updates) => {
        try {
          if (updates.cost !== undefined && Number.isNaN(Number(updates.cost))) {
            throw new Error('单个成本为必填项');
          }
          const payload = {
            ...updates,
            cost: updates.cost !== undefined ? Number(updates.cost) : updates.cost,
            sku: updates.sku !== undefined ? (updates.sku?.trim() || null) : updates.sku,
            category: updates.category !== undefined ? (updates.category?.trim() || null) : updates.category,
            updated_at: new Date().toISOString(),
          };
          const { error } = await supabase.from('products').update(payload).eq('id', id);
          if (error) throw error;
          await get().fetchProducts();
          return { error: null };
        } catch (error) {
          return { error: error as Error };
        }
      },

      deleteProduct: async (id) => {
        try {
          const { error } = await supabase.from('products').delete().eq('id', id);
          if (error) throw error;
          await get().fetchProducts();
          return { error: null };
        } catch (error) {
          return { error: error as Error };
        }
      },

      setDistributorProductDiscount: async (distributorId, productId, discountPrice) => {
        try {
          const { error } = await supabase
            .from('distributor_product_prices')
            .upsert(
              {
                distributor_id: distributorId,
                product_id: productId,
                discount_price: discountPrice,
                updated_at: new Date().toISOString(),
              },
              { onConflict: 'distributor_id,product_id' },
            );
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

      updateInventory: async (productId, quantity, options) => {
        try {
          const { error } = await supabase
            .from('inventory')
            .update({ quantity, updated_at: new Date().toISOString() })
            .eq('product_id', productId);
          if (error) throw error;
          if (!options?.skipRefresh) {
            await get().fetchProducts();
          }
          return { error: null };
        } catch (error) {
          return { error: error as Error };
        }
      },

      updateStoreInventory: async (storeId, productId, quantity, options) => {
        try {
          const { user } = get();
          if (!user) throw new Error('未登录');
          if (user.role !== 'super_admin') throw new Error('仅超级管理员可调整店铺库存');

          const { error } = await supabase
            .from('store_inventory')
            .upsert(
              {
                store_id: storeId,
                product_id: productId,
                quantity,
                updated_at: new Date().toISOString(),
              },
              { onConflict: 'store_id,product_id' },
            );

          if (error) throw error;

          if (!options?.skipRefresh) {
            await get().fetchStoreInventory(storeId);
          }

          return { error: null };
        } catch (error) {
          return { error: error as Error };
        }
      },

      updateInventorySettings: async (productId, quantity, minQuantity) => {
        try {
          const { data, error } = await supabase
            .from('inventory')
            .update({
              quantity,
              min_quantity: minQuantity,
              updated_at: new Date().toISOString(),
            })
            .eq('product_id', productId)
            .select('product_id');

          if (error) throw error;
          if (!data || data.length === 0) throw new Error('未找到库存记录，请先初始化库存');
          await get().fetchProducts();
          return { error: null };
        } catch (error) {
          return { error: error as Error };
        }
      },

      findProductByBarcode: (barcode) => {
        const normalized = barcode.trim();
        if (!normalized) return undefined;
        return get().products.find((product) => product.barcode === normalized);
      },

      inboundStock: async (barcode, quantity) => {
        try {
          if (quantity <= 0) throw new Error('入库数量必须大于0');
          const product = get().findProductByBarcode(barcode);
          if (!product) throw new Error('未找到对应条码商品');
          const currentQty = Number(product.quantity || 0);
          return await get().updateInventory(product.id, currentQty + quantity);
        } catch (error) {
          return { error: error as Error };
        }
      },

      outboundStock: async (barcode, quantity) => {
        try {
          if (quantity <= 0) throw new Error('出库数量必须大于0');
          const { user } = get();
          if (!user) throw new Error('未登录');
          const product = get().findProductByBarcode(barcode);
          if (!product) throw new Error('未找到对应条码商品');
          const currentQty = Number(product.quantity || 0);
          if (currentQty < quantity) throw new Error('库存不足');

          const requestId = createRequestId('outbound', user.id);

          const { error: rpcError } = await supabase.rpc('outbound_stock_atomic', {
            p_barcode: barcode,
            p_quantity: quantity,
            p_request_id: requestId,
          });

          if (!rpcError) {
            await Promise.all([get().fetchOrders(), get().fetchProducts()]);
            return { error: null };
          }

          if (!shouldFallbackToLegacyFlow(rpcError, 'outbound_stock_atomic')) {
            throw rpcError;
          }

          // 出库订单按零售价计算（零售订单）
          const retailPrice = Number(product.price || 0);
          const orderPayload = {
            distributor_id: user.id,
            city_id: user.city_id ?? product.city_id,
            order_kind: 'retail' as const,
            status: 'accepted' as const,
            total_retail_amount: retailPrice * quantity,
            total_discount_amount: retailPrice * quantity,
          };

          const { data: orderData, error: orderError } = await supabase
            .from('orders')
            .insert(orderPayload)
            .select('id')
            .single();
          if (orderError) throw orderError;

          const { error: orderItemError } = await supabase
            .from('order_items')
            .insert({
              order_id: orderData.id,
              product_id: product.id,
              quantity,
              retail_price: retailPrice,
              discount_price: retailPrice,
              unit_cost: Number(product.cost || 0),
              one_time_cost: Number(product.one_time_cost || 0),
            });
          if (orderItemError) throw orderItemError;

          const inventoryResult = await get().updateInventory(product.id, currentQty - quantity);
          if (inventoryResult.error) throw inventoryResult.error;

          await get().fetchOrders();
          return { error: null };
        } catch (error) {
          return { error: error as Error };
        }
      },

      backfillBarcodes: async () => {
        try {
          // Find products without barcodes
          const { data: noBarcodeProducts, error: fetchError } = await supabase
            .from('products')
            .select('id')
            .is('barcode', null);
          if (fetchError) throw fetchError;
          if (!noBarcodeProducts || noBarcodeProducts.length === 0) {
            return { count: 0, error: null };
          }

          // Get highest existing barcode sequence
          const { data: latestBarcodeRow } = await supabase
            .from('products')
            .select('barcode')
            .like('barcode', '200%')
            .order('barcode', { ascending: false })
            .limit(1)
            .maybeSingle();

          const latestBarcode = latestBarcodeRow?.barcode;
          let seq = latestBarcode && /^\d{13}$/.test(latestBarcode)
            ? Number.parseInt(latestBarcode.slice(7, 12), 10)
            : 0;

          let count = 0;
          for (const p of noBarcodeProducts) {
            seq += 1;
            const barcode = generateEAN13(seq);
            const { error: updateError } = await supabase
              .from('products')
              .update({ barcode })
              .eq('id', p.id);
            if (!updateError) count++;
          }

          await get().fetchProducts();
          return { count, error: null };
        } catch (error) {
          return { count: 0, error: error as Error };
        }
      },

      createStoreRetailOrder: async (storeId, items) => {
        const { user } = get();
        if (!user) return { error: new Error('未登录') };

        try {
          if (!(user.role === 'admin' || user.role === 'super_admin')) {
            throw new Error('当前角色无店铺零售建单权限');
          }

          if (!storeId) {
            throw new Error('店铺ID不能为空');
          }

          if (!Array.isArray(items) || items.length === 0) {
            throw new Error('购物车为空');
          }

          const invalidItem = items.find((item) => !item.product_id || item.quantity <= 0);
          if (invalidItem) {
            throw new Error('订单商品参数无效');
          }

          const payload = buildStoreRetailOrderRpcItems(items);

          const { error } = await supabase.rpc('create_store_retail_order_atomic', {
            p_items: payload,
            p_store_id: storeId,
          });
          if (error) throw error;

          await get().fetchOrders();
          return { error: null };
        } catch (error) {
          return { error: error as Error };
        }
      },

      createSettlementOrder: async (storeId, items) => {
        const { user, products, stores, storeProductPrices } = get();
        if (!user) return { error: new Error('未登录') };

        try {
          if (!(user.role === 'admin' || user.role === 'super_admin')) {
            throw new Error('当前角色无结算建单权限');
          }

          if (!storeId) {
            throw new Error('店铺ID不能为空');
          }

          if (!Array.isArray(items) || items.length === 0) {
            throw new Error('购物车为空');
          }

          const invalidItem = items.find((item) => !item.product_id || item.quantity <= 0);
          if (invalidItem) {
            throw new Error('订单商品参数无效');
          }

          const payload = buildStoreRetailOrderRpcItems(items);
          const requestId = createRequestId('batch', user.id);

          const { error: rpcError } = await supabase.rpc('create_settlement_order_atomic', {
            p_items: payload,
            p_store_id: storeId,
            p_request_id: requestId,
          });
          if (!rpcError) {
            await Promise.all([get().fetchOrders(), get().fetchStoreInventory(storeId)]);
            return { error: null };
          }

          if (!shouldFallbackToLegacyFlow(rpcError, 'create_settlement_order_atomic')) {
            throw rpcError;
          }

          const selectedStore = stores.find((store) => store.id === storeId) || null;
          if (!selectedStore) throw new Error('店铺不存在或未加载');
          if (selectedStore.status === 'inactive') throw new Error('店铺已停用');

          let totalRetail = 0;
          let totalDiscount = 0;
          let totalQuantity = 0;

          const orderItemsPayload = items.map((item) => {
            const product = products.find((p) => p.id === item.product_id);
            if (!product) throw new Error('商品不存在');

            const quantity = Number(item.quantity || 0);
            if (!Number.isFinite(quantity) || quantity <= 0) throw new Error(`${product.name} 数量必须大于0`);

            if (product.city_id !== selectedStore.city_id) {
              throw new Error('店铺只能结算所属城市商品');
            }

            const storeOverride = storeProductPrices.find((entry) => entry.store_id === storeId && entry.product_id === product.id);
            const retailPrice = Number(product.price || 0);
            const discountPrice = resolvePrice({
              price: retailPrice,
              discount_price: product.discount_price,
              discount_rate: selectedStore.discount_rate,
              override_price: storeOverride?.override_price,
            }).price;
            const unitCost = Number(product.cost || 0);
            const oneTimeCost = Number(product.one_time_cost || 0);

            totalRetail += retailPrice * quantity;
            totalDiscount += discountPrice * quantity;
            totalQuantity += quantity;

            return {
              product_id: product.id,
              quantity,
              retail_price: retailPrice,
              discount_price: discountPrice,
              unit_cost: unitCost,
              one_time_cost: oneTimeCost,
            };
          });

          const baseOrderPayload = {
            distributor_id: user.id,
            city_id: selectedStore.city_id,
            store_id: storeId,
            request_id: requestId,
            order_kind: 'settlement' as const,
            status: 'accepted' as const,
            payment_status: 'paid' as const,
            quantity: totalQuantity,
            total_retail_amount: totalRetail,
            total_discount_amount: totalDiscount,
          };

          let orderInsert = await supabase
            .from('orders')
            .insert(baseOrderPayload)
            .select('id')
            .single();

          if (orderInsert.error && orderItemsPayload.length > 0) {
            const message = String(orderInsert.error.message || '').toLowerCase();
            const details = String(orderInsert.error.details || '').toLowerCase();
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
                unit_price: primaryItem.discount_price,
                total_amount: totalDiscount,
              };

              orderInsert = await supabase
                .from('orders')
                .insert(legacyOrderPayload)
                .select('id')
                .single();

              if (orderInsert.error) {
                const retryMessage = String(orderInsert.error.message || '').toLowerCase();
                const retryDetails = String(orderInsert.error.details || '').toLowerCase();
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

          const { error: orderItemsError } = await supabase
            .from('order_items')
            .insert(orderItemsPayload.map((item) => ({ ...item, order_id: orderData.id })));
          if (orderItemsError) throw orderItemsError;

          const settlementByProduct = orderItemsPayload.reduce<Map<string, number>>((acc, item) => {
            const nextQty = (acc.get(item.product_id) || 0) + item.quantity;
            acc.set(item.product_id, nextQty);
            return acc;
          }, new Map());

          const { data: existingStoreInventory, error: existingStoreInventoryError } = await supabase
            .from('store_inventory')
            .select('product_id, quantity')
            .eq('store_id', storeId)
            .in('product_id', Array.from(settlementByProduct.keys()));
          if (existingStoreInventoryError) throw existingStoreInventoryError;

          const existingQuantityMap = new Map(
            (existingStoreInventory || []).map((row) => [row.product_id as string, Number(row.quantity || 0)]),
          );

          const insufficientProductId = Array.from(settlementByProduct.entries()).find(([productId, qty]) => {
            const current = existingQuantityMap.get(productId) || 0;
            return current < qty;
          })?.[0];
          if (insufficientProductId) {
            const productName = products.find((product) => product.id === insufficientProductId)?.name || '商品';
            throw new Error(`${productName} 店铺库存不足`);
          }

          const nowIso = new Date().toISOString();
          const storeInventoryPayload = Array.from(settlementByProduct.entries()).map(([productId, qty]) => ({
            store_id: storeId,
            product_id: productId,
            quantity: Math.max(0, (existingQuantityMap.get(productId) || 0) - qty),
            updated_at: nowIso,
          }));
          const { error: storeInventoryError } = await supabase
            .from('store_inventory')
            .upsert(storeInventoryPayload, { onConflict: 'store_id,product_id' });
          if (storeInventoryError) throw storeInventoryError;

          await Promise.all([get().fetchOrders(), get().fetchStoreInventory(storeId)]);
          return { error: null };
        } catch (error) {
          return { error: error as Error };
        }
      },

      createPurchaseOrder: async (items) => {
        const { user } = get();
        if (!user) return { error: new Error('未登录') };

        try {
          if (!(user.role === 'admin' || user.role === 'super_admin')) {
            throw new Error('当前角色无进货建单权限');
          }

          if (!Array.isArray(items) || items.length === 0) {
            throw new Error('进货单为空');
          }

          const invalidGroup = items.find((group) => !group.store_id || !group.city_id || !Array.isArray(group.products) || group.products.length === 0);
          if (invalidGroup) {
            throw new Error('进货店铺或商品参数无效');
          }

          const invalidProduct = items
            .flatMap((group) => group.products)
            .find((product) => !product.product_id || product.quantity <= 0);
          if (invalidProduct) {
            throw new Error('进货商品数量必须大于0');
          }

          for (const group of items) {
            const { error } = await supabase.rpc('create_purchase_order_atomic', {
              p_user_id: user.id,
              p_store_id: group.store_id,
              p_city_id: group.city_id,
              p_items: group.products,
            });
            if (error) throw error;
          }

          await get().fetchPurchaseOrders();
          return { error: null };
        } catch (error) {
          return { error: error as Error };
        }
      },

      confirmPurchaseDelivery: async (orderId) => {
        const { user } = get();
        if (!user) return { error: new Error('未登录') };

        try {
          if (!(user.role === 'admin' || user.role === 'super_admin')) {
            throw new Error('当前角色无确认进货权限');
          }
          if (!orderId) throw new Error('订单ID不能为空');

          const { error } = await supabase.rpc('confirm_purchase_delivery_atomic', {
            p_order_id: orderId,
            p_confirmed_by: user.id,
          });
          if (error) throw error;

          await Promise.all([get().fetchPurchaseOrders(), get().fetchProducts()]);
          return { error: null };
        } catch (error) {
          return { error: error as Error };
        }
      },

      fetchPurchaseOrders: async () => {
        await get().fetchOrders();
      },

      createBatchOrders: async (items, storeId = null) => {
        const { user, products, stores, storeProductPrices } = get();
        if (!user) return { error: new Error('未登录') };
        if (items.length === 0) return { error: new Error('购物车为空') };
        const sessionError = await get().ensureActiveSession();
        if (sessionError) return { error: sessionError };

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
              const p = products.find((x) => x.id === item.productId);
              return p && p.city_id !== distributorOrderCityId;
            });
            if (outOfCity) return { error: new Error('分销商只能下所属城市商品') };
          }

          let totalRetail = 0;
          let totalDiscount = 0;
          let orderCityId: string | undefined = selectedStore?.city_id;

          const orderItemsPayload = items.map((item) => {
            const product = products.find((p) => p.id === item.productId);
            if (!product) throw new Error('商品不存在');
            const isSample = Boolean(item.isSample);
            if (item.quantity <= 0) {
              throw new Error(`${product.name} 数量必须大于0`);
            }
            if (user.role === 'distributor' && !isSample && item.quantity < 30) {
              throw new Error(`${product.name} 分销订单非样品数量必须大于等于30`);
            }

            const available = product.quantity ?? 0;
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

          const requestId = createRequestId('batch', user.id);

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

          if (!shouldFallbackToLegacyFlow(rpcError, 'create_batch_order_atomic')) {
            throw rpcError;
          }

          const baseOrderPayload = {
            distributor_id: user.id,
            city_id: selectedStore?.city_id ?? user.city_id ?? orderCityId,
            store_id: storeId,
            order_kind: 'distribution' as const,
            total_retail_amount: totalRetail,
            total_discount_amount: totalDiscount,
          };

          let orderInsert = await supabase
            .from('orders')
            .insert(baseOrderPayload)
            .select('id')
            .single();

          // Backward compatibility for databases that still keep legacy NOT NULL
          // columns on orders (quantity / unit_price / product_id) before full migration.
          if (orderInsert.error) {
            const message = String(orderInsert.error.message || '').toLowerCase();
            const details = String(orderInsert.error.details || '').toLowerCase();
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
            const notNullViolation = orderInsert.error.code === '23502';
            const legacyConstraintHit = notNullViolation && legacyColumnHit && onOrdersTable;

            if (legacyConstraintHit && orderItemsPayload.length > 0) {
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
                const retryDetails = String(orderInsert.error.details || '').toLowerCase();
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

          const { error: orderItemsError } = await supabase
            .from('order_items')
            .insert(orderItemsPayload.map((i) => ({ ...i, order_id: orderData.id })));
          if (orderItemsError) throw orderItemsError;

          await Promise.all(
            items.map(async (item) => {
              const product = products.find((p) => p.id === item.productId);
              if (!product) return;
              await get().updateInventory(item.productId, (product.quantity || 0) - item.quantity, { skipRefresh: true });
            }),
          );

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

          // Notify all admins about the new order
          const { data: admins } = await supabase
            .from('profiles')
            .select('id')
            .in('role', ['admin', 'super_admin']);
          if (admins && admins.length > 0) {
            const notifs = admins.map((a: { id: string }) => ({
              user_id: a.id,
              type: 'new_order' as const,
              order_id: orderData.id,
              message: `新订单 #${orderData.id.slice(0, 8)} 来自 ${selectedStore?.name || user.store_name || user.email}`,
            }));
            await supabase.from('notifications').insert(notifs);
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
          const { error: deleteError } = await supabase.rpc('delete_order_with_inventory_restore_atomic', {
            p_order_id: orderId,
          });
          if (deleteError) throw deleteError;

          await Promise.all([get().fetchOrders(), get().fetchProducts()]);
          return { error: null };
        } catch (error) {
          return { error: error as Error };
        }
      },

      uploadProductImage: async (uri) => {
        try {
          const {
            data: { session },
          } = await supabase.auth.getSession();
          if (!session?.user?.id) {
            throw new Error('登录状态已失效，请重新登录后再上传图片');
          }

          const fileName = `${session.user.id}/products/${Date.now()}.jpg`;
          const response = await fetch(uri);
          const imageBlob = await response.blob();

          const { error } = await supabase.storage
            .from('product-images')
            .upload(fileName, imageBlob, {
              contentType: 'image/jpeg',
            });

          if (error) throw error;

          const { data: urlData } = supabase.storage
            .from('product-images')
            .getPublicUrl(fileName);

          return { publicUrl: urlData?.publicUrl || null, error: null };
        } catch (error) {
          return { publicUrl: null, error: error as Error };
        }
      },
    }),
    {
      name: 'inventory-app-storage',
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (state) => ({
        user: state.user,
        isOfflineMode: state.isOfflineMode,
        isDarkMode: state.isDarkMode,
      }),
    },
  ),
);
