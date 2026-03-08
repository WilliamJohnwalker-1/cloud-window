import { describe, expect, it } from 'vitest';

import { generateEAN13, isValidEAN13 } from './barcode';

describe('barcode utilities', () => {
  it('generates valid EAN13 barcode from sequence', () => {
    const barcode = generateEAN13(123);
    expect(barcode).toHaveLength(13);
    expect(isValidEAN13(barcode)).toBe(true);
  });

  it('rejects invalid EAN13 values', () => {
    expect(isValidEAN13('1234567890123')).toBe(false);
    expect(isValidEAN13('abc')).toBe(false);
    expect(isValidEAN13('')).toBe(false);
  });
});
