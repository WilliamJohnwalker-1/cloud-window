import { create } from 'zustand';

import { supabase } from '../lib/supabase';
import type { FinancialTransaction } from '../types';

type ActionResult = { error: Error | null };
type TransactionType = FinancialTransaction['transaction_type'];
type TransactionCreateInput = Omit<FinancialTransaction, 'id' | 'created_at' | 'updated_at'>;
type TransactionUpdateInput = Partial<Omit<FinancialTransaction, 'id' | 'created_at' | 'updated_at' | 'created_by'>>;

interface FinanceCategoryOption {
  id: string;
  name: string;
  type: TransactionType;
  is_system: boolean;
  sort_index: number;
  created_at: string;
}

interface FinanceCategoryRelation {
  id: string;
  name: string;
  type: TransactionType;
}

interface FinancialTransactionRow {
  id: string;
  transaction_type: TransactionType;
  amount: number | string | null;
  transaction_date: string;
  store_id?: string | null;
  supplier_id?: string | null;
  channel_name?: string | null;
  description?: string | null;
  is_recurring?: boolean | null;
  created_by: string;
  created_at: string;
  updated_at: string;
  finance_categories?: FinanceCategoryRelation | FinanceCategoryRelation[] | null;
}

interface CashBalanceRow {
  id: string;
  balance: number | string | null;
  last_updated_at: string;
}

interface FinanceStore {
  transactions: FinancialTransaction[];
  categories: FinanceCategoryOption[];
  cashBalance: number | null;
  isLoading: boolean;
  error: string | null;
  fetchTransactions: () => Promise<void>;
  addTransaction: (transaction: TransactionCreateInput) => Promise<ActionResult>;
  updateTransaction: (id: string, transaction: TransactionUpdateInput) => Promise<ActionResult>;
  deleteTransaction: (id: string) => Promise<ActionResult>;
  fetchBalance: () => Promise<void>;
  updateBalance: (balance: number) => Promise<ActionResult>;
  fetchCategories: () => Promise<void>;
}

const pickFirstRelation = <T>(value: T | T[] | null | undefined): T | null => {
  if (!value) return null;
  return Array.isArray(value) ? value[0] ?? null : value;
};

const normalizeText = (value: string | null | undefined): string | null => {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
};

const normalizeAmount = (value: number): number => {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error('金额必须大于 0');
  }

  return Number(value.toFixed(2));
};

const mapCategory = (row: FinanceCategoryOption): FinanceCategoryOption => ({
  id: row.id,
  name: row.name,
  type: row.type,
  is_system: Boolean(row.is_system),
  sort_index: Number(row.sort_index || 0),
  created_at: row.created_at,
});

const mapTransaction = (row: FinancialTransactionRow): FinancialTransaction => {
  const category = pickFirstRelation(row.finance_categories);

  return {
    id: row.id,
    transaction_type: row.transaction_type,
    category: category?.name || '未分类',
    amount: Number(row.amount || 0),
    transaction_date: row.transaction_date,
    store_id: row.store_id ?? null,
    supplier_id: row.supplier_id ?? null,
    channel_name: row.channel_name ?? null,
    description: row.description ?? null,
    is_recurring: Boolean(row.is_recurring),
    created_by: row.created_by,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
};

const loadCategories = async (): Promise<FinanceCategoryOption[]> => {
  const { data, error } = await supabase
    .from('finance_categories')
    .select('id, name, type, is_system, sort_index, created_at')
    .order('type', { ascending: true })
    .order('sort_index', { ascending: true });

  if (error) {
    throw error;
  }

  return ((data || []) as FinanceCategoryOption[]).map(mapCategory);
};

const resolveCategoryId = async (
  categoryName: string,
  transactionType: TransactionType,
  existingCategories: FinanceCategoryOption[],
): Promise<{ categoryId: string; categories: FinanceCategoryOption[] }> => {
  const categories = existingCategories.length > 0 ? existingCategories : await loadCategories();
  const category = categories.find((item) => item.name === categoryName && item.type === transactionType);

  if (!category) {
    throw new Error('未找到对应的财务分类，请刷新后重试');
  }

  return { categoryId: category.id, categories };
};

export const useFinanceStore = create<FinanceStore>()((set, get) => ({
  transactions: [],
  categories: [],
  cashBalance: null,
  isLoading: false,
  error: null,

  fetchTransactions: async () => {
    set({ isLoading: true, error: null });
    try {
      const { data, error } = await supabase
        .from('financial_transactions')
        .select(`
          id,
          transaction_type,
          amount,
          transaction_date,
          store_id,
          supplier_id,
          channel_name,
          description,
          is_recurring,
          created_by,
          created_at,
          updated_at,
          finance_categories:category_id(
            id,
            name,
            type
          )
        `)
        .order('transaction_date', { ascending: false })
        .order('created_at', { ascending: false });

      if (error) {
        throw error;
      }

      set({ transactions: ((data || []) as FinancialTransactionRow[]).map(mapTransaction) });
    } catch (error) {
      set({ transactions: [], error: (error as Error).message });
    } finally {
      set({ isLoading: false });
    }
  },

  addTransaction: async (transaction) => {
    set({ error: null });

    try {
      if (!transaction.created_by) {
        throw new Error('当前用户信息缺失，无法创建收支流水');
      }

      if (!transaction.transaction_date) {
        throw new Error('请选择交易日期');
      }

      const { categoryId, categories } = await resolveCategoryId(
        transaction.category,
        transaction.transaction_type,
        get().categories,
      );

      const { error } = await supabase.from('financial_transactions').insert({
        transaction_type: transaction.transaction_type,
        category_id: categoryId,
        amount: normalizeAmount(Number(transaction.amount)),
        transaction_date: transaction.transaction_date,
        store_id: transaction.store_id ?? null,
        supplier_id: transaction.supplier_id ?? null,
        channel_name: normalizeText(transaction.channel_name),
        description: normalizeText(transaction.description),
        is_recurring: Boolean(transaction.is_recurring),
        created_by: transaction.created_by,
      });

      if (error) {
        throw error;
      }

      if (get().categories.length === 0) {
        set({ categories });
      }

      await get().fetchTransactions();
      return { error: null };
    } catch (error) {
      const actionError = error as Error;
      set({ error: actionError.message });
      return { error: actionError };
    }
  },

  updateTransaction: async (id, transaction) => {
    set({ error: null });

    try {
      const currentTransaction = get().transactions.find((item) => item.id === id);
      const nextType = transaction.transaction_type ?? currentTransaction?.transaction_type;
      const nextCategory = transaction.category ?? currentTransaction?.category;
      const payload: Record<string, boolean | number | string | null> = {};

      if (!nextType || !nextCategory) {
        throw new Error('缺少财务分类信息，无法更新');
      }

      if (transaction.transaction_type !== undefined || transaction.category !== undefined) {
        const { categoryId, categories } = await resolveCategoryId(nextCategory, nextType, get().categories);
        payload.category_id = categoryId;

        if (get().categories.length === 0) {
          set({ categories });
        }
      }

      if (transaction.transaction_type !== undefined) {
        payload.transaction_type = transaction.transaction_type;
      }

      if (transaction.amount !== undefined) {
        payload.amount = normalizeAmount(Number(transaction.amount));
      }

      if (transaction.transaction_date !== undefined) {
        if (!transaction.transaction_date) {
          throw new Error('请选择交易日期');
        }

        payload.transaction_date = transaction.transaction_date;
      }

      if (transaction.store_id !== undefined) {
        payload.store_id = transaction.store_id ?? null;
      }

      if (transaction.supplier_id !== undefined) {
        payload.supplier_id = transaction.supplier_id ?? null;
      }

      if (transaction.channel_name !== undefined) {
        payload.channel_name = normalizeText(transaction.channel_name);
      }

      if (transaction.description !== undefined) {
        payload.description = normalizeText(transaction.description);
      }

      if (transaction.is_recurring !== undefined) {
        payload.is_recurring = Boolean(transaction.is_recurring);
      }

      if (Object.keys(payload).length === 0) {
        return { error: null };
      }

      const { error } = await supabase
        .from('financial_transactions')
        .update(payload)
        .eq('id', id);

      if (error) {
        throw error;
      }

      await get().fetchTransactions();
      return { error: null };
    } catch (error) {
      const actionError = error as Error;
      set({ error: actionError.message });
      return { error: actionError };
    }
  },

  deleteTransaction: async (id) => {
    set({ error: null });

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
      const actionError = error as Error;
      set({ error: actionError.message });
      return { error: actionError };
    }
  },

  fetchBalance: async () => {
    set({ isLoading: true, error: null });
    try {
      const { data, error } = await supabase
        .from('cash_balance')
        .select('id, balance, last_updated_at')
        .order('last_updated_at', { ascending: false })
        .limit(1);

      if (error) {
        throw error;
      }

      const balanceRow = (data || [])[0] as CashBalanceRow | undefined;
      set({ cashBalance: balanceRow ? Number(balanceRow.balance || 0) : null });
    } catch (error) {
      set({ error: (error as Error).message });
    } finally {
      set({ isLoading: false });
    }
  },

  updateBalance: async (balance) => {
    set({ error: null });

    try {
      const normalizedBalance = Number(balance.toFixed(2));
      if (!Number.isFinite(normalizedBalance)) {
        throw new Error('余额格式无效');
      }

      const { data: authData, error: authError } = await supabase.auth.getUser();
      if (authError) {
        throw authError;
      }

      if (!authData.user?.id) {
        throw new Error('当前用户信息缺失，无法更新余额');
      }

      const { data: existingRows, error: fetchError } = await supabase
        .from('cash_balance')
        .select('id')
        .order('last_updated_at', { ascending: false })
        .limit(1);

      if (fetchError) {
        throw fetchError;
      }

      const latestBalance = existingRows?.[0];
      const payload = {
        balance: normalizedBalance,
        last_updated_at: new Date().toISOString(),
        updated_by: authData.user.id,
      };

      const result = latestBalance
        ? await supabase.from('cash_balance').update(payload).eq('id', latestBalance.id)
        : await supabase.from('cash_balance').insert(payload);

      if (result.error) {
        throw result.error;
      }

      await get().fetchBalance();
      return { error: null };
    } catch (error) {
      const actionError = error as Error;
      set({ error: actionError.message });
      return { error: actionError };
    }
  },

  fetchCategories: async () => {
    set({ isLoading: true, error: null });
    try {
      set({ categories: await loadCategories() });
    } catch (error) {
      set({ error: (error as Error).message });
    } finally {
      set({ isLoading: false });
    }
  },
}));
