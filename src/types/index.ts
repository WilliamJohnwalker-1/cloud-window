export type UserRole = 'admin' | 'super_admin' | 'distributor' | 'inventory_manager';

export interface Profile {
  id: string;
  email: string;
  full_name?: string;
  avatar_url?: string | null;
  role: UserRole;
  city_id?: string | null;
  city_name?: string;
  /** @deprecated Use Store.name instead. Kept for backward compatibility with profiles table. */
  store_name?: string | null;
  created_at: string;
  updated_at: string;
}

export interface City {
  id: string;
  name: string;
  sort_index?: number;
  created_at: string;
}

export interface Product {
  id: string;
  name: string;
  price: number;
  cost: number;
  one_time_cost: number;
  discount_price: number;
  barcode?: string;
  image_url?: string;
  city_id: string;
  created_at: string;
  updated_at: string;
}

export interface Inventory {
  id: string;
  product_id: string;
  quantity: number;
  min_quantity: number;
  updated_at: string;
}

export interface Store {
  id: string;
  name: string;
  city_id: string;
  city_name?: string;
  distributor_id?: string | null;
  distributor_email?: string | null;
  discount_rate: number;
  contact?: string;
  address?: string;
  phone?: string;
  status: 'active' | 'inactive';
  created_at: string;
  updated_at: string;
}

export interface StoreInventory {
  id: string;
  store_id: string;
  product_id: string;
  product_name?: string;
  quantity: number;
  updated_at: string;
}

export interface StoreProductPrice {
  id: string;
  store_id: string;
  product_id: string;
  override_price: number;
  created_at: string;
  updated_at: string;
}

export interface OrderItem {
  id: string;
  order_id: string;
  product_id: string;
  product_name?: string;
  city_name?: string;
  is_sample?: boolean;
  quantity: number;
  retail_price: number;
  discount_price: number;
  unit_cost: number;
  one_time_cost: number;
}

export interface Order {
  id: string;
  distributor_id: string;
  distributor_email?: string;
  distributor_store?: string;
  store_id?: string | null;
  store_name?: string | null;
  city_id?: string;
  city_name?: string;
  order_kind: OrderKind;
  status: OrderStatus;
  payment_method?: PaymentMethod | null;
  payment_status?: PaymentStatus | null;
  payment_transaction_id?: string | null;
  payment_amount?: number | null;
  payment_paid_at?: string | null;
  payment_note?: string | null;
  total_retail_amount: number;
  total_discount_amount: number;
  created_at: string;
  items: OrderItem[];
}

export interface ProductWithDetails extends Product {
  barcode?: string;
  city_name?: string;
  quantity?: number;
  min_quantity?: number;
}

export interface SalesReport {
  totalRetailSales: number;
  totalDiscountSales: number;
  totalOrders: number;
  topProducts: { name: string; total: number }[];
  salesByCity: { city: string; total: number }[];
  salesByDay: { date: string; total: number }[];
}

export interface InventoryReport {
  totalProducts: number;
  lowStockItems: ProductWithDetails[];
  inventoryByCity: { city: string; quantity: number }[];
}

export type OrderStatus = 'pending' | 'accepted';

export type OrderKind = 'distribution' | 'retail';

export type NotificationType = 'new_order' | 'order_accepted';

export type PaymentMethod = 'wechat' | 'alipay';

export type PaymentStatus = 'pending' | 'paid' | 'failed' | 'timeout';

export interface Notification {
  id: string;
  user_id: string;
  type: NotificationType;
  order_id?: string;
  message: string;
  is_read: boolean;
  created_at: string;
}

export interface ProfitReport {
  totalRetailRevenue: number;
  totalDiscountRevenue: number;
  totalCost: number;
  totalProfit: number;
  profitByProduct: { name: string; profit: number }[];
  profitByCity: { city: string; profit: number }[];
}
