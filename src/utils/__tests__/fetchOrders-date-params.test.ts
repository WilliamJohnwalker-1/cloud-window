import { describe, expect, it } from 'vitest';

import { applyOrdersDateFilters } from '../fetchOrdersDateParams';

interface MockQuery {
  calls: Array<{ method: 'gte' | 'lte'; column: string; value: string }>;
  gte: (column: string, value: string) => MockQuery;
  lte: (column: string, value: string) => MockQuery;
}

const createMockQuery = (): MockQuery => {
  const query: MockQuery = {
    calls: [],
    gte(column, value) {
      this.calls.push({ method: 'gte', column, value });
      return this;
    },
    lte(column, value) {
      this.calls.push({ method: 'lte', column, value });
      return this;
    },
  };

  return query;
};

describe('applyOrdersDateFilters', () => {
  it('applies both gte and lte when both date params exist', () => {
    const query = createMockQuery();
    const result = applyOrdersDateFilters(query, '2026-06-01T00:00:00.000Z', '2026-06-30T23:59:59.999Z');

    expect(result).toBe(query);
    expect(query.calls).toEqual([
      { method: 'gte', column: 'created_at', value: '2026-06-01T00:00:00.000Z' },
      { method: 'lte', column: 'created_at', value: '2026-06-30T23:59:59.999Z' },
    ]);
  });

  it('applies no filters when both params are empty', () => {
    const query = createMockQuery();
    applyOrdersDateFilters(query, '', '   ');
    expect(query.calls).toEqual([]);
  });

  it('applies only startDate when endDate is missing', () => {
    const query = createMockQuery();
    applyOrdersDateFilters(query, ' 2026-01-01T00:00:00.000Z ', undefined);

    expect(query.calls).toEqual([
      { method: 'gte', column: 'created_at', value: '2026-01-01T00:00:00.000Z' },
    ]);
  });
});
