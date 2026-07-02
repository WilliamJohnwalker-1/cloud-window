import React, { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Modal,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import Toast from 'react-native-toast-message';

import { useAppStore } from '../store/useAppStore';
import { useFinanceStore } from '../store/useFinanceStore';
import { Colors, Radius, Shadow, Spacing } from '../theme';
import {
  canEditFinance,
  canEditFinanceInitialBalance,
  canViewFinance,
} from '../utils/permissions';

type TransactionType = 'income' | 'expense';
type RecurringFrequency = 'monthly' | 'quarterly' | 'semiannual' | 'annual';

const recurringFrequencyOptions: ReadonlyArray<{ value: RecurringFrequency; label: string }> = [
  { value: 'monthly', label: '月度' },
  { value: 'quarterly', label: '季度' },
  { value: 'semiannual', label: '半年度' },
  { value: 'annual', label: '年度' },
];

const recurringFrequencyLabelMap: Record<RecurringFrequency, string> = {
  monthly: '月度',
  quarterly: '季度',
  semiannual: '半年度',
  annual: '年度',
};

interface TransactionFormState {
  transaction_type: TransactionType;
  category: string;
  amount: string;
  transaction_date: string;
  city_id: string;
  store_id: string;
  supplier_id: string;
  product_id: string;
  breakage_quantity: string;
  channel_name: string;
  description: string;
  is_recurring: boolean;
  recurring_frequency: RecurringFrequency;
}

const getToday = (): string => new Date().toISOString().slice(0, 10);

export default function FinanceScreen() {
  const user = useAppStore((state) => state.user);
  const cities = useAppStore((state) => state.cities);
  const stores = useAppStore((state) => state.stores);
  const products = useAppStore((state) => state.products);
  const fetchCities = useAppStore((state) => state.fetchCities);
  const fetchStores = useAppStore((state) => state.fetchStores);
  const {
    transactions,
    categories,
    balance,
    fetchTransactions,
    fetchCategories,
    fetchBalance,
    addTransaction,
    updateTransaction,
    setInitialBalance,
    deleteTransaction,
  } = useFinanceStore();

  const canView = canViewFinance(user?.role);
  const canEdit = canEditFinance(user?.role);
  const canEditInitialBalance = canEditFinanceInitialBalance(user?.role);

  const [formVisible, setFormVisible] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingBalance, setEditingBalance] = useState(false);
  const [balanceDraft, setBalanceDraft] = useState('');
  const [typeFilter, setTypeFilter] = useState<'all' | TransactionType>('all');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [cityFilter, setCityFilter] = useState('all');
  const [storeFilter, setStoreFilter] = useState('all');
  const [startDateFilter, setStartDateFilter] = useState('');
  const [endDateFilter, setEndDateFilter] = useState('');
  const [form, setForm] = useState<TransactionFormState>({
    transaction_type: 'expense',
    category: '',
    amount: '',
    transaction_date: getToday(),
    city_id: '',
    store_id: '',
    supplier_id: '',
    product_id: '',
    breakage_quantity: '',
    channel_name: '',
    description: '',
    is_recurring: false,
    recurring_frequency: 'monthly',
  });

  const filteredCategories = useMemo(
    () => categories.filter((item) => item.type === form.transaction_type),
    [categories, form.transaction_type],
  );

  const filterCategoryOptions = useMemo(() => {
    if (typeFilter === 'all') {
      return categories;
    }

    return categories.filter((item) => item.type === typeFilter);
  }, [categories, typeFilter]);

  const storeNameMap = useMemo(
    () => new Map(stores.map((item) => [item.id, item.name])),
    [stores],
  );

  const cityNameMap = useMemo(
    () => new Map(cities.map((item) => [item.id, item.name])),
    [cities],
  );

  const filteredTransactions = useMemo(() => {
    return transactions.filter((item) => {
      const matchesType = typeFilter === 'all' ? true : item.transaction_type === typeFilter;
      const matchesCategory = categoryFilter === 'all' ? true : item.category === categoryFilter;
      const matchesCity = cityFilter === 'all' ? true : item.city_id === cityFilter;
      const matchesStore = storeFilter === 'all' ? true : item.store_id === storeFilter;
      const matchesStartDate = startDateFilter ? item.transaction_date >= startDateFilter : true;
      const matchesEndDate = endDateFilter ? item.transaction_date <= endDateFilter : true;

      return matchesType && matchesCategory && matchesCity && matchesStore && matchesStartDate && matchesEndDate;
    });
  }, [categoryFilter, cityFilter, endDateFilter, startDateFilter, storeFilter, transactions, typeFilter]);

  const hasActiveFilters = typeFilter !== 'all'
    || categoryFilter !== 'all'
    || cityFilter !== 'all'
    || storeFilter !== 'all'
    || Boolean(startDateFilter)
    || Boolean(endDateFilter);

  const quickStats = useMemo(() => {
    const income = transactions
      .filter((item) => item.transaction_type === 'income')
      .reduce((sum, item) => sum + Number(item.amount || 0), 0);
    const expense = transactions
      .filter((item) => item.transaction_type === 'expense')
      .reduce((sum, item) => sum + Number(item.amount || 0), 0);
    return {
      income,
      expense,
      net: income - expense,
    };
  }, [transactions]);

  useEffect(() => {
    if (!canView) return;
    fetchTransactions();
    fetchCategories();
    fetchBalance();
    fetchCities();
    fetchStores();
  }, [canView, fetchBalance, fetchCategories, fetchCities, fetchStores, fetchTransactions]);

  useEffect(() => {
    if (editingBalance) return;
    setBalanceDraft(balance ? String(balance.initial_balance) : '');
  }, [balance, editingBalance]);

  useEffect(() => {
    if (form.category || filteredCategories.length === 0) return;
    setForm((prev) => ({ ...prev, category: filteredCategories[0].name }));
  }, [filteredCategories, form.category]);

  useEffect(() => {
    if (categoryFilter === 'all') return;

    const hasMatchedCategory = filterCategoryOptions.some((item) => item.name === categoryFilter);
    if (!hasMatchedCategory) {
      setCategoryFilter('all');
    }
  }, [categoryFilter, filterCategoryOptions]);

  const resetForm = (): void => {
    setEditingId(null);
    setFormVisible(false);
    setForm({
      transaction_type: 'expense',
      category: filteredCategories[0]?.name || '',
      amount: '',
      transaction_date: getToday(),
      city_id: '',
      store_id: '',
      supplier_id: '',
      product_id: '',
      breakage_quantity: '',
      channel_name: '',
      description: '',
      is_recurring: false,
      recurring_frequency: 'monthly',
    });
  };

  const resetFilters = (): void => {
    setTypeFilter('all');
    setCategoryFilter('all');
    setCityFilter('all');
    setStoreFilter('all');
    setStartDateFilter('');
    setEndDateFilter('');
  };

  const getStoreLabel = (storeId?: string | null): string => {
    if (!storeId) {
      return '未关联店铺';
    }

    return storeNameMap.get(storeId) || '未命名店铺';
  };

  const getCityLabel = (cityId?: string | null): string => {
    if (!cityId) {
      return '未关联城市';
    }

    return cityNameMap.get(cityId) || '未命名城市';
  };

  const isBreakage = form.category === '损耗';
  const selectedBreakageProduct = products.find((item) => item.id === form.product_id);
  const breakageQty = Number(form.breakage_quantity || 0);
  const breakageAmount = isBreakage && selectedBreakageProduct
    ? Number((Number(selectedBreakageProduct.cost || 0) * (Number.isFinite(breakageQty) ? breakageQty : 0)).toFixed(2))
    : 0;

  const handleOpenAdd = (): void => {
    if (!canEdit) return;
    resetForm();
    setFormVisible(true);
  };

  const handleOpenEdit = (transactionId: string): void => {
    if (!canEdit) return;
    const tx = transactions.find((item) => item.id === transactionId);
    if (!tx) return;
    setEditingId(tx.id);
    setFormVisible(true);
    setForm({
      transaction_type: tx.transaction_type,
      category: tx.category,
      amount: String(tx.amount || ''),
      transaction_date: tx.transaction_date,
      city_id: tx.city_id || '',
      store_id: tx.store_id || '',
      supplier_id: tx.supplier_id || '',
      product_id: tx.product_id || '',
      breakage_quantity: '',
      channel_name: tx.channel_name || '',
      description: tx.description || '',
      is_recurring: tx.is_recurring,
      recurring_frequency: tx.recurring_frequency || 'monthly',
    });
  };

  const handleSaveBalance = async (): Promise<void> => {
    if (!canEditInitialBalance) return;
    const nextValue = Number(balanceDraft);
    if (!Number.isFinite(nextValue)) {
      Toast.show({ type: 'error', text1: '错误', text2: '请输入有效期初余额' });
      return;
    }
    const { error } = await setInitialBalance(nextValue);
    if (error) {
      Toast.show({ type: 'error', text1: '错误', text2: error.message });
      return;
    }
    setEditingBalance(false);
    Toast.show({ type: 'success', text1: '成功', text2: '期初余额已更新' });
  };

  const handleSubmit = async (): Promise<void> => {
    if (!canEdit) return;
    if (!form.category.trim()) {
      Toast.show({ type: 'error', text1: '错误', text2: '请选择财务分类' });
      return;
    }
    const amountValue = isBreakage ? breakageAmount : Number(form.amount);
    if (!Number.isFinite(amountValue) || amountValue <= 0) {
      Toast.show({ type: 'error', text1: '错误', text2: '金额需大于 0' });
      return;
    }

    const payload = {
      transaction_type: form.transaction_type,
      category: form.category.trim(),
      amount: amountValue,
      transaction_date: form.transaction_date,
      city_id: form.city_id || null,
      store_id: form.store_id || null,
      supplier_id: form.supplier_id || null,
      product_id: form.product_id || null,
      breakage_quantity: isBreakage ? Number(form.breakage_quantity || 0) : undefined,
      channel_name: form.channel_name.trim() || null,
      description: form.description.trim() || null,
      is_recurring: form.is_recurring,
      recurring_frequency: form.is_recurring ? form.recurring_frequency : null,
    };

    const result = editingId
      ? await updateTransaction(editingId, payload)
      : await addTransaction(payload);

    if (result.error) {
      Toast.show({ type: 'error', text1: '错误', text2: result.error.message });
      return;
    }

    Toast.show({ type: 'success', text1: '成功', text2: editingId ? '财务流水已更新' : '财务流水已创建' });
    resetForm();
  };

  const handleDelete = (id: string): void => {
    if (!canEdit) return;
    Alert.alert('确认删除', '确定删除该财务流水吗？', [
      { text: '取消', style: 'cancel' },
      {
        text: '删除',
        style: 'destructive',
        onPress: async () => {
          const { error } = await deleteTransaction(id);
          if (error) {
            Toast.show({ type: 'error', text1: '错误', text2: error.message });
            return;
          }
          Toast.show({ type: 'success', text1: '成功', text2: '财务流水已删除' });
        },
      },
    ]);
  };

  if (!canView) {
    return (
      <View style={styles.center}>
        <Text style={styles.emptyText}>无权限访问财务页面</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <LinearGradient colors={[Colors.gradientStart, Colors.gradientEnd]} style={styles.balanceCard}>
        <Text style={styles.balanceTitle}>当前余额（自动计算）</Text>
        <Text style={styles.balanceValue}>¥{Number(balance?.balance || 0).toFixed(2)}</Text>
        <Text style={styles.balanceHint}>期初余额：¥{Number(balance?.initial_balance || 0).toFixed(2)}</Text>
        {canEditInitialBalance ? (
          editingBalance ? (
            <View style={styles.balanceEditorRow}>
              <TextInput
                style={styles.balanceInput}
                keyboardType="numeric"
                value={balanceDraft}
                onChangeText={setBalanceDraft}
                placeholder="期初余额"
                placeholderTextColor={Colors.textSecondary}
              />
              <TouchableOpacity style={styles.balanceActionButton} onPress={() => void handleSaveBalance()}>
                <Text style={styles.balanceActionText}>保存</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <TouchableOpacity style={styles.balanceActionButton} onPress={() => setEditingBalance(true)}>
              <Text style={styles.balanceActionText}>设置期初余额</Text>
            </TouchableOpacity>
          )
        ) : null}
      </LinearGradient>

      <View style={styles.statsRow}>
        <View style={styles.statCard}><Text style={styles.statLabel}>总收入</Text><Text style={styles.statValue}>¥{quickStats.income.toFixed(2)}</Text></View>
        <View style={styles.statCard}><Text style={styles.statLabel}>总支出</Text><Text style={styles.statValue}>¥{quickStats.expense.toFixed(2)}</Text></View>
        <View style={styles.statCard}><Text style={styles.statLabel}>净收入</Text><Text style={styles.statValue}>¥{quickStats.net.toFixed(2)}</Text></View>
      </View>

      <View style={styles.listHeader}>
        <Text style={styles.sectionTitle}>财务流水</Text>
        {canEdit ? (
          <TouchableOpacity style={styles.primaryButton} onPress={handleOpenAdd}>
            <Text style={styles.primaryButtonText}>新增</Text>
          </TouchableOpacity>
        ) : null}
      </View>

      <View style={styles.filterCard}>
        <View style={styles.filterHeaderRow}>
          <Text style={styles.filterMetaText}>显示 {filteredTransactions.length} / {transactions.length} 条流水</Text>
          {hasActiveFilters ? (
            <TouchableOpacity onPress={resetFilters}>
              <Text style={styles.filterClearText}>清空筛选</Text>
            </TouchableOpacity>
          ) : null}
        </View>

        <Text style={styles.inputLabel}>交易类型</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.horizontalList}>
          <TouchableOpacity
            style={[styles.ghostButton, typeFilter === 'all' && styles.ghostButtonActive]}
            onPress={() => setTypeFilter('all')}
          >
            <Text style={styles.ghostButtonText}>全部</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.ghostButton, typeFilter === 'income' && styles.ghostButtonActive]}
            onPress={() => setTypeFilter('income')}
          >
            <Text style={styles.ghostButtonText}>收入</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.ghostButton, typeFilter === 'expense' && styles.ghostButtonActive]}
            onPress={() => setTypeFilter('expense')}
          >
            <Text style={styles.ghostButtonText}>支出</Text>
          </TouchableOpacity>
        </ScrollView>

        <Text style={styles.inputLabel}>分类</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.horizontalList}>
          <TouchableOpacity
            style={[styles.ghostButton, categoryFilter === 'all' && styles.ghostButtonActive]}
            onPress={() => setCategoryFilter('all')}
          >
            <Text style={styles.ghostButtonText}>全部分类</Text>
          </TouchableOpacity>
          {filterCategoryOptions.map((item) => (
            <TouchableOpacity
              key={item.id}
              style={[styles.ghostButton, categoryFilter === item.name && styles.ghostButtonActive]}
              onPress={() => setCategoryFilter(item.name)}
            >
              <Text style={styles.ghostButtonText}>{item.name}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>

        <Text style={styles.inputLabel}>城市</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.horizontalList}>
          <TouchableOpacity
            style={[styles.ghostButton, cityFilter === 'all' && styles.ghostButtonActive]}
            onPress={() => setCityFilter('all')}
          >
            <Text style={styles.ghostButtonText}>全部城市</Text>
          </TouchableOpacity>
          {cities.map((item) => (
            <TouchableOpacity
              key={item.id}
              style={[styles.ghostButton, cityFilter === item.id && styles.ghostButtonActive]}
              onPress={() => setCityFilter(item.id)}
            >
              <Text style={styles.ghostButtonText}>{item.name}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>

        <Text style={styles.inputLabel}>店铺</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.horizontalList}>
          <TouchableOpacity
            style={[styles.ghostButton, storeFilter === 'all' && styles.ghostButtonActive]}
            onPress={() => setStoreFilter('all')}
          >
            <Text style={styles.ghostButtonText}>全部店铺</Text>
          </TouchableOpacity>
          {stores.map((item) => (
            <TouchableOpacity
              key={item.id}
              style={[styles.ghostButton, storeFilter === item.id && styles.ghostButtonActive]}
              onPress={() => setStoreFilter(item.id)}
            >
              <Text style={styles.ghostButtonText}>{item.name}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>

        <Text style={styles.inputLabel}>日期范围</Text>
        <View style={styles.dateInputsRow}>
          <TextInput
            value={startDateFilter}
            onChangeText={setStartDateFilter}
            style={[styles.input, styles.dateInput]}
            placeholder="开始日期 YYYY-MM-DD"
            placeholderTextColor={Colors.textSecondary}
          />
          <TextInput
            value={endDateFilter}
            onChangeText={setEndDateFilter}
            style={[styles.input, styles.dateInput]}
            placeholder="结束日期 YYYY-MM-DD"
            placeholderTextColor={Colors.textSecondary}
          />
        </View>
      </View>

      <ScrollView style={styles.list}>
        {filteredTransactions.length === 0 ? (
          <View style={styles.emptyListState}>
            <Text style={styles.emptyText}>
              {transactions.length === 0 ? '暂无财务流水' : '当前筛选条件下暂无财务流水'}
            </Text>
          </View>
        ) : filteredTransactions.map((tx) => (
          <TouchableOpacity key={tx.id} style={styles.item} onPress={() => handleOpenEdit(tx.id)} activeOpacity={canEdit ? 0.8 : 1}>
            <View style={styles.itemTopRow}>
              <Text style={styles.itemTitle}>{tx.category}</Text>
              <Text style={styles.itemAmount}>{tx.transaction_type === 'income' ? '+' : '-'}¥{Number(tx.amount || 0).toFixed(2)}</Text>
            </View>
            <Text style={styles.itemMeta}>{tx.transaction_date} · {getCityLabel(tx.city_id)} · {getStoreLabel(tx.store_id)} · {tx.channel_name || '未填写渠道'}</Text>
            {tx.is_recurring ? (
              <Text style={styles.itemMeta}>周期频次：{recurringFrequencyLabelMap[tx.recurring_frequency || 'monthly']}</Text>
            ) : null}
            <Text style={styles.itemMeta}>{tx.description || '无备注'}</Text>
            {canEdit ? (
              <TouchableOpacity onPress={() => handleDelete(tx.id)}>
                <Text style={styles.deleteText}>删除</Text>
              </TouchableOpacity>
            ) : null}
          </TouchableOpacity>
        ))}
      </ScrollView>

      <Modal visible={formVisible} transparent animationType="slide" onRequestClose={resetForm}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <ScrollView>
              <Text style={styles.sectionTitle}>{editingId ? '编辑流水' : '新增流水'}</Text>
              <Text style={styles.inputLabel}>交易类型</Text>
              <View style={styles.rowButtons}>
                <TouchableOpacity style={[styles.ghostButton, form.transaction_type === 'income' && styles.ghostButtonActive]} onPress={() => setForm((p) => ({ ...p, transaction_type: 'income', category: '' }))}>
                  <Text style={styles.ghostButtonText}>收入</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[styles.ghostButton, form.transaction_type === 'expense' && styles.ghostButtonActive]} onPress={() => setForm((p) => ({ ...p, transaction_type: 'expense', category: '' }))}>
                  <Text style={styles.ghostButtonText}>支出</Text>
                </TouchableOpacity>
              </View>

              <Text style={styles.inputLabel}>分类</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.horizontalList}>
                {filteredCategories.map((item) => (
                  <TouchableOpacity key={item.id} style={[styles.ghostButton, form.category === item.name && styles.ghostButtonActive]} onPress={() => setForm((p) => ({ ...p, category: item.name }))}>
                    <Text style={styles.ghostButtonText}>{item.name}</Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>

              {isBreakage ? (
                <>
                  <Text style={styles.inputLabel}>报损商品</Text>
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.horizontalList}>
                    {products.map((item) => (
                      <TouchableOpacity key={item.id} style={[styles.ghostButton, form.product_id === item.id && styles.ghostButtonActive]} onPress={() => setForm((p) => ({ ...p, product_id: item.id }))}>
                        <Text style={styles.ghostButtonText}>{item.name}</Text>
                      </TouchableOpacity>
                    ))}
                  </ScrollView>

                  <Text style={styles.inputLabel}>店铺</Text>
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.horizontalList}>
                    {stores.map((item) => (
                      <TouchableOpacity
                        key={item.id}
                        style={[styles.ghostButton, form.store_id === item.id && styles.ghostButtonActive]}
                        onPress={() => setForm((p) => ({ ...p, store_id: item.id, city_id: item.city_id || p.city_id }))}
                      >
                        <Text style={styles.ghostButtonText}>{item.name}</Text>
                      </TouchableOpacity>
                    ))}
                  </ScrollView>

                  <Text style={styles.inputLabel}>报损数量</Text>
                  <TextInput
                    value={form.breakage_quantity}
                    onChangeText={(text) => setForm((p) => ({ ...p, breakage_quantity: text }))}
                    keyboardType="numeric"
                    style={styles.input}
                    placeholder="请输入数量"
                    placeholderTextColor={Colors.textSecondary}
                  />
                  <Text style={styles.autoAmountText}>自动金额：¥{breakageAmount.toFixed(2)}</Text>
                </>
              ) : (
                <>
                  <Text style={styles.inputLabel}>金额</Text>
                  <TextInput
                    value={form.amount}
                    onChangeText={(text) => setForm((p) => ({ ...p, amount: text }))}
                    keyboardType="numeric"
                    style={styles.input}
                    placeholder="请输入金额"
                    placeholderTextColor={Colors.textSecondary}
                  />
                </>
              )}

              <Text style={styles.inputLabel}>日期</Text>
              <TextInput
                value={form.transaction_date}
                onChangeText={(text) => setForm((p) => ({ ...p, transaction_date: text }))}
                style={styles.input}
                placeholder="YYYY-MM-DD"
                placeholderTextColor={Colors.textSecondary}
              />

              {!isBreakage ? (
                <>
                  <Text style={styles.inputLabel}>城市</Text>
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.horizontalList}>
                    <TouchableOpacity
                      style={[styles.ghostButton, form.city_id === '' && styles.ghostButtonActive]}
                      onPress={() => setForm((p) => ({ ...p, city_id: '', store_id: '' }))}
                    >
                      <Text style={styles.ghostButtonText}>不关联城市</Text>
                    </TouchableOpacity>
                    {cities.map((item) => (
                      <TouchableOpacity
                        key={item.id}
                        style={[styles.ghostButton, form.city_id === item.id && styles.ghostButtonActive]}
                        onPress={() => setForm((p) => ({ ...p, city_id: item.id, store_id: '' }))}
                      >
                        <Text style={styles.ghostButtonText}>{item.name}</Text>
                      </TouchableOpacity>
                    ))}
                  </ScrollView>

                  <Text style={styles.inputLabel}>店铺</Text>
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.horizontalList}>
                    <TouchableOpacity
                      style={[styles.ghostButton, form.store_id === '' && styles.ghostButtonActive]}
                      onPress={() => setForm((p) => ({ ...p, store_id: '' }))}
                    >
                      <Text style={styles.ghostButtonText}>不关联店铺</Text>
                    </TouchableOpacity>
                    {stores.map((item) => (
                      <TouchableOpacity
                        key={item.id}
                        style={[styles.ghostButton, form.store_id === item.id && styles.ghostButtonActive]}
                        onPress={() => setForm((p) => ({ ...p, store_id: item.id, city_id: item.city_id || p.city_id }))}
                      >
                        <Text style={styles.ghostButtonText}>{item.name}</Text>
                      </TouchableOpacity>
                    ))}
                  </ScrollView>
                </>
              ) : null}

              <Text style={styles.inputLabel}>渠道</Text>
              <TextInput
                value={form.channel_name}
                onChangeText={(text) => setForm((p) => ({ ...p, channel_name: text }))}
                style={styles.input}
                placeholder="如：线上渠道"
                placeholderTextColor={Colors.textSecondary}
              />

              <Text style={styles.inputLabel}>备注</Text>
              <TextInput
                value={form.description}
                onChangeText={(text) => setForm((p) => ({ ...p, description: text }))}
                style={[styles.input, styles.multilineInput]}
                multiline
                placeholder="请输入备注"
                placeholderTextColor={Colors.textSecondary}
              />

              <View style={styles.switchRow}>
                <Text style={styles.inputLabel}>周期性流水</Text>
                <Switch value={form.is_recurring} onValueChange={(value) => setForm((p) => ({ ...p, is_recurring: value }))} />
              </View>

              {form.is_recurring ? (
                <>
                  <Text style={styles.inputLabel}>周期频次</Text>
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.horizontalList}>
                    {recurringFrequencyOptions.map((item) => (
                      <TouchableOpacity
                        key={item.value}
                        style={[styles.ghostButton, form.recurring_frequency === item.value && styles.ghostButtonActive]}
                        onPress={() => setForm((p) => ({ ...p, recurring_frequency: item.value }))}
                      >
                        <Text style={styles.ghostButtonText}>{item.label}</Text>
                      </TouchableOpacity>
                    ))}
                  </ScrollView>
                </>
              ) : null}

              <View style={styles.modalActions}>
                <TouchableOpacity style={styles.ghostButton} onPress={resetForm}>
                  <Text style={styles.ghostButtonText}>取消</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.primaryButton} onPress={() => void handleSubmit()}>
                  <Text style={styles.primaryButtonText}>保存</Text>
                </TouchableOpacity>
              </View>
            </ScrollView>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
    padding: Spacing.lg,
    gap: Spacing.md,
  },
  center: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: Colors.background,
  },
  emptyText: {
    color: Colors.textSecondary,
    fontSize: 15,
  },
  balanceCard: {
    borderRadius: Radius.xl,
    padding: Spacing.lg,
    ...Shadow.card,
  },
  balanceTitle: {
    color: Colors.textOnGradient,
    fontSize: 13,
    opacity: 0.9,
  },
  balanceValue: {
    marginTop: Spacing.sm,
    color: Colors.textOnGradient,
    fontSize: 28,
    fontWeight: '700',
  },
  balanceHint: {
    marginTop: Spacing.xs,
    color: Colors.textOnGradient,
    opacity: 0.9,
    fontSize: 12,
  },
  balanceEditorRow: {
    marginTop: Spacing.sm,
    flexDirection: 'row',
    gap: Spacing.sm,
    alignItems: 'center',
  },
  balanceInput: {
    flex: 1,
    backgroundColor: Colors.surface,
    borderRadius: Radius.md,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    color: Colors.textPrimary,
  },
  balanceActionButton: {
    marginTop: Spacing.sm,
    alignSelf: 'flex-start',
    backgroundColor: Colors.surface,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderRadius: Radius.md,
  },
  balanceActionText: {
    color: Colors.textPrimary,
    fontWeight: '600',
  },
  statsRow: {
    flexDirection: 'row',
    gap: Spacing.sm,
  },
  statCard: {
    flex: 1,
    backgroundColor: Colors.surface,
    borderRadius: Radius.lg,
    padding: Spacing.md,
    ...Shadow.soft,
  },
  statLabel: {
    color: Colors.textSecondary,
    fontSize: 12,
  },
  statValue: {
    color: Colors.textPrimary,
    fontWeight: '700',
    marginTop: Spacing.xs,
  },
  filterCard: {
    backgroundColor: Colors.surface,
    borderRadius: Radius.lg,
    padding: Spacing.md,
    ...Shadow.soft,
  },
  filterHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: Spacing.sm,
  },
  filterMetaText: {
    flex: 1,
    color: Colors.textSecondary,
    fontSize: 12,
  },
  filterClearText: {
    color: Colors.pink,
    fontWeight: '600',
  },
  dateInputsRow: {
    flexDirection: 'row',
    gap: Spacing.sm,
  },
  dateInput: {
    flex: 1,
  },
  listHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  sectionTitle: {
    color: Colors.textPrimary,
    fontSize: 18,
    fontWeight: '700',
  },
  primaryButton: {
    borderRadius: Radius.md,
    overflow: 'hidden',
    backgroundColor: Colors.pink,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
  },
  primaryButtonText: {
    color: Colors.textOnGradient,
    fontWeight: '700',
  },
  list: {
    flex: 1,
  },
  emptyListState: {
    backgroundColor: Colors.surface,
    borderRadius: Radius.lg,
    padding: Spacing.lg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  item: {
    backgroundColor: Colors.surface,
    borderRadius: Radius.lg,
    padding: Spacing.md,
    marginBottom: Spacing.sm,
    ...Shadow.soft,
  },
  itemTopRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  itemTitle: {
    color: Colors.textPrimary,
    fontWeight: '700',
  },
  itemAmount: {
    color: Colors.textPrimary,
    fontWeight: '700',
  },
  itemMeta: {
    marginTop: Spacing.xs,
    color: Colors.textSecondary,
    fontSize: 12,
  },
  deleteText: {
    marginTop: Spacing.sm,
    color: Colors.danger,
    fontWeight: '600',
  },
  modalOverlay: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(0,0,0,0.45)',
  },
  modalCard: {
    maxHeight: '88%',
    backgroundColor: Colors.surface,
    borderTopLeftRadius: Radius.xxl,
    borderTopRightRadius: Radius.xxl,
    padding: Spacing.lg,
  },
  inputLabel: {
    color: Colors.textPrimary,
    fontWeight: '600',
    marginTop: Spacing.sm,
    marginBottom: Spacing.xs,
  },
  input: {
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Colors.border,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    color: Colors.textPrimary,
    backgroundColor: Colors.surfaceSecondary,
  },
  multilineInput: {
    minHeight: 88,
    textAlignVertical: 'top',
  },
  rowButtons: {
    flexDirection: 'row',
    gap: Spacing.sm,
  },
  horizontalList: {
    maxHeight: 44,
  },
  ghostButton: {
    marginRight: Spacing.sm,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Colors.border,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    backgroundColor: Colors.surface,
  },
  ghostButtonActive: {
    borderColor: Colors.pink,
    backgroundColor: Colors.pinkBg,
  },
  ghostButtonText: {
    color: Colors.textPrimary,
    fontWeight: '600',
  },
  autoAmountText: {
    marginTop: Spacing.xs,
    color: Colors.info,
    fontWeight: '600',
  },
  switchRow: {
    marginTop: Spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  modalActions: {
    marginTop: Spacing.lg,
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: Spacing.sm,
  },
});
