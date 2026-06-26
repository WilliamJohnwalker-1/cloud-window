import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  Alert,
  RefreshControl,
  ScrollView,
  Modal,
  TextInput,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Minus, Plus, ChevronsDown, ChevronsUp, Search, Pencil, PackageOpen, ShoppingBag } from 'lucide-react-native';
import Toast from 'react-native-toast-message';
import { useShallow } from 'zustand/react/shallow';

import { useAppStore } from '../store/useAppStore';
import { Colors, Shadow, Radius, LightColors, DarkColors } from '../theme';
import ProvinceCityFilter from '../components/ProvinceCityFilter';
import { getProvinceForCity } from '../utils/provinceMapping';
import type { ProductWithDetails, StoreInventory } from '../types';

export default function InventoryScreen() {
  const {
    products,
    cities,
    stores,
    storeInventory,
    fetchProducts,
    fetchCities,
    fetchStores,
    fetchStoreInventory,
    updateInventory,
    updateStoreInventory,
    updateInventorySettings,
    findProductByBarcode,
    inboundStock,
    createPurchaseOrder,
    user,
  } = useAppStore(
    useShallow((state) => ({
      products: state.products,
      cities: state.cities,
      stores: state.stores,
      storeInventory: state.storeInventory,
      fetchProducts: state.fetchProducts,
      fetchCities: state.fetchCities,
      fetchStores: state.fetchStores,
      fetchStoreInventory: state.fetchStoreInventory,
      updateInventory: state.updateInventory,
      updateStoreInventory: state.updateStoreInventory,
      updateInventorySettings: state.updateInventorySettings,
      findProductByBarcode: state.findProductByBarcode,
      inboundStock: state.inboundStock,
      createPurchaseOrder: state.createPurchaseOrder,
      user: state.user,
    })),
  );
  const [refreshing, setRefreshing] = useState(false);
  const [filter, setFilter] = useState<'all' | 'low' | 'normal'>('all');
  const [filterProvinceId, setFilterProvinceId] = useState<string | null>(null);
  const [filterCityId, setFilterCityId] = useState<string | null>(null);
  const [editModalVisible, setEditModalVisible] = useState(false);
  const [editingProduct, setEditingProduct] = useState<ProductWithDetails | null>(null);
  const [editQuantity, setEditQuantity] = useState('0');
  const [editMinQuantity, setEditMinQuantity] = useState('10');
  const [savingEdit, setSavingEdit] = useState(false);
  const [inboundModalVisible, setInboundModalVisible] = useState(false);
  const [inboundBarcode, setInboundBarcode] = useState('');
  const [inboundQuantity, setInboundQuantity] = useState('');
  const [inboundProduct, setInboundProduct] = useState<ProductWithDetails | null>(null);
  const [submittingInbound, setSubmittingInbound] = useState(false);
  const [purchaseModalVisible, setPurchaseModalVisible] = useState(false);
  const [purchaseStoreId, setPurchaseStoreId] = useState<string | null>(null);
  const [purchaseCart, setPurchaseCart] = useState<Map<string, number>>(new Map());
  const [submittingPurchase, setSubmittingPurchase] = useState(false);
  const [searchText, setSearchText] = useState('');
  const [viewMode, setViewMode] = useState<'main' | 'store'>('main');
  const [selectedStoreProvinceId, setSelectedStoreProvinceId] = useState<string | null>(null);
  const [selectedStoreCityId, setSelectedStoreCityId] = useState<string | null>(null);
  const [selectedStoreId, setSelectedStoreId] = useState<string | null>(null);
  const [storeEditModalVisible, setStoreEditModalVisible] = useState(false);
  const [editingStoreInventoryItem, setEditingStoreInventoryItem] = useState<StoreInventory | null>(null);
  const [editStoreQuantity, setEditStoreQuantity] = useState('0');
  const [savingStoreEdit, setSavingStoreEdit] = useState(false);
  const isDarkMode = useAppStore((state) => state.isDarkMode);
  const theme = isDarkMode ? DarkColors : LightColors;

  const isSuperAdmin = user?.role === 'super_admin';
  const isAdminOrManager = user?.role === 'admin' || user?.role === 'super_admin' || user?.role === 'inventory_manager';
  const canCreatePurchase = user?.role === 'admin' || user?.role === 'super_admin';

  useEffect(() => {
    fetchProducts();
    fetchCities();
    if (isAdminOrManager) {
      fetchStores();
    }
  }, [fetchProducts, fetchCities, fetchStores, isAdminOrManager]);

  useEffect(() => {
    if (viewMode === 'store' && selectedStoreId) {
      fetchStoreInventory(selectedStoreId);
    }
  }, [viewMode, selectedStoreId, fetchStoreInventory]);

  useEffect(() => {
    if (!purchaseModalVisible) return;
    const activeStores = stores.filter((store) => store.status === 'active');
    if (!purchaseStoreId || !activeStores.some((store) => store.id === purchaseStoreId)) {
      setPurchaseStoreId(activeStores[0]?.id ?? null);
    }
  }, [purchaseModalVisible, purchaseStoreId, stores]);

  const storeFilterCities = cities.filter((city) => stores.some((store) => store.city_id === city.id));
  const storeCityProvinceMap = new Map(
    storeFilterCities.map((city) => [city.id, city.province || getProvinceForCity(city.name) || null]),
  );
  const activeStoresForStoreFilter = stores.filter((store) => {
    if (selectedStoreProvinceId) {
      const province = storeCityProvinceMap.get(store.city_id) || getProvinceForCity(store.city_name || '');
      if (selectedStoreProvinceId === '未知省份' ? !!province : province !== selectedStoreProvinceId) {
        return false;
      }
    }
    if (selectedStoreCityId) {
      return store.city_id === selectedStoreCityId;
    }
    return true;
  });

  useEffect(() => {
    if (viewMode !== 'store') return;
    if (activeStoresForStoreFilter.length === 0) {
      setSelectedStoreId(null);
      return;
    }
    if (!selectedStoreId || !activeStoresForStoreFilter.some((store) => store.id === selectedStoreId)) {
      setSelectedStoreId(activeStoresForStoreFilter[0].id);
    }
  }, [viewMode, selectedStoreId, activeStoresForStoreFilter]);

  const onRefresh = async () => {
    setRefreshing(true);
    if (viewMode === 'main') {
      await fetchProducts();
    } else if (viewMode === 'store' && selectedStoreId) {
      await fetchStoreInventory(selectedStoreId);
    }
    setRefreshing(false);
  };

  const cityFilteredProducts = products.filter((product) => {
    const city = cities.find((cityItem) => cityItem.id === product.city_id);
    const province = city?.province || (city ? getProvinceForCity(city.name) : null);
    const matchesProvince = filterProvinceId
      ? (filterProvinceId === '未知省份' ? !province : province === filterProvinceId)
      : true;
    const matchesCity = filterCityId ? product.city_id === filterCityId : true;
    return matchesProvince && matchesCity;
  });

  const lowStockProducts = cityFilteredProducts.filter(
    (p) => p.quantity !== undefined && p.quantity < (p.min_quantity ?? 10)
  );

  const filteredProducts = cityFilteredProducts.filter((p) => {
    const matchesSearch = !searchText.trim() || p.name.toLowerCase().includes(searchText.toLowerCase());
    if (!matchesSearch) return false;
    if (filter === 'low') return p.quantity !== undefined && p.quantity < (p.min_quantity ?? 10);
    if (filter === 'normal') return p.quantity === undefined || p.quantity >= (p.min_quantity ?? 10);
    return true;
  });

  const filteredStoreInventory = storeInventory.filter((item) => {
    if (!searchText.trim()) return true;
    return item.product_name?.toLowerCase().includes(searchText.toLowerCase());
  });

  const activePurchaseStores = stores.filter((store) => store.status === 'active');
  const selectedPurchaseStore = activePurchaseStores.find((store) => store.id === purchaseStoreId) || null;
  const purchaseProducts = selectedPurchaseStore
    ? products.filter((product) => product.city_id === selectedPurchaseStore.city_id)
    : [];
  const purchaseCartEntries = Array.from(purchaseCart.entries()).filter(([, qty]) => qty > 0);
  const purchaseTotalQuantity = purchaseCartEntries.reduce((sum, [, qty]) => sum + qty, 0);
  const purchaseStoreCount = new Set(purchaseCartEntries.map(([key]) => key.split(':')[0])).size;

  const getPurchaseCartKey = (storeId: string, productId: string): string => `${storeId}:${productId}`;

  const updatePurchaseQuantity = (storeId: string, productId: string, quantity: number) => {
    setPurchaseCart((prev) => {
      const next = new Map(prev);
      const key = getPurchaseCartKey(storeId, productId);
      if (!Number.isFinite(quantity) || quantity <= 0) {
        next.delete(key);
      } else {
        next.set(key, Math.floor(quantity));
      }
      return next;
    });
  };

  const handleUpdateStock = (product: ProductWithDetails, adjustment: number) => {
    const newQuantity = (product.quantity || 0) + adjustment;
    if (newQuantity < 0) {
      Toast.show({ type: 'error', text1: '错误', text2: '库存不能为负数' });
      return;
    }

    Alert.alert(
      '确认调整',
      `将 ${product.name} 库存从 ${product.quantity || 0} 调整为 ${newQuantity}？`,
      [
        { text: '取消', style: 'cancel' },
        {
          text: '确认',
          onPress: async () => {
            const { error } = await updateInventory(product.id, newQuantity);
            if (error) Toast.show({ type: 'error', text1: '错误', text2: error.message });
          },
        },
      ]
    );
  };

  const openEditInventoryModal = (product: ProductWithDetails) => {
    if (!isAdminOrManager) return;
    setEditingProduct(product);
    setEditQuantity((product.quantity ?? 0).toString());
    setEditMinQuantity((product.min_quantity ?? 10).toString());
    setEditModalVisible(true);
  };

  const handleSaveInventorySettings = async () => {
    if (!editingProduct) return;

    const quantity = parseInt(editQuantity, 10);
    const minQuantity = parseInt(editMinQuantity, 10);

    if (isNaN(quantity) || quantity < 0 || isNaN(minQuantity) || minQuantity < 0) {
      Toast.show({ type: 'error', text1: '错误', text2: '请输入有效的非负整数' });
      return;
    }

    setSavingEdit(true);
    const { error } = await updateInventorySettings(editingProduct.id, quantity, minQuantity);
    setSavingEdit(false);

    if (error) {
      Toast.show({ type: 'error', text1: '保存失败', text2: error.message });
      return;
    }

    setEditModalVisible(false);
    setEditingProduct(null);
  };

  const handleInboundBarcodeLookup = (rawCode?: string) => {
    const normalized = (rawCode ?? inboundBarcode).replace(/\D/g, '').slice(0, 13);
    setInboundBarcode(normalized);
    if (normalized.length !== 13) {
      setInboundProduct(null);
      return;
    }
    const matched = findProductByBarcode(normalized);
    setInboundProduct(matched || null);
  };

  const resetInboundForm = () => {
    setInboundBarcode('');
    setInboundQuantity('');
    setInboundProduct(null);
  };

  const handleConfirmInbound = async () => {
    const qty = Number.parseInt(inboundQuantity, 10);
    if (inboundBarcode.length !== 13) {
      Toast.show({ type: 'error', text1: '错误', text2: '请输入13位条码' });
      return;
    }
    if (!inboundProduct) {
      Toast.show({ type: 'error', text1: '错误', text2: '未找到对应商品' });
      return;
    }
    if (Number.isNaN(qty) || qty <= 0) {
      Toast.show({ type: 'error', text1: '错误', text2: '请输入有效入库数量' });
      return;
    }

    setSubmittingInbound(true);
    const { error } = await inboundStock(inboundBarcode, qty);
    setSubmittingInbound(false);

    if (error) {
      Toast.show({ type: 'error', text1: '入库失败', text2: error.message });
      return;
    }

    Toast.show({ type: 'success', text1: '成功', text2: `${inboundProduct.name} 入库 ${qty} 件成功` });
    setInboundModalVisible(false);
    resetInboundForm();
  };

  const resetPurchaseForm = () => {
    setPurchaseCart(new Map());
    setPurchaseStoreId(null);
  };

  const handleConfirmPurchase = async () => {
    if (!canCreatePurchase) return;
    if (purchaseCartEntries.length === 0) {
      Toast.show({ type: 'error', text1: '错误', text2: '请至少选择一个进货商品' });
      return;
    }

    const groupMap = new Map<string, { store_id: string; city_id: string; products: Array<{ product_id: string; quantity: number }> }>();
    purchaseCartEntries.forEach(([key, quantity]) => {
      const [storeId, productId] = key.split(':');
      const store = activePurchaseStores.find((item) => item.id === storeId);
      if (!store || !productId) return;
      const group = groupMap.get(storeId) || { store_id: storeId, city_id: store.city_id, products: [] };
      group.products.push({ product_id: productId, quantity });
      groupMap.set(storeId, group);
    });

    const groupedItems = Array.from(groupMap.values());
    if (groupedItems.length === 0) {
      Toast.show({ type: 'error', text1: '错误', text2: '进货店铺无效，请重新选择' });
      return;
    }

    setSubmittingPurchase(true);
    const { error } = await createPurchaseOrder(groupedItems);
    setSubmittingPurchase(false);

    if (error) {
      Toast.show({ type: 'error', text1: '进货建单失败', text2: error.message });
      return;
    }

    Toast.show({ type: 'success', text1: '成功', text2: '进货单已创建，待到货确认' });
    setPurchaseModalVisible(false);
    resetPurchaseForm();
  };

  const renderFilterButton = (filterKey: 'all' | 'low' | 'normal', label: string) => {
    const isActive = filter === filterKey;
    return (
      <TouchableOpacity
        style={[styles.filterButton, isActive && styles.filterActive]}
        onPress={() => setFilter(filterKey)}
      >
        {isActive ? (
          <LinearGradient colors={['#FF6B9D', '#5B8DEF']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={styles.filterGradient}>
            <Text style={styles.filterTextActive}>{label}</Text>
          </LinearGradient>
        ) : (
          <Text style={styles.filterText}>{label}</Text>
        )}
      </TouchableOpacity>
    );
  };

  const renderItem = ({ item }: { item: ProductWithDetails }) => {
    const isLowStock = item.quantity !== undefined && item.quantity < (item.min_quantity ?? 10);

    return (
      <View style={[styles.card, { backgroundColor: theme.surface }, isLowStock && styles.lowStockCard]}>
        <View style={styles.cardHeader}>
          <Text style={[styles.productName, { color: theme.textPrimary }]}>{item.name}</Text>
          <Text style={[styles.cityName, { color: theme.textSecondary }]}>{item.city_name}</Text>
        </View>

        <View style={styles.stockInfo}>
          <View style={styles.stockItem}>
            <Text style={[styles.stockLabel, { color: theme.textTertiary }]}>当前库存</Text>
            <Text style={[styles.stockValue, isLowStock && styles.lowStockValue]}>
              {item.quantity ?? 0}
            </Text>
          </View>
          <View style={styles.stockItem}>
            <Text style={[styles.stockLabel, { color: theme.textTertiary }]}>最低库存</Text>
            <Text style={[styles.stockValue, { color: theme.textPrimary }]}>{item.min_quantity ?? 10}</Text>
          </View>
          <View style={styles.stockItem}>
            <Text style={styles.stockLabel}>状态</Text>
            <View style={[styles.statusBadge, isLowStock ? styles.lowStockBadge : styles.normalBadge]}>
              <Text style={[styles.statusText, isLowStock ? styles.lowStockBadgeText : styles.normalBadgeText]}>
                {isLowStock ? '库存不足' : '正常'}
              </Text>
            </View>
          </View>
        </View>
        <View style={[styles.stockInfo, { marginTop: -4 }]}>
          <View style={styles.stockItem}>
            <Text style={[styles.stockLabel, { color: theme.textTertiary }]}>成本价</Text>
            <Text style={[styles.stockValue, { color: theme.textPrimary, fontSize: 16 }]}>¥{item.cost ?? 0}</Text>
          </View>
          <View style={styles.stockItem}>
            <Text style={[styles.stockLabel, { color: theme.textTertiary }]}>结算价</Text>
            <Text style={[styles.stockValue, { color: theme.textPrimary, fontSize: 16 }]}>¥{item.discount_price ?? 0}</Text>
          </View>
          <View style={styles.stockItem}>
            <Text style={[styles.stockLabel, { color: theme.textTertiary }]}>库存价值</Text>
            <Text style={[styles.stockValue, { color: theme.textPrimary, fontSize: 16 }]}>¥{((item.cost ?? 0) * (item.quantity ?? 0)).toFixed(2)}</Text>
          </View>
        </View>

        {isAdminOrManager && (
          <View style={styles.actions}>
            <TouchableOpacity
              style={[styles.adjustButton, styles.decreaseButton]}
              onPress={() => handleUpdateStock(item, -10)}
            >
              <ChevronsDown size={16} color={Colors.danger} />
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.adjustButton, styles.decreaseButton]}
              onPress={() => handleUpdateStock(item, -1)}
            >
              <Minus size={16} color={Colors.danger} />
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.setButton}
              onPress={() => openEditInventoryModal(item)}
            >
              <Pencil size={14} color={Colors.blue} />
              <Text style={styles.setButtonText}>编辑</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.adjustButton, styles.increaseButton]}
              onPress={() => handleUpdateStock(item, 1)}
            >
              <Plus size={16} color={Colors.success} />
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.adjustButton, styles.increaseButton]}
              onPress={() => handleUpdateStock(item, 10)}
            >
              <ChevronsUp size={16} color={Colors.success} />
            </TouchableOpacity>
          </View>
        )}
      </View>
    );
  };

  const renderStoreInventoryItem = ({ item }: { item: StoreInventory }) => {
    const product = products.find(p => p.id === item.product_id);
    const openStoreInventoryEditor = () => {
      if (!isSuperAdmin) return;
      setEditingStoreInventoryItem(item);
      setEditStoreQuantity(String(item.quantity ?? 0));
      setStoreEditModalVisible(true);
    };

    const handleUpdateStoreStock = async (adjustment: number) => {
      if (!isSuperAdmin || !selectedStoreId) return;

      const nextQuantity = Number(item.quantity || 0) + adjustment;
      if (nextQuantity < 0) {
        Toast.show({ type: 'error', text1: '错误', text2: '店铺库存不能为负数' });
        return;
      }

      const { error } = await updateStoreInventory(selectedStoreId, item.product_id, nextQuantity);
      if (error) {
        Toast.show({ type: 'error', text1: '更新失败', text2: error.message });
      }
    };

    return (
      <View style={[styles.card, { backgroundColor: theme.surface }]}>
        <View style={styles.cardHeader}>
          <Text style={[styles.productName, { color: theme.textPrimary }]}>{item.product_name}</Text>
        </View>
        <View style={styles.stockInfo}>
          <View style={styles.stockItem}>
            <Text style={[styles.stockLabel, { color: theme.textTertiary }]}>店铺库存</Text>
            <Text style={[styles.stockValue, { color: theme.textPrimary }]}>
              {item.quantity ?? 0}
            </Text>
          </View>
          <View style={styles.stockItem}>
            <Text style={[styles.stockLabel, { color: theme.textTertiary }]}>成本价</Text>
            <Text style={[styles.stockValue, { color: theme.textPrimary, fontSize: 16 }]}>¥{product?.cost ?? 0}</Text>
          </View>
          <View style={styles.stockItem}>
            <Text style={[styles.stockLabel, { color: theme.textTertiary }]}>结算价</Text>
            <Text style={[styles.stockValue, { color: theme.textPrimary, fontSize: 16 }]}>¥{product?.discount_price ?? 0}</Text>
          </View>
        </View>
        <View style={[styles.stockInfo, { marginTop: -4, justifyContent: 'flex-start' }]}>
          <View style={[styles.stockItem, { marginRight: 40 }]}>
            <Text style={[styles.stockLabel, { color: theme.textTertiary }]}>库存价值</Text>
            <Text style={[styles.stockValue, { color: theme.textPrimary, fontSize: 16 }]}>¥{((product?.cost ?? 0) * (item.quantity ?? 0)).toFixed(2)}</Text>
          </View>
        </View>

        {isSuperAdmin && (
          <View style={styles.actions}>
            <TouchableOpacity
              style={[styles.adjustButton, styles.decreaseButton]}
              onPress={() => handleUpdateStoreStock(-10)}
            >
              <ChevronsDown size={16} color={Colors.danger} />
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.adjustButton, styles.decreaseButton]}
              onPress={() => handleUpdateStoreStock(-1)}
            >
              <Minus size={16} color={Colors.danger} />
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.setButton}
              onPress={openStoreInventoryEditor}
            >
              <Pencil size={14} color={Colors.blue} />
              <Text style={styles.setButtonText}>编辑</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.adjustButton, styles.increaseButton]}
              onPress={() => handleUpdateStoreStock(1)}
            >
              <Plus size={16} color={Colors.success} />
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.adjustButton, styles.increaseButton]}
              onPress={() => handleUpdateStoreStock(10)}
            >
              <ChevronsUp size={16} color={Colors.success} />
            </TouchableOpacity>
          </View>
        )}
      </View>
    );
  };

  const totalStock = cityFilteredProducts.reduce((sum, p) => sum + (p.quantity || 0), 0);
  const lowStockCount = lowStockProducts.length;

  const currentTotalStock = viewMode === 'main' 
    ? totalStock
    : filteredStoreInventory.reduce((sum, item) => sum + (item.quantity || 0), 0);

  const totalCostValue = viewMode === 'main'
    ? cityFilteredProducts.reduce((sum, p) => sum + (p.cost || 0) * (p.quantity || 0), 0)
    : filteredStoreInventory.reduce((sum, item) => sum + (products.find(p => p.id === item.product_id)?.cost || 0) * (item.quantity || 0), 0);

  const totalSettlementValue = viewMode === 'main'
    ? cityFilteredProducts.reduce((sum, p) => sum + (p.discount_price || 0) * (p.quantity || 0), 0)
    : filteredStoreInventory.reduce((sum, item) => sum + (products.find(p => p.id === item.product_id)?.discount_price || 0) * (item.quantity || 0), 0);

  const handleSaveStoreInventoryQuantity = async () => {
    if (!isSuperAdmin || !editingStoreInventoryItem || !selectedStoreId) return;
    const nextQuantity = Number.parseInt(editStoreQuantity, 10);
    if (Number.isNaN(nextQuantity) || nextQuantity < 0) {
      Toast.show({ type: 'error', text1: '错误', text2: '请输入有效的非负整数' });
      return;
    }

    setSavingStoreEdit(true);
    const { error } = await updateStoreInventory(selectedStoreId, editingStoreInventoryItem.product_id, nextQuantity);
    setSavingStoreEdit(false);

    if (error) {
      Toast.show({ type: 'error', text1: '更新失败', text2: error.message });
      return;
    }

    setStoreEditModalVisible(false);
    setEditingStoreInventoryItem(null);
  };

  if (user?.role === 'distributor') {
    return (
      <View style={[styles.container, { backgroundColor: theme.background }]}>
        <View style={[styles.header, { backgroundColor: theme.surface }]}>
          <Text style={[styles.headerTitle, { color: theme.textPrimary }]}>库存管理</Text>
        </View>
        <Text style={[styles.emptyText, { color: theme.textTertiary }]}>分销商不可查看库存信息</Text>
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: theme.background }]}>
      <View style={[styles.header, { backgroundColor: theme.surface }]}>
        <Text style={[styles.headerTitle, { color: theme.textPrimary }]}>库存管理</Text>
        <View style={styles.headerActions}>
          {canCreatePurchase ? (
            <TouchableOpacity
              onPress={() => {
                resetPurchaseForm();
                setPurchaseModalVisible(true);
              }}
              activeOpacity={0.85}
              style={styles.headerActionSpacing}
            >
              <LinearGradient
                colors={['#FF6B9D', '#5B8DEF']}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 0 }}
                style={styles.inboundButton}
              >
                <Text style={styles.inboundButtonText}>进货</Text>
              </LinearGradient>
            </TouchableOpacity>
          ) : null}
          {isAdminOrManager ? (
            <TouchableOpacity
              onPress={() => {
                resetInboundForm();
                setInboundModalVisible(true);
              }}
              activeOpacity={0.85}
            >
              <LinearGradient
                colors={['#FF6B9D', '#5B8DEF']}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 0 }}
                style={styles.inboundButton}
              >
                <Text style={styles.inboundButtonText}>入库</Text>
              </LinearGradient>
            </TouchableOpacity>
          ) : null}
        </View>
      </View>


      <View style={styles.cityFilterOverlay}>
        {isAdminOrManager && (
          <View style={[styles.viewModeContainer, { backgroundColor: theme.surface }]}>
            <TouchableOpacity
              style={[styles.viewModeButton, viewMode === 'main' && { backgroundColor: theme.surfaceSecondary }]}
              onPress={() => setViewMode('main')}
            >
              <Text style={[styles.viewModeText, viewMode === 'main' && [styles.viewModeTextActive, { color: theme.textPrimary }]]}>总仓库存</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.viewModeButton, viewMode === 'store' && { backgroundColor: theme.surfaceSecondary }]}
              onPress={() => setViewMode('store')}
            >
              <Text style={[styles.viewModeText, viewMode === 'store' && [styles.viewModeTextActive, { color: theme.textPrimary }]]}>店铺库存</Text>
            </TouchableOpacity>
          </View>
        )}
        {viewMode === 'main' ? (
          <View style={[styles.cityFilterPanel, { backgroundColor: theme.surface, borderTopColor: theme.border }]}>
            <ProvinceCityFilter
              cities={cities}
              selectedProvinceId={filterProvinceId}
              selectedCityId={filterCityId}
              onProvinceChange={setFilterProvinceId}
              onCityChange={setFilterCityId}
              showProvince={isAdminOrManager}
            />
          </View>
        ) : (
          <View style={[styles.cityFilterPanel, { backgroundColor: theme.surface, borderTopColor: theme.border }]}> 
            <ProvinceCityFilter
              cities={storeFilterCities}
              selectedProvinceId={selectedStoreProvinceId}
              selectedCityId={selectedStoreCityId}
              onProvinceChange={(provinceId) => {
                setSelectedStoreProvinceId(provinceId);
                setSelectedStoreCityId(null);
              }}
              onCityChange={setSelectedStoreCityId}
              showProvince
            />
          </View>
        )}
        {viewMode === 'store' ? (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            style={[styles.cityFilterRow, { backgroundColor: theme.surface, borderTopColor: theme.border }]}
            contentContainerStyle={styles.cityFilterContent}
          >
            {activeStoresForStoreFilter.map((store) => (
              <TouchableOpacity
                key={store.id}
                style={[styles.cityFilterItem, selectedStoreId === store.id && styles.cityFilterItemActive]}
                onPress={() => setSelectedStoreId(store.id)}
              >
                <LinearGradient
                  colors={selectedStoreId === store.id ? ['#FF6B9D', '#5B8DEF'] : [theme.surfaceSecondary, theme.surfaceSecondary]}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 0 }}
                  style={styles.cityGradientChip}
                >
                  <Text
                    style={[styles.cityFilterText, selectedStoreId === store.id && styles.cityFilterTextActive]}
                    numberOfLines={1}
                    ellipsizeMode="tail"
                  >
                    {store.name}
                  </Text>
                </LinearGradient>
              </TouchableOpacity>
            ))}
          </ScrollView>
        ) : null}
      </View>

      {viewMode === 'main' ? (
        <>
          <View style={[styles.summary, { backgroundColor: theme.surface, borderTopColor: theme.border }] }>
            <View style={styles.summaryItem}>
              <Text style={styles.summaryValue}>{cityFilteredProducts.length}</Text>
              <Text style={styles.summaryLabel}>商品种类</Text>
            </View>
            <View style={styles.summaryItem}>
              <Text style={styles.summaryValue}>{totalStock}</Text>
              <Text style={styles.summaryLabel}>总库存</Text>
            </View>
            <View style={[styles.summaryItem, lowStockCount > 0 && styles.warningItem]}>
              <Text style={[styles.summaryValue, lowStockCount > 0 && styles.warningValue]}>
                {lowStockCount}
              </Text>
              <Text style={styles.summaryLabel}>库存不足</Text>
            </View>
          </View>
          <View style={[styles.summary, { backgroundColor: theme.surface, borderTopWidth: 0, paddingTop: 0 }] }>
            <View style={styles.summaryItem}>
              <Text style={styles.summaryValue}>¥{totalCostValue.toFixed(2)}</Text>
              <Text style={styles.summaryLabel}>库存价值(成本)</Text>
            </View>
            <View style={styles.summaryItem}>
              <Text style={styles.summaryValue}>¥{totalSettlementValue.toFixed(2)}</Text>
              <Text style={styles.summaryLabel}>库存价值(结算)</Text>
            </View>
          </View>

          <View style={[styles.filterRow, { backgroundColor: theme.surface }]}>
            {renderFilterButton('all', '全部')}
            {renderFilterButton('low', '库存不足')}
            {renderFilterButton('normal', '库存正常')}
          </View>

          <View style={[styles.searchContainer, { backgroundColor: theme.surfaceSecondary }] }>
            <Search size={18} color={theme.textTertiary} />
            <TextInput
              style={[styles.searchInput, { color: theme.textPrimary }]}
              placeholder="搜索商品..."
              placeholderTextColor={theme.textTertiary}
              value={searchText}
              onChangeText={setSearchText}
              textAlignVertical="center"
            />
          </View>

          <FlatList
            data={filteredProducts}
            keyExtractor={(item) => item.id}
            renderItem={renderItem}
            contentContainerStyle={styles.list}
            refreshControl={
              <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.pink} />
            }
            ListEmptyComponent={
              <View style={styles.emptyContainer}>
                <PackageOpen size={48} color={theme.textTertiary} strokeWidth={1.5} />
                <Text style={[styles.emptyStateText, { color: theme.textTertiary }]}>暂无数据</Text>
              </View>
            }
          />
        </>
      ) : (
        <>
          <View style={[styles.summary, { backgroundColor: theme.surface, borderTopColor: theme.border }] }>
            <View style={styles.summaryItem}>
              <Text style={styles.summaryValue}>{filteredStoreInventory.length}</Text>
              <Text style={styles.summaryLabel}>商品种类</Text>
            </View>
            <View style={styles.summaryItem}>
              <Text style={styles.summaryValue}>{currentTotalStock}</Text>
              <Text style={styles.summaryLabel}>总库存</Text>
            </View>
          </View>
          <View style={[styles.summary, { backgroundColor: theme.surface, borderTopWidth: 0, paddingTop: 0 }] }>
            <View style={styles.summaryItem}>
              <Text style={styles.summaryValue}>¥{totalCostValue.toFixed(2)}</Text>
              <Text style={styles.summaryLabel}>库存价值(成本)</Text>
            </View>
            <View style={styles.summaryItem}>
              <Text style={styles.summaryValue}>¥{totalSettlementValue.toFixed(2)}</Text>
              <Text style={styles.summaryLabel}>库存价值(结算)</Text>
            </View>
          </View>
          <View style={[styles.searchContainer, { backgroundColor: theme.surfaceSecondary, marginTop: 10 }] }>
            <Search size={18} color={theme.textTertiary} />
            <TextInput
              style={[styles.searchInput, { color: theme.textPrimary }]}
              placeholder="搜索店铺商品..."
              placeholderTextColor={theme.textTertiary}
              value={searchText}
              onChangeText={setSearchText}
              textAlignVertical="center"
            />
          </View>
          <FlatList
            data={filteredStoreInventory}
            keyExtractor={(item) => item.id}
            renderItem={renderStoreInventoryItem}
            contentContainerStyle={styles.list}
            refreshControl={
              <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.pink} />
            }
            ListEmptyComponent={
              <View style={styles.emptyContainer}>
                <PackageOpen size={48} color={theme.textTertiary} strokeWidth={1.5} />
                <Text style={[styles.emptyStateText, { color: theme.textTertiary }]}>暂无店铺库存数据</Text>
              </View>
            }
          />
        </>
      )}

      <Modal visible={editModalVisible} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, { backgroundColor: theme.surface }]}>
            <Text style={[styles.modalTitle, { color: theme.textPrimary }]}>编辑库存</Text>
            <Text style={[styles.modalSubtitle, { color: theme.textSecondary }]}>{editingProduct?.name ?? ''}</Text>

            <View style={styles.inputGroup}>
              <Text style={[styles.inputLabel, { color: theme.textSecondary }]}>当前库存</Text>
              <TextInput
                style={[styles.input, { backgroundColor: theme.surfaceSecondary, color: theme.textPrimary }]}
                value={editQuantity}
                onChangeText={setEditQuantity}
                keyboardType="number-pad"
                placeholder="输入当前库存"
                placeholderTextColor={theme.textTertiary}
              />
            </View>

            <View style={styles.inputGroup}>
              <Text style={[styles.inputLabel, { color: theme.textSecondary }]}>最低库存</Text>
              <TextInput
                style={[styles.input, { backgroundColor: theme.surfaceSecondary, color: theme.textPrimary }]}
                value={editMinQuantity}
                onChangeText={setEditMinQuantity}
                keyboardType="number-pad"
                placeholder="输入最低库存"
                placeholderTextColor={theme.textTertiary}
              />
            </View>

            <View style={styles.modalActions}>
              <TouchableOpacity
                style={[styles.cancelButton, { borderColor: theme.border }]}
                onPress={() => {
                  setEditModalVisible(false);
                  setEditingProduct(null);
                }}
                disabled={savingEdit}
              >
                <Text style={[styles.cancelButtonText, { color: theme.textSecondary }]}>取消</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.saveButton, savingEdit && styles.disabledButton]}
                onPress={handleSaveInventorySettings}
                disabled={savingEdit}
              >
                <Text style={styles.saveButtonText}>{savingEdit ? '保存中...' : '保存'}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      <Modal visible={storeEditModalVisible} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, { backgroundColor: theme.surface }] }>
            <Text style={[styles.modalTitle, { color: theme.textPrimary }]}>编辑店铺库存</Text>
            <Text style={[styles.modalSubtitle, { color: theme.textSecondary }]}>{editingStoreInventoryItem?.product_name ?? ''}</Text>

            <View style={styles.inputGroup}>
              <Text style={[styles.inputLabel, { color: theme.textSecondary }]}>店铺库存</Text>
              <TextInput
                style={[styles.input, { backgroundColor: theme.surfaceSecondary, color: theme.textPrimary }]}
                value={editStoreQuantity}
                onChangeText={setEditStoreQuantity}
                keyboardType="number-pad"
                placeholder="输入店铺库存"
                placeholderTextColor={theme.textTertiary}
              />
            </View>

            <View style={styles.modalActions}>
              <TouchableOpacity
                style={[styles.cancelButton, { borderColor: theme.border }]}
                onPress={() => {
                  setStoreEditModalVisible(false);
                  setEditingStoreInventoryItem(null);
                }}
                disabled={savingStoreEdit}
              >
                <Text style={[styles.cancelButtonText, { color: theme.textSecondary }]}>取消</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.saveButton, savingStoreEdit && styles.disabledButton]}
                onPress={handleSaveStoreInventoryQuantity}
                disabled={savingStoreEdit}
              >
                <Text style={styles.saveButtonText}>{savingStoreEdit ? '保存中...' : '保存'}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      <Modal visible={inboundModalVisible} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, { backgroundColor: theme.surface }]}>
            <Text style={[styles.modalTitle, { color: theme.textPrimary }]}>条码入库</Text>
            <Text style={[styles.modalSubtitle, { color: theme.textSecondary }]}>扫码枪输入条码后回车可自动识别</Text>

            <View style={styles.inputGroup}>
              <Text style={[styles.inputLabel, { color: theme.textSecondary }]}>商品条码</Text>
              <TextInput
                style={[styles.input, { backgroundColor: theme.surfaceSecondary, color: theme.textPrimary }]}
                value={inboundBarcode}
                onChangeText={handleInboundBarcodeLookup}
                keyboardType="number-pad"
                autoFocus
                maxLength={13}
                placeholder="请输入13位条码"
                placeholderTextColor={theme.textTertiary}
                onSubmitEditing={() => handleInboundBarcodeLookup()}
              />
            </View>

            {inboundBarcode.length === 13 ? (
              <View style={[styles.scanResultBox, { backgroundColor: theme.surfaceSecondary }]}>
                {inboundProduct ? (
                  <>
                    <Text style={[styles.scanResultName, { color: theme.textPrimary }]}>{inboundProduct.name}</Text>
                    <Text style={[styles.scanResultStock, { color: theme.textSecondary }]}>当前库存：{inboundProduct.quantity ?? 0}</Text>
                  </>
                ) : (
                  <Text style={styles.scanResultError}>未找到对应商品</Text>
                )}
              </View>
            ) : null}

            <View style={styles.inputGroup}>
              <Text style={[styles.inputLabel, { color: theme.textSecondary }]}>入库数量</Text>
              <TextInput
                style={[styles.input, { backgroundColor: theme.surfaceSecondary, color: theme.textPrimary }]}
                value={inboundQuantity}
                onChangeText={setInboundQuantity}
                keyboardType="number-pad"
                placeholder="请输入数量"
                placeholderTextColor={theme.textTertiary}
              />
            </View>

            <View style={styles.modalActions}>
              <TouchableOpacity
                style={[styles.cancelButton, { borderColor: theme.border }]}
                onPress={() => {
                  setInboundModalVisible(false);
                  resetInboundForm();
                }}
                disabled={submittingInbound}
              >
                <Text style={[styles.cancelButtonText, { color: theme.textSecondary }]}>取消</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.saveButton, submittingInbound && styles.disabledButton]}
                onPress={handleConfirmInbound}
                disabled={submittingInbound}
              >
                <Text style={styles.saveButtonText}>{submittingInbound ? '处理中...' : '确认入库'}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      <Modal visible={purchaseModalVisible} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, styles.purchaseModalContent, { backgroundColor: theme.surface }] }>
            <Text style={[styles.modalTitle, { color: theme.textPrimary }]}>进货建单</Text>
            <Text style={[styles.modalSubtitle, { color: theme.textSecondary }]}>选择店铺和商品数量，建单后需在订单页确认到货</Text>

            <Text style={[styles.inputLabel, { color: theme.textSecondary }]}>进货店铺</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.cityFilterRow} contentContainerStyle={styles.cityFilterContent}>
              {activePurchaseStores.map((store) => (
                <TouchableOpacity
                  key={store.id}
                  style={[styles.cityFilterItem, purchaseStoreId === store.id && styles.cityFilterItemActive]}
                  onPress={() => setPurchaseStoreId(store.id)}
                >
                  <LinearGradient
                    colors={purchaseStoreId === store.id ? ['#FF6B9D', '#5B8DEF'] : [theme.surfaceSecondary, theme.surfaceSecondary]}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 0 }}
                    style={styles.cityGradientChip}
                  >
                    <Text style={[styles.cityFilterText, purchaseStoreId === store.id && styles.cityFilterTextActive]} numberOfLines={1} ellipsizeMode="tail">
                      {store.name}
                    </Text>
                  </LinearGradient>
                </TouchableOpacity>
              ))}
            </ScrollView>

            {selectedPurchaseStore ? (
              <FlatList
                data={purchaseProducts}
                keyExtractor={(item) => item.id}
                style={styles.purchaseProductList}
                renderItem={({ item }) => {
                  const qty = purchaseCart.get(getPurchaseCartKey(selectedPurchaseStore.id, item.id)) || 0;
                  return (
                    <View style={[styles.purchaseProductRow, { borderBottomColor: theme.divider }] }>
                      <View style={styles.purchaseProductInfo}>
                        <Text style={[styles.productName, { color: theme.textPrimary }]} numberOfLines={1} ellipsizeMode="tail">{item.name}</Text>
                        <Text style={[styles.cityName, { color: theme.textSecondary }]}>成本 {Number(item.cost || 0).toFixed(2)}元 · {item.city_name || selectedPurchaseStore.city_name || '未知城市'}</Text>
                      </View>
                      <View style={styles.purchaseQtyControls}>
                        <TouchableOpacity style={styles.purchaseQtyButton} onPress={() => updatePurchaseQuantity(selectedPurchaseStore.id, item.id, qty - 1)}>
                          <Minus size={14} color={Colors.textSecondary} />
                        </TouchableOpacity>
                        <TextInput
                          style={[styles.purchaseQtyInput, { backgroundColor: theme.surfaceSecondary, color: theme.textPrimary }]}
                          value={qty > 0 ? String(qty) : ''}
                          onChangeText={(text) => updatePurchaseQuantity(selectedPurchaseStore.id, item.id, Number.parseInt(text.replace(/[^0-9]/g, ''), 10))}
                          keyboardType="number-pad"
                          placeholder="0"
                          placeholderTextColor={theme.textTertiary}
                        />
                        <TouchableOpacity style={styles.purchaseQtyButton} onPress={() => updatePurchaseQuantity(selectedPurchaseStore.id, item.id, qty + 1)}>
                          <Plus size={14} color={Colors.textSecondary} />
                        </TouchableOpacity>
                      </View>
                    </View>
                  );
                }}
                ListEmptyComponent={
                  <View style={styles.emptyContainer}>
                    <ShoppingBag size={44} color={theme.textTertiary} strokeWidth={1.5} />
                    <Text style={[styles.emptyStateText, { color: theme.textTertiary }]}>该店铺城市暂无商品</Text>
                  </View>
                }
              />
            ) : (
              <View style={styles.emptyContainer}>
                <ShoppingBag size={44} color={theme.textTertiary} strokeWidth={1.5} />
                <Text style={[styles.emptyStateText, { color: theme.textTertiary }]}>请先选择进货店铺</Text>
              </View>
            )}

            <View style={styles.purchaseSummaryBox}>
              <Text style={[styles.scanResultStock, { color: theme.textSecondary }]}>已选 {purchaseStoreCount} 个店铺，共 {purchaseTotalQuantity} 件</Text>
            </View>

            <View style={styles.modalActions}>
              <TouchableOpacity
                style={[styles.cancelButton, { borderColor: theme.border }]}
                onPress={() => {
                  setPurchaseModalVisible(false);
                  resetPurchaseForm();
                }}
                disabled={submittingPurchase}
              >
                <Text style={[styles.cancelButtonText, { color: theme.textSecondary }]}>取消</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.saveButton, (submittingPurchase || purchaseCartEntries.length === 0) && styles.disabledButton]}
                onPress={handleConfirmPurchase}
                disabled={submittingPurchase || purchaseCartEntries.length === 0}
              >
                <Text style={styles.saveButtonText}>{submittingPurchase ? '处理中...' : '创建进货单'}</Text>
              </TouchableOpacity>
            </View>
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
    position: 'relative',
  },
  header: {
    height: 62,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 15,
    backgroundColor: Colors.surface,
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: Colors.textPrimary,
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  headerActionSpacing: {
    marginRight: 8,
  },
  inboundButton: {
    paddingHorizontal: 16,
    paddingVertical: 9,
    borderRadius: Radius.xl,
  },
  inboundButtonText: {
    color: '#fff',
    fontWeight: '600',
    fontSize: 14,
  },
  viewModeContainer: {
    flexDirection: 'row',
    paddingHorizontal: 15,
    paddingVertical: 8,
    height: 48,
  },
  viewModeButton: {
    flex: 1,
    paddingVertical: 6,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: Radius.md,
  },
  viewModeText: {
    fontSize: 14,
    color: Colors.textSecondary,
    fontWeight: '500',
  },
  viewModeTextActive: {
    fontWeight: '700',
  },
  cityFilterOverlay: {
    zIndex: 10,
    elevation: 2,
  },
  cityFilterPanel: {
    borderTopWidth: 1,
    paddingTop: 8,
  },
  cityFilterRow: {
    backgroundColor: Colors.surface,
    borderTopWidth: 1,
    borderTopColor: Colors.borderLight,
    minHeight: 58,
  },
  cityFilterContent: {
    paddingHorizontal: 10,
    paddingVertical: 9,
    alignItems: 'center',
  },
  cityFilterItem: {
    width: 112,
    height: 40,
    borderRadius: Radius.xl,
    backgroundColor: Colors.surfaceSecondary,
    marginRight: 8,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  cityFilterItemActive: {
    backgroundColor: 'transparent',
  },
  cityGradientChip: {
    width: '100%',
    height: '100%',
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: Radius.xl,
  },
  cityFilterText: {
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '600',
    color: Colors.textSecondary,
    width: '100%',
    textAlign: 'center',
  },
  cityFilterTextActive: {
    color: '#fff',
    fontWeight: '600',
  },
  summary: {
    flexDirection: 'row',
    backgroundColor: Colors.surface,
    paddingVertical: 10,
    marginBottom: 8,
    borderTopWidth: 1,
    borderTopColor: Colors.borderLight,
  },
  summaryItem: {
    flex: 1,
    alignItems: 'center',
  },
  warningItem: {
    backgroundColor: Colors.dangerBg,
    borderRadius: Radius.sm,
    marginHorizontal: 4,
    paddingVertical: 5,
  },
  summaryValue: {
    fontSize: 18,
    fontWeight: '700',
    color: Colors.textPrimary,
  },
  warningValue: {
    color: Colors.danger,
  },
  summaryLabel: {
    fontSize: 11,
    color: Colors.textSecondary,
    marginTop: 2,
  },
  filterRow: {
    flexDirection: 'row',
    padding: 10,
    backgroundColor: Colors.surface,
    marginBottom: 8,
  },
  filterButton: {
    flex: 1,
    borderRadius: Radius.xl,
    marginHorizontal: 4,
    backgroundColor: Colors.surfaceSecondary,
    overflow: 'hidden',
  },
  filterActive: {
    backgroundColor: 'transparent',
  },
  filterGradient: {
    paddingVertical: 9,
    alignItems: 'center',
    borderRadius: Radius.xl,
  },
  filterText: {
    fontSize: 14,
    color: Colors.textSecondary,
    textAlign: 'center',
    paddingVertical: 9,
  },
  filterTextActive: {
    color: '#fff',
    fontWeight: '600',
    fontSize: 14,
  },
  list: {
    padding: 10,
  },
  card: {
    backgroundColor: Colors.surface,
    borderRadius: Radius.lg,
    padding: 15,
    marginBottom: 10,
    ...Shadow.card,
  },
  lowStockCard: {
    borderLeftWidth: 4,
    borderLeftColor: Colors.danger,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  productName: {
    fontSize: 16,
    fontWeight: '600',
    color: Colors.textPrimary,
  },
  cityName: {
    fontSize: 14,
    color: Colors.textSecondary,
  },
  stockInfo: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  stockItem: {
    alignItems: 'center',
  },
  stockLabel: {
    fontSize: 12,
    color: Colors.textTertiary,
    marginBottom: 4,
  },
  stockValue: {
    fontSize: 20,
    fontWeight: '700',
    color: Colors.textPrimary,
  },
  lowStockValue: {
    color: Colors.danger,
  },
  statusBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: Radius.md,
  },
  normalBadge: {
    backgroundColor: Colors.successBg,
  },
  lowStockBadge: {
    backgroundColor: Colors.dangerBg,
  },
  statusText: {
    fontSize: 12,
    fontWeight: '500',
  },
  normalBadgeText: {
    color: Colors.success,
  },
  lowStockBadgeText: {
    color: Colors.danger,
  },
  actions: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    borderTopWidth: 1,
    borderTopColor: Colors.divider,
    paddingTop: 12,
  },
  adjustButton: {
    width: 45,
    height: 36,
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: Radius.sm,
  },
  decreaseButton: {
    backgroundColor: Colors.dangerBg,
  },
  increaseButton: {
    backgroundColor: Colors.successBg,
  },
  decreaseText: {
    fontSize: 14,
    fontWeight: '600',
    color: Colors.danger,
  },
  increaseText: {
    fontSize: 14,
    fontWeight: '600',
    color: Colors.success,
  },
  setButton: {
    flex: 1,
    height: 36,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 4,
    backgroundColor: Colors.blueSoft,
    borderRadius: Radius.md,
    marginHorizontal: 8,
  },
  setButtonText: {
    fontSize: 14,
    fontWeight: '600',
    color: Colors.blue,
  },
  emptyText: {
    textAlign: 'center',
    color: Colors.textTertiary,
    marginTop: 50,
    fontSize: 15,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(45,45,63,0.4)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    backgroundColor: Colors.surface,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 20,
  },
  purchaseModalContent: {
    maxHeight: '90%',
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: Colors.textPrimary,
    textAlign: 'center',
  },
  modalSubtitle: {
    marginTop: 6,
    marginBottom: 14,
    textAlign: 'center',
    color: Colors.textSecondary,
    fontSize: 14,
  },
  inputGroup: {
    marginBottom: 12,
  },
  inputLabel: {
    fontSize: 13,
    color: Colors.textSecondary,
    marginBottom: 6,
  },
  input: {
    height: 44,
    borderRadius: Radius.md,
    backgroundColor: Colors.surfaceSecondary,
    paddingHorizontal: 12,
    fontSize: 16,
    color: Colors.textPrimary,
  },
  modalActions: {
    flexDirection: 'row',
    marginTop: 6,
  },
  cancelButton: {
    flex: 1,
    height: 44,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 8,
  },
  cancelButtonText: {
    color: Colors.textSecondary,
    fontSize: 15,
    fontWeight: '500',
  },
  saveButton: {
    flex: 1,
    height: 44,
    borderRadius: Radius.md,
    backgroundColor: Colors.pink,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 8,
  },
  saveButtonText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '600',
  },
  disabledButton: {
    opacity: 0.6,
  },
  scanResultBox: {
    backgroundColor: Colors.surfaceSecondary,
    borderRadius: Radius.md,
    padding: 12,
    marginBottom: 12,
  },
  scanResultName: {
    fontSize: 16,
    fontWeight: '700',
    color: Colors.textPrimary,
  },
  scanResultStock: {
    marginTop: 4,
    color: Colors.textSecondary,
    fontSize: 13,
  },
  scanResultError: {
    color: Colors.danger,
    fontSize: 13,
    fontWeight: '600',
  },
  searchContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.surfaceSecondary,
    borderRadius: 20,
    marginHorizontal: 10,
    marginBottom: 8,
    paddingHorizontal: 12,
    height: 40,
  },
  searchInput: {
    flex: 1,
    marginLeft: 8,
    fontSize: 14,
    lineHeight: 20,
    color: Colors.textPrimary,
    paddingVertical: 0,
    includeFontPadding: false,
    textAlignVertical: 'center',
  },
  emptyContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: 80,
  },
  emptyStateText: {
    textAlign: 'center',
    color: Colors.textTertiary,
    marginTop: 12,
    fontSize: 15,
  },
  purchaseProductList: {
    maxHeight: 360,
    marginTop: 8,
  },
  purchaseProductRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: Colors.divider,
  },
  purchaseProductInfo: {
    flex: 1,
    marginRight: 10,
  },
  purchaseQtyControls: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  purchaseQtyButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: Colors.surfaceSecondary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  purchaseQtyInput: {
    width: 52,
    height: 32,
    borderRadius: Radius.sm,
    marginHorizontal: 6,
    textAlign: 'center',
    fontSize: 14,
    lineHeight: 18,
    paddingVertical: 0,
    includeFontPadding: false,
    textAlignVertical: 'center',
    color: Colors.textPrimary,
  },
  purchaseSummaryBox: {
    marginTop: 10,
    marginBottom: 4,
  },
});
