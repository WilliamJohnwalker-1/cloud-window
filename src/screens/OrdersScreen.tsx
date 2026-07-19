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
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Search, ShoppingBag, PackageCheck, ClipboardList, Download, ChevronDown } from 'lucide-react-native';
import Toast from 'react-native-toast-message';

import { useAppStore } from '../store/useAppStore';
import ProvinceCityFilter from '../components/ProvinceCityFilter';
import { Colors, Shadow, Radius, LightColors, DarkColors } from '../theme';
import { EXTERNAL_CHANNEL_LABELS } from '../types';
import type { City, Order, OrderKind, ProductWithDetails, PurchaseOrder } from '../types';
import { getProvinceForCity } from '../utils/provinceMapping';
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
    purchaseOrders,
    distributors,
    stores,
    storeInventory,
    storeProductPrices,
    fetchProducts,
    fetchOrders,
    fetchPurchaseOrders,
    fetchDistributors,
    fetchStores,
    fetchStoreInventory,
    fetchStoreProductPrices,
    createSettlementOrder,
    createBatchOrders,
    deleteOrder,
    acceptOrder,
    confirmPurchaseItemDelivery,
    fetchUndeliveredItems,
    deletePurchaseOrderV2,
    findProductByBarcode,
    outboundStock,
  } = useAppStore();
  const isDarkMode = useAppStore((state) => state.isDarkMode);
  const theme = isDarkMode ? DarkColors : LightColors;

  const [modalVisible, setModalVisible] = useState(false);
  const [cart, setCart] = useState<Map<string, CartItem>>(new Map());
  const [refreshing, setRefreshing] = useState(false);
  const [selectedOrderCityId, setSelectedOrderCityId] = useState<string | null>(null);
  const [selectedOrderProvinceId, setSelectedOrderProvinceId] = useState<string | null>(null);
  const [deletingOrderId, setDeletingOrderId] = useState<string | null>(null);
  const [confirmingPurchaseOrderId, setConfirmingPurchaseOrderId] = useState<string | null>(null);
  const [showUndeliveredOnly, setShowUndeliveredOnly] = useState(false);
  const [undeliveredItems, setUndeliveredItems] = useState<Array<{
    item_id: string;
    purchase_order_id: string;
    product_name: string;
    ordered_quantity: number;
    store_name: string;
    store_address: string;
    days_since_ordered: number;
  }>>([]);
  const [loadingUndeliveredItems, setLoadingUndeliveredItems] = useState(false);
  const [purchaseConfirmPayload, setPurchaseConfirmPayload] = useState<{
    purchaseOrderId: string;
    itemId: string;
    productName: string;
    orderedQuantity: number;
    deliveredQuantityInput: string;
  } | null>(null);
  const [submittingPurchaseConfirm, setSubmittingPurchaseConfirm] = useState(false);
  const [purchaseDeleteTargetId, setPurchaseDeleteTargetId] = useState<string | null>(null);
  const [deletingPurchaseOrderId, setDeletingPurchaseOrderId] = useState<string | null>(null);
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
  const isAdminOrManager = isAdmin || user?.role === 'inventory_manager' || user?.role === 'finance';
  const canCreateSettlement = user?.role === 'admin' || user?.role === 'super_admin' || user?.role === 'finance';
  const canConfirmPurchase = user?.role === 'admin' || user?.role === 'super_admin';
  const canCreateOrder = user?.role === 'distributor' || user?.role === 'admin' || user?.role === 'super_admin';
  const minSaleQuantity = user?.role === 'distributor' ? 30 : 1;

  const getOrderKindLabel = (kind: Order['order_kind']): string => {
    if (kind === 'retail') return '零售单';
    if (kind === 'settlement') return '结算单';
    if (kind === 'external') return '外部单';
    if (kind === 'purchase') return '进货单';
    return '供货单';
  };

  const getOrderTotalLabel = (kind: Order['order_kind']): string => {
    if (kind === 'retail') return '收款总价';
    if (kind === 'settlement') return '结算总价';
    if (kind === 'external') return '零售总价';
    if (kind === 'purchase') return '进货总价';
    return '折扣总价';
  };

  const getAcceptedOrderStatusLabel = (kind: Order['order_kind']): string => {
    if (kind === 'purchase') return '已到货';
    if (kind === 'external') return '已签收';
    return '已接单';
  };

  const getOrderKindTagColor = (kind: Order['order_kind']): string => {
    if (kind === 'external') return theme.gradientMid;
    return theme.blue;
  };

  const getPaymentMethodLabel = (method?: Order['payment_method']): string => {
    if (method === 'wechat') return '微信';
    if (method === 'alipay') return '支付宝';
    return '-';
  };

  useEffect(() => {
    fetchOrders();
    fetchPurchaseOrders();
    fetchProducts();
    fetchDistributors();
    fetchStores();
  }, [fetchDistributors, fetchOrders, fetchProducts, fetchPurchaseOrders, fetchStores]);

  useEffect(() => {
    if (selectedOrderKind !== 'purchase') {
      setShowUndeliveredOnly(false);
      setUndeliveredItems([]);
      return;
    }

    fetchPurchaseOrders();
  }, [fetchPurchaseOrders, selectedOrderKind]);

  useEffect(() => {
    if (!showUndeliveredOnly || selectedOrderKind !== 'purchase') return;

    const loadUndelivered = async () => {
      setLoadingUndeliveredItems(true);
      const rows = await fetchUndeliveredItems();
      setUndeliveredItems(rows);
      setLoadingUndeliveredItems(false);
    };

    loadUndelivered();
  }, [fetchUndeliveredItems, selectedOrderKind, showUndeliveredOnly]);

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
    await Promise.all([fetchOrders(), fetchPurchaseOrders(), fetchProducts(), fetchDistributors(), fetchStores()]);
    if (showUndeliveredOnly && selectedOrderKind === 'purchase') {
      const rows = await fetchUndeliveredItems();
      setUndeliveredItems(rows);
    }
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
    const keyword = modalSearchText.trim().toLowerCase();
    if (!keyword) return availableProducts;
    return availableProducts.filter((p) => {
      const haystack = [p.name, p.barcode || '', p.city_name || ''].join(' ').toLowerCase();
      return haystack.includes(keyword);
    });
  }, [availableProducts, modalSearchText]);

  useEffect(() => {
    clearCart();
  }, [orderModalStoreId, orderModalDistributorId]);

  const orderFilterCities = useMemo<City[]>(() => {
    const cityMap = new Map<string, { id: string; name: string; province: string | null }>();
    stores
      .filter((store) => store.status === 'active')
      .forEach((store) => {
        if (!cityMap.has(store.city_id)) {
          const cityName = store.city_name || '未知城市';
          cityMap.set(store.city_id, {
            id: store.city_id,
            name: cityName,
            province: getProvinceForCity(cityName),
          });
        }
      });
    return Array.from(cityMap.values()).map((city) => ({
      id: city.id,
      name: city.name,
      province: city.province || undefined,
      created_at: '',
    }));
  }, [stores]);

  const activeStoresForOrderFilter = useMemo(() => {
    const activeStores = stores.filter((store) => store.status === 'active');
    const filteredByProvince = selectedOrderProvinceId
      ? activeStores.filter((store) => {
          const city = orderFilterCities.find((item) => item.id === store.city_id);
          const province = city?.province || getProvinceForCity(city?.name || store.city_name || '');
          return selectedOrderProvinceId === '未知省份' ? !province : province === selectedOrderProvinceId;
        })
      : activeStores;

    if (!selectedOrderCityId) return filteredByProvince;
    return filteredByProvince.filter((store) => store.city_id === selectedOrderCityId);
  }, [orderFilterCities, selectedOrderCityId, selectedOrderProvinceId, stores]);

  useEffect(() => {
    if (!selectedOrderStoreId) return;
    const stillVisible = activeStoresForOrderFilter.some((store) => store.id === selectedOrderStoreId);
    if (!stillVisible) {
      setSelectedOrderStoreId(null);
    }
  }, [activeStoresForOrderFilter, selectedOrderStoreId]);

  const baseOrders = useMemo(() => {
    let list = [...orders];
    if (isAdminOrManager) {
      if (selectedOrderProvinceId) {
        list = list.filter((o) => {
          const city = orderFilterCities.find((item) => item.id === o.city_id);
          const province = city?.province || getProvinceForCity(city?.name || o.city_name || '');
          return selectedOrderProvinceId === '未知省份' ? !province : province === selectedOrderProvinceId;
        });
      }
      if (selectedOrderCityId) {
        list = list.filter((o) => o.city_id === selectedOrderCityId);
      }
      if (selectedOrderStoreId) {
        list = list.filter((o) => o.store_id === selectedOrderStoreId);
      }
    }
    if (selectedOrderKind === 'purchase') {
      return [];
    }
    if (selectedOrderKind) {
      list = list.filter((o) => o.order_kind === selectedOrderKind);
    }
    return list;
  }, [orders, isAdminOrManager, orderFilterCities, selectedOrderCityId, selectedOrderProvinceId, selectedOrderStoreId, selectedOrderKind]);

  const filteredPurchaseOrders = useMemo(() => {
    let list = [...purchaseOrders];
    if (isAdminOrManager) {
      if (selectedOrderProvinceId) {
        list = list.filter((o) => {
          const city = orderFilterCities.find((item) => item.id === o.city_id);
          const province = city?.province || getProvinceForCity(city?.name || o.city_name || '');
          return selectedOrderProvinceId === '未知省份' ? !province : province === selectedOrderProvinceId;
        });
      }
      if (selectedOrderCityId) {
        list = list.filter((o) => o.city_id === selectedOrderCityId);
      }
      if (selectedOrderStoreId) {
        list = list.filter((o) => o.store_id === selectedOrderStoreId);
      }
    }
    return list;
  }, [isAdminOrManager, orderFilterCities, purchaseOrders, selectedOrderCityId, selectedOrderProvinceId, selectedOrderStoreId]);

  const matchesStatsRange = useCallback((createdAt: string): boolean => {
    const date = new Date(createdAt);
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
    return baseOrders.filter((order) => matchesStatsRange(order.created_at));
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

  const rangedPurchaseOrders = useMemo(() => {
    return filteredPurchaseOrders.filter((order) => matchesStatsRange(order.created_at));
  }, [filteredPurchaseOrders, matchesStatsRange]);

  const displayPurchaseOrders = useMemo(() => {
    let list = [...rangedPurchaseOrders];
    if (searchText.trim()) {
      const lowerSearch = searchText.toLowerCase().trim();
      list = list.filter((o) => {
        const shortId = o.id.slice(0, 8).toLowerCase();
        const storeName = (o.store_name || '').toLowerCase();
        return shortId.includes(lowerSearch) || storeName.includes(lowerSearch);
      });
    }
    return list;
  }, [rangedPurchaseOrders, searchText]);

  const monthlyProductStats = useMemo(() => {
    const map = new Map<string, { name: string; quantity: number }>();
    rangedOrders.forEach((order) => {
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
  }, [rangedOrders]);

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
    if (isAdminOrManager && selectedOrderProvinceId) count += 1;
    if (isAdminOrManager && selectedOrderCityId) count += 1;
    if (isAdminOrManager && selectedOrderStoreId) count += 1;
    if (selectedOrderKind) count += 1;
    if (statsRange !== 'all') count += 1;
    return count;
  }, [isAdminOrManager, selectedOrderProvinceId, selectedOrderCityId, selectedOrderStoreId, selectedOrderKind, statsRange]);

  const getCartKey = (productId: string, lineType: 'sale' | 'sample'): string => `${productId}:${lineType}`;
  const getLineStep = (_lineType: 'sale' | 'sample'): number => 1;
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
    if (!isSample && user?.role === 'distributor' && qty < 30) {
      Toast.show({ type: 'error', text1: '错误', text2: '分销订单非样品数量必须大于等于30' });
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

    const invalidItems = cartItems.filter((item) => !item.isSample && item.quantity < minSaleQuantity);
    if (invalidItems.length > 0) {
      const invalidNames = invalidItems.map((item) => `${item.product.name}(${item.quantity})`).join(', ');
      Toast.show({ 
        type: 'error', 
        text1: '下单失败', 
        text2: user?.role === 'distributor'
          ? `以下商品非样品数量小于30: ${invalidNames}`
          : `以下商品数量必须大于0: ${invalidNames}`,
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

  const refreshUndeliveredItems = useCallback(async (): Promise<void> => {
    setLoadingUndeliveredItems(true);
    const rows = await fetchUndeliveredItems();
    setUndeliveredItems(rows);
    setLoadingUndeliveredItems(false);
  }, [fetchUndeliveredItems]);

  const handleConfirmPurchaseItemDelivery = useCallback(async (): Promise<void> => {
    if (!purchaseConfirmPayload) return;

    const deliveredQuantity = Number.parseInt(purchaseConfirmPayload.deliveredQuantityInput || '', 10);
    if (Number.isNaN(deliveredQuantity) || deliveredQuantity <= 0) {
      Toast.show({ type: 'error', text1: '错误', text2: '请输入有效到货数量' });
      return;
    }

    setSubmittingPurchaseConfirm(true);
    setConfirmingPurchaseOrderId(purchaseConfirmPayload.purchaseOrderId);
    const { error } = await confirmPurchaseItemDelivery(
      purchaseConfirmPayload.purchaseOrderId,
      purchaseConfirmPayload.itemId,
      deliveredQuantity,
    );
    setConfirmingPurchaseOrderId(null);
    setSubmittingPurchaseConfirm(false);

    if (error) {
      Toast.show({ type: 'error', text1: '确认到货失败', text2: error.message });
      return;
    }

    setPurchaseConfirmPayload(null);
    await fetchPurchaseOrders();
    if (showUndeliveredOnly) {
      await refreshUndeliveredItems();
    }
    Toast.show({ type: 'success', text1: '成功', text2: '单品到货已确认' });
  }, [confirmPurchaseItemDelivery, fetchPurchaseOrders, purchaseConfirmPayload, refreshUndeliveredItems, showUndeliveredOnly]);

  const handleDeletePurchaseOrder = useCallback(async (): Promise<void> => {
    if (!purchaseDeleteTargetId) return;

    setDeletingPurchaseOrderId(purchaseDeleteTargetId);
    const { error } = await deletePurchaseOrderV2(purchaseDeleteTargetId);
    setDeletingPurchaseOrderId(null);

    if (error) {
      Toast.show({ type: 'error', text1: '删除失败', text2: error.message });
      return;
    }

    setPurchaseDeleteTargetId(null);
    await fetchPurchaseOrders();
    if (showUndeliveredOnly) {
      await refreshUndeliveredItems();
    }
    Toast.show({ type: 'success', text1: '成功', text2: '进货单已删除' });
  }, [deletePurchaseOrderV2, fetchPurchaseOrders, purchaseDeleteTargetId, refreshUndeliveredItems, showUndeliveredOnly]);

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
      await import('../polyfills/globals');
      const excelModule = await import('exceljs');
      const ExcelJS = 'default' in excelModule ? excelModule.default : excelModule;
      const { Buffer } = await import('buffer');
      const workbook = new ExcelJS.Workbook();
      const centered = { horizontal: 'center' as const, vertical: 'middle' as const };

      const sanitizeSheetName = (name: string): string => {
        const base = name.replace(/[\\/?*\[\]:]/g, '-').trim() || '未命名店铺';
        return base.slice(0, 31);
      };

      const saveWorkbook = async (filename: string): Promise<void> => {
        const workbookBuffer = await workbook.xlsx.writeBuffer({ useStyles: true });

        if (Platform.OS === 'web') {
          const blob = new Blob([workbookBuffer], {
            type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          });
          const url = URL.createObjectURL(blob);
          const link = document.createElement('a');
          link.href = url;
          link.download = filename;
          document.body.appendChild(link);
          link.click();
          document.body.removeChild(link);
          URL.revokeObjectURL(url);
          return;
        }

        const FileSystem = await import('expo-file-system/legacy');
        const Sharing = await import('expo-sharing');
        const base64 = Buffer.from(workbookBuffer).toString('base64');
        const uri = `${FileSystem.cacheDirectory}${filename}`;
        await FileSystem.writeAsStringAsync(uri, base64, { encoding: FileSystem.EncodingType.Base64 });
        await Sharing.shareAsync(uri, {
          mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        });
      };

      if (order.order_kind === 'purchase') {
        const sourceOrders = filteredOrders.filter((item) => item.order_kind === 'purchase');
        const purchaseOrders = sourceOrders.length > 0 ? sourceOrders : [order];
        const grouped = new Map<string, { storeName: string; rows: Array<{ productName: string; quantity: number; unitCost: number }> }>();

        purchaseOrders.forEach((purchaseOrder) => {
          const storeName = purchaseOrder.store_name || '未指定店铺';
          const key = storeName;
          const target = grouped.get(key) || { storeName, rows: [] };
          purchaseOrder.items.forEach((item) => {
            target.rows.push({
              productName: item.product_name || '未知商品',
              quantity: Number(item.quantity || 0),
              unitCost: Number(item.unit_cost || 0),
            });
          });
          grouped.set(key, target);
        });

        const usedSheetNames = new Set<string>();
        Array.from(grouped.values()).forEach((group) => {
          let sheetName = sanitizeSheetName(group.storeName);
          if (usedSheetNames.has(sheetName)) {
            let index = 2;
            while (usedSheetNames.has(`${sheetName.slice(0, 28)}-${index}`)) {
              index += 1;
            }
            sheetName = `${sheetName.slice(0, 28)}-${index}`;
          }
          usedSheetNames.add(sheetName);

          const worksheet = workbook.addWorksheet(sheetName);
          worksheet.columns = [
            { width: 8 },
            { width: 26 },
            { width: 12 },
            { width: 12 },
          ];
          worksheet.addRow(['序号', '商品名称', '数量', '成本价']);

          group.rows.forEach((row, index) => {
            worksheet.addRow([
              index + 1,
              row.productName,
              row.quantity,
              Number(row.unitCost.toFixed(2)),
            ]);
          });

          worksheet.eachRow((row) => {
            row.eachCell((cell) => {
              cell.alignment = centered;
            });
          });
        });

        await saveWorkbook(`purchase-orders-${Date.now()}.xlsx`);
        return;
      }

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

        const worksheet = workbook.addWorksheet('上货单');
        worksheet.columns = [
          { width: 8 },
          { width: 24 },
          { width: 12 },
          { width: 12 },
          { width: 12 },
          { width: 14 },
          { width: 14 },
        ];
        worksheet.addRow(headers);
        dataRows.forEach((row) => {
          worksheet.addRow(row);
        });
        worksheet.addRow(sumRow);
        worksheet.eachRow((row) => {
          row.eachCell((cell) => {
            cell.alignment = centered;
          });
        });

        await saveWorkbook(`${exportBaseName}.xlsx`);
        return;
      }

      const headers = ['商品名称', '送货数量', '单价', '查收'];
      const dataRows = order.items.map((item) => [
        item.product_name,
        item.quantity,
        item.discount_price,
        '',
      ]);

      const columnWidths = headers.map((header, colIdx) => {
        let maxLen = header.length * 2;
        dataRows.forEach((row) => {
          const len = String(row[colIdx]).length;
          if (len > maxLen) maxLen = len;
        });
        return Math.max(maxLen + 2, 12);
      });

      const worksheet = workbook.addWorksheet('送货单');
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

      await saveWorkbook(`delivery-${order.id.slice(0, 8)}-${Date.now()}.xlsx`);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Excel 导出失败';
      Toast.show({ type: 'error', text1: '导出失败', text2: message });
    }
  };

  const purchaseTotals = useMemo(() => {
    return displayPurchaseOrders.reduce((acc, order) => {
      order.items?.forEach((item) => {
        const orderedQty = Number(item.ordered_quantity || 0);
        const unitCost = Number(item.unit_cost || 0);
        const lineTotal = orderedQty * unitCost;
        acc.total += lineTotal;
      });
      return acc;
    }, { total: 0 });
  }, [displayPurchaseOrders]);

  const summaryOrders = filteredOrders.filter((order) => order.order_kind !== 'purchase');
  const totalRetail = selectedOrderKind === 'purchase'
    ? purchaseTotals.total
    : summaryOrders.reduce((sum, o) => sum + Number(o.total_retail_amount || 0), 0);
  const totalDiscount = selectedOrderKind === 'purchase'
    ? purchaseTotals.total
    : summaryOrders.reduce((sum, o) => sum + Number(o.total_discount_amount || 0), 0);
  const summaryRetailLabel = selectedOrderKind === 'purchase' ? '进货成本' : '零售总价';
  const summaryDiscountLabel = selectedOrderKind === 'purchase' ? '进货总价' : '折扣总价';

  const renderOrder = ({ item }: { item: Order }) => (
    <View style={[styles.orderCard, { backgroundColor: theme.surface }] }>
      <View style={styles.orderHeader}>
        <View>
          <Text style={[styles.orderId, { color: theme.textPrimary }]}>订单 #{item.id.slice(0, 8)}</Text>
          <Text style={[styles.orderKindTag, { color: getOrderKindTagColor(item.order_kind) }]}>{getOrderKindLabel(item.order_kind)}</Text>
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
        {isAdmin && item.status === 'pending' && item.order_kind !== 'purchase' && item.order_kind !== 'external' && (
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
            <Text style={styles.acceptedTagText}>{getAcceptedOrderStatusLabel(item.order_kind)}</Text>
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

  const renderPurchaseOrder = ({ item }: { item: PurchaseOrder }) => {
    const pendingItems = (item.items || []).filter((purchaseItem) => purchaseItem.delivery_status !== 'delivered');

    return (
      <View style={[styles.orderCard, { backgroundColor: theme.surface }] }>
        <View style={styles.orderHeader}>
          <View>
            <Text style={[styles.orderId, { color: theme.textPrimary }]}>进货单 #{item.id.slice(0, 8)}</Text>
            <Text style={[styles.orderKindTag, { color: theme.blue }]}>{item.status === 'delivered' ? '已到货' : item.status === 'partially_delivered' ? '部分到货' : '待到货'}</Text>
          </View>
          <Text style={[styles.orderDate, { color: theme.textTertiary }]}>{new Date(item.created_at).toLocaleDateString('zh-CN')}</Text>
        </View>

        <View style={styles.orderMetaContainer}>
          <PackageCheck size={14} color={theme.textTertiary} style={{ marginRight: 4 }} />
          <Text style={[styles.orderMeta, { color: theme.textSecondary }]}>配送店铺: {item.store_name || '未指定'}</Text>
        </View>
        <View style={styles.orderMetaContainer}>
          <PackageCheck size={14} color={theme.textTertiary} style={{ marginRight: 4 }} />
          <Text style={[styles.orderMeta, { color: theme.textSecondary }]}>供应商: {item.supplier_name || '未绑定'}</Text>
        </View>

        <View style={styles.orderItemsSummary}>
          <Text style={[styles.orderItemsSummaryText, { color: theme.textSecondary }]}>
            共 {(item.items || []).length} 种商品，待到货 {pendingItems.length} 项
          </Text>
        </View>

        {(item.items || []).map((purchaseItem) => (
          <View key={purchaseItem.id} style={[styles.detailItemRow, { borderBottomColor: theme.divider }]}> 
            <Text style={[styles.detailItemName, { color: theme.textPrimary }]} numberOfLines={1}>
              {purchaseItem.product_name || '未知商品'}
            </Text>
            <Text style={[styles.detailItemQty, { color: theme.textSecondary }]}>
              {purchaseItem.delivered_quantity}/{purchaseItem.ordered_quantity}
            </Text>
            {canConfirmPurchase && purchaseItem.delivery_status !== 'delivered' ? (
              <TouchableOpacity
                style={styles.exportButton}
                onPress={() => {
                  setPurchaseConfirmPayload({
                    purchaseOrderId: item.id,
                    itemId: purchaseItem.id,
                    productName: purchaseItem.product_name || '未知商品',
                    orderedQuantity: Number(purchaseItem.ordered_quantity || 0),
                    deliveredQuantityInput: String(Number(purchaseItem.ordered_quantity || 0)),
                  });
                }}
              >
                <Text style={styles.exportButtonText}>确认到货</Text>
              </TouchableOpacity>
            ) : (
              <Text style={styles.detailItemPrice}>{purchaseItem.delivery_status === 'delivered' ? '已到货' : '待到货'}</Text>
            )}
          </View>
        ))}

        <View style={styles.orderActions}>
          {(isAdmin || user?.role === 'super_admin') && (
            <TouchableOpacity
              style={[styles.deleteOrderButton, deletingPurchaseOrderId === item.id && styles.deleteOrderButtonDisabled]}
              onPress={() => setPurchaseDeleteTargetId(item.id)}
              disabled={deletingPurchaseOrderId === item.id}
            >
              <Text style={styles.deleteOrderButtonText}>删除进货单</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>
    );
  };

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
                <Text style={styles.qtyBtnAddText}>+1</Text>
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
          {canCreateSettlement && (
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
                <Text style={styles.addButtonText}>结算</Text>
              </LinearGradient>
            </TouchableOpacity>
          )}
          {canCreateOrder && (
            <TouchableOpacity
              onPress={() => {
                setModalSearchText('');
                setModalVisible(true);
              }}
              activeOpacity={0.85}
              style={styles.outboundButtonWrap}
            >
              <LinearGradient colors={['#FF6B9D', '#5B8DEF']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={styles.addButton}>
                <Text style={styles.addButtonText}>上货</Text>
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
            >
              <LinearGradient colors={['#FF6B9D', '#5B8DEF']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={styles.addButton}>
                <Text style={styles.addButtonText}>出库</Text>
              </LinearGradient>
            </TouchableOpacity>
          )}
        </View>
      </View>

      <View style={[styles.summary, { backgroundColor: theme.surface }]}> 
        <View style={styles.summaryItem}>
          <Text style={styles.summaryValue}>{selectedOrderKind === 'purchase' ? displayPurchaseOrders.length : filteredOrders.length}</Text>
          <Text style={[styles.summaryLabel, { color: theme.textSecondary }]}>订单数</Text>
        </View>
        <View style={styles.summaryItem}>
          <Text style={styles.summaryValue}>{totalRetail.toFixed(2)}元</Text>
          <Text style={[styles.summaryLabel, { color: theme.textSecondary }]}>{summaryRetailLabel}</Text>
        </View>
        <View style={styles.summaryItem}>
          <Text style={styles.summaryValue}>{totalDiscount.toFixed(2)}元</Text>
          <Text style={[styles.summaryLabel, { color: theme.textSecondary }]}>{summaryDiscountLabel}</Text>
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
                <Text style={[styles.statsSubTitle, { color: theme.textSecondary }]}>{rangeLabel}</Text>
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

      {((isAdminOrManager && (selectedOrderProvinceId || selectedOrderCityId || selectedOrderStoreId)) || selectedOrderKind || statsRange !== 'all') && (
        <View style={styles.activeFiltersWrap}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.activeFiltersContent}>
            {isAdminOrManager && selectedOrderProvinceId && (
              <TouchableOpacity
                style={[styles.activeFilterChip, { backgroundColor: theme.surfaceSecondary }]}
                onPress={() => setSelectedOrderProvinceId(null)}
              >
                <Text style={[styles.activeFilterChipText, { color: theme.textSecondary }]}>省份: {selectedOrderProvinceId} ×</Text>
              </TouchableOpacity>
            )}
            {isAdminOrManager && selectedOrderCityId && (
              <TouchableOpacity
                style={[styles.activeFilterChip, { backgroundColor: theme.surfaceSecondary }]}
                onPress={() => setSelectedOrderCityId(null)}
              >
                <Text style={[styles.activeFilterChipText, { color: theme.textSecondary }]}>城市: {orderFilterCities.find((c) => c.id === selectedOrderCityId)?.name || '已选'} ×</Text>
              </TouchableOpacity>
            )}
            {isAdminOrManager && selectedOrderStoreId && (
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
                if (isAdminOrManager) {
                  setSelectedOrderProvinceId(null);
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

      {selectedOrderKind === 'purchase' ? (
        <>
          <View style={[styles.activeFiltersWrap, { marginTop: -6 }]}> 
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.activeFiltersContent}>
              <TouchableOpacity
                style={[styles.activeFilterChip, { backgroundColor: showUndeliveredOnly ? Colors.warningBg : theme.surfaceSecondary }]}
                onPress={() => setShowUndeliveredOnly((prev) => !prev)}
              >
                <Text style={[styles.activeFilterChipText, { color: showUndeliveredOnly ? Colors.warning : theme.textSecondary }]}> 
                  {showUndeliveredOnly ? '返回全部进货单' : '筛选未到货'}
                </Text>
              </TouchableOpacity>
              {showUndeliveredOnly && (
                <TouchableOpacity
                  style={[styles.activeFilterChip, { backgroundColor: theme.surfaceSecondary }]}
                  onPress={() => {
                    refreshUndeliveredItems();
                  }}
                >
                  <Text style={[styles.activeFilterChipText, { color: theme.textSecondary }]}>刷新未到货列表</Text>
                </TouchableOpacity>
              )}
            </ScrollView>
          </View>

          {showUndeliveredOnly ? (
            <FlatList
              data={undeliveredItems}
              keyExtractor={(item) => `${item.purchase_order_id}-${item.item_id}`}
              contentContainerStyle={styles.list}
              refreshControl={<RefreshControl refreshing={refreshing || loadingUndeliveredItems} onRefresh={onRefresh} tintColor={Colors.pink} />}
              renderItem={({ item }) => (
                <View style={[styles.orderCard, { backgroundColor: theme.surface }] }>
                  <Text style={[styles.orderId, { color: theme.textPrimary }]}>{item.product_name}</Text>
                  <Text style={[styles.orderMeta, { color: theme.textSecondary, marginTop: 6 }]}>下单数量：{item.ordered_quantity}</Text>
                  <Text style={[styles.orderMeta, { color: theme.textSecondary }]}>配送店铺：{item.store_name || '未指定'}</Text>
                  <Text style={[styles.orderMeta, { color: theme.textSecondary }]}>到货地址：{item.store_address || '-'}</Text>
                  <Text style={[styles.orderMeta, { color: theme.textSecondary }]}>已下单 {item.days_since_ordered} 天</Text>
                </View>
              )}
              ListEmptyComponent={
                <View style={styles.emptyContainer}>
                  <ClipboardList size={48} color={theme.textTertiary} strokeWidth={1.5} />
                  <Text style={[styles.emptyText, { color: theme.textTertiary }]}>暂无未到货商品</Text>
                </View>
              }
            />
          ) : (
            <FlatList
              data={displayPurchaseOrders}
              keyExtractor={(item) => item.id}
              renderItem={renderPurchaseOrder}
              contentContainerStyle={styles.list}
              refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.pink} />}
              ListEmptyComponent={
                <View style={styles.emptyContainer}>
                  <ClipboardList size={48} color={theme.textTertiary} strokeWidth={1.5} />
                  <Text style={[styles.emptyText, { color: theme.textTertiary }]}>暂无进货单记录</Text>
                </View>
              }
            />
          )}
        </>
      ) : (
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
      )}

      <Modal visible={purchaseConfirmPayload !== null} animationType="fade" transparent>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, { backgroundColor: theme.surface, maxHeight: 360 }] }>
            <View style={styles.modalHeader}>
              <Text style={[styles.modalTitle, { color: theme.textPrimary }]}>确认单品到货</Text>
              <TouchableOpacity onPress={() => setPurchaseConfirmPayload(null)}>
                <Text style={styles.modalClose}>取消</Text>
              </TouchableOpacity>
            </View>

            <Text style={[styles.orderMeta, { color: theme.textSecondary, marginBottom: 8 }]}>商品：{purchaseConfirmPayload?.productName}</Text>
            <Text style={[styles.orderMeta, { color: theme.textSecondary, marginBottom: 12 }]}>下单数量：{purchaseConfirmPayload?.orderedQuantity}</Text>
            <TextInput
              style={[styles.modalInput, { backgroundColor: theme.surfaceSecondary, color: theme.textPrimary }]}
              value={purchaseConfirmPayload?.deliveredQuantityInput || ''}
              onChangeText={(text) => {
                setPurchaseConfirmPayload((prev) => {
                  if (!prev) return prev;
                  return { ...prev, deliveredQuantityInput: text.replace(/[^0-9]/g, '') };
                });
              }}
              keyboardType="number-pad"
              placeholder="请输入到货数量"
              placeholderTextColor={theme.textTertiary}
            />

            <View style={[styles.modalButtons, { marginTop: 16 }]}> 
              <TouchableOpacity
                style={[styles.confirmButtonWrap, submittingPurchaseConfirm && styles.disabledButton]}
                onPress={() => {
                  handleConfirmPurchaseItemDelivery();
                }}
                disabled={submittingPurchaseConfirm}
                activeOpacity={0.85}
              >
                <LinearGradient colors={['#FF6B9D', '#5B8DEF']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={styles.confirmButton}>
                  <Text style={styles.confirmButtonText}>{submittingPurchaseConfirm ? '提交中...' : '确认到货'}</Text>
                </LinearGradient>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      <Modal visible={purchaseDeleteTargetId !== null} animationType="fade" transparent>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, { backgroundColor: theme.surface, maxHeight: 300 }] }>
            <View style={styles.modalHeader}>
              <Text style={[styles.modalTitle, { color: theme.textPrimary }]}>确认删除进货单</Text>
              <TouchableOpacity onPress={() => setPurchaseDeleteTargetId(null)}>
                <Text style={styles.modalClose}>取消</Text>
              </TouchableOpacity>
            </View>
            <Text style={[styles.orderMeta, { color: theme.textSecondary, marginBottom: 16 }]}>确定删除进货单 #{purchaseDeleteTargetId?.slice(0, 8)} 吗？</Text>
            <View style={styles.modalButtons}>
              <TouchableOpacity
                style={[styles.confirmButtonWrap, deletingPurchaseOrderId === purchaseDeleteTargetId && styles.disabledButton]}
                onPress={() => {
                  handleDeletePurchaseOrder();
                }}
                disabled={deletingPurchaseOrderId === purchaseDeleteTargetId}
                activeOpacity={0.85}
              >
                <LinearGradient colors={['#FF6B9D', '#5B8DEF']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={styles.confirmButton}>
                  <Text style={styles.confirmButtonText}>{deletingPurchaseOrderId === purchaseDeleteTargetId ? '删除中...' : '确认删除'}</Text>
                </LinearGradient>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      <Modal visible={filterModalVisible} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, { backgroundColor: theme.surface }] }>
            <View style={styles.modalHeader}>
              <Text style={[styles.modalTitle, { color: theme.textPrimary }]}>筛选条件</Text>
              <TouchableOpacity onPress={() => setFilterModalVisible(false)}>
                <Text style={styles.modalClose}>完成</Text>
              </TouchableOpacity>
            </View>

            {isAdminOrManager && (
              <View style={[styles.filterPanelContainer, { backgroundColor: theme.surface }]}> 
                <ProvinceCityFilter
                  cities={orderFilterCities}
                  selectedProvinceId={selectedOrderProvinceId}
                  selectedCityId={selectedOrderCityId}
                  onProvinceChange={setSelectedOrderProvinceId}
                  onCityChange={setSelectedOrderCityId}
                  showProvince={user?.role !== 'distributor'}
                />
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
                    { key: 'external', label: '外部单' },
                    { key: 'purchase', label: '进货单' },
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
                  if (isAdminOrManager) {
                    setSelectedOrderProvinceId(null);
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
          <KeyboardAvoidingView
            behavior={Platform.OS === 'ios' ? 'padding' : undefined}
            style={styles.modalKeyboardWrap}
          >
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
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.selectorScroll} keyboardShouldPersistTaps="handled">
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
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.selectorScroll} keyboardShouldPersistTaps="handled">
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

            <View style={[styles.searchContainer, { backgroundColor: theme.surfaceSecondary, marginBottom: 10 }] }>
              <Search size={18} color={theme.textTertiary} style={styles.searchIcon} />
              <TextInput
                style={[styles.searchInput, styles.modalSearchInput, { color: theme.textPrimary }]}
                placeholder="搜索商品名称..."
                placeholderTextColor={theme.textTertiary}
                value={modalSearchText}
                onChangeText={setModalSearchText}
                showSoftInputOnFocus
                returnKeyType="search"
                blurOnSubmit={false}
                textAlignVertical="center"
              />
            </View>

            <FlatList
              data={filteredAvailableProducts}
              keyExtractor={(item) => item.id}
              renderItem={renderProductRow}
              style={styles.productList}
              keyboardShouldPersistTaps="handled"
              removeClippedSubviews={false}
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
          </KeyboardAvoidingView>
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

                {detailOrder.order_kind === 'external' && (
                  <>
                    <View style={styles.detailSection}>
                      <Text style={[styles.detailLabel, { color: theme.textSecondary }]}>外部渠道</Text>
                      <Text style={[styles.detailValue, { color: theme.textPrimary }]}>
                        {detailOrder.external_channel ? EXTERNAL_CHANNEL_LABELS[detailOrder.external_channel] : '-'}
                      </Text>
                    </View>
                    <View style={styles.detailSection}>
                      <Text style={[styles.detailLabel, { color: theme.textSecondary }]}>外部单号</Text>
                      <Text style={[styles.detailValue, { color: theme.textPrimary }]}>{detailOrder.external_order_no || '-'}</Text>
                    </View>
                  </>
                )}

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
  modalSearchInput: { minWidth: 120 },
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
  pendingTag: {
    backgroundColor: Colors.warningBg,
    borderRadius: Radius.md,
    paddingHorizontal: 10,
    paddingVertical: 4,
    marginRight: 8,
  },
  pendingTagText: { color: Colors.warning, fontSize: 11, fontWeight: '600' },
  emptyContainer: { alignItems: 'center', paddingTop: 60 },
  emptyContainerModal: { alignItems: 'center', paddingTop: 40 },
  emptyText: { textAlign: 'center', color: Colors.textTertiary, marginTop: 12, fontSize: 14 },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(45,45,63,0.4)', justifyContent: 'flex-end' },
  modalKeyboardWrap: { width: '100%', flex: 1, justifyContent: 'flex-end' },
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
