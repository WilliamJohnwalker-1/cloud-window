import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '../lib/supabase';
import { generateEAN13 } from '../utils/barcode';
import { resolvePrice } from '../utils/priceResolver';
import type {
  Profile,
  City,
  Product,
  Inventory,
  Order,
  OrderItem,
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

interface ProfileRow {
  id: string;
  email: string;
  full_name?: string;
  avatar_url?: string | null;
  active_session_id?: string | null;
  role: Profile['role'];
  city_id?: string | null;
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

interface DistributorProductPriceRow {
  product_id: string;
  discount_price: number | string;
}

interface StoreCreateInput {
  name: string;
  city_id: string;
  distributor_id?: string | null;
  discount_rate?: number;
  address?: string;
  phone?: string;
}

interface StoreUpdateInput {
  name?: string;
  city_id?: string;
  distributor_id?: string | null;
  discount_rate?: number;
  address?: string;
  phone?: string;
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
  const storeNameRaw = typeof metadata.store_name === 'string' ? metadata.store_name.trim() : '';

  if (!isUuidLike(cityIdRaw) || !storeNameRaw) {
    throw new Error('账号资料不完整，无法自动创建档案。请联系管理员处理该账号。');
  }

  const { data: insertedProfile, error: insertError } = await supabase
    .from('profiles')
    .insert({
      id: authUser.id,
      email: authUser.email || '',
      role: 'distributor',
      city_id: cityIdRaw,
      store_name: storeNameRaw,
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

const shouldFallbackToLegacyFlow = (
  error: RpcErrorLike | null,
  rpcName: 'create_batch_order_atomic' | 'outbound_stock_atomic',
): boolean => {
  if (!error) return false;
  const message = String(error.message || '').toLowerCase();
  const missingByCode = error.code === '42883' || error.code === 'PGRST202';

  if (missingByCode) return true;

  if (rpcName === 'create_batch_order_atomic') {
    return message.includes('could not find the function public.create_batch_order_atomic');
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
    storeName?: string,
  ) => Promise<{ error: Error | null }>;
  signOut: () => Promise<void>;

  fetchCities: () => Promise<void>;
  moveCityOrder: (cityId: string, direction: 'up' | 'down') => Promise<{ error: Error | null }>;
  fetchProducts: () => Promise<void>;
  fetchInventory: () => Promise<void>;
  fetchOrders: () => Promise<void>;
  fetchDistributors: () => Promise<void>;
  fetchStores: () => Promise<void>;
  fetchStoreInventory: (storeId: string) => Promise<void>;
  fetchStoreProductPrices: (storeId: string) => Promise<void>;
  fetchAllData: () => Promise<void>;

  addCity: (name: string) => Promise<{ error: Error | null }>;
  deleteCity: (id: string) => Promise<{ error: Error | null }>;
  addStore: (store: StoreCreateInput) => Promise<{ error: Error | null }>;
  updateStore: (id: string, updates: StoreUpdateInput) => Promise<{ error: Error | null }>;
  deactivateStore: (id: string) => Promise<{ error: Error | null }>;
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
  updateInventorySettings: (
    productId: string,
    quantity: number,
    minQuantity: number,
  ) => Promise<{ error: Error | null }>;
  findProductByBarcode: (barcode: string) => ProductWithDetails | undefined;
  inboundStock: (barcode: string, quantity: number) => Promise<{ error: Error | null }>;
  outboundStock: (barcode: string, quantity: number) => Promise<{ error: Error | null }>;

  backfillBarcodes: () => Promise<{ count: number; error: Error | null }>;

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
  role: raw.role,
  city_id: raw.city_id,
  city_name: raw.cities?.name,
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
    address: raw.address ?? undefined,
    phone: raw.phone ?? undefined,
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
    order_kind: raw.order_kind || 'distribution',
    total_retail_amount: Number(raw.total_retail_amount || 0),
    total_discount_amount: Number(raw.total_discount_amount || 0),
    created_at: raw.created_at,
    items,
  };
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
        storeName?: string,
      ) => {
        set({ isLoading: true });
        try {
          const normalizedCityId = cityId?.trim();
          const normalizedStoreName = storeName?.trim();

          if (role === 'distributor') {
            if (!normalizedCityId) throw new Error('请选择归属城市');
            if (!isUuidLike(normalizedCityId)) {
              throw new Error('城市数据格式异常，请联系管理员检查城市配置');
            }
            if (!normalizedStoreName) throw new Error('请输入店面名称');
          }

          const { data, error } = await supabase.auth.signUp({
            email,
            password,
            options: {
              data: {
                role,
                city_id: normalizedCityId,
                store_name: normalizedStoreName,
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
          if (user.role !== 'admin') throw new Error('仅管理员可调整城市排序');

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

      fetchOrders: async () => {
        const { user } = get();
        if (!user) return;

        const { data, error } = await supabase
          .from('orders')
          .select(`
            *,
            cities(name),
            profiles:distributor_id(email,store_name),
            stores(name),
            order_items(
              *,
              products(name, city_id, cities(name))
            )
          `)
          .order('created_at', { ascending: false })
          .limit(200);

        if (error || !data) return;

        const mapped = data.map(mapOrder).filter((o) => (user.role === 'distributor' ? o.distributor_id === user.id : true));
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

      fetchDistributors: async () => {
        const { user } = get();
        if (!user || user.role !== 'admin') {
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
          if (user.role !== 'admin') throw new Error('仅管理员可创建店铺');

          const payload = {
            name: store.name.trim(),
            city_id: store.city_id,
            distributor_id: store.distributor_id || null,
            discount_rate: store.discount_rate !== undefined ? Number(store.discount_rate) : 1,
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
          if (user.role !== 'admin') throw new Error('仅管理员可编辑店铺');

          const payload: Record<string, string | number | null> = {
            updated_at: new Date().toISOString(),
          };

          if (updates.name !== undefined) payload.name = updates.name.trim();
          if (updates.city_id !== undefined) payload.city_id = updates.city_id;
          if (updates.distributor_id !== undefined) payload.distributor_id = updates.distributor_id || null;
          if (updates.discount_rate !== undefined) payload.discount_rate = Number(updates.discount_rate);
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
          if (user.role !== 'admin') throw new Error('仅管理员可停用店铺');

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
          if (user.role !== 'admin') throw new Error('仅管理员可设置店铺定价');

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

          if (user.role === 'distributor' && selectedStore && selectedStore.distributor_id !== user.id) {
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
            if (!isSample && item.quantity % 5 !== 0) {
              throw new Error(`${product.name} 数量必须是5的倍数`);
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
            .eq('role', 'admin');
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
          const { data: orderRows, error: orderFetchError } = await supabase
            .from('orders')
            .select('id, order_items(product_id, quantity)')
            .eq('id', orderId)
            .single();
          if (orderFetchError) throw orderFetchError;

          const items = (orderRows?.order_items || []) as Array<{ product_id: string; quantity: number }>;

          const { error: deleteError } = await supabase.from('orders').delete().eq('id', orderId);
          if (deleteError) throw deleteError;

          const restoreMap = new Map<string, number>();
          items.forEach((item) => {
            restoreMap.set(item.product_id, (restoreMap.get(item.product_id) || 0) + Number(item.quantity));
          });

          const restoreProductIds = Array.from(restoreMap.keys());
          if (restoreProductIds.length > 0) {
            const { data: inventoryRows, error: invFetchError } = await supabase
              .from('inventory')
              .select('product_id, quantity')
              .in('product_id', restoreProductIds);
            if (invFetchError) throw invFetchError;

            const currentInventoryMap = new Map(
              (inventoryRows || []).map((row) => [row.product_id as string, Number(row.quantity || 0)]),
            );

            for (const [productId, restoreQty] of restoreMap) {
              const { error: invUpdateError } = await supabase
                .from('inventory')
                .update({
                  quantity: (currentInventoryMap.get(productId) || 0) + restoreQty,
                  updated_at: new Date().toISOString(),
                })
                .eq('product_id', productId);
              if (invUpdateError) throw invUpdateError;
            }
          }

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
