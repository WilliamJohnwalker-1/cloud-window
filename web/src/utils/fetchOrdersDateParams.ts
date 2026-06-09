export interface OrdersDateFilterQuery<T> {
  gte: (column: string, value: string) => T;
  lte: (column: string, value: string) => T;
}

const normalizeDateInput = (value?: string): string | null => {
  const normalized = String(value || '').trim();
  return normalized ? normalized : null;
};

export const applyOrdersDateFilters = <T extends OrdersDateFilterQuery<T>>(
  query: T,
  startDate?: string,
  endDate?: string,
): T => {
  let nextQuery = query;

  const normalizedStartDate = normalizeDateInput(startDate);
  const normalizedEndDate = normalizeDateInput(endDate);

  if (normalizedStartDate) {
    nextQuery = nextQuery.gte('created_at', normalizedStartDate);
  }

  if (normalizedEndDate) {
    nextQuery = nextQuery.lte('created_at', normalizedEndDate);
  }

  return nextQuery;
};
