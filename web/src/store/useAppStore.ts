import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { supabase, supabaseConfigError } from '../lib/supabase';
import { generateEAN13 } from '../utils/barcode';
import type {
  City,
  InventoryLog,
  Notification,
  Order,
  OrderItem,
  ProductCreateInput,
  ProfileUpdateInput,
  ProductWithDetails,
  Profile,
} from '../types';

interface ProfileRow {
  id: string;
  email: string;
  full_name?: string;
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
  product?: { name?: string; cities?: { name: string } | null } | null;
  products?: { name?: string; cities?: { name: string } | null } | null;
}

interface OrderRow {
  id: string;
  distributor_id: string;
  profiles?: { email?: string; store_name?: string | null } | Array<{ email?: string; store_name?: string | null }> | null;
  city_id?: string | null;
  cities?: { name: string } | Array<{ name: string }> | null;
  status: Order['status'];
  total_retail_amount?: number | string | null;
  total_discount_amount?: number | string | null;
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

interface CartCreateItem {
  productId: string;
  quantity: number;
}

interface RpcErrorLike {
  code?: string;
  message?: string;
}

const createRequestId = (userId: string): string => {
  const randomPart = Math.random().toString(36).slice(2, 10);
  return `batch-${userId}-${Date.now()}-${randomPart}`;
};

const shouldFallbackToLegacyFlow = (error: RpcErrorLike | null): boolean => {
  if (!error) return false;
  const message = String(error.message || '').toLowerCase();
  const missingByCode = error.code === '42883' || error.code === 'PGRST202';
  if (missingByCode) return true;
  return message.includes('could not find the function public.create_batch_order_atomic');
};

interface AppState {
  user: Profile | null;
  cities: City[];
  products: ProductWithDetails[];
  orders: Order[];
  notifications: Notification[];
  inventoryLogs: InventoryLog[];
  isLoading: boolean;

  setLoading: (loading: boolean) => void;
  signIn: (email: string, password: string) => Promise<{ error: Error | null }>;
  signOut: () => Promise<void>;

  fetchCities: () => Promise<void>;
  fetchProducts: () => Promise<void>;
  fetchOrders: () => Promise<void>;
  fetchNotifications: () => Promise<void>;
  fetchInventoryLogs: () => Promise<void>;
  fetchOrderDetail: (orderId: string) => Promise<Order | null>;
  fetchAllData: () => Promise<void>;

  addProduct: (payload: ProductCreateInput) => Promise<{ error: Error | null }>;
  updateProduct: (productId: string, payload: ProductCreateInput) => Promise<{ error: Error | null }>;
  updateInventoryByProduct: (
    productId: string,
    nextQty: number,
    options?: { action?: InventoryLog['action']; note?: string },
  ) => Promise<{ error: Error | null }>;
  inboundStockByBarcode: (barcode: string, quantity: number) => Promise<{ error: Error | null }>;
  createBatchOrders: (items: CartCreateItem[]) => Promise<{ error: Error | null }>;
  acceptOrder: (orderId: string) => Promise<{ error: Error | null }>;
  updateOwnProfile: (payload: ProfileUpdateInput) => Promise<{ error: Error | null }>;
  updateOwnStoreName: (storeName: string) => Promise<{ error: Error | null }>;
  markNotificationRead: (notificationId: string) => Promise<void>;
  markAllNotificationsRead: () => Promise<void>;
}

const orderSelect = `
  *,
  cities(name),
  profiles:distributor_id(email,store_name),
  order_items(
    *,
    products(
      name,
      cities(name)
    )
  )
`;

const mapProfile = (row: ProfileRow): Profile => ({
  id: row.id,
  email: row.email,
  full_name: row.full_name,
  role: row.role,
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

const mapOrder = (row: OrderRow): Order => {
  const itemsFromRelation: OrderItem[] = (row.order_items || []).map((item) => {
    const productInfo = item.products || item.product;
    return {
    id: item.id,
    order_id: item.order_id,
    product_id: item.product_id,
    product_name: productInfo?.name,
    city_name: productInfo?.cities?.name,
    quantity: Number(item.quantity || 0),
    retail_price: Number(item.retail_price || 0),
    discount_price: Number(item.discount_price || 0),
    unit_cost: Number(item.unit_cost || 0),
    one_time_cost: Number(item.one_time_cost || 0),
  };
  });

  const profileData = Array.isArray(row.profiles) ? row.profiles[0] : row.profiles;
  const cityData = Array.isArray(row.cities) ? row.cities[0] : row.cities;

  return {
    id: row.id,
    distributor_id: row.distributor_id,
    distributor_email: profileData?.email,
    distributor_store: profileData?.store_name ?? undefined,
    city_id: row.city_id ?? undefined,
    city_name: cityData?.name,
    status: row.status,
    total_retail_amount: Number(row.total_retail_amount || 0),
    total_discount_amount: Number(row.total_discount_amount || 0),
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
      notifications: [],
      inventoryLogs: [],
      isLoading: false,

      setLoading: (isLoading) => set({ isLoading }),

      signIn: async (email, password) => {
        set({ isLoading: true });
        try {
          if (supabaseConfigError) {
            throw new Error(supabaseConfigError);
          }

          const { data, error } = await supabase.auth.signInWithPassword({ email, password });
          if (error) throw error;

          if (data.user) {
            const { data: profile, error: profileError } = await supabase
              .from('profiles')
              .select('*, cities(name)')
              .eq('id', data.user.id)
              .single();
            if (profileError) throw profileError;
            set({ user: mapProfile(profile as ProfileRow) });
          }

          return { error: null };
        } catch (error) {
          return { error: error as Error };
        } finally {
          set({ isLoading: false });
        }
      },

      signOut: async () => {
        await supabase.auth.signOut();
        set({ user: null, cities: [], products: [], orders: [], notifications: [], inventoryLogs: [] });
      },

      fetchCities: async () => {
        const { data, error } = await supabase.from('cities').select('*').order('name');
        if (!error && data) set({ cities: data as City[] });
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

      fetchOrders: async () => {
        const { user } = get();
        if (!user) return;

        const { data, error } = await supabase
          .from('orders')
          .select(orderSelect)
          .order('created_at', { ascending: false })
          .limit(300);
        if (error || !data) return;

        const mapped = (data as OrderRow[])
          .map(mapOrder)
          .filter((order) => (user.role === 'distributor' ? order.distributor_id === user.id : true));
        set({ orders: mapped });
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
          .select('id, distributor_id, city_id, status, total_retail_amount, total_discount_amount, created_at, profiles:distributor_id(email,store_name), cities(name), product_id, quantity, unit_price, total_amount')
          .eq('id', orderId)
          .maybeSingle();
        if (orderError || !orderRow) return null;

        const base = mapOrder(orderRow as OrderRow);
        const row = orderRow as OrderRow;

        const { data: itemRows, error: itemError } = await supabase
          .from('order_items')
          .select('id, order_id, product_id, quantity, retail_price, discount_price, unit_cost, one_time_cost')
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
          };
        }

        return {
          ...base,
          items: [],
        };
      },

      fetchAllData: async () => {
        set({ isLoading: true });
        await Promise.all([
          get().fetchCities(),
          get().fetchProducts(),
          get().fetchOrders(),
          get().fetchNotifications(),
          get().fetchInventoryLogs(),
        ]);
        set({ isLoading: false });
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

      createBatchOrders: async (items) => {
        const { user, products } = get();
        if (!user) return { error: new Error('未登录') };
        if (items.length === 0) return { error: new Error('购物车为空') };

        try {
          if (user.role === 'distributor') {
            const outOfCity = items.find((item) => {
              const product = products.find((p) => p.id === item.productId);
              return product && product.city_id !== user.city_id;
            });
            if (outOfCity) return { error: new Error('分销商只能下所属城市商品') };
          }

          let totalRetail = 0;
          let totalDiscount = 0;
          let orderCityId: string | undefined;

          const orderItemsPayload = items.map((item) => {
            const product = products.find((p) => p.id === item.productId);
            if (!product) throw new Error('商品不存在');
            if (item.quantity <= 0 || item.quantity % 5 !== 0) throw new Error(`${product.name} 数量必须是5的倍数`);

            const available = Number(product.quantity || 0);
            if (available < item.quantity) throw new Error(`${product.name} 库存不足`);

            const retailPrice = Number(product.price || 0);
            const discountPrice = Number(product.discount_price || product.price || 0);
            const unitCost = Number(product.cost || 0);
            const oneTimeCost = Number(product.one_time_cost || 0);

            totalRetail += retailPrice * item.quantity;
            totalDiscount += discountPrice * item.quantity;
            orderCityId = product.city_id;

            return {
              product_id: product.id,
              quantity: item.quantity,
              retail_price: retailPrice,
              discount_price: discountPrice,
              unit_cost: unitCost,
              one_time_cost: oneTimeCost,
            };
          });

          const requestId = createRequestId(user.id);
          const { error: rpcError } = await supabase.rpc('create_batch_order_atomic', {
            p_items: orderItemsPayload,
            p_request_id: requestId,
          });

          if (!rpcError) {
            await Promise.all([get().fetchOrders(), get().fetchProducts(), get().fetchNotifications()]);
            return { error: null };
          }

          if (!shouldFallbackToLegacyFlow(rpcError as RpcErrorLike)) {
            throw rpcError;
          }

          const { data: orderData, error: orderError } = await supabase
            .from('orders')
            .insert({
              distributor_id: user.id,
              city_id: user.city_id ?? orderCityId,
              total_retail_amount: totalRetail,
              total_discount_amount: totalDiscount,
            })
            .select('id')
            .single();
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

          const { data: admins } = await supabase.from('profiles').select('id').eq('role', 'admin');
          if (admins && admins.length > 0) {
            const notifications = admins.map((admin: { id: string }) => ({
              user_id: admin.id,
              type: 'new_order' as const,
              order_id: orderData.id,
              message: `新订单 #${orderData.id.slice(0, 8)} 来自 ${user.store_name || user.email}`,
            }));
            await supabase.from('notifications').insert(notifications);
          }

          await Promise.all([get().fetchOrders(), get().fetchProducts(), get().fetchNotifications()]);
          return { error: null };
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
