export interface MonthSource {
  created_at?: string | null;
}

export const buildMonthDateRange = (selectedMonth: string): { startDate: string; endDate: string } | null => {
  const [yearText, monthText] = selectedMonth.split('-');
  const year = Number(yearText);
  const monthIndex = Number(monthText) - 1;

  if (!Number.isFinite(year) || !Number.isFinite(monthIndex) || monthIndex < 0 || monthIndex > 11) {
    return null;
  }

  return {
    startDate: new Date(Date.UTC(year, monthIndex, 1, 0, 0, 0, 0)).toISOString(),
    endDate: new Date(Date.UTC(year, monthIndex + 1, 0, 23, 59, 59, 999)).toISOString(),
  };
};

const toMonthKey = (value: string | null | undefined): string | null => {
  const month = String(value || '').slice(0, 7);
  return /^\d{4}-\d{2}$/.test(month) ? month : null;
};

const toMonthIndex = (monthKey: string): number => {
  const [yearText, monthText] = monthKey.split('-');
  const year = Number(yearText);
  const month = Number(monthText);
  return year * 12 + (month - 1);
};

const fromMonthIndex = (monthIndex: number): string => {
  const year = Math.floor(monthIndex / 12);
  const month = monthIndex % 12;
  return `${year}-${String(month + 1).padStart(2, '0')}`;
};

export const buildMonthOptions = (rows: MonthSource[], now: Date = new Date()): string[] => {
  const currentMonth = now.toISOString().slice(0, 7);
  const currentIndex = toMonthIndex(currentMonth);

  let earliestIndex = currentIndex;
  rows.forEach((row) => {
    const key = toMonthKey(row.created_at);
    if (!key) return;
    const idx = toMonthIndex(key);
    if (idx < earliestIndex) {
      earliestIndex = idx;
    }
  });

  const options: string[] = ['all'];
  for (let idx = currentIndex; idx >= earliestIndex; idx -= 1) {
    options.push(fromMonthIndex(idx));
  }

  return options;
};
