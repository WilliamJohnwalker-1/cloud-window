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
  Switch,
  Image,
  Linking,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import Constants from 'expo-constants';
import * as Updates from 'expo-updates';
import { User, MapPin, Users, WifiOff, Bell, Info, PackagePlus, CheckCircle2, Moon, Sun } from 'lucide-react-native';
import Toast from 'react-native-toast-message';
import { useShallow } from 'zustand/react/shallow';

import { useAppStore } from '../store/useAppStore';
import AppConfirmModal from '../components/AppConfirmModal';
import { avatarLibrary } from '../constants/avatarLibrary';
import { Colors, LightColors, DarkColors, Radius, Shadow } from '../theme';
import type { Notification } from '../types';

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
    fetchCities,
    fetchDistributors,
    fetchNotifications,
    addCity,
    deleteCity,
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
      fetchCities: state.fetchCities,
      fetchDistributors: state.fetchDistributors,
      fetchNotifications: state.fetchNotifications,
      addCity: state.addCity,
      deleteCity: state.deleteCity,
      updateDistributorProfile: state.updateDistributorProfile,
      updateOwnStoreName: state.updateOwnStoreName,
      updateOwnAvatar: state.updateOwnAvatar,
      acceptOrder: state.acceptOrder,
      markNotificationRead: state.markNotificationRead,
      markAllNotificationsRead: state.markAllNotificationsRead,
    })),
  );

  const [cityModalVisible, setCityModalVisible] = useState(false);
  const [distributorModalVisible, setDistributorModalVisible] = useState(false);
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

  const theme = isDarkMode ? DarkColors : LightColors;
  const appVersion = Constants.expoConfig?.version || '未知版本';
  const isAdmin = user?.role === 'admin';
  const isDistributor = user?.role === 'distributor';
  const unreadCount = notifications.filter((n) => !n.is_read).length;

  const compareVersion = (current: string, target: string): number => {
    const normalize = (value: string): number[] => value
      .split('-')[0]
      .split('.')
      .map((item) => Number.parseInt(item, 10))
      .map((item) => (Number.isFinite(item) ? item : 0));

    const a = normalize(current);
    const b = normalize(target);
    const maxLen = Math.max(a.length, b.length);

    for (let i = 0; i < maxLen; i += 1) {
      const left = a[i] || 0;
      const right = b[i] || 0;
      if (left > right) return 1;
      if (left < right) return -1;
    }

    return 0;
  };

  const resolveBinaryUpdateInfo = async (): Promise<{ latestVersion: string; androidApkUrl: string } | null> => {
    const binaryExtra = Constants.expoConfig?.extra?.binaryUpdate as {
      manifestUrl?: string;
      androidApkUrl?: string;
      androidApkVersion?: string;
    } | undefined;

    const manifestUrl = binaryExtra?.manifestUrl?.trim();
    const paymentApiBaseUrl = process.env.EXPO_PUBLIC_PAYMENT_API_URL?.trim();
    const effectiveManifestUrl = manifestUrl
      || (paymentApiBaseUrl ? `${paymentApiBaseUrl.replace(/\/$/, '')}/mobile/latest.json` : '');
    const fallbackApkUrl = binaryExtra?.androidApkUrl?.trim();
    const fallbackApkVersion = binaryExtra?.androidApkVersion?.trim();

    if (effectiveManifestUrl) {
      const response = await fetch(effectiveManifestUrl);
      if (!response.ok) {
        throw new Error(`二进制更新清单请求失败（${response.status}）`);
      }

      const data = await response.json() as {
        latestVersion?: string;
        androidApkUrl?: string;
      };

      const latestVersion = data.latestVersion?.trim();
      const androidApkUrl = data.androidApkUrl?.trim();
      if (latestVersion && androidApkUrl) {
        return { latestVersion, androidApkUrl };
      }
    }

    if (fallbackApkUrl && fallbackApkVersion) {
      return {
        latestVersion: fallbackApkVersion,
        androidApkUrl: fallbackApkUrl,
      };
    }

    return null;
  };

  useEffect(() => {
    fetchCities();
    if (isAdmin) fetchDistributors();
    fetchNotifications();
  }, [isAdmin, fetchCities, fetchDistributors, fetchNotifications]);

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
      case 'distributor': return '分销商';
      case 'inventory_manager': return '库存管理员';
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
    const orderObj = isNewOrder ? orders.find((o) => o.id === item.order_id) : null;
    const alreadyAccepted = orderObj?.status === 'accepted';

    return (
      <View style={[styles.notifRow, !item.is_read && { backgroundColor: isDarkMode ? theme.blueBg : theme.pinkBg }, { borderBottomColor: theme.divider }]}>
        <View style={[styles.notifIcon, { backgroundColor: theme.surfaceSecondary }]}>
          {isNewOrder ? (
            <PackagePlus size={18} color={theme.pink} />
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
        {!isNewOrder && (
          <View style={[styles.acceptedBadge, { backgroundColor: theme.successBg }]}>
            <Text style={[styles.acceptedBadgeText, { color: theme.success }]}>已接单</Text>
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
          <View style={[styles.modalContent, { backgroundColor: theme.surface }]}>
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
            />
          </View>
        </View>
      </Modal>

      {/* City Management Modal */}
      <Modal visible={cityModalVisible} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, { backgroundColor: theme.surface }]}>
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
                  <TouchableOpacity onPress={() => handleDeleteCity(item.id, item.name)}>
                    <Text style={styles.deleteCityText}>删除</Text>
                  </TouchableOpacity>
                </View>
              )}
              ListEmptyComponent={<Text style={[styles.emptyCityText, { color: theme.textTertiary }]}>暂无城市</Text>}
              style={styles.cityList}
            />
          </View>
        </View>
      </Modal>

      {/* Distributor Management Modal */}
      <Modal visible={distributorModalVisible} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, { backgroundColor: theme.surface }]}>
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
