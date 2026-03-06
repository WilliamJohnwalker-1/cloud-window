import React, { useEffect, useMemo, useState } from 'react';
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
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Search, ShoppingBag, PackageCheck, Trash2, ClipboardList } from 'lucide-react-native';
import Toast from 'react-native-toast-message';
import { useAppStore } from '../store/useAppStore';
import { Colors, Shadow, Radius } from '../theme';
import type { Order, ProductWithDetails } from '../types';

interface CartItem {
  product: ProductWithDetails;
  quantity: number;
}

export default function OrdersScreen() {
  const {
    user,
    products,
    orders,
    distributors,
    fetchProducts,
    fetchOrders,
    fetchDistributors,
    createBatchOrders,
    deleteOrder,
    acceptOrder,
    findProductByBarcode,
    outboundStock,
  } = useAppStore();

  const [modalVisible, setModalVisible] = useState(false);
  const [cart, setCart] = useState<Map<string, CartItem>>(new Map());
  const [refreshing, setRefreshing] = useState(false);
  const [deletingOrderId, setDeletingOrderId] = useState<string | null>(null);
  const [selectedDistributorId, setSelectedDistributorId] = useState<string | null>(null);
  const [monthFilter, setMonthFilter] = useState<'all' | 'current'>('current');
  const [outboundModalVisible, setOutboundModalVisible] = useState(false);
  const [outboundBarcode, setOutboundBarcode] = useState('');
  const [outboundQuantity, setOutboundQuantity] = useState('');
  const [outboundProduct, setOutboundProduct] = useState<ProductWithDetails | null>(null);
  const [submittingOutbound, setSubmittingOutbound] = useState(false);
  const [searchText, setSearchText] = useState('');

  const isAdmin = user?.role === 'admin';
  const canCreateOrder = user?.role === 'distributor' || user?.role === 'admin';

  useEffect(() => {
    fetchOrders();
    fetchProducts();
    fetchDistributors();
  }, []);

  const onRefresh = async () => {
    setRefreshing(true);
    await Promise.all([fetchOrders(), fetchProducts(), fetchDistributors()]);
    setRefreshing(false);
  };

  const availableProducts = useMemo(() => {
    const inStock = products.filter((p) => (p.quantity || 0) > 0);
    if (user?.role === 'distributor') {
      return inStock.filter((p) => p.city_id === user.city_id);
    }
    return inStock;
  }, [products, user]);

  const filteredOrders = useMemo(() => {
    let list = [...orders];

    if (isAdmin && selectedDistributorId) {
      list = list.filter((o) => o.distributor_id === selectedDistributorId);
    }

    if (monthFilter === 'current') {
      const now = new Date();
      list = list.filter((o) => {
        const d = new Date(o.created_at);
        return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth();
      });
    }

    if (searchText.trim()) {
      const lowerSearch = searchText.toLowerCase().trim();
      list = list.filter((o) => {
        const shortId = o.id.slice(0, 8).toLowerCase();
        const email = (o.distributor_email || '').toLowerCase();
        return shortId.includes(lowerSearch) || email.includes(lowerSearch);
      });
    }

    return list;
  }, [orders, isAdmin, selectedDistributorId, monthFilter, searchText]);

  const monthlyProductStats = useMemo(() => {
    const map = new Map<string, { name: string; quantity: number }>();
    filteredOrders.forEach((order) => {
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
  }, [filteredOrders]);

  const cumulativeProductStats = useMemo(() => {
    let list = [...orders];
    if (isAdmin && selectedDistributorId) {
      list = list.filter((o) => o.distributor_id === selectedDistributorId);
    }
    const map = new Map<string, { name: string; quantity: number }>();
    list.forEach((order) => {
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
  }, [orders, isAdmin, selectedDistributorId]);

  const monthlyTopRows = useMemo(
    () => Array.from({ length: 5 }, (_, idx) => monthlyProductStats[idx] ?? null),
    [monthlyProductStats],
  );

  const cumulativeTopRows = useMemo(
    () => Array.from({ length: 5 }, (_, idx) => cumulativeProductStats[idx] ?? null),
    [cumulativeProductStats],
  );

  const addToCart = (product: ProductWithDetails) => {
    setCart((prev) => {
      const next = new Map(prev);
      const existing = next.get(product.id);
      const currentQty = existing?.quantity || 0;
      if (currentQty >= (product.quantity || 0)) {
        Toast.show({ type: 'error', text1: '库存不足', text2: `${product.name} 当前库存仅 ${product.quantity || 0}` });
        return prev;
      }
      next.set(product.id, { product, quantity: currentQty + 1 });
      return next;
    });
  };

  const removeFromCart = (productId: string) => {
    setCart((prev) => {
      const next = new Map(prev);
      const existing = next.get(productId);
      if (!existing) return prev;
      if (existing.quantity <= 1) {
        next.delete(productId);
      } else {
        next.set(productId, { ...existing, quantity: existing.quantity - 1 });
      }
      return next;
    });
  };

  const clearCart = () => setCart(new Map());

  const cartItems = useMemo(() => Array.from(cart.values()), [cart]);
  const cartRetailTotal = useMemo(
    () => cartItems.reduce((sum, item) => sum + item.quantity * Number(item.product.price || 0), 0),
    [cartItems],
  );
  const cartDiscountTotal = useMemo(
    () => cartItems.reduce((sum, item) => sum + item.quantity * Number(item.product.discount_price || item.product.price || 0), 0),
    [cartItems],
  );
  const cartCount = useMemo(() => cartItems.reduce((sum, item) => sum + item.quantity, 0), [cartItems]);

  const handleSubmitOrder = async () => {
    if (cartItems.length === 0) {
      Toast.show({ type: 'error', text1: '错误', text2: '购物车为空' });
      return;
    }

    const items = cartItems.map((item) => ({
      productId: item.product.id,
      quantity: item.quantity,
    }));

    const { error } = await createBatchOrders(items);
    if (error) {
      Toast.show({ type: 'error', text1: '错误', text2: error.message });
      return;
    }

    Toast.show({ type: 'success', text1: '成功', text2: '订单已创建（本次购物车合并为一条订单）' });
    clearCart();
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

  const totalRetail = filteredOrders.reduce((sum, o) => sum + Number(o.total_retail_amount || 0), 0);
  const totalDiscount = filteredOrders.reduce((sum, o) => sum + Number(o.total_discount_amount || 0), 0);

  const renderOrder = ({ item }: { item: Order }) => (
    <View style={styles.orderCard}>
      <View style={styles.orderHeader}>
        <Text style={styles.orderId}>订单 #{item.id.slice(0, 8)}</Text>
        <Text style={styles.orderDate}>{new Date(item.created_at).toLocaleDateString('zh-CN')}</Text>
      </View>

      <View style={styles.orderMetaContainer}>
        <PackageCheck size={14} color={Colors.textTertiary} style={{ marginRight: 4 }} />
        <Text style={styles.orderMeta}>
          下单账号: {item.distributor_email || item.distributor_id}
          {item.distributor_store ? ` · ${item.distributor_store}` : ''}
        </Text>
      </View>

      {item.items.map((orderItem) => (
        <View key={orderItem.id} style={styles.orderItemRow}>
          <Text style={styles.orderItemName}>{orderItem.product_name}</Text>
          <Text style={styles.orderItemQty}>x{orderItem.quantity}</Text>
          <Text style={styles.orderItemPrice}>
            {orderItem.discount_price}元
          </Text>
        </View>
      ))}

      <View style={styles.orderTotals}>
        <Text style={styles.detailText}>零售总价: {Number(item.total_retail_amount).toFixed(2)}元</Text>
        <Text style={styles.totalText}>折扣总价: {Number(item.total_discount_amount).toFixed(2)}元</Text>
      </View>

      <View style={styles.orderActions}>
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
    const inCart = cart.get(item.id);
    const qty = inCart?.quantity || 0;

    return (
      <View style={styles.productRow}>
        <View style={styles.productRowInfo}>
          <Text style={styles.productRowName}>{item.name}</Text>
          <Text style={styles.productRowMeta}>
            {item.city_name ? `${item.city_name} · ` : ''}
            零售价 {item.price}元 · 折扣价 {item.discount_price}元
          </Text>
        </View>
        <View style={styles.productRowActions}>
          {qty > 0 ? (
            <>
              <TouchableOpacity style={styles.qtyBtn} onPress={() => removeFromCart(item.id)}>
                <Text style={styles.qtyBtnText}>-</Text>
              </TouchableOpacity>
              <Text style={styles.qtyValue}>{qty}</Text>
            </>
          ) : null}
          <TouchableOpacity onPress={() => addToCart(item)} activeOpacity={0.85}>
            <LinearGradient colors={['#FF6B9D', '#5B8DEF']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={styles.qtyBtnAdd}>
              <Text style={styles.qtyBtnAddText}>+</Text>
            </LinearGradient>
          </TouchableOpacity>
        </View>
      </View>
    );
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>销售订单</Text>
        <View style={styles.headerActions}>
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
            <TouchableOpacity onPress={() => setModalVisible(true)} activeOpacity={0.85}>
              <LinearGradient colors={['#FF6B9D', '#5B8DEF']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={styles.addButton}>
                <Text style={styles.addButtonText}>+ 新建订单</Text>
              </LinearGradient>
            </TouchableOpacity>
          )}
        </View>
      </View>

      {isAdmin && (
        <>
          <View style={styles.filterRowSpacer} />
          <View style={styles.filterRowOverlay}>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.filterRow} contentContainerStyle={styles.filterRowContent}>
              <TouchableOpacity
                style={[styles.chip, selectedDistributorId === null && styles.chipActive]}
                onPress={() => setSelectedDistributorId(null)}
              >
                <Text
                  style={[styles.chipText, selectedDistributorId === null && styles.chipTextActive]}
                  numberOfLines={1}
                  ellipsizeMode="tail"
                >
                  全部分销商
                </Text>
              </TouchableOpacity>
              {distributors.map((d) => (
                  <TouchableOpacity
                    key={d.id}
                    style={[styles.chip, selectedDistributorId === d.id && styles.chipActive]}
                    onPress={() => setSelectedDistributorId(d.id)}
                  >
                    <Text
                      style={[styles.chipText, selectedDistributorId === d.id && styles.chipTextActive]}
                      numberOfLines={1}
                      ellipsizeMode="tail"
                    >
                      {d.store_name || d.email}
                    </Text>
                  </TouchableOpacity>
                ))}
            </ScrollView>
          </View>
        </>
      )}

      <View style={styles.monthSwitchRow}>
        <TouchableOpacity style={[styles.switchChip, monthFilter === 'current' && styles.switchChipActive]} onPress={() => setMonthFilter('current')}>
          <Text style={[styles.switchChipText, monthFilter === 'current' && styles.switchChipTextActive]}>本月</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.switchChip, monthFilter === 'all' && styles.switchChipActive]} onPress={() => setMonthFilter('all')}>
          <Text style={[styles.switchChipText, monthFilter === 'all' && styles.switchChipTextActive]}>累计</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.summary}>
        <View style={styles.summaryItem}>
          <Text style={styles.summaryValue}>{filteredOrders.length}</Text>
          <Text style={styles.summaryLabel}>订单数</Text>
        </View>
        <View style={styles.summaryItem}>
          <Text style={styles.summaryValue}>{totalRetail.toFixed(2)}元</Text>
          <Text style={styles.summaryLabel}>零售总价</Text>
        </View>
        <View style={styles.summaryItem}>
          <Text style={styles.summaryValue}>{totalDiscount.toFixed(2)}元</Text>
          <Text style={styles.summaryLabel}>折扣总价</Text>
        </View>
      </View>

      {isAdmin && (
        <View style={styles.statsCard}>
          <Text style={styles.statsTitle}>商品数量统计（同商品自动累加）</Text>
          <Text style={styles.statsSubTitle}>本月</Text>
          {monthlyTopRows.map((row, idx) => (
            <Text key={`m-${idx}`} style={[styles.statsRowText, !row && styles.statsRowPlaceholder]} numberOfLines={1} ellipsizeMode="tail">
              {row ? `${row.name}: ${row.quantity}` : '—'}
            </Text>
          ))}
          <Text style={[styles.statsSubTitle, { marginTop: 8 }]}>累计</Text>
          {cumulativeTopRows.map((row, idx) => (
            <Text key={`c-${idx}`} style={[styles.statsRowText, !row && styles.statsRowPlaceholder]} numberOfLines={1} ellipsizeMode="tail">
              {row ? `${row.name}: ${row.quantity}` : '—'}
            </Text>
          ))}
        </View>
      )}

      <View style={styles.searchContainer}>
        <Search size={18} color={Colors.textTertiary} style={styles.searchIcon} />
        <TextInput
          style={styles.searchInput}
          placeholder="搜索订单号或分销商邮箱..."
          placeholderTextColor={Colors.textTertiary}
          value={searchText}
          onChangeText={setSearchText}
        />
      </View>

      <FlatList
        data={filteredOrders}
        keyExtractor={(item) => item.id}
        renderItem={renderOrder}
        contentContainerStyle={styles.list}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.pink} />}
        ListEmptyComponent={
          <View style={styles.emptyContainer}>
            <ClipboardList size={48} color={Colors.textTertiary} strokeWidth={1.5} />
            <Text style={styles.emptyText}>暂无订单记录</Text>
          </View>
        }
      />

      <Modal visible={modalVisible} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>新建订单（合并为单条）</Text>
              <TouchableOpacity onPress={() => { clearCart(); setModalVisible(false); }}>
                <Text style={styles.modalClose}>关闭</Text>
              </TouchableOpacity>
            </View>

            <FlatList
              data={availableProducts}
              keyExtractor={(item) => item.id}
              renderItem={renderProductRow}
              style={styles.productList}
              ListEmptyComponent={
                <View style={styles.emptyContainerModal}>
                  <ShoppingBag size={40} color={Colors.textTertiary} strokeWidth={1.5} />
                  <Text style={styles.emptyText}>暂无可选商品</Text>
                </View>
              }
            />

            {cartItems.length > 0 && (
              <View style={styles.cartSummary}>
                <Text style={styles.cartLine}>件数：{cartCount}</Text>
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
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>条码出库</Text>
            <Text style={styles.modalSubtitle}>扫码枪输入条码后回车可自动识别</Text>

            <View style={styles.inputGroup}>
              <Text style={styles.inputLabel}>商品条码</Text>
              <TextInput
                style={styles.modalInput}
                value={outboundBarcode}
                onChangeText={handleOutboundBarcodeLookup}
                keyboardType="number-pad"
                autoFocus
                maxLength={13}
                placeholder="请输入13位条码"
                placeholderTextColor={Colors.textTertiary}
                onSubmitEditing={() => handleOutboundBarcodeLookup()}
              />
            </View>

            {outboundBarcode.length === 13 ? (
              <View style={styles.scanResultBox}>
                {outboundProduct ? (
                  <>
                    <Text style={styles.scanResultName}>{outboundProduct.name}</Text>
                    <Text style={styles.scanResultStock}>当前库存：{outboundProduct.quantity ?? 0}</Text>
                  </>
                ) : (
                  <Text style={styles.scanResultError}>未找到对应商品</Text>
                )}
              </View>
            ) : null}

            <View style={styles.inputGroup}>
              <Text style={styles.inputLabel}>出库数量</Text>
              <TextInput
                style={styles.modalInput}
                value={outboundQuantity}
                onChangeText={setOutboundQuantity}
                keyboardType="number-pad"
                placeholder="请输入数量"
                placeholderTextColor={Colors.textTertiary}
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
  filterRowSpacer: { height: 50 },
  filterRowOverlay: {
    position: 'absolute',
    top: 62,
    left: 0,
    right: 0,
    zIndex: 10,
    elevation: 2,
  },
  filterRow: { backgroundColor: Colors.surface, minHeight: 50 },
  filterRowContent: { paddingVertical: 8, paddingHorizontal: 10, alignItems: 'center' },
  chip: {
    width: 136,
    height: 34,
    borderRadius: 16,
    backgroundColor: Colors.surfaceSecondary,
    marginRight: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chipActive: { backgroundColor: Colors.pink },
  chipText: { color: Colors.textSecondary, fontSize: 12, fontWeight: '600', width: '100%', textAlign: 'center' },
  chipTextActive: { color: '#fff', fontWeight: '600', width: '100%', textAlign: 'center' },
  monthSwitchRow: { flexDirection: 'row', backgroundColor: Colors.surface, paddingHorizontal: 10, paddingBottom: 8 },
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
  summary: { flexDirection: 'row', backgroundColor: Colors.surface, minHeight: 70, paddingVertical: 12, marginBottom: 8, alignItems: 'center' },
  summaryItem: { flex: 1, alignItems: 'center' },
  summaryValue: { fontSize: 14, fontWeight: '700', color: Colors.pink },
  summaryLabel: { fontSize: 12, color: Colors.textSecondary, marginTop: 4 },
  statsCard: {
    backgroundColor: Colors.surface,
    borderRadius: Radius.lg,
    marginHorizontal: 10,
    marginBottom: 8,
    padding: 12,
    minHeight: 206,
    ...Shadow.card,
  },
  statsTitle: { fontSize: 13, fontWeight: '700', color: Colors.textPrimary },
  statsSubTitle: { fontSize: 12, color: Colors.textSecondary, marginTop: 6 },
  statsRowText: { fontSize: 12, color: Colors.textPrimary, marginTop: 2 },
  statsRowPlaceholder: { color: Colors.textTertiary },
  searchContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.surfaceSecondary,
    marginHorizontal: 10,
    marginBottom: 10,
    borderRadius: Radius.pill,
    paddingHorizontal: 12,
    height: 40,
  },
  searchIcon: { marginRight: 8 },
  searchInput: { flex: 1, fontSize: 14, color: Colors.textPrimary },
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
  orderDate: { fontSize: 12, color: Colors.textTertiary },
  orderMetaContainer: { flexDirection: 'row', alignItems: 'center', marginBottom: 8 },
  orderMeta: { fontSize: 12, color: Colors.textSecondary },
  orderItemRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 6 },
  orderItemName: { flex: 1, fontSize: 14, color: Colors.textPrimary },
  orderItemQty: { width: 50, textAlign: 'center', color: Colors.textSecondary, fontSize: 13 },
  orderItemPrice: { width: 85, textAlign: 'right', color: Colors.blue, fontSize: 13, fontWeight: '600' },
  orderTotals: { marginTop: 6, borderTopWidth: 1, borderTopColor: Colors.divider, paddingTop: 6 },
  detailText: { fontSize: 12, color: Colors.textSecondary },
  totalText: { fontSize: 16, fontWeight: '700', color: Colors.pink, marginTop: 3 },
  orderActions: { flexDirection: 'row', justifyContent: 'flex-end', alignItems: 'center', marginTop: 8 },
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
  cartLine: { fontSize: 13, color: Colors.textPrimary, marginBottom: 2 },
  modalButtons: { flexDirection: 'row' },
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
});
