import { describe, expect, it } from 'vitest';

import { buildStoreRetailOrderRpcItems } from '../storeRetailOrder';

describe('buildStoreRetailOrderRpcItems', () => {
  it('maps valid retail cart items to rpc payload fields', () => {
    const payload = buildStoreRetailOrderRpcItems([
      { product_id: 'p-1', quantity: 3, price: 12.5 },
      { product_id: 'p-2', quantity: 7, price: 88 },
    ]);

    expect(payload).toEqual([
      { product_id: 'p-1', quantity: 3 },
      { product_id: 'p-2', quantity: 7 },
    ]);
  });

  it('keeps zero and negative values untouched for store-layer validation', () => {
    const payload = buildStoreRetailOrderRpcItems([
      { product_id: 'p-1', quantity: 0 },
      { product_id: 'p-2', quantity: -1 },
    ]);

    expect(payload).toEqual([
      { product_id: 'p-1', quantity: 0 },
      { product_id: 'p-2', quantity: -1 },
    ]);
  });

  it('normalizes numeric strings via Number conversion', () => {
    const payload = buildStoreRetailOrderRpcItems([
      { product_id: 'p-1', quantity: '9' as unknown as number },
    ]);

    expect(payload).toEqual([{ product_id: 'p-1', quantity: 9 }]);
  });
});
