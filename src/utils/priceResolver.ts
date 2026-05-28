/**
 * Pure price resolution utility with 3-level store-aware precedence:
 *   1. store_product_prices.override_price  (store-level per-product override)
 *   2. stores.discount_rate × product.price  (store-level discount multiplier)
 *   3. product.discount_price                (product-level default discount)
 *   4. product.price                         (retail fallback)
 *
 * Key design decisions:
 *   - override_price = 0 is a VALID free override, not "missing"
 *   - discount_rate = 1.0 means "no multiplier discount" → falls through to next level
 *   - All null/undefined values are safely skipped
 *   - No Supabase / Zustand / UI coupling
 */

export type PriceLevel = 'override' | 'discount_rate' | 'discount_price' | 'retail';

export interface PriceResolverInput {
  /** Retail price of the product (required). */
  price: number;
  /** Product-level default discount price. */
  discount_price?: number | null;
  /** Store-level discount rate multiplier (e.g. 0.85 = pay 85% of retail). */
  discount_rate?: number | null;
  /** Store-level per-product price override. 0 = free item, not "missing". */
  override_price?: number | null;
}

export interface PriceResolverResult {
  /** The resolved unit price. */
  price: number;
  /** Which precedence level produced the price. */
  level: PriceLevel;
}

/**
 * Resolve the effective unit price for a product given optional store-level
 * and product-level pricing data.
 *
 * Precedence (highest wins):
 *   1. override_price — if present (including 0), always wins
 *   2. discount_rate × price — if discount_rate is set and ≠ 1.0
 *   3. discount_price — product-level default discount
 *   4. price — retail fallback
 */
export function resolvePrice(input: PriceResolverInput): PriceResolverResult {
  const { price, discount_price, discount_rate, override_price } = input;

  // Level 1: Store-product override (0 is a valid free override)
  if (override_price !== null && override_price !== undefined) {
    return { price: Number(override_price), level: 'override' };
  }

  // Level 2: Store discount rate (1.0 = no discount, fall through)
  if (discount_rate !== null && discount_rate !== undefined && discount_rate !== 1.0) {
    return { price: Number(discount_rate) * Number(price), level: 'discount_rate' };
  }

  // Level 3: Product default discount price (0 is a valid free discount)
  if (discount_price !== null && discount_price !== undefined) {
    return { price: Number(discount_price), level: 'discount_price' };
  }

  // Level 4: Retail fallback
  return { price: Number(price), level: 'retail' };
}
