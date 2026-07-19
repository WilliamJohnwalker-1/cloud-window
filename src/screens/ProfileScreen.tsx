import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Alert,
  Modal,
  KeyboardAvoidingView,
  TextInput,
  FlatList,
  ScrollView,
  Switch,
  Image,
  Linking,
  Platform,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import Constants from 'expo-constants';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Updates from 'expo-updates';
import * as Clipboard from 'expo-clipboard';
import { User, MapPin, Users, WifiOff, Bell, Info, PackagePlus, CheckCircle2, Moon, Sun, ArrowUp, ArrowDown, Store as StoreIcon, Copy, Check, ChevronDown, ChevronUp } from 'lucide-react-native';
import Toast from 'react-native-toast-message';
import { useShallow } from 'zustand/react/shallow';

import { useAppStore } from '../store/useAppStore';
import { useFinanceStore } from '../store/useFinanceStore';
import { useProductSeriesStore } from '../store/useProductSeriesStore';
import { useSupplierStore } from '../store/useSupplierStore';
import AppConfirmModal from '../components/AppConfirmModal';
import { avatarLibrary } from '../constants/avatarLibrary';
import { Colors, LightColors, DarkColors, Radius, Shadow, Spacing } from '../theme';
import type { FinancialTransaction, Notification, Store, Supplier } from '../types';
import {
  canEditFinance,
  canEditFinanceInitialBalance,
  canEditProductSeries,
  canEditSuppliers,
  canViewFinance,
  canViewSuppliers,
} from '../utils/permissions';
import { getProvincesFromCities, getProvinceForCity } from '../utils/provinceMapping';
import ProvinceCityFilter from '../components/ProvinceCityFilter';
import { compareVersion, resolveBinaryUpdateInfo } from '../utils/update';

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

const cooperationModeLabelMap: Record<'consignment' | 'buyout' | 'direct', string> = {
  consignment: '寄售',
  buyout: '买断',
  direct: '直营',
};
export default function ProfileScreen() {
  const {
    user,
    setUser,
    signOut,
    setOfflineMode,
    isOfflineMode,
    isDarkMode,
    setDarkMode,
    cities,
    distributors,
    notifications,
    orders,
    stores,
    fetchCities,
    fetchDistributors,
    fetchNotifications,
    fetchStores,
    addCity,
    deleteCity,
    moveCityOrder,
    addStore,
    updateStore,
    deactivateStore,
    deleteStore,
    updateDistributorProfile,
    updateOwnStoreName,
    updateOwnAvatar,
    acceptOrder,
    markNotificationRead,
    markAllNotificationsRead,
  } = useAppStore(
    useShallow((state) => ({
      user: state.user,
      setUser: state.setUser,
      signOut: state.signOut,
      setOfflineMode: state.setOfflineMode,
      isOfflineMode: state.isOfflineMode,
      isDarkMode: state.isDarkMode,
      setDarkMode: state.setDarkMode,
      cities: state.cities,
      distributors: state.distributors,
      notifications: state.notifications,
      orders: state.orders,
      stores: state.stores,
      fetchCities: state.fetchCities,
      fetchDistributors: state.fetchDistributors,
      fetchNotifications: state.fetchNotifications,
      fetchStores: state.fetchStores,
      addCity: state.addCity,
      deleteCity: state.deleteCity,
      moveCityOrder: state.moveCityOrder,
      addStore: state.addStore,
      updateStore: state.updateStore,
      deactivateStore: state.deactivateStore,
      deleteStore: state.deleteStore,
      updateDistributorProfile: state.updateDistributorProfile,
      updateOwnStoreName: state.updateOwnStoreName,
      updateOwnAvatar: state.updateOwnAvatar,
      acceptOrder: state.acceptOrder,
      markNotificationRead: state.markNotificationRead,
      markAllNotificationsRead: state.markAllNotificationsRead,
    })),
  );

  const {
    transactions,
    balance,
    financeLoading,
    financeError,
    categories,
    fetchTransactions,
    fetchBalance,
    addTransaction,
    updateTransaction,
    setInitialBalance,
    deleteTransaction,
    fetchCategories,
  } = useFinanceStore(
    useShallow((state) => ({
      transactions: state.transactions,
      balance: state.balance,
      financeLoading: state.isLoading,
      financeError: state.error,
      categories: state.categories,
      fetchTransactions: state.fetchTransactions,
      fetchBalance: state.fetchBalance,
      addTransaction: state.addTransaction,
      updateTransaction: state.updateTransaction,
      setInitialBalance: state.setInitialBalance,
      deleteTransaction: state.deleteTransaction,
      fetchCategories: state.fetchCategories,
    })),
  );

  const {
    series,
    seriesLoading,
    fetchSeries,
    addSeries,
    updateSeries,
    deleteSeries,
  } = useProductSeriesStore(
    useShallow((state) => ({
      series: state.series,
      seriesLoading: state.isLoading,
      fetchSeries: state.fetchSeries,
      addSeries: state.addSeries,
      updateSeries: state.updateSeries,
      deleteSeries: state.deleteSeries,
    })),
  );

  const {
    suppliers,
    supplierLoading,
    fetchSuppliers,
    addSupplier,
    updateSupplier,
    deleteSupplier,
  } = useSupplierStore(
    useShallow((state) => ({
      suppliers: state.suppliers,
      supplierLoading: state.isLoading,
      fetchSuppliers: state.fetchSuppliers,
      addSupplier: state.addSupplier,
      updateSupplier: state.updateSupplier,
      deleteSupplier: state.deleteSupplier,
    })),
  );

  const [cityModalVisible, setCityModalVisible] = useState(false);
  const [distributorModalVisible, setDistributorModalVisible] = useState(false);
  const [storeModalVisible, setStoreModalVisible] = useState(false);
  const [editingStoreId, setEditingStoreId] = useState<string | null>(null);
  const [isAddingStore, setIsAddingStore] = useState(false);
  const [editStoreData, setEditStoreData] = useState({
    name: '',
    city_id: '',
    distributor_id: '',
    discount_rate: '1',
    contact: '',
    address: '',
    phone: '',
    settlement_day: '',
    cooperation_mode: 'consignment' as 'consignment' | 'buyout' | 'direct',
    contract_expiry_date: '',
    grade: '' as '' | 'S' | 'A' | 'B' | 'C' | 'D' | 'E',
    contract_file_url: '',
    invoice_title: '',
    tax_id: '',
    bank_name: '',
    bank_account: '',
    invoice_phone: '',
    invoice_address: '',
    status: 'active' as 'active' | 'inactive',
  });
  const [profileModalVisible, setProfileModalVisible] = useState(false);
  const [notificationModalVisible, setNotificationModalVisible] = useState(false);
  const [aboutModalVisible, setAboutModalVisible] = useState(false);
  const [newCityName, setNewCityName] = useState('');
  const [editingDistributorId, setEditingDistributorId] = useState<string | null>(null);
  const [editCityId, setEditCityId] = useState('');
  const [editStoreName, setEditStoreName] = useState('');
  const [ownStoreName, setOwnStoreName] = useState(user?.store_name || '');
  const [savingOwnStore, setSavingOwnStore] = useState(false);
  const [checkingUpdate, setCheckingUpdate] = useState(false);
  const [logoutConfirmVisible, setLogoutConfirmVisible] = useState(false);
  const [updateConfirmVisible, setUpdateConfirmVisible] = useState(false);
  const [binaryUpdateConfirmVisible, setBinaryUpdateConfirmVisible] = useState(false);
  const [binaryUpdateUrl, setBinaryUpdateUrl] = useState('');
  const [binaryUpdateVersion, setBinaryUpdateVersion] = useState('');
  const [avatarModalVisible, setAvatarModalVisible] = useState(false);
  const [sortingCityId, setSortingCityId] = useState<string | null>(null);
  const [provinceModalVisible, setProvinceModalVisible] = useState(false);
  const [provinceOrder, setProvinceOrder] = useState<string[]>([]);
  const [sortingProvince, setSortingProvince] = useState<string | null>(null);
  const [storeFilterProvinceId, setStoreFilterProvinceId] = useState<string | null>(null);
  const [storeFilterCityId, setStoreFilterCityId] = useState<string | null>(null);
  const [isStoreEditorInvoiceExpanded, setIsStoreEditorInvoiceExpanded] = useState(false);
  const [expandedInvoiceByStore, setExpandedInvoiceByStore] = useState<Record<string, boolean>>({});
  const [copiedInvoiceKey, setCopiedInvoiceKey] = useState<string | null>(null);
  const [seriesModalVisible, setSeriesModalVisible] = useState(false);
  const [isAddingSeries, setIsAddingSeries] = useState(false);
  const [editingSeriesId, setEditingSeriesId] = useState<string | null>(null);
  const [seriesName, setSeriesName] = useState('');
  const [seriesSortIndex, setSeriesSortIndex] = useState('');
  const [financeModalVisible, setFinanceModalVisible] = useState(false);
  const [isEditingBalance, setIsEditingBalance] = useState(false);
  const [balanceDraft, setBalanceDraft] = useState('');
  const [isAddingTransaction, setIsAddingTransaction] = useState(false);
  const [editingTransactionId, setEditingTransactionId] = useState<string | null>(null);
  const [editTransactionData, setEditTransactionData] = useState({
    transaction_type: 'expense' as 'income' | 'expense',
    category: '',
    amount: '',
    transaction_date: new Date().toISOString().slice(0, 10),
    store_id: '',
    supplier_id: '',
    channel_name: '',
    description: '',
    is_recurring: false,
    recurring_frequency: 'monthly' as RecurringFrequency,
  });
  const [supplierModalVisible, setSupplierModalVisible] = useState(false);
  const [isAddingSupplier, setIsAddingSupplier] = useState(false);
  const [editingSupplierId, setEditingSupplierId] = useState<string | null>(null);
  const [editSupplierData, setEditSupplierData] = useState({
    company_name: '',
    contact: '',
    phone: '',
    address: '',
    delivery_cycle_days: '',
    avg_unit_price: '',
    status: 'active' as 'active' | 'inactive',
  });

  const theme = isDarkMode ? DarkColors : LightColors;
  const appVersion = Constants.expoConfig?.version || '未知版本';
  const isAdmin = user?.role === 'admin' || user?.role === 'super_admin';
  const isSuperAdmin = user?.role === 'super_admin';
  const isDistributor = user?.role === 'distributor';
  const canManageProductSeries = canEditProductSeries(user?.role);
  const canViewFinanceManagement = canViewFinance(user?.role);
  const canEditFinanceManagement = canEditFinance(user?.role);
  const canEditFinanceInitialBalanceManagement = canEditFinanceInitialBalance(user?.role);
  const canViewSupplierManagement = canViewSuppliers(user?.role);
  const canEditSupplierManagement = canEditSuppliers(user?.role);
  const financeEntryLabel = canEditFinanceManagement
    ? '余额总览'
    : canEditFinanceInitialBalanceManagement
      ? '余额总览（可调期初余额）'
      : '余额总览（只读）';
  const unreadCount = notifications.filter((n) => !n.is_read).length;

  const formatCurrency = (amount: number): string => amount.toLocaleString('zh-CN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

  const formatDateTime = (value?: string | null): string => {
    if (!value) {
      return '暂未更新';
    }

    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      return value;
    }

    return date.toLocaleString('zh-CN');
  };


  useEffect(() => {
    fetchCities();
    if (isAdmin) fetchDistributors();
    fetchNotifications();
  }, [isAdmin, fetchCities, fetchDistributors, fetchNotifications]);

  useEffect(() => {
    if (!canManageProductSeries) return;
    fetchSeries();
  }, [canManageProductSeries, fetchSeries]);

  useEffect(() => {
    if (!canViewSupplierManagement) return;
    fetchSuppliers();
  }, [canViewSupplierManagement, fetchSuppliers]);

  useEffect(() => {
    if (!canViewFinanceManagement) return;

    fetchBalance();
    fetchCategories();
    fetchTransactions();
    fetchStores();
  }, [canViewFinanceManagement, fetchBalance, fetchCategories, fetchTransactions, fetchStores]);

  useEffect(() => {
    if (isEditingBalance) {
      return;
    }

    setBalanceDraft(balance ? String(balance.initial_balance) : '');
  }, [balance, isEditingBalance]);

  useEffect(() => {
    const loadProvinceOrder = async () => {
      try {
        const saved = await AsyncStorage.getItem('province_order');
        if (saved) {
          setProvinceOrder(JSON.parse(saved));
        }
      } catch (e) {
        console.error('Failed to load province order', e);
      }
    };
    loadProvinceOrder();
  }, []);

  const derivedProvinces = React.useMemo(() => {
    const baseProvinces = getProvincesFromCities(cities);
    return [...baseProvinces].sort((a, b) => {
      const indexA = provinceOrder.indexOf(a);
      const indexB = provinceOrder.indexOf(b);
      if (indexA !== -1 && indexB !== -1) return indexA - indexB;
      if (indexA !== -1) return -1;
      if (indexB !== -1) return 1;
      return a.localeCompare(b, 'zh-CN');
    });
  }, [cities, provinceOrder]);

  const provinceCityCount = React.useMemo(() => {
    const counts = new Map<string, number>();

    cities.forEach((city) => {
      const province = city.province || getProvinceForCity(city.name) || '未知省份';
      counts.set(province, (counts.get(province) || 0) + 1);
    });

    return counts;
  }, [cities]);

  const filteredStores = React.useMemo(() => {
    return stores.filter((store) => {
      const city = cities.find((c) => c.id === store.city_id);
      const province = city?.province || (city ? getProvinceForCity(city.name) : null);
      const matchesProvince = storeFilterProvinceId
        ? (storeFilterProvinceId === '未知省份' ? !province : province === storeFilterProvinceId)
        : true;
      const matchesCity = storeFilterCityId ? store.city_id === storeFilterCityId : true;
      return matchesProvince && matchesCity;
    });
  }, [stores, cities, storeFilterProvinceId, storeFilterCityId]);

  const hasInvoiceInfo = React.useCallback((store: Store): boolean => {
    return Boolean(store.invoice_title || store.tax_id || store.bank_name || store.bank_account || store.invoice_phone || store.invoice_address);
  }, []);

  const buildInvoiceText = React.useCallback((store: Store): string => {
    return [
      `发票抬头：${store.invoice_title || '-'}`,
      `纳税人识别号：${store.tax_id || '-'}`,
      `开户行：${store.bank_name || '-'}`,
      `账号：${store.bank_account || '-'}`,
      `联系电话：${store.invoice_phone || '-'}`,
      `开票地址：${store.invoice_address || '-'}`,
    ].join('\n');
  }, []);

  const copyInvoiceText = React.useCallback(async (text: string, key: string) => {
    if (!text.trim() || text.trim() === '-') {
      Toast.show({ type: 'error', text1: '错误', text2: '无可复制内容' });
      return;
    }

    try {
      await Clipboard.setStringAsync(text);
      setCopiedInvoiceKey(key);
      setTimeout(() => {
        setCopiedInvoiceKey((prev) => (prev === key ? null : prev));
      }, 1500);
      Toast.show({ type: 'success', text1: '成功', text2: '已复制到剪贴板' });
    } catch (error) {
      const message = error instanceof Error ? error.message : '未知错误';
      Toast.show({ type: 'error', text1: '复制失败', text2: message });
    }
  }, []);

  const filteredFinanceCategories = React.useMemo(
    () => categories.filter((item) => item.type === editTransactionData.transaction_type),
    [categories, editTransactionData.transaction_type],
  );

  const transactionStoreMap = React.useMemo(
    () => new Map(stores.map((item) => [item.id, item.name])),
    [stores],
  );

  const transactionSupplierMap = React.useMemo(
    () => new Map(suppliers.map((item) => [item.id, item.company_name])),
    [suppliers],
  );

  const moveProvinceOrder = async (province: string, direction: 'up' | 'down') => {
    setSortingProvince(province);
    try {
      const currentOrder = [...derivedProvinces];
      const index = currentOrder.indexOf(province);
      if (index === -1) return;

      if (direction === 'up' && index > 0) {
        const temp = currentOrder[index - 1];
        currentOrder[index - 1] = currentOrder[index];
        currentOrder[index] = temp;
      } else if (direction === 'down' && index < currentOrder.length - 1) {
        const temp = currentOrder[index + 1];
        currentOrder[index + 1] = currentOrder[index];
        currentOrder[index] = temp;
      } else {
        return;
      }

      setProvinceOrder(currentOrder);
      await AsyncStorage.setItem('province_order', JSON.stringify(currentOrder));
    } catch {
      Toast.show({ type: 'error', text1: '错误', text2: '保存省份排序失败' });
    } finally {
      setSortingProvince(null);
    }
  };


  useEffect(() => {
    setOwnStoreName(user?.store_name || '');
  }, [user?.store_name]);

  // --- Distributor self-edit store name ---
  const handleSaveOwnStore = async () => {
    if (!ownStoreName.trim()) {
      Toast.show({ type: 'error', text1: '错误', text2: '店面名称不能为空' });
      return;
    }
    setSavingOwnStore(true);
    const { error } = await updateOwnStoreName(ownStoreName.trim());
    setSavingOwnStore(false);
    if (error) {
      Toast.show({ type: 'error', text1: '错误', text2: error.message });
    } else {
      Toast.show({ type: 'success', text1: '成功', text2: '店面名称已更新' });
      setProfileModalVisible(false);
    }
  };

  // --- Admin distributor edit (city only or city+store) ---
  const openEditDistributor = (id: string, cityId?: string | null, storeName?: string | null) => {
    setEditingDistributorId(id);
    setEditCityId(cityId || '');
    setEditStoreName(storeName || '');
  };

  const handleSaveDistributor = async () => {
    if (!editingDistributorId) return;
    if (!editCityId) {
      Toast.show({ type: 'error', text1: '错误', text2: '请选择归属城市' });
      return;
    }
    // Admin can save city-only; storeName is optional
    const storeToSave = editStoreName.trim() || undefined;
    const { error } = await updateDistributorProfile(editingDistributorId, editCityId, storeToSave);
    if (error) {
      Toast.show({ type: 'error', text1: '错误', text2: error.message });
      return;
    }
    Toast.show({ type: 'success', text1: '成功', text2: '分销商资料已更新' });
    setEditingDistributorId(null);
  };

  const resetTransactionEditor = () => {
    setIsAddingTransaction(false);
    setEditingTransactionId(null);
    setEditTransactionData({
      transaction_type: 'expense',
      category: '',
      amount: '',
      transaction_date: new Date().toISOString().slice(0, 10),
      store_id: '',
      supplier_id: '',
      channel_name: '',
      description: '',
      is_recurring: false,
      recurring_frequency: 'monthly',
    });
  };

  const resetBalanceEditor = () => {
    setIsEditingBalance(false);
    setBalanceDraft(balance ? String(balance.initial_balance) : '');
  };

  const handleOpenFinanceOverview = () => {
    fetchBalance();
    fetchCategories();
    fetchTransactions();
    fetchStores();
    if (canViewSupplierManagement) {
      fetchSuppliers();
    }
    setFinanceModalVisible(true);
  };

  const openBalanceEditor = () => {
    if (!canEditFinanceInitialBalanceManagement) {
      Toast.show({ type: 'error', text1: '无权限', text2: '仅管理员或财务可更新期初余额' });
      return;
    }

    setIsEditingBalance(true);
    setBalanceDraft(balance ? String(balance.initial_balance) : '');
  };

  const handleSaveBalance = async () => {
    if (!canEditFinanceInitialBalanceManagement) {
      Toast.show({ type: 'error', text1: '无权限', text2: '仅管理员或财务可更新期初余额' });
      return;
    }

    const nextBalance = Number(balanceDraft);
    if (!Number.isFinite(nextBalance)) {
      Toast.show({ type: 'error', text1: '错误', text2: '请输入有效的余额数字' });
      return;
    }

    const { error } = await setInitialBalance(nextBalance);
    if (error) {
      Toast.show({ type: 'error', text1: '错误', text2: error.message });
      return;
    }

    setBalanceDraft(String(nextBalance));
    setIsEditingBalance(false);
    Toast.show({
      type: 'success',
      text1: '成功',
      text2: balance ? '余额已更新' : '余额已录入',
    });
  };

  const openAddTransaction = () => {
    if (!canEditFinanceManagement) {
      Toast.show({ type: 'error', text1: '无权限', text2: '仅财务可新增或编辑财务流水' });
      return;
    }

    resetTransactionEditor();
    setIsAddingTransaction(true);
  };

  const openEditTransaction = (transaction: FinancialTransaction) => {
    if (!canEditFinanceManagement) {
      return;
    }

    setIsAddingTransaction(false);
    setEditingTransactionId(transaction.id);
    setEditTransactionData({
      transaction_type: transaction.transaction_type,
      category: transaction.category,
      amount: String(transaction.amount),
      transaction_date: transaction.transaction_date,
      store_id: transaction.store_id || '',
      supplier_id: transaction.supplier_id || '',
      channel_name: transaction.channel_name || '',
      description: transaction.description || '',
      is_recurring: transaction.is_recurring,
      recurring_frequency: transaction.recurring_frequency || 'monthly',
    });
  };

  const handleSaveTransaction = async () => {
    if (!canEditFinanceManagement) {
      Toast.show({ type: 'error', text1: '无权限', text2: '仅财务可新增或编辑财务流水' });
      return;
    }

    if (!editTransactionData.category.trim()) {
      Toast.show({ type: 'error', text1: '错误', text2: '请选择财务分类' });
      return;
    }

    const amountValue = Number(editTransactionData.amount);
    if (!Number.isFinite(amountValue) || amountValue <= 0) {
      Toast.show({ type: 'error', text1: '错误', text2: '金额需为大于 0 的数字' });
      return;
    }

    if (!editTransactionData.transaction_date.trim()) {
      Toast.show({ type: 'error', text1: '错误', text2: '请输入交易日期' });
      return;
    }

    const payload = {
      transaction_type: editTransactionData.transaction_type,
      category: editTransactionData.category.trim(),
      amount: amountValue,
      transaction_date: editTransactionData.transaction_date.trim(),
      store_id: editTransactionData.store_id || null,
      supplier_id: editTransactionData.supplier_id || null,
      channel_name: editTransactionData.channel_name.trim() || null,
      description: editTransactionData.description.trim() || null,
      is_recurring: editTransactionData.is_recurring,
      recurring_frequency: editTransactionData.is_recurring ? editTransactionData.recurring_frequency : null,
    };

    const result = isAddingTransaction
      ? await addTransaction(payload)
      : editingTransactionId
        ? await updateTransaction(editingTransactionId, payload)
        : { error: new Error('未找到要保存的财务流水') };

    if (result.error) {
      Toast.show({ type: 'error', text1: '错误', text2: result.error.message });
      return;
    }

    Toast.show({
      type: 'success',
      text1: '成功',
      text2: isAddingTransaction ? '财务流水已添加' : '财务流水已更新',
    });
    resetTransactionEditor();
  };

  const handleDeleteTransaction = (transaction: FinancialTransaction) => {
    if (!canEditFinanceManagement) {
      Toast.show({ type: 'error', text1: '无权限', text2: '仅财务可删除财务流水' });
      return;
    }

    Alert.alert('确认删除', `确定要删除「${transaction.category}」这条流水吗？`, [
      { text: '取消', style: 'cancel' },
      {
        text: '删除',
        style: 'destructive',
        onPress: async () => {
          const { error } = await deleteTransaction(transaction.id);
          if (error) {
            Toast.show({ type: 'error', text1: '错误', text2: error.message });
            return;
          }

          if (editingTransactionId === transaction.id) {
            resetTransactionEditor();
          }

          Toast.show({ type: 'success', text1: '成功', text2: '财务流水已删除' });
        },
      },
    ]);
  };

  const openAddSeries = () => {
    if (!canManageProductSeries) {
      Toast.show({ type: 'error', text1: '无权限', text2: '仅管理员可编辑商品系列' });
      return;
    }

    const nextSortIndex = series.length > 0
      ? Math.max(...series.map((item) => Number(item.sort_index || 0))) + 1
      : 1;

    setIsAddingSeries(true);
    setEditingSeriesId(null);
    setSeriesName('');
    setSeriesSortIndex(String(nextSortIndex));
  };

  const openEditSeries = (id: string, name: string, sortIndex: number) => {
    if (!canManageProductSeries) {
      Toast.show({ type: 'error', text1: '无权限', text2: '仅管理员可编辑商品系列' });
      return;
    }

    setIsAddingSeries(false);
    setEditingSeriesId(id);
    setSeriesName(name);
    setSeriesSortIndex(String(sortIndex));
  };

  const handleSaveSeries = async () => {
    if (!canManageProductSeries) {
      Toast.show({ type: 'error', text1: '无权限', text2: '仅管理员可编辑商品系列' });
      return;
    }

    if (!seriesName.trim()) {
      Toast.show({ type: 'error', text1: '错误', text2: '请输入系列名称' });
      return;
    }

    const sortValue = Number(seriesSortIndex);
    if (!Number.isInteger(sortValue) || sortValue < 0) {
      Toast.show({ type: 'error', text1: '错误', text2: '排序值需为大于等于 0 的整数' });
      return;
    }

    if (isAddingSeries) {
      const { error } = await addSeries({
        name: seriesName.trim(),
        sort_index: sortValue,
      });
      if (error) {
        Toast.show({ type: 'error', text1: '错误', text2: error.message });
        return;
      }
      Toast.show({ type: 'success', text1: '成功', text2: '系列已添加' });
    } else if (editingSeriesId) {
      const { error } = await updateSeries(editingSeriesId, {
        name: seriesName.trim(),
        sort_index: sortValue,
      });
      if (error) {
        Toast.show({ type: 'error', text1: '错误', text2: error.message });
        return;
      }
      Toast.show({ type: 'success', text1: '成功', text2: '系列已更新' });
    }

    await fetchSeries();
    setIsAddingSeries(false);
    setEditingSeriesId(null);
    setSeriesName('');
    setSeriesSortIndex('');
  };

  const handleDeleteSeries = (id: string, name: string) => {
    if (!canManageProductSeries) {
      Toast.show({ type: 'error', text1: '无权限', text2: '仅管理员可编辑商品系列' });
      return;
    }

    Alert.alert('确认删除', `确定要删除系列「${name}」吗？`, [
      { text: '取消', style: 'cancel' },
      {
        text: '删除',
        style: 'destructive',
        onPress: async () => {
          const { error } = await deleteSeries(id);
          if (error) {
            Toast.show({ type: 'error', text1: '错误', text2: error.message });
            return;
          }

          await fetchSeries();
          Toast.show({ type: 'success', text1: '成功', text2: '系列已删除' });
        },
      },
    ]);
  };

  const openAddSupplier = () => {
    if (!canEditSupplierManagement) {
      Toast.show({ type: 'error', text1: '无权限', text2: '仅超级管理员可编辑供应商信息' });
      return;
    }

    setIsAddingSupplier(true);
    setEditingSupplierId(null);
    setEditSupplierData({
      company_name: '',
      contact: '',
      phone: '',
      address: '',
      delivery_cycle_days: '',
      avg_unit_price: '',
      status: 'active',
    });
  };

  const openEditSupplier = (supplier: Supplier) => {
    if (!canEditSupplierManagement) {
      Toast.show({ type: 'error', text1: '无权限', text2: '仅超级管理员可编辑供应商信息' });
      return;
    }

    setIsAddingSupplier(false);
    setEditingSupplierId(supplier.id);
    setEditSupplierData({
      company_name: supplier.company_name,
      contact: supplier.contact || '',
      phone: supplier.phone || '',
      address: supplier.address || '',
      delivery_cycle_days: supplier.delivery_cycle_days == null ? '' : String(supplier.delivery_cycle_days),
      avg_unit_price: supplier.avg_unit_price == null ? '' : String(supplier.avg_unit_price),
      status: supplier.status,
    });
  };

  const handleSaveSupplier = async () => {
    if (!canEditSupplierManagement) {
      Toast.show({ type: 'error', text1: '无权限', text2: '仅超级管理员可编辑供应商信息' });
      return;
    }

    if (!editSupplierData.company_name.trim()) {
      Toast.show({ type: 'error', text1: '错误', text2: '请输入供应商名称' });
      return;
    }

    const deliveryCycleText = editSupplierData.delivery_cycle_days.trim();
    const avgUnitPriceText = editSupplierData.avg_unit_price.trim();

    const deliveryCycleValue = deliveryCycleText ? Number(deliveryCycleText) : null;
    const avgUnitPriceValue = avgUnitPriceText ? Number(avgUnitPriceText) : null;

    if (deliveryCycleText && (!Number.isInteger(deliveryCycleValue) || Number(deliveryCycleValue) < 0)) {
      Toast.show({ type: 'error', text1: '错误', text2: '交付周期需为大于等于 0 的整数' });
      return;
    }

    if (avgUnitPriceText && (!Number.isFinite(avgUnitPriceValue) || Number(avgUnitPriceValue) < 0)) {
      Toast.show({ type: 'error', text1: '错误', text2: '均价需为大于等于 0 的数字' });
      return;
    }

    if (isAddingSupplier) {
      const { error } = await addSupplier({
        company_name: editSupplierData.company_name.trim(),
        contact: editSupplierData.contact.trim() || null,
        phone: editSupplierData.phone.trim() || null,
        address: editSupplierData.address.trim() || null,
        delivery_cycle_days: deliveryCycleValue,
        avg_unit_price: avgUnitPriceValue,
        status: editSupplierData.status,
      });

      if (error) {
        Toast.show({ type: 'error', text1: '错误', text2: error.message });
        return;
      }

      Toast.show({ type: 'success', text1: '成功', text2: '供应商已添加' });
    } else if (editingSupplierId) {
      const { error } = await updateSupplier(editingSupplierId, {
        company_name: editSupplierData.company_name.trim(),
        contact: editSupplierData.contact.trim() || null,
        phone: editSupplierData.phone.trim() || null,
        address: editSupplierData.address.trim() || null,
        delivery_cycle_days: deliveryCycleValue,
        avg_unit_price: avgUnitPriceValue,
        status: editSupplierData.status,
      });

      if (error) {
        Toast.show({ type: 'error', text1: '错误', text2: error.message });
        return;
      }

      Toast.show({ type: 'success', text1: '成功', text2: '供应商已更新' });
    }

    setIsAddingSupplier(false);
    setEditingSupplierId(null);
  };

  const handleDeleteSupplier = (id: string, companyName: string) => {
    if (!canEditSupplierManagement) {
      Toast.show({ type: 'error', text1: '无权限', text2: '仅超级管理员可编辑供应商信息' });
      return;
    }

    Alert.alert('确认删除', `确定要删除供应商「${companyName}」吗？删除后不可恢复。`, [
      { text: '取消', style: 'cancel' },
      {
        text: '删除',
        style: 'destructive',
        onPress: async () => {
          const { error } = await deleteSupplier(id);
          if (error) {
            Toast.show({ type: 'error', text1: '错误', text2: error.message });
            return;
          }

          Toast.show({ type: 'success', text1: '成功', text2: '供应商已删除' });
        },
      },
    ]);
  };

  // --- Admin store management ---
  const openAddStore = () => {
    if (!isSuperAdmin) {
      Toast.show({ type: 'error', text1: '无权限', text2: '仅超级管理员可编辑店铺信息' });
      return;
    }
    setIsAddingStore(true);
    setEditingStoreId(null);
    setIsStoreEditorInvoiceExpanded(false);
    setEditStoreData({
      name: '',
      city_id: '',
      distributor_id: '',
      discount_rate: '1',
      contact: '',
      address: '',
      phone: '',
      settlement_day: '',
      cooperation_mode: 'consignment',
      contract_expiry_date: '',
      grade: '',
      contract_file_url: '',
      invoice_title: '',
      tax_id: '',
      bank_name: '',
      bank_account: '',
      invoice_phone: '',
      invoice_address: '',
      status: 'active',
    });
  };

  const openEditStore = (store: Store) => {
    if (!isSuperAdmin) {
      Toast.show({ type: 'error', text1: '无权限', text2: '仅超级管理员可编辑店铺信息' });
      return;
    }
    setIsAddingStore(false);
    setEditingStoreId(store.id);
    setIsStoreEditorInvoiceExpanded(false);
    setEditStoreData({
      name: store.name,
      city_id: store.city_id,
      distributor_id: store.distributor_id || '',
      discount_rate: String(store.discount_rate || 1),
      contact: store.contact || '',
      address: store.address || '',
      phone: store.phone || '',
      settlement_day: store.settlement_day == null ? '' : String(store.settlement_day),
      cooperation_mode: store.cooperation_mode || 'consignment',
      contract_expiry_date: store.contract_expiry_date || '',
      grade: store.grade || '',
      contract_file_url: store.contract_file_url || '',
      invoice_title: store.invoice_title || '',
      tax_id: store.tax_id || '',
      bank_name: store.bank_name || '',
      bank_account: store.bank_account || '',
      invoice_phone: store.invoice_phone || '',
      invoice_address: store.invoice_address || '',
      status: store.status,
    });
  };

  const handleSaveStore = async () => {
    if (!isSuperAdmin) {
      Toast.show({ type: 'error', text1: '无权限', text2: '仅超级管理员可编辑店铺信息' });
      return;
    }
    if (!editStoreData.name.trim()) {
      Toast.show({ type: 'error', text1: '错误', text2: '请输入店铺名称' });
      return;
    }
    if (!editStoreData.city_id) {
      Toast.show({ type: 'error', text1: '错误', text2: '请选择归属城市' });
      return;
    }
    const discountRate = Number(editStoreData.discount_rate);
    if (isNaN(discountRate) || discountRate <= 0) {
      Toast.show({ type: 'error', text1: '错误', text2: '请输入有效的折扣率' });
      return;
    }

    const settlementDayText = editStoreData.settlement_day.trim();
    const settlementDayValue = settlementDayText ? Number(settlementDayText) : null;
    if (settlementDayText && (settlementDayValue === null || !Number.isInteger(settlementDayValue) || settlementDayValue < 1 || settlementDayValue > 31)) {
      Toast.show({ type: 'error', text1: '错误', text2: '每月结算日需在 1-31 之间' });
      return;
    }

    if (isAddingStore) {
      const { error } = await addStore({
        name: editStoreData.name,
        city_id: editStoreData.city_id,
        distributor_id: editStoreData.distributor_id || null,
        discount_rate: discountRate,
        contact: editStoreData.contact,
        address: editStoreData.address,
        phone: editStoreData.phone,
        settlement_day: settlementDayValue,
        cooperation_mode: editStoreData.cooperation_mode,
        contract_expiry_date: editStoreData.contract_expiry_date || null,
        grade: (editStoreData.grade || null) as Store['grade'] | null,
        contract_file_url: editStoreData.contract_file_url || null,
        invoice_title: editStoreData.invoice_title.trim() || null,
        tax_id: editStoreData.tax_id.trim() || null,
        bank_name: editStoreData.bank_name.trim() || null,
        bank_account: editStoreData.bank_account.trim() || null,
        invoice_phone: editStoreData.invoice_phone.trim() || null,
        invoice_address: editStoreData.invoice_address.trim() || null,
      });
      if (error) {
        Toast.show({ type: 'error', text1: '错误', text2: error.message });
        return;
      }
      Toast.show({ type: 'success', text1: '成功', text2: '店铺已添加' });
    } else if (editingStoreId) {
      const { error } = await updateStore(editingStoreId, {
        name: editStoreData.name,
        city_id: editStoreData.city_id,
        distributor_id: editStoreData.distributor_id || null,
        discount_rate: discountRate,
        contact: editStoreData.contact,
        address: editStoreData.address,
        phone: editStoreData.phone,
        settlement_day: settlementDayValue,
        cooperation_mode: editStoreData.cooperation_mode,
        contract_expiry_date: editStoreData.contract_expiry_date || null,
        grade: (editStoreData.grade || null) as Store['grade'] | null,
        contract_file_url: editStoreData.contract_file_url || null,
        invoice_title: editStoreData.invoice_title.trim() || null,
        tax_id: editStoreData.tax_id.trim() || null,
        bank_name: editStoreData.bank_name.trim() || null,
        bank_account: editStoreData.bank_account.trim() || null,
        invoice_phone: editStoreData.invoice_phone.trim() || null,
        invoice_address: editStoreData.invoice_address.trim() || null,
        status: editStoreData.status,
      });
      if (error) {
        Toast.show({ type: 'error', text1: '错误', text2: error.message });
        return;
      }
      Toast.show({ type: 'success', text1: '成功', text2: '店铺已更新' });
    }

    setIsAddingStore(false);
    setEditingStoreId(null);
  };

  const handleDeactivateStore = (id: string, name: string) => {
    if (!isSuperAdmin) {
      Toast.show({ type: 'error', text1: '无权限', text2: '仅超级管理员可编辑店铺信息' });
      return;
    }
    Alert.alert('确认停用', `确定要停用店铺「${name}」吗？`, [
      { text: '取消', style: 'cancel' },
      {
        text: '停用',
        style: 'destructive',
        onPress: async () => {
          const { error } = await deactivateStore(id);
          if (error) Toast.show({ type: 'error', text1: '错误', text2: error.message });
          else Toast.show({ type: 'success', text1: '成功', text2: '店铺已停用' });
        },
      },
    ]);
  };

  const handleActivateStore = (id: string, name: string) => {
    if (!isSuperAdmin) {
      Toast.show({ type: 'error', text1: '无权限', text2: '仅超级管理员可编辑店铺信息' });
      return;
    }
    Alert.alert('确认启用', `确定要启用店铺「${name}」吗？`, [
      { text: '取消', style: 'cancel' },
      {
        text: '启用',
        onPress: async () => {
          const { error } = await updateStore(id, { status: 'active' });
          if (error) Toast.show({ type: 'error', text1: '错误', text2: error.message });
          else Toast.show({ type: 'success', text1: '成功', text2: '店铺已启用' });
        },
      },
    ]);
  };

  const handleDeleteStore = (id: string, name: string) => {
    if (!isSuperAdmin) {
      Toast.show({ type: 'error', text1: '无权限', text2: '仅超级管理员可编辑店铺信息' });
      return;
    }
    Alert.alert('确认删除', `确定要删除店铺「${name}」吗？删除后不可恢复。`, [
      { text: '取消', style: 'cancel' },
      {
        text: '删除',
        style: 'destructive',
        onPress: async () => {
          const { error } = await deleteStore(id);
          if (error) Toast.show({ type: 'error', text1: '错误', text2: error.message });
          else Toast.show({ type: 'success', text1: '成功', text2: '店铺已删除' });
        },
      },
    ]);
  };

  // --- Notifications: accept order ---
  const handleAcceptOrder = async (orderId: string, notificationId: string) => {
    const { error } = await acceptOrder(orderId);
    if (error) {
      Toast.show({ type: 'error', text1: '接单失败', text2: error.message });
    } else {
      await markNotificationRead(notificationId);
      Toast.show({ type: 'success', text1: '成功', text2: '已接单' });
    }
  };

  const handleAddCity = async () => {
    if (!newCityName.trim()) {
      Toast.show({ type: 'error', text1: '错误', text2: '请输入城市名称' });
      return;
    }
    const { error } = await addCity(newCityName.trim());
    if (error) {
      Toast.show({ type: 'error', text1: '错误', text2: error.message });
    } else {
      setNewCityName('');
    }
  };

  const handleDeleteCity = (id: string, name: string) => {
    Alert.alert('确认删除', `删除城市「${name}」将同时删除该城市下所有商品，确定吗？`, [
      { text: '取消', style: 'cancel' },
      {
        text: '删除',
        style: 'destructive',
        onPress: async () => {
          const { error } = await deleteCity(id);
          if (error) Toast.show({ type: 'error', text1: '错误', text2: error.message });
        },
      },
    ]);
  };

  const handleSignOut = () => {
    setLogoutConfirmVisible(true);
  };

  const handleCheckUpdate = async () => {
    if (__DEV__) {
      Toast.show({ type: 'info', text1: '开发模式', text2: '开发模式下不执行 OTA 更新检查' });
      return;
    }

    setCheckingUpdate(true);
    try {
      const binaryUpdateInfo = await resolveBinaryUpdateInfo();
      const needBinaryUpdate = binaryUpdateInfo
        ? compareVersion(appVersion, binaryUpdateInfo.latestVersion) < 0
        : false;

      if (needBinaryUpdate && binaryUpdateInfo) {
        setBinaryUpdateUrl(binaryUpdateInfo.androidApkUrl);
        setBinaryUpdateVersion(binaryUpdateInfo.latestVersion);
        setBinaryUpdateConfirmVisible(true);
        return;
      }

      const update = await Updates.checkForUpdateAsync();
      if (!update.isAvailable) {
        Toast.show({ type: 'success', text1: '已是最新版本', text2: '当前无需更新' });
        return;
      }

      await Updates.fetchUpdateAsync();
      setUpdateConfirmVisible(true);
    } catch (error) {
      const message = error instanceof Error ? error.message : '检查更新失败';
      Toast.show({ type: 'error', text1: '更新失败', text2: message });
    } finally {
      setCheckingUpdate(false);
    }
  };

  const getRoleName = (role: string) => {
    switch (role) {
      case 'admin': return '管理员';
      case 'super_admin': return '超级管理员';
      case 'distributor': return '分销商';
      case 'inventory_manager': return '库存管理员';
      case 'finance': return '财务';
      default: return role;
    }
  };

  const handleSelectAvatar = async (avatarUrl: string) => {
    if (!user) return;

    const previousAvatar = user.avatar_url;
    setAvatarModalVisible(false);
    setUser({ ...user, avatar_url: avatarUrl });

    const { error } = await updateOwnAvatar(avatarUrl);
    if (error) {
      setUser({ ...user, avatar_url: previousAvatar });
      Toast.show({ type: 'error', text1: '错误', text2: error.message });
      return;
    }
  };

  const parseEmojiAvatar = (value?: string | null): { emoji: string; bgColor: string } | null => {
    if (!value || !value.startsWith('emoji|')) return null;
    const parts = value.split('|');
    if (parts.length < 3) return null;
    const emoji = parts[1];
    const bgColor = parts[2];
    return { emoji, bgColor };
  };

  const selectedEmojiAvatar = parseEmojiAvatar(user?.avatar_url);
  const avatarRingGradientColors: readonly [string, string] = isDarkMode
    ? ['rgba(255,255,255,0.55)', 'rgba(255,255,255,0.18)']
    : ['rgba(255,255,255,0.44)', 'rgba(255,255,255,0.12)'];
  const avatarHaloColor = isDarkMode ? 'rgba(255,255,255,0.22)' : 'rgba(255,255,255,0.14)';
  const avatarActionGradientColors: readonly [string, string] = isDarkMode
    ? ['rgba(255,255,255,0.34)', 'rgba(255,255,255,0.14)']
    : ['rgba(255,255,255,0.28)', 'rgba(255,255,255,0.10)'];
  const avatarActionBorderColor = isDarkMode ? 'rgba(255,255,255,0.35)' : 'rgba(255,255,255,0.22)';

  const menuItems = [
    { IconComponent: User, label: '个人信息', onPress: () => setProfileModalVisible(true) },
    ...(isAdmin
      ? [
          { IconComponent: MapPin, label: '省份管理', onPress: () => setProvinceModalVisible(true) },
          { IconComponent: MapPin, label: '城市管理', onPress: () => setCityModalVisible(true) },
          ...(canManageProductSeries
            ? [{ IconComponent: PackagePlus, label: '商品系列管理', onPress: () => setSeriesModalVisible(true) }]
            : []),
          { IconComponent: Users, label: '分销商管理', onPress: () => setDistributorModalVisible(true) },
          { IconComponent: StoreIcon, label: '店铺管理', onPress: () => setStoreModalVisible(true) },
        ]
      : []),
    ...(canViewSupplierManagement
      ? [
          { IconComponent: Users, label: '供应商管理', onPress: () => setSupplierModalVisible(true) },
        ]
      : []),
    ...(canViewFinanceManagement
      ? [
          { IconComponent: PackagePlus, label: financeEntryLabel, onPress: handleOpenFinanceOverview },
        ]
      : []),
    {
      IconComponent: WifiOff,
      label: `离线模式: ${isOfflineMode ? '已开启' : '已关闭'}`,
      onPress: () => setOfflineMode(!isOfflineMode),
    },
    {
      IconComponent: Bell,
      label: `通知${unreadCount > 0 ? ` (${unreadCount})` : ''}`,
      onPress: () => { fetchNotifications(); setNotificationModalVisible(true); markAllNotificationsRead(); },
    },
    {
      IconComponent: PackagePlus,
      label: checkingUpdate ? '检查更新中...' : '检查更新',
      onPress: handleCheckUpdate,
    },
    {
      IconComponent: isDarkMode ? Sun : Moon,
      label: '深色模式',
      isSwitch: true,
      value: isDarkMode,
      onValueChange: (val: boolean) => setDarkMode(val),
    },
    { IconComponent: Info, label: '关于', onPress: () => setAboutModalVisible(true) },
  ];

  const renderNotification = ({ item }: { item: Notification }) => {
    const isNewOrder = item.type === 'new_order';
    const isInventoryAlert = item.type === 'inventory_alert';
    const isSlowMovingAlert = item.type === 'inventory_slow_moving_alert';
    const isOrderAccepted = item.type === 'order_accepted';
    const isRefundNotification = item.type === 'refund_requested'
      || item.type === 'refund_approved'
      || item.type === 'refund_rejected'
      || item.type === 'refund_completed'
      || item.type === 'refund_failed';
    const orderObj = isNewOrder ? orders.find((o) => o.id === item.order_id) : null;
    const alreadyAccepted = orderObj?.status === 'accepted';

    return (
      <View style={[styles.notifRow, !item.is_read && { backgroundColor: isDarkMode ? theme.blueBg : theme.pinkBg }, { borderBottomColor: theme.divider }]}>
        <View style={[styles.notifIcon, { backgroundColor: theme.surfaceSecondary }]}> 
          {isNewOrder ? (
            <PackagePlus size={18} color={theme.pink} />
          ) : isInventoryAlert || isSlowMovingAlert ? (
            <Bell size={18} color={theme.warning} />
          ) : isRefundNotification ? (
            <Bell size={18} color={theme.warning} />
          ) : (
            <CheckCircle2 size={18} color={theme.success} />
          )}
        </View>
        <View style={styles.notifContent}>
          <Text style={[styles.notifMessage, { color: theme.textPrimary }]}>{item.message}</Text>
          <Text style={[styles.notifTime, { color: theme.textTertiary }]}>{new Date(item.created_at).toLocaleString('zh-CN')}</Text>
        </View>
        {isNewOrder && isAdmin && !alreadyAccepted && item.order_id && (
          <TouchableOpacity
            style={[styles.acceptBtn, { backgroundColor: theme.success }]}
            onPress={() => handleAcceptOrder(item.order_id!, item.id)}
          >
            <Text style={styles.acceptBtnText}>接单</Text>
          </TouchableOpacity>
        )}
        {isNewOrder && alreadyAccepted && (
          <View style={[styles.acceptedBadge, { backgroundColor: theme.successBg }]}> 
            <Text style={[styles.acceptedBadgeText, { color: theme.success }]}>已接单</Text>
          </View>
        )}
        {isOrderAccepted && (
          <View style={[styles.acceptedBadge, { backgroundColor: theme.successBg }]}> 
            <Text style={[styles.acceptedBadgeText, { color: theme.success }]}>已接单</Text>
          </View>
        )}
        {isInventoryAlert && (
          <View style={[styles.acceptedBadge, { backgroundColor: theme.warningBg }]}> 
            <Text style={[styles.acceptedBadgeText, { color: theme.warning }]}>库存告警</Text>
          </View>
        )}
        {isSlowMovingAlert && (
          <View style={[styles.acceptedBadge, { backgroundColor: theme.warningBg }]}> 
            <Text style={[styles.acceptedBadgeText, { color: theme.warning }]}>滞销告警</Text>
          </View>
        )}
        {isRefundNotification && (
          <View style={[styles.acceptedBadge, { backgroundColor: theme.warningBg }]}> 
            <Text style={[styles.acceptedBadgeText, { color: theme.warning }]}>退款通知</Text>
          </View>
        )}
      </View>
    );
  };

  return (
    <ScrollView style={[styles.container, { backgroundColor: theme.background }]} contentContainerStyle={styles.scrollContent}>
      <LinearGradient
        colors={[theme.pink, theme.gradientMid, theme.blue]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={styles.profileCardGradient}
      >
        <LinearGradient
          colors={avatarRingGradientColors}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.avatarRing}
        >
          <View style={[styles.avatarHalo, { backgroundColor: avatarHaloColor }]} />
          <View style={[styles.avatar, selectedEmojiAvatar && { backgroundColor: selectedEmojiAvatar.bgColor }]}> 
            {selectedEmojiAvatar ? (
              <Text style={styles.avatarEmojiText}>{selectedEmojiAvatar.emoji}</Text>
            ) : user?.avatar_url ? (
              <Image source={{ uri: user.avatar_url }} style={styles.avatarImage} />
            ) : (
              <Text style={styles.avatarText}>
                {user?.full_name?.charAt(0) || user?.email?.charAt(0) || 'U'}
              </Text>
            )}
          </View>
        </LinearGradient>
        <TouchableOpacity style={[styles.avatarActionButton, { borderColor: avatarActionBorderColor }]} onPress={() => setAvatarModalVisible(true)}>
          <LinearGradient
            colors={avatarActionGradientColors}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0 }}
            style={styles.avatarActionGradient}
          >
            <Text style={styles.avatarActionText}>更换头像</Text>
          </LinearGradient>
        </TouchableOpacity>
        <Text style={styles.emailWhite}>{user?.email}</Text>
        {user?.city_name ? <Text style={styles.subInfoWhite}>{user.city_name}{user?.store_name ? ` · ${user.store_name}` : ''}</Text> : null}
        <View style={styles.roleBadgeWhite}>
          <Text style={styles.roleTextWhite}>{getRoleName(user?.role || '')}</Text>
        </View>
      </LinearGradient>

      <View style={[styles.menu, { backgroundColor: theme.surface }]}>
        {menuItems.map((item) => (
          <TouchableOpacity
            key={item.label}
            style={[
              styles.menuItem, 
              item === menuItems[menuItems.length - 1] && styles.menuItemLast,
              { borderBottomColor: theme.divider }
            ]}
            onPress={item.onPress}
            activeOpacity={item.isSwitch ? 1 : 0.7}
            disabled={item.isSwitch}
          >
            <View style={styles.menuIcon}>
              <item.IconComponent size={22} color={theme.blue} strokeWidth={2} />
            </View>
            <Text style={[styles.menuText, { color: theme.textPrimary }]}>{item.label}</Text>
            {item.isSwitch ? (
              <Switch
                value={item.value}
                onValueChange={item.onValueChange}
                trackColor={{ false: theme.border, true: theme.pinkLight }}
                thumbColor={item.value ? theme.pink : theme.textTertiary}
              />
            ) : (
              <>
                {item.IconComponent === Bell && unreadCount > 0 && (
                  <View style={styles.badge}>
                    <Text style={styles.badgeText}>{unreadCount > 99 ? '99+' : unreadCount}</Text>
                  </View>
                )}
                <Text style={[styles.menuArrow, { color: theme.textTertiary }]}>›</Text>
              </>
            )}
          </TouchableOpacity>
        ))}
      </View>

      <TouchableOpacity style={[styles.logoutButton, { backgroundColor: theme.surface }]} onPress={handleSignOut} activeOpacity={0.85}>
        <Text style={styles.logoutText}>退出登录</Text>
      </TouchableOpacity>

      <Text style={[styles.version, { color: theme.textTertiary }]}>版本 {appVersion}</Text>

      {/* About Modal */}
      <Modal visible={aboutModalVisible} animationType="fade" transparent>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, { backgroundColor: theme.surface }]}>
            <View style={styles.modalHeader}>
              <Text style={[styles.modalTitle, { color: theme.textPrimary }]}>关于</Text>
              <TouchableOpacity onPress={() => setAboutModalVisible(false)}>
                <Text style={styles.closeButton}>关闭</Text>
              </TouchableOpacity>
            </View>
            <View style={styles.aboutContent}>
              <LinearGradient
                colors={[theme.pink, theme.blue]}
                style={styles.logoGradient}
              >
                <Info size={40} color="#fff" />
              </LinearGradient>
              <Text style={[styles.aboutAppTitle, { color: theme.textPrimary }]}>云窗文创 · 供销管理系统</Text>
              <Text style={[styles.aboutVersion, { color: theme.textSecondary }]}>Version {appVersion}</Text>
              <View style={[styles.devBox, { backgroundColor: theme.surfaceSecondary }]}>
                <Text style={[styles.devText, { color: theme.textPrimary }]}>
                  开发者：辣椒与葱花&&土豆和地瓜
                </Text>
              </View>
              <Text style={[styles.aboutCopyright, { color: theme.textTertiary }]}>
                © 2026 云窗文创 版权所有
              </Text>
            </View>
          </View>
        </View>
      </Modal>

      {/* Finance Transactions Modal */}
      <Modal visible={financeModalVisible} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, styles.managementModalContent, { backgroundColor: theme.surface }]}> 
            <View style={styles.modalHeader}>
              <Text style={[styles.modalTitle, { color: theme.textPrimary }]}>余额总览</Text>
              <TouchableOpacity onPress={() => { setFinanceModalVisible(false); resetTransactionEditor(); resetBalanceEditor(); }}>
                <Text style={styles.closeButton}>关闭</Text>
              </TouchableOpacity>
            </View>

            {!canEditFinanceManagement && (
              <View style={[styles.editorBox, { backgroundColor: theme.surfaceSecondary, marginBottom: 10 }]}> 
                <Text style={[styles.editorHint, { color: theme.textSecondary }]}>当前为只读模式：仅财务可新增/编辑/删除流水，管理员与超级管理员仅可查看。</Text>
              </View>
            )}

            {!!financeError && (
              <View style={[styles.editorBox, { backgroundColor: theme.surfaceSecondary, marginBottom: 10 }]}> 
                <Text style={[styles.editorHint, { color: theme.danger }]}>{financeError}</Text>
              </View>
            )}

            <View style={[styles.editorBox, styles.financeOverviewCard, { backgroundColor: theme.surfaceSecondary }]}> 
              <View style={styles.financeOverviewHeader}>
                <View style={styles.financeOverviewTitleWrap}>
                  <Text style={[styles.editorTitle, { color: theme.textPrimary }]}>当前余额</Text>
                  <Text style={[styles.financeOverviewMeta, { color: theme.textSecondary }]}>更新时间：{formatDateTime(balance?.last_updated_at)}</Text>
                </View>
                {!canEditFinanceManagement && (
                  <View style={[styles.transactionTypeBadge, { backgroundColor: theme.surface }]}> 
                    <Text style={[styles.transactionTypeBadgeText, { color: theme.textSecondary }]}>只读</Text>
                  </View>
                )}
              </View>
              <Text style={[styles.financeOverviewAmount, { color: theme.textPrimary }]}> 
                {financeLoading && !balance ? '加载中...' : balance ? `¥${formatCurrency(balance.balance)}` : '暂无记录'}
              </Text>
              <Text style={[styles.financeOverviewHint, { color: theme.textTertiary }]}> 
                {canEditFinanceManagement
                  ? '请录入当前现金余额，管理员与超级管理员可查看最新总览。'
                  : '当前余额仅供查看，如需调整请联系财务角色更新。'}
              </Text>

              {isEditingBalance ? (
                <>
                  <TextInput
                    style={[styles.financeBalanceInput, { backgroundColor: theme.surface, color: theme.textPrimary }]}
                    placeholder="输入当前余额"
                    value={balanceDraft}
                    editable={canEditFinanceManagement}
                    onChangeText={setBalanceDraft}
                    placeholderTextColor={theme.textTertiary}
                    keyboardType="numeric"
                  />
                  <View style={styles.editActions}>
                    <TouchableOpacity style={[styles.smallBtn, { backgroundColor: theme.surface }]} onPress={resetBalanceEditor}>
                      <Text style={[styles.smallBtnText, { color: theme.textSecondary }]}>取消</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={[styles.smallBtn, styles.smallBtnPrimary, { backgroundColor: theme.pink }]} onPress={handleSaveBalance}>
                      <Text style={styles.smallBtnPrimaryText}>保存余额</Text>
                    </TouchableOpacity>
                  </View>
                </>
              ) : canEditFinanceManagement ? (
                <View style={styles.editActions}>
                  <TouchableOpacity style={[styles.smallBtn, styles.smallBtnPrimary, { backgroundColor: theme.pink }]} onPress={openBalanceEditor}>
                    <Text style={styles.smallBtnPrimaryText}>{balance ? '更新余额' : '录入余额'}</Text>
                  </TouchableOpacity>
                </View>
              ) : null}
            </View>

            <Text style={[styles.editorTitle, styles.financeSectionTitle, { color: theme.textPrimary }]}>流水记录</Text>

            {!isAddingTransaction && !editingTransactionId && canEditFinanceManagement && (
              <TouchableOpacity style={styles.addCityRow} onPress={openAddTransaction} activeOpacity={0.85}>
                <LinearGradient
                  colors={[theme.pink, theme.blue]}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 0 }}
                  style={[styles.addCityButton, { width: '100%' }]}
                >
                  <Text style={styles.addCityButtonText}>添加流水</Text>
                </LinearGradient>
              </TouchableOpacity>
            )}

            {(isAddingTransaction || editingTransactionId) ? (
              <ScrollView
                style={styles.financeEditorScroll}
                contentContainerStyle={styles.financeEditorScrollContent}
                keyboardShouldPersistTaps="handled"
                showsVerticalScrollIndicator={false}
              >
                <View style={[styles.editorBox, { backgroundColor: theme.surfaceSecondary }]}> 
                  <Text style={[styles.editorTitle, { color: theme.textPrimary }]}>{isAddingTransaction ? '添加流水' : '编辑流水'}</Text>

                  <Text style={[styles.editorHint, { color: theme.textTertiary }]}>收支类型</Text>
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.cityChipsWrap}>
                    {([
                      { value: 'income', label: '收入' },
                      { value: 'expense', label: '支出' },
                    ] as const).map((item) => (
                      <TouchableOpacity
                        key={item.value}
                        style={[
                          styles.cityChip,
                          { backgroundColor: theme.surface },
                          editTransactionData.transaction_type === item.value && { backgroundColor: theme.pink },
                        ]}
                        disabled={!canEditFinanceManagement}
                        onPress={() => setEditTransactionData((current) => ({
                          ...current,
                          transaction_type: item.value,
                          category: '',
                        }))}
                      >
                        <Text
                          style={[
                            styles.cityChipText,
                            { color: theme.textSecondary },
                            editTransactionData.transaction_type === item.value && { color: '#fff', fontWeight: '600' },
                          ]}
                        >
                          {item.label}
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </ScrollView>

                  <Text style={[styles.editorHint, { color: theme.textTertiary }]}>财务分类</Text>
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.cityChipsWrap}>
                    {filteredFinanceCategories.map((item) => (
                      <TouchableOpacity
                        key={item.id}
                        style={[
                          styles.cityChip,
                          { backgroundColor: theme.surface },
                          editTransactionData.category === item.name && { backgroundColor: theme.pink },
                        ]}
                        disabled={!canEditFinanceManagement}
                        onPress={() => setEditTransactionData({ ...editTransactionData, category: item.name })}
                      >
                        <Text
                          style={[
                            styles.cityChipText,
                            { color: theme.textSecondary },
                            editTransactionData.category === item.name && { color: '#fff', fontWeight: '600' },
                          ]}
                        >
                          {item.name}
                        </Text>
                      </TouchableOpacity>
                    ))}
                    {filteredFinanceCategories.length === 0 && (
                      <Text style={[styles.editorHint, { color: theme.textSecondary }]}>暂无可用分类</Text>
                    )}
                  </ScrollView>

                  <TextInput
                    style={[styles.cityInput, { backgroundColor: theme.surface, color: theme.textPrimary, marginBottom: 10 }]}
                    placeholder="金额"
                    value={editTransactionData.amount}
                    editable={canEditFinanceManagement}
                    onChangeText={(text) => setEditTransactionData({ ...editTransactionData, amount: text })}
                    placeholderTextColor={theme.textTertiary}
                    keyboardType="numeric"
                  />

                  <TextInput
                    style={[styles.cityInput, { backgroundColor: theme.surface, color: theme.textPrimary, marginBottom: 10 }]}
                    placeholder="交易日期 (如 2026-06-26)"
                    value={editTransactionData.transaction_date}
                    editable={canEditFinanceManagement}
                    onChangeText={(text) => setEditTransactionData({ ...editTransactionData, transaction_date: text })}
                    placeholderTextColor={theme.textTertiary}
                  />

                  <Text style={[styles.editorHint, { color: theme.textTertiary }]}>关联店铺（选填）</Text>
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.cityChipsWrap}>
                    <TouchableOpacity
                      style={[
                        styles.cityChip,
                        { backgroundColor: theme.surface },
                        !editTransactionData.store_id && { backgroundColor: theme.pink },
                      ]}
                      disabled={!canEditFinanceManagement}
                      onPress={() => setEditTransactionData({ ...editTransactionData, store_id: '' })}
                    >
                      <Text style={[
                        styles.cityChipText,
                        { color: theme.textSecondary },
                        !editTransactionData.store_id && { color: '#fff', fontWeight: '600' },
                      ]}>不关联</Text>
                    </TouchableOpacity>
                    {stores.map((item) => (
                      <TouchableOpacity
                        key={item.id}
                        style={[
                          styles.cityChip,
                          { backgroundColor: theme.surface },
                          editTransactionData.store_id === item.id && { backgroundColor: theme.pink },
                        ]}
                        disabled={!canEditFinanceManagement}
                        onPress={() => setEditTransactionData({ ...editTransactionData, store_id: item.id })}
                      >
                        <Text style={[
                          styles.cityChipText,
                          { color: theme.textSecondary },
                          editTransactionData.store_id === item.id && { color: '#fff', fontWeight: '600' },
                        ]}>{item.name}</Text>
                      </TouchableOpacity>
                    ))}
                  </ScrollView>

                  <Text style={[styles.editorHint, { color: theme.textTertiary }]}>关联供应商（选填）</Text>
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.cityChipsWrap}>
                    <TouchableOpacity
                      style={[
                        styles.cityChip,
                        { backgroundColor: theme.surface },
                        !editTransactionData.supplier_id && { backgroundColor: theme.pink },
                      ]}
                      disabled={!canEditFinanceManagement}
                      onPress={() => setEditTransactionData({ ...editTransactionData, supplier_id: '' })}
                    >
                      <Text style={[
                        styles.cityChipText,
                        { color: theme.textSecondary },
                        !editTransactionData.supplier_id && { color: '#fff', fontWeight: '600' },
                      ]}>不关联</Text>
                    </TouchableOpacity>
                    {suppliers.map((item) => (
                      <TouchableOpacity
                        key={item.id}
                        style={[
                          styles.cityChip,
                          { backgroundColor: theme.surface },
                          editTransactionData.supplier_id === item.id && { backgroundColor: theme.pink },
                        ]}
                        disabled={!canEditFinanceManagement}
                        onPress={() => setEditTransactionData({ ...editTransactionData, supplier_id: item.id })}
                      >
                        <Text style={[
                          styles.cityChipText,
                          { color: theme.textSecondary },
                          editTransactionData.supplier_id === item.id && { color: '#fff', fontWeight: '600' },
                        ]}>{item.company_name}</Text>
                      </TouchableOpacity>
                    ))}
                  </ScrollView>

                  <TextInput
                    style={[styles.cityInput, { backgroundColor: theme.surface, color: theme.textPrimary, marginBottom: 10 }]}
                    placeholder="渠道名称 (选填)"
                    value={editTransactionData.channel_name}
                    editable={canEditFinanceManagement}
                    onChangeText={(text) => setEditTransactionData({ ...editTransactionData, channel_name: text })}
                    placeholderTextColor={theme.textTertiary}
                  />

                  <TextInput
                    style={[styles.financeMultilineInput, { backgroundColor: theme.surface, color: theme.textPrimary }]}
                    placeholder="备注说明 (选填)"
                    value={editTransactionData.description}
                    editable={canEditFinanceManagement}
                    onChangeText={(text) => setEditTransactionData({ ...editTransactionData, description: text })}
                    placeholderTextColor={theme.textTertiary}
                    multiline
                    textAlignVertical="top"
                  />

                  <View style={[styles.infoRow, { borderBottomWidth: 0, paddingVertical: 0, marginTop: 10 }]}> 
                    <Text style={[styles.infoLabel, { color: theme.textSecondary }]}>周期性流水</Text>
                    <Switch
                      value={editTransactionData.is_recurring}
                      disabled={!canEditFinanceManagement}
                      onValueChange={(value) => setEditTransactionData({ ...editTransactionData, is_recurring: value })}
                      trackColor={{ false: theme.border, true: theme.pinkLight }}
                      thumbColor={editTransactionData.is_recurring ? theme.pink : theme.textTertiary}
                    />
                  </View>

                  {editTransactionData.is_recurring ? (
                    <>
                      <Text style={[styles.editorHint, { color: theme.textTertiary }]}>周期频次</Text>
                      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.cityChipsWrap}>
                        {recurringFrequencyOptions.map((item) => (
                          <TouchableOpacity
                            key={item.value}
                            style={[
                              styles.cityChip,
                              { backgroundColor: theme.surface },
                              editTransactionData.recurring_frequency === item.value && { backgroundColor: theme.pink },
                            ]}
                            disabled={!canEditFinanceManagement}
                            onPress={() => setEditTransactionData({ ...editTransactionData, recurring_frequency: item.value })}
                          >
                            <Text
                              style={[
                                styles.cityChipText,
                                { color: theme.textSecondary },
                                editTransactionData.recurring_frequency === item.value && { color: '#fff', fontWeight: '600' },
                              ]}
                            >
                              {item.label}
                            </Text>
                          </TouchableOpacity>
                        ))}
                      </ScrollView>
                    </>
                  ) : null}

                  <View style={styles.editActions}>
                    <TouchableOpacity style={[styles.smallBtn, { backgroundColor: theme.surface }]} onPress={resetTransactionEditor}>
                      <Text style={[styles.smallBtnText, { color: theme.textSecondary }]}>取消</Text>
                    </TouchableOpacity>
                    {canEditFinanceManagement && (
                      <TouchableOpacity style={[styles.smallBtn, styles.smallBtnPrimary, { backgroundColor: theme.pink }]} onPress={handleSaveTransaction}>
                        <Text style={styles.smallBtnPrimaryText}>保存</Text>
                      </TouchableOpacity>
                    )}
                  </View>
                </View>
              </ScrollView>
            ) : null}

            {!isAddingTransaction && !editingTransactionId && (
              <FlatList
                data={transactions}
                keyExtractor={(item) => item.id}
                renderItem={({ item }) => (
                  <TouchableOpacity
                    style={[styles.cityRow, styles.transactionRow, { borderBottomColor: theme.divider }]}
                    onPress={canEditFinanceManagement ? () => openEditTransaction(item) : undefined}
                    disabled={!canEditFinanceManagement}
                  >
                    <View style={{ flex: 1 }}>
                      <View style={styles.transactionHeaderRow}>
                        <Text style={[styles.cityName, { color: theme.textPrimary }]}>{item.category}</Text>
                        <View style={[
                          styles.transactionTypeBadge,
                          { backgroundColor: item.transaction_type === 'income' ? theme.successBg : theme.warningBg },
                        ]}>
                          <Text style={[
                            styles.transactionTypeBadgeText,
                            { color: item.transaction_type === 'income' ? theme.success : theme.warning },
                          ]}>{item.transaction_type === 'income' ? '收入' : '支出'}</Text>
                        </View>
                      </View>
                      <Text style={[styles.transactionAmount, { color: item.transaction_type === 'income' ? theme.success : theme.warning }]}>
                        {item.transaction_type === 'income' ? '+' : '-'}¥{Number(item.amount).toFixed(2)}
                      </Text>
                      <Text style={[styles.distributorSubText, { color: theme.textSecondary }]}>日期：{item.transaction_date}</Text>
                      <Text style={[styles.distributorSubText, { color: theme.textSecondary }]}>店铺：{item.store_id ? (transactionStoreMap.get(item.store_id) || item.store_id) : '-'}</Text>
                      <Text style={[styles.distributorSubText, { color: theme.textSecondary }]}>供应商：{item.supplier_id ? (transactionSupplierMap.get(item.supplier_id) || item.supplier_id) : '-'}</Text>
                      <Text style={[styles.distributorSubText, { color: theme.textSecondary }]}>渠道：{item.channel_name || '-'}</Text>
                      {item.is_recurring ? (
                        <Text style={[styles.distributorSubText, { color: theme.textSecondary }]}>周期频次：{recurringFrequencyLabelMap[item.recurring_frequency || 'monthly']}</Text>
                      ) : null}
                      {item.description ? <Text style={[styles.distributorSubText, { color: theme.textSecondary }]} numberOfLines={2}>备注：{item.description}</Text> : null}
                    </View>
                    <View style={styles.cityActionsRow}>
                      {canEditFinanceManagement ? (
                        <>
                          <TouchableOpacity onPress={() => openEditTransaction(item)} style={{ marginRight: 15 }}>
                            <Text style={styles.closeButton}>编辑</Text>
                          </TouchableOpacity>
                          <TouchableOpacity onPress={() => handleDeleteTransaction(item)}>
                            <Text style={styles.deleteCityText}>删除</Text>
                          </TouchableOpacity>
                        </>
                      ) : (
                        <Text style={[styles.distributorSubText, { color: theme.textTertiary }]}>{item.is_recurring ? '周期性' : '单次'}</Text>
                      )}
                    </View>
                  </TouchableOpacity>
                )}
                ListEmptyComponent={<Text style={[styles.emptyCityText, { color: theme.textTertiary }]}>{financeLoading ? '加载中...' : '暂无财务流水'}</Text>}
                style={styles.cityList}
                contentContainerStyle={transactions.length === 0 ? styles.cityListEmptyContent : styles.cityListContent}
              />
            )}
          </View>
        </View>
      </Modal>

      {/* Product Series Management Modal */}
      <Modal visible={seriesModalVisible} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, styles.managementModalContent, { backgroundColor: theme.surface }]}> 
            <View style={styles.modalHeader}>
              <Text style={[styles.modalTitle, { color: theme.textPrimary }]}>商品系列管理</Text>
              <TouchableOpacity onPress={() => setSeriesModalVisible(false)}>
                <Text style={styles.closeButton}>关闭</Text>
              </TouchableOpacity>
            </View>

            {!isAddingSeries && !editingSeriesId && canManageProductSeries && (
              <TouchableOpacity style={styles.addCityRow} onPress={openAddSeries} activeOpacity={0.85}>
                <LinearGradient
                  colors={[theme.pink, theme.blue]}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 0 }}
                  style={[styles.addCityButton, { width: '100%' }]}
                >
                  <Text style={styles.addCityButtonText}>添加系列</Text>
                </LinearGradient>
              </TouchableOpacity>
            )}

            {(isAddingSeries || editingSeriesId) ? (
              <View style={[styles.editorBox, { backgroundColor: theme.surfaceSecondary }]}> 
                <Text style={[styles.editorTitle, { color: theme.textPrimary }]}>{isAddingSeries ? '添加系列' : '编辑系列'}</Text>
                <TextInput
                  style={[styles.cityInput, { backgroundColor: theme.surface, color: theme.textPrimary, marginBottom: 10 }]}
                  placeholder="系列名称"
                  value={seriesName}
                  editable={canManageProductSeries}
                  onChangeText={setSeriesName}
                  placeholderTextColor={theme.textTertiary}
                />
                <TextInput
                  style={[styles.cityInput, { backgroundColor: theme.surface, color: theme.textPrimary, marginBottom: 10 }]}
                  placeholder="排序值（整数）"
                  value={seriesSortIndex}
                  editable={canManageProductSeries}
                  onChangeText={setSeriesSortIndex}
                  placeholderTextColor={theme.textTertiary}
                  keyboardType="number-pad"
                />
                <View style={styles.editActions}>
                  <TouchableOpacity style={[styles.smallBtn, { backgroundColor: theme.surface }]} onPress={() => { setIsAddingSeries(false); setEditingSeriesId(null); setSeriesName(''); setSeriesSortIndex(''); }}>
                    <Text style={[styles.smallBtnText, { color: theme.textSecondary }]}>取消</Text>
                  </TouchableOpacity>
                  {canManageProductSeries && (
                    <TouchableOpacity style={[styles.smallBtn, styles.smallBtnPrimary, { backgroundColor: theme.pink }]} onPress={handleSaveSeries}>
                      <Text style={styles.smallBtnPrimaryText}>保存</Text>
                    </TouchableOpacity>
                  )}
                </View>
              </View>
            ) : null}

            {!isAddingSeries && !editingSeriesId && (
              <FlatList
                data={series}
                keyExtractor={(item) => item.id}
                renderItem={({ item }) => (
                  <TouchableOpacity
                    style={[styles.cityRow, { borderBottomColor: theme.divider }]}
                    onPress={() => openEditSeries(item.id, item.name, item.sort_index)}
                    disabled={!canManageProductSeries}
                  >
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.cityName, { color: theme.textPrimary }]}>{item.name}</Text>
                      <Text style={[styles.distributorSubText, { color: theme.textSecondary }]}>排序：{item.sort_index}</Text>
                    </View>
                    <View style={styles.cityActionsRow}>
                      {canManageProductSeries && (
                        <>
                          <TouchableOpacity onPress={() => openEditSeries(item.id, item.name, item.sort_index)} style={{ marginRight: 15 }}>
                            <Text style={styles.closeButton}>编辑</Text>
                          </TouchableOpacity>
                          <TouchableOpacity onPress={() => handleDeleteSeries(item.id, item.name)}>
                            <Text style={styles.deleteCityText}>删除</Text>
                          </TouchableOpacity>
                        </>
                      )}
                    </View>
                  </TouchableOpacity>
                )}
                ListEmptyComponent={<Text style={[styles.emptyCityText, { color: theme.textTertiary }]}>{seriesLoading ? '加载中...' : '暂无系列'}</Text>}
                style={styles.cityList}
                contentContainerStyle={series.length === 0 ? styles.cityListEmptyContent : styles.cityListContent}
              />
            )}
          </View>
        </View>
      </Modal>

      {/* Supplier Management Modal */}
      <Modal visible={supplierModalVisible} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, styles.managementModalContent, { backgroundColor: theme.surface }]}>
            <View style={styles.modalHeader}>
              <Text style={[styles.modalTitle, { color: theme.textPrimary }]}>供应商管理</Text>
              <TouchableOpacity onPress={() => setSupplierModalVisible(false)}>
                <Text style={styles.closeButton}>关闭</Text>
              </TouchableOpacity>
            </View>

            {!canEditSupplierManagement && (
              <View style={[styles.editorBox, { backgroundColor: theme.surfaceSecondary, marginBottom: 10 }]}> 
                <Text style={[styles.editorHint, { color: theme.textSecondary }]}>当前为只读模式：仅超级管理员可新增/编辑/删除供应商。</Text>
              </View>
            )}

            {!isAddingSupplier && !editingSupplierId && canEditSupplierManagement && (
              <TouchableOpacity style={styles.addCityRow} onPress={openAddSupplier} activeOpacity={0.85}>
                <LinearGradient
                  colors={[theme.pink, theme.blue]}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 0 }}
                  style={[styles.addCityButton, { width: '100%' }]}
                >
                  <Text style={styles.addCityButtonText}>添加供应商</Text>
                </LinearGradient>
              </TouchableOpacity>
            )}

            {(isAddingSupplier || editingSupplierId) ? (
              <View style={[styles.editorBox, { backgroundColor: theme.surfaceSecondary }]}> 
                <Text style={[styles.editorTitle, { color: theme.textPrimary }]}>{isAddingSupplier ? '添加供应商' : '编辑供应商'}</Text>

                <TextInput
                  style={[styles.cityInput, { backgroundColor: theme.surface, color: theme.textPrimary, marginBottom: 10 }]}
                  placeholder="供应商名称"
                  value={editSupplierData.company_name}
                  editable={canEditSupplierManagement}
                  onChangeText={(text) => setEditSupplierData({ ...editSupplierData, company_name: text })}
                  placeholderTextColor={theme.textTertiary}
                />

                <TextInput
                  style={[styles.cityInput, { backgroundColor: theme.surface, color: theme.textPrimary, marginBottom: 10 }]}
                  placeholder="联系人 (选填)"
                  value={editSupplierData.contact}
                  editable={canEditSupplierManagement}
                  onChangeText={(text) => setEditSupplierData({ ...editSupplierData, contact: text })}
                  placeholderTextColor={theme.textTertiary}
                />

                <TextInput
                  style={[styles.cityInput, { backgroundColor: theme.surface, color: theme.textPrimary, marginBottom: 10 }]}
                  placeholder="电话 (选填)"
                  value={editSupplierData.phone}
                  editable={canEditSupplierManagement}
                  onChangeText={(text) => setEditSupplierData({ ...editSupplierData, phone: text })}
                  placeholderTextColor={theme.textTertiary}
                />

                <TextInput
                  style={[styles.cityInput, { backgroundColor: theme.surface, color: theme.textPrimary, marginBottom: 10 }]}
                  placeholder="地址 (选填)"
                  value={editSupplierData.address}
                  editable={canEditSupplierManagement}
                  onChangeText={(text) => setEditSupplierData({ ...editSupplierData, address: text })}
                  placeholderTextColor={theme.textTertiary}
                />

                <TextInput
                  style={[styles.cityInput, { backgroundColor: theme.surface, color: theme.textPrimary, marginBottom: 10 }]}
                  placeholder="交付周期（天，选填）"
                  value={editSupplierData.delivery_cycle_days}
                  editable={canEditSupplierManagement}
                  onChangeText={(text) => setEditSupplierData({ ...editSupplierData, delivery_cycle_days: text })}
                  placeholderTextColor={theme.textTertiary}
                  keyboardType="number-pad"
                />

                <TextInput
                  style={[styles.cityInput, { backgroundColor: theme.surface, color: theme.textPrimary, marginBottom: 10 }]}
                  placeholder="平均单价（选填）"
                  value={editSupplierData.avg_unit_price}
                  editable={canEditSupplierManagement}
                  onChangeText={(text) => setEditSupplierData({ ...editSupplierData, avg_unit_price: text })}
                  placeholderTextColor={theme.textTertiary}
                  keyboardType="numeric"
                />

                <View style={[styles.infoRow, { borderBottomWidth: 0, paddingVertical: 0, marginBottom: 10 }]}> 
                  <Text style={[styles.infoLabel, { color: theme.textSecondary }]}>状态</Text>
                  <Switch
                    value={editSupplierData.status === 'active'}
                    disabled={!canEditSupplierManagement}
                    onValueChange={(val) => setEditSupplierData({ ...editSupplierData, status: val ? 'active' : 'inactive' })}
                    trackColor={{ false: theme.border, true: theme.pinkLight }}
                    thumbColor={editSupplierData.status === 'active' ? theme.pink : theme.textTertiary}
                  />
                </View>

                <View style={styles.editActions}>
                  <TouchableOpacity style={[styles.smallBtn, { backgroundColor: theme.surface }]} onPress={() => { setIsAddingSupplier(false); setEditingSupplierId(null); }}>
                    <Text style={[styles.smallBtnText, { color: theme.textSecondary }]}>取消</Text>
                  </TouchableOpacity>
                  {canEditSupplierManagement && (
                    <TouchableOpacity style={[styles.smallBtn, styles.smallBtnPrimary, { backgroundColor: theme.pink }]} onPress={handleSaveSupplier}>
                      <Text style={styles.smallBtnPrimaryText}>保存</Text>
                    </TouchableOpacity>
                  )}
                </View>
              </View>
            ) : null}

            {!isAddingSupplier && !editingSupplierId && (
              <FlatList
                data={suppliers}
                keyExtractor={(item) => item.id}
                renderItem={({ item }) => (
                  <TouchableOpacity
                    style={[styles.cityRow, { borderBottomColor: theme.divider }]}
                    onPress={canEditSupplierManagement ? () => openEditSupplier(item) : undefined}
                    disabled={!canEditSupplierManagement}
                  >
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.cityName, { color: theme.textPrimary }]}>{item.company_name}</Text>
                      <Text style={[styles.distributorSubText, { color: theme.textSecondary }]}>联系人：{item.contact || '-'} · 电话：{item.phone || '-'}</Text>
                      <Text style={[styles.distributorSubText, { color: theme.textSecondary }]}>周期：{item.delivery_cycle_days ?? '-'} 天 · 均价：{item.avg_unit_price ?? '-'}</Text>
                    </View>
                    <View style={styles.cityActionsRow}>
                      {canEditSupplierManagement ? (
                        <>
                          <TouchableOpacity onPress={() => openEditSupplier(item)} style={{ marginRight: 15 }}>
                            <Text style={styles.closeButton}>编辑</Text>
                          </TouchableOpacity>
                          <TouchableOpacity onPress={() => handleDeleteSupplier(item.id, item.company_name)}>
                            <Text style={styles.deleteCityText}>删除</Text>
                          </TouchableOpacity>
                        </>
                      ) : (
                        <Text style={[styles.distributorSubText, { color: item.status === 'active' ? theme.success : theme.textTertiary }]}>
                          {item.status === 'active' ? '启用' : '停用'}
                        </Text>
                      )}
                    </View>
                  </TouchableOpacity>
                )}
                ListEmptyComponent={<Text style={[styles.emptyCityText, { color: theme.textTertiary }]}>{supplierLoading ? '加载中...' : '暂无供应商'}</Text>}
                style={styles.cityList}
                contentContainerStyle={suppliers.length === 0 ? styles.cityListEmptyContent : styles.cityListContent}
              />
            )}
          </View>
        </View>
      </Modal>

      <Modal visible={avatarModalVisible} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <TouchableOpacity style={styles.modalOverlayTouch} activeOpacity={1} onPress={() => setAvatarModalVisible(false)} />
          <View style={[styles.avatarModalContent, { backgroundColor: theme.surface }]}> 
            <View style={styles.modalHeader}>
              <Text style={[styles.modalTitle, { color: theme.textPrimary }]}>选择头像</Text>
              <TouchableOpacity onPress={() => setAvatarModalVisible(false)}>
                <Text style={[styles.closeButton, { color: theme.pink }]}>关闭</Text>
              </TouchableOpacity>
            </View>
            <Text style={[styles.avatarModalHint, { color: theme.textSecondary }]}>动物 · 水果 · 蔬菜</Text>
            <FlatList
              data={avatarLibrary}
              keyExtractor={(item) => item.id}
              numColumns={4}
              contentContainerStyle={styles.avatarGrid}
              renderItem={({ item }) => (
                <TouchableOpacity
                  style={styles.avatarOption}
                  onPress={() => handleSelectAvatar(item.value)}
                >
                  <View style={[styles.avatarOptionImage, { backgroundColor: item.bgColor, borderColor: theme.border }]}> 
                    <Text style={styles.avatarOptionEmoji}>{item.emoji}</Text>
                  </View>
                </TouchableOpacity>
              )}
            />
          </View>
        </View>
      </Modal>

      <AppConfirmModal
        visible={logoutConfirmVisible}
        isDarkMode={isDarkMode}
        title="确认退出"
        message="确定要退出登录吗？"
        confirmText="退出"
        cancelText="取消"
        danger
        onCancel={() => setLogoutConfirmVisible(false)}
        onConfirm={() => {
          setLogoutConfirmVisible(false);
          void signOut();
        }}
      />

      <AppConfirmModal
        visible={updateConfirmVisible}
        isDarkMode={isDarkMode}
        title="发现新版本"
        message="更新已下载，是否立即重启应用？"
        confirmText="立即更新"
        cancelText="稍后"
        onCancel={() => setUpdateConfirmVisible(false)}
        onConfirm={() => {
          setUpdateConfirmVisible(false);
          void Updates.reloadAsync();
        }}
      />

      <AppConfirmModal
        visible={binaryUpdateConfirmVisible}
        isDarkMode={isDarkMode}
        title="发现安装包更新"
        message={`检测到新安装包 v${binaryUpdateVersion}，是否前往下载 APK？`}
        confirmText="去下载"
        cancelText="稍后"
        onCancel={() => setBinaryUpdateConfirmVisible(false)}
        onConfirm={() => {
          setBinaryUpdateConfirmVisible(false);
          if (!binaryUpdateUrl) return;
          void Linking.openURL(binaryUpdateUrl);
        }}
      />

      {/* Personal Info Modal */}
      <Modal visible={profileModalVisible} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, { backgroundColor: theme.surface }]}>
            <View style={styles.modalHeader}>
              <Text style={[styles.modalTitle, { color: theme.textPrimary }]}>个人信息</Text>
              <TouchableOpacity onPress={() => setProfileModalVisible(false)}>
                <Text style={styles.closeButton}>关闭</Text>
              </TouchableOpacity>
            </View>

            <View style={[styles.infoRow, { borderBottomColor: theme.divider }]}>
              <Text style={[styles.infoLabel, { color: theme.textSecondary }]}>邮箱</Text>
              <Text style={[styles.infoValue, { color: theme.textPrimary }]}>{user?.email}</Text>
            </View>
            <View style={[styles.infoRow, { borderBottomColor: theme.divider }]}>
              <Text style={[styles.infoLabel, { color: theme.textSecondary }]}>角色</Text>
              <Text style={[styles.infoValue, { color: theme.textPrimary }]}>{getRoleName(user?.role || '')}</Text>
            </View>
            <View style={[styles.infoRow, { borderBottomColor: theme.divider }]}>
              <Text style={[styles.infoLabel, { color: theme.textSecondary }]}>归属城市</Text>
              <Text style={[styles.infoValue, { color: theme.textPrimary }]}>{user?.city_name || '未设置'}</Text>
            </View>

            {isDistributor && (
              <>
                <Text style={[styles.editSectionLabel, { color: theme.textPrimary }]}>修改店面名称</Text>
                <TextInput
                  style={[styles.storeNameInput, { backgroundColor: theme.surfaceSecondary, color: theme.textPrimary }]}
                  value={ownStoreName}
                  onChangeText={setOwnStoreName}
                  placeholder="输入新店面名称"
                  placeholderTextColor={theme.textTertiary}
                />
                <TouchableOpacity
                  style={[styles.saveOwnBtn, savingOwnStore && styles.disabledBtn, { backgroundColor: theme.pink }]}
                  onPress={handleSaveOwnStore}
                  disabled={savingOwnStore}
                >
                  <Text style={styles.saveOwnBtnText}>{savingOwnStore ? '保存中...' : '保存'}</Text>
                </TouchableOpacity>
              </>
            )}

            {!isDistributor && (
              <View style={[styles.infoRow, { borderBottomColor: theme.divider }]}>
                <Text style={[styles.infoLabel, { color: theme.textSecondary }]}>店面</Text>
                <Text style={[styles.infoValue, { color: theme.textPrimary }]}>{user?.store_name || '-'}</Text>
              </View>
            )}
          </View>
        </View>
      </Modal>

      {/* Notifications Modal */}
      <Modal visible={notificationModalVisible} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, styles.managementModalContent, { backgroundColor: theme.surface }]}> 
            <View style={styles.modalHeader}>
              <Text style={[styles.modalTitle, { color: theme.textPrimary }]}>通知</Text>
              <TouchableOpacity onPress={() => setNotificationModalVisible(false)}>
                <Text style={styles.closeButton}>关闭</Text>
              </TouchableOpacity>
            </View>

            <FlatList
              data={notifications}
              keyExtractor={(item) => item.id}
              renderItem={renderNotification}
              ListEmptyComponent={<Text style={[styles.emptyCityText, { color: theme.textTertiary }]}>暂无通知</Text>}
              style={styles.cityList}
              contentContainerStyle={notifications.length === 0 ? styles.cityListEmptyContent : [styles.cityListContent, styles.notificationListContent]}
            />
          </View>
        </View>
      </Modal>

      {/* Province Management Modal */}
      <Modal visible={provinceModalVisible} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, styles.managementModalContent, { backgroundColor: theme.surface }]}>
            <View style={styles.modalHeader}>
              <Text style={[styles.modalTitle, { color: theme.textPrimary }]}>省份管理</Text>
              <TouchableOpacity onPress={() => setProvinceModalVisible(false)}>
                <Text style={styles.closeButton}>关闭</Text>
              </TouchableOpacity>
            </View>
            <FlatList
              data={derivedProvinces}
              keyExtractor={(item) => item}
              renderItem={({ item }) => (
                <View style={[styles.cityRow, { borderBottomColor: theme.divider }]}>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.cityName, { color: theme.textPrimary }]}>{item}</Text>
                    <Text style={[styles.distributorSubText, { color: theme.textSecondary }]}>
                      {provinceCityCount.get(item) || 0} 个城市
                    </Text>
                  </View>
                  <View style={styles.cityActionsRow}>
                    <TouchableOpacity
                      onPress={() => moveProvinceOrder(item, 'up')}
                      disabled={sortingProvince === item}
                      style={[styles.citySortBtn, sortingProvince === item && styles.citySortBtnDisabled]}
                    >
                      <ArrowUp size={14} color={theme.textSecondary} />
                    </TouchableOpacity>
                    <TouchableOpacity
                      onPress={() => moveProvinceOrder(item, 'down')}
                      disabled={sortingProvince === item}
                      style={[styles.citySortBtn, sortingProvince === item && styles.citySortBtnDisabled]}
                    >
                      <ArrowDown size={14} color={theme.textSecondary} />
                    </TouchableOpacity>
                  </View>
                </View>
              )}
              ListEmptyComponent={<Text style={[styles.emptyCityText, { color: theme.textTertiary }]}>暂无省份</Text>}
              style={styles.cityList}
              contentContainerStyle={derivedProvinces.length === 0 ? styles.cityListEmptyContent : styles.cityListContent}
            />
          </View>
        </View>
      </Modal>

      {/* City Management Modal */}
      <Modal visible={cityModalVisible} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, styles.managementModalContent, { backgroundColor: theme.surface }]}>
            <View style={styles.modalHeader}>
              <Text style={[styles.modalTitle, { color: theme.textPrimary }]}>城市管理</Text>
              <TouchableOpacity onPress={() => setCityModalVisible(false)}>
                <Text style={styles.closeButton}>关闭</Text>
              </TouchableOpacity>
            </View>
            <View style={styles.addCityRow}>
              <TextInput
                style={[styles.cityInput, { backgroundColor: theme.surfaceSecondary, color: theme.textPrimary }]}
                placeholder="输入新城市名称"
                placeholderTextColor={theme.textTertiary}
                value={newCityName}
                onChangeText={setNewCityName}
              />
              <TouchableOpacity onPress={handleAddCity} activeOpacity={0.85}>
                <LinearGradient
                  colors={[theme.pink, theme.blue]}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 0 }}
                  style={styles.addCityButton}
                >
                  <Text style={styles.addCityButtonText}>添加</Text>
                </LinearGradient>
              </TouchableOpacity>
            </View>
            <FlatList
              data={cities}
              keyExtractor={(item) => item.id}
              renderItem={({ item }) => (
                <View style={[styles.cityRow, { borderBottomColor: theme.divider }]}> 
                  <Text style={[styles.cityName, { color: theme.textPrimary }]}>{item.name}</Text>
                  <View style={styles.cityActionsRow}>
                    <TouchableOpacity
                      onPress={async () => {
                        setSortingCityId(item.id);
                        const { error } = await moveCityOrder(item.id, 'up');
                        setSortingCityId(null);
                        if (error) Toast.show({ type: 'error', text1: '错误', text2: error.message });
                      }}
                      disabled={sortingCityId === item.id}
                      style={[styles.citySortBtn, sortingCityId === item.id && styles.citySortBtnDisabled]}
                    >
                      <ArrowUp size={14} color={theme.textSecondary} />
                    </TouchableOpacity>
                    <TouchableOpacity
                      onPress={async () => {
                        setSortingCityId(item.id);
                        const { error } = await moveCityOrder(item.id, 'down');
                        setSortingCityId(null);
                        if (error) Toast.show({ type: 'error', text1: '错误', text2: error.message });
                      }}
                      disabled={sortingCityId === item.id}
                      style={[styles.citySortBtn, sortingCityId === item.id && styles.citySortBtnDisabled]}
                    >
                      <ArrowDown size={14} color={theme.textSecondary} />
                    </TouchableOpacity>
                    <TouchableOpacity onPress={() => handleDeleteCity(item.id, item.name)}>
                      <Text style={styles.deleteCityText}>删除</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              )}
              ListEmptyComponent={<Text style={[styles.emptyCityText, { color: theme.textTertiary }]}>暂无城市</Text>}
              style={styles.cityList}
              contentContainerStyle={cities.length === 0 ? styles.cityListEmptyContent : styles.cityListContent}
            />
          </View>
        </View>
      </Modal>

      {/* Distributor Management Modal */}
      <Modal visible={distributorModalVisible} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, styles.managementModalContent, { backgroundColor: theme.surface }]}>
            <View style={styles.modalHeader}>
              <Text style={[styles.modalTitle, { color: theme.textPrimary }]}>分销商管理</Text>
              <TouchableOpacity onPress={() => setDistributorModalVisible(false)}>
                <Text style={styles.closeButton}>关闭</Text>
              </TouchableOpacity>
            </View>

            {editingDistributorId ? (
              <View style={[styles.editorBox, { backgroundColor: theme.surfaceSecondary }]}>
                <Text style={[styles.editorTitle, { color: theme.textPrimary }]}>修改归属城市</Text>
                <Text style={[styles.editorHint, { color: theme.textTertiary }]}>选择城市（店面可留空保持不变）</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.cityChipsWrap}>
                  {cities.map((city) => (
                    <TouchableOpacity
                      key={city.id}
                      style={[
                        styles.cityChip, 
                        { backgroundColor: theme.surface },
                        editCityId === city.id && { backgroundColor: theme.pink }
                      ]}
                      onPress={() => setEditCityId(city.id)}
                    >
                      <Text style={[
                        styles.cityChipText, 
                        { color: theme.textSecondary },
                        editCityId === city.id && { color: '#fff', fontWeight: '600' }
                      ]}>{city.name}</Text>
                    </TouchableOpacity>
                  ))}
                </ScrollView>
                <TextInput
                  style={[styles.cityInput, { backgroundColor: theme.surface, color: theme.textPrimary }]}
                  placeholder="店面（留空则不修改）"
                  value={editStoreName}
                  onChangeText={setEditStoreName}
                  placeholderTextColor={theme.textTertiary}
                />
                <View style={styles.editActions}>
                  <TouchableOpacity style={[styles.smallBtn, { backgroundColor: theme.surface }]} onPress={() => setEditingDistributorId(null)}>
                    <Text style={[styles.smallBtnText, { color: theme.textSecondary }]}>取消</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={[styles.smallBtn, styles.smallBtnPrimary, { backgroundColor: theme.pink }]} onPress={handleSaveDistributor}>
                    <Text style={styles.smallBtnPrimaryText}>保存</Text>
                  </TouchableOpacity>
                </View>
              </View>
            ) : null}

            <FlatList
              data={distributors}
              keyExtractor={(item) => item.id}
              renderItem={({ item }) => (
                <TouchableOpacity
                  style={[styles.cityRow, { borderBottomColor: theme.divider }]}
                  onPress={() => openEditDistributor(item.id, item.city_id, item.store_name)}
                >
                  <View>
                    <Text style={[styles.cityName, { color: theme.textPrimary }]}>{item.email}</Text>
                    <Text style={[styles.distributorSubText, { color: theme.textSecondary }]}>
                      {item.city_name || '未设置城市'} · {item.store_name || '未设置店面'}
                    </Text>
                  </View>
                  <Text style={styles.closeButton}>编辑</Text>
                </TouchableOpacity>
              )}
              ListEmptyComponent={<Text style={[styles.emptyCityText, { color: theme.textTertiary }]}>暂无分销商</Text>}
              style={styles.cityList}
              contentContainerStyle={distributors.length === 0 ? styles.cityListEmptyContent : styles.cityListContent}
            />
          </View>
        </View>
      </Modal>

      {/* Store Management Modal */}
      <Modal visible={storeModalVisible} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <KeyboardAvoidingView
            behavior={Platform.OS === 'ios' ? 'padding' : undefined}
            keyboardVerticalOffset={Platform.OS === 'ios' ? 16 : 0}
            style={styles.keyboardAvoidingWrapper}
          >
          <View style={[styles.modalContent, styles.storeModalContent, { backgroundColor: theme.surface }]}>
            <View style={styles.modalHeader}>
              <Text style={[styles.modalTitle, { color: theme.textPrimary }]}>店铺管理</Text>
              <TouchableOpacity onPress={() => setStoreModalVisible(false)}>
                <Text style={styles.closeButton}>关闭</Text>
              </TouchableOpacity>
            </View>

            {!isSuperAdmin && (
              <View style={[styles.editorBox, { backgroundColor: theme.surfaceSecondary, marginBottom: 10 }]}> 
                <Text style={[styles.editorHint, { color: theme.textSecondary }]}>当前为只读模式：仅超级管理员可新增/编辑/停用/删除店铺。</Text>
              </View>
            )}

            {!isAddingStore && !editingStoreId && (
              <>
                {isSuperAdmin ? (
                  <TouchableOpacity style={styles.addCityRow} onPress={openAddStore} activeOpacity={0.85}>
                    <LinearGradient
                      colors={[theme.pink, theme.blue]}
                      start={{ x: 0, y: 0 }}
                      end={{ x: 1, y: 0 }}
                      style={[styles.addCityButton, { width: '100%' }]}
                    >
                      <Text style={styles.addCityButtonText}>添加新店铺</Text>
                    </LinearGradient>
                  </TouchableOpacity>
                ) : (
                  <View style={[styles.addCityButton, { width: '100%', backgroundColor: theme.surfaceSecondary }]}> 
                    <Text style={[styles.addCityButtonText, { color: theme.textSecondary }]}>仅超级管理员可编辑店铺</Text>
                  </View>
                )}
                <View style={{ marginBottom: 10 }}>
                  <ProvinceCityFilter
                    cities={cities}
                    selectedProvinceId={storeFilterProvinceId}
                    selectedCityId={storeFilterCityId}
                    onProvinceChange={setStoreFilterProvinceId}
                    onCityChange={setStoreFilterCityId}
                    showProvince={true}
                  />
                </View>
              </>
            )}

            {(isAddingStore || editingStoreId) ? (
              <ScrollView
                style={styles.storeEditorScroll}
                contentContainerStyle={styles.storeEditorScrollContent}
                keyboardShouldPersistTaps="handled"
                showsVerticalScrollIndicator={false}
              >
              <View style={[styles.editorBox, { backgroundColor: theme.surfaceSecondary }]}>
                <Text style={[styles.editorTitle, { color: theme.textPrimary }]}>
                  {isAddingStore ? '添加店铺' : '编辑店铺'}
                </Text>
                
                <TextInput
                  style={[styles.cityInput, { backgroundColor: theme.surface, color: theme.textPrimary, marginBottom: 10 }]}
                  placeholder="店铺名称"
                  value={editStoreData.name}
                  editable={isSuperAdmin}
                  onChangeText={(text) => setEditStoreData({ ...editStoreData, name: text })}
                  placeholderTextColor={theme.textTertiary}
                />

                <Text style={[styles.editorHint, { color: theme.textTertiary }]}>归属城市</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.cityChipsWrap}>
                  {cities.map((city) => (
                    <TouchableOpacity
                      key={city.id}
                      style={[
                        styles.cityChip, 
                        { backgroundColor: theme.surface },
                        editStoreData.city_id === city.id && { backgroundColor: theme.pink }
                      ]}
                      disabled={!isSuperAdmin}
                      onPress={() => setEditStoreData({ ...editStoreData, city_id: city.id })}
                    >
                      <Text style={[
                        styles.cityChipText, 
                        { color: theme.textSecondary },
                        editStoreData.city_id === city.id && { color: '#fff', fontWeight: '600' }
                      ]}>{city.name}</Text>
                    </TouchableOpacity>
                  ))}
                </ScrollView>

                <Text style={[styles.editorHint, { color: theme.textTertiary }]}>分销商</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.cityChipsWrap}>
                  <TouchableOpacity
                    style={[
                      styles.cityChip,
                      { backgroundColor: theme.surface },
                      !editStoreData.distributor_id && { backgroundColor: theme.pink },
                    ]}
                    disabled={!isSuperAdmin}
                    onPress={() => setEditStoreData({ ...editStoreData, distributor_id: '' })}
                  >
                    <Text
                      style={[
                        styles.cityChipText,
                        { color: theme.textSecondary },
                        !editStoreData.distributor_id && { color: '#fff', fontWeight: '600' },
                      ]}
                    >
                      暂不绑定
                    </Text>
                  </TouchableOpacity>
                  {distributors.map((dist) => (
                    <TouchableOpacity
                      key={dist.id}
                      style={[
                        styles.cityChip, 
                        { backgroundColor: theme.surface },
                        editStoreData.distributor_id === dist.id && { backgroundColor: theme.pink }
                      ]}
                      disabled={!isSuperAdmin}
                      onPress={() => setEditStoreData({ ...editStoreData, distributor_id: dist.id })}
                    >
                      <Text style={[
                        styles.cityChipText, 
                        { color: theme.textSecondary },
                        editStoreData.distributor_id === dist.id && { color: '#fff', fontWeight: '600' }
                      ]}>{dist.email}</Text>
                    </TouchableOpacity>
                  ))}
                </ScrollView>

                <TextInput
                  style={[styles.cityInput, { backgroundColor: theme.surface, color: theme.textPrimary, marginBottom: 10 }]}
                  placeholder="折扣率 (如 0.8 表示 8折)"
                  value={editStoreData.discount_rate}
                  editable={isSuperAdmin}
                  onChangeText={(text) => setEditStoreData({ ...editStoreData, discount_rate: text })}
                  placeholderTextColor={theme.textTertiary}
                  keyboardType="numeric"
                />

                <TextInput
                  style={[styles.cityInput, { backgroundColor: theme.surface, color: theme.textPrimary, marginBottom: 10 }]}
                  placeholder="联系人 (选填)"
                  value={editStoreData.contact}
                  editable={isSuperAdmin}
                  onChangeText={(text) => setEditStoreData({ ...editStoreData, contact: text })}
                  placeholderTextColor={theme.textTertiary}
                />

                <TextInput
                  style={[styles.cityInput, { backgroundColor: theme.surface, color: theme.textPrimary, marginBottom: 10 }]}
                  placeholder="地址 (选填)"
                  value={editStoreData.address}
                  editable={isSuperAdmin}
                  onChangeText={(text) => setEditStoreData({ ...editStoreData, address: text })}
                  placeholderTextColor={theme.textTertiary}
                />

                <TextInput
                  style={[styles.cityInput, { backgroundColor: theme.surface, color: theme.textPrimary, marginBottom: 10 }]}
                  placeholder="电话 (选填)"
                  value={editStoreData.phone}
                  editable={isSuperAdmin}
                  onChangeText={(text) => setEditStoreData({ ...editStoreData, phone: text })}
                  placeholderTextColor={theme.textTertiary}
                />

                <TextInput
                  style={[styles.cityInput, { backgroundColor: theme.surface, color: theme.textPrimary, marginBottom: 10 }]}
                  placeholder="每月结算日 (1-31，选填)"
                  value={editStoreData.settlement_day}
                  editable={isSuperAdmin}
                  onChangeText={(text) => setEditStoreData({ ...editStoreData, settlement_day: text })}
                  placeholderTextColor={theme.textTertiary}
                  keyboardType="number-pad"
                />

                <TextInput
                  style={[styles.cityInput, { backgroundColor: theme.surface, color: theme.textPrimary, marginBottom: 10 }]}
                  placeholder="合同到期日 (如 2026-12-31，选填)"
                  value={editStoreData.contract_expiry_date}
                  editable={isSuperAdmin}
                  onChangeText={(text) => setEditStoreData({ ...editStoreData, contract_expiry_date: text })}
                  placeholderTextColor={theme.textTertiary}
                />

                <TextInput
                  style={[styles.cityInput, { backgroundColor: theme.surface, color: theme.textPrimary, marginBottom: 10 }]}
                  placeholder="店铺等级 (S/A/B/C/D/E，选填)"
                  value={editStoreData.grade}
                  editable={isSuperAdmin}
                  onChangeText={(text) => {
                    const normalized = text.trim().toUpperCase();
                    const nextGrade = (
                      normalized === ''
                      || normalized === 'S'
                      || normalized === 'A'
                      || normalized === 'B'
                      || normalized === 'C'
                      || normalized === 'D'
                      || normalized === 'E'
                    )
                      ? (normalized as '' | 'S' | 'A' | 'B' | 'C' | 'D' | 'E')
                      : editStoreData.grade;
                    setEditStoreData({ ...editStoreData, grade: nextGrade });
                  }}
                  placeholderTextColor={theme.textTertiary}
                />

                <TextInput
                  style={[styles.cityInput, { backgroundColor: theme.surface, color: theme.textPrimary, marginBottom: 10 }]}
                  placeholder="合同文件链接 (选填)"
                  value={editStoreData.contract_file_url}
                  editable={isSuperAdmin}
                  onChangeText={(text) => setEditStoreData({ ...editStoreData, contract_file_url: text })}
                  placeholderTextColor={theme.textTertiary}
                />

                <TextInput
                  style={[styles.cityInput, { backgroundColor: theme.surface, color: theme.textPrimary, marginBottom: 10 }]}
                  placeholder="发票抬头 (选填)"
                  value={editStoreData.invoice_title}
                  editable={isSuperAdmin}
                  onChangeText={(text) => setEditStoreData({ ...editStoreData, invoice_title: text })}
                  placeholderTextColor={theme.textTertiary}
                />

                <TextInput
                  style={[styles.cityInput, { backgroundColor: theme.surface, color: theme.textPrimary, marginBottom: 10 }]}
                  placeholder="纳税人识别号 (选填)"
                  value={editStoreData.tax_id}
                  editable={isSuperAdmin}
                  onChangeText={(text) => setEditStoreData({ ...editStoreData, tax_id: text })}
                  placeholderTextColor={theme.textTertiary}
                />

                <TextInput
                  style={[styles.cityInput, { backgroundColor: theme.surface, color: theme.textPrimary, marginBottom: 10 }]}
                  placeholder="开户银行 (选填)"
                  value={editStoreData.bank_name}
                  editable={isSuperAdmin}
                  onChangeText={(text) => setEditStoreData({ ...editStoreData, bank_name: text })}
                  placeholderTextColor={theme.textTertiary}
                />

                <TextInput
                  style={[styles.cityInput, { backgroundColor: theme.surface, color: theme.textPrimary, marginBottom: 10 }]}
                  placeholder="银行账号 (选填)"
                  value={editStoreData.bank_account}
                  editable={isSuperAdmin}
                  onChangeText={(text) => setEditStoreData({ ...editStoreData, bank_account: text })}
                  placeholderTextColor={theme.textTertiary}
                />

                <TextInput
                  style={[styles.cityInput, { backgroundColor: theme.surface, color: theme.textPrimary, marginBottom: 10 }]}
                  placeholder="开票联系电话 (选填)"
                  value={editStoreData.invoice_phone}
                  editable={isSuperAdmin}
                  onChangeText={(text) => setEditStoreData({ ...editStoreData, invoice_phone: text })}
                  placeholderTextColor={theme.textTertiary}
                />

                <TextInput
                  style={[styles.cityInput, { backgroundColor: theme.surface, color: theme.textPrimary, marginBottom: 10 }]}
                  placeholder="开票地址 (选填)"
                  value={editStoreData.invoice_address}
                  editable={isSuperAdmin}
                  onChangeText={(text) => setEditStoreData({ ...editStoreData, invoice_address: text })}
                  placeholderTextColor={theme.textTertiary}
                />

                {(editStoreData.invoice_title || editStoreData.tax_id || editStoreData.bank_name || editStoreData.bank_account || editStoreData.invoice_phone || editStoreData.invoice_address) ? (
                  <View style={[styles.invoiceBox, { backgroundColor: theme.surfaceSecondary, borderColor: theme.divider }]}> 
                    <View style={styles.invoiceHeaderRow}>
                      <TouchableOpacity
                        style={styles.invoiceToggleButton}
                        onPress={() => setIsStoreEditorInvoiceExpanded((prev) => !prev)}
                      >
                        <Text style={[styles.invoiceTitleText, { color: theme.textSecondary }]}>开票信息</Text>
                        {isStoreEditorInvoiceExpanded ? (
                          <ChevronUp size={14} color={theme.textTertiary} />
                        ) : (
                          <ChevronDown size={14} color={theme.textTertiary} />
                        )}
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={styles.invoiceCopyAllButton}
                        onPress={() => {
                          void copyInvoiceText([
                            `发票抬头：${editStoreData.invoice_title || '-'}`,
                            `纳税人识别号：${editStoreData.tax_id || '-'}`,
                            `开户行：${editStoreData.bank_name || '-'}`,
                            `账号：${editStoreData.bank_account || '-'}`,
                            `联系电话：${editStoreData.invoice_phone || '-'}`,
                            `开票地址：${editStoreData.invoice_address || '-'}`,
                          ].join('\n'), 'store-editor:all');
                        }}
                      >
                        {copiedInvoiceKey === 'store-editor:all' ? (
                          <Check size={14} color={theme.blue} />
                        ) : (
                          <Copy size={14} color={theme.textSecondary} />
                        )}
                        <Text style={[styles.invoiceCopyText, { color: theme.textSecondary }]}>一键复制</Text>
                      </TouchableOpacity>
                    </View>

                    {isStoreEditorInvoiceExpanded ? (
                      <View style={styles.invoiceDetailWrap}>
                        <View style={styles.invoiceDetailRow}>
                          <Text style={[styles.distributorSubText, styles.invoiceDetailText, { color: theme.textSecondary }]} numberOfLines={1}>
                            发票抬头：{editStoreData.invoice_title || '-'}
                          </Text>
                          <TouchableOpacity onPress={() => { void copyInvoiceText(editStoreData.invoice_title || '', 'store-editor:title'); }}>
                            {copiedInvoiceKey === 'store-editor:title' ? <Check size={14} color={theme.blue} /> : <Copy size={14} color={theme.textSecondary} />}
                          </TouchableOpacity>
                        </View>

                        <View style={styles.invoiceDetailRow}>
                          <Text style={[styles.distributorSubText, styles.invoiceDetailText, { color: theme.textSecondary }]} numberOfLines={1}>
                            纳税人识别号：{editStoreData.tax_id || '-'}
                          </Text>
                          <TouchableOpacity onPress={() => { void copyInvoiceText(editStoreData.tax_id || '', 'store-editor:tax'); }}>
                            {copiedInvoiceKey === 'store-editor:tax' ? <Check size={14} color={theme.blue} /> : <Copy size={14} color={theme.textSecondary} />}
                          </TouchableOpacity>
                        </View>

                        <View style={styles.invoiceDetailRow}>
                          <Text style={[styles.distributorSubText, styles.invoiceDetailText, { color: theme.textSecondary }]} numberOfLines={1}>
                            开户行+账号：{editStoreData.bank_name || '-'} / {editStoreData.bank_account || '-'}
                          </Text>
                          <TouchableOpacity onPress={() => { void copyInvoiceText(`${editStoreData.bank_name || '-'} / ${editStoreData.bank_account || '-'}`, 'store-editor:bank'); }}>
                            {copiedInvoiceKey === 'store-editor:bank' ? <Check size={14} color={theme.blue} /> : <Copy size={14} color={theme.textSecondary} />}
                          </TouchableOpacity>
                        </View>

                        <View style={styles.invoiceDetailRow}>
                          <Text style={[styles.distributorSubText, styles.invoiceDetailText, { color: theme.textSecondary }]} numberOfLines={1}>
                            联系电话：{editStoreData.invoice_phone || '-'}
                          </Text>
                          <TouchableOpacity onPress={() => { void copyInvoiceText(editStoreData.invoice_phone || '', 'store-editor:phone'); }}>
                            {copiedInvoiceKey === 'store-editor:phone' ? <Check size={14} color={theme.blue} /> : <Copy size={14} color={theme.textSecondary} />}
                          </TouchableOpacity>
                        </View>

                        <View style={styles.invoiceDetailRow}>
                          <Text style={[styles.distributorSubText, styles.invoiceDetailText, { color: theme.textSecondary }]} numberOfLines={1}>
                            开票地址：{editStoreData.invoice_address || '-'}
                          </Text>
                          <TouchableOpacity onPress={() => { void copyInvoiceText(editStoreData.invoice_address || '', 'store-editor:address'); }}>
                            {copiedInvoiceKey === 'store-editor:address' ? <Check size={14} color={theme.blue} /> : <Copy size={14} color={theme.textSecondary} />}
                          </TouchableOpacity>
                        </View>
                      </View>
                    ) : null}
                  </View>
                ) : null}

                <Text style={[styles.editorHint, { color: theme.textTertiary }]}>合作模式</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.cityChipsWrap}>
                  {([
                    { value: 'consignment', label: '寄售' },
                    { value: 'buyout', label: '买断' },
                    { value: 'direct', label: '直营' },
                  ] as const).map((mode) => (
                    <TouchableOpacity
                      key={mode.value}
                      style={[
                        styles.cityChip,
                        { backgroundColor: theme.surface },
                        editStoreData.cooperation_mode === mode.value && { backgroundColor: theme.pink },
                      ]}
                      disabled={!isSuperAdmin}
                      onPress={() => setEditStoreData({ ...editStoreData, cooperation_mode: mode.value })}
                    >
                      <Text
                        style={[
                          styles.cityChipText,
                          { color: theme.textSecondary },
                          editStoreData.cooperation_mode === mode.value && { color: '#fff', fontWeight: '600' },
                        ]}
                      >
                        {mode.label}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </ScrollView>

                {editingStoreId && (
                  <View style={[styles.infoRow, { borderBottomWidth: 0, paddingVertical: 0, marginBottom: 10 }]}>
                    <Text style={[styles.infoLabel, { color: theme.textSecondary }]}>状态</Text>
                    <Switch
                      value={editStoreData.status === 'active'}
                      disabled={!isSuperAdmin}
                      onValueChange={(val) => setEditStoreData({ ...editStoreData, status: val ? 'active' : 'inactive' })}
                      trackColor={{ false: theme.border, true: theme.pinkLight }}
                      thumbColor={editStoreData.status === 'active' ? theme.pink : theme.textTertiary}
                    />
                  </View>
                )}

                <View style={styles.editActions}>
                  <TouchableOpacity style={[styles.smallBtn, { backgroundColor: theme.surface }]} onPress={() => { setIsAddingStore(false); setEditingStoreId(null); }}>
                    <Text style={[styles.smallBtnText, { color: theme.textSecondary }]}>取消</Text>
                  </TouchableOpacity>
                  {isSuperAdmin && (
                    <TouchableOpacity style={[styles.smallBtn, styles.smallBtnPrimary, { backgroundColor: theme.pink }]} onPress={handleSaveStore}>
                      <Text style={styles.smallBtnPrimaryText}>保存</Text>
                    </TouchableOpacity>
                  )}
                </View>
              </View>
              </ScrollView>
            ) : null}

            {!isAddingStore && !editingStoreId && (
              <FlatList
                data={filteredStores}
                keyExtractor={(item) => item.id}
                renderItem={({ item }) => (
                  <View style={[styles.cityRow, { borderBottomColor: theme.divider }]}>
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.cityName, { color: theme.textPrimary }]}>
                        {item.name} {item.status === 'inactive' ? '(已停用)' : ''}
                      </Text>
                      <Text style={[styles.distributorSubText, { color: theme.textSecondary }]}>
                        {item.city_name || '未知城市'} · {item.distributor_email || '未绑定分销商'}
                      </Text>
                      <Text style={[styles.distributorSubText, { color: theme.textSecondary }]}>联系人：{item.contact || '-'} · 电话：{item.phone || '-'}</Text>
                      <Text style={[styles.distributorSubText, { color: theme.textSecondary }]}>结算日：{item.settlement_day ?? '-'} · 合作模式：{item.cooperation_mode ? cooperationModeLabelMap[item.cooperation_mode] : '-'}</Text>
                      <Text style={[styles.distributorSubText, { color: theme.textSecondary }]}>等级：{item.grade || '-'} · 合同到期：{item.contract_expiry_date || '-'}</Text>
                      {item.contract_file_url ? <Text style={[styles.distributorSubText, { color: theme.blue }]} numberOfLines={1}>合同链接：{item.contract_file_url}</Text> : null}
                      {hasInvoiceInfo(item) ? (
                        <View style={[styles.invoiceBox, { backgroundColor: theme.surfaceSecondary, borderColor: theme.divider }]}> 
                          <View style={styles.invoiceHeaderRow}>
                            <TouchableOpacity
                              style={styles.invoiceToggleButton}
                              onPress={() => {
                                setExpandedInvoiceByStore((prev) => ({
                                  ...prev,
                                  [item.id]: !prev[item.id],
                                }));
                              }}
                            >
                              <Text style={[styles.invoiceTitleText, { color: theme.textSecondary }]}>开票信息</Text>
                              {expandedInvoiceByStore[item.id] ? (
                                <ChevronUp size={14} color={theme.textTertiary} />
                              ) : (
                                <ChevronDown size={14} color={theme.textTertiary} />
                              )}
                            </TouchableOpacity>
                            <TouchableOpacity
                              style={styles.invoiceCopyAllButton}
                              onPress={() => {
                                void copyInvoiceText(buildInvoiceText(item), `${item.id}:all`);
                              }}
                            >
                              {copiedInvoiceKey === `${item.id}:all` ? (
                                <Check size={14} color={theme.blue} />
                              ) : (
                                <Copy size={14} color={theme.textSecondary} />
                              )}
                              <Text style={[styles.invoiceCopyText, { color: theme.textSecondary }]}>一键复制</Text>
                            </TouchableOpacity>
                          </View>

                          {expandedInvoiceByStore[item.id] ? (
                            <View style={styles.invoiceDetailWrap}>
                              <View style={styles.invoiceDetailRow}>
                                <Text style={[styles.distributorSubText, styles.invoiceDetailText, { color: theme.textSecondary }]} numberOfLines={1}>
                                  发票抬头：{item.invoice_title || '-'}
                                </Text>
                                <TouchableOpacity onPress={() => { void copyInvoiceText(item.invoice_title || '', `${item.id}:title`); }}>
                                  {copiedInvoiceKey === `${item.id}:title` ? <Check size={14} color={theme.blue} /> : <Copy size={14} color={theme.textSecondary} />}
                                </TouchableOpacity>
                              </View>

                              <View style={styles.invoiceDetailRow}>
                                <Text style={[styles.distributorSubText, styles.invoiceDetailText, { color: theme.textSecondary }]} numberOfLines={1}>
                                  纳税人识别号：{item.tax_id || '-'}
                                </Text>
                                <TouchableOpacity onPress={() => { void copyInvoiceText(item.tax_id || '', `${item.id}:tax`); }}>
                                  {copiedInvoiceKey === `${item.id}:tax` ? <Check size={14} color={theme.blue} /> : <Copy size={14} color={theme.textSecondary} />}
                                </TouchableOpacity>
                              </View>

                              <View style={styles.invoiceDetailRow}>
                                <Text style={[styles.distributorSubText, styles.invoiceDetailText, { color: theme.textSecondary }]} numberOfLines={1}>
                                  开户行+账号：{item.bank_name || '-'} / {item.bank_account || '-'}
                                </Text>
                                <TouchableOpacity onPress={() => { void copyInvoiceText(`${item.bank_name || '-'} / ${item.bank_account || '-'}`, `${item.id}:bank`); }}>
                                  {copiedInvoiceKey === `${item.id}:bank` ? <Check size={14} color={theme.blue} /> : <Copy size={14} color={theme.textSecondary} />}
                                </TouchableOpacity>
                              </View>

                              <View style={styles.invoiceDetailRow}>
                                <Text style={[styles.distributorSubText, styles.invoiceDetailText, { color: theme.textSecondary }]} numberOfLines={1}>
                                  联系电话：{item.invoice_phone || '-'}
                                </Text>
                                <TouchableOpacity onPress={() => { void copyInvoiceText(item.invoice_phone || '', `${item.id}:phone`); }}>
                                  {copiedInvoiceKey === `${item.id}:phone` ? <Check size={14} color={theme.blue} /> : <Copy size={14} color={theme.textSecondary} />}
                                </TouchableOpacity>
                              </View>

                              <View style={styles.invoiceDetailRow}>
                                <Text style={[styles.distributorSubText, styles.invoiceDetailText, { color: theme.textSecondary }]} numberOfLines={1}>
                                  开票地址：{item.invoice_address || '-'}
                                </Text>
                                <TouchableOpacity onPress={() => { void copyInvoiceText(item.invoice_address || '', `${item.id}:address`); }}>
                                  {copiedInvoiceKey === `${item.id}:address` ? <Check size={14} color={theme.blue} /> : <Copy size={14} color={theme.textSecondary} />}
                                </TouchableOpacity>
                              </View>
                            </View>
                          ) : null}
                        </View>
                      ) : null}
                    </View>
                    <View style={styles.cityActionsRow}>
                      {isSuperAdmin && (
                        <>
                          <TouchableOpacity onPress={() => openEditStore(item)} style={{ marginRight: 15 }}>
                            <Text style={styles.closeButton}>编辑</Text>
                          </TouchableOpacity>
                          {item.status === 'active' && (
                            <TouchableOpacity onPress={() => handleDeactivateStore(item.id, item.name)}>
                              <Text style={styles.deleteCityText}>停用</Text>
                            </TouchableOpacity>
                          )}
                          {item.status === 'inactive' && (
                            <TouchableOpacity onPress={() => handleActivateStore(item.id, item.name)} style={{ marginRight: 12 }}>
                              <Text style={[styles.closeButton, { color: theme.blue }]}>启用</Text>
                            </TouchableOpacity>
                          )}
                          <TouchableOpacity onPress={() => handleDeleteStore(item.id, item.name)}>
                            <Text style={styles.deleteCityText}>删除</Text>
                          </TouchableOpacity>
                        </>
                      )}
                    </View>
                  </View>
                )}
                ListEmptyComponent={<Text style={[styles.emptyCityText, { color: theme.textTertiary }]}>暂无店铺</Text>}
                style={styles.cityList}
                contentContainerStyle={stores.length === 0 ? styles.cityListEmptyContent : undefined}
              />
            )}
          </View>
          </KeyboardAvoidingView>
        </View>
      </Modal>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  scrollContent: { paddingBottom: 40 },
  profileCardGradient: {
    alignItems: 'center',
    paddingTop: 40,
    paddingBottom: 28,
    marginBottom: 10,
  },
  avatarRing: {
    width: 96,
    height: 96,
    borderRadius: 48,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.35)',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 14,
    position: 'relative',
    overflow: 'hidden',
    ...Shadow.elevated,
  },
  avatarHalo: {
    position: 'absolute',
    top: 8,
    left: 10,
    width: 52,
    height: 24,
    borderRadius: 14,
    backgroundColor: 'rgba(255,255,255,0.22)',
    transform: [{ rotate: '-12deg' }],
  },
  avatar: {
    width: 84,
    height: 84,
    borderRadius: 42,
    backgroundColor: 'rgba(255,255,255,0.4)',
    justifyContent: 'center',
    alignItems: 'center',
    overflow: 'hidden',
  },
  avatarImage: {
    width: '100%',
    height: '100%',
    borderRadius: 40,
  },
  avatarText: { fontSize: 32, color: '#fff', fontWeight: '800' },
  avatarEmojiText: { fontSize: 38 },
  avatarActionButton: {
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.35)',
    borderRadius: Radius.xl,
    marginBottom: 10,
    overflow: 'hidden',
    ...Shadow.soft,
  },
  avatarActionGradient: {
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  avatarActionText: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '600',
  },
  emailWhite: { fontSize: 16, color: '#fff', marginBottom: 6, fontWeight: '600' },
  subInfoWhite: { fontSize: 13, color: 'rgba(255,255,255,0.8)', marginBottom: 8 },
  roleBadgeWhite: {
    backgroundColor: 'rgba(255,255,255,0.25)',
    paddingHorizontal: 18,
    paddingVertical: 5,
    borderRadius: Radius.xl,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.4)',
  },
  roleTextWhite: { color: '#fff', fontWeight: '600', fontSize: 13 },
  menu: { backgroundColor: Colors.surface, marginBottom: 20 },
  menuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: Colors.divider,
  },
  menuItemLast: { borderBottomWidth: 0 },
  menuIcon: { marginRight: 15, justifyContent: 'center', alignItems: 'center' },
  menuText: { fontSize: 16, color: Colors.textPrimary, flex: 1 },
  menuArrow: { fontSize: 20, color: Colors.textTertiary, fontWeight: '300' },
  badge: {
    backgroundColor: Colors.danger,
    borderRadius: 10,
    minWidth: 20,
    height: 20,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 5,
    marginRight: 8,
  },
  badgeText: { color: '#fff', fontSize: 11, fontWeight: '700' },
  logoutButton: {
    backgroundColor: Colors.surface,
    marginHorizontal: 15,
    padding: 15,
    alignItems: 'center',
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: Colors.danger,
  },
  logoutText: { fontSize: 16, color: Colors.danger, fontWeight: '600' },
  version: { textAlign: 'center', color: Colors.textTertiary, marginTop: 20, fontSize: 12 },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(18,18,26,0.52)', justifyContent: 'flex-end' },
  keyboardAvoidingWrapper: { width: '100%', flex: 1, justifyContent: 'flex-end' },
  modalContent: {
    backgroundColor: Colors.surface,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    padding: 20,
    maxHeight: '75%',
  },
  managementModalContent: {
    maxHeight: '90%',
    minHeight: '78%',
  },
  storeModalContent: {
    maxHeight: '90%',
    minHeight: '78%',
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 20,
  },
  modalTitle: { fontSize: 22, fontWeight: '700', color: Colors.textPrimary },
  closeButton: { fontSize: 16, fontWeight: '500' },
  modalOverlayTouch: { ...StyleSheet.absoluteFillObject },
  avatarModalContent: {
    backgroundColor: Colors.surface,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    paddingHorizontal: 16,
    paddingTop: 18,
    paddingBottom: 14,
    maxHeight: '74%',
  },
  avatarModalHint: {
    fontSize: 12,
    marginBottom: 10,
  },
  // --- personal info ---
  infoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: Colors.divider,
  },
  infoLabel: { fontSize: 15, color: Colors.textSecondary },
  infoValue: { fontSize: 15, color: Colors.textPrimary, fontWeight: '500' },
  editSectionLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: Colors.textPrimary,
    marginTop: 16,
    marginBottom: 8,
  },
  storeNameInput: {
    height: 48,
    borderWidth: 0,
    borderRadius: Radius.lg,
    paddingHorizontal: 16,
    fontSize: 16,
    backgroundColor: Colors.surfaceSecondary,
    color: Colors.textPrimary,
    alignSelf: 'stretch' as const,
  },
  saveOwnBtn: {
    marginTop: 10,
    backgroundColor: Colors.pink,
    borderRadius: Radius.md,
    height: 44,
    justifyContent: 'center',
    alignItems: 'center',
  },
  saveOwnBtnText: { color: '#fff', fontSize: 15, fontWeight: '600' },
  disabledBtn: { opacity: 0.6 },
  // --- notifications ---
  notifRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: Colors.divider,
  },
  notifUnread: { backgroundColor: Colors.pinkBg },
  notifIcon: { width: 36, height: 36, borderRadius: 18, backgroundColor: Colors.surfaceSecondary, justifyContent: 'center', alignItems: 'center', marginRight: 10 },
  notifContent: { flex: 1 },
  notifMessage: { fontSize: 14, color: Colors.textPrimary },
  notifTime: { fontSize: 11, color: Colors.textTertiary, marginTop: 2 },
  acceptBtn: {
    backgroundColor: Colors.success,
    borderRadius: Radius.sm,
    paddingHorizontal: 12,
    paddingVertical: 6,
    marginLeft: 8,
  },
  acceptBtnText: { color: '#fff', fontSize: 12, fontWeight: '700' },
  acceptedBadge: {
    backgroundColor: Colors.successBg,
    borderRadius: Radius.sm,
    paddingHorizontal: 10,
    paddingVertical: 4,
    marginLeft: 8,
  },
  acceptedBadgeText: { color: Colors.success, fontSize: 11, fontWeight: '600' },
  // --- city & distributor management ---
  addCityRow: { flexDirection: 'row', marginBottom: 15 },
  cityInput: {
    flex: 1,
    height: 48,
    borderWidth: 0,
    borderRadius: Radius.lg,
    paddingHorizontal: 16,
    fontSize: 16,
    lineHeight: 20,
    paddingVertical: 0,
    includeFontPadding: false,
    textAlignVertical: 'center',
    marginRight: 10,
    backgroundColor: Colors.surfaceSecondary,
    color: Colors.textPrimary,
  },
  addCityButton: { width: 70, height: 48, justifyContent: 'center', alignItems: 'center', borderRadius: Radius.md },
  addCityButtonText: { color: '#fff', fontWeight: '600', fontSize: 16 },
  cityList: { flex: 1 },
  cityListContent: { paddingBottom: Spacing.xxxl },
  notificationListContent: { paddingBottom: Spacing.xxl },
  cityListEmptyContent: { flexGrow: 1, justifyContent: 'center' },
  storeEditorScroll: {
    maxHeight: 520,
  },
  storeEditorScrollContent: {
    paddingBottom: 10,
  },
  financeEditorScroll: {
    maxHeight: 520,
  },
  financeEditorScrollContent: {
    paddingBottom: 10,
  },
  financeOverviewCard: {
    paddingBottom: 14,
  },
  financeOverviewHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  financeOverviewTitleWrap: {
    flex: 1,
    marginRight: 12,
  },
  financeOverviewMeta: {
    fontSize: 12,
    color: Colors.textSecondary,
  },
  financeOverviewAmount: {
    fontSize: 28,
    fontWeight: '800',
    color: Colors.textPrimary,
    marginTop: 8,
  },
  financeOverviewHint: {
    fontSize: 12,
    color: Colors.textTertiary,
    marginTop: 6,
    marginBottom: 10,
  },
  financeBalanceInput: {
    height: 48,
    borderWidth: 0,
    borderRadius: Radius.lg,
    paddingHorizontal: 16,
    fontSize: 16,
    lineHeight: 20,
    paddingVertical: 0,
    includeFontPadding: false,
    textAlignVertical: 'center',
    marginTop: 2,
  },
  financeSectionTitle: {
    marginTop: 2,
    marginBottom: 10,
  },
  cityRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: Colors.divider,
  },
  cityActionsRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  invoiceBox: {
    marginTop: 8,
    borderWidth: 1,
    borderRadius: Radius.md,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  invoiceHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  invoiceToggleButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flex: 1,
  },
  invoiceTitleText: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.4,
  },
  invoiceCopyAllButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  invoiceCopyText: {
    fontSize: 11,
    fontWeight: '600',
  },
  invoiceDetailWrap: {
    marginTop: 6,
    gap: 6,
  },
  invoiceDetailRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  invoiceDetailText: {
    flex: 1,
  },
  citySortBtn: {
    width: 30,
    height: 30,
    borderRadius: 15,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: Colors.surfaceSecondary,
    marginRight: 6,
  },
  citySortBtnDisabled: {
    opacity: 0.5,
  },
  transactionRow: {
    alignItems: 'flex-start',
  },
  transactionHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  transactionTypeBadge: {
    borderRadius: Radius.sm,
    paddingHorizontal: 8,
    paddingVertical: 3,
    marginLeft: 8,
  },
  transactionTypeBadgeText: {
    fontSize: 11,
    fontWeight: '600',
  },
  transactionAmount: {
    fontSize: 16,
    fontWeight: '700',
    marginBottom: 2,
  },
  cityName: { fontSize: 16, color: Colors.textPrimary },
  deleteCityText: { fontSize: 14, color: Colors.danger, fontWeight: '500' },
  emptyCityText: { textAlign: 'center', color: Colors.textTertiary, paddingVertical: 20, fontSize: 14 },
  distributorSubText: { color: Colors.textSecondary, fontSize: 12, marginTop: 2 },
  editorBox: {
    backgroundColor: Colors.surfaceSecondary,
    borderRadius: Radius.md,
    padding: 12,
    marginBottom: 12,
  },
  editorTitle: { fontSize: 14, fontWeight: '700', color: Colors.textPrimary, marginBottom: 4 },
  editorHint: { fontSize: 12, color: Colors.textTertiary, marginBottom: 8 },
  cityChipsWrap: { marginBottom: 10 },
  cityChip: {
    backgroundColor: Colors.surface,
    borderRadius: Radius.md,
    paddingHorizontal: 10,
    paddingVertical: 6,
    marginRight: 8,
  },
  cityChipActive: { backgroundColor: Colors.pink },
  cityChipText: { fontSize: 12, color: Colors.textSecondary },
  cityChipTextActive: { color: '#fff', fontWeight: '600' },
  financeMultilineInput: {
    minHeight: 92,
    borderWidth: 0,
    borderRadius: Radius.lg,
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 12,
    fontSize: 16,
    marginBottom: 10,
  },
  editActions: { flexDirection: 'row', justifyContent: 'flex-end', marginTop: 8 },
  smallBtn: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: Radius.md,
    backgroundColor: Colors.surface,
    marginLeft: 8,
  },
  smallBtnPrimary: { backgroundColor: Colors.pink },
  smallBtnText: { color: Colors.textSecondary, fontSize: 12 },
  smallBtnPrimaryText: { color: '#fff', fontSize: 12, fontWeight: '600' },
  // --- about ---
  avatarGrid: {
    paddingTop: 4,
    paddingBottom: 12,
  },
  avatarOption: {
    flex: 1,
    alignItems: 'center',
    marginBottom: 12,
  },
  avatarOptionImage: {
    width: 62,
    height: 62,
    borderRadius: 31,
    borderWidth: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  avatarOptionEmoji: { fontSize: 30 },
  aboutContent: {
    alignItems: 'center',
    paddingVertical: 30,
  },
  logoGradient: {
    width: 80,
    height: 80,
    borderRadius: 20,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 20,
  },
  aboutAppTitle: {
    fontSize: 18,
    fontWeight: '700',
    marginBottom: 8,
  },
  aboutVersion: {
    fontSize: 14,
    marginBottom: 24,
  },
  devBox: {
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: Radius.md,
    marginBottom: 30,
  },
  devText: {
    fontSize: 14,
    fontWeight: '600',
  },
  aboutCopyright: {
    fontSize: 12,
  },
});
