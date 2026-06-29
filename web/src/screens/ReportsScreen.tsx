import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Bar, BarChart, CartesianGrid, Cell, ComposedChart, Legend, Line, Pie, PieChart, ResponsiveContainer, Scatter, ScatterChart, Tooltip, XAxis, YAxis, ZAxis } from 'recharts';
import { AlertTriangle, DollarSign, Package, TrendingDown, TrendingUp } from 'lucide-react';
import { motion } from 'framer-motion';
import { ProvinceCityFilter } from '../components/ProvinceCityFilter';
import { useAppStore } from '../store/useAppStore';
import { useFinanceStore } from '../store/useFinanceStore';
import { buildMonthDateRange, buildMonthOptions } from '../utils/reportsMonth';
import { getProvinceForCity } from '../utils/provinceMapping';
import type { City, FinanceReportType } from '../types';

const colors = ['#FF6B9D', '#5B8DEF', '#82ca9d', '#ffc658', '#bb86fc'];
type ReportType = FinanceReportType;

const renderTurnoverScatterTooltip = (context: unknown): React.ReactNode => {
  const tooltip = context as {
    active?: boolean;
    payload?: Array<{
      payload?: {
        name?: string;
        cost?: number;
        turnoverDays?: number;
        dailySales?: number;
        category?: string;
      };
    }>;
  };

  if (!tooltip?.active || !Array.isArray(tooltip.payload) || tooltip.payload.length === 0) {
    return null;
  }

  const point = tooltip.payload.find((entry) => entry?.payload)?.payload;
  if (!point) return null;

  return (
    <div className="rounded-xl border border-white/10 bg-[#1a1a1c] px-3 py-2 text-white shadow-lg">
      <div className="text-sm font-semibold">
        {point.name || '未知商品'} ({point.category || '常规款'})
      </div>
      <div className="mt-1 text-xs text-white/80">
        成本¥{Number(point.cost || 0).toFixed(2)} / 可售{Number(point.turnoverDays || 0)}天 / 日均出库{Number(point.dailySales || 0).toFixed(2)}
      </div>
    </div>
  );
};

export const ReportsScreen: React.FC = () => {
  const {
    orders,
    products,
    stores,
    storeInventory,
    fetchStores,
    fetchStoreInventory,
    fetchAllStoreInventory,
    fetchOrders,
    user,
    generateCityChannelReport,
    generateProductDetailReport,
    generatePaymentReport,
    createSlowMovingAlertNotification,
  } = useAppStore();
  const { transactions, cashBalance, fetchTransactions, fetchBalance } = useFinanceStore();
  const isDistributor = user?.role === 'distributor';
  const [reportType, setReportType] = useState<ReportType>(user?.role === 'distributor' ? 'supply' : 'finance');
  const [selectedProvinceId, setSelectedProvinceId] = useState<string | null>(null);
  const [selectedCityId, setSelectedCityId] = useState<string | null>(null);
  const [selectedStoreId, setSelectedStoreId] = useState<string | null>(null);
  const [selectedMonth, setSelectedMonth] = useState<string>('all');
  const [allModeMonthOptions, setAllModeMonthOptions] = useState<string[]>([]);
  const selectedStore = useMemo(() => stores.find((store) => store.id === selectedStoreId) || null, [stores, selectedStoreId]);
  const slowMovingAlertScopeRef = useRef<string | null>(null);
  const slowMovingAlertTriggeredRef = useRef(false);
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
  const getOrderCityKey = (order: { city_id?: string | null; city_name?: string | null }): string => {
    if (order.city_id) return order.city_id;
    const fallbackName = String(order.city_name || '').trim();
    return fallbackName ? `name:${fallbackName}` : '';
  };
  const isRefundLikeOrder = (order: { payment_status?: string | null; refunded_items?: unknown }): boolean => {
    const paymentStatus = String(order.payment_status || '').toLowerCase();
    if (paymentStatus.includes('refund')) return true;
    const refundedItems = Array.isArray(order.refunded_items) ? order.refunded_items : [];
    return refundedItems.length > 0;
  };
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

  const reportCities = useMemo<City[]>(() => {
    const map = new Map<string, City>();
    stores.forEach((store) => {
      if (!store.city_id || map.has(store.city_id)) return;
      const cityName = store.city_name || '未知城市';
      map.set(store.city_id, {
        id: store.city_id,
        name: cityName,
        province: getProvinceForCity(cityName) || undefined,
        created_at: '',
      });
    });

    orders.forEach((order) => {
      const cityKey = getOrderCityKey(order);
      if (!cityKey || map.has(cityKey)) return;
      const cityName = String(order.city_name || '').trim() || '未知城市';
      map.set(cityKey, {
        id: cityKey,
        name: cityName,
        province: getProvinceForCity(cityName) || undefined,
        created_at: '',
      });
    });

    return Array.from(map.values());
  }, [orders, stores]);

  const reportCityProvinceMap = useMemo(() => {
    const map = new Map<string, string | null>();
    reportCities.forEach((city) => {
      map.set(city.id, city.province || null);
    });
    return map;
  }, [reportCities]);

  const filteredStores = useMemo(() => {
    const provinceFiltered = selectedProvinceId
      ? stores.filter((store) => {
          const province = reportCityProvinceMap.get(store.city_id) || getProvinceForCity(store.city_name || '');
          return selectedProvinceId === '未知省份' ? !province : province === selectedProvinceId;
        })
      : stores;
    if (selectedCityId && selectedCityId.startsWith('name:')) return [];
    return selectedCityId ? provinceFiltered.filter((store) => store.city_id === selectedCityId) : provinceFiltered;
  }, [reportCityProvinceMap, selectedCityId, selectedProvinceId, stores]);
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
    if (selectedStore?.name) {
      scopeParts.push(selectedStore.name);
    }
    if (selectedMonth !== 'all') {
      scopeParts.push(`${selectedMonth} 月`);
    }
    return scopeParts.length > 0 ? scopeParts.join(' / ') : '全部范围';
  }, [reportCities, selectedCityId, selectedMonth, selectedProvinceId, selectedStore]);

  useEffect(() => {
    void fetchStores();
    void fetchTransactions();
    void fetchBalance();
  }, [fetchBalance, fetchStores, fetchTransactions]);

  useEffect(() => {
    if (selectedMonth === 'all') {
      void fetchOrders();
      return;
    }

    const monthRange = buildMonthDateRange(selectedMonth);
    if (!monthRange) {
      void fetchOrders();
      return;
    }

    void fetchOrders(monthRange.startDate, monthRange.endDate);
  }, [fetchOrders, selectedMonth]);

  useEffect(() => {
    if (selectedMonth !== 'all') return;
    setAllModeMonthOptions(buildMonthOptions(orders));
  }, [orders, selectedMonth]);

  useEffect(() => {
    if (!selectedStoreId) return;
    void fetchStoreInventory(selectedStoreId);
  }, [selectedStoreId, fetchStoreInventory]);

  useEffect(() => {
    if (reportType !== 'inventory_turnover') return;
    if (selectedStoreId) return;
    void fetchAllStoreInventory();
  }, [fetchAllStoreInventory, reportType, selectedStoreId]);

  useEffect(() => {
    if (!selectedStoreId) return;
    if (!filteredStores.some((store) => store.id === selectedStoreId)) {
      setSelectedStoreId(null);
    }
  }, [filteredStores, selectedStoreId]);

  useEffect(() => {
    if (reportTabs.some((item) => item.key === reportType)) {
      return;
    }

    setReportType(reportTabs[0]?.key || 'sales');
  }, [reportTabs, reportType]);


  const { stats, profitData, supplyData, turnoverData, revenueData, sellThroughData, salesSummary } = useMemo(() => {
    const provinceScopedOrders = selectedProvinceId
      ? orders.filter((order) => {
          const province = reportCityProvinceMap.get(order.city_id || '') || getProvinceForCity(order.city_name || '');
          return selectedProvinceId === '未知省份' ? !province : province === selectedProvinceId;
        })
      : orders;
    const cityScopedOrders = selectedCityId
      ? provinceScopedOrders.filter((order) => getOrderCityKey(order) === selectedCityId)
      : provinceScopedOrders;
    const scopedOrders = selectedStoreId ? cityScopedOrders.filter((order) => order.store_id === selectedStoreId) : cityScopedOrders;
    const revenueOrders = scopedOrders.filter((order) => {
      const isRevenueKind = order.order_kind === 'settlement' || order.order_kind === 'retail';
      if (!isRevenueKind) return false;
      return !isRefundLikeOrder(order);
    });
    const totalRetail = revenueOrders.reduce((sum, order) => sum + Number(order.total_retail_amount || 0), 0);
    const totalDiscount = revenueOrders.reduce((sum, order) => sum + Number(order.total_discount_amount || 0), 0);
    const pendingCount = scopedOrders.filter((order) => order.status === 'pending').length;
    const supplyOrders = scopedOrders.filter((order) => order.order_kind === 'distribution');

    const cityMap = new Map<string, number>();
    const productAmountMap = new Map<string, number>();
    const productVolumeMap = new Map<string, number>();
    const productVolumeByIdMap = new Map<string, number>();

    revenueOrders.forEach((order) => {
      const cityName = order.city_name || '未知';
      cityMap.set(cityName, (cityMap.get(cityName) || 0) + Number(order.total_discount_amount || 0));

      order.items.forEach((item) => {
        if (item.is_sample) return;
        const key = item.product_name || item.product_id;
        const productIdKey = item.product_id;
        const itemQty = Number(item.quantity || 0);
        const itemAmount = Number(item.discount_price || 0) * itemQty;
        productAmountMap.set(key, (productAmountMap.get(key) || 0) + itemAmount);
        productVolumeMap.set(key, (productVolumeMap.get(key) || 0) + itemQty);
        productVolumeByIdMap.set(productIdKey, (productVolumeByIdMap.get(productIdKey) || 0) + itemQty);
      });
    });

    const sortedCities = Array.from(cityMap.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6)
      .map(([name, value]) => ({ name, value }));

    const storeMap = new Map<string, number>();
    revenueOrders.forEach((order) => {
      const storeName = order.store_name || '未知店铺/历史订单';
      storeMap.set(storeName, (storeMap.get(storeName) || 0) + Number(order.total_discount_amount || 0));
    });

    const sortedStores = Array.from(storeMap.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([name, value]) => ({ name, value }));

    const trendMap = new Map<string, number>();
    revenueOrders.forEach((order) => {
      const date = new Date(order.created_at);
      let key = '';
      if (selectedMonth === 'all') {
        key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
      } else {
        key = `${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
      }
      trendMap.set(key, (trendMap.get(key) || 0) + Number(order.total_discount_amount || 0));
    });

    const trend = Array.from(trendMap.entries())
      .map(([label, value]) => ({ label, value }))
      .sort((a, b) => a.label.localeCompare(b.label));

    const compositionByStore = Array.from(storeMap.entries())
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value);

    const compositionByCity = Array.from(cityMap.entries())
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value);

    const revenueData = {
      totalRevenue: totalDiscount,
      totalOrders: revenueOrders.length,
      trend,
      compositionByStore,
      compositionByCity,
    };

    const sortedProductAmount = Array.from(productAmountMap.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 15)
      .map(([name, value]) => ({ name, value }));

    const sortedProductVolume = Array.from(productVolumeMap.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 15)
      .map(([name, value]) => ({ name, value }));

    const sellThroughProducts = selectedStoreId
      ? Array.from(new Map(storeInventory.map((item) => [item.product_id, { id: item.product_id, name: item.product_name || '未知' }])).values())
      : products.map((product) => ({ id: product.id, name: product.name }));
    const activeSkuCount = sellThroughProducts.filter((product) => (productVolumeByIdMap.get(product.id) || 0) > 0).length;
    const totalSkuCount = sellThroughProducts.length;
    const sellThroughRate = totalSkuCount > 0 ? activeSkuCount / totalSkuCount : 0;

    const productProfit: Record<string, {
      name: string;
      quantity: number;
      retailPrice: number;
      retailRevenue: number;
      discountPrice: number;
      discountRevenue: number;
      unitCostTotal: number;
      sampleCostTotal: number;
      oneTimeCost: number;
    }> = {};

    revenueOrders.forEach((order) => {
      order.items.forEach((item) => {
        const key = item.product_id;
        if (!productProfit[key]) {
          productProfit[key] = {
            name: item.product_name || item.product_id,
            quantity: 0,
            retailPrice: Number(item.retail_price || 0),
            retailRevenue: 0,
            discountPrice: Number(item.discount_price || 0),
            discountRevenue: 0,
            unitCostTotal: 0,
            sampleCostTotal: 0,
            oneTimeCost: Number(item.one_time_cost || 0),
          };
        }

        productProfit[key].quantity += Number(item.quantity || 0);
        if (item.is_sample) {
          productProfit[key].sampleCostTotal += Number(item.quantity || 0) * Number(item.unit_cost || 0);
        } else {
          productProfit[key].retailRevenue += Number(item.quantity || 0) * Number(item.retail_price || 0);
          productProfit[key].discountRevenue += Number(item.quantity || 0) * Number(item.discount_price || 0);
          productProfit[key].unitCostTotal += Number(item.quantity || 0) * Number(item.unit_cost || 0);
        }
        if (productProfit[key].oneTimeCost === 0) {
          productProfit[key].oneTimeCost = Number(item.one_time_cost || 0);
        }
      });
    });

    const profitByProduct = Object.values(productProfit)
      .map((entry) => {
        const cost = entry.unitCostTotal + entry.sampleCostTotal + entry.oneTimeCost;
        return {
          name: entry.name,
          quantity: entry.quantity,
          retailPrice: entry.retailPrice,
          retailRevenue: entry.retailRevenue,
          discountPrice: entry.discountPrice,
          discountRevenue: entry.discountRevenue,
          cost,
          profit: entry.discountRevenue - cost,
        };
      })
      .sort((a, b) => b.profit - a.profit);

    const totalRetailRevenue = profitByProduct.reduce((sum, row) => sum + row.retailRevenue, 0);
    const totalDiscountRevenue = profitByProduct.reduce((sum, row) => sum + row.discountRevenue, 0);
    const totalCost = profitByProduct.reduce((sum, row) => sum + row.cost, 0);

    const globalSeenProductsForTrend = new Set<string>();
    const profitTrendMap = new Map<string, { revenue: number; cost: number }>();
    
    const sortedRevenueOrders = [...revenueOrders].sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
    
    sortedRevenueOrders.forEach((order) => {
      const date = new Date(order.created_at);
      let key = '';
      if (selectedMonth === 'all') {
        key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
      } else {
        key = `${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
      }
      
      if (!profitTrendMap.has(key)) {
        profitTrendMap.set(key, { revenue: 0, cost: 0 });
      }
      const trendEntry = profitTrendMap.get(key)!;
      
      order.items.forEach((item) => {
        const qty = Number(item.quantity || 0);
        if (item.is_sample) {
          trendEntry.cost += qty * Number(item.unit_cost || 0);
        } else {
          trendEntry.revenue += qty * Number(item.discount_price || 0);
          trendEntry.cost += qty * Number(item.unit_cost || 0);
        }
        
        if (!globalSeenProductsForTrend.has(item.product_id)) {
          globalSeenProductsForTrend.add(item.product_id);
          trendEntry.cost += Number(item.one_time_cost || 0);
        }
      });
    });

    const profitTrend = Array.from(profitTrendMap.entries())
      .map(([label, data]) => {
        const profit = data.revenue - data.cost;
        const marginRate = data.revenue > 0 ? (profit / data.revenue) * 100 : 0;
        return {
          label,
          profit,
          marginRate: Number(marginRate.toFixed(2))
        };
      })
      .sort((a, b) => a.label.localeCompare(b.label));
    const supplyStoreMap = new Map<string, number>();
    const supplyProductMap = new Map<string, number>();
    let totalSupplyQuantity = 0;

    supplyOrders.forEach((order) => {
      const storeName = order.store_name || '未知店铺/历史订单';
      const orderSupplyQty = order.items
        .filter((item) => !item.is_sample)
        .reduce((sum, item) => sum + Number(item.quantity || 0), 0);
      supplyStoreMap.set(storeName, (supplyStoreMap.get(storeName) || 0) + orderSupplyQty);

      order.items.forEach((item) => {
        if (item.is_sample) return;
        const productName = item.product_name || item.product_id;
        const quantity = Number(item.quantity || 0);
        supplyProductMap.set(productName, (supplyProductMap.get(productName) || 0) + quantity);
        totalSupplyQuantity += quantity;
      });
    });

    const supplyTopProducts = Array.from(supplyProductMap.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([name, value]) => ({ name, value }));

    const supplyByStore = Array.from(supplyStoreMap.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([name, value]) => ({ name, value }));

    const turnoverOrders = scopedOrders.filter((order) => {
      const isTurnoverKind = order.order_kind === 'retail' || order.order_kind === 'settlement';
      return isTurnoverKind && !isRefundLikeOrder(order);
    });

    let periodDays = 30;
    if (selectedMonth !== 'all') {
      const [year, month] = selectedMonth.split('-');
      periodDays = new Date(Number(year), Number(month), 0).getDate();
    } else if (turnoverOrders.length > 0) {
      const earliest = Math.min(...turnoverOrders.map((order) => new Date(order.created_at).getTime()));
      const latest = Math.max(...turnoverOrders.map((order) => new Date(order.created_at).getTime()));
      periodDays = Math.max(1, Math.ceil((latest - earliest) / (1000 * 60 * 60 * 24)));
    }

    const nowMs = Date.now();
    const threeMonthsAgo = nowMs - 90 * 24 * 60 * 60 * 1000;
    const productSalesVolume: Record<string, number> = {};
    const productRecentSalesVolume: Record<string, number> = {};

    turnoverOrders.forEach((order) => {
      const soldAt = new Date(order.created_at).getTime();
      order.items.forEach((item) => {
        if (item.is_sample || Number(item.quantity || 0) <= 0) return;
        const productId = item.product_id;
        const quantity = Number(item.quantity || 0);
        productSalesVolume[productId] = (productSalesVolume[productId] || 0) + quantity;
        if (soldAt >= threeMonthsAgo) {
          productRecentSalesVolume[productId] = (productRecentSalesVolume[productId] || 0) + quantity;
        }
      });
    });

    const cityNameByKey = new Map<string, string>();
    reportCities.forEach((city) => cityNameByKey.set(city.id, city.name));

    const getStoreProvince = (store: typeof stores[number]): string | null => {
      const province = reportCityProvinceMap.get(store.city_id) || getProvinceForCity(store.city_name || '');
      return province || null;
    };

    const getStoreCityName = (store: typeof stores[number]): string => {
      return store.city_name || cityNameByKey.get(store.city_id) || '未知城市';
    };

    const scopedStoreIds = new Set(filteredStores.map((store) => store.id));

    const isYunchuangStoreSelected = Boolean(selectedStoreId && (selectedStore?.name || '').includes('云窗'));

    const storeInventoryQtyByProduct: Record<string, number> = {};
    storeInventory.forEach((item) => {
      if (!scopedStoreIds.has(item.store_id)) return;
      const productId = item.product_id;
      storeInventoryQtyByProduct[productId] = (storeInventoryQtyByProduct[productId] || 0) + Number(item.quantity || 0);
    });

    const yunchuangStoreIds = new Set(
      filteredStores
        .filter((store) => scopedStoreIds.has(store.id))
        .filter((store) => {
          const cityName = getStoreCityName(store);
          return cityName.includes('郴州') && store.name.includes('云窗');
        })
        .map((store) => store.id),
    );
    const yunchuangQtyByProduct: Record<string, number> = {};
    storeInventory.forEach((item) => {
      if (!yunchuangStoreIds.has(item.store_id)) return;
      const productId = item.product_id;
      yunchuangQtyByProduct[productId] = (yunchuangQtyByProduct[productId] || 0) + Number(item.quantity || 0);
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

    const productIds = new Set<string>([
      ...products.map((product) => product.id),
      ...Object.keys(storeInventoryQtyByProduct),
      ...Object.keys(productSalesVolume),
    ]);

    const uniqueProducts = Array.from(productIds).map((productId) => {
      const product = products.find((row) => row.id === productId);
      const rawWarehouseQty = Number(warehouseQtyByProduct[productId] || 0);
      const scopedStoreQty = Number(storeInventoryQtyByProduct[productId] || 0);
      const yunchuangStoreQty = Number(yunchuangQtyByProduct[productId] || 0);
      const dedupeQty = yunchuangStoreQty;

      let inventoryQty = 0;
      if (selectedStoreId && !isYunchuangStoreSelected) {
        inventoryQty = scopedStoreQty;
      } else {
        inventoryQty = Math.max(rawWarehouseQty - dedupeQty, 0) + scopedStoreQty;
      }

      return {
        id: productId,
        name: product?.name || storeInventory.find((item) => item.product_id === productId)?.product_name || '未知',
        cost: Number(product?.cost || 0),
        series: product?.series_name || '未知',
        inventoryQty,
      };
    });

    const sortedByVolume = [...uniqueProducts].sort(
      (a, b) => (productSalesVolume[b.id] || 0) - (productSalesVolume[a.id] || 0),
    );
    const top10PercentCount = Math.max(1, Math.floor(uniqueProducts.length * 0.1));
    const hotProductIds = new Set(sortedByVolume.slice(0, top10PercentCount).map((product) => product.id));

    let slowMovingCost = 0;
    let totalInventoryCost = 0;
    let hotCost = 0;
    let regularCost = 0;

    const scatterData: Array<{
      id: string;
      name: string;
      cost: number;
      turnoverDays: number;
      category: string;
      dailySales: number;
    }> = [];
    const seriesTurnover: Record<string, { totalDays: number; count: number }> = {};
    let totalTurnoverDays = 0;
    let validTurnoverCount = 0;

    uniqueProducts.forEach((product) => {
      const volume = Number(productSalesVolume[product.id] || 0);
      const recentSales = Number(productRecentSalesVolume[product.id] || 0);
      const dailySales = periodDays > 0 ? volume / periodDays : 0;
      const sellableDays = dailySales > 0 ? product.inventoryQty / dailySales : Number.POSITIVE_INFINITY;
      const turnoverDays = Number.isFinite(sellableDays) ? Math.max(1, Math.round(sellableDays)) : 999;

      let category = '常规款';
      if (hotProductIds.has(product.id) && volume > 0) {
        category = '热销款';
      } else if (recentSales < 10) {
        category = '滞销款';
      }

      const inventoryCost = product.inventoryQty * Number(product.cost || 0);
      totalInventoryCost += inventoryCost;
      if (category === '滞销款') slowMovingCost += inventoryCost;
      else if (category === '热销款') hotCost += inventoryCost;
      else regularCost += inventoryCost;

      if (turnoverDays !== 999) {
        scatterData.push({
          id: product.id,
          name: product.name,
          cost: Number(product.cost || 0),
          turnoverDays,
          category,
          dailySales,
        });
        totalTurnoverDays += turnoverDays;
        validTurnoverCount += 1;

        if (!seriesTurnover[product.series]) {
          seriesTurnover[product.series] = { totalDays: 0, count: 0 };
        }
        seriesTurnover[product.series].totalDays += turnoverDays;
        seriesTurnover[product.series].count += 1;
      }
    });

    const avgTurnoverDays = validTurnoverCount > 0 ? Math.round(totalTurnoverDays / validTurnoverCount) : 0;
    const seriesAvgTurnover = Object.entries(seriesTurnover).map(([series, data]) => ({
      series,
      avgDays: Math.round(data.totalDays / data.count)
    })).sort((a, b) => a.avgDays - b.avgDays);

    const pieData = [
      { name: '热销款', value: hotCost, color: '#FF6B9D' },
      { name: '常规款', value: regularCost, color: '#5B8DEF' },
      { name: '滞销款', value: slowMovingCost, color: '#ffc658' }
    ].filter(d => d.value > 0);

    const slowMovingRatio = totalInventoryCost > 0 ? slowMovingCost / totalInventoryCost : 0;
    const isSlowMovingAlert = slowMovingRatio > 0.15;

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

    let drillDownData: Array<{ name: string; rate: number }> = [];
    let drillDownLevel = 'province';

    if (selectedStoreId) {
      drillDownLevel = 'product';
      drillDownData = uniqueProducts.map((product) => {
        const salesQty = Number(productSalesVolume[product.id] || 0);
        const inventoryQty = Number(product.inventoryQty || 0);
        const rate = inventoryQty > 0 ? Math.round((salesQty / inventoryQty) * 100) : 0;
        return {
          name: product.name,
          rate,
        };
      }).sort((a, b) => b.rate - a.rate).slice(0, 10);
    } else if (selectedCityId) {
      drillDownLevel = 'store';
      const storesInCity = filteredStores.filter((store) => store.city_id === selectedCityId);
      const cityScopedTotalSkus = uniqueProducts.filter((product) => Number(product.inventoryQty || 0) > 0).length;
      drillDownData = storesInCity.map((store) => {
        const storeOrders = cityScopedOrders.filter((order) => order.store_id === store.id);
        const storeActiveSkus = new Set<string>();
        storeOrders.forEach((order) =>
          order.items.forEach((item) => {
            if (!item.is_sample && Number(item.quantity || 0) > 0) storeActiveSkus.add(item.product_id);
          }),
        );
        const isYunchuangStore = store.name.includes('云窗') && getStoreCityName(store).includes('郴州');
        const storeTotalSkus = isYunchuangStore
          ? cityScopedTotalSkus
          : storeInventory.filter((inventory) => inventory.store_id === store.id && Number(inventory.quantity || 0) > 0).length;
        return {
          name: store.name,
          rate: storeTotalSkus > 0 ? Math.round((storeActiveSkus.size / storeTotalSkus) * 100) : 0
        };
      }).sort((a, b) => b.rate - a.rate);
    } else if (selectedProvinceId) {
      drillDownLevel = 'city';
      const citiesInProvince = reportCities.filter(c => (selectedProvinceId === '未知省份' ? !c.province : c.province === selectedProvinceId));
      drillDownData = citiesInProvince.map(c => {
        const cityOrders = provinceScopedOrders.filter(o => getOrderCityKey(o) === c.id);
        const cityActiveSkus = new Set();
        cityOrders.forEach(o => o.items.forEach(i => { if (!i.is_sample && Number(i.quantity || 0) > 0) cityActiveSkus.add(i.product_id); }));
        const cityTotalSkus = cityInventorySkuMap.get(c.id)?.size || 0;
        return {
          name: c.name,
          rate: cityTotalSkus > 0 ? Math.round((cityActiveSkus.size / cityTotalSkus) * 100) : 0
        };
      }).sort((a, b) => b.rate - a.rate);
    } else {
      drillDownLevel = 'province';
      const provinces = Array.from(new Set(reportCities.map(c => c.province || '未知省份')));
      drillDownData = provinces.map(prov => {
        const provOrders = orders.filter(o => {
          const p = reportCityProvinceMap.get(getOrderCityKey(o)) || getProvinceForCity(o.city_name || '');
          return prov === '未知省份' ? !p : p === prov;
        });
        const provActiveSkus = new Set();
        provOrders.forEach(o => o.items.forEach(i => { if (!i.is_sample && Number(i.quantity || 0) > 0) provActiveSkus.add(i.product_id); }));
        const provinceTotalSkus = provinceInventorySkuMap.get(prov)?.size || 0;
        return {
          name: prov,
          rate: provinceTotalSkus > 0 ? Math.round((provActiveSkus.size / provinceTotalSkus) * 100) : 0
        };
      }).sort((a, b) => b.rate - a.rate);
    }

    const turnoverData = {
      scatterData,
      avgTurnoverDays,
      seriesAvgTurnover,
      pieData,
      slowMovingCost,
      slowMovingRatio,
      totalInventoryCost,
      isSlowMovingAlert,
      drillDownData,
      drillDownLevel
    };

    const salesSummary = {
      totalSalesAmount: scopedOrders.reduce((sum, order) => sum + Number(order.total_discount_amount || 0), 0),
      orderCount: scopedOrders.length,
      pendingCount,
    };

    return {
      stats: [
        { label: '总零售额（结算+零售，已排除退款单）', value: `¥${totalRetail.toFixed(2)}`, icon: DollarSign, trend: `有效营收订单 ${revenueOrders.length} 笔`, isUp: true },
        { label: '折扣成交额（结算+零售，已排除退款单）', value: `¥${totalDiscount.toFixed(2)}`, icon: Package, trend: `待处理 ${pendingCount} 笔`, isUp: true },
        { label: '折扣差额', value: `¥${(totalRetail - totalDiscount).toFixed(2)}`, icon: TrendingUp, trend: '零售额 - 折扣额', isUp: totalRetail - totalDiscount >= 0 },
        { label: '待处理订单', value: String(pendingCount), icon: TrendingDown, trend: 'pending', isUp: pendingCount === 0 },
      ],
      revenueData,
      sellThroughData: {
        activeSkuCount,
        totalSkuCount,
        sellThroughRate,
      },
      productVolumeRanking: sortedProductVolume,
      cityData: sortedCities,
      storeData: sortedStores,
      productAmountRanking: sortedProductAmount,
      profitData: {
        totalRetailRevenue,
        totalDiscountRevenue,
        totalCost,
        totalProfit: totalDiscountRevenue - totalCost,
        profitByProduct,
        profitTrend,
      },
      supplyData: {
        totalOrders: supplyOrders.length,
        totalQuantity: totalSupplyQuantity,
        topProducts: supplyTopProducts,
        byStore: supplyByStore,
      },
      turnoverData,
      salesSummary,
    };
  }, [isRefundLikeOrder, orders, products, reportCityProvinceMap, selectedCityId, selectedProvinceId, selectedStore, selectedStoreId, storeInventory]);

  useEffect(() => {
    if (reportType !== 'inventory_turnover') {
      slowMovingAlertTriggeredRef.current = false;
      slowMovingAlertScopeRef.current = null;
      return;
    }
    if (!user || user.role === 'distributor') return;
    if (slowMovingAlertTriggeredRef.current) return;
    slowMovingAlertTriggeredRef.current = true;
    if (!turnoverData.isSlowMovingAlert || turnoverData.totalInventoryCost <= 0) return;

    slowMovingAlertScopeRef.current = '全部范围';
    void (async () => {
      const { error } = await createSlowMovingAlertNotification({
        scopeLabel: '全部范围',
        slowMovingRatio: turnoverData.slowMovingRatio,
        slowMovingCost: turnoverData.slowMovingCost,
        totalInventoryCost: turnoverData.totalInventoryCost,
      });
      if (error) {
        slowMovingAlertTriggeredRef.current = false;
        slowMovingAlertScopeRef.current = null;
      }
    })();
  }, [
    createSlowMovingAlertNotification,
    reportType,
    turnoverData.isSlowMovingAlert,
    turnoverData.slowMovingCost,
    turnoverData.slowMovingRatio,
    turnoverData.totalInventoryCost,
    user,
  ]);

  const financeData = useMemo(() => {
    const validStoreIds = new Set(filteredStores.map(s => s.id));
    const scopedTransactions = transactions.filter(t => {
      if (selectedStoreId) return t.store_id === selectedStoreId;
      if (selectedCityId || selectedProvinceId) return t.store_id && validStoreIds.has(t.store_id);
      return true;
    });

    const monthFilteredTransactions = selectedMonth === 'all'
      ? scopedTransactions
      : scopedTransactions.filter(t => {
          const monthStr = t.transaction_date.substring(0, 7);
          return monthStr === selectedMonth;
        });

    const totalIncome = monthFilteredTransactions
      .filter(t => t.transaction_type === 'income')
      .reduce((sum, t) => sum + Number(t.amount || 0), 0);

    const totalExpense = monthFilteredTransactions
      .filter(t => t.transaction_type === 'expense')
      .reduce((sum, t) => sum + Number(t.amount || 0), 0);

    const netIncome = totalIncome - totalExpense;
    const incomeByCategory = new Map<string, number>();
    const expenseByCategory = new Map<string, number>();

    monthFilteredTransactions.forEach((transaction) => {
      const category = transaction.category || '未分类';
      if (transaction.transaction_type === 'income') {
        incomeByCategory.set(category, (incomeByCategory.get(category) || 0) + Number(transaction.amount || 0));
      } else if (transaction.transaction_type === 'expense') {
        expenseByCategory.set(category, (expenseByCategory.get(category) || 0) + Number(transaction.amount || 0));
      }
    });

    const topIncomeCategories = Array.from(incomeByCategory.entries())
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 6);

    const topExpenseCategories = Array.from(expenseByCategory.entries())
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 6);

    return {
      totalIncome,
      totalExpense,
      netIncome,
      transactionCount: monthFilteredTransactions.length,
      topIncomeCategories,
      topExpenseCategories,
    };
  }, [filteredStores, selectedCityId, selectedMonth, selectedProvinceId, selectedStoreId, transactions]);

  const inventorySummary = useMemo(() => {
    if (!selectedStoreId) return null;
    const lowStockCount = storeInventory.filter((item) => {
      const product = products.find((row) => row.id === item.product_id);
      const min = product?.min_quantity ?? 10;
      return Number(item.quantity || 0) < min;
    }).length;
    return {
      totalProducts: storeInventory.length,
      totalQuantity: storeInventory.reduce((sum, item) => sum + Number(item.quantity || 0), 0),
      lowStockCount,
    };
  }, [products, selectedStoreId, storeInventory]);

  const exportBusinessData = async (): Promise<void> => {
    try {
      await fetchAllStoreInventory();
      const excelModule = await import('exceljs');
      const ExcelJS = 'default' in excelModule ? excelModule.default : excelModule;
      const workbook = new ExcelJS.Workbook();
      const centered = { horizontal: 'center' as const, vertical: 'middle' as const };

      const addSheet = (name: string, headers: string[], rows: Array<Array<string | number | null>>): void => {
        const worksheet = workbook.addWorksheet(name);
        worksheet.columns = headers.map((header) => ({ width: Math.max(12, header.length * 2 + 4) }));
        worksheet.addRow(headers);
        rows.forEach((row) => {
          worksheet.addRow(row);
        });
        worksheet.eachRow((row) => {
          row.eachCell((cell) => {
            cell.alignment = centered;
          });
        });
      };

      const cityRows = generateCityChannelReport().map((row) => [
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

      const detailRows = generateProductDetailReport().map((row) => [
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

      const paymentRows = generatePaymentReport(transactions).map((row) => [
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

      addSheet(
      '文创工作室多城市渠道库存&销售汇总表',
      ['序号', '城市', '城市分级', '渠道门店名称', '合作模式', '月总销售件数', '上月同期销量', '环比增长率', '供货营收', '库存总货值', 'sku动销率', '结算账期'],
      cityRows,
    );
      addSheet(
      '文创单品多城市库存&销售明细表',
      ['序号', '城市', '渠道门店', 'SKU编号', '产品名称', '品类', '单位成本', '供货价', '终端售价', '当前实物库存', '预留库存', '总可用库存', '安全库存阈值', '本月销量', '上月销量', '库存周转天数', '滞销标记', '单品毛利'],
      detailRows,
    );
    addSheet(
      '文创渠道回款对账表',
      ['序号', '城市', '渠道门店', '对账周期', '应收货款', '已回款金额', '未结欠款', '逾期天数', '渠道扣点费用', '实际毛利额', '回款状态'],
      paymentRows,
    );

      const buffer = await workbook.xlsx.writeBuffer({ useStyles: true });
      const blob = new Blob([buffer], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      const now = new Date();
      const timestamp = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}-${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}${String(now.getSeconds()).padStart(2, '0')}`;
      link.href = url;
      link.download = `云窗渠道库存销售管理表-${timestamp}.xlsx`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } finally {
      if (selectedStoreId) {
        await fetchStoreInventory(selectedStoreId);
      }
    }
  };


  return (
    <div className="space-y-8">
      <div className="bg-white/5 border border-white/10 rounded-2xl p-4">
        <p className="text-sm text-white/60 mb-2">月份筛选</p>
        <div className="flex flex-wrap gap-2">
          {monthOptions.map((monthOption) => (
            <button
              key={monthOption}
              type="button"
              onClick={() => setSelectedMonth(monthOption)}
              className={`px-3 py-1.5 rounded-xl border text-sm ${selectedMonth === monthOption ? 'bg-accent/20 border-accent/40 text-accent' : 'bg-white/5 border-white/10 text-white/70 hover:text-white'}`}
            >
              {monthOption === 'all' ? '全部' : monthOption}
            </button>
          ))}
        </div>
      </div>

      {!isDistributor && stores.length > 0 && (
        <div className="bg-white/5 border border-white/10 rounded-2xl p-4">
          <div className="mb-3">
            <ProvinceCityFilter
              cities={reportCities}
              selectedProvinceId={selectedProvinceId}
              selectedCityId={selectedCityId}
              onProvinceChange={setSelectedProvinceId}
              onCityChange={setSelectedCityId}
              showProvince
            />
          </div>
          <p className="text-sm text-white/60 mb-2">店铺筛选</p>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setSelectedStoreId(null)}
              className={`px-3 py-1.5 rounded-xl border text-sm ${!selectedStoreId ? 'bg-accent/20 border-accent/40 text-accent' : 'bg-white/5 border-white/10 text-white/70 hover:text-white'}`}
            >
              全部店铺
            </button>
            {filteredStores.map((store) => (
              <button
                key={store.id}
                type="button"
                onClick={() => setSelectedStoreId(store.id)}
                className={`px-3 py-1.5 rounded-xl border text-sm ${selectedStoreId === store.id ? 'bg-accent/20 border-accent/40 text-accent' : 'bg-white/5 border-white/10 text-white/70 hover:text-white'}`}
              >
                {store.name}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2 flex-wrap">
          {reportTabs.map((tab) => (
            <button
              key={tab.key}
              type="button"
              onClick={() => setReportType(tab.key)}
              className={`px-4 py-2 rounded-xl border text-sm font-semibold ${reportType === tab.key ? 'bg-accent/20 border-accent/40 text-accent' : 'bg-white/5 border-white/10 text-white/70 hover:text-white'}`}
            >
              {tab.label}
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={() => { void exportBusinessData(); }}
          className="px-4 py-2 rounded-xl border border-accent/40 bg-accent/20 text-accent font-semibold"
        >
          导出经营数据
        </button>
      </div>

      {reportType === 'inventory_turnover' && inventorySummary && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div className="bg-white/5 border border-white/10 rounded-2xl p-4">
            <p className="text-xs text-white/50">店铺商品数</p>
            <p className="text-xl font-black">{inventorySummary.totalProducts}</p>
          </div>
          <div className="bg-white/5 border border-white/10 rounded-2xl p-4">
            <p className="text-xs text-white/50">店铺总库存</p>
            <p className="text-xl font-black">{inventorySummary.totalQuantity}</p>
          </div>
          <div className="bg-white/5 border border-white/10 rounded-2xl p-4">
            <p className="text-xs text-white/50">店铺低库存</p>
            <p className="text-xl font-black text-red-300">{inventorySummary.lowStockCount}</p>
          </div>
        </div>
      )}

      {reportType === 'finance' && (
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        {stats.map((stat, index) => {
          const Icon = stat.icon;
          return (
            <motion.div
              key={stat.label}
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ delay: index * 0.06 }}
              className="bg-white/5 border border-white/10 p-6 rounded-3xl relative overflow-hidden group hover:border-accent/50 transition-all"
            >
              <div className="absolute -right-4 -bottom-4 opacity-5 group-hover:scale-110 transition-transform">
                <Icon size={120} />
              </div>
              <div className="relative z-10">
                <p className="text-xs font-bold text-white/40 uppercase tracking-widest">{stat.label}</p>
                <h3 className="text-2xl font-black mt-2">{stat.value}</h3>
                <div className={`mt-4 flex items-center text-xs font-bold ${stat.isUp ? 'text-green-500' : 'text-red-500'}`}>
                  {stat.trend}
                </div>
              </div>
            </motion.div>
          );
        })}
      </div>
      )}

      {reportType === 'revenue' && (
      <div className="bg-white/5 border border-white/10 p-8 rounded-[40px] space-y-6">
        <div className="flex items-center justify-between">
          <h3 className="text-xl font-bold">营收概览</h3>
          <p className="text-sm text-white/50">口径：结算单 + 零售单（已排除退款单）</p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="bg-white/[0.03] rounded-xl px-4 py-3">
            <p className="text-xs text-white/50">总营收</p>
            <p className="text-lg font-black">{revenueData.totalRevenue.toFixed(2)}元</p>
          </div>
          <div className="bg-white/[0.03] rounded-xl px-4 py-3">
            <p className="text-xs text-white/50">总毛利</p>
            <p className="text-lg font-black text-green-400">{profitData.totalProfit.toFixed(2)}元</p>
          </div>
          <div className="bg-white/[0.03] rounded-xl px-4 py-3">
            <p className="text-xs text-white/50">营收订单数</p>
            <p className="text-lg font-black">{revenueData.totalOrders}</p>
          </div>
        </div>

        <div className="bg-white/[0.03] rounded-2xl p-4">
          <h4 className="font-semibold mb-3">营收趋势</h4>
          {revenueData.trend.length > 0 ? (
            <div className="h-[200px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={revenueData.trend} margin={{ top: 8, right: 10, left: 0, bottom: 28 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#ffffff10" vertical={false} />
                  <XAxis
                    dataKey="label"
                    stroke="#ffffff40"
                    fontSize={11}
                    tickLine={false}
                    axisLine={false}
                    interval={0}
                  />
                  <YAxis
                    stroke="#ffffff40"
                    fontSize={12}
                    tickLine={false}
                    axisLine={false}
                    tickFormatter={(value: number) => `¥${value}`}
                  />
                  <Tooltip
                    contentStyle={{ backgroundColor: '#1a1a1c', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '12px' }}
                    itemStyle={{ color: '#fff' }}
                    formatter={(value: number) => [`¥${value.toFixed(2)}`, '营收']}
                  />
                  <Bar dataKey="value" radius={[10, 10, 0, 0]}>
                    {revenueData.trend.map((entry, index) => (
                      <Cell key={entry.label} fill={colors[index % colors.length]} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <p className="text-sm text-white/40">暂无营收趋势数据</p>
          )}
        </div>

        {selectedStoreId && (
          <div className="bg-white/[0.03] rounded-2xl p-4">
            <h4 className="font-semibold mb-3">毛利与毛利率趋势</h4>
            {profitData.profitTrend.length > 0 ? (
              <div className="h-[250px]">
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={profitData.profitTrend} margin={{ top: 8, right: 10, left: 0, bottom: 28 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#ffffff10" vertical={false} />
                    <XAxis dataKey="label" stroke="#ffffff40" fontSize={11} tickLine={false} axisLine={false} interval={0} />
                    <YAxis yAxisId="left" stroke="#ffffff40" fontSize={12} tickLine={false} axisLine={false} tickFormatter={(value: number) => `¥${value}`} />
                    <YAxis yAxisId="right" orientation="right" stroke="#ffffff40" fontSize={12} tickLine={false} axisLine={false} tickFormatter={(value: number) => `${value}%`} />
                    <Tooltip
                      contentStyle={{ backgroundColor: '#1a1a1c', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '12px' }}
                      itemStyle={{ color: '#fff' }}
                      formatter={(value: number, name: string) => [name === 'profit' ? `¥${value.toFixed(2)}` : `${value}%`, name === 'profit' ? '毛利' : '毛利率']}
                    />
                    <Legend wrapperStyle={{ fontSize: '12px', opacity: 0.8 }} />
                    <Bar yAxisId="left" dataKey="profit" name="profit" fill="#5B8DEF" radius={[4, 4, 0, 0]} />
                    <Line yAxisId="right" type="monotone" dataKey="marginRate" name="marginRate" stroke="#FF6B9D" strokeWidth={2} dot={{ r: 4, fill: '#FF6B9D' }} />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <p className="text-sm text-white/40">暂无趋势数据</p>
            )}
          </div>
        )}

        <div className="bg-white/[0.03] rounded-2xl p-4">
          <h4 className="font-semibold mb-3">SKU毛利润排行 (Top 10)</h4>
          {profitData.profitByProduct.length > 0 ? (
            <div className="h-[300px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={profitData.profitByProduct.slice(0, 10)} layout="vertical" margin={{ top: 8, right: 30, left: 40, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#ffffff10" horizontal={false} />
                  <XAxis type="number" stroke="#ffffff40" fontSize={11} tickLine={false} axisLine={false} tickFormatter={(value: number) => `¥${value}`} />
                  <YAxis type="category" dataKey="name" stroke="#ffffff40" fontSize={11} tickLine={false} axisLine={false} width={80} />
                  <Tooltip
                    contentStyle={{ backgroundColor: '#1a1a1c', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '12px' }}
                    itemStyle={{ color: '#fff' }}
                    formatter={(value: number) => [`¥${value.toFixed(2)}`, '毛利润']}
                  />
                  <Bar dataKey="profit" radius={[0, 10, 10, 0]}>
                    {profitData.profitByProduct.slice(0, 10).map((entry, index) => (
                      <Cell key={entry.name} fill={colors[index % colors.length]} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <p className="text-sm text-white/40">暂无毛利润数据</p>
          )}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {revenueData.compositionByStore.length > 0 && (
            <div className="bg-white/[0.03] rounded-2xl p-4">
              <h4 className="font-semibold mb-3">店铺营收构成</h4>
              <div className="h-[200px] flex items-center">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={revenueData.compositionByStore} cx="50%" cy="50%" innerRadius={50} outerRadius={80} paddingAngle={8} dataKey="value">
                      {revenueData.compositionByStore.map((entry, index) => (
                        <Cell key={entry.name} fill={colors[index % colors.length]} />
                      ))}
                    </Pie>
                    <Tooltip contentStyle={{ backgroundColor: '#1a1a1c', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '12px' }} itemStyle={{ color: '#fff' }} labelStyle={{ color: '#fff' }} formatter={(value: number, _name: string, entry: unknown) => [`¥${Number(value).toFixed(2)}`, ((entry as { payload?: { name?: string } } | undefined)?.payload?.name) || '店铺营收']} />
                    <Legend verticalAlign="bottom" height={24} wrapperStyle={{ color: '#fff' }} formatter={(value: string) => <span style={{ color: '#fff' }}>{value}</span>} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}
          {revenueData.compositionByCity.length > 0 && (
            <div className="bg-white/[0.03] rounded-2xl p-4">
              <h4 className="font-semibold mb-3">城市营收构成</h4>
              <div className="h-[200px] flex items-center">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={revenueData.compositionByCity} cx="50%" cy="50%" innerRadius={50} outerRadius={80} paddingAngle={8} dataKey="value">
                      {revenueData.compositionByCity.map((entry, index) => (
                        <Cell key={entry.name} fill={colors[index % colors.length]} />
                      ))}
                    </Pie>
                    <Tooltip contentStyle={{ backgroundColor: '#1a1a1c', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '12px' }} itemStyle={{ color: '#fff' }} labelStyle={{ color: '#fff' }} formatter={(value: number, _name: string, entry: unknown) => [`¥${Number(value).toFixed(2)}`, ((entry as { payload?: { name?: string } } | undefined)?.payload?.name) || '城市营收']} />
                    <Legend verticalAlign="bottom" height={24} wrapperStyle={{ color: '#fff' }} formatter={(value: string) => <span style={{ color: '#fff' }}>{value}</span>} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}
        </div>
      </div>
      )}


      {reportType === 'supply' && (
      <div className="bg-white/5 border border-white/10 p-8 rounded-[40px] space-y-6">
        <div className="flex items-center justify-between">
          <h3 className="text-xl font-bold">供货统计</h3>
          <p className="text-sm text-white/50">仅统计供货单（distribution）</p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="bg-white/[0.03] rounded-xl px-4 py-3">
            <p className="text-xs text-white/50">供货单数</p>
            <p className="text-lg font-black">{supplyData.totalOrders}</p>
          </div>
          <div className="bg-white/[0.03] rounded-xl px-4 py-3">
            <p className="text-xs text-white/50">供货总件数</p>
            <p className="text-lg font-black">{supplyData.totalQuantity}</p>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="bg-white/[0.03] rounded-2xl p-4">
            <h4 className="font-semibold mb-3">商品供货排行</h4>
            <div className="space-y-2">
              {supplyData.topProducts.map((row, idx) => (
                <div key={`${row.name}-${idx}`} className="flex items-center justify-between border-b border-white/10 pb-2 last:border-b-0 last:pb-0">
                  <p className="text-sm text-white/90 truncate pr-3">{idx + 1}. {row.name}</p>
                  <p className="text-sm font-bold text-accent">{row.value}</p>
                </div>
              ))}
              {supplyData.topProducts.length === 0 && <p className="text-sm text-white/40">暂无供货商品数据</p>}
            </div>
          </div>

          <div className="bg-white/[0.03] rounded-2xl p-4">
            <h4 className="font-semibold mb-3">店铺供货分布</h4>
            <div className="space-y-2">
              {supplyData.byStore.map((row) => (
                <div key={row.name} className="flex items-center justify-between border-b border-white/10 pb-2 last:border-b-0 last:pb-0">
                  <p className="text-sm text-white/90 truncate pr-3">{row.name}</p>
                  <p className="text-sm font-bold">{row.value}</p>
                </div>
              ))}
              {supplyData.byStore.length === 0 && <p className="text-sm text-white/40">暂无供货店铺数据</p>}
            </div>
          </div>
        </div>
      </div>
      )}

      {isDistributor && reportType === 'sales' && (
      <div className="bg-white/5 border border-white/10 p-8 rounded-[40px] space-y-6">
        <div className="flex items-center justify-between">
          <h3 className="text-xl font-bold">销售概览</h3>
          <p className="text-sm text-white/50">口径：当前筛选范围内全部订单</p>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="bg-white/[0.03] rounded-xl px-4 py-3">
            <p className="text-xs text-white/50">总销售额</p>
            <p className="text-lg font-black text-accent">¥{salesSummary.totalSalesAmount.toFixed(2)}</p>
          </div>
          <div className="bg-white/[0.03] rounded-xl px-4 py-3">
            <p className="text-xs text-white/50">订单数量</p>
            <p className="text-lg font-black">{salesSummary.orderCount}</p>
          </div>
          <div className="bg-white/[0.03] rounded-xl px-4 py-3">
            <p className="text-xs text-white/50">待处理订单</p>
            <p className="text-lg font-black">{salesSummary.pendingCount}</p>
          </div>
        </div>
        <p className="text-sm text-white/50">共 {salesSummary.orderCount} 笔订单，总销售额 ¥{salesSummary.totalSalesAmount.toFixed(2)}。</p>
      </div>
      )}

      {reportType === 'inventory_turnover' && (
      <div className="space-y-6">
        {turnoverData.isSlowMovingAlert && (
          <div className="bg-red-500/20 border border-red-500/50 rounded-2xl p-4 flex items-center gap-3">
            <AlertTriangle className="text-red-400" size={24} />
            <div>
              <h4 className="text-red-400 font-bold">滞销报警</h4>
              <p className="text-red-300/80 text-sm">滞销款占库存成本比例已超过 15% (当前 {(turnoverData.slowMovingRatio * 100).toFixed(1)}%)，请及时处理滞销库存。</p>
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="bg-white/5 border border-white/10 p-6 rounded-[32px]">
            <h3 className="text-xl font-bold mb-2">商品周转天数分布</h3>
            <p className="text-sm text-white/50 mb-6">X轴: 商品成本，Y轴: 周转天数</p>
            <div className="h-[300px]">
              <ResponsiveContainer width="100%" height="100%">
                <ScatterChart margin={{ top: 20, right: 20, bottom: 20, left: 20 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#ffffff10" />
                  <XAxis type="number" dataKey="cost" name="商品成本" unit="元" stroke="#ffffff40" tick={{ fill: '#ffffff80' }} />
                  <YAxis type="number" dataKey="turnoverDays" name="周转天数" unit="天" stroke="#ffffff40" tick={{ fill: '#ffffff80' }} />
                  <ZAxis type="category" dataKey="name" name="商品名称" />
                  <Tooltip cursor={{ strokeDasharray: '3 3' }} content={renderTurnoverScatterTooltip} />
                  <Scatter name="商品" data={turnoverData.scatterData} fill="#5B8DEF">
                    {turnoverData.scatterData.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={entry.category === '滞销款' ? '#ffc658' : entry.category === '热销款' ? '#FF6B9D' : '#5B8DEF'} />
                    ))}
                  </Scatter>
                </ScatterChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="bg-white/5 border border-white/10 p-6 rounded-[32px]">
            <h3 className="text-xl font-bold mb-2">库存成本价值分布</h3>
            <p className="text-sm text-white/50 mb-6">热销款 / 常规款 / 滞销款</p>
            <div className="h-[300px]">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={turnoverData.pieData} cx="50%" cy="50%" innerRadius={60} outerRadius={100} paddingAngle={5} dataKey="value">
                    {turnoverData.pieData.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={entry.color} />
                    ))}
                  </Pie>
                  <text x="50%" y="48%" textAnchor="middle" dominantBaseline="middle" fill="#ffffff" fontSize={14} fontWeight={700}>
                    {turnoverData.pieData.reduce((sum, item) => sum + Number(item.value || 0), 0).toFixed(0)}
                  </text>
                  <text x="50%" y="56%" textAnchor="middle" dominantBaseline="middle" fill="#d1d5db" fontSize={11}>
                    总成本
                  </text>
                  <Tooltip formatter={(value: number) => [`¥${value.toFixed(2)}`, '库存成本']} contentStyle={{ backgroundColor: '#1a1a1c', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '12px' }} itemStyle={{ color: '#fff' }} labelStyle={{ color: '#fff' }} />
                  <Legend verticalAlign="bottom" height={36} wrapperStyle={{ color: '#fff' }} formatter={(value: string) => <span style={{ color: '#fff' }}>{value}</span>} />
                </PieChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="bg-white/5 border border-white/10 p-6 rounded-[32px]">
            <h3 className="text-xl font-bold mb-6">平均周转指标</h3>
            <div className="grid grid-cols-2 gap-4 mb-6">
              <div className="bg-white/[0.03] rounded-xl p-4">
                <p className="text-xs text-white/50">SKU平均周转天数</p>
                <p className="text-2xl font-black text-accent">{turnoverData.avgTurnoverDays} <span className="text-sm font-normal text-white/50">天</span></p>
              </div>
            </div>
            <h4 className="font-semibold mb-3 text-sm text-white/80">按系列平均周转天数</h4>
            <div className="space-y-2 max-h-[200px] overflow-y-auto pr-2">
              {turnoverData.seriesAvgTurnover.map((row) => (
                <div key={row.series} className="flex items-center justify-between border-b border-white/10 pb-2 last:border-b-0 last:pb-0">
                  <p className="text-sm text-white/90 truncate pr-3">{row.series}</p>
                  <p className="text-sm font-bold">{row.avgDays} 天</p>
                </div>
              ))}
              {turnoverData.seriesAvgTurnover.length === 0 && <p className="text-sm text-white/40">暂无系列周转数据</p>}
            </div>
          </div>

          <div className="bg-white/5 border border-white/10 p-6 rounded-[32px]">
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-xl font-bold">动销率分析</h3>
              <span className="text-xs px-2 py-1 bg-white/10 rounded-lg text-white/70">
                {turnoverData.drillDownLevel === 'province' ? '省份维度' : 
                 turnoverData.drillDownLevel === 'city' ? '城市维度' : 
                 turnoverData.drillDownLevel === 'store' ? '店铺维度' : '商品维度'}
              </span>
            </div>
            <p className="text-sm text-white/50 mb-6">动销率 = 有销量SKU / 总SKU（店铺商品维度为销量 / 库存）</p>
            <div className="h-[250px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={turnoverData.drillDownData} margin={{ top: 0, right: 0, left: -20, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#ffffff10" vertical={false} />
                  <XAxis dataKey="name" stroke="#ffffff40" fontSize={11} tickLine={false} axisLine={false} />
                  <YAxis stroke="#ffffff40" fontSize={11} tickLine={false} axisLine={false} tickFormatter={(val) => `${val}%`} />
                  <Tooltip cursor={{ fill: '#ffffff05' }} contentStyle={{ backgroundColor: '#1a1a1c', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '12px' }} formatter={(value: number) => [`${value}%`, '动销率']} />
                  <Bar dataKey="rate" radius={[4, 4, 0, 0]} fill="#82ca9d" maxBarSize={40}>
                    {turnoverData.drillDownData.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={entry.rate < 50 ? '#ffc658' : '#82ca9d'} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>
      </div>
      )}


      {reportType === 'finance' && (
      <div className="bg-white/5 border border-white/10 p-8 rounded-[40px]">
        <div className="flex items-center justify-between mb-6">
          <h3 className="text-xl font-bold">财务报表</h3>
          <div className="text-xs text-white/40">基于财务流水数据</div>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3 mb-4">
          <div className="bg-white/[0.03] rounded-xl px-4 py-3">
            <p className="text-xs text-white/50">现金余额</p>
            <p className="text-lg font-black text-accent">¥{Number(cashBalance || 0).toFixed(2)}</p>
          </div>
          <div className="bg-white/[0.03] rounded-xl px-4 py-3">
            <p className="text-xs text-white/50">总收入</p>
            <p className="text-lg font-black text-green-400">¥{financeData.totalIncome.toFixed(2)}</p>
          </div>
          <div className="bg-white/[0.03] rounded-xl px-4 py-3">
            <p className="text-xs text-white/50">总支出</p>
            <p className="text-lg font-black text-red-400">¥{financeData.totalExpense.toFixed(2)}</p>
          </div>
          <div className="bg-white/[0.03] rounded-xl px-4 py-3">
            <p className="text-xs text-white/50">净收入</p>
            <p className={`text-lg font-black ${financeData.netIncome >= 0 ? 'text-accent' : 'text-red-400'}`}>¥{financeData.netIncome.toFixed(2)}</p>
          </div>
        </div>
        <p className="text-sm text-white/50 mb-4">共计 {financeData.transactionCount} 笔流水记录。净收入 = 总收入 - 总支出。</p>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="bg-white/[0.03] rounded-2xl p-4">
            <h4 className="font-semibold mb-3">收入分类占比</h4>
            {financeData.topIncomeCategories.length > 0 ? (
              <div className="h-[220px]">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={financeData.topIncomeCategories} cx="50%" cy="50%" innerRadius={50} outerRadius={80} dataKey="value" nameKey="name" paddingAngle={6}>
                      {financeData.topIncomeCategories.map((entry, index) => (
                        <Cell key={entry.name} fill={colors[index % colors.length]} />
                      ))}
                    </Pie>
                    <Tooltip contentStyle={{ backgroundColor: '#1a1a1c', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '12px' }} formatter={(value: number, _name: string, entry: unknown) => [`¥${Number(value).toFixed(2)}`, ((entry as { payload?: { name?: string } } | undefined)?.payload?.name) || '收入']} itemStyle={{ color: '#fff' }} labelStyle={{ color: '#fff' }} />
                    <Legend verticalAlign="bottom" height={24} wrapperStyle={{ color: '#fff' }} formatter={(value: string) => <span style={{ color: '#fff' }}>{value}</span>} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <p className="text-sm text-white/40">暂无收入分类数据</p>
            )}
          </div>
          <div className="bg-white/[0.03] rounded-2xl p-4">
            <h4 className="font-semibold mb-3">支出分类占比</h4>
            {financeData.topExpenseCategories.length > 0 ? (
              <div className="h-[220px]">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={financeData.topExpenseCategories} cx="50%" cy="50%" innerRadius={50} outerRadius={80} dataKey="value" nameKey="name" paddingAngle={6}>
                      {financeData.topExpenseCategories.map((entry, index) => (
                        <Cell key={entry.name} fill={colors[index % colors.length]} />
                      ))}
                    </Pie>
                    <Tooltip contentStyle={{ backgroundColor: '#1a1a1c', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '12px' }} formatter={(value: number, _name: string, entry: unknown) => [`¥${Number(value).toFixed(2)}`, ((entry as { payload?: { name?: string } } | undefined)?.payload?.name) || '支出']} itemStyle={{ color: '#fff' }} labelStyle={{ color: '#fff' }} />
                    <Legend verticalAlign="bottom" height={24} wrapperStyle={{ color: '#fff' }} formatter={(value: string) => <span style={{ color: '#fff' }}>{value}</span>} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <p className="text-sm text-white/40">暂无支出分类数据</p>
            )}
          </div>
        </div>
      </div>
      )}

      {reportType === 'revenue' && (
      <div className="bg-white/5 border border-white/10 p-8 rounded-[40px]">
        <div className="flex items-center justify-between mb-6">
          <h3 className="text-xl font-bold">利润报表导出</h3>
          <div className="text-xs text-white/40">统一导出已迁移至“导出经营数据”</div>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3 mb-4">
          <div className="bg-white/[0.03] rounded-xl px-4 py-3">
            <p className="text-xs text-white/50">零售总价</p>
            <p className="text-lg font-black">¥{profitData.totalRetailRevenue.toFixed(2)}</p>
          </div>
          <div className="bg-white/[0.03] rounded-xl px-4 py-3">
            <p className="text-xs text-white/50">折扣总收入</p>
            <p className="text-lg font-black">¥{profitData.totalDiscountRevenue.toFixed(2)}</p>
          </div>
          <div className="bg-white/[0.03] rounded-xl px-4 py-3">
            <p className="text-xs text-white/50">总成本</p>
            <p className="text-lg font-black">¥{profitData.totalCost.toFixed(2)}</p>
          </div>
          <div className="bg-white/[0.03] rounded-xl px-4 py-3">
            <p className="text-xs text-white/50">总利润</p>
            <p className="text-lg font-black text-accent">¥{profitData.totalProfit.toFixed(2)}</p>
          </div>
        </div>
        <p className="text-sm text-white/50">导出格式与移动端一致：商品名称、销量、零售价、零售总价、折扣价、折扣总收入、总成本、总利润。</p>
      </div>
      )}

    </div>
  );
};
