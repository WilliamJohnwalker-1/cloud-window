import React, { useEffect, useMemo, useState } from 'react';
import { Edit2, Plus, Trash2, Wallet } from 'lucide-react';
import { motion } from 'framer-motion';

import { useAppStore } from '../store/useAppStore';
import { useFinanceStore } from '../store/useFinanceStore';
import { useSupplierStore } from '../store/useSupplierStore';
import type { FinancialTransaction } from '../types';
import {
  canEditFinance,
  canViewFinance,
  canViewSuppliers,
} from '../utils/permissions';

type TransactionType = FinancialTransaction['transaction_type'];

interface FinanceFormState {
  transaction_type: TransactionType;
  category: string;
  amount: string;
  transaction_date: string;
  store_id: string;
  supplier_id: string;
  channel_name: string;
  description: string;
  is_recurring: boolean;
}

interface PageNotice {
  type: 'success' | 'error';
  text: string;
}

interface ConfirmAction {
  transactionId: string;
  title: string;
  description: string;
}

const formatCurrency = (value: number): string => `¥${value.toFixed(2)}`;

const getToday = (): string => new Date().toISOString().slice(0, 10);

export const FinanceScreen: React.FC = () => {
  const { user, stores, fetchStores } = useAppStore();
  const { suppliers, fetchSuppliers } = useSupplierStore();
  const {
    transactions,
    categories,
    isLoading,
    error,
    fetchTransactions,
    addTransaction,
    updateTransaction,
    deleteTransaction,
    fetchCategories,
  } = useFinanceStore();

  const canView = canViewFinance(user?.role);
  const canEdit = canEditFinance(user?.role);
  const canLoadSuppliers = canViewSuppliers(user?.role);

  const [showCreate, setShowCreate] = useState(false);
  const [editingTransactionId, setEditingTransactionId] = useState<string | null>(null);
  const [pageNotice, setPageNotice] = useState<PageNotice | null>(null);
  const [confirmAction, setConfirmAction] = useState<ConfirmAction | null>(null);
  const [typeFilter, setTypeFilter] = useState<'all' | TransactionType>('all');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [storeFilter, setStoreFilter] = useState('all');
  const [startDateFilter, setStartDateFilter] = useState('');
  const [endDateFilter, setEndDateFilter] = useState('');
  const [keywordFilter, setKeywordFilter] = useState('');
  const [form, setForm] = useState<FinanceFormState>({
    transaction_type: 'expense',
    category: '',
    amount: '',
    transaction_date: getToday(),
    store_id: '',
    supplier_id: '',
    channel_name: '',
    description: '',
    is_recurring: false,
  });

  const storeNameMap = useMemo(() => {
    return new Map(stores.map((store) => [store.id, store.name]));
  }, [stores]);

  const supplierNameMap = useMemo(() => {
    return new Map(suppliers.map((supplier) => [supplier.id, supplier.company_name]));
  }, [suppliers]);

  const formCategoryOptions = useMemo(() => {
    return categories.filter((item) => item.type === form.transaction_type);
  }, [categories, form.transaction_type]);

  const filterCategoryOptions = useMemo(() => {
    if (typeFilter === 'all') {
      return categories;
    }

    return categories.filter((item) => item.type === typeFilter);
  }, [categories, typeFilter]);

  const buildEmptyForm = (transactionType: TransactionType = 'expense'): FinanceFormState => {
    const defaultCategory = categories.find((item) => item.type === transactionType);

    return {
      transaction_type: transactionType,
      category: defaultCategory?.name || '',
      amount: '',
      transaction_date: getToday(),
      store_id: '',
      supplier_id: '',
      channel_name: '',
      description: '',
      is_recurring: false,
    };
  };

  useEffect(() => {
    if (!canView) {
      return;
    }

    void fetchTransactions();
    void fetchCategories();
    void fetchStores();

    if (canLoadSuppliers) {
      void fetchSuppliers();
    }
  }, [canLoadSuppliers, canView, fetchCategories, fetchStores, fetchSuppliers, fetchTransactions]);

  useEffect(() => {
    if (!showCreate || form.category || formCategoryOptions.length === 0) {
      return;
    }

    setForm((prev) => ({
      ...prev,
      category: formCategoryOptions[0].name,
    }));
  }, [form.category, formCategoryOptions, showCreate]);

  useEffect(() => {
    if (!error) {
      return;
    }

    setPageNotice({ type: 'error', text: error });
  }, [error]);

  const getStoreLabel = (storeId?: string | null): string => {
    if (!storeId) {
      return '未关联店铺';
    }

    return storeNameMap.get(storeId) || `店铺 ${storeId.slice(0, 8)}`;
  };

  const getSupplierLabel = (supplierId?: string | null): string => {
    if (!supplierId) {
      return '未关联供应商';
    }

    return supplierNameMap.get(supplierId) || `供应商 ${supplierId.slice(0, 8)}`;
  };

  const filteredTransactions = useMemo(() => {
    const keyword = keywordFilter.trim().toLowerCase();

    return transactions.filter((transaction) => {
      const matchesType = typeFilter === 'all' ? true : transaction.transaction_type === typeFilter;
      const matchesCategory = categoryFilter === 'all' ? true : transaction.category === categoryFilter;
      const matchesStore = storeFilter === 'all' ? true : transaction.store_id === storeFilter;
      const matchesStartDate = startDateFilter ? transaction.transaction_date >= startDateFilter : true;
      const matchesEndDate = endDateFilter ? transaction.transaction_date <= endDateFilter : true;

      if (!keyword) {
        return matchesType && matchesCategory && matchesStore && matchesStartDate && matchesEndDate;
      }

      const searchText = [
        transaction.category,
        transaction.channel_name || '',
        transaction.description || '',
        getStoreLabel(transaction.store_id),
        getSupplierLabel(transaction.supplier_id),
      ]
        .join(' ')
        .toLowerCase();

      return matchesType
        && matchesCategory
        && matchesStore
        && matchesStartDate
        && matchesEndDate
        && searchText.includes(keyword);
    });
  }, [
    categoryFilter,
    endDateFilter,
    getStoreLabel,
    getSupplierLabel,
    keywordFilter,
    startDateFilter,
    storeFilter,
    transactions,
    typeFilter,
  ]);

  const resetFilters = (): void => {
    setTypeFilter('all');
    setCategoryFilter('all');
    setStoreFilter('all');
    setStartDateFilter('');
    setEndDateFilter('');
    setKeywordFilter('');
  };

  const openCreateModal = (): void => {
    if (!canEdit) {
      setPageNotice({ type: 'error', text: '仅财务角色可编辑收支流水' });
      return;
    }

    setEditingTransactionId(null);
    setForm(buildEmptyForm());
    setShowCreate(true);
  };

  const openEditModal = (transactionId: string): void => {
    if (!canEdit) {
      return;
    }

    const transaction = transactions.find((item) => item.id === transactionId);
    if (!transaction) {
      return;
    }

    setEditingTransactionId(transaction.id);
    setForm({
      transaction_type: transaction.transaction_type,
      category: transaction.category,
      amount: String(transaction.amount),
      transaction_date: transaction.transaction_date,
      store_id: transaction.store_id || '',
      supplier_id: transaction.supplier_id || '',
      channel_name: transaction.channel_name || '',
      description: transaction.description || '',
      is_recurring: transaction.is_recurring,
    });
    setShowCreate(true);
  };

  const handleSaveTransaction = async (): Promise<void> => {
    if (!canEdit) {
      setPageNotice({ type: 'error', text: '仅财务角色可编辑收支流水' });
      return;
    }

    if (!user?.id) {
      setPageNotice({ type: 'error', text: '当前用户信息缺失，请重新登录后重试' });
      return;
    }

    if (!form.category) {
      setPageNotice({ type: 'error', text: '请选择财务分类' });
      return;
    }

    const amount = Number(form.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
      setPageNotice({ type: 'error', text: '金额必须大于 0' });
      return;
    }

    if (!form.transaction_date) {
      setPageNotice({ type: 'error', text: '请选择交易日期' });
      return;
    }

    const payload = {
      transaction_type: form.transaction_type,
      category: form.category,
      amount,
      transaction_date: form.transaction_date,
      store_id: form.store_id || null,
      supplier_id: form.supplier_id || null,
      channel_name: form.channel_name.trim() || null,
      description: form.description.trim() || null,
      is_recurring: form.is_recurring,
    };

    if (editingTransactionId) {
      const { error: updateError } = await updateTransaction(editingTransactionId, payload);
      if (updateError) {
        setPageNotice({ type: 'error', text: `更新失败：${updateError.message}` });
        return;
      }

      setShowCreate(false);
      setEditingTransactionId(null);
      setForm(buildEmptyForm());
      setPageNotice({ type: 'success', text: '收支流水已更新' });
      return;
    }

    const { error: createError } = await addTransaction({
      ...payload,
      created_by: user.id,
    });

    if (createError) {
      setPageNotice({ type: 'error', text: `新增失败：${createError.message}` });
      return;
    }

    setShowCreate(false);
    setEditingTransactionId(null);
    setForm(buildEmptyForm());
    setPageNotice({ type: 'success', text: '新增收支流水成功' });
  };

  const handleDelete = (transactionId: string, event: React.MouseEvent): void => {
    if (!canEdit) {
      return;
    }

    event.stopPropagation();
    setConfirmAction({
      transactionId,
      title: '删除收支流水',
      description: '确定要删除该条收支流水吗？删除后不可恢复。',
    });
  };

  const submitConfirmAction = async (): Promise<void> => {
    if (!canEdit) {
      setPageNotice({ type: 'error', text: '仅财务角色可编辑收支流水' });
      setConfirmAction(null);
      return;
    }

    if (!confirmAction) {
      return;
    }

    const { error: deleteError } = await deleteTransaction(confirmAction.transactionId);
    if (deleteError) {
      setPageNotice({ type: 'error', text: `删除失败：${deleteError.message}` });
      return;
    }

    setConfirmAction(null);
    setPageNotice({ type: 'success', text: '收支流水已删除' });
  };

  if (!canView) {
    return (
      <div className="h-[400px] flex flex-col items-center justify-center text-white/20">
        <Wallet size={80} strokeWidth={1} className="mb-4" />
        <p className="text-xl font-medium">无权限访问</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {pageNotice && (
        <div className={`rounded-2xl border px-4 py-3 text-sm ${pageNotice.type === 'success' ? 'bg-emerald-500/10 border-emerald-400/30 text-emerald-200' : 'bg-red-500/10 border-red-400/30 text-red-200'}`}>
          <div className="flex items-center justify-between gap-3">
            <span>{pageNotice.text}</span>
            <button
              type="button"
              onClick={() => setPageNotice(null)}
              className="text-white/60 hover:text-white"
            >
              ×
            </button>
          </div>
        </div>
      )}

      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex-1 min-w-[280px] bg-white/5 border border-white/10 rounded-2xl p-4">
          <div className="flex items-center gap-3 text-white/70">
            <div className="w-10 h-10 rounded-2xl bg-white/5 border border-white/10 flex items-center justify-center text-white/40">
              <Wallet size={18} />
            </div>
            <div>
              <div className="text-sm font-medium">财务收支流水</div>
              <p className="text-xs text-white/40 mt-1">
                已加载 {filteredTransactions.length} 条记录{canEdit ? '，可新增/编辑/删除' : '，当前角色仅可查看'}
              </p>
            </div>
          </div>
        </div>

        {canEdit ? (
          <button
            type="button"
            onClick={openCreateModal}
            className="bg-tech-gradient px-6 py-2.5 rounded-xl font-bold flex items-center space-x-2 shadow-neon hover:scale-[1.02] transition-all active:scale-[0.98]"
          >
            <Plus size={20} />
            <span>新增流水</span>
          </button>
        ) : (
          <div className="px-4 py-2 rounded-xl border border-white/10 bg-white/5 text-xs text-white/60">admin / super_admin 只读查看</div>
        )}
      </div>

      <div className="bg-white/5 border border-white/10 rounded-3xl p-4 space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-6 gap-3">
          <label className="space-y-1 block">
            <span className="text-xs font-bold text-white/40 uppercase tracking-wider">类型</span>
            <select
              value={typeFilter}
              onChange={(event) => {
                const nextType = event.target.value as 'all' | TransactionType;
                setTypeFilter(nextType);
                setCategoryFilter('all');
              }}
              className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-white"
            >
              <option value="all" className="bg-[#121217]">全部</option>
              <option value="income" className="bg-[#121217]">收入</option>
              <option value="expense" className="bg-[#121217]">支出</option>
            </select>
          </label>

          <label className="space-y-1 block">
            <span className="text-xs font-bold text-white/40 uppercase tracking-wider">分类</span>
            <select
              value={categoryFilter}
              onChange={(event) => setCategoryFilter(event.target.value)}
              className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-white"
            >
              <option value="all" className="bg-[#121217]">全部分类</option>
              {filterCategoryOptions.map((category) => (
                <option key={`${category.type}-${category.id}`} value={category.name} className="bg-[#121217]">
                  {category.name}
                </option>
              ))}
            </select>
          </label>

          <label className="space-y-1 block">
            <span className="text-xs font-bold text-white/40 uppercase tracking-wider">店铺</span>
            <select
              value={storeFilter}
              onChange={(event) => setStoreFilter(event.target.value)}
              className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-white"
            >
              <option value="all" className="bg-[#121217]">全部店铺</option>
              {stores.map((store) => (
                <option key={store.id} value={store.id} className="bg-[#121217]">
                  {store.name}
                </option>
              ))}
            </select>
          </label>

          <label className="space-y-1 block">
            <span className="text-xs font-bold text-white/40 uppercase tracking-wider">开始日期</span>
            <input
              type="date"
              value={startDateFilter}
              onChange={(event) => setStartDateFilter(event.target.value)}
              className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2"
            />
          </label>

          <label className="space-y-1 block">
            <span className="text-xs font-bold text-white/40 uppercase tracking-wider">结束日期</span>
            <input
              type="date"
              value={endDateFilter}
              onChange={(event) => setEndDateFilter(event.target.value)}
              className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2"
            />
          </label>

          <label className="space-y-1 block">
            <span className="text-xs font-bold text-white/40 uppercase tracking-wider">搜索</span>
            <input
              value={keywordFilter}
              onChange={(event) => setKeywordFilter(event.target.value)}
              placeholder="分类 / 店铺 / 供应商 / 渠道 / 备注"
              className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2"
            />
          </label>
        </div>

        <div className="flex justify-end">
          <button
            type="button"
            onClick={resetFilters}
            className="px-4 py-2 rounded-xl bg-white/5 border border-white/10 text-sm text-white/70 hover:text-white"
          >
            重置筛选
          </button>
        </div>
      </div>

      {isLoading && transactions.length === 0 ? (
        <div className="h-[320px] flex items-center justify-center text-white/40">正在加载财务流水...</div>
      ) : null}

      <div className="space-y-4">
        {filteredTransactions.map((transaction, index) => {
          const isIncome = transaction.transaction_type === 'income';

          return (
            <motion.div
              key={transaction.id}
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: index * 0.03 }}
              className="group bg-white/5 border border-white/10 rounded-3xl p-6 hover:border-accent/40 transition-all duration-300"
              onClick={() => {
                if (canEdit) {
                  openEditModal(transaction.id);
                }
              }}
            >
              <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-4">
                <div className="space-y-3">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className={`px-2.5 py-1 rounded-full text-[11px] font-bold uppercase tracking-wider ${isIncome ? 'bg-emerald-500/15 text-emerald-300' : 'bg-rose-500/15 text-rose-300'}`}>
                      {isIncome ? '收入' : '支出'}
                    </span>
                    <span className="px-2.5 py-1 rounded-full text-[11px] font-bold uppercase tracking-wider bg-white/5 text-white/60">
                      {transaction.category}
                    </span>
                    {transaction.is_recurring ? (
                      <span className="px-2.5 py-1 rounded-full text-[11px] font-bold uppercase tracking-wider bg-amber-500/15 text-amber-300">周期项</span>
                    ) : null}
                    <span className="text-sm text-white/40">{transaction.transaction_date}</span>
                  </div>

                  <div>
                    <h3 className="text-lg font-bold text-white">{transaction.description || '未填写备注'}</h3>
                    <p className="text-sm text-white/50 mt-1">录入时间：{new Date(transaction.created_at).toLocaleString()}</p>
                  </div>
                </div>

                <div className="text-left lg:text-right space-y-2">
                  <div className={`text-2xl font-bold ${isIncome ? 'text-emerald-300' : 'text-rose-300'}`}>
                    {isIncome ? '+' : '-'}{formatCurrency(transaction.amount)}
                  </div>
                  <p className="text-sm text-white/50">渠道：{transaction.channel_name || '未填写'}</p>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mt-5">
                <div className="bg-white/5 border border-white/5 rounded-2xl p-3">
                  <p className="text-[10px] text-white/40 uppercase font-bold tracking-tighter mb-1">关联店铺</p>
                  <p className="text-sm font-medium text-white/80 truncate">{getStoreLabel(transaction.store_id)}</p>
                </div>
                <div className="bg-white/5 border border-white/5 rounded-2xl p-3">
                  <p className="text-[10px] text-white/40 uppercase font-bold tracking-tighter mb-1">关联供应商</p>
                  <p className="text-sm font-medium text-white/80 truncate">{getSupplierLabel(transaction.supplier_id)}</p>
                </div>
                <div className="bg-white/5 border border-white/5 rounded-2xl p-3">
                  <p className="text-[10px] text-white/40 uppercase font-bold tracking-tighter mb-1">录入人</p>
                  <p className="text-sm font-medium text-white/80 truncate">{transaction.created_by.slice(0, 8)}</p>
                </div>
              </div>

              {canEdit ? (
                <div className="mt-5 pt-4 border-t border-white/5 flex items-center justify-end gap-2">
                  <button
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation();
                      openEditModal(transaction.id);
                    }}
                    className="p-2 rounded-xl hover:bg-white/10 text-white/50 hover:text-white transition-colors"
                    title="编辑流水"
                  >
                    <Edit2 size={18} />
                  </button>
                  <button
                    type="button"
                    onClick={(event) => handleDelete(transaction.id, event)}
                    className="p-2 rounded-xl hover:bg-red-500/20 text-white/50 hover:text-red-400 transition-colors"
                    title="删除流水"
                  >
                    <Trash2 size={18} />
                  </button>
                </div>
              ) : null}
            </motion.div>
          );
        })}
      </div>

      {!isLoading && filteredTransactions.length === 0 ? (
        <div className="h-[320px] flex flex-col items-center justify-center text-white/20">
          <Wallet size={80} strokeWidth={1} className="mb-4" />
          <p className="text-xl font-medium">暂无财务流水</p>
          <p className="text-sm mt-2 text-white/30">可以调整筛选条件，或由财务角色新增第一条记录</p>
        </div>
      ) : null}

      {showCreate && (
        <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4">
          <div className="w-full max-w-3xl bg-[#121217] border border-white/10 rounded-3xl p-6 space-y-4 max-h-[90vh] overflow-y-auto">
            <h3 className="text-xl font-bold">{editingTransactionId ? '编辑收支流水' : '新增收支流水'}</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <label className="space-y-1 block">
                <span className="text-xs font-bold text-white/40 uppercase tracking-wider">交易类型</span>
                <select
                  value={form.transaction_type}
                  onChange={(event) => {
                    const nextType = event.target.value as TransactionType;
                    const nextCategory = categories.find((item) => item.type === nextType)?.name || '';
                    setForm((prev) => ({
                      ...prev,
                      transaction_type: nextType,
                      category: nextCategory,
                    }));
                  }}
                  disabled={!canEdit}
                  className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-white disabled:opacity-60"
                >
                  <option value="income" className="bg-[#121217]">收入</option>
                  <option value="expense" className="bg-[#121217]">支出</option>
                </select>
              </label>

              <label className="space-y-1 block">
                <span className="text-xs font-bold text-white/40 uppercase tracking-wider">财务分类</span>
                <select
                  value={form.category}
                  onChange={(event) => setForm((prev) => ({ ...prev, category: event.target.value }))}
                  disabled={!canEdit || formCategoryOptions.length === 0}
                  className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-white disabled:opacity-60"
                >
                  {formCategoryOptions.length === 0 ? (
                    <option value="" className="bg-[#121217]">暂无分类</option>
                  ) : null}
                  {formCategoryOptions.map((category) => (
                    <option key={category.id} value={category.name} className="bg-[#121217]">
                      {category.name}
                    </option>
                  ))}
                </select>
              </label>

              <label className="space-y-1 block">
                <span className="text-xs font-bold text-white/40 uppercase tracking-wider">金额</span>
                <input
                  value={form.amount}
                  onChange={(event) => setForm((prev) => ({ ...prev, amount: event.target.value }))}
                  placeholder="请输入金额"
                  type="number"
                  min="0"
                  step="0.01"
                  disabled={!canEdit}
                  className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2 disabled:opacity-60"
                />
              </label>

              <label className="space-y-1 block">
                <span className="text-xs font-bold text-white/40 uppercase tracking-wider">交易日期</span>
                <input
                  type="date"
                  value={form.transaction_date}
                  onChange={(event) => setForm((prev) => ({ ...prev, transaction_date: event.target.value }))}
                  disabled={!canEdit}
                  className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2 disabled:opacity-60"
                />
              </label>

              <label className="space-y-1 block">
                <span className="text-xs font-bold text-white/40 uppercase tracking-wider">关联店铺</span>
                <select
                  value={form.store_id}
                  onChange={(event) => setForm((prev) => ({ ...prev, store_id: event.target.value }))}
                  disabled={!canEdit}
                  className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-white disabled:opacity-60"
                >
                  <option value="" className="bg-[#121217]">不关联店铺</option>
                  {stores.map((store) => (
                    <option key={store.id} value={store.id} className="bg-[#121217]">
                      {store.name}
                    </option>
                  ))}
                </select>
              </label>

              <label className="space-y-1 block">
                <span className="text-xs font-bold text-white/40 uppercase tracking-wider">关联供应商</span>
                <select
                  value={form.supplier_id}
                  onChange={(event) => setForm((prev) => ({ ...prev, supplier_id: event.target.value }))}
                  disabled={!canEdit || !canLoadSuppliers}
                  className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-white disabled:opacity-60"
                >
                  <option value="" className="bg-[#121217]">不关联供应商</option>
                  {suppliers.map((supplier) => (
                    <option key={supplier.id} value={supplier.id} className="bg-[#121217]">
                      {supplier.company_name}
                    </option>
                  ))}
                </select>
              </label>

              <label className="space-y-1 block md:col-span-2">
                <span className="text-xs font-bold text-white/40 uppercase tracking-wider">渠道</span>
                <input
                  value={form.channel_name}
                  onChange={(event) => setForm((prev) => ({ ...prev, channel_name: event.target.value }))}
                  placeholder="如：线上渠道 / 门店回款 / 转账"
                  disabled={!canEdit}
                  className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2 disabled:opacity-60"
                />
              </label>

              <label className="space-y-1 block md:col-span-2">
                <span className="text-xs font-bold text-white/40 uppercase tracking-wider">备注</span>
                <textarea
                  value={form.description}
                  onChange={(event) => setForm((prev) => ({ ...prev, description: event.target.value }))}
                  placeholder="补充说明该笔收支来源"
                  rows={4}
                  disabled={!canEdit}
                  className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2 resize-none disabled:opacity-60"
                />
              </label>

              <label className="md:col-span-2 flex items-center gap-3 rounded-2xl border border-white/10 bg-white/5 px-4 py-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={form.is_recurring}
                  onChange={(event) => setForm((prev) => ({ ...prev, is_recurring: event.target.checked }))}
                  disabled={!canEdit}
                  className="accent-accent"
                />
                <div>
                  <div className="text-sm font-medium text-white/80">标记为周期性收支</div>
                  <p className="text-xs text-white/40 mt-1">用于标识工资、房租等重复发生的流水</p>
                </div>
              </label>
            </div>

            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => {
                  setShowCreate(false);
                  setEditingTransactionId(null);
                  setForm(buildEmptyForm());
                }}
                className="px-4 py-2 rounded-xl bg-white/5"
              >
                取消
              </button>
              {canEdit ? (
                <button
                  type="button"
                  onClick={() => {
                    void handleSaveTransaction();
                  }}
                  className="px-4 py-2 rounded-xl bg-tech-gradient font-bold"
                >
                  保存
                </button>
              ) : null}
            </div>
          </div>
        </div>
      )}

      {confirmAction && (
        <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4">
          <div className="w-full max-w-md bg-[#121217] border border-white/10 rounded-3xl p-6 space-y-4">
            <h3 className="text-xl font-bold">{confirmAction.title}</h3>
            <p className="text-sm text-white/60 leading-6">{confirmAction.description}</p>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setConfirmAction(null)}
                className="px-4 py-2 rounded-xl bg-white/5"
              >
                取消
              </button>
              <button
                type="button"
                onClick={() => {
                  void submitConfirmAction();
                }}
                className="px-4 py-2 rounded-xl font-bold bg-red-500/80 hover:bg-red-500"
              >
                确认删除
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
