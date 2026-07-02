import { create } from 'zustand';

import { supabase } from '../lib/supabase';
import type { FinancialTransaction } from '../types';

interface FinanceCategory {
  id: string;
  name: string;
  type: 'income' | 'expense';
  is_system: boolean;
  sort_index: number;
  created_at: string;
}

interface CashBalance {
  id: string;
  initial_balance: number;
  balance: number;
  last_updated_at: string;
  updated_by?: string | null;
}

type ActionResult = { error: Error | null };

type TransactionCreateInput = Omit<FinancialTransaction, 'id' | 'created_at' | 'updated_at' | 'created_by'>;
type TransactionCreatePayload = TransactionCreateInput & { breakage_quantity?: number };
type TransactionUpdateInput = Partial<TransactionCreateInput>;

interface FinanceStore {
  transactions: FinancialTransaction[];
  categories: FinanceCategory[];
  balance: CashBalance | null;
  isLoading: boolean;
  error: string | null;
  fetchTransactions: () => Promise<void>;
  addTransaction: (input: TransactionCreatePayload) => Promise<ActionResult>;
  createBreakageTransaction: (input: {
    product_id?: string | null;
    store_id?: string | null;
    quantity?: number;
    created_by?: string;
  }) => Promise<ActionResult>;
  updateTransaction: (id: string, input: TransactionUpdateInput) => Promise<ActionResult>;
  deleteTransaction: (id: string) => Promise<ActionResult>;
  fetchBalance: () => Promise<void>;
  setInitialBalance: (balance: number) => Promise<ActionResult>;
  fetchCategories: () => Promise<void>;
}

type FinanceCategoryRelation = {
  id: string;
  name: string;
  type: 'income' | 'expense';
} | {
  id: string;
  name: string;
  type: 'income' | 'expense';
}[] | null;

type CityRelation = {
  name?: string | null;
} | {
  name?: string | null;
}[] | null;

type FinancialTransactionRow = {
  id: string;
  transaction_type: 'income' | 'expense';
  amount: number | string;
  transaction_date: string;
  store_id: string | null;
  city_id?: string | null;
  supplier_id: string | null;
  channel_name: string | null;
  description: string | null;
  is_recurring: boolean;
  recurring_frequency?: 'monthly' | 'quarterly' | 'semiannual' | 'annual' | null;
  created_by: string;
  created_at: string;
  updated_at: string;
  finance_categories?: FinanceCategoryRelation;
  cities?: CityRelation;
};

type CashBalanceRow = {
  id: string;
  initial_balance: number | string;
  last_updated_at: string;
  updated_by?: string | null;
};

function normalizeError(error: unknown, fallbackMessage: string): Error {
  return error instanceof Error ? error : new Error(fallbackMessage);
}

function normalizeCategoryRelation(relation: FinanceCategoryRelation | undefined): {
  id: string;
  name: string;
  type: 'income' | 'expense';
} | null {
  if (!relation) {
    return null;
  }

  return Array.isArray(relation) ? relation[0] ?? null : relation;
}

function normalizeCityRelation(relation: CityRelation | undefined): { name?: string | null } | null {
  if (!relation) {
    return null;
  }

  return Array.isArray(relation) ? relation[0] ?? null : relation;
}

function mapTransaction(row: FinancialTransactionRow): FinancialTransaction {
  const category = normalizeCategoryRelation(row.finance_categories);
  const city = normalizeCityRelation(row.cities);

  return {
    id: row.id,
    transaction_type: row.transaction_type,
    category: category?.name || '',
    amount: Number(row.amount || 0),
    transaction_date: row.transaction_date,
    store_id: row.store_id,
    city_id: row.city_id ?? null,
    city_name: city?.name ?? null,
    supplier_id: row.supplier_id,
    channel_name: row.channel_name,
    description: row.description,
    is_recurring: row.is_recurring,
    recurring_frequency: row.recurring_frequency ?? null,
    created_by: row.created_by,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

const transactionSelectWithRecurring = 'id, transaction_type, amount, transaction_date, store_id, city_id, supplier_id, channel_name, description, is_recurring, recurring_frequency, created_by, created_at, updated_at, cities:city_id(name), finance_categories(id, name, type)';
const transactionSelectWithoutRecurring = 'id, transaction_type, amount, transaction_date, store_id, city_id, supplier_id, channel_name, description, is_recurring, created_by, created_at, updated_at, cities:city_id(name), finance_categories(id, name, type)';

function isMissingRecurringFrequencyError(error: unknown): boolean {
  if (!error || typeof error !== 'object') {
    return false;
  }

  const maybeError = error as { code?: string; message?: string; details?: string | null; hint?: string | null };
  const code = maybeError.code || '';
  const combinedMessage = `${maybeError.message || ''} ${maybeError.details || ''} ${maybeError.hint || ''}`.toLowerCase();

  const missingColumn = combinedMessage.includes('recurring_frequency')
    && (combinedMessage.includes('does not exist')
      || combinedMessage.includes('could not find the')
      || combinedMessage.includes('schema cache'));

  return missingColumn || ((code === '42703' || code === 'PGRST204') && combinedMessage.includes('recurring_frequency'));
}

async function fetchFinanceCategoriesFromDb(): Promise<FinanceCategory[]> {
  const { data, error } = await supabase
    .from('finance_categories')
    .select('*')
    .order('type', { ascending: true })
    .order('sort_index', { ascending: true })
    .order('created_at', { ascending: true });

  if (error) {
    throw error;
  }

  return (data || []) as FinanceCategory[];
}

async function getCurrentUserId(): Promise<string> {
  const { data, error } = await supabase.auth.getUser();

  if (error) {
    throw error;
  }

  const userId = data.user?.id;
  if (!userId) {
    throw new Error('未获取到当前用户信息');
  }

  return userId;
}

async function resolveCategoryId(
  transactionType: 'income' | 'expense',
  categoryName: string,
  cachedCategories: FinanceCategory[],
): Promise<string> {
  const categoryLabel = categoryName.trim();

  const categories = cachedCategories.length > 0
    ? cachedCategories
    : await fetchFinanceCategoriesFromDb();

  const matchedCategory = categories.find(
    (item) => item.type === transactionType && item.name === categoryLabel,
  );

  if (!matchedCategory) {
    throw new Error('未找到对应的财务分类，请刷新后重试');
  }

  return matchedCategory.id;
}

export const useFinanceStore = create<FinanceStore>()((set, get) => ({
  transactions: [],
  categories: [],
  balance: null,
  isLoading: false,
  error: null,

  fetchTransactions: async () => {
    set({ isLoading: true, error: null });
    try {
      const withRecurring = await supabase
        .from('financial_transactions')
        .select(transactionSelectWithRecurring)
        .order('transaction_date', { ascending: false })
        .order('created_at', { ascending: false });

      if (withRecurring.error && isMissingRecurringFrequencyError(withRecurring.error)) {
        const withoutRecurring = await supabase
          .from('financial_transactions')
          .select(transactionSelectWithoutRecurring)
          .order('transaction_date', { ascending: false })
          .order('created_at', { ascending: false });

        if (withoutRecurring.error) {
          throw withoutRecurring.error;
        }

        const fallbackTransactions = ((withoutRecurring.data || []) as FinancialTransactionRow[]).map(mapTransaction);
        set({ transactions: fallbackTransactions });
        return;
      }

      if (withRecurring.error) {
        throw withRecurring.error;
      }

      const transactions = ((withRecurring.data || []) as FinancialTransactionRow[]).map(mapTransaction);
      set({ transactions });
    } catch (error) {
      const message = normalizeError(error, '获取财务流水失败').message;
      set({ error: message });
    } finally {
      set({ isLoading: false });
    }
  },

  addTransaction: async (input) => {
    set({ isLoading: true, error: null });
    try {
      const createdBy = await getCurrentUserId();

      if (input.category.trim() === '损耗') {
        const quantity = Number(input.breakage_quantity || 0);
        if (!Number.isFinite(quantity) || quantity <= 0) {
          throw new Error('报损数量必须大于 0');
        }

        if (!input.product_id) {
          throw new Error('报损流水必须选择商品');
        }

        if (!input.store_id) {
          throw new Error('报损流水必须选择店铺');
        }

        const { error } = await supabase.rpc('create_breakage_transaction', {
          p_product_id: input.product_id,
          p_store_id: input.store_id,
          p_quantity: quantity,
          p_created_by: createdBy,
        });

        if (error) {
          throw error;
        }

        await Promise.all([get().fetchTransactions(), get().fetchBalance()]);
        return { error: null };
      }

      const categoryId = await resolveCategoryId(input.transaction_type, input.category, get().categories);

      const insertPayload = {
        transaction_type: input.transaction_type,
        category_id: categoryId,
        amount: input.amount,
        transaction_date: input.transaction_date,
        store_id: input.store_id ?? null,
        city_id: input.city_id ?? null,
        supplier_id: input.supplier_id ?? null,
        product_id: input.product_id ?? null,
        channel_name: input.channel_name?.trim() || null,
        description: input.description?.trim() || null,
        is_recurring: input.is_recurring,
        recurring_frequency: input.is_recurring ? (input.recurring_frequency || 'monthly') : null,
        created_by: createdBy,
      };

      let { error } = await supabase
        .from('financial_transactions')
        .insert(insertPayload);

      if (error && isMissingRecurringFrequencyError(error)) {
        const { recurring_frequency: _omitRecurringFrequency, ...legacyPayload } = insertPayload;
        const retryResult = await supabase
          .from('financial_transactions')
          .insert(legacyPayload);
        error = retryResult.error;
      }

      if (error) {
        throw error;
      }

      await get().fetchTransactions();
      return { error: null };
    } catch (error) {
      const normalizedError = normalizeError(error, '新增财务流水失败');
      set({ error: normalizedError.message });
      return { error: normalizedError };
    } finally {
      set({ isLoading: false });
    }
  },

  createBreakageTransaction: async (input) => {
    set({ isLoading: true, error: null });
    try {
      const createdBy = input.created_by || await getCurrentUserId();
      const quantity = Number(input.quantity || 0);

      if (!input.product_id) {
        throw new Error('报损流水必须选择商品');
      }

      if (!input.store_id) {
        throw new Error('报损流水必须选择店铺');
      }

      if (!Number.isFinite(quantity) || quantity <= 0) {
        throw new Error('报损数量必须大于 0');
      }

      const { error } = await supabase.rpc('create_breakage_transaction', {
        p_product_id: input.product_id,
        p_store_id: input.store_id,
        p_quantity: quantity,
        p_created_by: createdBy,
      });

      if (error) {
        throw error;
      }

      await Promise.all([get().fetchTransactions(), get().fetchBalance()]);
      return { error: null };
    } catch (error) {
      const normalizedError = normalizeError(error, '创建报损流水失败');
      set({ error: normalizedError.message });
      return { error: normalizedError };
    } finally {
      set({ isLoading: false });
    }
  },

  updateTransaction: async (id, input) => {
    set({ isLoading: true, error: null });
    try {
      const existingTransaction = get().transactions.find((item) => item.id === id);
      if (!existingTransaction) {
        throw new Error('未找到要更新的财务流水');
      }

      const nextTransactionType = input.transaction_type ?? existingTransaction.transaction_type;
      const nextCategory = input.category ?? existingTransaction.category;
      const categoryId = await resolveCategoryId(nextTransactionType, nextCategory, get().categories);

      const payload = {
        transaction_type: nextTransactionType,
        category_id: categoryId,
        amount: input.amount ?? existingTransaction.amount,
        transaction_date: input.transaction_date ?? existingTransaction.transaction_date,
        store_id: input.store_id === undefined ? existingTransaction.store_id ?? null : input.store_id,
        city_id: input.city_id === undefined ? existingTransaction.city_id ?? null : input.city_id,
        supplier_id: input.supplier_id === undefined ? existingTransaction.supplier_id ?? null : input.supplier_id,
        channel_name: input.channel_name === undefined
          ? existingTransaction.channel_name ?? null
          : input.channel_name?.trim() || null,
        description: input.description === undefined
          ? existingTransaction.description ?? null
          : input.description?.trim() || null,
        is_recurring: input.is_recurring ?? existingTransaction.is_recurring,
        recurring_frequency: (input.is_recurring ?? existingTransaction.is_recurring)
          ? (input.recurring_frequency ?? existingTransaction.recurring_frequency ?? 'monthly')
          : null,
      };

      let { error } = await supabase
        .from('financial_transactions')
        .update(payload)
        .eq('id', id);

      if (error && isMissingRecurringFrequencyError(error)) {
        const { recurring_frequency: _omitRecurringFrequency, ...legacyPayload } = payload;
        const retryResult = await supabase
          .from('financial_transactions')
          .update(legacyPayload)
          .eq('id', id);
        error = retryResult.error;
      }

      if (error) {
        throw error;
      }

      await get().fetchTransactions();
      return { error: null };
    } catch (error) {
      const normalizedError = normalizeError(error, '更新财务流水失败');
      set({ error: normalizedError.message });
      return { error: normalizedError };
    } finally {
      set({ isLoading: false });
    }
  },

  deleteTransaction: async (id) => {
    set({ isLoading: true, error: null });
    try {
      const { error } = await supabase
        .from('financial_transactions')
        .delete()
        .eq('id', id);

      if (error) {
        throw error;
      }

      await get().fetchTransactions();
      return { error: null };
    } catch (error) {
      const normalizedError = normalizeError(error, '删除财务流水失败');
      set({ error: normalizedError.message });
      return { error: normalizedError };
    } finally {
      set({ isLoading: false });
    }
  },

  fetchBalance: async () => {
    set({ isLoading: true, error: null });
    try {
      const [{ data: latestRow, error: rowError }, { data: computedBalance, error: rpcError }] = await Promise.all([
        supabase
          .from('cash_balance')
          .select('id, initial_balance, last_updated_at, updated_by')
          .order('last_updated_at', { ascending: false })
          .limit(1)
          .maybeSingle(),
        supabase.rpc('get_cash_balance'),
      ]);

      if (rowError) {
        throw rowError;
      }

      if (rpcError) {
        throw rpcError;
      }

      const balance = latestRow
        ? {
            id: (latestRow as CashBalanceRow).id,
            initial_balance: Number((latestRow as CashBalanceRow).initial_balance || 0),
            balance: Number(computedBalance || 0),
            last_updated_at: (latestRow as CashBalanceRow).last_updated_at,
            updated_by: (latestRow as CashBalanceRow).updated_by ?? null,
          }
        : null;

      set({ balance });
    } catch (error) {
      const message = normalizeError(error, '获取现金余额失败').message;
      set({ error: message });
    } finally {
      set({ isLoading: false });
    }
  },

  setInitialBalance: async (balance) => {
    set({ isLoading: true, error: null });
    try {
      const updatedBy = await getCurrentUserId();
      const now = new Date().toISOString();

      const { data: existingBalance, error: fetchError } = await supabase
        .from('cash_balance')
        .select('id')
        .order('last_updated_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (fetchError) {
        throw fetchError;
      }

      if (existingBalance?.id) {
        const { error } = await supabase
          .from('cash_balance')
          .update({
            initial_balance: balance,
            last_updated_at: now,
            updated_by: updatedBy,
          })
          .eq('id', existingBalance.id);

        if (error) {
          throw error;
        }
      } else {
        const { error } = await supabase
          .from('cash_balance')
          .insert({
            initial_balance: balance,
            last_updated_at: now,
            updated_by: updatedBy,
          });

        if (error) {
          throw error;
        }
      }

      await get().fetchBalance();
      return { error: null };
    } catch (error) {
      const normalizedError = normalizeError(error, '更新期初余额失败');
      set({ error: normalizedError.message });
      return { error: normalizedError };
    } finally {
      set({ isLoading: false });
    }
  },

  fetchCategories: async () => {
    set({ isLoading: true, error: null });
    try {
      const categories = await fetchFinanceCategoriesFromDb();
      set({ categories });
    } catch (error) {
      const message = normalizeError(error, '获取财务分类失败').message;
      set({ error: message });
    } finally {
      set({ isLoading: false });
    }
  },
}));
