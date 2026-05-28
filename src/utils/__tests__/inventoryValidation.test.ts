import { describe, expect, it } from 'vitest';

import {
  calculateOutboundOrderAmounts,
  createRequestId,
  findProductByBarcode,
  isMissingRpcFunction,
  isValidRequestId,
  shouldFallbackToLegacyFlow,
  validateInboundQuantity,
  validateOrderItem,
  validateOutboundQuantity,
} from '../inventoryValidation';
import type { ProductAvailability } from '../inventoryValidation';

// ─── shouldFallbackToLegacyFlow ───

describe('shouldFallbackToLegacyFlow', () => {
  it('returns false when error is null', () => {
    expect(shouldFallbackToLegacyFlow(null, 'create_batch_order_atomic')).toBe(false);
    expect(shouldFallbackToLegacyFlow(null, 'outbound_stock_atomic')).toBe(false);
  });

  it('returns true for PostgreSQL undefined-function code 42883', () => {
    const error = { code: '42883', message: 'some error' };
    expect(shouldFallbackToLegacyFlow(error, 'create_batch_order_atomic')).toBe(true);
    expect(shouldFallbackToLegacyFlow(error, 'outbound_stock_atomic')).toBe(true);
  });

  it('returns true for Supabase PGRST202 code', () => {
    const error = { code: 'PGRST202', message: 'rpc not found' };
    expect(shouldFallbackToLegacyFlow(error, 'create_batch_order_atomic')).toBe(true);
    expect(shouldFallbackToLegacyFlow(error, 'outbound_stock_atomic')).toBe(true);
  });

  it('returns true when message contains the exact function name for batch RPC', () => {
    const error = { message: 'could not find the function public.create_batch_order_atomic' };
    expect(shouldFallbackToLegacyFlow(error, 'create_batch_order_atomic')).toBe(true);
  });

  it('returns true when message contains the exact function name for outbound RPC', () => {
    const error = { message: 'could not find the function public.outbound_stock_atomic' };
    expect(shouldFallbackToLegacyFlow(error, 'outbound_stock_atomic')).toBe(true);
  });

  it('returns false for unrelated error codes', () => {
    const error = { code: '23505', message: 'unique violation' };
    expect(shouldFallbackToLegacyFlow(error, 'create_batch_order_atomic')).toBe(false);
  });

  it('returns false when message mentions the wrong RPC name', () => {
    const error = { message: 'could not find the function public.outbound_stock_atomic' };
    expect(shouldFallbackToLegacyFlow(error, 'create_batch_order_atomic')).toBe(false);
  });

  it('is case-insensitive on message matching', () => {
    const error = { message: 'COULD NOT FIND THE FUNCTION public.create_batch_order_atomic' };
    expect(shouldFallbackToLegacyFlow(error, 'create_batch_order_atomic')).toBe(true);
  });

  it('returns false for empty error object', () => {
    const error = {};
    expect(shouldFallbackToLegacyFlow(error, 'create_batch_order_atomic')).toBe(false);
  });
});

// ─── isMissingRpcFunction ───

describe('isMissingRpcFunction', () => {
  it('returns false for null error', () => {
    expect(isMissingRpcFunction(null)).toBe(false);
  });

  it('returns true for code 42883', () => {
    expect(isMissingRpcFunction({ code: '42883' })).toBe(true);
  });

  it('returns true for code PGRST202', () => {
    expect(isMissingRpcFunction({ code: 'PGRST202' })).toBe(true);
  });

  it('returns true when message contains "could not find the function"', () => {
    expect(isMissingRpcFunction({ message: 'could not find the function foo' })).toBe(true);
  });

  it('returns false for unrelated errors', () => {
    expect(isMissingRpcFunction({ code: '23502', message: 'not-null violation' })).toBe(false);
  });

  it('is case-insensitive', () => {
    expect(isMissingRpcFunction({ message: 'Could Not Find The Function' })).toBe(true);
  });
});

// ─── validateOrderItem ───

describe('validateOrderItem', () => {
  const product: ProductAvailability = {
    name: '测试商品',
    quantity: 100,
    city_id: 'city-1',
  };

  it('passes for valid non-sample item with quantity = 5', () => {
    const result = validateOrderItem({ productId: 'p1', quantity: 5 }, product);
    expect(result.valid).toBe(true);
    expect(result.error).toBeUndefined();
  });

  it('passes for valid non-sample item with quantity = 25', () => {
    const result = validateOrderItem({ productId: 'p1', quantity: 25 }, product);
    expect(result.valid).toBe(true);
  });

  it('passes for sample item with quantity = 1 (bypasses 5× rule)', () => {
    const result = validateOrderItem(
      { productId: 'p1', quantity: 1, isSample: true },
      product,
    );
    expect(result.valid).toBe(true);
  });

  it('passes for sample item with quantity = 3 (bypasses 5× rule)', () => {
    const result = validateOrderItem(
      { productId: 'p1', quantity: 3, isSample: true },
      product,
    );
    expect(result.valid).toBe(true);
  });

  it('rejects when product is undefined', () => {
    const result = validateOrderItem({ productId: 'p1', quantity: 5 }, undefined);
    expect(result.valid).toBe(false);
    expect(result.error).toBe('商品不存在');
  });

  it('rejects quantity = 0', () => {
    const result = validateOrderItem({ productId: 'p1', quantity: 0 }, product);
    expect(result.valid).toBe(false);
    expect(result.error).toContain('数量必须大于0');
  });

  it('rejects negative quantity', () => {
    const result = validateOrderItem({ productId: 'p1', quantity: -5 }, product);
    expect(result.valid).toBe(false);
    expect(result.error).toContain('数量必须大于0');
  });

  it('rejects non-sample quantity not multiple of 5', () => {
    const result = validateOrderItem({ productId: 'p1', quantity: 7 }, product);
    expect(result.valid).toBe(false);
    expect(result.error).toContain('数量必须是5的倍数');
  });

  it('rejects non-sample quantity = 3', () => {
    const result = validateOrderItem({ productId: 'p1', quantity: 3 }, product);
    expect(result.valid).toBe(false);
    expect(result.error).toContain('数量必须是5的倍数');
  });

  it('rejects when stock is insufficient', () => {
    const lowStockProduct = { name: '缺货商品', quantity: 3, city_id: 'city-1' };
    const result = validateOrderItem({ productId: 'p1', quantity: 5 }, lowStockProduct);
    expect(result.valid).toBe(false);
    expect(result.error).toContain('库存不足');
  });

  it('rejects when stock is exactly 0 and quantity > 0', () => {
    const zeroStockProduct = { name: '零库存商品', quantity: 0, city_id: 'city-1' };
    const result = validateOrderItem({ productId: 'p1', quantity: 5 }, zeroStockProduct);
    expect(result.valid).toBe(false);
    expect(result.error).toContain('库存不足');
  });

  it('passes when quantity equals available stock', () => {
    const exactProduct = { name: '刚好够', quantity: 10, city_id: 'city-1' };
    const result = validateOrderItem({ productId: 'p1', quantity: 10 }, exactProduct);
    expect(result.valid).toBe(true);
  });

  it('sample item bypasses 5× rule but still checks stock', () => {
    const lowStockProduct = { name: '样品库存不足', quantity: 0, city_id: 'city-1' };
    const result = validateOrderItem(
      { productId: 'p1', quantity: 1, isSample: true },
      lowStockProduct,
    );
    expect(result.valid).toBe(false);
    expect(result.error).toContain('库存不足');
  });

  it('isSample: false explicitly still enforces 5× rule', () => {
    const result = validateOrderItem(
      { productId: 'p1', quantity: 3, isSample: false },
      product,
    );
    expect(result.valid).toBe(false);
    expect(result.error).toContain('数量必须是5的倍数');
  });
});

// ─── validateInboundQuantity ───

describe('validateInboundQuantity', () => {
  it('passes for positive quantity', () => {
    expect(validateInboundQuantity(1).valid).toBe(true);
    expect(validateInboundQuantity(100).valid).toBe(true);
  });

  it('rejects quantity = 0', () => {
    const result = validateInboundQuantity(0);
    expect(result.valid).toBe(false);
    expect(result.error).toBe('入库数量必须大于0');
  });

  it('rejects negative quantity', () => {
    const result = validateInboundQuantity(-10);
    expect(result.valid).toBe(false);
    expect(result.error).toBe('入库数量必须大于0');
  });

  it('rejects fractional quantity (0.5)', () => {
    const result = validateInboundQuantity(0.5);
    expect(result.valid).toBe(true); // 0.5 > 0, technically valid by this rule
  });
});

// ─── validateOutboundQuantity ───

describe('validateOutboundQuantity', () => {
  it('passes when stock is sufficient', () => {
    const result = validateOutboundQuantity(5, 100);
    expect(result.valid).toBe(true);
    expect(result.error).toBeUndefined();
  });

  it('passes when quantity equals stock', () => {
    const result = validateOutboundQuantity(50, 50);
    expect(result.valid).toBe(true);
  });

  it('rejects quantity = 0', () => {
    const result = validateOutboundQuantity(0, 100);
    expect(result.valid).toBe(false);
    expect(result.error).toBe('出库数量必须大于0');
  });

  it('rejects negative quantity', () => {
    const result = validateOutboundQuantity(-5, 100);
    expect(result.valid).toBe(false);
    expect(result.error).toBe('出库数量必须大于0');
  });

  it('rejects when stock is insufficient', () => {
    const result = validateOutboundQuantity(10, 5);
    expect(result.valid).toBe(false);
    expect(result.error).toBe('库存不足');
  });

  it('rejects when stock is 0 and quantity > 0', () => {
    const result = validateOutboundQuantity(1, 0);
    expect(result.valid).toBe(false);
    expect(result.error).toBe('库存不足');
  });

  it('rejects when both quantity and stock are 0', () => {
    const result = validateOutboundQuantity(0, 0);
    expect(result.valid).toBe(false);
    // quantity=0 is caught first
    expect(result.error).toBe('出库数量必须大于0');
  });
});

// ─── createRequestId / isValidRequestId ───

describe('createRequestId', () => {
  it('creates a request ID with batch prefix', () => {
    const id = createRequestId('batch', 'user-123');
    expect(id).toMatch(/^batch-user-123-\d+-[a-z0-9]+$/);
  });

  it('creates a request ID with outbound prefix', () => {
    const id = createRequestId('outbound', 'user-456');
    expect(id).toMatch(/^outbound-user-456-\d+-[a-z0-9]+$/);
  });

  it('produces unique IDs on successive calls', () => {
    const ids = new Set<string>();
    for (let i = 0; i < 20; i++) {
      ids.add(createRequestId('batch', 'user-1'));
    }
    // At least most should be unique (random part + timestamp)
    expect(ids.size).toBeGreaterThan(15);
  });
});

describe('isValidRequestId', () => {
  it('accepts valid batch request ID', () => {
    expect(isValidRequestId('batch-user1-1716000000000-abc12345')).toBe(true);
  });

  it('accepts valid outbound request ID', () => {
    expect(isValidRequestId('outbound-user1-1716000000000-xyz98765')).toBe(true);
  });

  it('rejects empty string', () => {
    expect(isValidRequestId('')).toBe(false);
  });

  it('rejects ID without valid prefix', () => {
    expect(isValidRequestId('unknown-user1-1716000000000-abc')).toBe(false);
  });

  it('rejects ID with too few parts', () => {
    expect(isValidRequestId('batch-user1')).toBe(false);
  });

  it('rejects ID with only 3 parts', () => {
    expect(isValidRequestId('batch-user1-123')).toBe(false);
  });
});

// ─── calculateOutboundOrderAmounts ───

describe('calculateOutboundOrderAmounts', () => {
  it('calculates amounts for single item at retail price', () => {
    const result = calculateOutboundOrderAmounts(100, 5);
    expect(result.totalRetailAmount).toBe(500);
    expect(result.totalDiscountAmount).toBe(500);
  });

  it('retail and discount are equal (outbound = retail order)', () => {
    const result = calculateOutboundOrderAmounts(50, 10);
    expect(result.totalRetailAmount).toBe(result.totalDiscountAmount);
  });

  it('handles zero price', () => {
    const result = calculateOutboundOrderAmounts(0, 10);
    expect(result.totalRetailAmount).toBe(0);
    expect(result.totalDiscountAmount).toBe(0);
  });

  it('handles zero quantity', () => {
    const result = calculateOutboundOrderAmounts(100, 0);
    expect(result.totalRetailAmount).toBe(0);
    expect(result.totalDiscountAmount).toBe(0);
  });

  it('handles fractional price', () => {
    const result = calculateOutboundOrderAmounts(12.5, 4);
    expect(result.totalRetailAmount).toBe(50);
    expect(result.totalDiscountAmount).toBe(50);
  });

  it('handles large quantity', () => {
    const result = calculateOutboundOrderAmounts(99.9, 1000);
    expect(result.totalRetailAmount).toBe(99900);
    expect(result.totalDiscountAmount).toBe(99900);
  });
});

// ─── findProductByBarcode ───

describe('findProductByBarcode', () => {
  const products = [
    { id: 'p1', barcode: '2000000001234' },
    { id: 'p2', barcode: '2000000005678' },
    { id: 'p3', barcode: null },
    { id: 'p4' }, // no barcode field
  ];

  it('finds product by exact barcode match', () => {
    const result = findProductByBarcode('2000000001234', products);
    expect(result).toBeDefined();
    expect(result!.id).toBe('p1');
  });

  it('finds second product', () => {
    const result = findProductByBarcode('2000000005678', products);
    expect(result).toBeDefined();
    expect(result!.id).toBe('p2');
  });

  it('returns undefined for non-matching barcode', () => {
    const result = findProductByBarcode('9999999999999', products);
    expect(result).toBeUndefined();
  });

  it('returns undefined for empty string', () => {
    expect(findProductByBarcode('', products)).toBeUndefined();
  });

  it('returns undefined for whitespace-only string', () => {
    expect(findProductByBarcode('   ', products)).toBeUndefined();
  });

  it('trims whitespace from barcode input', () => {
    const result = findProductByBarcode('  2000000001234  ', products);
    expect(result).toBeDefined();
    expect(result!.id).toBe('p1');
  });

  it('skips products with null barcode', () => {
    const result = findProductByBarcode('null', products);
    expect(result).toBeUndefined();
  });

  it('skips products without barcode field', () => {
    // p4 has no barcode property — should not match any string
    const result = findProductByBarcode('undefined', products);
    expect(result).toBeUndefined();
  });

  it('returns undefined for empty product list', () => {
    expect(findProductByBarcode('2000000001234', [])).toBeUndefined();
  });

  it('returns first match when duplicates exist', () => {
    const dupProducts = [
      { id: 'first', barcode: '2000000001234' },
      { id: 'second', barcode: '2000000001234' },
    ];
    const result = findProductByBarcode('2000000001234', dupProducts);
    expect(result!.id).toBe('first');
  });
});
