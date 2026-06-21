import React, { useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Alert,
  Modal,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import * as FileSystem from 'expo-file-system/legacy';
import { Buffer } from 'buffer';
import ExcelJS from 'exceljs';
import { useShallow } from 'zustand/react/shallow';
import { BarChart3, TrendingUp, Download, AlertTriangle } from 'lucide-react-native';
import { BarChart, PieChart } from 'react-native-gifted-charts';
import Toast from 'react-native-toast-message';

import { useAppStore } from '../store/useAppStore';
import ProvinceCityFilter from '../components/ProvinceCityFilter';
import { Colors, Shadow, Radius, LightColors, DarkColors } from '../theme';
import { buildMonthDateRange, buildMonthOptions } from '../utils/reportsMonth';
import { getProvinceForCity } from '../utils/provinceMapping';
import type { City } from '../types';

type ReportType = 'sales' | 'supply' | 'inventory' | 'profit';

const CHART_COLORS = ['#FF6B9D', '#5B8DEF', '#C77DFF', '#4ECDC4', '#FFB347'];

export default function ReportsScreen() {
  const { user, products, orders, stores, storeInventory, fetchProducts, fetchOrders, fetchStores, fetchStoreInventory } = useAppStore(
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
    })),
  );
  const [reportType, setReportType] = useState<ReportType>('sales');
  const isDarkMode = useAppStore((state) => state.isDarkMode);
  const theme = isDarkMode ? DarkColors : LightColors;

  const isDistributor = user?.role === 'distributor';
  const isAdminOrManager = user?.role === 'admin' || user?.role === 'super_admin' || user?.role === 'inventory_manager';

  const [filterModalVisible, setFilterModalVisible] = useState(false);
  const [selectedProvinceId, setSelectedProvinceId] = useState<string | null>(null);
  const [selectedCityId, setSelectedCityId] = useState<string | null>(null);
  const [selectedStoreId, setSelectedStoreId] = useState<string | null>(null);
  const [selectedMonth, setSelectedMonth] = useState<string>('all');
  const [allModeMonthOptions, setAllModeMonthOptions] = useState<string[]>([]);
  const [floatingProductName, setFloatingProductName] = useState('');

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
  }, [fetchProducts, fetchStores]);

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
    if (reportType !== 'sales') count += 1;
    return count;
  }, [reportType, selectedCityId, selectedMonth, selectedProvinceId, selectedStoreId]);

  const reportTypeLabel = useMemo(() => {
    if (reportType === 'sales') return '销售报表';
    if (reportType === 'supply') return '供货统计';
    if (reportType === 'inventory') return '库存报表';
    return '利润报表';
  }, [reportType]);

  const revenueScopedOrders = useMemo(
    () =>
      filteredOrders.filter((order) => {
        const isRevenueKind = order.order_kind === 'settlement' || order.order_kind === 'retail';
        if (!isRevenueKind) return false;
        const paymentStatus = String(order.payment_status || '').toLowerCase();
        return paymentStatus !== 'refunded' && paymentStatus !== 'refund_pending';
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

  const exportProfitExcel = async () => {
    try {
      await import('../polyfills/globals');
      const workbook = new ExcelJS.Workbook();
      const worksheet = workbook.addWorksheet('利润报表');
      const centered = { horizontal: 'center' as const, vertical: 'middle' as const };

      const headers = ['商品名称', '销量', '零售价', '零售总价', '折扣价', '折扣总收入', '总成本', '总利润'];
      const dataRows = profitData.profitByProduct.map((r) => [
        r.name,
        r.quantity,
        Number(r.retailPrice.toFixed(2)),
        Number(r.retailRevenue.toFixed(2)),
        Number(r.discountPrice.toFixed(2)),
        Number(r.discountRevenue.toFixed(2)),
        Number(r.cost.toFixed(2)),
        Number(r.profit.toFixed(2)),
      ]);

      const columnWidths = headers.map((header, colIdx) => {
        let maxLen = header.length * 2;
        dataRows.forEach((row) => {
          const len = String(row[colIdx]).length;
          if (len > maxLen) maxLen = len;
        });
        return Math.max(maxLen + 2, 10);
      });

      worksheet.columns = columnWidths.map((width) => ({ width }));
      worksheet.addRow(headers);
      dataRows.forEach((row) => {
        worksheet.addRow(row);
      });
      worksheet.eachRow((row) => {
        row.eachCell((cell) => {
          cell.alignment = centered;
        });
      });

      const workbookBuffer = await workbook.xlsx.writeBuffer({ useStyles: true });
      const base64 = Buffer.from(workbookBuffer).toString('base64');
      const monthSuffix = selectedMonth === 'all' ? '' : `-${selectedMonth}`;
      const uri = `${FileSystem.cacheDirectory}profit-report${monthSuffix}-${Date.now()}.xlsx`;
      await FileSystem.writeAsStringAsync(uri, base64, { encoding: FileSystem.EncodingType.Base64 });
      await Sharing.shareAsync(uri, {
        mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Excel 导出失败';
      Toast.show({ type: 'error', text1: '导出失败', text2: message });
    }
  };

  const exportProfitPdf = async () => {
    try {
      const rows = profitData.profitByProduct
        .map(
          (r) => `
          <tr>
            <td>${r.name}</td>
            <td>${r.retailRevenue.toFixed(2)}元</td>
            <td>${r.discountRevenue.toFixed(2)}元</td>
            <td>${r.cost.toFixed(2)}元</td>
            <td>${r.profit.toFixed(2)}元</td>
          </tr>`,
        )
        .join('');

      const html = `
        <html>
          <body style="font-family: Arial; padding: 20px;">
            <h2>利润报表</h2>
            <p>零售总价：${profitData.totalRetailRevenue.toFixed(2)}元</p>
            <p>折扣总收入：${profitData.totalDiscountRevenue.toFixed(2)}元</p>
            <p>总成本：${profitData.totalCost.toFixed(2)}元</p>
            <p>总利润：${profitData.totalProfit.toFixed(2)}元</p>
            <table border="1" cellspacing="0" cellpadding="6" style="border-collapse: collapse; width:100%;">
              <tr>
                <th>商品</th><th>零售总价</th><th>折扣总收入</th><th>总成本</th><th>总利润</th>
              </tr>
              ${rows}
            </table>
          </body>
        </html>
      `;

      const { uri } = await Print.printToFileAsync({ html });
      const monthSuffix = selectedMonth === 'all' ? '' : `-${selectedMonth}`;
      const newUri = `${FileSystem.cacheDirectory}profit-report${monthSuffix}-${Date.now()}.pdf`;
      await FileSystem.moveAsync({ from: uri, to: newUri });
      await Sharing.shareAsync(newUri, { mimeType: 'application/pdf' });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'PDF 导出失败';
      Toast.show({ type: 'error', text1: '导出失败', text2: message });
    }
  };

  const renderTabButton = (key: ReportType, label: string) => {
    const isActive = reportType === key;
    return (
      <TouchableOpacity style={[styles.tab, { backgroundColor: theme.surfaceSecondary }, isActive && styles.activeTabWrap]} onPress={() => setReportType(key)}>
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
      <View style={[styles.card, { backgroundColor: theme.surface }] }>
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

      <View style={[styles.card, { backgroundColor: theme.surface }] }>
        <Text style={[styles.cardTitle, { color: theme.textPrimary }]}>商品销量排行榜</Text>
        {salesData.topProductsQty.length > 0 ? (
          <>
            <BarChart
              data={salesData.topProductsQty.map((item, index) => ({
                value: item.quantity,
                label: item.name.length > 4 ? item.name.slice(0, 4) + '..' : item.name,
                frontColor: CHART_COLORS[index % CHART_COLORS.length],
                topLabelComponent: () => (
                  <Text style={{ fontSize: 10, color: theme.textSecondary, marginBottom: 4 }}>
                    {item.quantity}
                  </Text>
                ),
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
              maxValue={Math.ceil((salesData.topProductsQty[0]?.quantity || 1) * 1.2)}
              isAnimated
              animationDuration={500}
              height={150}
            />
            <View style={styles.rankListContainer}>
              {salesData.topProductsQty.map((item, index) => (
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
              ))}
            </View>
          </>
        ) : (
          <View style={styles.emptyChartContainer}>
            <BarChart3 size={40} color={theme.textTertiary} strokeWidth={1.5} />
            <Text style={[styles.emptyText, { color: theme.textTertiary }]}>暂无销售数据</Text>
          </View>
        )}
      </View>

      <View style={[styles.card, { backgroundColor: theme.surface }] }>
        <Text style={[styles.cardTitle, { color: theme.textPrimary }]}>商品销售额排行榜</Text>
        {salesData.topProductsAmt.length > 0 ? (
          <>
            <BarChart
              data={salesData.topProductsAmt.map((item, index) => ({
                value: item.amount,
                label: item.name.length > 4 ? item.name.slice(0, 4) + '..' : item.name,
                frontColor: CHART_COLORS[index % CHART_COLORS.length],
                topLabelComponent: () => (
                  <Text style={{ fontSize: 10, color: theme.textSecondary, marginBottom: 4 }}>
                    {item.amount.toFixed(0)}
                  </Text>
                ),
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
              maxValue={Math.ceil((salesData.topProductsAmt[0]?.amount || 1) * 1.2)}
              isAnimated
              animationDuration={500}
              height={150}
            />
            <View style={styles.rankListContainer}>
              {salesData.topProductsAmt.map((item, index) => (
                <TouchableOpacity
                  key={`${item.name}-amt`}
                  style={[styles.rankListRow, { borderBottomColor: theme.divider }]}
                  onPress={() => showFullProductName(item.name)}
                  activeOpacity={0.75}
                >
                  <Text style={[styles.rankListName, { color: theme.textPrimary }]} numberOfLines={1} ellipsizeMode="tail">
                    {index + 1}. {item.name}
                  </Text>
                  <Text style={[styles.rankListValue, { color: theme.textSecondary }]}>{item.amount.toFixed(0)}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </>
        ) : (
          <View style={styles.emptyChartContainer}>
            <BarChart3 size={40} color={theme.textTertiary} strokeWidth={1.5} />
            <Text style={[styles.emptyText, { color: theme.textTertiary }]}>暂无销售数据</Text>
          </View>
        )}
      </View>

      <View style={[styles.card, { backgroundColor: theme.surface }] }>
        <Text style={[styles.cardTitle, { color: theme.textPrimary }]}>商品动销率排行榜</Text>
        <Text style={[styles.cardSubtitle, { color: theme.textSecondary }]}>动销率 = 销售数量 / 当前库存，低于0.5标红</Text>
        {salesData.topProductsVelocity.length > 0 ? (
          salesData.topProductsVelocity.map((item, index) => (
            <View key={item.name} style={[styles.velocityItem, item.isUnhealthy && styles.velocityUnhealthyBg]}>
              <View style={styles.velocityRank}>
                <Text style={styles.velocityRankText}>{index + 1}</Text>
              </View>
              <View style={styles.velocityInfo}>
                <View style={styles.velocityNameRow}>
                  {item.isUnhealthy && <AlertTriangle size={14} color={theme.danger} style={styles.alertIcon} />}
                  <TouchableOpacity onPress={() => showFullProductName(item.name)} activeOpacity={0.75}>
                    <Text
                      style={[styles.velocityName, { color: theme.textPrimary }, item.isUnhealthy && styles.velocityUnhealthy]}
                      numberOfLines={1}
                      ellipsizeMode="tail"
                    >
                      {item.name}
                    </Text>
                  </TouchableOpacity>
                </View>
                <Text style={[styles.velocityMeta, { color: theme.textSecondary }]}>
                  销量{item.quantity} / 库存{item.inventory} = 动销率{item.velocity.toFixed(2)}
                </Text>
              </View>
            </View>
          ))
        ) : (
          <View style={styles.emptyChartContainer}>
            <BarChart3 size={40} color={theme.textTertiary} strokeWidth={1.5} />
            <Text style={[styles.emptyText, { color: theme.textTertiary }]}>暂无动销数据</Text>
          </View>
        )}
      </View>

      {salesData.salesByCity.length > 0 && (
        <View style={[styles.card, { backgroundColor: theme.surface }] }>
          <Text style={[styles.cardTitle, { color: theme.textPrimary }]}>城市销售分布</Text>
          <View style={styles.pieContainer}>
            <PieChart
              data={salesData.salesByCity.map((item, index) => ({
                value: item.total,
                color: CHART_COLORS[index % CHART_COLORS.length],
              }))}
              donut
              radius={70}
              innerRadius={40}
               innerCircleColor={theme.surface}
               centerLabelComponent={() => (
                 <View style={{ alignItems: 'center' }}>
                   <Text style={{ fontSize: 14, fontWeight: '700', color: theme.textPrimary }}>
                     {salesData.salesByCity.reduce((s, c) => s + c.total, 0).toFixed(0)}
                   </Text>
                   <Text style={{ fontSize: 10, color: theme.textSecondary }}>总额</Text>
                 </View>
               )}
            />
            <View style={styles.legendContainer}>
              {salesData.salesByCity.map((item, index) => (
                <View key={item.city} style={styles.legendItem}>
                  <View style={[styles.legendDot, { backgroundColor: CHART_COLORS[index % CHART_COLORS.length] }]} />
                  <Text style={[styles.legendText, { color: theme.textSecondary }]}>{item.city}: {item.total.toFixed(0)}元</Text>
                </View>
              ))}
            </View>
          </View>
        </View>
      )}

      {!selectedStoreId && salesData.salesByStore.length > 0 && (
        <View style={[styles.card, { backgroundColor: theme.surface }] }>
          <Text style={[styles.cardTitle, { color: theme.textPrimary }]}>店铺销售分布</Text>
          <View style={styles.pieContainer}>
            <PieChart
              data={salesData.salesByStore.map((item, index) => ({
                value: item.total,
                color: CHART_COLORS[index % CHART_COLORS.length],
              }))}
              donut
              radius={70}
              innerRadius={40}
               innerCircleColor={theme.surface}
               centerLabelComponent={() => (
                 <View style={{ alignItems: 'center' }}>
                   <Text style={{ fontSize: 14, fontWeight: '700', color: theme.textPrimary }}>
                     {salesData.salesByStore.reduce((s, c) => s + c.total, 0).toFixed(0)}
                   </Text>
                   <Text style={{ fontSize: 10, color: theme.textSecondary }}>总额</Text>
                 </View>
               )}
            />
            <View style={styles.legendContainer}>
              {salesData.salesByStore.map((item, index) => (
                <View key={item.store} style={styles.legendItem}>
                  <View style={[styles.legendDot, { backgroundColor: CHART_COLORS[index % CHART_COLORS.length] }]} />
                  <Text style={[styles.legendText, { color: theme.textSecondary }]}>{item.store}: {item.total.toFixed(0)}元</Text>
                </View>
              ))}
            </View>
          </View>
        </View>
      )}
    </ScrollView>
  );

  const renderInventoryReport = () => (
    <ScrollView>
      <View style={[styles.card, { backgroundColor: theme.surface }] }>
        <Text style={[styles.cardTitle, { color: theme.textPrimary }]}>库存概览</Text>
        <View style={styles.statsRow}>
          <View style={styles.statItem}>
            <Text style={[styles.statValue, { color: theme.textPrimary }]}>{inventoryData.totalProducts}</Text>
            <Text style={[styles.statLabel, { color: theme.textSecondary }]}>商品种类</Text>
          </View>
          <View style={styles.statItem}>
            <Text style={[styles.statValue, { color: theme.textPrimary }]}>{inventoryData.totalQuantity}</Text>
            <Text style={[styles.statLabel, { color: theme.textSecondary }]}>总库存</Text>
          </View>
          <View style={styles.statItem}>
            <Text style={[styles.statValue, inventoryData.lowStockItems.length > 0 && styles.warningText]}>
              {inventoryData.lowStockItems.length}
            </Text>
            <Text style={[styles.statLabel, { color: theme.textSecondary }]}>库存不足</Text>
          </View>
        </View>
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

  const renderProfitReport = () => (
    <ScrollView>
      <View style={[styles.card, { backgroundColor: theme.surface }] }>
        <Text style={[styles.cardTitle, { color: theme.textPrimary }]}>利润概览</Text>
        <View style={styles.statsRow}>
          <View style={styles.statItem}>
            <Text style={[styles.statValue, { color: theme.textPrimary }]}>{profitData.totalRetailRevenue.toFixed(2)}元</Text>
            <Text style={[styles.statLabel, { color: theme.textSecondary }]}>零售总价</Text>
          </View>
          <View style={styles.statItem}>
            <Text style={[styles.statValue, { color: theme.textPrimary }]}>{profitData.totalDiscountRevenue.toFixed(2)}元</Text>
            <Text style={[styles.statLabel, { color: theme.textSecondary }]}>总收入(折扣)</Text>
          </View>
          <View style={styles.statItem}>
            <Text style={[styles.statValue, styles.profitText]}>{profitData.totalProfit.toFixed(2)}元</Text>
            <Text style={[styles.statLabel, { color: theme.textSecondary }]}>总利润</Text>
          </View>
        </View>
      </View>

      <View style={styles.exportRow}>
        <TouchableOpacity style={styles.exportButton} onPress={exportProfitExcel}>
          <Download size={14} color="#fff" />
          <Text style={styles.exportButtonText}>导出 Excel</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.exportButton} onPress={exportProfitPdf}>
          <Download size={14} color="#fff" />
          <Text style={styles.exportButtonText}>导出 PDF</Text>
        </TouchableOpacity>
      </View>

      <View style={[styles.card, { backgroundColor: theme.surface }] }>
        <Text style={[styles.cardTitle, { color: theme.textPrimary }]}>商品利润排行</Text>
        {profitData.profitByProduct.length > 0 ? (
          profitData.profitByProduct.map((item) => (
            <View key={item.name} style={[styles.profitItem, { borderBottomColor: theme.divider }]}>
              <View style={styles.profitItemHeader}>
                <TouchableOpacity onPress={() => showFullProductName(item.name)} activeOpacity={0.75} style={styles.profitNameTouchArea}>
                  <Text style={[styles.profitItemName, { color: theme.textPrimary }]} numberOfLines={1} ellipsizeMode="tail">
                    {item.name}
                  </Text>
                </TouchableOpacity>
                <Text style={[styles.profitItemValue, item.profit >= 0 ? styles.profitText : styles.lossText]}>
                  {item.profit.toFixed(2)}元
                </Text>
              </View>
              <View style={styles.profitDetails}>
                <Text style={[styles.profitDetailText, { color: theme.textSecondary }]}>零售总价: {item.retailRevenue.toFixed(2)}元</Text>
                <Text style={[styles.profitDetailText, { color: theme.textSecondary }]}>总收入: {item.discountRevenue.toFixed(2)}元</Text>
              </View>
              <View style={styles.profitDetails}>
                <Text style={[styles.profitDetailText, { color: theme.textSecondary }]}>总成本: {item.cost.toFixed(2)}元</Text>
              </View>
            </View>
          ))
        ) : (
          <View style={styles.emptyChartContainer}>
            <TrendingUp size={40} color={theme.textTertiary} strokeWidth={1.5} />
            <Text style={[styles.emptyText, { color: theme.textTertiary }]}>暂无利润数据</Text>
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

      {(selectedProvinceId || selectedCityId || selectedStoreId || selectedMonth !== 'all' || reportType !== 'sales') && (
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
            {reportType !== 'sales' && (
              <TouchableOpacity style={[styles.activeFilterChip, { backgroundColor: theme.surfaceSecondary }]} onPress={() => setReportType('sales')}>
                <Text style={[styles.activeFilterChipText, { color: theme.textSecondary }]}>类型: {reportTypeLabel} ×</Text>
              </TouchableOpacity>
            )}
          </ScrollView>
        </View>
      )}

      <View style={[styles.tabBar, { backgroundColor: theme.surface }]}> 
        {renderTabButton('sales', '销售报表')}
        {!isDistributor && renderTabButton('supply', '供货统计')}
        {!isDistributor && renderTabButton('inventory', '库存报表')}
        {!isDistributor && renderTabButton('profit', '利润报表')}
      </View>

      <View style={[styles.content, { backgroundColor: theme.background }]}> 
        {reportType === 'sales' && renderSalesReport()}
        {!isDistributor && reportType === 'supply' && renderSupplyReport()}
        {!isDistributor && reportType === 'inventory' && renderInventoryReport()}
        {!isDistributor && reportType === 'profit' && renderProfitReport()}
      </View>

      {floatingProductName ? (
        <View style={[styles.floatingNameBubble, { backgroundColor: theme.surface, borderColor: theme.border }] }>
          <Text style={[styles.floatingNameText, { color: theme.textPrimary }]} numberOfLines={2} ellipsizeMode="tail">
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
                {[
                  { key: 'sales', label: '销售报表' },
                  { key: 'supply', label: '供货统计' },
                  { key: 'inventory', label: '库存报表' },
                  { key: 'profit', label: '利润报表' },
                ].filter((item) => !isDistributor || item.key === 'sales').map((item) => (
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
                  setReportType('sales');
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
  statsRow: { flexDirection: 'row', justifyContent: 'space-around' },
  statItem: { alignItems: 'center' },
  statValue: { fontSize: 16, fontWeight: '700', color: Colors.textPrimary },
  statLabel: { fontSize: 12, color: Colors.textSecondary, marginTop: 4 },
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
    bottom: 18,
    borderRadius: Radius.md,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 10,
    ...Shadow.card,
  },
  floatingNameText: {
    fontSize: 13,
    fontWeight: '600',
    lineHeight: 18,
  },
});
