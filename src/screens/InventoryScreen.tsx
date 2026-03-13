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
import { Minus, Plus, ChevronsDown, ChevronsUp, Search, Pencil, PackageOpen } from 'lucide-react-native';
import Toast from 'react-native-toast-message';
import { useShallow } from 'zustand/react/shallow';

import { useAppStore } from '../store/useAppStore';
import { Colors, Shadow, Radius, LightColors, DarkColors } from '../theme';
import type { ProductWithDetails } from '../types';

export default function InventoryScreen() {
  const {
    products,
    cities,
    fetchProducts,
    fetchCities,
    updateInventory,
    updateInventorySettings,
    findProductByBarcode,
    inboundStock,
    user,
  } = useAppStore(
    useShallow((state) => ({
      products: state.products,
      cities: state.cities,
      fetchProducts: state.fetchProducts,
      fetchCities: state.fetchCities,
      updateInventory: state.updateInventory,
      updateInventorySettings: state.updateInventorySettings,
      findProductByBarcode: state.findProductByBarcode,
      inboundStock: state.inboundStock,
      user: state.user,
    })),
  );
  const [refreshing, setRefreshing] = useState(false);
  const [filter, setFilter] = useState<'all' | 'low' | 'normal'>('all');
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
  const [searchText, setSearchText] = useState('');
  const isDarkMode = useAppStore((state) => state.isDarkMode);
  const theme = isDarkMode ? DarkColors : LightColors;

  const isAdminOrManager = user?.role === 'admin' || user?.role === 'inventory_manager';

  useEffect(() => {
    fetchProducts();
    fetchCities();
  }, [fetchProducts, fetchCities]);

  const onRefresh = async () => {
    setRefreshing(true);
    await fetchProducts();
    setRefreshing(false);
  };

  const cityFilteredProducts = filterCityId
    ? products.filter((p) => p.city_id === filterCityId)
    : products;

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

  const totalStock = cityFilteredProducts.reduce((sum, p) => sum + (p.quantity || 0), 0);
  const lowStockCount = lowStockProducts.length;

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

      <View style={styles.cityFilterSpacer} />

      <View style={styles.cityFilterOverlay}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.cityFilterRow}
          contentContainerStyle={styles.cityFilterContent}
        >
          <TouchableOpacity
            style={[styles.cityFilterItem, filterCityId === null && styles.cityFilterItemActive]}
            onPress={() => setFilterCityId(null)}
          >
            <LinearGradient
               colors={filterCityId === null ? ['#FF6B9D', '#5B8DEF'] : [theme.surfaceSecondary, theme.surfaceSecondary]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 0 }}
              style={styles.cityGradientChip}
            >
              <Text
                style={[styles.cityFilterText, filterCityId === null && styles.cityFilterTextActive]}
                numberOfLines={1}
                ellipsizeMode="tail"
              >
                全部城市
              </Text>
            </LinearGradient>
          </TouchableOpacity>
          {cities.map((city) => (
            <TouchableOpacity
              key={city.id}
              style={[styles.cityFilterItem, filterCityId === city.id && styles.cityFilterItemActive]}
              onPress={() => setFilterCityId(city.id)}
            >
              <LinearGradient
                 colors={filterCityId === city.id ? ['#FF6B9D', '#5B8DEF'] : [theme.surfaceSecondary, theme.surfaceSecondary]}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 0 }}
                style={styles.cityGradientChip}
              >
                <Text
                  style={[styles.cityFilterText, filterCityId === city.id && styles.cityFilterTextActive]}
                  numberOfLines={1}
                  ellipsizeMode="tail"
                >
                  {city.name}
                </Text>
              </LinearGradient>
            </TouchableOpacity>
          ))}
        </ScrollView>
      </View>

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
  cityFilterSpacer: {
    height: 58,
  },
  cityFilterOverlay: {
    position: 'absolute',
    top: 62,
    left: 0,
    right: 0,
    zIndex: 10,
    elevation: 2,
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
    paddingVertical: 15,
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
    paddingVertical: 8,
  },
  summaryValue: {
    fontSize: 24,
    fontWeight: '700',
    color: Colors.textPrimary,
  },
  warningValue: {
    color: Colors.danger,
  },
  summaryLabel: {
    fontSize: 12,
    color: Colors.textSecondary,
    marginTop: 4,
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
});
