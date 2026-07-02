import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Alert,
  Modal,
  DimensionValue,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import * as Sharing from 'expo-sharing';
import * as FileSystem from 'expo-file-system/legacy';
import * as XLSX from 'xlsx-js-style';
import { useShallow } from 'zustand/react/shallow';
import { BarChart3, TrendingUp, AlertTriangle } from 'lucide-react-native';
import { BarChart, PieChart, LineChart } from 'react-native-gifted-charts';
import Toast from 'react-native-toast-message';

import { useAppStore } from '../store/useAppStore';
import { useFinanceStore } from '../store/useFinanceStore';
import ProvinceCityFilter from '../components/ProvinceCityFilter';
import { Colors, Shadow, Radius, LightColors, DarkColors } from '../theme';
import { buildMonthDateRange, buildMonthOptions } from '../utils/reportsMonth';
import { getProvinceForCity } from '../utils/provinceMapping';
import type { City, FinanceReportType } from '../types';

type ReportType = FinanceReportType;

type SheetCellValue = string | number | null;
type SheetRow = Array<SheetCellValue>;

const createStyledWorksheet = (headers: string[], rows: SheetRow[]): XLSX.WorkSheet => {
  const allRows = [headers, ...rows];
  const worksheet = XLSX.utils.aoa_to_sheet(allRows);
  const range = XLSX.utils.decode_range(worksheet['!ref'] || 'A1:A1');

  for (let rowIndex = range.s.r; rowIndex <= range.e.r; rowIndex += 1) {
    for (let colIndex = range.s.c; colIndex <= range.e.c; colIndex += 1) {
      const cellAddress = XLSX.utils.encode_cell({ r: rowIndex, c: colIndex });
      const cell = worksheet[cellAddress] || { t: 's', v: '' };
      cell.s = { alignment: { horizontal: 'center', vertical: 'center' } };
      worksheet[cellAddress] = cell;
    }
  }

  worksheet['!cols'] = headers.map((header, index) => {
    let maxLen = header.length * 2;
    rows.forEach((row) => {
      const len = String(row[index] ?? '').length;
      if (len > maxLen) maxLen = len;
    });
    return { wch: Math.max(maxLen + 2, 10) };
  });

  return worksheet;
};

const appendStyledSheet = (workbook: XLSX.WorkBook, sheetName: string, headers: string[], rows: SheetRow[]): void => {
  const worksheet = createStyledWorksheet(headers, rows);
  XLSX.utils.book_append_sheet(workbook, worksheet, sheetName);
};

const shareStyledWorkbook = async (workbook: XLSX.WorkBook, filename: string): Promise<void> => {
  const workbookBase64 = XLSX.write(workbook, { bookType: 'xlsx', type: 'base64', cellStyles: true });
  const uri = `${FileSystem.cacheDirectory}${filename}`;
  await FileSystem.writeAsStringAsync(uri, workbookBase64, { encoding: FileSystem.EncodingType.Base64 });
  await Sharing.shareAsync(uri, {
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
};

const isShareCancelledError = (error: unknown): boolean => {
  const message = error instanceof Error ? error.message.toLowerCase() : String(error || '').toLowerCase();
  return message.includes('cancel')
    || message.includes('dismiss')
    || message.includes('did not share')
    || message.includes('didn\'t share');
};

const CHART_COLORS = ['#FF6B9D', '#5B8DEF', '#C77DFF', '#4ECDC4', '#FFB347'];

export default function ReportsScreen() {
  const {
    user,
    products,
    orders,
    stores,
    storeInventory,
    fetchProducts,
    fetchOrders,
    fetchStores,
    fetchStoreInventory,
    fetchAllStoreInventory,
    generateCityChannelReport,
    generateProductDetailReport,
    generatePaymentReport,
    createSlowMovingAlertNotification,
  } = useAppStore(
    useShallow((state) => ({
      user: state.user,
      products: state.products,
      orders: state.orders,
      stores: state.stores,
      storeInventory: state.storeInventory,
      fetchProducts: state.fetchProducts,
      fetchOrders: state.fetchOrders,
      fetchStores: state.fetchStores,
      fetchStoreInventory: state.fetchStoreInventory,
      fetchAllStoreInventory: state.fetchAllStoreInventory,
      generateCityChannelReport: state.generateCityChannelReport,
      generateProductDetailReport: state.generateProductDetailReport,
      generatePaymentReport: state.generatePaymentReport,
      createSlowMovingAlertNotification: state.createSlowMovingAlertNotification,
    })),
  );
  const { transactions, fetchTransactions, balance, fetchBalance } = useFinanceStore(
    useShallow((state) => ({
      transactions: state.transactions,
      fetchTransactions: state.fetchTransactions,
      balance: state.balance,
      fetchBalance: state.fetchBalance,
    }))
  );
  const [reportType, setReportType] = useState<ReportType>(user?.role === 'distributor' ? 'supply' : 'finance');
  const isDarkMode = useAppStore((state) => state.isDarkMode);
  const theme = isDarkMode ? DarkColors : LightColors;

  const isDistributor = user?.role === 'distributor';
  const isAdminOrManager = user?.role === 'admin' || user?.role === 'super_admin' || user?.role === 'inventory_manager';
  const reportTabs = useMemo<Array<{ key: ReportType; label: string }>>(() => {
    if (isDistributor) {
      return [
        { key: 'supply', label: '供货统计' },
        { key: 'sales', label: '销售报表' },
      ];
    }

    return [
      { key: 'finance', label: '财务报表' },
      { key: 'inventory_turnover', label: '库存周转' },
      { key: 'revenue', label: '营收报表' },
      { key: 'supply', label: '供货统计' },
    ];
  }, [isDistributor]);

  const [filterModalVisible, setFilterModalVisible] = useState(false);
  const [selectedProvinceId, setSelectedProvinceId] = useState<string | null>(null);
  const [selectedCityId, setSelectedCityId] = useState<string | null>(null);
  const [selectedStoreId, setSelectedStoreId] = useState<string | null>(null);
  const [selectedMonth, setSelectedMonth] = useState<string>('all');
  const [allModeMonthOptions, setAllModeMonthOptions] = useState<string[]>([]);
  const [floatingProductName, setFloatingProductName] = useState('');
  const exportLocks = useRef({ profitExcel: false, profitPdf: false, business: false });
  const slowMovingAlertScopeRef = useRef<string | null>(null);
  const slowMovingAlertTriggeredRef = useRef(false);

  const getOrderCityKey = (order: { city_id?: string | null; city_name?: string | null }): string => {
    if (order.city_id) return order.city_id;
    const fallbackName = String(order.city_name || '').trim();
    return fallbackName ? `name:${fallbackName}` : '';
  };

  const activeStores = useMemo(() => stores.filter((store) => store.status === 'active'), [stores]);
  const reportCities = useMemo<City[]>(() => {
    const cityMap = new Map<string, { id: string; name: string; province: string | null }>();
    activeStores.forEach((store) => {
      if (!cityMap.has(store.city_id)) {
        const cityName = store.city_name || '未知城市';
        cityMap.set(store.city_id, {
          id: store.city_id,
          name: cityName,
          province: getProvinceForCity(cityName),
        });
      }
    });

    orders.forEach((order) => {
      const cityKey = getOrderCityKey(order);
      if (!cityKey || cityMap.has(cityKey)) return;
      const cityName = String(order.city_name || '').trim() || '未知城市';
      cityMap.set(cityKey, {
        id: cityKey,
        name: cityName,
        province: getProvinceForCity(cityName),
      });
    });

    return Array.from(cityMap.values()).map((city) => ({
      id: city.id,
      name: city.name,
      province: city.province || undefined,
      created_at: '',
    }));
  }, [activeStores, orders]);

  const reportCityProvinceMap = useMemo(() => {
    const map = new Map<string, string | null>();
    reportCities.forEach((city) => {
      map.set(city.id, city.province || null);
    });
    return map;
  }, [reportCities]);

  const filteredStores = useMemo(() => {
    const storesByProvince = selectedProvinceId
      ? activeStores.filter((store) => {
          const province = reportCityProvinceMap.get(store.city_id) || getProvinceForCity(store.city_name || '');
          return selectedProvinceId === '未知省份' ? !province : province === selectedProvinceId;
        })
      : activeStores;

    if (!selectedCityId) return storesByProvince;
    if (selectedCityId.startsWith('name:')) return [];
    return storesByProvince.filter((store) => store.city_id === selectedCityId);
  }, [activeStores, reportCityProvinceMap, selectedCityId, selectedProvinceId]);
  const selectedReportStore = useMemo(
    () => activeStores.find((store) => store.id === selectedStoreId) || null,
    [activeStores, selectedStoreId],
  );
  const slowMovingAlertScopeLabel = useMemo(() => {
    const scopeParts: string[] = [];
    if (selectedProvinceId) {
      scopeParts.push(selectedProvinceId);
    }
    if (selectedCityId) {
      const cityName = selectedCityId.startsWith('name:')
        ? selectedCityId.replace('name:', '')
        : reportCities.find((city) => city.id === selectedCityId)?.name || '未知城市';
      scopeParts.push(cityName);
    }
    if (selectedReportStore?.name) {
      scopeParts.push(selectedReportStore.name);
    }
    if (selectedMonth !== 'all') {
      scopeParts.push(`${selectedMonth} 月`);
    }
    return scopeParts.length > 0 ? scopeParts.join(' / ') : '全部范围';
  }, [reportCities, selectedCityId, selectedMonth, selectedProvinceId, selectedReportStore]);
  const monthOptions = useMemo(() => {
    const runtimeOptions = buildMonthOptions(orders);
    if (allModeMonthOptions.length === 0) {
      return runtimeOptions;
    }

    const merged = new Set<string>([...allModeMonthOptions, ...runtimeOptions]);
    const sortedMonths = Array.from(merged)
      .filter((monthOption) => monthOption !== 'all')
      .sort((a, b) => (a > b ? -1 : 1));

    return ['all', ...sortedMonths];
  }, [allModeMonthOptions, orders]);

  useEffect(() => {
    if (selectedMonth !== 'all') return;
    setAllModeMonthOptions(buildMonthOptions(orders));
  }, [orders, selectedMonth]);

  const showFullProductName = (name: string) => {
    const normalized = String(name || '').trim();
    if (!normalized) {
      Alert.alert('商品全称', '暂无商品名称');
      return;
    }
    setFloatingProductName(normalized);
  };

  useEffect(() => {
    if (!floatingProductName) return;
    const timer = setTimeout(() => setFloatingProductName(''), 2200);
    return () => clearTimeout(timer);
  }, [floatingProductName]);

  useEffect(() => {
    fetchProducts();
    fetchStores();
    fetchTransactions();
    fetchBalance();
  }, [fetchProducts, fetchStores, fetchTransactions, fetchBalance]);

  useEffect(() => {
    if (selectedMonth === 'all') {
      fetchOrders();
      return;
    }

    const monthRange = buildMonthDateRange(selectedMonth);
    if (!monthRange) {
      fetchOrders();
      return;
    }

    fetchOrders(monthRange.startDate, monthRange.endDate);
  }, [fetchOrders, selectedMonth]);

  useEffect(() => {
    if (selectedStoreId) {
      fetchStoreInventory(selectedStoreId);
    }
  }, [selectedStoreId, fetchStoreInventory]);

  useEffect(() => {
    if (reportTabs.some((item) => item.key === reportType)) {
      return;
    }

    setReportType(reportTabs[0]?.key || 'sales');
  }, [reportTabs, reportType]);

  useEffect(() => {
    if (!selectedStoreId) return;
    const stillVisible = filteredStores.some((store) => store.id === selectedStoreId);
    if (!stillVisible) {
      setSelectedStoreId(null);
    }
  }, [filteredStores, selectedStoreId]);

  const filteredOrders = useMemo(() => {
    let list = [...orders];
    if (selectedProvinceId) {
      list = list.filter((order) => {
        const province = reportCityProvinceMap.get(order.city_id || '') || getProvinceForCity(order.city_name || '');
        return selectedProvinceId === '未知省份' ? !province : province === selectedProvinceId;
      });
    }
    if (selectedCityId) {
      list = list.filter((order) => getOrderCityKey(order) === selectedCityId);
    }
    if (selectedStoreId) {
      list = list.filter((order) => order.store_id === selectedStoreId);
    }
    return list;
  }, [orders, reportCityProvinceMap, selectedCityId, selectedProvinceId, selectedStoreId]);

  const activeFilterCount = useMemo(() => {
    let count = 0;
    if (selectedProvinceId) count += 1;
    if (selectedCityId) count += 1;
    if (selectedStoreId) count += 1;
    if (selectedMonth !== 'all') count += 1;
    if (reportType !== (isDistributor ? 'supply' : 'finance')) count += 1;
    return count;
  }, [isDistributor, reportType, selectedCityId, selectedMonth, selectedProvinceId, selectedStoreId]);

  const reportTypeLabel = useMemo(() => {
    if (reportType === 'sales') return '销售报表';
    if (reportType === 'revenue') return '营收报表';
    if (reportType === 'supply') return '供货统计';
    if (reportType === 'inventory_turnover') return '库存周转';
    if (reportType === 'finance') return '财务报表';
    return '销售报表';
  }, [reportType]);

  const isRefundLikeOrder = (order: { payment_status?: string | null; refunded_items?: unknown }): boolean => {
    const paymentStatus = String(order.payment_status || '').toLowerCase();
    if (paymentStatus.includes('refund')) return true;
    const refundedItems = Array.isArray(order.refunded_items) ? order.refunded_items : [];
    return refundedItems.length > 0;
  };

  const revenueScopedOrders = useMemo(
    () =>
      filteredOrders.filter((order) => {
        const isRevenueKind = order.order_kind === 'settlement' || order.order_kind === 'retail';
        if (!isRevenueKind) return false;
        return !isRefundLikeOrder(order);
      }),
    [filteredOrders],
  );

  const salesData = useMemo(() => {
    const totalRetailSales = revenueScopedOrders.reduce((sum, o) => sum + Number(o.total_retail_amount || 0), 0);
    const totalOrders = revenueScopedOrders.length;

    const productSalesQty: { [key: string]: { name: string; quantity: number } } = {};
    const productSalesAmt: { [key: string]: { name: string; amount: number } } = {};
    revenueScopedOrders.forEach((order) => {
      order.items.forEach((it) => {
        if (it.is_sample) return;
        const name = it.product_name || '未知';
        const key = it.product_id;
        // Quantity
        if (!productSalesQty[key]) {
          productSalesQty[key] = { name, quantity: 0 };
        }
        productSalesQty[key].quantity += it.quantity;
        // Amount
        if (!productSalesAmt[key]) {
          productSalesAmt[key] = { name, amount: 0 };
        }
        productSalesAmt[key].amount += Number(it.discount_price || 0) * it.quantity;
      });
    });

    const topProductsQty = Object.values(productSalesQty)
      .map((item) => ({ name: item.name, quantity: item.quantity }))
      .sort((a, b) => b.quantity - a.quantity)
      .slice(0, 5);

    const topProductsAmt = Object.values(productSalesAmt)
      .map((item) => ({ name: item.name, amount: item.amount }))
      .sort((a, b) => b.amount - a.amount)
      .slice(0, 5);

    // Calculate velocity (turnover rate) = sales quantity / current inventory
    const productVelocity: { [key: string]: { name: string; velocity: number; quantity: number; inventory: number } } = {};
    
    if (selectedStoreId) {
      storeInventory.forEach((p) => {
        const key = p.product_id;
        const qty = productSalesQty[key]?.quantity || 0;
        const inventory = p.quantity || 0;
        const velocity = inventory > 0 ? qty / inventory : 0;
        productVelocity[key] = {
          name: p.product_name || '未知',
          velocity,
          quantity: qty,
          inventory,
        };
      });
    } else {
      products.forEach((p) => {
        const key = p.id;
        const qty = productSalesQty[key]?.quantity || 0;
        const inventory = p.quantity || 0;
        const velocity = inventory > 0 ? qty / inventory : 0;
        productVelocity[key] = {
          name: p.name,
          velocity,
          quantity: qty,
          inventory,
        };
      });
    }

    const topProductsVelocity = Object.values(productVelocity)
      .map((item) => ({ 
        name: item.name, 
        velocity: item.velocity,
        quantity: item.quantity,
        inventory: item.inventory,
        isUnhealthy: item.velocity < 0.5, // Less than 0.5 means slow turnover
      }))
      .sort((a, b) => b.velocity - a.velocity)
      .slice(0, 5);

    const citySales: { [key: string]: number } = {};
    const storeSales: { [key: string]: number } = {};
    
    revenueScopedOrders.forEach((order) => {
      const city = order.city_name || '未知';
      citySales[city] = (citySales[city] || 0) + Number(order.total_discount_amount || 0);
      
      const storeName = order.store_name || '未知店铺/历史订单';
      storeSales[storeName] = (storeSales[storeName] || 0) + Number(order.total_discount_amount || 0);
    });

    const salesByCity = Object.entries(citySales)
      .map(([city, total]) => ({ city, total }))
      .sort((a, b) => b.total - a.total);
      
    const salesByStore = Object.entries(storeSales)
      .map(([store, total]) => ({ store, total }))
      .sort((a, b) => b.total - a.total);

    return { totalRetailSales, totalOrders, topProductsQty, topProductsAmt, topProductsVelocity, salesByCity, salesByStore };
  }, [products, revenueScopedOrders, selectedStoreId, storeInventory]);

  const supplyData = useMemo(() => {
    const supplyOrders = filteredOrders.filter((order) => order.order_kind === 'distribution');
    const totalSupplyOrders = supplyOrders.length;

    const productSupplyQty: { [key: string]: { name: string; quantity: number } } = {};
    const storeSupplyQty: { [key: string]: number } = {};
    let totalSupplyQuantity = 0;

    supplyOrders.forEach((order) => {
      const storeKey = order.store_name || '未知店铺/历史订单';
      const orderQty = order.items.reduce((sum, item) => sum + Number(item.quantity || 0), 0);
      storeSupplyQty[storeKey] = (storeSupplyQty[storeKey] || 0) + orderQty;

      order.items.forEach((item) => {
        if (item.is_sample) return;
        const productKey = item.product_id;
        const productName = item.product_name || '未知';
        const quantity = Number(item.quantity || 0);
        if (!productSupplyQty[productKey]) {
          productSupplyQty[productKey] = { name: productName, quantity: 0 };
        }
        productSupplyQty[productKey].quantity += quantity;
        totalSupplyQuantity += quantity;
      });
    });

    const topProducts = Object.values(productSupplyQty)
      .sort((a, b) => b.quantity - a.quantity)
      .slice(0, 8);

    const byStore = Object.entries(storeSupplyQty)
      .map(([store, quantity]) => ({ store, quantity }))
      .sort((a, b) => b.quantity - a.quantity)
      .slice(0, 8);

    return {
      totalSupplyOrders,
      totalSupplyQuantity,
      topProducts,
      byStore,
    };
  }, [filteredOrders]);

  const inventoryData = useMemo(() => {
    if (selectedStoreId) {
      const totalProducts = storeInventory.length;
      const totalQuantity = storeInventory.reduce((sum, item) => sum + (item.quantity || 0), 0);
      const lowStockItems = storeInventory.filter(item => {
         const globalProduct = products.find(p => p.id === item.product_id);
         const minQty = globalProduct?.min_quantity ?? 10;
         return (item.quantity || 0) < minQty;
      });
      return { totalProducts, totalQuantity, lowStockItems, inventoryByCity: [], isStore: true };
    }

    const totalProducts = products.length;
    const totalQuantity = products.reduce((sum, p) => sum + (p.quantity || 0), 0);
    const lowStockItems = products.filter(
      (p) => p.quantity !== undefined && p.quantity < (p.min_quantity ?? 10),
    );

    const cityInventory: { [key: string]: number } = {};
    products.forEach((p) => {
      const city = p.city_name || '未知';
      cityInventory[city] = (cityInventory[city] || 0) + (p.quantity || 0);
    });

    const inventoryByCity = Object.entries(cityInventory)
      .map(([city, quantity]) => ({ city, quantity }))
      .sort((a, b) => b.quantity - a.quantity);

    return { totalProducts, totalQuantity, lowStockItems, inventoryByCity, isStore: false };
  }, [products, storeInventory, selectedStoreId]);

  const turnoverData = useMemo(() => {
    const soldOrders = filteredOrders.filter((order) => {
      const isTurnoverKind = order.order_kind === 'retail' || order.order_kind === 'settlement';
      return isTurnoverKind && !isRefundLikeOrder(order);
    });
    
    const now = Date.now();
    const threeMonthsAgo = now - 90 * 24 * 60 * 60 * 1000;
    const recentSalesQty: Record<string, number> = {};
    const totalSalesQty: Record<string, number> = {};

    let periodDays = 30;
    if (selectedMonth !== 'all') {
      const [year, month] = selectedMonth.split('-');
      periodDays = new Date(Number(year), Number(month), 0).getDate();
    } else if (soldOrders.length > 0) {
      const earliest = Math.min(...soldOrders.map((order) => new Date(order.created_at).getTime()));
      const latest = Math.max(...soldOrders.map((order) => new Date(order.created_at).getTime()));
      periodDays = Math.max(1, Math.ceil((latest - earliest) / (1000 * 60 * 60 * 24)));
    }

    soldOrders.forEach((order) => {
      const soldAt = new Date(order.created_at).getTime();
      if (!Number.isFinite(soldAt)) return;
      order.items.forEach((item) => {
        if (item.is_sample || Number(item.quantity || 0) <= 0) return;
        const quantity = Number(item.quantity || 0);
        totalSalesQty[item.product_id] = (totalSalesQty[item.product_id] || 0) + quantity;
        if (soldAt >= threeMonthsAgo) {
          recentSalesQty[item.product_id] = (recentSalesQty[item.product_id] || 0) + quantity;
        }
      });
    });

    const cityNameByKey = new Map<string, string>();
    reportCities.forEach((city) => cityNameByKey.set(city.id, city.name));

    const getStoreCityName = (store: { city_id: string; city_name?: string | null }): string => (
      store.city_name || cityNameByKey.get(store.city_id) || '未知城市'
    );

    const scopedStoreIds = new Set(
      filteredStores.map((store) => store.id),
    );

    const isYunchuangStoreSelected = Boolean(selectedStoreId && (selectedReportStore?.name || '').includes('云窗'));

    const scopedYunchuangStoreIds = new Set(
      filteredStores
        .filter((store) => scopedStoreIds.has(store.id))
        .filter((store) => {
          const cityName = getStoreCityName(store);
          return cityName.includes('郴州') && store.name.includes('云窗');
        })
        .map((store) => store.id),
    );

    const storeInventoryQtyByProduct: Record<string, number> = {};
    storeInventory.forEach((item) => {
      if (!scopedStoreIds.has(item.store_id)) return;
      storeInventoryQtyByProduct[item.product_id] = (storeInventoryQtyByProduct[item.product_id] || 0) + Number(item.quantity || 0);
    });

    const yunchuangStoreQtyByProduct: Record<string, number> = {};
    storeInventory.forEach((item) => {
      if (!scopedYunchuangStoreIds.has(item.store_id)) return;
      yunchuangStoreQtyByProduct[item.product_id] = (yunchuangStoreQtyByProduct[item.product_id] || 0) + Number(item.quantity || 0);
    });

    const useWarehouseScope = !selectedStoreId || isYunchuangStoreSelected;
    const warehouseQtyByProduct: Record<string, number> = {};
    if (useWarehouseScope) {
      products.forEach((product) => {
        const cityKey = product.city_id || '';
        const cityName = product.city_name || cityNameByKey.get(cityKey) || '未知城市';
        const province = reportCityProvinceMap.get(cityKey) || getProvinceForCity(cityName);

        const cityInScope = selectedCityId
          ? (selectedCityId.startsWith('name:')
              ? cityName === selectedCityId.replace('name:', '')
              : cityKey === selectedCityId)
          : true;

        const provinceInScope = selectedProvinceId
          ? (selectedProvinceId === '未知省份' ? !province : province === selectedProvinceId)
          : true;

        const yunchuangStoreScopePass = !isYunchuangStoreSelected || cityName.includes('郴州');

        if (!cityInScope || !provinceInScope || !yunchuangStoreScopePass) return;
        warehouseQtyByProduct[product.id] = Number(product.quantity || 0);
      });
    }

    const productTurnover: { [key: string]: { name: string; turnoverDays: number; isSlow: boolean; cost: number; inventoryValue: number; seriesName: string; recentSales: number; totalSales: number; dailySales: number } } = {};

    const productIds = new Set<string>([
      ...products.map((product) => product.id),
      ...Object.keys(storeInventoryQtyByProduct),
      ...Object.keys(totalSalesQty),
    ]);

    const uniqueProducts = Array.from(productIds).map((productId) => {
      const globalProduct = products.find((item) => item.id === productId);
      const rawWarehouseQty = Number(warehouseQtyByProduct[productId] || 0);
      const scopedStoreQty = Number(storeInventoryQtyByProduct[productId] || 0);
      const yunchuangStoreQty = Number(yunchuangStoreQtyByProduct[productId] || 0);
      const dedupeQty = yunchuangStoreQty;

      let quantity = 0;
      if (selectedStoreId && !isYunchuangStoreSelected) {
        quantity = scopedStoreQty;
      } else {
        quantity = Math.max(rawWarehouseQty - dedupeQty, 0) + scopedStoreQty;
      }

      return {
        id: productId,
        name: globalProduct?.name || storeInventory.find((item) => item.product_id === productId)?.product_name || '未知',
        cost: Number(globalProduct?.cost || 0),
        quantity,
        seriesName: globalProduct?.series_name || '无系列',
      };
    });

    uniqueProducts.forEach((p) => {
      const totalSales = totalSalesQty[p.id] || 0;
      const dailySales = periodDays > 0 ? totalSales / periodDays : 0;
      const sellableDays = dailySales > 0 ? p.quantity / dailySales : Number.POSITIVE_INFINITY;
      const turnoverDays = Number.isFinite(sellableDays) ? Math.max(1, Math.round(sellableDays)) : 999;
      productTurnover[p.id] = {
        name: p.name,
        turnoverDays,
        isSlow: turnoverDays > 60,
        cost: p.cost,
        inventoryValue: p.cost * p.quantity,
        seriesName: p.seriesName,
        recentSales: recentSalesQty[p.id] || 0,
        totalSales,
        dailySales,
      };
    });

    const topTurnoverProducts = Object.values(productTurnover)
      .sort((a, b) => a.turnoverDays - b.turnoverDays)
      .slice(0, 5);

    const slowMovingProducts = Object.values(productTurnover)
      .filter((item) => item.isSlow)
      .sort((a, b) => b.turnoverDays - a.turnoverDays)
      .slice(0, 5);

    const validTurnovers = Object.values(productTurnover).filter(p => p.turnoverDays !== 999);
    const avgTurnoverDays = validTurnovers.length > 0 
      ? validTurnovers.reduce((sum, p) => sum + p.turnoverDays, 0) / validTurnovers.length 
      : 0;

    const seriesTurnoverMap: Record<string, { sum: number; count: number }> = {};
    validTurnovers.forEach(p => {
      if (!seriesTurnoverMap[p.seriesName]) {
        seriesTurnoverMap[p.seriesName] = { sum: 0, count: 0 };
      }
      seriesTurnoverMap[p.seriesName].sum += p.turnoverDays;
      seriesTurnoverMap[p.seriesName].count += 1;
    });
    const seriesAvgTurnover = Object.entries(seriesTurnoverMap).map(([name, data]) => ({
      name,
      avgDays: data.sum / data.count
    })).sort((a, b) => a.avgDays - b.avgDays);

    const sortedBySales = [...Object.values(productTurnover)].sort((a, b) => b.totalSales - a.totalSales);
    const top10PercentCount = Math.max(1, Math.ceil(sortedBySales.length * 0.1));

    let hotValue = 0;
    let slowValue = 0;
    let regularValue = 0;
    const hotValueCandidates: Array<{ name: string; inventoryValue: number }> = [];
    const slowValueCandidates: Array<{ name: string; inventoryValue: number }> = [];

    Object.entries(productTurnover).forEach(([_, p]) => {
      const isHot = sortedBySales.findIndex(sp => sp.name === p.name) < top10PercentCount && p.totalSales > 0;
      const isSlow = p.recentSales < 10;
      
      if (isHot) {
        hotValue += p.inventoryValue;
        hotValueCandidates.push({ name: p.name, inventoryValue: p.inventoryValue });
      } else if (isSlow) {
        slowValue += p.inventoryValue;
        slowValueCandidates.push({ name: p.name, inventoryValue: p.inventoryValue });
      } else {
        regularValue += p.inventoryValue;
      }
    });

    const totalInventoryValue = hotValue + slowValue + regularValue;
    const slowValueRatio = totalInventoryValue > 0 ? slowValue / totalInventoryValue : 0;
    const isSlowWarning = slowValueRatio > 0.15;
    const hotValueRanking = hotValueCandidates
      .sort((a, b) => b.inventoryValue - a.inventoryValue)
      .slice(0, 3);
    const slowValueRanking = slowValueCandidates
      .sort((a, b) => b.inventoryValue - a.inventoryValue)
      .slice(0, 3);

    const storeCityIdMap = new Map<string, string>();
    filteredStores.forEach((store) => {
      storeCityIdMap.set(store.id, store.city_id);
    });

    const cityInventorySkuMap = new Map<string, Set<string>>();
    products.forEach((product) => {
      if (Number(product.quantity || 0) <= 0) return;
      const cityKey = product.city_id || (product.city_name ? `name:${product.city_name}` : '');
      if (!cityKey) return;
      if (!cityInventorySkuMap.has(cityKey)) cityInventorySkuMap.set(cityKey, new Set<string>());
      cityInventorySkuMap.get(cityKey)!.add(product.id);
    });
    storeInventory.forEach((item) => {
      if (Number(item.quantity || 0) <= 0) return;
      const cityKey = storeCityIdMap.get(item.store_id);
      if (!cityKey) return;
      if (!cityInventorySkuMap.has(cityKey)) cityInventorySkuMap.set(cityKey, new Set<string>());
      cityInventorySkuMap.get(cityKey)!.add(item.product_id);
    });

    const provinceInventorySkuMap = new Map<string, Set<string>>();
    cityInventorySkuMap.forEach((skuSet, cityKey) => {
      const cityName = cityNameByKey.get(cityKey) || cityKey.replace('name:', '');
      const province = reportCityProvinceMap.get(cityKey) || getProvinceForCity(cityName) || '未知省份';
      if (!provinceInventorySkuMap.has(province)) provinceInventorySkuMap.set(province, new Set<string>());
      skuSet.forEach((sku) => provinceInventorySkuMap.get(province)!.add(sku));
    });

    const scopedSkuIds = new Set<string>();
    if (selectedStoreId) {
      if (isYunchuangStoreSelected) {
        uniqueProducts.forEach((product) => {
          if (Number(product.quantity || 0) > 0) {
            scopedSkuIds.add(product.id);
          }
        });
      } else {
        storeInventory.forEach((item) => {
          if (item.store_id === selectedStoreId && Number(item.quantity || 0) > 0) {
            scopedSkuIds.add(item.product_id);
          }
        });
      }
    } else if (selectedCityId) {
      (cityInventorySkuMap.get(selectedCityId) || new Set<string>()).forEach((skuId) => scopedSkuIds.add(skuId));
    } else if (selectedProvinceId) {
      (provinceInventorySkuMap.get(selectedProvinceId) || new Set<string>()).forEach((skuId) => scopedSkuIds.add(skuId));
    } else {
      uniqueProducts.forEach((product) => {
        if (Number(product.quantity || 0) > 0) {
          scopedSkuIds.add(product.id);
        }
      });
    }

    const scopedTotalSkuCount = scopedSkuIds.size;
    const scopedActiveSkuCount = Array.from(scopedSkuIds).filter((productId) => Number(totalSalesQty[productId] || 0) > 0).length;
    const scopedSellThroughRate = scopedTotalSkuCount > 0 ? scopedActiveSkuCount / scopedTotalSkuCount : 0;

    let drillDownData: { label: string; active: number; total: number; rate: number }[] = [];
    
    if (selectedStoreId) {
      drillDownData = uniqueProducts.map(p => {
        const salesQty = Number(totalSalesQty[p.id] || 0);
        const inventoryQty = Number(p.quantity || 0);
        const rate = inventoryQty > 0 ? salesQty / inventoryQty : 0;
        return { label: p.name, active: salesQty, total: inventoryQty, rate };
      }).sort((a, b) => b.rate - a.rate).slice(0, 10);
    } else if (selectedCityId) {
      const storesInCity = filteredStores.filter(s => s.city_id === selectedCityId);
      const cityScopedTotalSkus = uniqueProducts.filter((product) => Number(product.quantity || 0) > 0).length;
      drillDownData = storesInCity.map(store => {
        const storeOrders = soldOrders.filter(o => o.store_id === store.id);
        const storeActiveSkus = new Set();
        storeOrders.forEach(o => o.items.forEach(i => {
          if (!i.is_sample && Number(i.quantity || 0) > 0) storeActiveSkus.add(i.product_id);
        }));
        const isYunchuangStore = store.name.includes('云窗') && getStoreCityName(store).includes('郴州');
        const storeTotalSkus = isYunchuangStore
          ? cityScopedTotalSkus
          : storeInventory.filter(si => si.store_id === store.id && Number(si.quantity || 0) > 0).length;
        const rate = storeTotalSkus > 0 ? storeActiveSkus.size / storeTotalSkus : 0;
        return { label: store.name, active: storeActiveSkus.size, total: storeTotalSkus, rate };
      }).sort((a, b) => b.rate - a.rate);
    } else if (selectedProvinceId) {
      const citiesInProvince = reportCities.filter(c => (selectedProvinceId === '未知省份' ? !c.province : c.province === selectedProvinceId));
      drillDownData = citiesInProvince.map(city => {
        const cityOrders = soldOrders.filter(o => getOrderCityKey(o) === city.id);
        const cityActiveSkus = new Set();
        cityOrders.forEach(o => o.items.forEach(i => {
          if (!i.is_sample && Number(i.quantity || 0) > 0) cityActiveSkus.add(i.product_id);
        }));
        const cityTotalSkus = cityInventorySkuMap.get(city.id)?.size || 0;
        const rate = cityTotalSkus > 0 ? cityActiveSkus.size / cityTotalSkus : 0;
        return { label: city.name, active: cityActiveSkus.size, total: cityTotalSkus, rate };
      }).sort((a, b) => b.rate - a.rate);
    } else {
      const provinceMap = new Map<string, Set<string>>();
      soldOrders.forEach(o => {
        const cityKey = getOrderCityKey(o);
        const province = reportCityProvinceMap.get(cityKey) || getProvinceForCity(o.city_name || '') || '未知省份';
        if (!provinceMap.has(province)) provinceMap.set(province, new Set());
        o.items.forEach(i => {
          if (!i.is_sample && Number(i.quantity || 0) > 0) provinceMap.get(province)!.add(i.product_id);
        });
      });
      
      drillDownData = Array.from(provinceMap.entries()).map(([province, activeSkus]) => {
        const provinceTotalSkus = provinceInventorySkuMap.get(province)?.size || 0;
        const rate = provinceTotalSkus > 0 ? activeSkus.size / provinceTotalSkus : 0;
        return { label: province, active: activeSkus.size, total: provinceTotalSkus, rate };
      }).sort((a, b) => b.rate - a.rate);
    }

    return {
      topTurnoverProducts,
      slowMovingProducts,
      activeSkuCount: scopedActiveSkuCount,
      totalSkuCount: scopedTotalSkuCount,
      sellThroughRate: scopedSellThroughRate,
      avgTurnoverDays,
      seriesAvgTurnover,
      inventoryValuePie: [
        { name: '热销款', value: hotValue, color: '#FF6B9D' },
        { name: '常规款', value: regularValue, color: '#5B8DEF' },
        { name: '滞销款', value: slowValue, color: '#C77DFF' },
      ].filter(item => item.value > 0),
      hotValueRanking,
      slowValueRanking,
      isSlowWarning,
      slowInventoryValue: slowValue,
      slowValueRatio,
      totalInventoryValue,
      drillDownData,
      scatterData: Object.values(productTurnover).filter(p => p.turnoverDays !== 999).map(p => ({
        name: p.name,
        cost: p.cost,
        turnoverDays: p.turnoverDays,
        dailySales: p.dailySales,
      }))
    };
  }, [filteredOrders, filteredStores, isRefundLikeOrder, products, reportCities, reportCityProvinceMap, selectedCityId, selectedMonth, selectedProvinceId, selectedReportStore, selectedStoreId, storeInventory]);

  useEffect(() => {
    if (reportType !== 'inventory_turnover') {
      slowMovingAlertTriggeredRef.current = false;
      slowMovingAlertScopeRef.current = null;
      return;
    }
    if (!isAdminOrManager) return;
    if (slowMovingAlertTriggeredRef.current) return;
    slowMovingAlertTriggeredRef.current = true;
    if (!turnoverData.isSlowWarning || turnoverData.totalInventoryValue <= 0) return;

    slowMovingAlertScopeRef.current = '全部范围';
    void (async () => {
      const { error } = await createSlowMovingAlertNotification({
        scopeLabel: '全部范围',
        slowMovingRatio: turnoverData.slowValueRatio,
        slowMovingCost: turnoverData.slowInventoryValue,
        totalInventoryCost: turnoverData.totalInventoryValue,
      });
      if (error) {
        slowMovingAlertTriggeredRef.current = false;
        slowMovingAlertScopeRef.current = null;
      }
    })();
  }, [
    createSlowMovingAlertNotification,
    isAdminOrManager,
    reportType,
    turnoverData.isSlowWarning,
    turnoverData.slowInventoryValue,
    turnoverData.slowValueRatio,
    turnoverData.totalInventoryValue,
  ]);

  const profitData = useMemo(() => {
    const productProfit: {
      [key: string]: {
        name: string;
        quantity: number;
        retailPrice: number;
        retailRevenue: number;
        discountPrice: number;
        discountRevenue: number;
        unitCostTotal: number;
        sampleCostTotal: number;
        oneTimeCost: number;
      };
    } = {};

    revenueScopedOrders.forEach((order) => {
      order.items.forEach((it) => {
        const key = it.product_id;
        if (!productProfit[key]) {
          productProfit[key] = {
            name: it.product_name || '未知',
            quantity: 0,
            retailPrice: Number(it.retail_price || 0),
            retailRevenue: 0,
            discountPrice: Number(it.discount_price || 0),
            discountRevenue: 0,
            unitCostTotal: 0,
            sampleCostTotal: 0,
            oneTimeCost: Number(it.one_time_cost || 0),
          };
        }
        productProfit[key].quantity += it.quantity;
        if (it.is_sample) {
          productProfit[key].sampleCostTotal += it.quantity * Number(it.unit_cost || 0);
        } else {
          productProfit[key].retailRevenue += it.quantity * Number(it.retail_price || 0);
          productProfit[key].discountRevenue += it.quantity * Number(it.discount_price || 0);
          productProfit[key].unitCostTotal += it.quantity * Number(it.unit_cost || 0);
        }
        if (productProfit[key].oneTimeCost === 0) {
          productProfit[key].oneTimeCost = Number(it.one_time_cost || 0);
        }
      });
    });

    const profitByProduct = Object.values(productProfit)
      .map((v) => {
        const cost = v.unitCostTotal + v.sampleCostTotal + v.oneTimeCost;
        return {
          name: v.name,
          quantity: v.quantity,
          retailPrice: v.retailPrice,
          retailRevenue: v.retailRevenue,
          discountPrice: v.discountPrice,
          discountRevenue: v.discountRevenue,
          cost,
          profit: v.discountRevenue - cost,
        };
      })
      .sort((a, b) => b.profit - a.profit);

    const totalRetailRevenue = profitByProduct.reduce((s, r) => s + r.retailRevenue, 0);
    const totalDiscountRevenue = profitByProduct.reduce((s, r) => s + r.discountRevenue, 0);
    const totalCost = profitByProduct.reduce((s, r) => s + r.cost, 0);

    return {
      totalRetailRevenue,
      totalDiscountRevenue,
      totalCost,
      totalProfit: totalDiscountRevenue - totalCost,
      profitByProduct,
    };
  }, [revenueScopedOrders]);

  const revenueData = useMemo(() => {
    const totalRevenue = revenueScopedOrders.reduce((sum, o) => sum + Number(o.total_discount_amount || 0), 0);
    const totalOrders = revenueScopedOrders.length;

    const trendMap: { [key: string]: number } = {};
    const profitTrendMap: { [key: string]: { revenue: number; cost: number } } = {};
    const seenProductsForTrend = new Set<string>();
    revenueScopedOrders.forEach((order) => {
      const date = new Date(order.created_at);
      let key = '';
      if (selectedMonth === 'all') {
        key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
      } else {
        key = `${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
      }
      trendMap[key] = (trendMap[key] || 0) + Number(order.total_discount_amount || 0);

      if (!profitTrendMap[key]) {
        profitTrendMap[key] = { revenue: 0, cost: 0 };
      }
      
      order.items.forEach((it) => {
        const pKey = it.product_id;
        if (!it.is_sample) {
          profitTrendMap[key].revenue += it.quantity * Number(it.discount_price || 0);
          profitTrendMap[key].cost += it.quantity * Number(it.unit_cost || 0);
        } else {
          profitTrendMap[key].cost += it.quantity * Number(it.unit_cost || 0);
        }
        
        if (!seenProductsForTrend.has(pKey)) {
          seenProductsForTrend.add(pKey);
          profitTrendMap[key].cost += Number(it.one_time_cost || 0);
        }
      });
    });

    const trend = Object.entries(trendMap)
      .map(([label, value]) => ({ label, value }))
      .sort((a, b) => a.label.localeCompare(b.label));

    const profitTrend = Object.entries(profitTrendMap)
      .map(([label, data]) => {
        const profit = data.revenue - data.cost;
        const margin = data.revenue > 0 ? (profit / data.revenue) * 100 : 0;
        return { label, profit, margin };
      })
      .sort((a, b) => a.label.localeCompare(b.label));
    const storeMap: { [key: string]: number } = {};
    revenueScopedOrders.forEach((order) => {
      const storeName = order.store_name || '未知店铺/历史订单';
      storeMap[storeName] = (storeMap[storeName] || 0) + Number(order.total_discount_amount || 0);
    });

    const compositionByStore = Object.entries(storeMap)
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value);

    const cityMap: { [key: string]: number } = {};
    revenueScopedOrders.forEach((order) => {
      const cityName = order.city_name || '未知城市';
      cityMap[cityName] = (cityMap[cityName] || 0) + Number(order.total_discount_amount || 0);
    });

    const compositionByCity = Object.entries(cityMap)
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value);

    return {
      totalRevenue,
      totalOrders,
      trend,
      profitTrend,
      compositionByStore,
      compositionByCity,
    };
  }, [revenueScopedOrders, selectedMonth]);

  const financeData = useMemo(() => {
    let list = [...transactions];

    if (selectedMonth !== 'all') {
      const monthRange = buildMonthDateRange(selectedMonth);
      if (monthRange) {
        const start = new Date(monthRange.startDate).getTime();
        const end = new Date(monthRange.endDate).getTime();
        list = list.filter(t => {
          const tTime = new Date(t.transaction_date).getTime();
          return tTime >= start && tTime <= end;
        });
      }
    }

    if (selectedStoreId || selectedCityId || selectedProvinceId) {
      list = list.filter(t => {
        if (!t.store_id) return false;
        if (selectedStoreId && t.store_id !== selectedStoreId) return false;
        
        const store = stores.find(s => s.id === t.store_id);
        if (!store) return false;

        if (selectedCityId && store.city_id !== selectedCityId) return false;

        if (selectedProvinceId) {
          const province = reportCityProvinceMap.get(store.city_id) || getProvinceForCity(store.city_name || '');
          if (selectedProvinceId === '未知省份' ? !!province : province !== selectedProvinceId) {
            return false;
          }
        }

        return true;
      });
    }

    const totalIncome = list.filter(t => t.transaction_type === 'income').reduce((sum, t) => sum + t.amount, 0);
    const totalExpense = list.filter(t => t.transaction_type === 'expense').reduce((sum, t) => sum + t.amount, 0);
    const netIncome = totalIncome - totalExpense;

    const incomeByCategory: Record<string, number> = {};
    const expenseByCategory: Record<string, number> = {};

    list.forEach(t => {
      if (t.transaction_type === 'income') {
        incomeByCategory[t.category] = (incomeByCategory[t.category] || 0) + t.amount;
      } else {
        expenseByCategory[t.category] = (expenseByCategory[t.category] || 0) + t.amount;
      }
    });

    const topIncomeCategories = Object.entries(incomeByCategory)
      .map(([name, amount]) => ({ name, amount }))
      .sort((a, b) => b.amount - a.amount);

    const topExpenseCategories = Object.entries(expenseByCategory)
      .map(([name, amount]) => ({ name, amount }))
      .sort((a, b) => b.amount - a.amount);

    return {
      totalIncome,
      totalExpense,
      netIncome,
      topIncomeCategories,
      topExpenseCategories,
      transactionCount: list.length
    };
  }, [transactions, selectedMonth, selectedStoreId, selectedCityId, selectedProvinceId, stores, reportCityProvinceMap]);


  const exportBusinessData = async () => {
    if (exportLocks.current.business) return;
    exportLocks.current.business = true;
    try {
      await fetchAllStoreInventory();
      const workbook = XLSX.utils.book_new();
  
      const cityHeaders = ['序号', '城市', '城市分级', '渠道门店名称', '合作模式', '月总销售件数', '上月同期销量', '环比增长率', '供货营收', '库存总货值', 'sku动销率', '结算账期'];
      const cityRows: SheetRow[] = generateCityChannelReport().map((row) => [
        row.序号,
        row.城市,
        row.城市分级,
        row.渠道门店名称,
        row.合作模式,
        row.月总销售件数,
        row.上月同期销量,
        row.环比增长率,
        row.供货营收,
        row.库存总货值,
        row.sku动销率,
        row.结算账期,
      ]);
  
      const detailHeaders = ['序号', '城市', '渠道门店', 'SKU编号', '产品名称', '品类', '单位成本', '供货价', '终端售价', '当前实物库存', '预留库存', '总可用库存', '安全库存阈值', '本月销量', '上月销量', '库存周转天数', '滞销标记', '单品毛利'];
      const detailRows: SheetRow[] = generateProductDetailReport().map((row) => [
        row.序号,
        row.城市,
        row.渠道门店,
        row.SKU编号,
        row.产品名称,
        row.品类,
        row.单位成本,
        row.供货价,
        row.终端售价,
        row.当前实物库存,
        row.预留库存,
        row.总可用库存,
        row.安全库存阈值,
        row.本月销量,
        row.上月销量,
        row.库存周转天数,
        row.滞销标记,
        row.单品毛利,
      ]);
  
      const paymentHeaders = ['序号', '城市', '渠道门店', '对账周期', '应收货款', '已回款金额', '未结欠款', '逾期天数', '渠道扣点费用', '实际毛利额', '回款状态'];
      const paymentRows: SheetRow[] = generatePaymentReport(transactions).map((row) => [
        row.序号,
        row.城市,
        row.渠道门店,
        row.对账周期,
        row.应收货款,
        row.已回款金额,
        row.未结欠款,
        row.逾期天数,
        row.渠道扣点费用,
        row.实际毛利额,
        row.回款状态,
      ]);
  
      appendStyledSheet(workbook, '文创工作室多城市渠道库存&销售汇总表', cityHeaders, cityRows);
      appendStyledSheet(workbook, '文创单品多城市库存&销售明细表', detailHeaders, detailRows);
      appendStyledSheet(workbook, '文创渠道回款对账表', paymentHeaders, paymentRows);

      const now = new Date();
      const timestamp = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}-${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}${String(now.getSeconds()).padStart(2, '0')}`;
      await shareStyledWorkbook(workbook, `云窗渠道库存销售管理表-${timestamp}.xlsx`);
    } catch (error: unknown) {
      if (isShareCancelledError(error)) return;
      const message = error instanceof Error ? error.message : '经营数据导出失败';
      Toast.show({ type: 'error', text1: '导出失败', text2: message });
    } finally {
      if (selectedStoreId) {
        await fetchStoreInventory(selectedStoreId);
      }
      exportLocks.current.business = false;
    }
  };

  const renderTabButton = (key: ReportType, label: string) => {
    const isActive = reportType === key;
    return (
      <TouchableOpacity key={key} style={[styles.tab, { backgroundColor: theme.surfaceSecondary }, isActive && styles.activeTabWrap]} onPress={() => setReportType(key)}>
        {isActive ? (
          <LinearGradient colors={['#FF6B9D', '#5B8DEF']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={styles.activeTab}>
            <Text style={styles.activeTabText}>{label}</Text>
          </LinearGradient>
        ) : (
          <Text style={[styles.tabText, { color: theme.textSecondary }]}>{label}</Text>
        )}
      </TouchableOpacity>
    );
  };

  const renderSalesReport = () => (
    <ScrollView>
      <View style={[styles.card, { backgroundColor: theme.surface }]}>
        <Text style={[styles.cardTitle, { color: theme.textPrimary }]}>销售概览</Text>
        <Text style={[styles.cardSubtitle, { color: theme.textSecondary }]}>口径：结算单 + 零售单（已排除退款单）</Text>
        <View style={styles.statsRow}>
          <View style={styles.statItem}>
            <Text style={[styles.statValue, { color: theme.textPrimary }]}>{salesData.totalRetailSales.toFixed(2)}元</Text>
            <Text style={[styles.statLabel, { color: theme.textSecondary }]}>零售总价</Text>
          </View>
          <View style={styles.statItem}>
            <Text style={[styles.statValue, { color: theme.textPrimary }]}>{salesData.totalOrders}</Text>
            <Text style={[styles.statLabel, { color: theme.textSecondary }]}>营收订单数</Text>
          </View>
        </View>
      </View>

      <View style={[styles.card, { backgroundColor: theme.surface }]}>
        <Text style={[styles.cardTitle, { color: theme.textPrimary }]}>商品销量排行</Text>
        {salesData.topProductsQty.length > 0 ? (
          salesData.topProductsQty.map((item, index) => (
            <TouchableOpacity
              key={`${item.name}-qty`}
              style={[styles.rankListRow, { borderBottomColor: theme.divider }]}
              onPress={() => showFullProductName(item.name)}
              activeOpacity={0.75}
            >
              <Text style={[styles.rankListName, { color: theme.textPrimary }]} numberOfLines={1} ellipsizeMode="tail">
                {index + 1}. {item.name}
              </Text>
              <Text style={[styles.rankListValue, { color: theme.textSecondary }]}>{item.quantity}</Text>
            </TouchableOpacity>
          ))
        ) : (
          <View style={styles.emptyChartContainer}>
            <BarChart3 size={40} color={theme.textTertiary} strokeWidth={1.5} />
            <Text style={[styles.emptyText, { color: theme.textTertiary }]}>暂无销售数据</Text>
          </View>
        )}
      </View>
    </ScrollView>
  );

  const renderInventoryReport = () => (
    <ScrollView>
      <View style={[styles.card, { backgroundColor: theme.surface }] }>
        <Text style={[styles.cardTitle, { color: theme.textPrimary }]}>SKU动销率与周转</Text>
        <Text style={[styles.cardSubtitle, { color: theme.textSecondary }]}>动销率 = 有销量 SKU 数 / 总 SKU 数（店铺商品维度为销量 / 库存）</Text>
        <View style={styles.statsRow}>
          <View style={styles.statItem}>
            <Text style={[styles.statValue, { color: theme.textPrimary }]}>{turnoverData.activeSkuCount} / {turnoverData.totalSkuCount}</Text>
            <Text style={[styles.statLabel, { color: theme.textSecondary }]}>动销SKU</Text>
          </View>
          <View style={styles.statItem}>
            <Text style={[styles.statValue, turnoverData.sellThroughRate < 0.5 && styles.warningText]}>
              {(turnoverData.sellThroughRate * 100).toFixed(1)}%
            </Text>
            <Text style={[styles.statLabel, { color: theme.textSecondary }]}>动销率</Text>
          </View>
          <View style={styles.statItem}>
            <Text style={[styles.statValue, { color: theme.textPrimary }]}>
              {turnoverData.avgTurnoverDays.toFixed(1)}天
            </Text>
            <Text style={[styles.statLabel, { color: theme.textSecondary }]}>平均周转</Text>
          </View>
        </View>
      </View>

      {turnoverData.inventoryValuePie.length > 0 && (
        <View style={[styles.card, { backgroundColor: theme.surface }, turnoverData.isSlowWarning && { borderColor: Colors.danger, borderWidth: 1 }] }>
          <Text style={[styles.cardTitle, { color: theme.textPrimary }]}>库存成本结构</Text>
          {turnoverData.isSlowWarning && (
            <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 10, backgroundColor: 'rgba(248, 113, 113, 0.1)', padding: 8, borderRadius: 4 }}>
              <AlertTriangle size={16} color={Colors.danger} style={{ marginRight: 6 }} />
              <Text style={{ color: Colors.danger, fontSize: 12, fontWeight: '600' }}>
                警告：滞销款库存成本占比达 {(turnoverData.slowValueRatio * 100).toFixed(1)}%，超过 15% 阈值！
              </Text>
            </View>
          )}
          <View style={styles.pieContainer}>
            <PieChart
              data={turnoverData.inventoryValuePie}
              donut
              radius={70}
              innerRadius={40}
              innerCircleColor={theme.surface}
              centerLabelComponent={() => (
                <View style={{ alignItems: 'center' }}>
                  <Text style={{ fontSize: 14, fontWeight: '700', color: theme.textPrimary }}>
                    {turnoverData.inventoryValuePie.reduce((s, c) => s + c.value, 0).toFixed(0)}
                  </Text>
                  <Text style={{ fontSize: 10, color: theme.textSecondary }}>总货值</Text>
                </View>
              )}
            />
            <View style={styles.legendContainer}>
              {turnoverData.inventoryValuePie.map((item) => (
                <View key={item.name} style={styles.legendItem}>
                  <View style={[styles.legendDot, { backgroundColor: item.color }]} />
                  <Text style={[styles.legendText, { color: theme.textSecondary }]}>{item.name}: {item.value.toFixed(0)}元</Text>
                </View>
              ))}
            </View>
          </View>
        </View>
      )}

      <View style={[styles.card, { backgroundColor: theme.surface }] }>
        <Text style={[styles.cardTitle, { color: theme.textPrimary }]}>热销款库存价值 TOP 3</Text>
        {turnoverData.hotValueRanking.length > 0 ? (
          turnoverData.hotValueRanking.map((item, index) => (
            <View key={`${item.name}-hot-${index}`} style={styles.velocityItem}>
              <View style={styles.velocityRank}>
                <Text style={styles.velocityRankText}>{index + 1}</Text>
              </View>
              <View style={styles.velocityInfo}>
                <Text style={[styles.velocityName, { color: theme.textPrimary }]} numberOfLines={1} ellipsizeMode="tail">
                  {item.name}
                </Text>
                <Text style={[styles.velocityMeta, { color: theme.textSecondary }]}>¥{item.inventoryValue.toFixed(0)}</Text>
              </View>
            </View>
          ))
        ) : (
          <Text style={[styles.emptyText, { color: theme.textTertiary }]}>暂无热销库存价值数据</Text>
        )}
      </View>

      <View style={[styles.card, { backgroundColor: theme.surface }] }>
        <Text style={[styles.cardTitle, { color: theme.textPrimary }]}>滞销款库存价值 TOP 3</Text>
        {turnoverData.slowValueRanking.length > 0 ? (
          turnoverData.slowValueRanking.map((item, index) => (
            <View key={`${item.name}-slow-${index}`} style={styles.velocityItem}>
              <View style={styles.velocityRank}>
                <Text style={styles.velocityRankText}>{index + 1}</Text>
              </View>
              <View style={styles.velocityInfo}>
                <Text style={[styles.velocityName, { color: theme.textPrimary }]} numberOfLines={1} ellipsizeMode="tail">
                  {item.name}
                </Text>
                <Text style={[styles.velocityMeta, { color: theme.textSecondary }]}>¥{item.inventoryValue.toFixed(0)}</Text>
              </View>
            </View>
          ))
        ) : (
          <Text style={[styles.emptyText, { color: theme.textTertiary }]}>暂无滞销库存价值数据</Text>
        )}
      </View>

      <View style={[styles.card, { backgroundColor: theme.surface }] }>
        <Text style={[styles.cardTitle, { color: theme.textPrimary }]}>动销率下钻分析</Text>
        <Text style={[styles.cardSubtitle, { color: theme.textSecondary }]}>
          {selectedStoreId ? '商品维度' : selectedCityId ? '店铺维度' : selectedProvinceId ? '城市维度' : '省份维度'}
        </Text>
        {turnoverData.drillDownData.length > 0 ? (
          <>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingRight: 12 }}>
              <BarChart
                data={turnoverData.drillDownData.map((item, index) => ({
                  value: item.rate > 0 ? Math.max(item.rate * 100, 1) : 0,
                  label: item.label.length > 6 ? `${item.label.slice(0, 6)}…` : item.label,
                  frontColor: CHART_COLORS[index % CHART_COLORS.length],
                  onPress: () => showFullProductName(`${item.label}\n动销SKU: ${item.active}/${item.total}\n动销率: ${(item.rate * 100).toFixed(1)}%`),
                }))}
                width={Math.max(420, turnoverData.drillDownData.length * 96)}
                barWidth={24}
                spacing={20}
                initialSpacing={10}
                roundedTop
                roundedBottom
                hideRules
                xAxisThickness={1}
                xAxisColor={theme.divider}
                yAxisThickness={0}
                yAxisTextStyle={{ fontSize: 10, color: theme.textTertiary }}
                xAxisLabelTextStyle={{ fontSize: 10, color: theme.textSecondary, width: 56, textAlign: 'center' }}
                xAxisLabelsHeight={56}
                noOfSections={4}
                maxValue={Math.max(100, ...turnoverData.drillDownData.map((item) => item.rate * 100))}
                isAnimated
                animationDuration={500}
                height={240}
              />
            </ScrollView>
            <Text style={[styles.chartHintText, { color: theme.textTertiary }]}>点击柱体查看该维度详情</Text>
          </>
        ) : (
          <View style={styles.emptyChartContainer}>
            <BarChart3 size={40} color={theme.textTertiary} strokeWidth={1.5} />
            <Text style={[styles.emptyText, { color: theme.textTertiary }]}>暂无动销数据</Text>
          </View>
        )}
      </View>

      <View style={[styles.card, { backgroundColor: theme.surface }] }>
        <Text style={[styles.cardTitle, { color: theme.textPrimary }]}>商品周转分布 (成本 vs 天数)</Text>
        <Text style={[styles.cardSubtitle, { color: theme.textSecondary }]}>X轴: 成本(元)  Y轴: 周转天数</Text>
        {turnoverData.scatterData.length > 0 ? (
          <View style={{ height: 200, width: '100%', position: 'relative', marginTop: 10, borderWidth: 1, borderColor: theme.divider, borderRadius: 4 }}>
            {(() => {
              const maxCost = Math.max(...turnoverData.scatterData.map(d => d.cost), 10);
              const maxDays = Math.max(...turnoverData.scatterData.map(d => d.turnoverDays), 10);
              return turnoverData.scatterData.map((d, i) => {
                const left = `${(d.cost / maxCost) * 90}%` as DimensionValue;
                const bottom = `${(d.turnoverDays / maxDays) * 90}%` as DimensionValue;
                return (
                  <TouchableOpacity
                    key={i}
                    style={{
                      position: 'absolute',
                      left,
                      bottom,
                      width: 12,
                      height: 12,
                      borderRadius: 6,
                      backgroundColor: d.turnoverDays > 60 ? Colors.danger : Colors.blue,
                      opacity: 0.7,
                      transform: [{ translateX: 6 }, { translateY: -6 }]
                    }}
                    onPress={() => showFullProductName(`${d.name}\n成本: ${d.cost}元\n可售天数: ${d.turnoverDays}天\n日均出库: ${d.dailySales > 0 ? d.dailySales.toFixed(2) : '无销售'}`)}
                  />
                );
              });
            })()}
          </View>
        ) : (
          <View style={styles.emptyChartContainer}>
            <BarChart3 size={40} color={theme.textTertiary} strokeWidth={1.5} />
            <Text style={[styles.emptyText, { color: theme.textTertiary }]}>暂无周转分布数据</Text>
          </View>
        )}
      </View>

      <View style={[styles.card, { backgroundColor: theme.surface }] }>
        <Text style={[styles.cardTitle, { color: theme.textPrimary }]}>系列平均周转天数</Text>
        {turnoverData.seriesAvgTurnover.length > 0 ? (
          turnoverData.seriesAvgTurnover.map((item, index) => (
            <View key={item.name} style={[styles.rankListRow, { borderBottomColor: theme.divider }]}>
              <Text style={[styles.rankListName, { color: theme.textPrimary }]} numberOfLines={1} ellipsizeMode="tail">
                {index + 1}. {item.name}
              </Text>
              <Text style={[styles.rankListValue, { color: theme.textSecondary }]}>{item.avgDays.toFixed(1)}天</Text>
            </View>
          ))
        ) : (
          <Text style={[styles.emptyText, { color: theme.textTertiary }]}>暂无系列数据</Text>
        )}
      </View>

      <View style={[styles.card, { backgroundColor: theme.surface }] }>
        <Text style={[styles.cardTitle, { color: theme.textPrimary }]}>商品周转天数排行榜</Text>
        <Text style={[styles.cardSubtitle, { color: theme.textSecondary }]}>周转天数 = 当前库存 ÷ 日均出库量（无销售显示暂无销量记录）</Text>
        {turnoverData.topTurnoverProducts.length > 0 ? (
          turnoverData.topTurnoverProducts.map((item, index) => (
            <View key={item.name} style={[styles.velocityItem, item.isSlow && styles.velocityUnhealthyBg]}>
              <View style={styles.velocityRank}>
                <Text style={styles.velocityRankText}>{index + 1}</Text>
              </View>
              <View style={styles.velocityInfo}>
                <View style={styles.velocityNameRow}>
                  {item.isSlow && <AlertTriangle size={14} color={theme.danger} style={styles.alertIcon} />}
                  <TouchableOpacity onPress={() => showFullProductName(item.name)} activeOpacity={0.75}>
                    <Text
                      style={[styles.velocityName, { color: theme.textPrimary }, item.isSlow && styles.velocityUnhealthy]}
                      numberOfLines={1}
                      ellipsizeMode="tail"
                    >
                      {item.name}
                    </Text>
                  </TouchableOpacity>
                </View>
                <Text style={[styles.velocityMeta, { color: theme.textSecondary }]}>
                  周转天数: {item.turnoverDays === 999 ? '暂无销量记录' : `${item.turnoverDays}天`}
                </Text>
              </View>
            </View>
          ))
        ) : (
          <View style={styles.emptyChartContainer}>
            <BarChart3 size={40} color={theme.textTertiary} strokeWidth={1.5} />
            <Text style={[styles.emptyText, { color: theme.textTertiary }]}>暂无周转数据</Text>
          </View>
        )}
      </View>
    </ScrollView>
  );

  const renderSupplyReport = () => (
    <ScrollView>
      <View style={[styles.card, { backgroundColor: theme.surface }]}>
        <Text style={[styles.cardTitle, { color: theme.textPrimary }]}>供货统计概览</Text>
        <Text style={[styles.cardSubtitle, { color: theme.textSecondary }]}>仅统计供货单（distribution）</Text>
        <View style={styles.statsRow}>
          <View style={styles.statItem}>
            <Text style={[styles.statValue, { color: theme.textPrimary }]}>{supplyData.totalSupplyOrders}</Text>
            <Text style={[styles.statLabel, { color: theme.textSecondary }]}>供货单数</Text>
          </View>
          <View style={styles.statItem}>
            <Text style={[styles.statValue, { color: theme.textPrimary }]}>{supplyData.totalSupplyQuantity}</Text>
            <Text style={[styles.statLabel, { color: theme.textSecondary }]}>供货总件数</Text>
          </View>
        </View>
      </View>

      <View style={[styles.card, { backgroundColor: theme.surface }]}>
        <Text style={[styles.cardTitle, { color: theme.textPrimary }]}>商品供货排行</Text>
        {supplyData.topProducts.length > 0 ? (
          supplyData.topProducts.map((item, index) => (
            <TouchableOpacity
              key={`${item.name}-${index}`}
              style={[styles.rankListRow, { borderBottomColor: theme.divider }]}
              onPress={() => showFullProductName(item.name)}
              activeOpacity={0.75}
            >
              <Text style={[styles.rankListName, { color: theme.textPrimary }]} numberOfLines={1} ellipsizeMode="tail">
                {index + 1}. {item.name}
              </Text>
              <Text style={[styles.rankListValue, { color: theme.textSecondary }]}>{item.quantity}</Text>
            </TouchableOpacity>
          ))
        ) : (
          <View style={styles.emptyChartContainer}>
            <BarChart3 size={40} color={theme.textTertiary} strokeWidth={1.5} />
            <Text style={[styles.emptyText, { color: theme.textTertiary }]}>暂无供货数据</Text>
          </View>
        )}
      </View>

      <View style={[styles.card, { backgroundColor: theme.surface }]}>
        <Text style={[styles.cardTitle, { color: theme.textPrimary }]}>店铺供货分布</Text>
        {supplyData.byStore.length > 0 ? (
          supplyData.byStore.map((item) => (
            <View key={item.store} style={[styles.rankListRow, { borderBottomColor: theme.divider }]}>
              <Text style={[styles.rankListName, { color: theme.textPrimary }]} numberOfLines={1} ellipsizeMode="tail">
                {item.store}
              </Text>
              <Text style={[styles.rankListValue, { color: theme.textSecondary }]}>{item.quantity}</Text>
            </View>
          ))
        ) : (
          <View style={styles.emptyChartContainer}>
            <BarChart3 size={40} color={theme.textTertiary} strokeWidth={1.5} />
            <Text style={[styles.emptyText, { color: theme.textTertiary }]}>暂无店铺供货数据</Text>
          </View>
        )}
      </View>
    </ScrollView>
  );


  const renderRevenueReport = () => (
    <ScrollView>
      <View style={[styles.card, { backgroundColor: theme.surface }] }>
        <Text style={[styles.cardTitle, { color: theme.textPrimary }]}>营收概览</Text>
        <Text style={[styles.cardSubtitle, { color: theme.textSecondary }]}>口径：结算单 + 零售单（已排除退款单）</Text>
        <View style={styles.statsRow}>
          <View style={styles.statItem}>
            <Text style={[styles.statValue, { color: theme.textPrimary }]}>{revenueData.totalRevenue.toFixed(2)}元</Text>
            <Text style={[styles.statLabel, { color: theme.textSecondary }]}>总营收</Text>
          </View>
          <View style={styles.statItem}>
            <Text style={[styles.statValue, { color: theme.textPrimary }]}>{revenueData.totalOrders}</Text>
            <Text style={[styles.statLabel, { color: theme.textSecondary }]}>营收订单数</Text>
          </View>
          <View style={styles.statItem}>
            <Text style={[styles.statValue, profitData.totalProfit >= 0 ? styles.profitText : styles.lossText]}>{profitData.totalProfit.toFixed(2)}元</Text>
            <Text style={[styles.statLabel, { color: theme.textSecondary }]}>总毛利</Text>
          </View>
        </View>
      </View>

      <View style={[styles.card, { backgroundColor: theme.surface }] }>
        <Text style={[styles.cardTitle, { color: theme.textPrimary }]}>SKU毛利润排行</Text>
        {profitData.profitByProduct.length > 0 ? (
          <>
            <BarChart
              horizontal
              data={profitData.profitByProduct.slice(0, 10).map((item, index) => ({
                value: item.profit,
                label: item.name,
                onPress: () => showFullProductName(`${item.name}\n毛利润: ${item.profit.toFixed(2)}元`),
                frontColor: item.profit >= 0 ? CHART_COLORS[index % CHART_COLORS.length] : Colors.danger,
              }))}
              barWidth={18}
              spacing={14}
              yAxisLabelWidth={190}
              roundedTop
              roundedBottom
              hideRules
              xAxisThickness={1}
              xAxisColor={theme.divider}
              yAxisThickness={0}
              yAxisTextStyle={{ fontSize: 11, color: theme.textSecondary }}
              noOfSections={4}
              isAnimated
              animationDuration={500}
              height={Math.max(280, profitData.profitByProduct.slice(0, 10).length * 40)}
              shiftY={0}
            />
            <View style={styles.rankListContainer}>
              {profitData.profitByProduct.slice(0, 10).map((item, index) => (
                <TouchableOpacity
                  key={`${item.name}-${index}`}
                  style={[styles.rankListRow, { borderBottomColor: theme.divider }]}
                  onPress={() => showFullProductName(`${item.name}\n毛利润: ${item.profit.toFixed(2)}元`)}
                  activeOpacity={0.75}
                >
                  <Text style={[styles.rankListName, { color: theme.textPrimary }]} numberOfLines={1} ellipsizeMode="tail">
                    {index + 1}. {item.name}
                  </Text>
                  <Text style={[styles.rankListValue, { color: theme.textSecondary }]}>{item.profit.toFixed(2)}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </>
        ) : (
          <View style={styles.emptyChartContainer}>
            <TrendingUp size={40} color={theme.textTertiary} strokeWidth={1.5} />
            <Text style={[styles.emptyText, { color: theme.textTertiary }]}>暂无利润数据</Text>
          </View>
        )}
      </View>

      {selectedStoreId && (
        <View style={[styles.card, { backgroundColor: theme.surface }] }>
          <Text style={[styles.cardTitle, { color: theme.textPrimary }]}>店铺毛利与毛利率趋势</Text>
          {revenueData.profitTrend.length > 0 ? (
            <LineChart
              data={revenueData.profitTrend.map(item => ({
                value: item.profit,
                label: item.label,
                dataPointText: item.profit.toFixed(0),
              }))}
              secondaryData={revenueData.profitTrend.map(item => ({
                value: item.margin,
                dataPointText: item.margin.toFixed(1) + '%',
              }))}
              secondaryYAxis={{
                yAxisColor: Colors.pink,
                yAxisTextStyle: { color: Colors.pink, fontSize: 10 },
                yAxisLabelSuffix: '%',
              }}
              color={Colors.blue}
              secondaryLineConfig={{
                color: Colors.pink,
                dataPointsColor: Colors.pink,
                textColor: Colors.pink,
              }}
              dataPointsColor={Colors.blue}
              textColor={Colors.blue}
              textFontSize={10}
              thickness={2}
              spacing={60}
              hideRules
              xAxisColor={theme.divider}
              yAxisColor={theme.divider}
              yAxisTextStyle={{ color: theme.textTertiary, fontSize: 10 }}
              isAnimated
              height={200}
            />
          ) : (
            <View style={styles.emptyChartContainer}>
              <TrendingUp size={40} color={theme.textTertiary} strokeWidth={1.5} />
              <Text style={[styles.emptyText, { color: theme.textTertiary }]}>暂无趋势数据</Text>
            </View>
          )}
        </View>
      )}

      <View style={[styles.card, { backgroundColor: theme.surface }] }>
        <Text style={[styles.cardTitle, { color: theme.textPrimary }]}>营收趋势</Text>
        {revenueData.trend.length > 0 ? (
          <>
            <BarChart
              data={revenueData.trend.map((item, index) => ({
                value: item.value,
                label: item.label,
                frontColor: CHART_COLORS[index % CHART_COLORS.length],
              }))}
              barWidth={30}
              spacing={20}
              roundedTop
              roundedBottom
              hideRules
              xAxisThickness={1}
              xAxisColor={theme.divider}
              yAxisThickness={0}
              yAxisTextStyle={{ fontSize: 10, color: theme.textTertiary }}
              noOfSections={4}
              maxValue={Math.ceil((revenueData.trend[0]?.value || 1) * 1.2)}
              isAnimated
              animationDuration={500}
              height={150}
            />
            <View style={styles.rankListContainer}>
              {revenueData.trend.map((item, index) => (
                <View key={item.label} style={[styles.rankListRow, { borderBottomColor: theme.divider }]}>
                  <Text style={[styles.rankListName, { color: theme.textPrimary }]} numberOfLines={1} ellipsizeMode="tail">
                    {item.label}
                  </Text>
                  <Text style={[styles.rankListValue, { color: theme.textSecondary }]}>{item.value.toFixed(2)}元</Text>
                </View>
              ))}
            </View>
          </>
        ) : (
          <View style={styles.emptyChartContainer}>
            <TrendingUp size={40} color={theme.textTertiary} strokeWidth={1.5} />
            <Text style={[styles.emptyText, { color: theme.textTertiary }]}>暂无营收趋势数据</Text>
          </View>
        )}
      </View>

      {revenueData.compositionByStore.length > 0 && (
        <View style={[styles.card, { backgroundColor: theme.surface }] }>
          <Text style={[styles.cardTitle, { color: theme.textPrimary }]}>店铺营收构成</Text>
          <View style={styles.pieContainer}>
            <PieChart
              data={revenueData.compositionByStore.map((item, index) => ({
                value: item.value,
                color: CHART_COLORS[index % CHART_COLORS.length],
              }))}
              donut
              radius={70}
              innerRadius={40}
              innerCircleColor={theme.surface}
              centerLabelComponent={() => (
                <View style={{ alignItems: 'center' }}>
                  <Text style={{ fontSize: 14, fontWeight: '700', color: theme.textPrimary }}>
                    {revenueData.compositionByStore.reduce((s, c) => s + c.value, 0).toFixed(0)}
                  </Text>
                  <Text style={{ fontSize: 10, color: theme.textSecondary }}>总额</Text>
                </View>
              )}
            />
            <View style={styles.legendContainer}>
              {revenueData.compositionByStore.map((item, index) => (
                <View key={item.name} style={styles.legendItem}>
                  <View style={[styles.legendDot, { backgroundColor: CHART_COLORS[index % CHART_COLORS.length] }]} />
                  <Text style={[styles.legendText, { color: theme.textSecondary }]}>{item.name}: {item.value.toFixed(0)}元</Text>
                </View>
              ))}
            </View>
          </View>
        </View>
      )}

      {revenueData.compositionByCity.length > 0 && (
        <View style={[styles.card, { backgroundColor: theme.surface }] }>
          <Text style={[styles.cardTitle, { color: theme.textPrimary }]}>城市营收构成</Text>
          <View style={styles.pieContainer}>
            <PieChart
              data={revenueData.compositionByCity.map((item, index) => ({
                value: item.value,
                color: CHART_COLORS[index % CHART_COLORS.length],
              }))}
              donut
              radius={70}
              innerRadius={40}
              innerCircleColor={theme.surface}
              centerLabelComponent={() => (
                <View style={{ alignItems: 'center' }}>
                  <Text style={{ fontSize: 14, fontWeight: '700', color: theme.textPrimary }}>
                    {revenueData.compositionByCity.reduce((s, c) => s + c.value, 0).toFixed(0)}
                  </Text>
                  <Text style={{ fontSize: 10, color: theme.textSecondary }}>总额</Text>
                </View>
              )}
            />
            <View style={styles.legendContainer}>
              {revenueData.compositionByCity.map((item, index) => (
                <View key={item.name} style={styles.legendItem}>
                  <View style={[styles.legendDot, { backgroundColor: CHART_COLORS[index % CHART_COLORS.length] }]} />
                  <Text style={[styles.legendText, { color: theme.textSecondary }]}>{item.name}: {item.value.toFixed(0)}元</Text>
                </View>
              ))}
            </View>
          </View>
        </View>
      )}
    </ScrollView>
  );

  const renderFinanceReport = () => (
    <ScrollView>
      <View style={[styles.card, { backgroundColor: theme.surface }] }>
        <Text style={[styles.cardTitle, { color: theme.textPrimary }]}>财务概览</Text>
        <View style={styles.statsRow}>
          <View style={styles.statItem}>
            <Text style={[styles.statValue, { color: theme.textPrimary }]}>{financeData.totalIncome.toFixed(2)}元</Text>
            <Text style={[styles.statLabel, { color: theme.textSecondary }]}>总收入</Text>
          </View>
          <View style={styles.statItem}>
            <Text style={[styles.statValue, { color: theme.textPrimary }]}>{financeData.totalExpense.toFixed(2)}元</Text>
            <Text style={[styles.statLabel, { color: theme.textSecondary }]}>总支出</Text>
          </View>
          <View style={styles.statItem}>
            <Text style={[styles.statValue, financeData.netIncome >= 0 ? styles.profitText : styles.lossText]}>{financeData.netIncome.toFixed(2)}元</Text>
            <Text style={[styles.statLabel, { color: theme.textSecondary }]}>净收入</Text>
          </View>
          <View style={styles.statItem}>
            <Text style={[styles.statValue, { color: theme.textPrimary }]}>{(balance?.balance || 0).toFixed(2)}元</Text>
            <Text style={[styles.statLabel, { color: theme.textSecondary }]}>现金余额</Text>
          </View>
        </View>
      </View>

      <View style={[styles.card, { backgroundColor: theme.surface }] }>
        <Text style={[styles.cardTitle, { color: theme.textPrimary }]}>收入分类占比</Text>
        {financeData.topIncomeCategories.length > 0 ? (
          <View style={styles.pieContainer}>
            <PieChart
              data={financeData.topIncomeCategories.map((item, index) => ({
                value: item.amount,
                color: CHART_COLORS[index % CHART_COLORS.length],
              }))}
              donut
              radius={70}
              innerRadius={40}
              innerCircleColor={theme.surface}
              centerLabelComponent={() => (
                <View style={{ alignItems: 'center' }}>
                  <Text style={{ fontSize: 14, fontWeight: '700', color: theme.textPrimary }}>
                    {financeData.totalIncome.toFixed(0)}
                  </Text>
                  <Text style={{ fontSize: 10, color: theme.textSecondary }}>收入</Text>
                </View>
              )}
            />
            <View style={styles.legendContainer}>
              {financeData.topIncomeCategories.map((item, index) => (
                <View key={item.name} style={styles.legendItem}>
                  <View style={[styles.legendDot, { backgroundColor: CHART_COLORS[index % CHART_COLORS.length] }]} />
                  <Text style={[styles.legendText, { color: theme.textSecondary }]}>{item.name}: {item.amount.toFixed(0)}元</Text>
                </View>
              ))}
            </View>
          </View>
        ) : (
          <View style={styles.emptyChartContainer}>
            <BarChart3 size={40} color={theme.textTertiary} strokeWidth={1.5} />
            <Text style={[styles.emptyText, { color: theme.textTertiary }]}>暂无收入数据</Text>
          </View>
        )}
      </View>

      <View style={[styles.card, { backgroundColor: theme.surface }] }>
        <Text style={[styles.cardTitle, { color: theme.textPrimary }]}>支出分类占比</Text>
        {financeData.topExpenseCategories.length > 0 ? (
          <View style={styles.pieContainer}>
            <PieChart
              data={financeData.topExpenseCategories.map((item, index) => ({
                value: item.amount,
                color: CHART_COLORS[index % CHART_COLORS.length],
              }))}
              donut
              radius={70}
              innerRadius={40}
              innerCircleColor={theme.surface}
              centerLabelComponent={() => (
                <View style={{ alignItems: 'center' }}>
                  <Text style={{ fontSize: 14, fontWeight: '700', color: theme.textPrimary }}>
                    {financeData.totalExpense.toFixed(0)}
                  </Text>
                  <Text style={{ fontSize: 10, color: theme.textSecondary }}>支出</Text>
                </View>
              )}
            />
            <View style={styles.legendContainer}>
              {financeData.topExpenseCategories.map((item, index) => (
                <View key={item.name} style={styles.legendItem}>
                  <View style={[styles.legendDot, { backgroundColor: CHART_COLORS[index % CHART_COLORS.length] }]} />
                  <Text style={[styles.legendText, { color: theme.textSecondary }]}>{item.name}: {item.amount.toFixed(0)}元</Text>
                </View>
              ))}
            </View>
          </View>
        ) : (
          <View style={styles.emptyChartContainer}>
            <BarChart3 size={40} color={theme.textTertiary} strokeWidth={1.5} />
            <Text style={[styles.emptyText, { color: theme.textTertiary }]}>暂无支出数据</Text>
          </View>
        )}
      </View>
    </ScrollView>
  );

  return (
    <View style={[styles.container, { backgroundColor: theme.background }]}>
      <View style={[styles.header, { backgroundColor: theme.surface }]}> 
        <Text style={[styles.headerTitle, { color: theme.textPrimary }]}>数据报表</Text>
      </View>

      <View style={styles.filterEntryRow}>
        <TouchableOpacity
          style={[styles.filterEntryButton, { backgroundColor: theme.surface, borderColor: theme.border }]}
          activeOpacity={0.85}
          onPress={() => setFilterModalVisible(true)}
        >
          <Text style={[styles.filterEntryText, { color: theme.textPrimary }]}>
            {activeFilterCount > 0 ? `筛选(${activeFilterCount})` : '筛选'}
          </Text>
        </TouchableOpacity>
      </View>

      {(selectedProvinceId || selectedCityId || selectedStoreId || selectedMonth !== 'all' || reportType !== (isDistributor ? 'supply' : 'finance')) && (
        <View style={styles.activeFiltersWrap}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.activeFiltersContent}>
            {selectedProvinceId && (
              <TouchableOpacity style={[styles.activeFilterChip, { backgroundColor: theme.surfaceSecondary }]} onPress={() => setSelectedProvinceId(null)}>
                <Text style={[styles.activeFilterChipText, { color: theme.textSecondary }]}>省份: {selectedProvinceId} ×</Text>
              </TouchableOpacity>
            )}
            {selectedCityId && (
              <TouchableOpacity style={[styles.activeFilterChip, { backgroundColor: theme.surfaceSecondary }]} onPress={() => setSelectedCityId(null)}>
                <Text style={[styles.activeFilterChipText, { color: theme.textSecondary }]}>城市: {reportCities.find((city) => city.id === selectedCityId)?.name || '已选'} ×</Text>
              </TouchableOpacity>
            )}
            {selectedStoreId && (
              <TouchableOpacity style={[styles.activeFilterChip, { backgroundColor: theme.surfaceSecondary }]} onPress={() => setSelectedStoreId(null)}>
                <Text style={[styles.activeFilterChipText, { color: theme.textSecondary }]}>店铺: {filteredStores.find((store) => store.id === selectedStoreId)?.name || '已选'} ×</Text>
              </TouchableOpacity>
            )}
            {selectedMonth !== 'all' && (
              <TouchableOpacity style={[styles.activeFilterChip, { backgroundColor: theme.surfaceSecondary }]} onPress={() => setSelectedMonth('all')}>
                <Text style={[styles.activeFilterChipText, { color: theme.textSecondary }]}>时间: {selectedMonth} ×</Text>
              </TouchableOpacity>
            )}
            {reportType !== (isDistributor ? 'supply' : 'finance') && (
              <TouchableOpacity style={[styles.activeFilterChip, { backgroundColor: theme.surfaceSecondary }]} onPress={() => setReportType(isDistributor ? 'supply' : 'finance')}>
                <Text style={[styles.activeFilterChipText, { color: theme.textSecondary }]}>类型: {reportTypeLabel} ×</Text>
              </TouchableOpacity>
            )}
          </ScrollView>
        </View>
      )}

      <View style={[styles.tabBar, { backgroundColor: theme.surface }]}> 
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterRowContent}>
          {reportTabs.map((item) => renderTabButton(item.key, item.label))}
        </ScrollView>
        <TouchableOpacity
          style={[styles.filterEntryButton, { backgroundColor: theme.surfaceSecondary, borderColor: theme.border }]}
          activeOpacity={0.85}
          onPress={exportBusinessData}
        >
          <Text style={[styles.filterEntryText, { color: theme.textPrimary }]}>导出经营数据</Text>
        </TouchableOpacity>
      </View>

      <View style={[styles.content, { backgroundColor: theme.background }]}> 
        {isDistributor && reportType === 'sales' && renderSalesReport()}
        {!isDistributor && reportType === 'revenue' && renderRevenueReport()}
        {reportType === 'supply' && renderSupplyReport()}
        {!isDistributor && reportType === 'inventory_turnover' && renderInventoryReport()}
        {!isDistributor && reportType === 'finance' && renderFinanceReport()}
      </View>

      {floatingProductName ? (
        <View style={[styles.floatingNameBubble, { backgroundColor: theme.surface, borderColor: theme.border }] }>
          <Text style={[styles.floatingNameText, { color: theme.textPrimary }]}>
            {floatingProductName}
          </Text>
        </View>
      ) : null}

      <Modal visible={filterModalVisible} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, { backgroundColor: theme.surface }]}>
            <View style={styles.modalHeader}>
              <Text style={[styles.modalTitle, { color: theme.textPrimary }]}>筛选条件</Text>
              <TouchableOpacity onPress={() => setFilterModalVisible(false)}>
                <Text style={styles.modalClose}>完成</Text>
              </TouchableOpacity>
            </View>

            {!isDistributor && (
              <View style={[styles.filterPanelContainer, { backgroundColor: theme.surface }]}>
                <ProvinceCityFilter
                  cities={reportCities}
                  selectedProvinceId={selectedProvinceId}
                  selectedCityId={selectedCityId}
                  onProvinceChange={setSelectedProvinceId}
                  onCityChange={setSelectedCityId}
                  showProvince={isAdminOrManager}
                />

                <Text style={[styles.filterLabel, { color: theme.textSecondary }]}>店铺</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.filterRow} contentContainerStyle={styles.filterRowContent}>
                  <TouchableOpacity
                    style={[styles.filterChip, { backgroundColor: theme.surfaceSecondary }, selectedStoreId === null && styles.filterChipActive]}
                    onPress={() => setSelectedStoreId(null)}
                  >
                    <Text style={[styles.filterChipText, { color: theme.textSecondary }, selectedStoreId === null && styles.filterChipTextActive]}>
                      全部店铺
                    </Text>
                  </TouchableOpacity>
                  {filteredStores.map((store) => (
                    <TouchableOpacity
                      key={store.id}
                      style={[styles.filterChip, { backgroundColor: theme.surfaceSecondary }, selectedStoreId === store.id && styles.filterChipActive]}
                      onPress={() => setSelectedStoreId(store.id)}
                    >
                      <Text style={[styles.filterChipText, { color: theme.textSecondary }, selectedStoreId === store.id && styles.filterChipTextActive]}>
                        {store.name}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </ScrollView>
              </View>
            )}

            <View style={[styles.filterPanelContainer, { backgroundColor: theme.surface }]}>
              <Text style={[styles.filterLabel, { color: theme.textSecondary }]}>月份</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.filterRow} contentContainerStyle={styles.filterRowContent}>
                {monthOptions.map((monthOption) => (
                  <TouchableOpacity
                    key={monthOption}
                    style={[styles.filterChip, { backgroundColor: theme.surfaceSecondary }, selectedMonth === monthOption && styles.filterChipActive]}
                    onPress={() => setSelectedMonth(monthOption)}
                  >
                    <Text style={[styles.filterChipText, { color: theme.textSecondary }, selectedMonth === monthOption && styles.filterChipTextActive]}>
                      {monthOption === 'all' ? '全部' : monthOption}
                    </Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
            </View>

            <View style={[styles.filterPanelContainer, { backgroundColor: theme.surface }]}>
              <Text style={[styles.filterLabel, { color: theme.textSecondary }]}>报表类型</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.filterRow} contentContainerStyle={styles.filterRowContent}>
                {reportTabs.map((item) => (
                  <TouchableOpacity
                    key={item.key}
                    style={[styles.filterChip, { backgroundColor: theme.surfaceSecondary }, reportType === item.key && styles.filterChipActive]}
                    onPress={() => setReportType(item.key as ReportType)}
                  >
                    <Text style={[styles.filterChipText, { color: theme.textSecondary }, reportType === item.key && styles.filterChipTextActive]}>
                      {item.label}
                    </Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
            </View>

            <View style={styles.filterModalActions}>
              <TouchableOpacity
                style={[styles.clearButton, { borderColor: theme.border }]}
                onPress={() => {
                  setSelectedProvinceId(null);
                  setSelectedCityId(null);
                  setSelectedStoreId(null);
                  setSelectedMonth('all');
                  setReportType(isDistributor ? 'supply' : 'finance');
                }}
              >
                <Text style={[styles.clearButtonText, { color: theme.textSecondary }]}>重置筛选</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.confirmButtonWrap} onPress={() => setFilterModalVisible(false)} activeOpacity={0.85}>
                <LinearGradient colors={['#FF6B9D', '#5B8DEF']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={styles.confirmButton}>
                  <Text style={styles.confirmButtonText}>完成</Text>
                </LinearGradient>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  header: { padding: 15, backgroundColor: Colors.surface },
  headerTitle: { fontSize: 20, fontWeight: '700', color: Colors.textPrimary },
  tabBar: { flexDirection: 'row', backgroundColor: Colors.surface, paddingHorizontal: 10, paddingTop: 15, paddingBottom: 10 },
  tab: {
    flex: 1,
    borderRadius: Radius.sm,
    marginHorizontal: 4,
    backgroundColor: Colors.surfaceSecondary,
    overflow: 'hidden',
  },
  activeTabWrap: { backgroundColor: 'transparent' },
  activeTab: { paddingVertical: 10, alignItems: 'center', borderRadius: Radius.sm },
  tabText: { fontSize: 14, color: Colors.textSecondary, textAlign: 'center', paddingVertical: 10 },
  activeTabText: { color: '#fff', fontWeight: '600', fontSize: 14 },
  content: { flex: 1 },
  card: {
    backgroundColor: Colors.surface,
    margin: 10,
    marginBottom: 0,
    padding: 15,
    borderRadius: Radius.lg,
    ...Shadow.card,
  },
  cardTitle: { fontSize: 16, fontWeight: '700', marginBottom: 15, color: Colors.textPrimary },
  statsRow: { flexDirection: 'row', justifyContent: 'space-between', flexWrap: 'wrap', rowGap: 8 },
  statItem: { alignItems: 'center', width: '48%' },
  statValue: { fontSize: 16, fontWeight: '700', color: Colors.textPrimary, textAlign: 'center', lineHeight: 22 },
  statLabel: { fontSize: 12, color: Colors.textSecondary, marginTop: 4, textAlign: 'center', lineHeight: 16 },
  warningText: { color: Colors.danger },
  profitText: { color: Colors.success },
  lossText: { color: Colors.danger },
  pieContainer: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingVertical: 10 },
  legendContainer: { marginLeft: 20 },
  legendItem: { flexDirection: 'row', alignItems: 'center', marginBottom: 6 },
  legendDot: { width: 10, height: 10, borderRadius: 5, marginRight: 8 },
  legendText: { fontSize: 12, color: Colors.textSecondary },
  emptyChartContainer: { alignItems: 'center', paddingVertical: 30 },
  emptyText: { textAlign: 'center', color: Colors.textTertiary, padding: 20, fontSize: 14 },
  exportRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginHorizontal: 10,
    marginTop: 10,
  },
  exportButton: {
    flex: 1,
    flexDirection: 'row',
    marginHorizontal: 4,
    borderRadius: Radius.md,
    backgroundColor: Colors.blue,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 10,
  },
  exportButtonText: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '600',
  },
  profitItem: { paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: Colors.divider },
  profitItemHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  profitNameTouchArea: {
    flex: 1,
    marginRight: 10,
  },
  profitItemName: { fontSize: 14, fontWeight: '600', color: Colors.textPrimary },
  profitItemValue: { fontSize: 14, fontWeight: 'bold' },
  profitDetails: { flexDirection: 'row', justifyContent: 'space-between' },
  profitDetailText: { fontSize: 12, color: Colors.textSecondary },
  cardSubtitle: { fontSize: 12, color: Colors.textSecondary, marginTop: 4, marginBottom: 10 },
  velocityItem: { flexDirection: 'row', alignItems: 'center', paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: Colors.divider },
  velocityRank: { width: 24, height: 24, borderRadius: 12, backgroundColor: Colors.pink, justifyContent: 'center', alignItems: 'center', marginRight: 10 },
  velocityRankText: { fontSize: 12, fontWeight: '700', color: '#fff' },
  velocityInfo: { flex: 1 },
  velocityNameRow: { flexDirection: 'row', alignItems: 'center' },
  velocityName: { fontSize: 14, fontWeight: '600', color: Colors.textPrimary },
  velocityUnhealthy: { color: Colors.danger },
  velocityUnhealthyBg: { backgroundColor: 'rgba(248, 113, 113, 0.05)' },
  alertIcon: { marginRight: 6 },
  velocityMeta: { fontSize: 12, color: Colors.textSecondary, marginTop: 2 },
  rankListContainer: {
    marginTop: 10,
  },
  rankListRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 6,
    borderBottomWidth: 1,
  },
  rankListName: {
    flex: 1,
    fontSize: 12,
    marginRight: 10,
  },
  rankListValue: {
    fontSize: 12,
    fontWeight: '600',
  },
  chartHintText: {
    fontSize: 11,
    marginTop: 8,
    textAlign: 'right',
  },
  filterEntryRow: {
    paddingHorizontal: 12,
    paddingTop: 10,
  },
  filterEntryButton: {
    alignSelf: 'flex-start',
    borderWidth: 1,
    borderRadius: Radius.md,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  filterEntryText: {
    fontSize: 13,
    fontWeight: '600',
  },
  activeFiltersWrap: {
    paddingHorizontal: 10,
    paddingTop: 8,
  },
  activeFiltersContent: {
    paddingRight: 8,
    alignItems: 'center',
  },
  activeFilterChip: {
    borderRadius: Radius.xl,
    paddingHorizontal: 10,
    paddingVertical: 6,
    marginRight: 8,
  },
  activeFilterChipText: {
    fontSize: 12,
    fontWeight: '500',
  },
  filterContainer: { paddingTop: 10, paddingBottom: 16, borderBottomWidth: 1 },
  filterLabel: { fontSize: 12, fontWeight: '600', paddingHorizontal: 15, marginBottom: 6 },
  filterScroll: { paddingHorizontal: 15, gap: 10 },
  filterChip: { paddingHorizontal: 16, paddingVertical: 6, borderRadius: Radius.pill, borderWidth: 1 },
  filterChipActive: { backgroundColor: Colors.blue },
  filterChipText: { fontSize: 13 },
  filterChipTextActive: { color: '#fff', fontWeight: '600' },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(18,18,26,0.52)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    backgroundColor: Colors.surface,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 12,
    maxHeight: '82%',
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: '700',
  },
  modalClose: {
    fontSize: 15,
    color: Colors.pink,
    fontWeight: '600',
  },
  filterPanelContainer: {
    marginBottom: 10,
  },
  filterRow: {
    flexGrow: 0,
  },
  filterRowContent: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    alignItems: 'center',
    gap: 8,
  },
  filterModalActions: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 8,
    marginBottom: 4,
  },
  clearButton: {
    flex: 1,
    height: 44,
    borderRadius: Radius.md,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.surface,
  },
  clearButtonText: {
    fontSize: 14,
    fontWeight: '600',
  },
  confirmButtonWrap: {
    flex: 1,
    borderRadius: Radius.md,
    overflow: 'hidden',
  },
  confirmButton: {
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  confirmButtonText: {
    color: '#fff',
    fontWeight: '700',
    fontSize: 14,
  },
  floatingNameBubble: {
    position: 'absolute',
    left: 16,
    right: 16,
    bottom: 92,
    borderRadius: Radius.md,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 10,
    zIndex: 20,
    ...Shadow.card,
  },
  floatingNameText: {
    fontSize: 13,
    fontWeight: '600',
    lineHeight: 18,
  },
});
