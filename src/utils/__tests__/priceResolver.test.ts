import { describe, expect, it } from 'vitest';

import { resolvePrice } from '../priceResolver';

describe('resolvePrice', () => {
  it('uses store override_price when set (highest precedence)', () => {
    const result = resolvePrice({
      price: 100,
      discount_price: 80,
      discount_rate: 0.85,
      override_price: 70,
    });
    expect(result.price).toBe(70);
    expect(result.level).toBe('override');
  });

  it('falls back to discount_rate × price when no override', () => {
    const result = resolvePrice({
      price: 100,
      discount_price: 80,
      discount_rate: 0.85,
    });
    expect(result.price).toBe(85);
    expect(result.level).toBe('discount_rate');
  });

  it('falls back to product discount_price when no override and no discount_rate', () => {
    const result = resolvePrice({
      price: 100,
      discount_price: 80,
    });
    expect(result.price).toBe(80);
    expect(result.level).toBe('discount_price');
  });

  it('treats discount_rate = 1.0 as no multiplier discount and falls through', () => {
    const result = resolvePrice({
      price: 100,
      discount_price: 75,
      discount_rate: 1.0,
    });
    // discount_rate 1.0 = no discount → skip to discount_price
    expect(result.price).toBe(75);
    expect(result.level).toBe('discount_price');
  });

  it('treats override_price = 0 as a valid free override, not missing', () => {
    const result = resolvePrice({
      price: 100,
      discount_price: 80,
      discount_rate: 0.9,
      override_price: 0,
    });
    expect(result.price).toBe(0);
    expect(result.level).toBe('override');
  });

  it('falls back to retail price when all optional fields are null', () => {
    const result = resolvePrice({
      price: 100,
      discount_price: null,
      discount_rate: null,
      override_price: null,
    });
    expect(result.price).toBe(100);
    expect(result.level).toBe('retail');
  });

  it('falls back to retail price when only price is provided', () => {
    const result = resolvePrice({ price: 50 });
    expect(result.price).toBe(50);
    expect(result.level).toBe('retail');
  });

  it('treats discount_price = 0 as a valid free discount, not missing', () => {
    const result = resolvePrice({
      price: 100,
      discount_price: 0,
    });
    expect(result.price).toBe(0);
    expect(result.level).toBe('discount_price');
  });

  it('skips undefined discount_rate and uses discount_price', () => {
    const result = resolvePrice({
      price: 200,
      discount_price: 150,
      discount_rate: undefined,
    });
    expect(result.price).toBe(150);
    expect(result.level).toBe('discount_price');
  });

  it('uses discount_rate when override is undefined and discount_price is null', () => {
    const result = resolvePrice({
      price: 200,
      discount_price: null,
      discount_rate: 0.9,
      override_price: undefined,
    });
    expect(result.price).toBe(180);
    expect(result.level).toBe('discount_rate');
  });
});
