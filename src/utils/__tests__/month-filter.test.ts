import { describe, expect, it } from 'vitest';

import { buildMonthDateRange, buildMonthOptions } from '../reportsMonth';

describe('buildMonthOptions', () => {
  it('returns all months from earliest order to current month', () => {
    const options = buildMonthOptions(
      [
        { created_at: '2026-02-15T10:00:00.000Z' },
        { created_at: '2026-04-02T10:00:00.000Z' },
      ],
      new Date('2026-06-10T00:00:00.000Z'),
    );

    expect(options).toEqual(['all', '2026-06', '2026-05', '2026-04', '2026-03', '2026-02']);
  });

  it('returns current month only when there are no valid order dates', () => {
    const options = buildMonthOptions([{ created_at: null }, { created_at: 'invalid' }], new Date('2026-06-10T00:00:00.000Z'));
    expect(options).toEqual(['all', '2026-06']);
  });

  it('ignores malformed month values and keeps valid ones', () => {
    const options = buildMonthOptions(
      [
        { created_at: '2026-03-01T00:00:00.000Z' },
        { created_at: '2026-3-01T00:00:00.000Z' },
        { created_at: 'x' },
      ],
      new Date('2026-04-10T00:00:00.000Z'),
    );

    expect(options).toEqual(['all', '2026-04', '2026-03']);
  });
});

describe('buildMonthDateRange', () => {
  it('builds UTC start and end boundaries for a valid month', () => {
    const range = buildMonthDateRange('2026-06');
    expect(range).toEqual({
      startDate: '2026-06-01T00:00:00.000Z',
      endDate: '2026-06-30T23:59:59.999Z',
    });
  });

  it('returns null for invalid month format', () => {
    expect(buildMonthDateRange('2026-13')).toBeNull();
    expect(buildMonthDateRange('bad')).toBeNull();
  });

  it('returns null for empty month value', () => {
    expect(buildMonthDateRange('')).toBeNull();
  });
});
