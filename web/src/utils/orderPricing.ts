import type { ProductWithDetails } from '../types';

interface RetailOrderLineInput {
  product: ProductWithDetails;
  quantity: number;
}

export const getRetailUnitPrice = (product: ProductWithDetails): number => Number(product.price || 0);

export const calculateRetailOrderTotals = (lines: RetailOrderLineInput[]): { totalRetail: number; totalDiscount: number } => {
  const totalRetail = lines.reduce((sum, line) => sum + getRetailUnitPrice(line.product) * Number(line.quantity || 0), 0);

  return {
    totalRetail,
    totalDiscount: totalRetail,
  };
};
