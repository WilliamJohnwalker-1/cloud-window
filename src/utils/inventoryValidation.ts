/**
 * Pure inventory validation utilities extracted from useAppStore.
 *
 * All functions are side-effect-free and suitable for unit testing.
 * No Supabase / Zustand / UI coupling.
 */

// ─── RPC Error Detection ───

export interface RpcErrorLike {
  code?: string;
  message?: string;
}

/**
 * Determine whether an RPC error indicates a missing function,
 * in which case the client should fall back to the legacy flow.
 */
export function shouldFallbackToLegacyFlow(
  error: RpcErrorLike | null,
  rpcName: 'create_batch_order_atomic' | 'outbound_stock_atomic',
): boolean {
  if (!error) return false;
  const message = String(error.message || '').toLowerCase();
  const missingByCode = error.code === '42883' || error.code === 'PGRST202';

  if (missingByCode) return true;

  if (rpcName === 'create_batch_order_atomic') {
    return message.includes('could not find the function public.create_batch_order_atomic');
  }

  return message.includes('could not find the function public.outbound_stock_atomic');
}

/**
 * Generic check: does the error indicate a missing RPC function?
 */
export function isMissingRpcFunction(error: RpcErrorLike | null): boolean {
  if (!error) return false;
  const message = String(error.message || '').toLowerCase();
  return (
    error.code === '42883'
    || error.code === 'PGRST202'
    || message.includes('could not find the function')
  );
}

// ─── Order Item Validation ───

export interface OrderItemInput {
  productId: string;
  quantity: number;
  isSample?: boolean;
}

export interface ProductAvailability {
  name: string;
  quantity: number;
  city_id: string;
}

export interface OrderItemValidationResult {
  valid: boolean;
  error?: string;
}

/**
 * Validate a single order item against business rules:
 *   - quantity must be > 0
 *   - non-sample items must have quantity that is a multiple of 5
 *   - available stock must be sufficient
 */
export function validateOrderItem(
  item: OrderItemInput,
  product: ProductAvailability | undefined,
): OrderItemValidationResult {
  if (!product) {
    return { valid: false, error: '商品不存在' };
  }

  if (item.quantity <= 0) {
    return { valid: false, error: `${product.name} 数量必须大于0` };
  }

  const isSample = Boolean(item.isSample);
  if (!isSample && item.quantity % 5 !== 0) {
    return { valid: false, error: `${product.name} 数量必须是5的倍数` };
  }

  const available = product.quantity ?? 0;
  if (available < item.quantity) {
    return { valid: false, error: `${product.name} 库存不足` };
  }

  return { valid: true };
}

// ─── Inbound / Outbound Quantity Validation ───

export interface QuantityValidationResult {
  valid: boolean;
  error?: string;
}

/**
 * Validate inbound stock quantity.
 * Rules: quantity must be > 0.
 */
export function validateInboundQuantity(quantity: number): QuantityValidationResult {
  if (quantity <= 0) {
    return { valid: false, error: '入库数量必须大于0' };
  }
  return { valid: true };
}

/**
 * Validate outbound stock quantity against current inventory.
 * Rules: quantity must be > 0, and current stock must be sufficient.
 */
export function validateOutboundQuantity(
  quantity: number,
  currentStock: number,
): QuantityValidationResult {
  if (quantity <= 0) {
    return { valid: false, error: '出库数量必须大于0' };
  }
  if (currentStock < quantity) {
    return { valid: false, error: '库存不足' };
  }
  return { valid: true };
}

// ─── Request ID Generation ───

/**
 * Create a deterministic-ish request ID for RPC idempotency.
 * Format: {prefix}-{userId}-{timestamp}-{random}
 */
export function createRequestId(
  prefix: 'batch' | 'outbound',
  userId: string,
): string {
  const randomPart = Math.random().toString(36).slice(2, 10);
  return `${prefix}-${userId}-${Date.now()}-${randomPart}`;
}

/**
 * Validate that a request ID has the expected structure.
 * Checks: non-empty, starts with 'batch-' or 'outbound-', contains at least 3 hyphens.
 */
export function isValidRequestId(requestId: string): boolean {
  if (!requestId) return false;
  const hasValidPrefix = requestId.startsWith('batch-') || requestId.startsWith('outbound-');
  const parts = requestId.split('-');
  return hasValidPrefix && parts.length >= 4;
}

// ─── Outbound Order Amount Calculation ───

/**
 * Calculate retail order amounts for outbound stock operations.
 * Outbound orders are always retail-priced (no discount).
 */
export function calculateOutboundOrderAmounts(
  retailPrice: number,
  quantity: number,
): { totalRetailAmount: number; totalDiscountAmount: number } {
  return {
    totalRetailAmount: retailPrice * quantity,
    totalDiscountAmount: retailPrice * quantity,
  };
}

// ─── Barcode Lookup ───

export interface BarcodeProduct {
  id: string;
  barcode?: string | null;
}

/**
 * Find a product by its barcode value.
 * Normalizes whitespace and returns undefined if barcode is empty or not found.
 */
export function findProductByBarcode<T extends BarcodeProduct>(
  barcode: string,
  products: T[],
): T | undefined {
  const normalized = barcode.trim();
  if (!normalized) return undefined;
  return products.find((product) => product.barcode === normalized);
}
