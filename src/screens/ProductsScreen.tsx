import React, { useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  TextInput,
  Modal,
  Image,
  Alert,
  RefreshControl,
  ActionSheetIOS,
  Platform,
  ScrollView,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import * as ImagePicker from 'expo-image-picker';
import Svg, { Rect } from 'react-native-svg';
import { ImageIcon, AlertTriangle, Camera, Search, Package, MapPin } from 'lucide-react-native';
import Toast from 'react-native-toast-message';
import { useShallow } from 'zustand/react/shallow';

import { useAppStore } from '../store/useAppStore';
import { Colors, Shadow, Radius, LightColors, DarkColors } from '../theme';
import { encodeEAN13Bars } from '../utils/barcode';
import type { ProductWithDetails } from '../types';

function BarcodeSvg({ value, height = 50, barWidth = 1.5 }: { value: string; height?: number; barWidth?: number }) {
  const { bars, totalWidth } = encodeEAN13Bars(value, barWidth);
  if (bars.length === 0) return <Text style={{ color: Colors.textTertiary, fontSize: 12 }}>{value}</Text>;
  return (
    <View style={{ alignItems: 'center' }}>
      <Svg width={totalWidth} height={height}>
        {bars.map((bar) => (
          <Rect key={`${bar.x}-${bar.w}`} x={bar.x} y={0} width={bar.w} height={height} fill="#2D2D3F" />
        ))}
      </Svg>
      <Text style={{ fontSize: 11, color: Colors.textSecondary, marginTop: 3, letterSpacing: 2, fontVariant: ['tabular-nums'] }}>{value}</Text>
    </View>
  );
}

export default function ProductsScreen() {
  const {
    products,
    cities,
    distributors,
    fetchProducts,
    fetchCities,
    fetchDistributors,
    addProduct,
    updateProduct,
    deleteProduct,
    setDistributorProductDiscount,
    backfillBarcodes,
    uploadProductImage,
    user,
  } = useAppStore(
    useShallow((state) => ({
      products: state.products,
      cities: state.cities,
      distributors: state.distributors,
      fetchProducts: state.fetchProducts,
      fetchCities: state.fetchCities,
      fetchDistributors: state.fetchDistributors,
      addProduct: state.addProduct,
      updateProduct: state.updateProduct,
      deleteProduct: state.deleteProduct,
      setDistributorProductDiscount: state.setDistributorProductDiscount,
      backfillBarcodes: state.backfillBarcodes,
      uploadProductImage: state.uploadProductImage,
      user: state.user,
    })),
  );
  const [modalVisible, setModalVisible] = useState(false);
  const [editingProduct, setEditingProduct] = useState<ProductWithDetails | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [uploading, setUploading] = useState(false);

  const [name, setName] = useState('');
  const [price, setPrice] = useState('');
  const [cost, setCost] = useState('');
  const [oneTimeCost, setOneTimeCost] = useState('');
  const [discountPrice, setDiscountPrice] = useState('');
  const [selectedCity, setSelectedCity] = useState('');
  const [imageUrl, setImageUrl] = useState('');
  const [filterCityId, setFilterCityId] = useState<string | null>(null);
  const [selectedDistributorId, setSelectedDistributorId] = useState('');
  const [customDistributorDiscount, setCustomDistributorDiscount] = useState('');
  const [searchText, setSearchText] = useState('');
  const [hasPinnedOwnCity, setHasPinnedOwnCity] = useState(false);
  const isDarkMode = useAppStore((state) => state.isDarkMode);
  const theme = isDarkMode ? DarkColors : LightColors;

  const isAdminOrManager = user?.role === 'admin' || user?.role === 'inventory_manager';
  const isDistributor = user?.role === 'distributor';

  const orderedCities = useMemo(() => {
    if (!isDistributor || !user?.city_id) return cities;
    const ownCity = cities.find((city) => city.id === user.city_id);
    if (!ownCity) return cities;
    return [ownCity, ...cities.filter((city) => city.id !== ownCity.id)];
  }, [cities, isDistributor, user?.city_id]);

  const filteredProducts = products.filter((p) => {
    const matchesCity = filterCityId ? p.city_id === filterCityId : true;
    const matchesSearch = p.name.toLowerCase().includes(searchText.toLowerCase());
    return matchesCity && matchesSearch;
  });

  useEffect(() => {
    fetchCities();
    if (user?.role === 'admin') {
      fetchDistributors();
    }
  }, [fetchCities, fetchDistributors, user?.role]);

  useEffect(() => {
    if (isDistributor && user?.city_id && !hasPinnedOwnCity) {
      setFilterCityId(user.city_id);
      setHasPinnedOwnCity(true);
    }
  }, [hasPinnedOwnCity, isDistributor, user?.city_id]);

  const onRefresh = async () => {
    setRefreshing(true);
    await fetchProducts();
    setRefreshing(false);
  };

  const resetForm = () => {
    setName('');
    setPrice('');
    setCost('');
    setOneTimeCost('');
    setDiscountPrice('');
    setSelectedCity('');
    setImageUrl('');
    setEditingProduct(null);
    setSelectedDistributorId('');
    setCustomDistributorDiscount('');
  };

  const openAddModal = () => {
    resetForm();
    setModalVisible(true);
  };

  const openEditModal = (product: ProductWithDetails) => {
    if (!isAdminOrManager) {
      Toast.show({ type: 'error', text1: '权限不足', text2: '只有管理员可以编辑商品' });
      return;
    }
    setEditingProduct(product);
    setName(product.name);
    setPrice(product.price.toString());
    setCost(product.cost?.toString() || '');
    setOneTimeCost(product.one_time_cost?.toString() || '');
    setDiscountPrice(product.discount_price?.toString() || product.price?.toString() || '');
    setSelectedCity(product.city_id);
    setImageUrl(product.image_url || '');
    setModalVisible(true);
  };

  const handleSave = async () => {
    if (!name.trim() || !price || !selectedCity) {
      Toast.show({ type: 'error', text1: '错误', text2: '请填写商品名称、售价和城市' });
      return;
    }

    if (!isDistributor && !cost) {
      Toast.show({ type: 'error', text1: '错误', text2: '请填写单个成本' });
      return;
    }

    const productData = {
      name,
      price: parseFloat(price),
      cost: parseFloat(cost) || 0,
      one_time_cost: parseFloat(oneTimeCost) || 0,
      discount_price: parseFloat(discountPrice) || parseFloat(price) || 0,
      city_id: selectedCity,
      image_url: imageUrl,
    };

    let error: Error | null = null;
    if (editingProduct) {
      ({ error } = await updateProduct(editingProduct.id, productData));
    } else {
      ({ error } = await addProduct(productData));
    }

    if (error) {
      Toast.show({ type: 'error', text1: '错误', text2: error.message });
    } else {
      setModalVisible(false);
      resetForm();
    }
  };

  const handleDelete = (id: string) => {
    Alert.alert('确认删除', '确定要删除这个商品吗？', [
      { text: '取消', style: 'cancel' },
      {
        text: '删除',
        style: 'destructive',
        onPress: async () => {
          const { error } = await deleteProduct(id);
          if (error) Alert.alert('错误', error.message);
        },
      },
    ]);
  };

  const handleSaveDistributorDiscount = async () => {
    if (!editingProduct) {
      Toast.show({ type: 'error', text1: '提示', text2: '请先保存商品，再设置分销商折扣价' });
      return;
    }
    if (!selectedDistributorId) {
      Toast.show({ type: 'error', text1: '错误', text2: '请选择分销商' });
      return;
    }
    const discount = parseFloat(customDistributorDiscount);
    if (isNaN(discount) || discount < 0) {
      Toast.show({ type: 'error', text1: '错误', text2: '请输入有效折扣价' });
      return;
    }
    const { error } = await setDistributorProductDiscount(selectedDistributorId, editingProduct.id, discount);
    if (error) {
      Toast.show({ type: 'error', text1: '错误', text2: error.message });
    } else {
      Toast.show({ type: 'success', text1: '成功', text2: '分销商专属折扣价已更新' });
      setCustomDistributorDiscount('');
    }
  };

  const pickImage = async () => {
    if (Platform.OS === 'ios') {
      ActionSheetIOS.showActionSheetWithOptions(
        {
          options: ['取消', '拍照', '从相册选择'],
          cancelButtonIndex: 0,
        },
        (buttonIndex) => {
          if (buttonIndex === 1) {
            takePhoto();
          } else if (buttonIndex === 2) {
            selectFromLibrary();
          }
        }
      );
    } else {
      Alert.alert('选择图片', '请选择图片来源', [
        { text: '取消', style: 'cancel' },
        { text: '拍照', onPress: () => takePhoto() },
        { text: '从相册选择', onPress: () => selectFromLibrary() },
      ]);
    }
  };

  const takePhoto = async () => {
    const { status } = await ImagePicker.requestCameraPermissionsAsync();
    if (status !== 'granted') {
      Toast.show({ type: 'error', text1: '权限不足', text2: '需要相机权限才能拍照' });
      return;
    }

    const result = await ImagePicker.launchCameraAsync({
      allowsEditing: false,
      quality: 0.7,
    });

    if (!result.canceled && result.assets[0]) {
      await uploadImage(result.assets[0].uri);
    }
  };

  const selectFromLibrary = async () => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      Toast.show({ type: 'error', text1: '权限不足', text2: '需要相册权限才能选择图片' });
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: false,
      quality: 0.7,
    });

    if (!result.canceled && result.assets[0]) {
      await uploadImage(result.assets[0].uri);
    }
  };

  const uploadImage = async (uri: string) => {
    setUploading(true);
    try {
      const { publicUrl, error } = await uploadProductImage(uri);
      if (error) throw error;
      if (publicUrl) setImageUrl(publicUrl);
    } catch (error: unknown) {
      console.error('Upload error:', error);
      const message = error instanceof Error ? error.message : '无法上传图片';
      if (message.includes('row-level security')) {
        Toast.show({ type: 'error', text1: '上传失败', text2: '存储权限不足（RLS）。请重新登录后重试，或联系管理员执行 storage policy 脚本。' });
      } else {
        Toast.show({ type: 'error', text1: '上传失败', text2: message });
      }
    } finally {
      setUploading(false);
    }
  };

  const renderProduct = ({ item }: { item: ProductWithDetails }) => (
    <TouchableOpacity
      style={[styles.productCard, { backgroundColor: theme.surface }]}
      onPress={() => {
        if (isAdminOrManager) openEditModal(item);
      }}
      activeOpacity={isAdminOrManager ? 0.85 : 1}
      disabled={!isAdminOrManager}
    >
      <View style={[styles.productImage, { backgroundColor: theme.surfaceSecondary }]}>
        {item.image_url ? (
          <Image source={{ uri: item.image_url }} style={styles.image} />
        ) : (
          <ImageIcon size={30} color={theme.textTertiary} />
        )}
      </View>
        <View style={styles.productInfo}>
        <Text style={[styles.productName, { color: theme.textPrimary }]}>{item.name}</Text>
        <View style={styles.cityRow}>
          <MapPin size={12} color={theme.textSecondary} />
          <Text style={[styles.productCity, { color: theme.textSecondary }]}>{item.city_name}</Text>
        </View>
        <View style={styles.priceRow}>
          <Text style={styles.price}>售价: {item.price}元</Text>
        </View>
        <Text style={[styles.discountText, { color: theme.textTertiary }]}>折扣价: {item.discount_price}元</Text>
        {!isDistributor && (
          <View style={styles.stockRow}>
            <View style={[styles.stockBadge, { backgroundColor: theme.surfaceSecondary }]}>
              <Text style={[
                styles.stock,
                { color: theme.textPrimary },
                item.quantity !== undefined && item.quantity < (item.min_quantity ?? 10) && styles.lowStock
              ]}>
                库存: {item.quantity ?? 0}
              </Text>
            </View>
            {item.quantity !== undefined && item.quantity < (item.min_quantity ?? 10) && (
              <View style={styles.warning}>
                <AlertTriangle size={12} color={Colors.danger} />
                <Text style={styles.warningText}>不足</Text>
              </View>
            )}
          </View>
        )}
      </View>
    </TouchableOpacity>
  );

  return (
    <View style={[styles.container, { backgroundColor: theme.background }]}>
      <View style={[styles.header, { backgroundColor: theme.surface }]}>
        <Text style={[styles.headerTitle, { color: theme.textPrimary }]}>商品管理</Text>
        {isAdminOrManager && products.some((p) => !p.barcode) && (
          <TouchableOpacity
            onPress={async () => {
              const { count, error } = await backfillBarcodes();
              if (error) Toast.show({ type: 'error', text1: '生成失败', text2: error.message });
              else Toast.show({ type: 'success', text1: '条码生成完毕', text2: `已为 ${count} 个商品生成条码` });
            }}
            activeOpacity={0.85}
          >
            <View style={[styles.addButton, { backgroundColor: Colors.blueSoft }]}>
              <Text style={[styles.addButtonText, { color: Colors.blue }]}>生成条码</Text>
            </View>
          </TouchableOpacity>
        )}
        {isAdminOrManager && (
          <TouchableOpacity onPress={openAddModal} activeOpacity={0.85}>
            <LinearGradient
              colors={['#FF6B9D', '#5B8DEF']}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 0 }}
              style={styles.addButton}
            >
              <Text style={styles.addButtonText}>+ 添加商品</Text>
            </LinearGradient>
          </TouchableOpacity>
        )}
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
                全部
              </Text>
            </LinearGradient>
          </TouchableOpacity>
          {orderedCities.map((city) => (
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
        renderItem={renderProduct}
        numColumns={2}
        columnWrapperStyle={styles.row}
        contentContainerStyle={styles.list}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.pink} />
        }
        ListEmptyComponent={
          <View style={styles.emptyContainer}>
            <Package size={48} color={theme.textTertiary} strokeWidth={1.5} />
            <Text style={[styles.emptyText, { color: theme.textTertiary }]}>暂无商品</Text>
            <Text style={[styles.emptySubtext, { color: theme.textTertiary }]}>点击右上角添加商品</Text>
          </View>
        }
      />

      <Modal visible={modalVisible} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <ScrollView style={styles.modalScroll} contentContainerStyle={styles.modalScrollContent}>
            <View style={[styles.modalContent, { backgroundColor: theme.surface }]}>
              <Text style={[styles.modalTitle, { color: theme.textPrimary }] }>
                {editingProduct ? '编辑商品' : '添加商品'}
              </Text>

              <View style={styles.fieldRow}>
                <Text style={[styles.fieldLabel, { color: theme.textSecondary }]}>商品名称*</Text>
                <TextInput
                  style={[styles.input, styles.fieldInput, { backgroundColor: theme.surfaceSecondary, color: theme.textPrimary }]}
                  value={name}
                  onChangeText={setName}
                  placeholderTextColor={theme.textTertiary}
                />
              </View>

              <View style={styles.fieldRow}>
                <Text style={[styles.fieldLabel, { color: theme.textSecondary }]}>售价(元)*</Text>
                <TextInput
                  style={[styles.input, styles.fieldInput, { backgroundColor: theme.surfaceSecondary, color: theme.textPrimary }]}
                  value={price}
                  onChangeText={setPrice}
                  keyboardType="numeric"
                  placeholderTextColor={theme.textTertiary}
                />
              </View>

              {!isDistributor && (
                <>
                  <View style={styles.fieldRow}>
                    <Text style={[styles.fieldLabel, { color: theme.textSecondary }]}>单个成本(元)*</Text>
                    <TextInput
                      style={[styles.input, styles.fieldInput, { backgroundColor: theme.surfaceSecondary, color: theme.textPrimary }]}
                      value={cost}
                      onChangeText={setCost}
                      keyboardType="numeric"
                      placeholderTextColor={theme.textTertiary}
                    />
                  </View>
                  <View style={styles.fieldRow}>
                    <Text style={[styles.fieldLabel, { color: theme.textSecondary }]}>一次性成本(元)</Text>
                    <TextInput
                      style={[styles.input, styles.fieldInput, { backgroundColor: theme.surfaceSecondary, color: theme.textPrimary }]}
                      value={oneTimeCost}
                      onChangeText={setOneTimeCost}
                      keyboardType="numeric"
                      placeholderTextColor={theme.textTertiary}
                    />
                  </View>
                  <View style={styles.fieldRow}>
                    <Text style={[styles.fieldLabel, { color: theme.textSecondary }]}>折扣价(元)</Text>
                    <TextInput
                      style={[styles.input, styles.fieldInput, { backgroundColor: theme.surfaceSecondary, color: theme.textPrimary }]}
                      value={discountPrice}
                      onChangeText={setDiscountPrice}
                      keyboardType="numeric"
                      placeholderTextColor={theme.textTertiary}
                    />
                  </View>
                </>
              )}

              <Text style={[styles.sectionLabel, { color: theme.textSecondary }]}>选择城市 *</Text>
              <View style={styles.cityList}>
                {orderedCities.map((city) => (
                  <TouchableOpacity
                    key={city.id}
                    style={[styles.cityItem, { backgroundColor: theme.surfaceSecondary }, selectedCity === city.id && styles.cityItemSelected]}
                    onPress={() => setSelectedCity(city.id)}
                  >
                    {selectedCity === city.id ? (
                      <LinearGradient colors={['#FF6B9D', '#5B8DEF']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={styles.modalCityGradientChip}>
                        <Text style={styles.cityItemTextSelected}>{city.name}</Text>
                      </LinearGradient>
                    ) : (
                      <Text style={[styles.cityItemText, { color: theme.textSecondary }]}>{city.name}</Text>
                    )}
                  </TouchableOpacity>
                ))}
              </View>

              <TouchableOpacity 
                style={[styles.imageButton, uploading && styles.imageButtonDisabled]} 
                onPress={pickImage}
                disabled={uploading}
              >
                {uploading ? (
                  <Text style={styles.imageButtonText}>上传中...</Text>
                ) : imageUrl ? (
                  <Text style={styles.imageButtonText}>更换图片</Text>
                ) : (
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                    <Camera size={16} color={Colors.pink} />
                    <Text style={styles.imageButtonText}>添加图片</Text>
                  </View>
                )}
              </TouchableOpacity>

              {imageUrl && (
                <Image source={{ uri: imageUrl }} style={styles.previewImage} />
              )}

              {editingProduct?.barcode ? (
                <View style={[styles.barcodeSection, { backgroundColor: theme.surfaceSecondary }]}>
                  <Text style={[styles.sectionLabel, { color: theme.textSecondary }]}>商品条码</Text>
                  <BarcodeSvg value={editingProduct.barcode} height={60} barWidth={1.5} />
                </View>
              ) : null}

              <View style={styles.modalButtons}>
                <TouchableOpacity
                  style={[styles.cancelButton, { borderColor: theme.border }]}
                  onPress={() => {
                    setModalVisible(false);
                    resetForm();
                  }}
                >
                  <Text style={[styles.cancelButtonText, { color: theme.textSecondary }]}>取消</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={handleSave} activeOpacity={0.85} style={styles.saveButtonWrap}>
                  <LinearGradient
                    colors={['#FF6B9D', '#5B8DEF']}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 0 }}
                    style={styles.saveButton}
                  >
                    <Text style={styles.saveButtonText}>保存</Text>
                  </LinearGradient>
                </TouchableOpacity>
              </View>

              {editingProduct && isAdminOrManager && (
                <TouchableOpacity
                  style={styles.deleteButton}
                  onPress={() => {
                    setModalVisible(false);
                    handleDelete(editingProduct.id);
                  }}
                >
                  <Text style={styles.deleteButtonText}>删除商品</Text>
                </TouchableOpacity>
              )}

              {editingProduct && user?.role === 'admin' && (
                <View style={[styles.distributorDiscountBox, { borderTopColor: theme.divider }] }>
                  <Text style={[styles.sectionLabel, { color: theme.textSecondary }]}>分销商专属折扣价(元)</Text>
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.cityFilterRow}>
                    {distributors.map((d) => (
                      <TouchableOpacity
                        key={d.id}
                        style={[styles.cityItem, { backgroundColor: theme.surfaceSecondary }, selectedDistributorId === d.id && styles.cityItemSelected]}
                        onPress={() => setSelectedDistributorId(d.id)}
                      >
                        <Text style={[styles.cityItemText, { color: theme.textSecondary }, selectedDistributorId === d.id && styles.cityItemTextSelected]}>
                          {d.store_name || d.email}
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </ScrollView>
                  <View style={styles.distributorDiscountRow}>
                    <TextInput
                      style={[styles.input, styles.distributorDiscountInput, { backgroundColor: theme.surfaceSecondary, color: theme.textPrimary }]}
                      placeholder="输入专属折扣价(元)"
                      value={customDistributorDiscount}
                      onChangeText={setCustomDistributorDiscount}
                      keyboardType="numeric"
                      placeholderTextColor={theme.textTertiary}
                    />
                    <TouchableOpacity onPress={handleSaveDistributorDiscount} style={styles.distributorSaveBtn}>
                      <Text style={styles.distributorSaveBtnText}>保存</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              )}
            </View>
          </ScrollView>
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
  addButton: {
    paddingHorizontal: 16,
    paddingVertical: 9,
    borderRadius: Radius.xl,
  },
  addButtonText: {
    color: '#fff',
    fontWeight: '600',
    fontSize: 14,
  },
  cityFilterSpacer: {
    height: 68,
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
  list: {
    padding: 10,
  },
  row: {
    justifyContent: 'space-between',
  },
  productCard: {
    width: '48%',
    backgroundColor: Colors.surface,
    borderRadius: Radius.lg,
    marginBottom: 15,
    overflow: 'hidden',
    ...Shadow.card,
  },
  productImage: {
    width: '100%',
    aspectRatio: 1,
    backgroundColor: Colors.surfaceSecondary,
    justifyContent: 'center',
    alignItems: 'center',
  },
  image: {
    width: '100%',
    height: '100%',
  },
  placeholderImage: {
    fontSize: 30,
  },
  productInfo: {
    padding: 10,
  },
  productName: {
    fontSize: 15,
    fontWeight: '700',
    marginBottom: 4,
    color: Colors.textPrimary,
  },
  cityRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 6,
    gap: 2,
  },
  productCity: {
    fontSize: 11,
    color: Colors.textSecondary,
  },
  priceRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  price: {
    fontSize: 16,
    fontWeight: 'bold',
    color: Colors.pink,
  },
  cost: {
    fontSize: 11,
    color: Colors.textTertiary,
  },
  barcodeText: {
    fontSize: 10,
    color: Colors.textTertiary,
    marginTop: 2,
    fontVariant: ['tabular-nums'],
    letterSpacing: 0.5,
  },
  discountText: {
    fontSize: 12,
    color: Colors.textTertiary,
    marginBottom: 4,
  },
  stockRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 4,
  },
  stockBadge: {
    backgroundColor: Colors.surfaceSecondary,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: Radius.sm,
  },
  stock: {
    fontSize: 12,
    color: Colors.textPrimary,
    fontWeight: '500',
  },
  lowStock: {
    color: Colors.danger,
  },
  warning: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
  },
  warningText: {
    fontSize: 10,
    color: Colors.danger,
    fontWeight: '600',
  },
  searchContainer: {
    backgroundColor: Colors.surfaceSecondary,
    borderRadius: 999,
    marginHorizontal: 10,
    marginTop: 8,
    marginBottom: 8,
    flexDirection: 'row',
    alignItems: 'center',
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
  emptyText: {
    textAlign: 'center',
    color: Colors.textTertiary,
    marginTop: 12,
    fontSize: 15,
    fontWeight: '500',
  },
  emptySubtext: {
    fontSize: 13,
    color: Colors.textTertiary,
    marginTop: 4,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(45,45,63,0.4)',
    justifyContent: 'flex-end',
  },
  modalScroll: {
    maxHeight: '85%',
  },
  modalScrollContent: {
    flexGrow: 1,
    justifyContent: 'flex-end',
  },
  modalContent: {
    backgroundColor: Colors.surface,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    padding: 24,
  },
  modalTitle: {
    fontSize: 22,
    fontWeight: '700',
    marginBottom: 20,
    textAlign: 'center',
    color: Colors.textPrimary,
  },
  input: {
    height: 50,
    borderWidth: 0,
    borderRadius: Radius.lg,
    paddingHorizontal: 16,
    marginBottom: 12,
    fontSize: 16,
    backgroundColor: Colors.surfaceSecondary,
    color: Colors.textPrimary,
  },
  sectionLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: Colors.textSecondary,
    marginBottom: 8,
    marginTop: 4,
  },
  fieldRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 10,
  },
  fieldLabel: {
    width: 96,
    fontSize: 13,
    color: Colors.textSecondary,
    fontWeight: '600',
  },
  fieldInput: {
    flex: 1,
    marginBottom: 0,
  },
  cityList: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginBottom: 15,
  },
  cityItem: {
    borderRadius: Radius.xl,
    backgroundColor: Colors.surfaceSecondary,
    marginRight: 8,
    marginBottom: 8,
    overflow: 'hidden',
  },
  cityItemSelected: {
    backgroundColor: 'transparent',
  },
  modalCityGradientChip: {
    borderRadius: Radius.xl,
    paddingHorizontal: 15,
    paddingVertical: 8,
    justifyContent: 'center',
    alignItems: 'center',
  },
  cityItemText: {
    fontSize: 14,
    color: Colors.textSecondary,
    paddingHorizontal: 15,
    paddingVertical: 8,
  },
  cityItemTextSelected: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
  },
  imageButton: {
    height: 48,
    borderWidth: 1.5,
    borderColor: Colors.pink,
    borderRadius: Radius.lg,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 15,
    borderStyle: 'dashed',
  },
  imageButtonDisabled: {
    opacity: 0.5,
    borderColor: Colors.border,
  },
  imageButtonText: {
    color: Colors.pink,
    fontSize: 15,
    fontWeight: '500',
  },
  previewImage: {
    width: 80,
    height: 80,
    borderRadius: Radius.md,
    alignSelf: 'center',
    marginBottom: 15,
  },
  barcodeSection: {
    backgroundColor: '#fff',
    borderRadius: Radius.lg,
    paddingVertical: 12,
    paddingHorizontal: 10,
    alignItems: 'center',
    marginBottom: 15,
    ...Shadow.soft,
  },
  modalButtons: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  cancelButton: {
    flex: 1,
    height: 48,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 10,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: Radius.lg,
  },
  cancelButtonText: {
    fontSize: 16,
    color: Colors.textSecondary,
  },
  saveButtonWrap: {
    flex: 1,
    borderRadius: Radius.lg,
    overflow: 'hidden',
  },
  saveButton: {
    height: 48,
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: Radius.lg,
  },
  saveButtonText: {
    fontSize: 16,
    color: '#fff',
    fontWeight: '600',
  },
  deleteButton: {
    marginTop: 15,
    height: 48,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: Colors.danger,
    borderRadius: Radius.lg,
  },
  deleteButtonText: {
    fontSize: 16,
    color: Colors.danger,
  },
  distributorDiscountBox: {
    marginTop: 14,
    borderTopWidth: 1,
    borderTopColor: Colors.divider,
    paddingTop: 12,
  },
  distributorDiscountRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  distributorDiscountInput: {
    flex: 1,
    marginBottom: 0,
    marginRight: 8,
  },
  distributorSaveBtn: {
    height: 50,
    paddingHorizontal: 12,
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: Radius.md,
    backgroundColor: Colors.blue,
  },
  distributorSaveBtnText: {
    color: '#fff',
    fontWeight: '600',
    fontSize: 13,
  },
});
