import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  Modal,
  Alert,
  RefreshControl,
  ScrollView,
  TextInput,
  Image,
  Animated,
  Platform,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Search, ShoppingBag, PackageCheck, Trash2, ClipboardList, Download, ChevronDown } from 'lucide-react-native';
import Toast from 'react-native-toast-message';

import { useAppStore } from '../store/useAppStore';
import { Colors, Shadow, Radius, LightColors, DarkColors } from '../theme';
import type { Order, OrderKind, ProductWithDetails } from '../types';
import { resolvePrice } from '../utils/priceResolver';

interface CartItem {
  cartKey: string;
  lineType: 'sale' | 'sample';
  product: ProductWithDetails;
  quantity: number;
  isSample: boolean;
}

type StatsRange = 'day' | 'week' | 'month' | 'year' | 'all' | 'range';

export default function OrdersScreen() {
  const {
    user,
    products,
    orders,
    distributors,
    stores,
    storeInventory,
    storeProductPrices,
    fetchProducts,
    fetchOrders,
    fetchDistributors,
    fetchStores,
    fetchStoreInventory,
    fetchStoreProductPrices,
    createSettlementOrder,
    createBatchOrders,
    deleteOrder,
    acceptOrder,
    findProductByBarcode,
    outboundStock,
  } = useAppStore();
  const isDarkMode = useAppStore((state) => state.isDarkMode);
  const theme = isDarkMode ? DarkColors : LightColors;

  const [modalVisible, setModalVisible] = useState(false);
  const [cart, setCart] = useState<Map<string, CartItem>>(new Map());
  const [refreshing, setRefreshing] = useState(false);
  const [selectedOrderCityId, setSelectedOrderCityId] = useState<string | null>(null);
  const [deletingOrderId, setDeletingOrderId] = useState<string | null>(null);
  const [selectedOrderStoreId, setSelectedOrderStoreId] = useState<string | null>(null);
  const [selectedOrderKind, setSelectedOrderKind] = useState<OrderKind | null>(null);
  const [statsRange, setStatsRange] = useState<StatsRange>('month');
  const [rangeStartDate, setRangeStartDate] = useState('');
  const [rangeEndDate, setRangeEndDate] = useState('');
  const [outboundModalVisible, setOutboundModalVisible] = useState(false);
  const [outboundBarcode, setOutboundBarcode] = useState('');
  const [outboundQuantity, setOutboundQuantity] = useState('');
  const [outboundProduct, setOutboundProduct] = useState<ProductWithDetails | null>(null);
  const [submittingOutbound, setSubmittingOutbound] = useState(false);
  const [retailModalVisible, setRetailModalVisible] = useState(false);
  const [retailStoreId, setRetailStoreId] = useState<string | null>(null);
  const [retailCart, setRetailCart] = useState<Map<string, number>>(new Map());
  const [retailQtyInputMode, setRetailQtyInputMode] = useState<Map<string, string>>(new Map());
  const [retailQtyEditingKey, setRetailQtyEditingKey] = useState<string | null>(null);
  const [submittingRetailOrder, setSubmittingRetailOrder] = useState(false);
  const [searchText, setSearchText] = useState('');
  const [modalSearchText, setModalSearchText] = useState('');
  const [filterModalVisible, setFilterModalVisible] = useState(false);
  const [quantityInputMode, setQuantityInputMode] = useState<Map<string, string>>(new Map());
  const [showQuantityInput, setShowQuantityInput] = useState<string | null>(null);
  const [statsExpanded, setStatsExpanded] = useState(false);
  const [statsMounted, setStatsMounted] = useState(false);
  const [detailOrder, setDetailOrder] = useState<Order | null>(null);
  const [orderModalDistributorId, setOrderModalDistributorId] = useState<string | null>(null);
  const [orderModalStoreId, setOrderModalStoreId] = useState<string | null>(null);

  const [modifyOrder, setModifyOrder] = useState<Order | null>(null);
  const [modifyCart, setModifyCart] = useState<Map<string, number>>(new Map());
  const [submittingModify, setSubmittingModify] = useState(false);
  const animatedHeight = useRef(new Animated.Value(44)).current;
  const animatedChevron = useRef(new Animated.Value(0)).current;
  const animatedOpacity = useRef(new Animated.Value(0)).current;

  const isAdmin = user?.role === 'admin' || user?.role === 'super_admin';
  const isOnlyAdmin = user?.role === 'admin';
  const canCreateOrder = user?.role === 'distributor' || user?.role === 'admin' || user?.role === 'super_admin';

  const getOrderKindLabel = (kind: Order['order_kind']): string => {
    if (kind === 'retail') return '零售单';
    if (kind === 'settlement') return '结算单';
    return '供货单';
  };

  const getOrderTotalLabel = (kind: Order['order_kind']): string => {
    if (kind === 'retail') return '收款总价';
    if (kind === 'settlement') return '结算总价';
    return '折扣总价';
  };

  const getPaymentMethodLabel = (method?: Order['payment_method']): string => {
    if (method === 'wechat') return '微信';
    if (method === 'alipay') return '支付宝';
    return '-';
  };

  useEffect(() => {
    fetchOrders();
    fetchProducts();
    fetchDistributors();
    fetchStores();
  }, [fetchDistributors, fetchOrders, fetchProducts, fetchStores]);

  useEffect(() => {
    if (orderModalStoreId) {
      fetchStoreProductPrices(orderModalStoreId);
    }
  }, [orderModalStoreId, fetchStoreProductPrices]);
  useEffect(() => {
    if (retailStoreId) {
      fetchStoreInventory(retailStoreId);
    }
  }, [retailStoreId, fetchStoreInventory]);



  const onRefresh = async () => {
    setRefreshing(true);
    await Promise.all([fetchOrders(), fetchProducts(), fetchDistributors(), fetchStores()]);
    setRefreshing(false);
  };

  const toggleStatsExpanded = () => {
    const nextValue = !statsExpanded;
    setStatsExpanded(nextValue);
    if (nextValue) {
      setStatsMounted(true);
    }

    Animated.parallel([
      Animated.timing(animatedHeight, {
        toValue: nextValue ? 236 : 44,
        duration: 300,
        useNativeDriver: false,
      }),
      Animated.timing(animatedChevron, {
        toValue: nextValue ? 180 : 0,
        duration: 300,
        useNativeDriver: true,
      }),
      Animated.timing(animatedOpacity, {
        toValue: nextValue ? 1 : 0,
        duration: 300,
        useNativeDriver: true,
      }),
    ]).start(() => {
      if (!nextValue) {
        setStatsMounted(false);
      }
    });
  };

  const orderCityId = useMemo(() => {
    if (orderModalStoreId) {
      const store = stores.find(s => s.id === orderModalStoreId);
      if (store) return store.city_id;
    }
    if (orderModalDistributorId) {
      const dist = distributors.find(d => d.id === orderModalDistributorId);
      if (dist) return dist.city_id;
    }
    if (user?.role === 'distributor') {
      return user.city_id;
    }
    return null;
  }, [orderModalStoreId, orderModalDistributorId, stores, distributors, user]);

  const availableProducts = useMemo(() => {
    const inStock = products.filter((p) => (p.quantity || 0) > 0);
    if (orderCityId) {
      return inStock.filter((p) => p.city_id === orderCityId);
    }
    return inStock;
  }, [products, orderCityId]);

  const filteredAvailableProducts = useMemo(() => {
    if (!modalSearchText.trim()) return availableProducts;
    const lowerSearch = modalSearchText.toLowerCase().trim();
    return availableProducts.filter(p => p.name.toLowerCase().includes(lowerSearch));
  }, [availableProducts, modalSearchText]);

  useEffect(() => {
    clearCart();
  }, [orderModalStoreId, orderModalDistributorId]);

  const orderFilterCities = useMemo(() => {
    const cityMap = new Map<string, string>();
    stores
      .filter((store) => store.status === 'active')
      .forEach((store) => {
        if (!cityMap.has(store.city_id)) {
          cityMap.set(store.city_id, store.city_name || '未知城市');
        }
      });
    return Array.from(cityMap.entries()).map(([id, name]) => ({ id, name }));
  }, [stores]);

  const activeStoresForOrderFilter = useMemo(() => {
    const activeStores = stores.filter((store) => store.status === 'active');
    if (!selectedOrderCityId) return activeStores;
    return activeStores.filter((store) => store.city_id === selectedOrderCityId);
  }, [selectedOrderCityId, stores]);

  useEffect(() => {
    if (!selectedOrderStoreId) return;
    const stillVisible = activeStoresForOrderFilter.some((store) => store.id === selectedOrderStoreId);
    if (!stillVisible) {
      setSelectedOrderStoreId(null);
    }
  }, [activeStoresForOrderFilter, selectedOrderStoreId]);

  const baseOrders = useMemo(() => {
    let list = [...orders];
    if (isAdmin) {
      if (selectedOrderCityId) {
        list = list.filter((o) => o.city_id === selectedOrderCityId);
      }
      if (selectedOrderStoreId) {
        list = list.filter((o) => o.store_id === selectedOrderStoreId);
      }
    }
    if (selectedOrderKind) {
      list = list.filter((o) => o.order_kind === selectedOrderKind);
    }
    return list;
  }, [orders, isAdmin, selectedOrderCityId, selectedOrderStoreId, selectedOrderKind]);

  const matchesStatsRange = useCallback((order: Order): boolean => {
    const date = new Date(order.created_at);
    const now = new Date();

    if (statsRange === 'all') return true;
    if (statsRange === 'range') {
      if (!rangeStartDate && !rangeEndDate) return true;

      const start = rangeStartDate ? new Date(`${rangeStartDate}T00:00:00`) : null;
      const end = rangeEndDate ? new Date(`${rangeEndDate}T23:59:59.999`) : null;
      if (start && Number.isNaN(start.getTime())) return true;
      if (end && Number.isNaN(end.getTime())) return true;
      if (start && end && start > end) return false;

      if (start && date < start) return false;
      if (end && date > end) return false;
      return true;
    }

    if (statsRange === 'day') {
      return date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth() && date.getDate() === now.getDate();
    }

    if (statsRange === 'week') {
      const nowCopy = new Date(now);
      const day = nowCopy.getDay();
      const diffToMonday = day === 0 ? 6 : day - 1;
      const weekStart = new Date(nowCopy.getFullYear(), nowCopy.getMonth(), nowCopy.getDate() - diffToMonday);
      weekStart.setHours(0, 0, 0, 0);

      const weekEnd = new Date(weekStart);
      weekEnd.setDate(weekStart.getDate() + 7);
      return date >= weekStart && date < weekEnd;
    }

    if (statsRange === 'month') {
      return date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth();
    }

    return date.getFullYear() === now.getFullYear();
  }, [rangeEndDate, rangeStartDate, statsRange]);

  const rangedOrders = useMemo(() => {
    return baseOrders.filter(matchesStatsRange);
  }, [baseOrders, matchesStatsRange]);

  const filteredOrders = useMemo(() => {
    let list = [...rangedOrders];
    if (searchText.trim()) {
      const lowerSearch = searchText.toLowerCase().trim();
      list = list.filter((o) => {
        const shortId = o.id.slice(0, 8).toLowerCase();
        const storeName = (o.store_name || '').toLowerCase();
        return shortId.includes(lowerSearch) || storeName.includes(lowerSearch);
      });
    }
    return list;
  }, [rangedOrders, searchText]);

  const monthlyProductStats = useMemo(() => {
    const map = new Map<string, { name: string; quantity: number }>();
    const now = new Date();
    baseOrders.forEach((order) => {
      const date = new Date(order.created_at);
      if (date.getFullYear() !== now.getFullYear() || date.getMonth() !== now.getMonth()) return;
      order.items.forEach((item) => {
        const key = item.product_id;
        const prev = map.get(key);
        map.set(key, {
          name: item.product_name || '未知商品',
          quantity: (prev?.quantity || 0) + item.quantity,
        });
      });
    });
    return Array.from(map.values()).sort((a, b) => b.quantity - a.quantity);
  }, [baseOrders]);

  const cumulativeProductStats = useMemo(() => {
    const map = new Map<string, { name: string; quantity: number }>();
    baseOrders.forEach((order) => {
      order.items.forEach((item) => {
        const key = item.product_id;
        const prev = map.get(key);
        map.set(key, {
          name: item.product_name || '未知商品',
          quantity: (prev?.quantity || 0) + item.quantity,
        });
      });
    });
    return Array.from(map.values()).sort((a, b) => b.quantity - a.quantity);
  }, [baseOrders]);

  const rangeLabel = useMemo(() => {
    switch (statsRange) {
      case 'day':
        return '当日';
      case 'week':
        return '本周';
      case 'month':
        return '本月';
      case 'year':
        return '年度';
      case 'range': {
        if (rangeStartDate && rangeEndDate) return `${rangeStartDate}~${rangeEndDate}`;
        if (rangeStartDate) return `${rangeStartDate}~今`;
        if (rangeEndDate) return `~${rangeEndDate}`;
        return '自定义时间段';
      }
      default:
        return '累计';
    }
  }, [rangeEndDate, rangeStartDate, statsRange]);

  const monthlyStatsRows = useMemo(() => monthlyProductStats, [monthlyProductStats]);
  const cumulativeStatsRows = useMemo(() => cumulativeProductStats, [cumulativeProductStats]);
  const activeFilterCount = useMemo(() => {
    let count = 0;
    if (isAdmin && selectedOrderCityId) count += 1;
    if (isAdmin && selectedOrderStoreId) count += 1;
    if (selectedOrderKind) count += 1;
    if (statsRange !== 'all') count += 1;
    return count;
  }, [isAdmin, selectedOrderCityId, selectedOrderStoreId, selectedOrderKind, statsRange]);

  const getCartKey = (productId: string, lineType: 'sale' | 'sample'): string => `${productId}:${lineType}`;
  const getLineStep = (lineType: 'sale' | 'sample'): number => (lineType === 'sample' ? 1 : 5);
  const getCombinedQtyByProduct = (entries: Map<string, CartItem>, productId: string): number => {
    let total = 0;
    entries.forEach((item) => {
      if (item.product.id === productId) total += item.quantity;
    });
    return total;
  };

  const addToCart = (product: ProductWithDetails, lineType: 'sale' | 'sample', addQty: number = getLineStep(lineType)) => {
    setCart((prev) => {
      const next = new Map(prev);
      const cartKey = getCartKey(product.id, lineType);
      const existing = next.get(cartKey);
      const currentQty = existing?.quantity || 0;
      const newQty = currentQty + addQty;
      const combinedWithoutCurrent = getCombinedQtyByProduct(next, product.id) - currentQty;
      const nextCombined = combinedWithoutCurrent + newQty;
      if (nextCombined > (product.quantity || 0)) {
        Toast.show({ type: 'error', text1: '库存不足', text2: `${product.name} 当前库存仅 ${product.quantity || 0}` });
        return prev;
      }
      next.set(cartKey, {
        cartKey,
        lineType,
        product,
        quantity: newQty,
        isSample: lineType === 'sample',
      });
      return next;
    });
  };

  const updateCartQuantity = (cartKey: string, qtyStr: string) => {
    setQuantityInputMode((prev) => {
      const next = new Map(prev);
      next.set(cartKey, qtyStr);
      return next;
    });
  };

  const confirmCartQuantity = (product: ProductWithDetails, lineType: 'sale' | 'sample') => {
    const cartKey = getCartKey(product.id, lineType);
    const qtyStr = quantityInputMode.get(cartKey) || '';
    const currentItem = cart.get(cartKey);
    const isSample = lineType === 'sample';
    
    // If empty, cancel edit mode
    if (!qtyStr.trim()) {
      setQuantityInputMode((prev) => {
        const next = new Map(prev);
        next.delete(cartKey);
        return next;
      });
      setShowQuantityInput(null);
      return;
    }
    
    const qty = Number.parseInt(qtyStr, 10);
    if (Number.isNaN(qty) || qty <= 0) {
      Toast.show({ type: 'error', text1: '错误', text2: '请输入有效数量' });
      return;
    }
    if (!isSample && qty % 5 !== 0) {
      Toast.show({ type: 'error', text1: '错误', text2: '数量必须是5的倍数' });
      return;
    }
    const combinedWithoutCurrent = getCombinedQtyByProduct(cart, product.id) - (currentItem?.quantity || 0);
    const nextCombined = combinedWithoutCurrent + qty;
    if (nextCombined > (product.quantity || 0)) {
      Toast.show({ type: 'error', text1: '库存不足', text2: `${product.name} 当前库存仅 ${product.quantity || 0}` });
      return;
    }
    setCart((prev) => {
      const next = new Map(prev);
      next.set(cartKey, {
        cartKey,
        lineType,
        product,
        quantity: qty,
        isSample,
      });
      return next;
    });
    setQuantityInputMode((prev) => {
      const next = new Map(prev);
      next.delete(cartKey);
      return next;
    });
    setShowQuantityInput(null);
  };

  const removeFromCart = (productId: string) => {
    setCart((prev) => {
      const next = new Map(prev);
      const existing = next.get(productId);
      if (!existing) return prev;
      const step = getLineStep(existing.lineType);
      const newQty = existing.quantity - step;
      if (newQty <= 0) {
        next.delete(productId);
      } else {
        next.set(productId, { ...existing, quantity: newQty });
      }
      return next;
    });
  };

  const clearCart = () => setCart(new Map());

  const cartItems = useMemo(
    () => Array.from(cart.values()).sort((a, b) => a.product.name.localeCompare(b.product.name, 'zh-CN') || a.lineType.localeCompare(b.lineType)),
    [cart],
  );
  const cartRetailTotal = useMemo(
    () => cartItems.reduce((sum, item) => (item.isSample ? sum : sum + item.quantity * Number(item.product.price || 0)), 0),
    [cartItems],
  );
  const cartDiscountTotal = useMemo(() => {
    const selectedStore = orderModalStoreId ? stores.find(s => s.id === orderModalStoreId) : null;
    return cartItems.reduce((sum, item) => {
      if (item.isSample) return sum;
      const storeOverride = orderModalStoreId ? storeProductPrices.find(p => p.product_id === item.product.id && p.store_id === orderModalStoreId) : null;
      const resolvedPrice = resolvePrice({
        price: item.product.price || 0,
        discount_price: item.product.discount_price,
        discount_rate: selectedStore?.discount_rate,
        override_price: storeOverride?.override_price,
      }).price;
      return sum + item.quantity * resolvedPrice;
    }, 0);
  }, [cartItems, orderModalStoreId, stores, storeProductPrices]);
  const cartCount = useMemo(() => cartItems.reduce((sum, item) => sum + item.quantity, 0), [cartItems]);
  const sampleLineCount = useMemo(() => cartItems.filter((item) => item.isSample).length, [cartItems]);

  const handleSubmitOrder = async () => {
    if (cartItems.length === 0) {
      Toast.show({ type: 'error', text1: '错误', text2: '购物车为空' });
      return;
    }

    // Validate all items are multiples of 5
    const invalidItems = cartItems.filter((item) => !item.isSample && item.quantity % 5 !== 0);
    if (invalidItems.length > 0) {
      const invalidNames = invalidItems.map((item) => `${item.product.name}(${item.quantity})`).join(', ');
      Toast.show({ 
        type: 'error', 
        text1: '下单失败', 
        text2: `以下商品数量不是5的倍数: ${invalidNames}` 
      });
      return;
    }

    const items = cartItems.map((item) => ({
      productId: item.product.id,
      quantity: item.quantity,
      isSample: item.isSample,
    }));

    const { error } = await createBatchOrders(items, orderModalStoreId);
    if (error) {
      Toast.show({ type: 'error', text1: '错误', text2: error.message });
      return;
    }

    Toast.show({ type: 'success', text1: '成功', text2: '订单已创建（本次购物车合并为一条订单）' });
    clearCart();
    setModalSearchText('');
    setModalVisible(false);
  };

  const handleDeleteOrder = (order: Order) => {
    Alert.alert('确认删除', `确定删除订单 #${order.id.slice(0, 8)} 吗？删除后会恢复库存。`, [
      { text: '取消', style: 'cancel' },
      {
        text: '删除',
        style: 'destructive',
        onPress: async () => {
          setDeletingOrderId(order.id);
          const { error } = await deleteOrder(order.id);
          setDeletingOrderId(null);
          if (error) {
            Toast.show({ type: 'error', text1: '删除失败', text2: error.message });
          } else {
            Toast.show({ type: 'success', text1: '已删除', text2: '订单已删除并恢复库存' });
          }
        },
      },
    ]);
  };

  const handleOutboundBarcodeLookup = (rawCode?: string) => {
    const normalized = (rawCode ?? outboundBarcode).replace(/\D/g, '').slice(0, 13);
    setOutboundBarcode(normalized);
    if (normalized.length !== 13) {
      setOutboundProduct(null);
      return;
    }
    const matched = findProductByBarcode(normalized);
    setOutboundProduct(matched || null);
  };

  const resetOutboundForm = () => {
    setOutboundBarcode('');
    setOutboundQuantity('');
    setOutboundProduct(null);
  };

  const handleConfirmOutbound = async () => {
    const qty = Number.parseInt(outboundQuantity, 10);
    if (outboundBarcode.length !== 13) {
      Toast.show({ type: 'error', text1: '错误', text2: '请输入13位条码' });
      return;
    }
    if (!outboundProduct) {
      Toast.show({ type: 'error', text1: '错误', text2: '未找到对应商品' });
      return;
    }
    if (Number.isNaN(qty) || qty <= 0) {
      Toast.show({ type: 'error', text1: '错误', text2: '请输入有效出库数量' });
      return;
    }

    setSubmittingOutbound(true);
    const { error } = await outboundStock(outboundBarcode, qty);
    setSubmittingOutbound(false);

    if (error) {
      Toast.show({ type: 'error', text1: '出库失败', text2: error.message });
      return;
    }

    Toast.show({ type: 'success', text1: '成功', text2: `${outboundProduct.name} 出库 ${qty} 件成功` });
    setOutboundModalVisible(false);
    resetOutboundForm();
  };

  const exportOrderToExcel = async (order: Order) => {
    try {
      const XLSX = await import('xlsx');

      if (order.order_kind === 'distribution') {
        const boundStore = order.store_id ? stores.find((store) => store.id === order.store_id) : null;
        const storeNameRaw = order.store_name || boundStore?.name || '未指定店铺';
        const safeStoreName = storeNameRaw.replace(/[\\/:*?"<>|]/g, '-').trim() || '未指定店铺';

        const exportDate = new Date(order.created_at);
        const year = String(exportDate.getFullYear());
        const month = String(exportDate.getMonth() + 1).padStart(2, '0');
        const day = String(exportDate.getDate()).padStart(2, '0');
        const exportBaseName = `云窗&${safeStoreName}*${year}*${month}*${day}上货单`;

        const headers = ['序号', '商品名称', '送货数量', '零售价', '结算价', '零售总价', '结算总价'];
        const dataRows = order.items.map((item, index) => {
          const quantity = Number(item.quantity || 0);
          const retailPrice = Number(item.retail_price || 0);

          let settlementPrice = Number(item.discount_price || 0);
          if (!item.is_sample && settlementPrice <= 0) {
            const product = products.find((p) => p.id === item.product_id);
            const storeOverride = order.store_id
              ? storeProductPrices.find((entry) => entry.store_id === order.store_id && entry.product_id === item.product_id)
              : undefined;
            settlementPrice = product
              ? resolvePrice({
                price: Number(product.price || 0),
                discount_price: product.discount_price,
                discount_rate: boundStore?.discount_rate,
                override_price: storeOverride?.override_price,
              }).price
              : 0;
          }

          const retailTotal = retailPrice * quantity;
          const settlementTotal = settlementPrice * quantity;

          return [
            index + 1,
            item.product_name || '未知商品',
            quantity,
            Number(retailPrice.toFixed(2)),
            Number(settlementPrice.toFixed(2)),
            Number(retailTotal.toFixed(2)),
            Number(settlementTotal.toFixed(2)),
          ];
        });

        const sumRetailTotal = dataRows.reduce((sum, row) => sum + Number(row[5] || 0), 0);
        const sumSettlementTotal = dataRows.reduce((sum, row) => sum + Number(row[6] || 0), 0);
        const sumRow = ['合计', '', '', '', '', Number(sumRetailTotal.toFixed(2)), Number(sumSettlementTotal.toFixed(2))];
        const sheetData = [headers, ...dataRows, sumRow];

        const ws = XLSX.utils.aoa_to_sheet(sheetData);
        ws['!cols'] = [
          { wch: 8 },
          { wch: 24 },
          { wch: 12 },
          { wch: 12 },
          { wch: 12 },
          { wch: 14 },
          { wch: 14 },
        ];

        const range = XLSX.utils.decode_range(ws['!ref'] || 'A1');
        for (let rowIndex = range.s.r; rowIndex <= range.e.r; rowIndex += 1) {
          for (let colIndex = range.s.c; colIndex <= range.e.c; colIndex += 1) {
            const address = XLSX.utils.encode_cell({ r: rowIndex, c: colIndex });
            if (!ws[address]) continue;
            if (!ws[address].s) ws[address].s = {};
            ws[address].s = { alignment: { horizontal: 'center', vertical: 'center' } };
          }
        }

        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, '上货单');

        if (Platform.OS === 'web') {
          const arrayBuffer = XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;
          const blob = new Blob([arrayBuffer], {
            type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          });
          const url = URL.createObjectURL(blob);
          const link = document.createElement('a');
          link.href = url;
          link.download = `${exportBaseName}.xlsx`;
          document.body.appendChild(link);
          link.click();
          document.body.removeChild(link);
          URL.revokeObjectURL(url);
          return;
        }

        const FileSystem = await import('expo-file-system/legacy');
        const Sharing = await import('expo-sharing');
        const base64 = XLSX.write(wb, { type: 'base64', bookType: 'xlsx' });
        const uri = `${FileSystem.cacheDirectory}${exportBaseName}.xlsx`;
        await FileSystem.writeAsStringAsync(uri, base64, { encoding: FileSystem.EncodingType.Base64 });
        await Sharing.shareAsync(uri, {
          mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        });
        return;
      }

      const headers = ['商品名称', '送货数量', '单价', '查收'];
      const dataRows = order.items.map((item) => [
        item.product_name,
        item.quantity,
        item.discount_price,
        '',
      ]);
      const sheetData = [headers, ...dataRows];
      const ws = XLSX.utils.aoa_to_sheet(sheetData);

      const colWidths = headers.map((h, colIdx) => {
        let maxLen = h.length * 2;
        dataRows.forEach((row) => {
          const len = String(row[colIdx]).length;
          if (len > maxLen) maxLen = len;
        });
        return { wch: Math.max(maxLen + 2, 12) };
      });
      ws['!cols'] = colWidths;

      const range = XLSX.utils.decode_range(ws['!ref'] || 'A1');
      for (let R = range.s.r; R <= range.e.r; R++) {
        for (let C = range.s.c; C <= range.e.c; C++) {
          const addr = XLSX.utils.encode_cell({ r: R, c: C });
          if (!ws[addr]) continue;
          if (!ws[addr].s) ws[addr].s = {};
          ws[addr].s = { alignment: { horizontal: 'center', vertical: 'center' } };
        }
      }

      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, '送货单');

      if (Platform.OS === 'web') {
        const arrayBuffer = XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;
        const blob = new Blob([arrayBuffer], {
          type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `delivery-${order.id.slice(0, 8)}-${Date.now()}.xlsx`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
        return;
      }

      const FileSystem = await import('expo-file-system/legacy');
      const Sharing = await import('expo-sharing');
      const base64 = XLSX.write(wb, { type: 'base64', bookType: 'xlsx' });
      const uri = `${FileSystem.cacheDirectory}delivery-${order.id.slice(0, 8)}-${Date.now()}.xlsx`;
      await FileSystem.writeAsStringAsync(uri, base64, { encoding: FileSystem.EncodingType.Base64 });
      await Sharing.shareAsync(uri, {
        mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Excel 导出失败';
      Toast.show({ type: 'error', text1: '导出失败', text2: message });
    }
  };

  const totalRetail = filteredOrders.reduce((sum, o) => sum + Number(o.total_retail_amount || 0), 0);
  const totalDiscount = filteredOrders.reduce((sum, o) => sum + Number(o.total_discount_amount || 0), 0);

  const renderOrder = ({ item }: { item: Order }) => (
    <View style={[styles.orderCard, { backgroundColor: theme.surface }] }>
      <View style={styles.orderHeader}>
        <View>
          <Text style={[styles.orderId, { color: theme.textPrimary }]}>订单 #{item.id.slice(0, 8)}</Text>
          <Text style={[styles.orderKindTag, { color: theme.blue }]}>{getOrderKindLabel(item.order_kind)}</Text>
        </View>
        <Text style={[styles.orderDate, { color: theme.textTertiary }]}>{new Date(item.created_at).toLocaleDateString('zh-CN')}</Text>
      </View>

      <View style={styles.orderMetaContainer}>
        <PackageCheck size={14} color={theme.textTertiary} style={{ marginRight: 4 }} />
        <Text style={[styles.orderMeta, { color: theme.textSecondary }]}>
          配送店铺: {item.store_name || '未指定'}
        </Text>
      </View>
      <View style={styles.orderMetaContainer}>
        <PackageCheck size={14} color={theme.textTertiary} style={{ marginRight: 4 }} />
        <Text style={[styles.orderMeta, { color: theme.textSecondary }]}>
          下单账号: {item.distributor_email || item.distributor_id}
          {item.distributor_store ? ` · ${item.distributor_store}` : ''}
        </Text>
      </View>

      <View style={styles.orderItemsSummary}>
        <Text style={[styles.orderItemsSummaryText, { color: theme.textSecondary }]}>
          共 {item.items.length} 种商品，{item.items.reduce((sum, i) => sum + Number(i.quantity || 0), 0)} 件
        </Text>
        <TouchableOpacity
          onPress={() => setDetailOrder(item)}
          style={styles.detailButton}
          activeOpacity={0.85}
        >
          <Text style={[styles.detailButtonText, { color: theme.blue }]}>查看详情</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.orderTotals}>
        <Text style={[styles.detailText, { color: theme.textSecondary }]}>零售总价: {Number(item.total_retail_amount).toFixed(2)}元</Text>
        <Text style={styles.totalText}>{getOrderTotalLabel(item.order_kind)}: {Number(item.total_discount_amount).toFixed(2)}元</Text>
      </View>

      <View style={styles.orderActions}>
        <TouchableOpacity
          style={styles.exportButton}
          onPress={() => exportOrderToExcel(item)}
        >
          <Download size={14} color={Colors.blue} />
          <Text style={styles.exportButtonText}>导出</Text>
        </TouchableOpacity>
        {isAdmin && item.status === 'pending' && (
          <TouchableOpacity
            style={styles.acceptOrderButton}
            onPress={async () => {
              const { error } = await acceptOrder(item.id);
              if (error) Toast.show({ type: 'error', text1: '接单失败', text2: error.message });
            }}
          >
            <Text style={styles.acceptOrderButtonText}>接单</Text>
          </TouchableOpacity>
        )}
        {item.status === 'accepted' && (
          <View style={styles.acceptedTag}>
            <Text style={styles.acceptedTagText}>已接单</Text>
          </View>
        )}
        {isAdmin && item.status === 'accepted' && item.order_kind === 'distribution' && item.store_id && (
          <TouchableOpacity
            style={styles.modifyOrderButton}
            onPress={() => {
              setModifyOrder(item);
              const initialCart = new Map<string, number>();
              item.items.forEach(i => initialCart.set(i.id, i.quantity));
              setModifyCart(initialCart);
            }}
          >
            <Text style={styles.modifyOrderButtonText}>修改订单</Text>
          </TouchableOpacity>
        )}
        {(isAdmin || user?.id === item.distributor_id) && (
          <TouchableOpacity
            style={[styles.deleteOrderButton, deletingOrderId === item.id && styles.deleteOrderButtonDisabled]}
            onPress={() => handleDeleteOrder(item)}
            disabled={deletingOrderId === item.id}
          >
            <Text style={styles.deleteOrderButtonText}>{deletingOrderId === item.id ? '删除中...' : '删除订单'}</Text>
          </TouchableOpacity>
        )}
      </View>
    </View>
  );

  const renderProductRow = ({ item }: { item: ProductWithDetails }) => {
    const saleKey = getCartKey(item.id, 'sale');
    const sampleKey = getCartKey(item.id, 'sample');
    const saleQty = cart.get(saleKey)?.quantity || 0;
    const sampleQty = cart.get(sampleKey)?.quantity || 0;
    const saleEditing = showQuantityInput === saleKey;
    const sampleEditing = showQuantityInput === sampleKey;
    const saleInputValue = quantityInputMode.get(saleKey) || '';
    const sampleInputValue = quantityInputMode.get(sampleKey) || '';

    const selectedStore = orderModalStoreId ? stores.find(s => s.id === orderModalStoreId) : null;
    const storeOverride = orderModalStoreId ? storeProductPrices.find(p => p.product_id === item.id && p.store_id === orderModalStoreId) : null;
    
    const resolvedPrice = resolvePrice({
      price: item.price || 0,
      discount_price: item.discount_price,
      discount_rate: selectedStore?.discount_rate,
      override_price: storeOverride?.override_price,
    }).price;

    return (
      <View style={styles.productRow}>
        {item.image_url ? (
          <Image source={{ uri: item.image_url }} style={styles.productThumb} />
        ) : (
          <View style={styles.productThumbPlaceholder}>
            <Text style={styles.productThumbPlaceholderText}>{item.name.charAt(0)}</Text>
          </View>
        )}
        <View style={styles.productRowInfo}>
          <TouchableOpacity
            activeOpacity={0.75}
            onPress={() => Alert.alert('商品全称', item.name)}
          >
            <Text style={styles.productRowName} numberOfLines={1} ellipsizeMode="tail">{item.name}</Text>
          </TouchableOpacity>
          <Text style={styles.productRowMeta}>
            {item.city_name ? `${item.city_name} · ` : ''}
            {user?.role === 'distributor'
              ? `折 ${resolvedPrice}元 · 零售 ${item.price}元`
              : `零售 ${item.price}元 · 折 ${resolvedPrice}元`}
          </Text>
        </View>
        <View style={styles.productRowActionsMulti}>
          <View style={styles.productLineRow}>
            <Text style={styles.productLineLabel}>商品</Text>
            {saleQty > 0 ? (
              <>
                <TouchableOpacity style={styles.qtyBtn} onPress={() => removeFromCart(saleKey)}>
                  <Text style={styles.qtyBtnText}>-</Text>
                </TouchableOpacity>
                {saleEditing ? (
                  <TextInput
                    style={styles.qtyInput}
                    value={saleInputValue}
                    onChangeText={(text) => updateCartQuantity(saleKey, text.replace(/[^0-9]/g, ''))}
                    onBlur={() => confirmCartQuantity(item, 'sale')}
                    onSubmitEditing={() => confirmCartQuantity(item, 'sale')}
                    keyboardType="number-pad"
                    autoFocus
                  />
                ) : (
                  <TouchableOpacity onPress={() => {
                    setQuantityInputMode((prev) => {
                      const next = new Map(prev);
                      next.set(saleKey, '');
                      return next;
                    });
                    setShowQuantityInput(saleKey);
                  }}>
                    <Text style={styles.qtyValue}>{saleQty}</Text>
                  </TouchableOpacity>
                )}
              </>
            ) : <Text style={styles.qtyEmpty}>0</Text>}
            <TouchableOpacity onPress={() => addToCart(item, 'sale')} activeOpacity={0.85}>
              <LinearGradient colors={['#FF6B9D', '#5B8DEF']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={styles.qtyBtnAdd}>
                <Text style={styles.qtyBtnAddText}>+5</Text>
              </LinearGradient>
            </TouchableOpacity>
          </View>

          <View style={styles.productLineRow}>
            <Text style={styles.productLineLabelSample}>样品</Text>
            {sampleQty > 0 ? (
              <>
                <TouchableOpacity style={styles.qtyBtn} onPress={() => removeFromCart(sampleKey)}>
                  <Text style={styles.qtyBtnText}>-</Text>
                </TouchableOpacity>
                {sampleEditing ? (
                  <TextInput
                    style={styles.qtyInput}
                    value={sampleInputValue}
                    onChangeText={(text) => updateCartQuantity(sampleKey, text.replace(/[^0-9]/g, ''))}
                    onBlur={() => confirmCartQuantity(item, 'sample')}
                    onSubmitEditing={() => confirmCartQuantity(item, 'sample')}
                    keyboardType="number-pad"
                    autoFocus
                  />
                ) : (
                  <TouchableOpacity onPress={() => {
                    setQuantityInputMode((prev) => {
                      const next = new Map(prev);
                      next.set(sampleKey, '');
                      return next;
                    });
                    setShowQuantityInput(sampleKey);
                  }}>
                    <Text style={styles.qtyValue}>{sampleQty}</Text>
                  </TouchableOpacity>
                )}
              </>
            ) : <Text style={styles.qtyEmpty}>0</Text>}
            <TouchableOpacity onPress={() => addToCart(item, 'sample')} activeOpacity={0.85}>
              <LinearGradient colors={['#22D3EE', '#3B82F6']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={styles.qtyBtnAdd}>
                <Text style={styles.qtyBtnAddText}>+1</Text>
              </LinearGradient>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    );
  };

  return (
      <View style={[styles.container, { backgroundColor: theme.background }]}>
      <View style={[styles.header, { backgroundColor: theme.surface }]}>
        <Text style={[styles.headerTitle, { color: theme.textPrimary }]}>销售订单</Text>
        <View style={styles.headerActions}>
          {isOnlyAdmin && (
            <TouchableOpacity
              onPress={() => {
                setRetailStoreId(null);
                setRetailCart(new Map());
                setRetailModalVisible(true);
              }}
              activeOpacity={0.85}
              style={styles.outboundButtonWrap}
            >
              <LinearGradient colors={['#FF6B9D', '#5B8DEF']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={styles.addButton}>
                <Text style={styles.addButtonText}>结算建单</Text>
              </LinearGradient>
            </TouchableOpacity>
          )}
          {canCreateOrder && (
            <TouchableOpacity
              onPress={() => {
                resetOutboundForm();
                setOutboundModalVisible(true);
              }}
              activeOpacity={0.85}
              style={styles.outboundButtonWrap}
            >
              <LinearGradient colors={['#FF6B9D', '#5B8DEF']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={styles.addButton}>
                <Text style={styles.addButtonText}>出库</Text>
              </LinearGradient>
            </TouchableOpacity>
          )}
          {canCreateOrder && (
            <TouchableOpacity onPress={() => { setModalSearchText(''); setModalVisible(true); }} activeOpacity={0.85}>
              <LinearGradient colors={['#FF6B9D', '#5B8DEF']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={styles.addButton}>
                <Text style={styles.addButtonText}>+ 新建订单</Text>
              </LinearGradient>
            </TouchableOpacity>
          )}
        </View>
      </View>

      <View style={[styles.summary, { backgroundColor: theme.surface }]}> 
        <View style={styles.summaryItem}>
          <Text style={styles.summaryValue}>{filteredOrders.length}</Text>
          <Text style={[styles.summaryLabel, { color: theme.textSecondary }]}>订单数</Text>
        </View>
        <View style={styles.summaryItem}>
          <Text style={styles.summaryValue}>{totalRetail.toFixed(2)}元</Text>
          <Text style={[styles.summaryLabel, { color: theme.textSecondary }]}>零售总价</Text>
        </View>
        <View style={styles.summaryItem}>
          <Text style={styles.summaryValue}>{totalDiscount.toFixed(2)}元</Text>
          <Text style={[styles.summaryLabel, { color: theme.textSecondary }]}>折扣总价</Text>
        </View>
      </View>

      {isAdmin && (
        <Animated.View style={[styles.statsCard, { height: animatedHeight, backgroundColor: theme.surface }]}>
          <TouchableOpacity onPress={toggleStatsExpanded} activeOpacity={0.85}>
            <View style={styles.statsHeader}>
              <Text style={[styles.statsTitle, { color: theme.textPrimary }]}>商品数量统计（同商品自动累加）</Text>
              <Animated.View style={{ transform: [{ rotate: animatedChevron.interpolate({ inputRange: [0, 180], outputRange: ['0deg', '180deg'] }) }] }}>
                <ChevronDown size={16} color={theme.textSecondary} />
              </Animated.View>
            </View>
          </TouchableOpacity>
          {statsMounted && (
            <Animated.View style={{ opacity: animatedOpacity, overflow: 'hidden' }}>
              <View style={styles.statsRow}>
              <View style={styles.statsColumn}>
                <Text style={[styles.statsSubTitle, { color: theme.textSecondary }]}>本月</Text>
                <ScrollView
                  style={styles.statsColumnScroll}
                  contentContainerStyle={styles.statsList}
                  nestedScrollEnabled
                  showsVerticalScrollIndicator={false}
                >
                  {monthlyStatsRows.length > 0 ? (
                    monthlyStatsRows.map((row) => (
                      <View key={`m-${row.name}`} style={[styles.statsListItem, { backgroundColor: theme.surface, borderColor: theme.border }]}> 
                        <Text style={[styles.statsListName, { color: theme.textPrimary }]} numberOfLines={2} ellipsizeMode="tail">
                          {row.name}
                        </Text>
                        <Text style={styles.statsListQty}>{row.quantity}</Text>
                      </View>
                    ))
                  ) : (
                    <Text style={[styles.statsRowText, { color: theme.textTertiary }, styles.statsRowPlaceholder]}>—</Text>
                  )}
                </ScrollView>
              </View>
              <View style={styles.statsColumn}>
                <Text style={[styles.statsSubTitle, { color: theme.textSecondary }]}>累计</Text>
                <ScrollView
                  style={styles.statsColumnScroll}
                  contentContainerStyle={styles.statsList}
                  nestedScrollEnabled
                  showsVerticalScrollIndicator={false}
                >
                  {cumulativeStatsRows.length > 0 ? (
                    cumulativeStatsRows.map((row) => (
                      <View key={`c-${row.name}`} style={[styles.statsListItem, { backgroundColor: theme.surface, borderColor: theme.border }]}> 
                        <Text style={[styles.statsListName, { color: theme.textPrimary }]} numberOfLines={2} ellipsizeMode="tail">
                          {row.name}
                        </Text>
                        <Text style={styles.statsListQty}>{row.quantity}</Text>
                      </View>
                    ))
                  ) : (
                    <Text style={[styles.statsRowText, { color: theme.textTertiary }, styles.statsRowPlaceholder]}>—</Text>
                  )}
                </ScrollView>
              </View>
            </View>
          </Animated.View>
        )}
        </Animated.View>
      )}

      <View style={styles.searchFilterRow}>
        <View style={[styles.searchContainer, styles.searchContainerCompact, { backgroundColor: theme.surfaceSecondary }] }>
          <Search size={18} color={theme.textTertiary} style={styles.searchIcon} />
          <TextInput
            style={[styles.searchInput, { color: theme.textPrimary }]}
            placeholder="搜索订单号或店铺名称..."
            placeholderTextColor={theme.textTertiary}
            value={searchText}
            onChangeText={setSearchText}
            textAlignVertical="center"
          />
        </View>
        <TouchableOpacity
          style={[styles.filterEntryButton, { backgroundColor: theme.surface, borderColor: theme.border }]}
          activeOpacity={0.85}
          onPress={() => setFilterModalVisible(true)}
        >
          <Text style={[styles.filterEntryText, { color: theme.textPrimary }]}>{activeFilterCount > 0 ? `筛选(${activeFilterCount})` : '筛选'}</Text>
        </TouchableOpacity>
      </View>

      {((isAdmin && (selectedOrderCityId || selectedOrderStoreId)) || selectedOrderKind || statsRange !== 'all') && (
        <View style={styles.activeFiltersWrap}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.activeFiltersContent}>
            {isAdmin && selectedOrderCityId && (
              <TouchableOpacity
                style={[styles.activeFilterChip, { backgroundColor: theme.surfaceSecondary }]}
                onPress={() => setSelectedOrderCityId(null)}
              >
                <Text style={[styles.activeFilterChipText, { color: theme.textSecondary }]}>城市: {orderFilterCities.find((c) => c.id === selectedOrderCityId)?.name || '已选'} ×</Text>
              </TouchableOpacity>
            )}
            {isAdmin && selectedOrderStoreId && (
              <TouchableOpacity
                style={[styles.activeFilterChip, { backgroundColor: theme.surfaceSecondary }]}
                onPress={() => setSelectedOrderStoreId(null)}
              >
                <Text style={[styles.activeFilterChipText, { color: theme.textSecondary }]}>店铺: {activeStoresForOrderFilter.find((s) => s.id === selectedOrderStoreId)?.name || '已选'} ×</Text>
              </TouchableOpacity>
            )}
            {selectedOrderKind && (
              <TouchableOpacity
                style={[styles.activeFilterChip, { backgroundColor: theme.surfaceSecondary }]}
                onPress={() => setSelectedOrderKind(null)}
              >
                <Text style={[styles.activeFilterChipText, { color: theme.textSecondary }]}>类型: {getOrderKindLabel(selectedOrderKind)} ×</Text>
              </TouchableOpacity>
            )}
            {statsRange !== 'all' && (
              <TouchableOpacity
                style={[styles.activeFilterChip, { backgroundColor: theme.surfaceSecondary }]}
                onPress={() => {
                  setStatsRange('all');
                  setRangeStartDate('');
                  setRangeEndDate('');
                }}
              >
                <Text style={[styles.activeFilterChipText, { color: theme.textSecondary }]}>时间: {rangeLabel} ×</Text>
              </TouchableOpacity>
            )}
            <TouchableOpacity
              style={[styles.activeFilterChip, styles.activeFilterChipClear, { borderColor: theme.border }]}
              onPress={() => {
                if (isAdmin) {
                  setSelectedOrderCityId(null);
                  setSelectedOrderStoreId(null);
                }
                setSelectedOrderKind(null);
                setStatsRange('all');
                setRangeStartDate('');
                setRangeEndDate('');
              }}
            >
              <Text style={[styles.activeFilterChipText, { color: theme.textSecondary }]}>清空筛选</Text>
            </TouchableOpacity>
          </ScrollView>
        </View>
      )}

      <FlatList
        data={filteredOrders}
        keyExtractor={(item) => item.id}
        renderItem={renderOrder}
        contentContainerStyle={styles.list}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.pink} />}
        ListEmptyComponent={
          <View style={styles.emptyContainer}>
            <ClipboardList size={48} color={theme.textTertiary} strokeWidth={1.5} />
            <Text style={[styles.emptyText, { color: theme.textTertiary }]}>暂无订单记录</Text>
          </View>
        }
      />

      <Modal visible={filterModalVisible} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, { backgroundColor: theme.surface }] }>
            <View style={styles.modalHeader}>
              <Text style={[styles.modalTitle, { color: theme.textPrimary }]}>筛选条件</Text>
              <TouchableOpacity onPress={() => setFilterModalVisible(false)}>
                <Text style={styles.modalClose}>完成</Text>
              </TouchableOpacity>
            </View>

            {isAdmin && (
              <View style={[styles.filterPanelContainer, { backgroundColor: theme.surface }]}> 
                <Text style={[styles.filterLabel, { color: theme.textSecondary }]}>城市</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.filterRow} contentContainerStyle={styles.filterRowContent}>
                  <TouchableOpacity
                    style={[styles.chip, { backgroundColor: theme.surfaceSecondary }, selectedOrderCityId === null && styles.chipActive]}
                    onPress={() => setSelectedOrderCityId(null)}
                  >
                    <Text style={[styles.chipText, { color: theme.textSecondary }, selectedOrderCityId === null && styles.chipTextActive]} numberOfLines={1} ellipsizeMode="tail">
                      全部城市
                    </Text>
                  </TouchableOpacity>
                  {orderFilterCities.map((city) => (
                    <TouchableOpacity
                      key={city.id}
                      style={[styles.chip, { backgroundColor: theme.surfaceSecondary }, selectedOrderCityId === city.id && styles.chipActive]}
                      onPress={() => setSelectedOrderCityId(city.id)}
                    >
                      <Text style={[styles.chipText, { color: theme.textSecondary }, selectedOrderCityId === city.id && styles.chipTextActive]} numberOfLines={1} ellipsizeMode="tail">
                        {city.name}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </ScrollView>
                <Text style={[styles.filterLabel, { color: theme.textSecondary }]}>店铺</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.filterRow} contentContainerStyle={styles.filterRowContent}>
                  <TouchableOpacity
                    style={[styles.chip, { backgroundColor: theme.surfaceSecondary }, selectedOrderStoreId === null && styles.chipActive]}
                    onPress={() => setSelectedOrderStoreId(null)}
                  >
                    <Text style={[styles.chipText, { color: theme.textSecondary }, selectedOrderStoreId === null && styles.chipTextActive]} numberOfLines={1} ellipsizeMode="tail">
                      全部店铺
                    </Text>
                  </TouchableOpacity>
                  {activeStoresForOrderFilter.map((store) => (
                    <TouchableOpacity
                      key={store.id}
                      style={[styles.chip, { backgroundColor: theme.surfaceSecondary }, selectedOrderStoreId === store.id && styles.chipActive]}
                      onPress={() => setSelectedOrderStoreId(store.id)}
                    >
                      <Text style={[styles.chipText, { color: theme.textSecondary }, selectedOrderStoreId === store.id && styles.chipTextActive]} numberOfLines={1} ellipsizeMode="tail">
                        {store.name}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </ScrollView>
              </View>
            )}

            <View style={[styles.filterPanelContainer, { backgroundColor: theme.surface }]}> 
              <Text style={[styles.filterLabel, { color: theme.textSecondary }]}>订单类型</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.filterRow} contentContainerStyle={styles.filterRowContent}>
                <TouchableOpacity
                  style={[styles.chip, { backgroundColor: theme.surfaceSecondary }, selectedOrderKind === null && styles.chipActive]}
                  onPress={() => setSelectedOrderKind(null)}
                >
                  <Text style={[styles.chipText, { color: theme.textSecondary }, selectedOrderKind === null && styles.chipTextActive]} numberOfLines={1} ellipsizeMode="tail">
                    全部类型
                  </Text>
                </TouchableOpacity>
                {(
                  [
                    { key: 'distribution', label: '供货单' },
                    { key: 'settlement', label: '结算单' },
                    { key: 'retail', label: '零售单' },
                  ] as Array<{ key: OrderKind; label: string }>
                ).map((item) => (
                  <TouchableOpacity
                    key={item.key}
                    style={[styles.chip, { backgroundColor: theme.surfaceSecondary }, selectedOrderKind === item.key && styles.chipActive]}
                    onPress={() => setSelectedOrderKind(item.key)}
                  >
                    <Text style={[styles.chipText, { color: theme.textSecondary }, selectedOrderKind === item.key && styles.chipTextActive]} numberOfLines={1} ellipsizeMode="tail">
                      {item.label}
                    </Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
            </View>

            <View style={[styles.monthSwitchRow, { backgroundColor: theme.surface }]}> 
              {[
                { key: 'day', label: '当日' },
                { key: 'week', label: '本周' },
                { key: 'month', label: '本月' },
                { key: 'year', label: '年度' },
                { key: 'all', label: '累计' },
                { key: 'range', label: '自定义时间段' },
              ].map((item) => (
                <TouchableOpacity
                  key={item.key}
                  style={[styles.switchChip, { backgroundColor: theme.surfaceSecondary }, statsRange === item.key && styles.switchChipActive]}
                  onPress={() => setStatsRange(item.key as StatsRange)}
                >
                  <Text style={[styles.switchChipText, { color: theme.textSecondary }, statsRange === item.key && styles.switchChipTextActive]}>{item.label}</Text>
                </TouchableOpacity>
              ))}
            </View>

            {statsRange === 'range' && (
              <View style={[styles.customDateRow, { backgroundColor: theme.surface }] }>
                <Text style={[styles.customDateLabel, { color: theme.textSecondary }]}>起止</Text>
                <TextInput
                  value={rangeStartDate}
                  onChangeText={setRangeStartDate}
                  placeholder="开始 YYYY-MM-DD"
                  placeholderTextColor={theme.textTertiary}
                  style={[
                    styles.customDateInput,
                    {
                      backgroundColor: theme.surfaceSecondary,
                      color: theme.textPrimary,
                      lineHeight: 18,
                      paddingVertical: 0,
                      includeFontPadding: false,
                    },
                  ]}
                  textAlignVertical="center"
                />
                <Text style={[styles.customDateSeparator, { color: theme.textSecondary }]}>至</Text>
                <TextInput
                  value={rangeEndDate}
                  onChangeText={setRangeEndDate}
                  placeholder="结束 YYYY-MM-DD"
                  placeholderTextColor={theme.textTertiary}
                  style={[
                    styles.customDateInput,
                    {
                      backgroundColor: theme.surfaceSecondary,
                      color: theme.textPrimary,
                      lineHeight: 18,
                      paddingVertical: 0,
                      includeFontPadding: false,
                    },
                  ]}
                  textAlignVertical="center"
                />
              </View>
            )}

            <View style={styles.filterModalActions}>
              <TouchableOpacity
                style={[styles.clearButton, { borderColor: theme.border }]}
                onPress={() => {
                  if (isAdmin) {
                    setSelectedOrderCityId(null);
                    setSelectedOrderStoreId(null);
                  }
                  setSelectedOrderKind(null);
                  setStatsRange('all');
                  setRangeStartDate('');
                  setRangeEndDate('');
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

      <Modal visible={modalVisible} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, { backgroundColor: theme.surface }] }>
            <View style={styles.modalHeader}>
              <Text style={[styles.modalTitle, { color: theme.textPrimary }]}>新建分销订单（合并为单条）</Text>
              <TouchableOpacity onPress={() => { clearCart(); setModalSearchText(''); setModalVisible(false); }}>
                <Text style={styles.modalClose}>关闭</Text>
              </TouchableOpacity>
            </View>
            <View style={styles.modalSelectors}>
              {isAdmin && (
                <View style={styles.selectorGroup}>
                  <Text style={[styles.selectorLabel, { color: theme.textSecondary }]}>分销商</Text>
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.selectorScroll}>
                    <TouchableOpacity
                      style={[styles.chip, { backgroundColor: theme.surfaceSecondary }, orderModalDistributorId === null && styles.chipActive]}
                      onPress={() => { setOrderModalDistributorId(null); setOrderModalStoreId(null); }}
                    >
                      <Text style={[styles.chipText, { color: theme.textSecondary }, orderModalDistributorId === null && styles.chipTextActive]}>未选择</Text>
                    </TouchableOpacity>
                    {distributors.map(d => (
                      <TouchableOpacity
                        key={d.id}
                        style={[styles.chip, { backgroundColor: theme.surfaceSecondary }, orderModalDistributorId === d.id && styles.chipActive]}
                        onPress={() => { setOrderModalDistributorId(d.id); setOrderModalStoreId(null); }}
                      >
                        <Text style={[styles.chipText, { color: theme.textSecondary }, orderModalDistributorId === d.id && styles.chipTextActive]}>{d.store_name || d.email}</Text>
                      </TouchableOpacity>
                    ))}
                  </ScrollView>
                </View>
              )}

              <View style={styles.selectorGroup}>
                  <Text style={[styles.selectorLabel, { color: theme.textSecondary }]}>店铺</Text>
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.selectorScroll}>
                    <TouchableOpacity
                      style={[styles.chip, { backgroundColor: theme.surfaceSecondary }, orderModalStoreId === null && styles.chipActive]}
                      onPress={() => setOrderModalStoreId(null)}
                    >
                      <Text style={[styles.chipText, { color: theme.textSecondary }, orderModalStoreId === null && styles.chipTextActive]}>未选择</Text>
                    </TouchableOpacity>
                    {stores
                      .filter((s) => {
                        if (s.status !== 'active') return false;
                        if (isAdmin) return true;
                        return s.distributor_id === user?.id || !s.distributor_id;
                      })
                      .map(s => (
                        <TouchableOpacity
                          key={s.id}
                          style={[styles.chip, { backgroundColor: theme.surfaceSecondary }, orderModalStoreId === s.id && styles.chipActive]}
                          onPress={() => setOrderModalStoreId(s.id)}
                        >
                          <Text style={[styles.chipText, { color: theme.textSecondary }, orderModalStoreId === s.id && styles.chipTextActive]}>{s.name}</Text>
                        </TouchableOpacity>
                      ))}
                  </ScrollView>
                </View>
            </View>

            <View style={[styles.searchContainer, styles.searchContainerCompact, { backgroundColor: theme.surfaceSecondary, marginHorizontal: 15, marginBottom: 10 }] }>
              <Search size={18} color={theme.textTertiary} style={styles.searchIcon} />
              <TextInput
                style={[styles.searchInput, { color: theme.textPrimary }]}
                placeholder="搜索商品名称..."
                placeholderTextColor={theme.textTertiary}
                value={modalSearchText}
                onChangeText={setModalSearchText}
                textAlignVertical="center"
              />
            </View>

            <FlatList
              data={filteredAvailableProducts}
              keyExtractor={(item) => item.id}
              renderItem={renderProductRow}
              style={styles.productList}
              ListEmptyComponent={
                <View style={styles.emptyContainerModal}>
                  <ShoppingBag size={40} color={theme.textTertiary} strokeWidth={1.5} />
                  <Text style={[styles.emptyText, { color: theme.textTertiary }]}>暂无可选商品</Text>
                </View>
              }
            />

            {cartItems.length > 0 && (
              <View style={styles.cartSummary}>
                <Text style={styles.cartLine}>件数：{cartCount}</Text>
                <Text style={styles.cartLine}>样品行：{sampleLineCount}</Text>
                <Text style={styles.cartLine}>零售总价：{cartRetailTotal.toFixed(2)}元</Text>
                <Text style={styles.cartLine}>折扣总价：{cartDiscountTotal.toFixed(2)}元</Text>
              </View>
            )}

            <View style={styles.modalButtons}>
              <TouchableOpacity style={styles.clearButton} onPress={clearCart} disabled={cartItems.length === 0}>
                <Text style={[styles.clearButtonText, cartItems.length === 0 && { color: Colors.textTertiary }]}>清空</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.confirmButtonWrap, cartItems.length === 0 && styles.disabledButton]}
                onPress={handleSubmitOrder}
                disabled={cartItems.length === 0}
                activeOpacity={0.85}
              >
                <LinearGradient colors={['#FF6B9D', '#5B8DEF']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={styles.confirmButton}>
                  <Text style={styles.confirmButtonText}>确认下单</Text>
                </LinearGradient>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      <Modal visible={outboundModalVisible} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, { backgroundColor: theme.surface }] }>
            <Text style={[styles.modalTitle, { color: theme.textPrimary }]}>条码出库</Text>
            <Text style={[styles.modalSubtitle, { color: theme.textSecondary }]}>扫码枪输入条码后回车可自动识别</Text>

            <View style={styles.inputGroup}>
              <Text style={[styles.inputLabel, { color: theme.textSecondary }]}>商品条码</Text>
              <TextInput
                style={[styles.modalInput, { backgroundColor: theme.surfaceSecondary, color: theme.textPrimary }]}
                value={outboundBarcode}
                onChangeText={handleOutboundBarcodeLookup}
                keyboardType="number-pad"
                autoFocus
                maxLength={13}
                placeholder="请输入13位条码"
                placeholderTextColor={theme.textTertiary}
                onSubmitEditing={() => handleOutboundBarcodeLookup()}
              />
            </View>

            {outboundBarcode.length === 13 ? (
              <View style={[styles.scanResultBox, { backgroundColor: theme.surfaceSecondary }]}>
                {outboundProduct ? (
                  <>
                    <Text style={[styles.scanResultName, { color: theme.textPrimary }]}>{outboundProduct.name}</Text>
                    <Text style={[styles.scanResultStock, { color: theme.textSecondary }]}>当前库存：{outboundProduct.quantity ?? 0}</Text>
                  </>
                ) : (
                  <Text style={styles.scanResultError}>未找到对应商品</Text>
                )}
              </View>
            ) : null}

            <View style={styles.inputGroup}>
              <Text style={[styles.inputLabel, { color: theme.textSecondary }]}>出库数量</Text>
              <TextInput
                style={[styles.modalInput, { backgroundColor: theme.surfaceSecondary, color: theme.textPrimary }]}
                value={outboundQuantity}
                onChangeText={setOutboundQuantity}
                keyboardType="number-pad"
                placeholder="请输入数量"
                placeholderTextColor={theme.textTertiary}
              />
            </View>

            <View style={styles.modalButtons}>
              <TouchableOpacity
                style={styles.clearButton}
                onPress={() => {
                  setOutboundModalVisible(false);
                  resetOutboundForm();
                }}
                disabled={submittingOutbound}
              >
                <Text style={styles.clearButtonText}>取消</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.confirmButtonWrap, submittingOutbound && styles.disabledButton]}
                onPress={handleConfirmOutbound}
                disabled={submittingOutbound}
                activeOpacity={0.85}
              >
                <LinearGradient colors={['#FF6B9D', '#5B8DEF']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={styles.confirmButton}>
                  <Text style={styles.confirmButtonText}>{submittingOutbound ? '处理中...' : '确认出库'}</Text>
                </LinearGradient>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      <Modal visible={detailOrder !== null} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, { backgroundColor: theme.surface }] }>
            <View style={styles.modalHeader}>
              <Text style={[styles.modalTitle, { color: theme.textPrimary }]}>订单详情</Text>
              <TouchableOpacity onPress={() => setDetailOrder(null)}>
                <Text style={styles.modalClose}>关闭</Text>
              </TouchableOpacity>
            </View>

            {detailOrder ? (
              <ScrollView style={styles.detailScroll}>
                <View style={styles.detailSection}>
                  <Text style={[styles.detailLabel, { color: theme.textSecondary }]}>订单号</Text>
                  <Text style={[styles.detailValue, { color: theme.textPrimary }]}>#{detailOrder.id.slice(0, 8)}</Text>
                </View>
                <View style={styles.detailSection}>
                  <Text style={[styles.detailLabel, { color: theme.textSecondary }]}>类型</Text>
                  <Text style={[styles.detailValue, { color: theme.textPrimary }]}>{getOrderKindLabel(detailOrder.order_kind)}</Text>
                </View>
                <View style={styles.detailSection}>
                  <Text style={[styles.detailLabel, { color: theme.textSecondary }]}>时间</Text>
                  <Text style={[styles.detailValue, { color: theme.textPrimary }]}>{new Date(detailOrder.created_at).toLocaleString('zh-CN')}</Text>
                </View>
                <View style={styles.detailSection}>
                  <Text style={[styles.detailLabel, { color: theme.textSecondary }]}>配送店铺</Text>
                  <Text style={[styles.detailValue, { color: theme.textPrimary }]}>
                    {detailOrder.store_name || '未指定'}
                  </Text>
                </View>
                <View style={styles.detailSection}>
                  <Text style={[styles.detailLabel, { color: theme.textSecondary }]}>下单账号</Text>
                  <Text style={[styles.detailValue, { color: theme.textPrimary }]}> 
                    {detailOrder.distributor_email || detailOrder.distributor_id}
                    {detailOrder.distributor_store ? ` · ${detailOrder.distributor_store}` : ''}
                  </Text>
                </View>

                {(detailOrder.order_kind === 'retail' || detailOrder.payment_method) && (
                  <View style={styles.detailSection}>
                    <Text style={[styles.detailLabel, { color: theme.textSecondary }]}>客户支付渠道</Text>
                    <Text style={[styles.detailValue, { color: theme.textPrimary }]}> 
                      {getPaymentMethodLabel(detailOrder.payment_method)}
                    </Text>
                  </View>
                )}

                <View style={styles.detailSection}>
                  <Text style={[styles.detailLabel, { color: theme.textSecondary }]}>商品明细</Text>
                  {detailOrder.items.map((orderItem) => (
                    <View key={orderItem.id} style={[styles.detailItemRow, { borderBottomColor: theme.divider }]}>
                      <Text style={[styles.detailItemName, { color: theme.textPrimary }]}>
                        {orderItem.product_name || '未知商品'}
                        {orderItem.is_sample ? '（样品）' : ''}
                      </Text>
                      <Text style={[styles.detailItemQty, { color: theme.textSecondary }]}>x{orderItem.quantity}</Text>
                      <Text style={styles.detailItemPrice}>{orderItem.is_sample ? '样品' : `${orderItem.discount_price}元`}</Text>
                    </View>
                  ))}
                </View>

                <View style={styles.detailSection}>
                  <Text style={[styles.detailLabel, { color: theme.textSecondary }]}>零售总价</Text>
                  <Text style={[styles.detailValue, { color: theme.textPrimary }]}>{Number(detailOrder.total_retail_amount || 0).toFixed(2)}元</Text>
                </View>
                <View style={styles.detailSection}>
                  <Text style={[styles.detailLabel, { color: theme.textSecondary }]}>{getOrderTotalLabel(detailOrder.order_kind)}</Text>
                  <Text style={[styles.detailValue, { color: theme.textPrimary }]}>{Number(detailOrder.total_discount_amount || 0).toFixed(2)}元</Text>
                </View>
              </ScrollView>
            ) : null}
          </View>
        </View>
      </Modal>
      <Modal visible={modifyOrder !== null} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, { backgroundColor: theme.surface }] }>
            <View style={styles.modalHeader}>
              <Text style={[styles.modalTitle, { color: theme.textPrimary }]}>修改订单 (仅减量)</Text>
              <TouchableOpacity onPress={() => { setModifyOrder(null); setModifyCart(new Map()); }}>
                <Text style={styles.modalClose}>关闭</Text>
              </TouchableOpacity>
            </View>

            {modifyOrder ? (
              <ScrollView style={styles.detailScroll}>
                {modifyOrder.items.map((orderItem) => {
                  const currentQty = modifyCart.get(orderItem.id) ?? orderItem.quantity;
                  return (
                    <View key={orderItem.id} style={[styles.detailItemRow, { borderBottomColor: theme.divider }]}>
                      <Text style={[styles.detailItemName, { color: theme.textPrimary }]}>
                        {orderItem.product_name || '未知商品'}
                        {orderItem.is_sample ? '（样品）' : ''}
                      </Text>
                      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                        <TouchableOpacity
                          style={styles.qtyBtn}
                          onPress={() => {
                            if (currentQty > 0) {
                              const nextCart = new Map(modifyCart);
                              nextCart.set(orderItem.id, currentQty - 1);
                              setModifyCart(nextCart);
                            }
                          }}
                        >
                          <Text style={styles.qtyBtnText}>-</Text>
                        </TouchableOpacity>
                        <Text style={[styles.qtyValue, { color: theme.textPrimary }]}>{currentQty}</Text>
                        <TouchableOpacity
                          style={[styles.qtyBtn, { opacity: 0.5 }]}
                          disabled={true}
                        >
                          <Text style={styles.qtyBtnText}>+</Text>
                        </TouchableOpacity>
                      </View>
                    </View>
                  );
                })}
              </ScrollView>
            ) : null}

            <View style={styles.modalButtons}>
              <TouchableOpacity
                style={[styles.confirmButtonWrap, submittingModify && styles.disabledButton]}
                onPress={async () => {
                  if (!modifyOrder) return;
                  setSubmittingModify(true);
                  const itemsPayload = Array.from(modifyCart.entries()).map(([id, qty]) => ({
                    order_item_id: id,
                    new_quantity: qty,
                  }));
                  const { error } = await useAppStore.getState().modifyDistributionOrder(modifyOrder.id, itemsPayload);
                  setSubmittingModify(false);
                  if (error) {
                    Toast.show({ type: 'error', text1: '修改失败', text2: error.message });
                  } else {
                    Toast.show({ type: 'success', text1: '成功', text2: '订单已修改' });
                    setModifyOrder(null);
                    setModifyCart(new Map());
                  }
                }}
                disabled={submittingModify}
                activeOpacity={0.85}
              >
                <LinearGradient colors={['#FF6B9D', '#5B8DEF']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={styles.confirmButton}>
                  <Text style={styles.confirmButtonText}>{submittingModify ? '处理中...' : '确认修改'}</Text>
                </LinearGradient>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      <Modal visible={retailModalVisible} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, { backgroundColor: theme.surface }]}>
            <View style={styles.modalHeader}>
              <Text style={[styles.modalTitle, { color: theme.textPrimary }]}>结算建单</Text>
              <TouchableOpacity onPress={() => setRetailModalVisible(false)}>
                <Text style={styles.modalClose}>取消</Text>
              </TouchableOpacity>
            </View>

            <View style={[styles.filterPanelContainer, { backgroundColor: theme.surface }]}>
              <Text style={[styles.filterLabel, { color: theme.textSecondary }]}>选择店铺</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.filterRow} contentContainerStyle={styles.filterRowContent}>
                {stores.filter(s => s.status === 'active').map(store => (
                  <TouchableOpacity
                    key={store.id}
                    style={[styles.chip, { backgroundColor: theme.surfaceSecondary }, retailStoreId === store.id && styles.chipActive]}
                    onPress={() => {
                      setRetailStoreId(store.id);
                      setRetailCart(new Map());
                    }}
                  >
                    <Text style={[styles.chipText, { color: theme.textSecondary }, retailStoreId === store.id && styles.chipTextActive]} numberOfLines={1} ellipsizeMode="tail">
                      {store.name}
                    </Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
            </View>

            {retailStoreId ? (
              <FlatList
                data={products.filter(p => p.city_id === stores.find(s => s.id === retailStoreId)?.city_id)}
                keyExtractor={item => item.id}
                style={styles.list}
                renderItem={({ item }) => {
                  const stock = storeInventory.find(inv => inv.product_id === item.id && inv.store_id === retailStoreId)?.quantity || 0;
                  const qty = retailCart.get(item.id) || 0;
                  const isZeroStock = stock <= 0;
                  const editing = retailQtyEditingKey === item.id;
                  const inputValue = retailQtyInputMode.get(item.id) || '';
                  
                  return (
                    <View style={[styles.productRow, isZeroStock && { opacity: 0.5 }]}>
                      {item.image_url ? (
                        <Image source={{ uri: item.image_url }} style={styles.productThumb} />
                      ) : (
                        <View style={styles.productThumbPlaceholder}>
                          <Text style={styles.productThumbPlaceholderText}>{item.name.charAt(0)}</Text>
                        </View>
                      )}
                      <View style={styles.productRowInfo}>
                        <Text style={[styles.productRowName, { color: theme.textPrimary }]} numberOfLines={1} ellipsizeMode="tail">{item.name}</Text>
                        <Text style={[styles.productRowMeta, { color: theme.textSecondary }]}>
                          库存: {stock} · 零售价: {item.price}元
                        </Text>
                      </View>
                      <View style={styles.productRowActions}>
                        {qty > 0 ? (
                          <>
                            <TouchableOpacity 
                              style={styles.qtyBtn} 
                              onPress={() => {
                                setRetailCart(prev => {
                                  const next = new Map(prev);
                                  const newQty = qty - 1;
                                  if (newQty <= 0) next.delete(item.id);
                                  else next.set(item.id, newQty);
                                  return next;
                                });
                              }}
                            >
                              <Text style={styles.qtyBtnText}>-</Text>
                            </TouchableOpacity>
                            {editing ? (
                              <TextInput
                                style={styles.qtyInput}
                                value={inputValue}
                                onChangeText={text => {
                                  setRetailQtyInputMode(prev => {
                                    const next = new Map(prev);
                                    next.set(item.id, text.replace(/[^0-9]/g, ''));
                                    return next;
                                  });
                                }}
                                onBlur={() => {
                                  const val = parseInt(retailQtyInputMode.get(item.id) || '0', 10);
                                  if (!isNaN(val) && val > 0) {
                                    if (val > stock) {
                                      Toast.show({ type: 'error', text1: '库存不足', text2: `当前库存仅 ${stock}` });
                                    } else {
                                      setRetailCart(prev => {
                                        const next = new Map(prev);
                                        next.set(item.id, val);
                                        return next;
                                      });
                                    }
                                  } else if (val === 0) {
                                    setRetailCart(prev => {
                                      const next = new Map(prev);
                                      next.delete(item.id);
                                      return next;
                                    });
                                  }
                                  setRetailQtyEditingKey(null);
                                }}
                                keyboardType="number-pad"
                                autoFocus
                              />
                            ) : (
                              <TouchableOpacity onPress={() => {
                                setRetailQtyInputMode(prev => {
                                  const next = new Map(prev);
                                  next.set(item.id, '');
                                  return next;
                                });
                                setRetailQtyEditingKey(item.id);
                              }}>
                                <Text style={styles.qtyValue}>{qty}</Text>
                              </TouchableOpacity>
                            )}
                          </>
                        ) : <Text style={styles.qtyEmpty}>0</Text>}
                        <TouchableOpacity 
                          disabled={isZeroStock || qty >= stock}
                          onPress={() => {
                            setRetailCart(prev => {
                              const next = new Map(prev);
                              next.set(item.id, qty + 1);
                              return next;
                            });
                          }}
                          activeOpacity={0.85}
                        >
                          <LinearGradient 
                            colors={isZeroStock || qty >= stock ? ['#ccc', '#ccc'] : ['#FF6B9D', '#5B8DEF']} 
                            start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} 
                            style={styles.qtyBtnAdd}
                          >
                            <Text style={styles.qtyBtnAddText}>+1</Text>
                          </LinearGradient>
                        </TouchableOpacity>
                      </View>
                    </View>
                  );
                }}
              />
            ) : (
              <View style={styles.emptyContainer}>
                <ClipboardList size={48} color={theme.textTertiary} strokeWidth={1.5} />
                <Text style={[styles.emptyText, { color: theme.textTertiary }]}>请先选择店铺</Text>
              </View>
            )}

            <View style={[styles.modalButtons, { alignItems: 'center', justifyContent: 'space-between' }]}>
              <View style={{ flex: 1 }}>
                <Text style={{ color: theme.textPrimary, fontSize: 14, fontWeight: '600' }}>
                  共 {Array.from(retailCart.values()).reduce((a, b) => a + b, 0)} 件
                </Text>
                <Text style={{ color: theme.textSecondary, fontSize: 12, marginTop: 2 }}>
                  合计: {Array.from(retailCart.entries()).reduce((sum, [id, qty]) => {
                    const p = products.find(p => p.id === id);
                    return sum + (p?.price || 0) * qty;
                  }, 0).toFixed(2)}元
                </Text>
              </View>
              <TouchableOpacity
                style={[styles.confirmButtonWrap, { flex: 1 }, (!retailStoreId || retailCart.size === 0 || submittingRetailOrder) && styles.disabledButton]}
                onPress={async () => {
                  if (!retailStoreId || retailCart.size === 0) return;
                  setSubmittingRetailOrder(true);
                  const items = Array.from(retailCart.entries()).map(([id, qty]) => {
                    const p = products.find(p => p.id === id);
                    return {
                      product_id: id,
                      quantity: qty,
                      price: p?.price || 0,
                    };
                  });
                  const { error } = await createSettlementOrder(retailStoreId, items);
                  setSubmittingRetailOrder(false);
                  if (error) {
                    Toast.show({ type: 'error', text1: '建单失败', text2: error.message });
                  } else {
                    Toast.show({ type: 'success', text1: '成功', text2: '结算订单已创建' });
                    setRetailModalVisible(false);
                    setRetailCart(new Map());
                    fetchOrders();
                  }
                }}
                disabled={!retailStoreId || retailCart.size === 0 || submittingRetailOrder}
                activeOpacity={0.85}
              >
                <LinearGradient colors={['#FF6B9D', '#5B8DEF']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={styles.confirmButton}>
                  <Text style={styles.confirmButtonText}>{submittingRetailOrder ? '处理中...' : '确认建单'}</Text>
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
  container: { flex: 1, backgroundColor: Colors.background, position: 'relative' },
  header: {
    height: 62,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 15,
    backgroundColor: Colors.surface,
  },
  headerTitle: { fontSize: 20, fontWeight: '700', color: Colors.textPrimary },
  headerActions: { flexDirection: 'row', alignItems: 'center' },
  outboundButtonWrap: { marginRight: 8 },
  addButton: { paddingHorizontal: 16, paddingVertical: 9, borderRadius: Radius.xl },
  addButtonText: { color: '#fff', fontWeight: '600', fontSize: 14 },
  filterPanelContainer: { paddingTop: 6, paddingBottom: 8 },
  filterLabel: { fontSize: 12, fontWeight: '600', paddingHorizontal: 12, marginBottom: 4 },
  filterRow: { minHeight: 42 },
  filterRowContent: { paddingVertical: 8, paddingHorizontal: 10, alignItems: 'center' },
  chip: {
    width: 100,
    height: 30,
    borderRadius: 14,
    backgroundColor: Colors.surfaceSecondary,
    marginRight: 6,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chipActive: { backgroundColor: Colors.pink },
  chipText: { color: Colors.textSecondary, fontSize: 11, fontWeight: '600', width: '100%', textAlign: 'center', paddingHorizontal: 4 },
  chipTextActive: { color: '#fff', fontWeight: '600', width: '100%', textAlign: 'center', paddingHorizontal: 4 },
  monthSwitchRow: { flexDirection: 'row', backgroundColor: Colors.surface, paddingHorizontal: 10, paddingBottom: 8, flexWrap: 'wrap' },
  switchChip: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 14,
    backgroundColor: Colors.surfaceSecondary,
    marginRight: 8,
  },
  switchChipActive: { backgroundColor: Colors.blue },
  switchChipText: { color: Colors.textSecondary, fontSize: 12 },
  switchChipTextActive: { color: '#fff', fontWeight: '600' },
  customDateRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.surface,
    paddingHorizontal: 10,
    paddingBottom: 8,
  },
  customDateLabel: {
    fontSize: 12,
    color: Colors.textSecondary,
    marginRight: 8,
  },
  customDateSeparator: {
    fontSize: 12,
    color: Colors.textSecondary,
    marginHorizontal: 8,
  },
  customDateInput: {
    flex: 1,
    height: 36,
    borderRadius: Radius.md,
    backgroundColor: Colors.surfaceSecondary,
    paddingHorizontal: 10,
    fontSize: 13,
    color: Colors.textPrimary,
  },
  summary: { flexDirection: 'row', backgroundColor: Colors.surface, minHeight: 70, paddingVertical: 12, marginBottom: 8, alignItems: 'center' },
  summaryItem: { flex: 1, alignItems: 'center' },
  summaryValue: { fontSize: 14, fontWeight: '700', color: Colors.pink },
  summaryLabel: { fontSize: 12, color: Colors.textSecondary, marginTop: 4 },
  statsCard: {
    backgroundColor: Colors.surface,
    borderRadius: Radius.lg,
    marginHorizontal: 10,
    marginBottom: 8,
    padding: 10,
    minHeight: 44,
    overflow: 'hidden',
    ...Shadow.card,
  },
  statsHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  statsTitle: { fontSize: 14, fontWeight: '700', color: Colors.textPrimary },
  statsSubTitle: { fontSize: 12, color: Colors.textSecondary, marginTop: 6 },
  statsRowText: { fontSize: 12, color: Colors.textPrimary, marginTop: 2, lineHeight: 17, flexShrink: 1 },
  statsRowPlaceholder: { color: Colors.textTertiary },
  statsRow: { flexDirection: 'row', justifyContent: 'space-between', gap: 12, alignItems: 'flex-start' },
  statsColumn: { flex: 1, minWidth: 0 },
  statsColumnScroll: {
    maxHeight: 160,
  },
  statsScrollContent: { paddingTop: 6, paddingBottom: 2, paddingRight: 8 },
  statsList: { paddingTop: 6, paddingBottom: 4 },
  statsListItem: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: Radius.md,
    borderWidth: 1,
    paddingHorizontal: 8,
    paddingVertical: 8,
    marginBottom: 6,
    width: '100%',
  },
  statsListName: {
    flex: 1,
    fontSize: 12,
    fontWeight: '600',
    lineHeight: 16,
    marginRight: 8,
    overflow: 'hidden',
  },
  statsListQty: {
    minWidth: 28,
    textAlign: 'right',
    fontSize: 16,
    fontWeight: '700',
    color: Colors.pink,
  },
  statsItemCard: {
    width: 102,
    minHeight: 52,
    borderRadius: Radius.md,
    paddingHorizontal: 8,
    paddingVertical: 8,
    marginRight: 8,
    justifyContent: 'center',
  },
  statsItemName: { fontSize: 11, fontWeight: '600', marginBottom: 4 },
  statsItemQty: { fontSize: 16, fontWeight: '700', color: Colors.pink },
  searchFilterRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: 10,
    marginBottom: 8,
    gap: 8,
  },
  searchContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.surfaceSecondary,
    marginBottom: 10,
    borderRadius: Radius.pill,
    paddingHorizontal: 12,
    height: 40,
  },
  searchContainerCompact: {
    flex: 1,
    marginHorizontal: 0,
    marginBottom: 0,
  },
  filterEntryButton: {
    height: 40,
    borderRadius: Radius.pill,
    borderWidth: 1,
    paddingHorizontal: 14,
    justifyContent: 'center',
    alignItems: 'center',
  },
  filterEntryText: { fontSize: 13, fontWeight: '700', color: Colors.textPrimary },
  searchIcon: { marginRight: 8 },
  searchInput: {
    flex: 1,
    fontSize: 14,
    lineHeight: 20,
    color: Colors.textPrimary,
    paddingVertical: 0,
    includeFontPadding: false,
    textAlignVertical: 'center',
  },
  activeFiltersWrap: {
    marginHorizontal: 10,
    marginBottom: 10,
  },
  activeFiltersContent: {
    paddingRight: 8,
    alignItems: 'center',
  },
  activeFilterChip: {
    height: 30,
    borderRadius: Radius.pill,
    paddingHorizontal: 10,
    justifyContent: 'center',
    marginRight: 8,
  },
  activeFilterChipClear: {
    borderWidth: 1,
    backgroundColor: Colors.surface,
  },
  activeFilterChipText: {
    fontSize: 12,
    fontWeight: '600',
    color: Colors.textSecondary,
  },
  list: { padding: 10 },
  orderCard: {
    backgroundColor: Colors.surface,
    borderRadius: Radius.lg,
    padding: 12,
    marginBottom: 10,
    ...Shadow.card,
  },
  orderHeader: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 6 },
  orderId: { fontSize: 15, fontWeight: '700', color: Colors.textPrimary },
  orderKindTag: { marginTop: 4, fontSize: 11, color: Colors.blue, fontWeight: '600' },
  orderDate: { fontSize: 12, color: Colors.textTertiary },
  orderMetaContainer: { flexDirection: 'row', alignItems: 'center', marginBottom: 8 },
  orderMeta: { fontSize: 12, color: Colors.textSecondary },
  orderItemsSummary: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  orderItemsSummaryText: { fontSize: 12, color: Colors.textSecondary },
  detailButton: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: Radius.sm,
    backgroundColor: Colors.surfaceSecondary,
  },
  detailButtonText: { color: Colors.blue, fontSize: 12, fontWeight: '600' },
  orderItemRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 6 },
  orderItemName: { flex: 1, fontSize: 14, color: Colors.textPrimary },
  orderItemQty: { width: 50, textAlign: 'center', color: Colors.textSecondary, fontSize: 13 },
  orderItemPrice: { width: 85, textAlign: 'right', color: Colors.blue, fontSize: 13, fontWeight: '600' },
  orderTotals: { marginTop: 6, borderTopWidth: 1, borderTopColor: Colors.divider, paddingTop: 6 },
  detailText: { fontSize: 12, color: Colors.textSecondary },
  totalText: { fontSize: 16, fontWeight: '700', color: Colors.pink, marginTop: 3 },
  orderActions: { flexDirection: 'row', justifyContent: 'flex-end', alignItems: 'center', marginTop: 8 },
  modifyOrderButton: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Colors.blue,
    backgroundColor: Colors.blueBg,
    marginRight: 8,
  },
  modifyOrderButtonText: { fontSize: 12, color: Colors.blue, fontWeight: '600' },
  deleteOrderButton: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Colors.danger,
    backgroundColor: Colors.dangerBg,
  },
  deleteOrderButtonDisabled: { opacity: 0.6 },
  deleteOrderButtonText: { fontSize: 12, color: Colors.danger, fontWeight: '600' },
  acceptOrderButton: {
    backgroundColor: Colors.success,
    borderRadius: Radius.md,
    paddingHorizontal: 12,
    paddingVertical: 6,
    marginRight: 8,
  },
  acceptOrderButtonText: { color: '#fff', fontSize: 12, fontWeight: '700' },
  acceptedTag: {
    backgroundColor: Colors.successBg,
    borderRadius: Radius.md,
    paddingHorizontal: 10,
    paddingVertical: 4,
    marginRight: 8,
  },
  acceptedTagText: { color: Colors.success, fontSize: 11, fontWeight: '600' },
  emptyContainer: { alignItems: 'center', paddingTop: 60 },
  emptyContainerModal: { alignItems: 'center', paddingTop: 40 },
  emptyText: { textAlign: 'center', color: Colors.textTertiary, marginTop: 12, fontSize: 14 },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(45,45,63,0.4)', justifyContent: 'flex-end' },
  modalContent: {
    backgroundColor: Colors.surface,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    padding: 20,
    maxHeight: '90%',
  },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  modalTitle: { fontSize: 20, fontWeight: '700', color: Colors.textPrimary },
  modalSubtitle: { marginTop: 6, marginBottom: 14, color: Colors.textSecondary, fontSize: 14 },
  modalClose: { fontSize: 16, color: Colors.pink, fontWeight: '500' },
  inputGroup: { marginBottom: 12 },
  inputLabel: { fontSize: 13, color: Colors.textSecondary, marginBottom: 6 },
  modalInput: {
    height: 44,
    borderRadius: Radius.md,
    backgroundColor: Colors.surfaceSecondary,
    paddingHorizontal: 12,
    fontSize: 16,
    color: Colors.textPrimary,
  },
  scanResultBox: {
    backgroundColor: Colors.surfaceSecondary,
    borderRadius: Radius.md,
    padding: 12,
    marginBottom: 12,
  },
  scanResultName: { fontSize: 16, fontWeight: '700', color: Colors.textPrimary },
  scanResultStock: { marginTop: 4, color: Colors.textSecondary, fontSize: 13 },
  scanResultError: { color: Colors.danger, fontSize: 13, fontWeight: '600' },
  detailScroll: { maxHeight: 420 },
  detailSection: { marginBottom: 10 },
  detailLabel: { fontSize: 12, color: Colors.textSecondary, marginBottom: 4 },
  detailValue: { fontSize: 14, color: Colors.textPrimary },
  detailItemRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 6,
    borderBottomWidth: 1,
    borderBottomColor: Colors.divider,
  },
  detailItemName: { flex: 1, fontSize: 14, color: Colors.textPrimary },
  detailItemQty: { width: 46, textAlign: 'center', color: Colors.textSecondary, fontSize: 12 },
  detailItemPrice: { width: 90, textAlign: 'right', color: Colors.blue, fontSize: 12, fontWeight: '600' },
  productList: { maxHeight: 280 },
  productRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: Colors.divider,
  },
  productRowInfo: { flex: 1, marginRight: 10 },
  productRowName: { fontSize: 15, fontWeight: '600', color: Colors.textPrimary },
  productRowMeta: { fontSize: 12, color: Colors.textTertiary, marginTop: 2 },
  productRowActions: { flexDirection: 'row', alignItems: 'center' },
  productRowActionsMulti: { minWidth: 170 },
  productLineRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', marginBottom: 4 },
  productLineLabel: { width: 34, fontSize: 11, color: Colors.textSecondary, fontWeight: '600' },
  productLineLabelSample: { width: 34, fontSize: 11, color: Colors.blue, fontWeight: '700' },
  qtyEmpty: { width: 32, textAlign: 'center', fontSize: 14, color: Colors.textTertiary },
  sampleToggle: {
    paddingHorizontal: 10,
    height: 28,
    borderRadius: Radius.pill,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.surfaceSecondary,
    justifyContent: 'center',
    marginRight: 8,
  },
  sampleToggleActive: {
    borderColor: Colors.blue,
    backgroundColor: Colors.blueBg,
  },
  sampleToggleText: {
    fontSize: 12,
    color: Colors.textSecondary,
    fontWeight: '600',
  },
  sampleToggleTextActive: {
    color: Colors.blue,
  },
  qtyBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: Colors.surfaceSecondary,
    justifyContent: 'center',
    alignItems: 'center',
  },
  qtyBtnText: { fontSize: 18, fontWeight: 'bold', color: Colors.textSecondary },
  qtyBtnAdd: { width: 32, height: 32, borderRadius: 16, justifyContent: 'center', alignItems: 'center' },
  qtyBtnAddText: { fontSize: 18, fontWeight: 'bold', color: '#fff' },
  qtyValue: { width: 32, textAlign: 'center', fontSize: 16, fontWeight: 'bold', color: Colors.textPrimary },
  cartSummary: {
    backgroundColor: Colors.surfaceSecondary,
    borderRadius: Radius.lg,
    padding: 12,
    marginTop: 10,
    marginBottom: 10,
  },
  modalSelectors: { paddingHorizontal: 15, paddingBottom: 10 },
  selectorGroup: { marginBottom: 10 },
  selectorLabel: { fontSize: 12, marginBottom: 6, fontWeight: '600' },
  selectorScroll: { flexDirection: 'row' },
  cartLine: { fontSize: 13, color: Colors.textPrimary, marginBottom: 2 },
  modalButtons: { flexDirection: 'row' },
  filterModalActions: { flexDirection: 'row', marginTop: 10 },
  clearButton: {
    height: 48,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 20,
    marginRight: 10,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: Radius.lg,
  },
  clearButtonText: { fontSize: 16, color: Colors.textSecondary },
  confirmButtonWrap: { flex: 1, borderRadius: Radius.lg, overflow: 'hidden' },
  confirmButton: { height: 48, justifyContent: 'center', alignItems: 'center', borderRadius: Radius.lg },
  disabledButton: { opacity: 0.5 },
  confirmButtonText: { fontSize: 16, color: '#fff', fontWeight: '600' },
  exportButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Colors.blue,
    backgroundColor: Colors.blueBg,
    marginRight: 8,
  },
  exportButtonText: { fontSize: 12, color: Colors.blue, fontWeight: '600', marginLeft: 4 },
  productThumb: {
    width: 40,
    height: 40,
    borderRadius: Radius.sm,
    marginRight: 10,
  },
  productThumbPlaceholder: {
    width: 40,
    height: 40,
    borderRadius: Radius.sm,
    marginRight: 10,
    backgroundColor: Colors.surfaceSecondary,
    justifyContent: 'center',
    alignItems: 'center',
  },
  productThumbPlaceholderText: {
    fontSize: 16,
    fontWeight: '700',
    color: Colors.textTertiary,
  },
  qtyInput: {
    width: 50,
    height: 28,
    borderRadius: Radius.sm,
    backgroundColor: Colors.surfaceSecondary,
    paddingHorizontal: 6,
    fontSize: 14,
    color: Colors.textPrimary,
    textAlign: 'center',
  },
  addFiveBtn: {
    marginLeft: 6,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: Radius.sm,
    backgroundColor: Colors.pink,
    justifyContent: 'center',
    alignItems: 'center',
  },
  addFiveBtnText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#fff',
  },
});
