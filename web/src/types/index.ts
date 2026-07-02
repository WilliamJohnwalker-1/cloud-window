export type UserRole = 'admin' | 'super_admin' | 'distributor' | 'inventory_manager' | 'finance';

export interface Profile {
  id: string;
  email: string;
  full_name?: string;
  avatar_url?: string | null;
  role: UserRole;
  city_id?: string | null;
  city_name?: string;
  default_store_id?: string | null;
  /** @deprecated Use Store.name instead. Kept for backward compatibility with profiles table. */
  store_name?: string | null;
  created_at: string;
  updated_at: string;
}

export interface City {
  id: string;
  name: string;
  sort_index?: number;
  province?: string;
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
  sku?: string | null;
  category?: string | null;
  series_id?: string | null;
  series_name?: string;
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
  settlement_day?: number | null;
  cooperation_mode?: 'consignment' | 'buyout' | 'direct' | null;
  status: 'active' | 'inactive';
  contract_expiry_date?: string | null;
  grade?: 'S' | 'A' | 'B' | 'C' | 'D' | 'E' | null;
  contract_file_url?: string | null;
  invoice_title?: string | null;
  tax_id?: string | null;
  bank_name?: string | null;
  bank_account?: string | null;
  created_at: string;
  updated_at: string;
}

export interface StoreInventory {
  id: string;
  store_id: string;
  product_id: string;
  product_name?: string;
  quantity: number;
  min_quantity?: number;
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
  supplier_id?: string | null;
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
  refunded_items?: RefundedOrderItem[];
}

export interface ProductWithDetails extends Product {
  barcode?: string;
  city_name?: string;
  quantity?: number;
  min_quantity?: number;
}

export interface RefundedOrderItem {
  order_item_id: string;
  product_id: string;
  product_name?: string;
  quantity: number;
  retail_price: number;
  discount_price: number;
  refunded_at?: string;
}

export interface InventoryLog {
  id: string;
  product_id: string;
  product_name?: string;
  operator_id: string;
  action: 'inbound' | 'manual_adjust' | 'quick_add' | 'quick_reduce' | 'breakage' | 'purchase_receive' | 'sell' | 'refund_restore' | 'outbound';
  delta_quantity: number;
  before_quantity: number;
  after_quantity: number;
  note?: string;
  created_at: string;
}

export interface ProductCreateInput {
  name: string;
  price: number;
  cost: number;
  one_time_cost: number;
  discount_price: number;
  city_id: string;
  series_id?: string | null;
  image_url?: string;
  sku?: string | null;
  category?: string | null;
}

export interface ProfileUpdateInput {
  full_name?: string;
  store_name?: string;
  avatar_url?: string | null;
  default_store_id?: string | null;
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

export type OrderKind = 'distribution' | 'retail' | 'settlement' | 'purchase';

export type NotificationType =
  | 'new_order'
  | 'order_accepted'
  | 'refund_requested'
  | 'refund_approved'
  | 'refund_rejected'
  | 'refund_completed'
  | 'refund_failed'
  | 'inventory_alert'
  | 'inventory_slow_moving_alert';

export type PaymentMethod = 'wechat' | 'alipay' | 'unknown' | 'offline_settlement' | string;

export type PaymentStatus = 'pending' | 'paid' | 'failed' | 'timeout' | 'refunded' | 'partial_refunded' | string;


export type FinanceReportType = 'finance' | 'inventory_turnover' | 'revenue' | 'supply' | 'sales';

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

export interface Supplier {
  id: string;
  company_name: string;
  delivery_cycle_days?: number | null;
  avg_unit_price?: number | null;
  contact?: string | null;
  phone?: string | null;
  address?: string | null;
  status: 'active' | 'inactive';
  created_at: string;
  updated_at: string;
}

export interface ProductSeries {
  id: string;
  name: string;
  sort_index: number;
  created_at: string;
}

export interface FinancialTransaction {
  id: string;
  transaction_type: 'income' | 'expense';
  category: string;
  subcategory?: string;
  amount: number;
  transaction_date: string;
  store_id?: string | null;
  city_id?: string | null;
  city_name?: string | null;
  supplier_id?: string | null;
  product_id?: string | null;
  channel_name?: string | null;
  description?: string | null;
  is_recurring: boolean;
  recurring_frequency?: 'monthly' | 'quarterly' | 'semiannual' | 'annual' | null;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export interface KnowledgeBaseFile {
  id: string;
  file_name: string;
  file_path: string;
  file_size: number;
  file_type: string;
  category: 'contract_template' | 'internal_contract' | 'business_license' | 'other';
  uploaded_by: string;
  created_at: string;
}

export type PurchaseOrderStatus = 'pending' | 'partially_delivered' | 'delivered';

export type PurchaseItemDeliveryStatus = 'pending' | 'delivered';

export interface PurchaseOrder {
  id: string;
  store_id: string;
  store_name?: string;
  city_id: string;
  city_name?: string;
  supplier_id?: string | null;
  supplier_name?: string | null;
  status: PurchaseOrderStatus;
  created_by: string;
  notes?: string | null;
  created_at: string;
  updated_at: string;
  items?: PurchaseOrderItem[];
}

export interface PurchaseOrderItem {
  id: string;
  purchase_order_id: string;
  product_id: string;
  product_name?: string;
  ordered_quantity: number;
  delivered_quantity: number;
  delivery_status: PurchaseItemDeliveryStatus;
  delivered_at?: string | null;
  confirmed_by?: string | null;
  unit_cost: number;
  created_at: string;
}
