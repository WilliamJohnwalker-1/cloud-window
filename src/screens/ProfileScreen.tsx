import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Alert,
  Modal,
  TextInput,
  FlatList,
  ScrollView,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { User, MapPin, Users, WifiOff, Bell, Info, PackagePlus, CheckCircle2 } from 'lucide-react-native';
import Toast from 'react-native-toast-message';
import { useShallow } from 'zustand/react/shallow';

import { useAppStore } from '../store/useAppStore';
import { Colors, Radius } from '../theme';
import type { Notification } from '../types';

export default function ProfileScreen() {
  const {
    user,
    signOut,
    setOfflineMode,
    isOfflineMode,
    cities,
    distributors,
    notifications,
    orders,
    fetchCities,
    fetchDistributors,
    fetchNotifications,
    addCity,
    deleteCity,
    updateDistributorProfile,
    updateOwnStoreName,
    acceptOrder,
    markNotificationRead,
    markAllNotificationsRead,
  } = useAppStore(
    useShallow((state) => ({
      user: state.user,
      signOut: state.signOut,
      setOfflineMode: state.setOfflineMode,
      isOfflineMode: state.isOfflineMode,
      cities: state.cities,
      distributors: state.distributors,
      notifications: state.notifications,
      orders: state.orders,
      fetchCities: state.fetchCities,
      fetchDistributors: state.fetchDistributors,
      fetchNotifications: state.fetchNotifications,
      addCity: state.addCity,
      deleteCity: state.deleteCity,
      updateDistributorProfile: state.updateDistributorProfile,
      updateOwnStoreName: state.updateOwnStoreName,
      acceptOrder: state.acceptOrder,
      markNotificationRead: state.markNotificationRead,
      markAllNotificationsRead: state.markAllNotificationsRead,
    })),
  );

  const [cityModalVisible, setCityModalVisible] = useState(false);
  const [distributorModalVisible, setDistributorModalVisible] = useState(false);
  const [profileModalVisible, setProfileModalVisible] = useState(false);
  const [notificationModalVisible, setNotificationModalVisible] = useState(false);
  const [newCityName, setNewCityName] = useState('');
  const [editingDistributorId, setEditingDistributorId] = useState<string | null>(null);
  const [editCityId, setEditCityId] = useState('');
  const [editStoreName, setEditStoreName] = useState('');
  const [ownStoreName, setOwnStoreName] = useState(user?.store_name || '');
  const [savingOwnStore, setSavingOwnStore] = useState(false);

  const isAdmin = user?.role === 'admin';
  const isDistributor = user?.role === 'distributor';
  const unreadCount = notifications.filter((n) => !n.is_read).length;

  useEffect(() => {
    fetchCities();
    if (isAdmin) fetchDistributors();
    fetchNotifications();
  }, []);

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
    Alert.alert('确认退出', '确定要退出登录吗？', [
      { text: '取消', style: 'cancel' },
      {
        text: '退出',
        style: 'destructive',
        onPress: async () => {
          await signOut();
        },
      },
    ]);
  };

  const getRoleName = (role: string) => {
    switch (role) {
      case 'admin': return '管理员';
      case 'distributor': return '分销商';
      case 'inventory_manager': return '库存管理员';
      default: return role;
    }
  };

  const menuItems = [
    { IconComponent: User, label: '个人信息', onPress: () => setProfileModalVisible(true) },
    ...(isAdmin
      ? [
          { IconComponent: MapPin, label: '城市管理', onPress: () => setCityModalVisible(true) },
          { IconComponent: Users, label: '分销商管理', onPress: () => setDistributorModalVisible(true) },
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
    { IconComponent: Info, label: '关于', onPress: () => {} },
  ];

  const renderNotification = ({ item }: { item: Notification }) => {
    const isNewOrder = item.type === 'new_order';
    const orderObj = isNewOrder ? orders.find((o) => o.id === item.order_id) : null;
    const alreadyAccepted = orderObj?.status === 'accepted';

    return (
      <View style={[styles.notifRow, !item.is_read && styles.notifUnread]}>
        <View style={styles.notifIcon}>
          {isNewOrder ? (
            <PackagePlus size={18} color={Colors.pink} />
          ) : (
            <CheckCircle2 size={18} color={Colors.success} />
          )}
        </View>
        <View style={styles.notifContent}>
          <Text style={styles.notifMessage}>{item.message}</Text>
          <Text style={styles.notifTime}>{new Date(item.created_at).toLocaleString('zh-CN')}</Text>
        </View>
        {isNewOrder && isAdmin && !alreadyAccepted && item.order_id && (
          <TouchableOpacity
            style={styles.acceptBtn}
            onPress={() => handleAcceptOrder(item.order_id!, item.id)}
          >
            <Text style={styles.acceptBtnText}>接单</Text>
          </TouchableOpacity>
        )}
        {isNewOrder && alreadyAccepted && (
          <View style={styles.acceptedBadge}>
            <Text style={styles.acceptedBadgeText}>已接单</Text>
          </View>
        )}
        {!isNewOrder && (
          <View style={styles.acceptedBadge}>
            <Text style={styles.acceptedBadgeText}>已接单</Text>
          </View>
        )}
      </View>
    );
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.scrollContent}>
      <LinearGradient
        colors={['#FF6B9D', '#C77DFF', '#5B8DEF']}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={styles.profileCardGradient}
      >
        <View style={styles.avatarRing}>
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>
              {user?.full_name?.charAt(0) || user?.email?.charAt(0) || 'U'}
            </Text>
          </View>
        </View>
        <Text style={styles.emailWhite}>{user?.email}</Text>
        {user?.city_name ? <Text style={styles.subInfoWhite}>{user.city_name}{user?.store_name ? ` · ${user.store_name}` : ''}</Text> : null}
        <View style={styles.roleBadgeWhite}>
          <Text style={styles.roleTextWhite}>{getRoleName(user?.role || '')}</Text>
        </View>
      </LinearGradient>

      <View style={styles.menu}>
        {menuItems.map((item, index) => (
          <TouchableOpacity
            key={index}
            style={[styles.menuItem, index === menuItems.length - 1 && styles.menuItemLast]}
            onPress={item.onPress}
            activeOpacity={0.7}
          >
            <View style={styles.menuIcon}>
              <item.IconComponent size={22} color={Colors.blue} strokeWidth={2} />
            </View>
            <Text style={styles.menuText}>{item.label}</Text>
            {item.IconComponent === Bell && unreadCount > 0 && (
              <View style={styles.badge}>
                <Text style={styles.badgeText}>{unreadCount > 99 ? '99+' : unreadCount}</Text>
              </View>
            )}
            <Text style={styles.menuArrow}>›</Text>
          </TouchableOpacity>
        ))}
      </View>

      <TouchableOpacity style={styles.logoutButton} onPress={handleSignOut} activeOpacity={0.85}>
        <Text style={styles.logoutText}>退出登录</Text>
      </TouchableOpacity>

      <Text style={styles.version}>版本 2.0.0</Text>

      {/* Personal Info Modal */}
      <Modal visible={profileModalVisible} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>个人信息</Text>
              <TouchableOpacity onPress={() => setProfileModalVisible(false)}>
                <Text style={styles.closeButton}>关闭</Text>
              </TouchableOpacity>
            </View>

            <View style={styles.infoRow}>
              <Text style={styles.infoLabel}>邮箱</Text>
              <Text style={styles.infoValue}>{user?.email}</Text>
            </View>
            <View style={styles.infoRow}>
              <Text style={styles.infoLabel}>角色</Text>
              <Text style={styles.infoValue}>{getRoleName(user?.role || '')}</Text>
            </View>
            <View style={styles.infoRow}>
              <Text style={styles.infoLabel}>归属城市</Text>
              <Text style={styles.infoValue}>{user?.city_name || '未设置'}</Text>
            </View>

            {isDistributor && (
              <>
                <Text style={styles.editSectionLabel}>修改店面名称</Text>
                <TextInput
                  style={styles.storeNameInput}
                  value={ownStoreName}
                  onChangeText={setOwnStoreName}
                  placeholder="输入新店面名称"
                  placeholderTextColor={Colors.textTertiary}
                />
                <TouchableOpacity
                  style={[styles.saveOwnBtn, savingOwnStore && styles.disabledBtn]}
                  onPress={handleSaveOwnStore}
                  disabled={savingOwnStore}
                >
                  <Text style={styles.saveOwnBtnText}>{savingOwnStore ? '保存中...' : '保存'}</Text>
                </TouchableOpacity>
              </>
            )}

            {!isDistributor && (
              <View style={styles.infoRow}>
                <Text style={styles.infoLabel}>店面</Text>
                <Text style={styles.infoValue}>{user?.store_name || '-'}</Text>
              </View>
            )}
          </View>
        </View>
      </Modal>

      {/* Notifications Modal */}
      <Modal visible={notificationModalVisible} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>通知</Text>
              <TouchableOpacity onPress={() => setNotificationModalVisible(false)}>
                <Text style={styles.closeButton}>关闭</Text>
              </TouchableOpacity>
            </View>

            <FlatList
              data={notifications}
              keyExtractor={(item) => item.id}
              renderItem={renderNotification}
              ListEmptyComponent={<Text style={styles.emptyCityText}>暂无通知</Text>}
              style={styles.cityList}
            />
          </View>
        </View>
      </Modal>

      {/* City Management Modal */}
      <Modal visible={cityModalVisible} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>城市管理</Text>
              <TouchableOpacity onPress={() => setCityModalVisible(false)}>
                <Text style={styles.closeButton}>关闭</Text>
              </TouchableOpacity>
            </View>
            <View style={styles.addCityRow}>
              <TextInput
                style={styles.cityInput}
                placeholder="输入新城市名称"
                placeholderTextColor={Colors.textTertiary}
                value={newCityName}
                onChangeText={setNewCityName}
              />
              <TouchableOpacity onPress={handleAddCity} activeOpacity={0.85}>
                <LinearGradient
                  colors={['#FF6B9D', '#5B8DEF']}
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
                <View style={styles.cityRow}>
                  <Text style={styles.cityName}>{item.name}</Text>
                  <TouchableOpacity onPress={() => handleDeleteCity(item.id, item.name)}>
                    <Text style={styles.deleteCityText}>删除</Text>
                  </TouchableOpacity>
                </View>
              )}
              ListEmptyComponent={<Text style={styles.emptyCityText}>暂无城市</Text>}
              style={styles.cityList}
            />
          </View>
        </View>
      </Modal>

      {/* Distributor Management Modal */}
      <Modal visible={distributorModalVisible} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>分销商管理</Text>
              <TouchableOpacity onPress={() => setDistributorModalVisible(false)}>
                <Text style={styles.closeButton}>关闭</Text>
              </TouchableOpacity>
            </View>

            {editingDistributorId ? (
              <View style={styles.editorBox}>
                <Text style={styles.editorTitle}>修改归属城市</Text>
                <Text style={styles.editorHint}>选择城市（店面可留空保持不变）</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.cityChipsWrap}>
                  {cities.map((city) => (
                    <TouchableOpacity
                      key={city.id}
                      style={[styles.cityChip, editCityId === city.id && styles.cityChipActive]}
                      onPress={() => setEditCityId(city.id)}
                    >
                      <Text style={[styles.cityChipText, editCityId === city.id && styles.cityChipTextActive]}>{city.name}</Text>
                    </TouchableOpacity>
                  ))}
                </ScrollView>
                <TextInput
                  style={styles.cityInput}
                  placeholder="店面（留空则不修改）"
                  value={editStoreName}
                  onChangeText={setEditStoreName}
                  placeholderTextColor={Colors.textTertiary}
                />
                <View style={styles.editActions}>
                  <TouchableOpacity style={styles.smallBtn} onPress={() => setEditingDistributorId(null)}>
                    <Text style={styles.smallBtnText}>取消</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={[styles.smallBtn, styles.smallBtnPrimary]} onPress={handleSaveDistributor}>
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
                  style={styles.cityRow}
                  onPress={() => openEditDistributor(item.id, item.city_id, item.store_name)}
                >
                  <View>
                    <Text style={styles.cityName}>{item.email}</Text>
                    <Text style={styles.distributorSubText}>
                      {item.city_name || '未设置城市'} · {item.store_name || '未设置店面'}
                    </Text>
                  </View>
                  <Text style={styles.closeButton}>编辑</Text>
                </TouchableOpacity>
              )}
              ListEmptyComponent={<Text style={styles.emptyCityText}>暂无分销商</Text>}
              style={styles.cityList}
            />
          </View>
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
    width: 92,
    height: 92,
    borderRadius: 46,
    backgroundColor: 'rgba(255,255,255,0.25)',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 14,
  },
  avatar: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: 'rgba(255,255,255,0.35)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  avatarText: { fontSize: 32, color: '#fff', fontWeight: '800' },
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
  modalOverlay: { flex: 1, backgroundColor: 'rgba(45,45,63,0.4)', justifyContent: 'flex-end' },
  modalContent: {
    backgroundColor: Colors.surface,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    padding: 20,
    maxHeight: '75%',
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 20,
  },
  modalTitle: { fontSize: 22, fontWeight: '700', color: Colors.textPrimary },
  closeButton: { fontSize: 16, color: Colors.pink, fontWeight: '500' },
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
    marginRight: 10,
    backgroundColor: Colors.surfaceSecondary,
    color: Colors.textPrimary,
  },
  addCityButton: { width: 70, height: 48, justifyContent: 'center', alignItems: 'center', borderRadius: Radius.md },
  addCityButtonText: { color: '#fff', fontWeight: '600', fontSize: 16 },
  cityList: { maxHeight: 300 },
  cityRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: Colors.divider,
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
});
