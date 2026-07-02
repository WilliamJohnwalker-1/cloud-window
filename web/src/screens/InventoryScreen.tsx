import React from 'react';
import { AlertTriangle, Check, History, Minus, Pencil, Plus, ScanLine, ShoppingCart, X } from 'lucide-react';
import { motion } from 'framer-motion';
import { ProvinceCityFilter } from '../components/ProvinceCityFilter';
import { useAppStore } from '../store/useAppStore';
import { useSupplierStore } from '../store/useSupplierStore';
import { getProvinceForCity } from '../utils/provinceMapping';

export const InventoryScreen: React.FC = () => {
  const { user, cities, products, updateInventoryByProduct, updateInventoryMinQuantityByProduct, updateStoreInventoryByProduct, inboundStockByBarcode, createPurchaseOrderV2, inventoryLogs, stores, storeInventory, fetchStores, fetchStoreInventory } = useAppStore();
  const [showLogs, setShowLogs] = React.useState(false);
  const [editingProductId, setEditingProductId] = React.useState<string | null>(null);
  const [editingQuantityText, setEditingQuantityText] = React.useState('');
  const [cityFilter, setCityFilter] = React.useState<string>('all');
  const [provinceFilter, setProvinceFilter] = React.useState<string | null>(null);
  const [showWarningOnly, setShowWarningOnly] = React.useState(false);
  const [viewMode, setViewMode] = React.useState<'main' | 'store'>('main');
  const [selectedStoreProvinceId, setSelectedStoreProvinceId] = React.useState<string | null>(null);
  const [selectedStoreCityId, setSelectedStoreCityId] = React.useState<string | null>(null);
  const [selectedStoreId, setSelectedStoreId] = React.useState<string | null>(null);
  const [pageNotice, setPageNotice] = React.useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [manualStoreEdit, setManualStoreEdit] = React.useState<{
    storeId: string;
    productId: string;
    productName: string;
    quantityText: string;
  } | null>(null);
  const [editingThresholdProductId, setEditingThresholdProductId] = React.useState<string | null>(null);
  const [editingThresholdText, setEditingThresholdText] = React.useState('');
  const [showPurchaseModal, setShowPurchaseModal] = React.useState(false);
  const [purchaseStoreId, setPurchaseStoreId] = React.useState<string | null>(null);
  const [purchaseSupplierId, setPurchaseSupplierId] = React.useState<string | null>(null);
  const [purchaseSearchKeyword, setPurchaseSearchKeyword] = React.useState('');
  const [purchaseCart, setPurchaseCart] = React.useState<Map<string, number>>(new Map());
  const [submittingPurchase, setSubmittingPurchase] = React.useState(false);

  const isAdminOrManager = user?.role === 'admin' || user?.role === 'super_admin' || user?.role === 'inventory_manager';
  const isSuperAdmin = user?.role === 'super_admin';
  const canPurchase = user?.role === 'admin' || user?.role === 'super_admin';
  const getInventoryLogActionLabel = (action: string): string => {
    if (action === 'breakage') return '报损';
    if (action === 'purchase_receive') return '采购入库';
    if (action === 'sell') return '销售出库';
    if (action === 'refund_restore') return '退款恢复';
    if (action === 'outbound') return '出库/供货';
    if (action === 'inbound') return '扫码入库';
    if (action === 'manual_adjust') return '手工调整';
    if (action === 'quick_add') return '快捷加库存';
    if (action === 'quick_reduce') return '快捷减库存';
    return action;
  };
  const { suppliers, fetchSuppliers } = useSupplierStore();

  React.useEffect(() => {
    if (isAdminOrManager) {
      fetchStores();
    }
  }, [isAdminOrManager, fetchStores]);

  React.useEffect(() => {
    if (viewMode === 'store' && selectedStoreId) {
      fetchStoreInventory(selectedStoreId);
    }
  }, [viewMode, selectedStoreId, fetchStoreInventory]);

  React.useEffect(() => {
    if (!showPurchaseModal || !canPurchase) return;
    void fetchSuppliers();
  }, [canPurchase, fetchSuppliers, showPurchaseModal]);

  const storeFilterCities = React.useMemo(
    () => cities.filter((city) => stores.some((store) => store.city_id === city.id)),
    [cities, stores],
  );

  const storeCityProvinceMap = React.useMemo(
    () => new Map(storeFilterCities.map((city) => [city.id, city.province || getProvinceForCity(city.name) || null])),
    [storeFilterCities],
  );

  const activeStoresForFilter = React.useMemo(
    () => stores.filter((store) => {
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
    }),
    [selectedStoreCityId, selectedStoreProvinceId, storeCityProvinceMap, stores],
  );

  React.useEffect(() => {
    if (viewMode !== 'store') return;
    if (activeStoresForFilter.length === 0) {
      setSelectedStoreId(null);
      return;
    }
    if (!selectedStoreId || !activeStoresForFilter.some((store) => store.id === selectedStoreId)) {
      setSelectedStoreId(activeStoresForFilter[0].id);
    }
  }, [activeStoresForFilter, selectedStoreId, viewMode]);

  const filteredStoreInventory = React.useMemo(() => {
    if (viewMode !== 'store' || !selectedStoreId) return [];
    return storeInventory.map(inv => {
      const product = products.find(p => p.id === inv.product_id);
      return {
        ...inv,
        product
      };
    });
  }, [viewMode, selectedStoreId, storeInventory, products]);
  const cityFilteredProducts = React.useMemo(() => {
    const cityProvinceMap = new Map(
      cities.map((city) => [city.id, city.province || getProvinceForCity(city.name) || null])
    );

    const provinceFiltered = provinceFilter
      ? products.filter((item) => {
          const province = cityProvinceMap.get(item.city_id) || getProvinceForCity(item.city_name || '');
          return provinceFilter === '未知省份' ? !province : province === provinceFilter;
        })
      : products;

    if (cityFilter === 'all') return provinceFiltered;
    return provinceFiltered.filter((item) => item.city_id === cityFilter);
  }, [cities, cityFilter, products, provinceFilter]);

  const lowStockCount = cityFilteredProducts.filter((item) => Number(item.quantity || 0) < Number(item.min_quantity ?? 10)).length;

  const filteredProducts = React.useMemo(() => {
    if (!showWarningOnly) return cityFilteredProducts;
    return cityFilteredProducts.filter((item) => Number(item.quantity || 0) < Number(item.min_quantity ?? 10));
  }, [cityFilteredProducts, showWarningOnly]);

  const currentTotalStock = React.useMemo(() => {
    return viewMode === 'main'
      ? cityFilteredProducts.reduce((sum, p) => sum + Number(p.quantity || 0), 0)
      : filteredStoreInventory.reduce((sum, item) => sum + Number(item.quantity || 0), 0);
  }, [viewMode, cityFilteredProducts, filteredStoreInventory]);

  const totalCostValue = React.useMemo(() => {
    return viewMode === 'main'
      ? cityFilteredProducts.reduce((sum, p) => sum + Number(p.cost || 0) * Number(p.quantity || 0), 0)
      : filteredStoreInventory.reduce((sum, item) => sum + Number(item.product?.cost || 0) * Number(item.quantity || 0), 0);
  }, [viewMode, cityFilteredProducts, filteredStoreInventory]);

  const totalSettlementValue = React.useMemo(() => {
    return viewMode === 'main'
      ? cityFilteredProducts.reduce((sum, p) => sum + Number(p.discount_price || 0) * Number(p.quantity || 0), 0)
      : filteredStoreInventory.reduce((sum, item) => sum + Number(item.product?.discount_price || 0) * Number(item.quantity || 0), 0);
  }, [viewMode, cityFilteredProducts, filteredStoreInventory]);

  const selectedPurchaseStore = React.useMemo(
    () => stores.find((store) => store.id === purchaseStoreId) || null,
    [purchaseStoreId, stores],
  );

  const filteredPurchaseProducts = React.useMemo(() => {
    if (!selectedPurchaseStore) return [];
    const keyword = purchaseSearchKeyword.trim().toLowerCase();
    return products
      .filter((product) => product.city_id === selectedPurchaseStore.city_id)
      .filter((product) => {
        if (!keyword) return true;
        return [product.name, product.barcode || '', product.city_name || '']
          .join(' ')
          .toLowerCase()
          .includes(keyword);
      });
  }, [products, purchaseSearchKeyword, selectedPurchaseStore]);

  const purchaseCartItems = React.useMemo(() => {
    return Array.from(purchaseCart.entries())
      .map(([cartKey, quantity]) => {
        const [storeId, productId] = cartKey.split(':');
        const store = stores.find((item) => item.id === storeId);
        const product = products.find((item) => item.id === productId);
        if (!store || !product || quantity <= 0) return null;
        return { cartKey, store, product, quantity };
      })
      .filter((item): item is { cartKey: string; store: (typeof stores)[number]; product: (typeof products)[number]; quantity: number } => item !== null);
  }, [products, purchaseCart, stores]);

  const purchaseTotalCost = React.useMemo(() => {
    return purchaseCartItems.reduce((sum, item) => sum + Number(item.product.cost || 0) * item.quantity, 0);
  }, [purchaseCartItems]);

  const setPurchaseQuantity = (storeId: string, productId: string, quantity: number): void => {
    setPurchaseCart((prev) => {
      const next = new Map(prev);
      const cartKey = `${storeId}:${productId}`;
      if (quantity <= 0) {
        next.delete(cartKey);
      } else {
        next.set(cartKey, quantity);
      }
      return next;
    });
  };

  const handleCreatePurchaseOrder = async (): Promise<void> => {
    if (purchaseCartItems.length === 0) {
      setPageNotice({ type: 'error', text: '请先选择进货商品' });
      return;
    }

    const grouped = purchaseCartItems.reduce<Map<string, { store_id: string; city_id: string; supplier_id: string | null; products: Array<{ productId: string; quantity: number }> }>>((acc, item) => {
      const existing = acc.get(item.store.id) || {
        store_id: item.store.id,
        city_id: item.store.city_id,
        supplier_id: purchaseSupplierId ?? null,
        products: [],
      };
      existing.products.push({ productId: item.product.id, quantity: item.quantity });
      acc.set(item.store.id, existing);
      return acc;
    }, new Map());

    setSubmittingPurchase(true);
    const { error } = await createPurchaseOrderV2(Array.from(grouped.values()));
    setSubmittingPurchase(false);
    if (error) {
      setPageNotice({ type: 'error', text: `进货建单失败：${error.message}` });
      return;
    }

    setPurchaseCart(new Map());
    setPurchaseSearchKeyword('');
    setPurchaseStoreId(null);
    setPurchaseSupplierId(null);
    setShowPurchaseModal(false);
    setPageNotice({ type: 'success', text: '进货单已创建，等待确认到货' });
  };

  return (
    <div className="space-y-6">
      {pageNotice && (
        <div className={`rounded-2xl border px-4 py-3 text-sm ${pageNotice.type === 'success' ? 'bg-emerald-500/10 border-emerald-400/30 text-emerald-200' : 'bg-red-500/10 border-red-400/30 text-red-200'}`}>
          <div className="flex items-center justify-between gap-3">
            <span>{pageNotice.text}</span>
            <button
              type="button"
              onClick={() => setPageNotice(null)}
              className="text-white/60 hover:text-white"
            >
              <X size={14} />
            </button>
          </div>
        </div>
      )}

      <div className="flex items-center justify-between">
        <button
          type="button"
          onClick={() => setShowWarningOnly((prev) => !prev)}
          className={`px-4 py-2 rounded-xl flex items-center space-x-2 border transition-colors ${showWarningOnly ? 'bg-orange-500/20 border-orange-400/40' : 'bg-orange-500/10 border-orange-500/20'}`}
        >
          <AlertTriangle size={18} className="text-orange-500" />
          <span className="text-sm font-medium text-orange-500">{lowStockCount} 项库存告警{showWarningOnly ? ' · 已筛选' : ''}</span>
        </button>

        <div className="flex items-center space-x-4">
          {isAdminOrManager && (
            <div className="flex bg-white/5 rounded-xl p-1 border border-white/10">
              <button
                type="button"
                onClick={() => setViewMode('main')}
                className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-colors ${viewMode === 'main' ? 'bg-white/10 text-white' : 'text-white/40 hover:text-white/60'}`}
              >
                总仓库存
              </button>
              <button
                type="button"
                onClick={() => setViewMode('store')}
                className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-colors ${viewMode === 'store' ? 'bg-white/10 text-white' : 'text-white/40 hover:text-white/60'}`}
              >
                店铺库存
              </button>
            </div>
          )}
          {viewMode === 'main' && (
            <>
          {canPurchase && (
          <button
            type="button"
            onClick={() => {
              setPurchaseStoreId(null);
              setPurchaseSearchKeyword('');
              setShowPurchaseModal(true);
            }}
            className="bg-white/5 border border-white/10 px-4 py-2 rounded-xl flex items-center space-x-2 hover:bg-white/10 transition-colors text-sm font-medium"
          >
            <ShoppingCart size={18} className="text-accent" />
            <span>进货</span>
          </button>
          )}
          <button
            type="button"
            onClick={() => setShowLogs(true)}
            className="bg-white/5 border border-white/10 px-4 py-2 rounded-xl flex items-center space-x-2 hover:bg-white/10 transition-colors text-sm font-medium"
          >
            <History size={18} className="text-white/40" />
            <span>变动日志</span>
          </button>
          <button
            type="button"
            onClick={async () => {
              const barcode = window.prompt('请输入 13 位条码');
              if (!barcode) return;
              const qtyRaw = window.prompt('请输入入库数量', '5');
              if (!qtyRaw) return;
              const qty = Number(qtyRaw);
              const { error } = await inboundStockByBarcode(barcode, qty);
              if (error) {
                window.alert(`入库失败：${error.message}`);
                return;
              }
              window.alert('入库成功');
            }}
            className="bg-tech-gradient px-6 py-2.5 rounded-xl font-bold flex items-center space-x-2 shadow-neon hover:scale-[1.02] transition-all active:scale-[0.98]"
          >
            <ScanLine size={20} />
            <span>扫描入库</span>
              </button>
            </>
          )}
        </div>
      </div>

      {viewMode === 'main' ? (
        <div className="flex items-center gap-2 flex-wrap">
          <ProvinceCityFilter
            cities={cities}
            selectedProvinceId={provinceFilter}
            selectedCityId={cityFilter === 'all' ? null : cityFilter}
            onProvinceChange={setProvinceFilter}
            onCityChange={(nextCityId) => setCityFilter(nextCityId || 'all')}
            showProvince={isAdminOrManager}
          />
        </div>
      ) : (
        <div className="space-y-3">
          <div className="flex items-center gap-2 flex-wrap">
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
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            {activeStoresForFilter.map((store) => (
              <button
                type="button"
                key={store.id}
                onClick={() => setSelectedStoreId(store.id)}
                className={`px-4 py-2 rounded-xl border text-sm font-medium transition-colors ${selectedStoreId === store.id ? 'bg-white/10 border-white/20 text-white' : 'bg-white/5 border-white/10 text-white/60 hover:text-white hover:bg-white/10'}`}
              >
                {store.name}
              </button>
            ))}
            {activeStoresForFilter.length === 0 && <span className="text-sm text-white/40">该城市暂无店铺</span>}
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <div className="bg-white/5 border border-white/10 rounded-2xl p-4">
          <p className="text-sm text-white/60 mb-1">商品种类</p>
          <p className="text-2xl font-bold">{viewMode === 'main' ? cityFilteredProducts.length : filteredStoreInventory.length}</p>
        </div>
        <div className="bg-white/5 border border-white/10 rounded-2xl p-4">
          <p className="text-sm text-white/60 mb-1">总库存</p>
          <p className="text-2xl font-bold">{currentTotalStock}</p>
        </div>
        <div className="bg-white/5 border border-white/10 rounded-2xl p-4">
          <p className="text-sm text-white/60 mb-1">库存成本</p>
          <p className="text-2xl font-bold text-accent">¥{totalCostValue.toFixed(2)}</p>
        </div>
        <div className="bg-white/5 border border-white/10 rounded-2xl p-4">
          <p className="text-sm text-white/60 mb-1">结算总额</p>
          <p className="text-2xl font-bold text-accent">¥{totalSettlementValue.toFixed(2)}</p>
        </div>
      </div>

      <div className="bg-white/5 border border-white/10 rounded-[32px] overflow-hidden backdrop-blur-md">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="border-b border-white/5 bg-white/[0.02]">
              <th className="px-8 py-5 text-xs font-bold text-white/40 uppercase tracking-widest">商品信息</th>
              <th className="px-8 py-5 text-xs font-bold text-white/40 uppercase tracking-widest text-center">城市</th>
              <th className="px-8 py-5 text-xs font-bold text-white/40 uppercase tracking-widest text-center">当前库存</th>
              <th className="px-8 py-5 text-xs font-bold text-white/40 uppercase tracking-widest text-center">成本价</th>
              <th className="px-8 py-5 text-xs font-bold text-white/40 uppercase tracking-widest text-center">结算价</th>
              <th className="px-8 py-5 text-xs font-bold text-white/40 uppercase tracking-widest text-center">库存价值</th>
              {viewMode === 'main' && <th className="px-8 py-5 text-xs font-bold text-white/40 uppercase tracking-widest text-center">告警阈值</th>}
              {viewMode === 'main' && <th className="px-8 py-5 text-xs font-bold text-white/40 uppercase tracking-widest text-right">快速操作</th>}
              {viewMode === 'store' && isSuperAdmin && <th className="px-8 py-5 text-xs font-bold text-white/40 uppercase tracking-widest text-right">店铺池调整</th>}
            </tr>
          </thead>
          <tbody>
            {viewMode === 'main' ? (
              filteredProducts.map((product, index) => {
                const currentQty = Number(product.quantity || 0);
                const isLowStock = currentQty < Number(product.min_quantity ?? 10);
                return (
                  <motion.tr
                    key={product.id}
                    initial={{ opacity: 0, x: -20 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: index * 0.02 }}
                    className="group hover:bg-white/[0.03] transition-colors border-b border-white/5 last:border-0"
                  >
                    <td className="px-8 py-5">
                      <div className="flex items-center space-x-4">
                        <div className="w-12 h-12 rounded-xl bg-white/5 border border-white/10 flex items-center justify-center overflow-hidden">
                          {product.image_url ? <img src={product.image_url} className="w-full h-full object-cover" alt={product.name} /> : <span className="text-lg font-bold text-white/20">{product.name[0]}</span>}
                        </div>
                        <div>
                          <p className="font-bold text-white group-hover:text-accent transition-colors">{product.name}</p>
                          <p className="text-xs text-white/30 font-mono mt-1">{product.barcode || '无条码'}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-8 py-5 text-center">
                      <span className="text-sm font-medium text-white/70">{product.city_name || '-'}</span>
                    </td>
                    <td className="px-8 py-5 text-center">
                      <div className="flex flex-col items-center">
                        <span className={`text-xl font-black ${isLowStock ? 'text-red-500' : 'text-green-500'}`}>{currentQty}</span>
                        {isLowStock && <span className="text-[10px] bg-red-500/10 text-red-500 px-2 py-0.5 rounded-full font-bold mt-1">库存不足</span>}
                      </div>
                    </td>
                    <td className="px-8 py-5 text-center">
                      <span className="text-sm font-medium text-white/70">¥{Number(product.cost || 0).toFixed(2)}</span>
                    </td>
                    <td className="px-8 py-5 text-center">
                      <span className="text-sm font-medium text-white/70">¥{Number(product.discount_price || 0).toFixed(2)}</span>
                    </td>
                    <td className="px-8 py-5 text-center">
                      <span className="text-sm font-medium text-accent">¥{(Number(product.cost || 0) * currentQty).toFixed(2)}</span>
                    </td>
                    <td className="px-8 py-5 text-center">
                      {editingThresholdProductId === product.id ? (
                        <div className="flex items-center justify-center gap-2 bg-white/5 rounded-lg px-2 py-1 border border-white/10">
                          <input
                            value={editingThresholdText}
                            onChange={(event) => setEditingThresholdText(event.target.value.replace(/[^0-9]/g, ''))}
                            className="w-16 bg-transparent outline-none text-sm text-center"
                            placeholder="阈值"
                          />
                          <button
                            type="button"
                            onClick={async () => {
                              const nextMinQuantity = Number(editingThresholdText);
                              if (!Number.isFinite(nextMinQuantity) || nextMinQuantity < 0) {
                                window.alert('请输入不小于0的有效阈值');
                                return;
                              }
                              const { error } = await updateInventoryMinQuantityByProduct(product.id, nextMinQuantity);
                              if (error) {
                                window.alert(`设置告警阈值失败：${error.message}`);
                                return;
                              }
                              setEditingThresholdProductId(null);
                              setEditingThresholdText('');
                            }}
                            className="p-1 rounded bg-green-500/20 text-green-300"
                          >
                            <Check size={14} />
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setEditingThresholdProductId(null);
                              setEditingThresholdText('');
                            }}
                            className="p-1 rounded bg-red-500/20 text-red-300"
                          >
                            <X size={14} />
                          </button>
                        </div>
                      ) : (
                        <button
                          type="button"
                          onClick={() => {
                            setEditingThresholdProductId(product.id);
                            setEditingThresholdText(String(product.min_quantity ?? 10));
                          }}
                          className="text-sm font-medium text-white/60 hover:text-white"
                        >
                          {product.min_quantity ?? 10}
                        </button>
                      )}
                    </td>
                    <td className="px-8 py-5">
                      <div className="flex items-center justify-end space-x-2 opacity-100">
                        <button
                          type="button"
                          onClick={async () => {
                            const confirmed = window.confirm(`确认将 ${product.name} 库存减少 5 吗？`);
                            if (!confirmed) return;
                            const { error } = await updateInventoryByProduct(product.id, Math.max(0, currentQty - 5), {
                              action: 'quick_reduce',
                              note: '库存页快捷 -5',
                            });
                            if (error) window.alert(`减库存失败：${error.message}`);
                          }}
                          className="p-2 rounded-lg bg-white/5 hover:bg-white/10 text-white/40 hover:text-white transition-colors"
                        >
                          <Minus size={16} />
                        </button>
                        <button
                          type="button"
                          onClick={async () => {
                            const confirmed = window.confirm(`确认将 ${product.name} 库存增加 5 吗？`);
                            if (!confirmed) return;
                            const { error } = await updateInventoryByProduct(product.id, currentQty + 5, {
                              action: 'quick_add',
                              note: '库存页快捷 +5',
                            });
                            if (error) window.alert(`加库存失败：${error.message}`);
                          }}
                          className="p-2 rounded-lg bg-white/5 hover:bg-white/10 text-white/40 hover:text-white transition-colors"
                        >
                          <Plus size={16} />
                        </button>
                        {editingProductId === product.id ? (
                          <div className="flex items-center gap-2 bg-white/5 rounded-lg px-2 py-1 border border-white/10">
                            <input
                              value={editingQuantityText}
                              onChange={(event) => setEditingQuantityText(event.target.value.replace(/[^0-9]/g, ''))}
                              className="w-20 bg-transparent outline-none text-sm"
                              placeholder="数量"
                            />
                            <button
                              type="button"
                              onClick={async () => {
                                const qty = Number(editingQuantityText);
                                if (!Number.isFinite(qty)) {
                                  window.alert('请输入有效数字');
                                  return;
                                }
                                const { error } = await updateInventoryByProduct(product.id, qty, {
                                  action: 'manual_adjust',
                                  note: '库存页行内编辑',
                                });
                                if (error) {
                                  window.alert(`设置库存失败：${error.message}`);
                                  return;
                                }
                                setEditingProductId(null);
                                setEditingQuantityText('');
                              }}
                              className="p-1 rounded bg-green-500/20 text-green-300"
                            >
                              <Check size={14} />
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                setEditingProductId(null);
                                setEditingQuantityText('');
                              }}
                              className="p-1 rounded bg-red-500/20 text-red-300"
                            >
                              <X size={14} />
                            </button>
                          </div>
                        ) : (
                          <button
                            type="button"
                            onClick={() => {
                              setEditingProductId(product.id);
                              setEditingQuantityText(String(currentQty));
                            }}
                            className="p-2 rounded-lg bg-accent/10 hover:bg-accent/20 text-accent transition-colors"
                          >
                            <Pencil size={16} />
                          </button>
                        )}
                      </div>
                    </td>
                  </motion.tr>
                );
              })
            ) : (
              filteredStoreInventory.map((item, index) => {
                const product = item.product;
                const currentStoreQty = Number(item.quantity || 0);
                return (
                  <motion.tr
                    key={item.id}
                    initial={{ opacity: 0, x: -20 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: index * 0.02 }}
                    className="group hover:bg-white/[0.03] transition-colors border-b border-white/5 last:border-0"
                  >
                    <td className="px-8 py-5">
                      <div className="flex items-center space-x-4">
                        <div className="w-12 h-12 rounded-xl bg-white/5 border border-white/10 flex items-center justify-center overflow-hidden">
                          {product?.image_url ? <img src={product.image_url} className="w-full h-full object-cover" alt={product?.name || item.product_name} /> : <span className="text-lg font-bold text-white/20">{product?.name?.[0] || item.product_name?.[0] || '?'}</span>}
                        </div>
                        <div>
                          <p className="font-bold text-white group-hover:text-accent transition-colors">{product?.name || item.product_name}</p>
                          <p className="text-xs text-white/30 font-mono mt-1">{product?.barcode || '无条码'}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-8 py-5 text-center">
                      <span className="text-sm font-medium text-white/70">{product?.city_name || '-'}</span>
                    </td>
                    <td className="px-8 py-5 text-center">
                      <span className="text-xl font-black text-white">{item.quantity}</span>
                    </td>
                    <td className="px-8 py-5 text-center">
                      <span className="text-sm font-medium text-white/70">¥{Number(product?.cost || 0).toFixed(2)}</span>
                    </td>
                    <td className="px-8 py-5 text-center">
                      <span className="text-sm font-medium text-white/70">¥{Number(product?.discount_price || 0).toFixed(2)}</span>
                    </td>
                    <td className="px-8 py-5 text-center">
                      <span className="text-sm font-medium text-accent">¥{(Number(product?.cost || 0) * currentStoreQty).toFixed(2)}</span>
                    </td>
                    {isSuperAdmin && (
                      <td className="px-8 py-5">
                        <div className="flex items-center justify-end space-x-2">
                          <button
                            type="button"
                            onClick={async () => {
                              const { error } = await updateStoreInventoryByProduct(item.store_id, item.product_id, Math.max(0, currentStoreQty - 1));
                              if (error) {
                                setPageNotice({ type: 'error', text: `店铺池减量失败：${error.message}` });
                                return;
                              }
                              setPageNotice({ type: 'success', text: `已将 ${product?.name || item.product_name} 店铺池库存减 1` });
                            }}
                            className="p-2 rounded-lg bg-white/5 hover:bg-white/10 text-white/40 hover:text-white transition-colors"
                          >
                            <Minus size={16} />
                          </button>
                          <button
                            type="button"
                            onClick={async () => {
                              const { error } = await updateStoreInventoryByProduct(item.store_id, item.product_id, currentStoreQty + 1);
                              if (error) {
                                setPageNotice({ type: 'error', text: `店铺池加量失败：${error.message}` });
                                return;
                              }
                              setPageNotice({ type: 'success', text: `已将 ${product?.name || item.product_name} 店铺池库存加 1` });
                            }}
                            className="p-2 rounded-lg bg-white/5 hover:bg-white/10 text-white/40 hover:text-white transition-colors"
                          >
                            <Plus size={16} />
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setManualStoreEdit({
                                storeId: item.store_id,
                                productId: item.product_id,
                                productName: product?.name || item.product_name || '商品',
                                quantityText: String(currentStoreQty),
                              });
                            }}
                            className="p-2 rounded-lg bg-accent/10 hover:bg-accent/20 text-accent transition-colors"
                          >
                            <Pencil size={16} />
                          </button>
                        </div>
                      </td>
                    )}
                  </motion.tr>
                );
              })
            )}
            {viewMode === 'main' && filteredProducts.length === 0 && (
              <tr>
                <td colSpan={5} className="px-8 py-10 text-center text-white/40">当前筛选下暂无库存商品</td>
              </tr>
            )}
            {viewMode === 'store' && filteredStoreInventory.length === 0 && (
              <tr>
                <td colSpan={isSuperAdmin ? 4 : 3} className="px-8 py-10 text-center text-white/40">
                  {!selectedStoreId ? '请选择店铺' : '该店铺暂无库存'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {showLogs && (
        <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4">
          <div className="w-full max-w-4xl bg-[#121217] border border-white/10 rounded-3xl p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-xl font-bold">库存变动日志</h3>
              <button type="button" onClick={() => setShowLogs(false)} className="px-3 py-1 rounded-lg bg-white/10">关闭</button>
            </div>
            <div className="max-h-[65vh] overflow-auto rounded-2xl border border-white/10">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-white/10 bg-white/[0.02]">
                    <th className="px-4 py-3 text-xs text-white/50">时间</th>
                    <th className="px-4 py-3 text-xs text-white/50">商品</th>
                    <th className="px-4 py-3 text-xs text-white/50">动作</th>
                    <th className="px-4 py-3 text-xs text-white/50 text-right">变动</th>
                    <th className="px-4 py-3 text-xs text-white/50 text-right">前后库存</th>
                    <th className="px-4 py-3 text-xs text-white/50">备注</th>
                  </tr>
                </thead>
                <tbody>
                  {inventoryLogs.map((log) => (
                    <tr key={log.id} className="border-b border-white/5">
                      <td className="px-4 py-3 text-xs text-white/70">{new Date(log.created_at).toLocaleString()}</td>
                      <td className="px-4 py-3 text-sm">{log.product_name || log.product_id}</td>
                      <td className="px-4 py-3 text-xs text-white/60">{getInventoryLogActionLabel(log.action)}</td>
                      <td className={`px-4 py-3 text-right font-bold ${log.delta_quantity >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                        {log.delta_quantity >= 0 ? '+' : ''}{log.delta_quantity}
                      </td>
                      <td className="px-4 py-3 text-right text-white/70">{log.before_quantity} → {log.after_quantity}</td>
                      <td className="px-4 py-3 text-xs text-white/60">{log.note || '-'}</td>
                    </tr>
                  ))}
                  {inventoryLogs.length === 0 && (
                    <tr>
                      <td colSpan={6} className="px-4 py-8 text-center text-white/40">暂无日志数据（请先执行一次库存变动）</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {manualStoreEdit && (
        <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4">
          <div className="w-full max-w-md bg-[#121217] border border-white/10 rounded-3xl p-6 space-y-4">
            <h3 className="text-lg font-bold">调整店铺池库存</h3>
            <p className="text-sm text-white/60">{manualStoreEdit.productName}</p>
            <input
              value={manualStoreEdit.quantityText}
              onChange={(event) => {
                const nextText = event.target.value.replace(/[^0-9]/g, '');
                setManualStoreEdit((prev) => (prev ? { ...prev, quantityText: nextText } : prev));
              }}
              className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2"
              placeholder="请输入不小于0的库存数量"
            />
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setManualStoreEdit(null)}
                className="px-4 py-2 rounded-xl bg-white/5"
              >
                取消
              </button>
              <button
                type="button"
                onClick={async () => {
                  const qty = Number(manualStoreEdit.quantityText);
                  if (!Number.isFinite(qty) || qty < 0) {
                    setPageNotice({ type: 'error', text: '请输入不小于0的有效数字' });
                    return;
                  }
                  const { error } = await updateStoreInventoryByProduct(manualStoreEdit.storeId, manualStoreEdit.productId, qty);
                  if (error) {
                    setPageNotice({ type: 'error', text: `店铺池设置失败：${error.message}` });
                    return;
                  }
                  setPageNotice({ type: 'success', text: `已将 ${manualStoreEdit.productName} 店铺池库存设置为 ${qty}` });
                  setManualStoreEdit(null);
                }}
                className="px-4 py-2 rounded-xl bg-tech-gradient font-bold"
              >
                保存
              </button>
            </div>
          </div>
        </div>
      )}

      {showPurchaseModal && canPurchase && (
        <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4 overflow-y-auto">
          <div className="w-full max-w-5xl max-h-[calc(100vh-2rem)] overflow-y-auto bg-[#121217] border border-white/10 rounded-3xl p-6 space-y-5">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-xl font-bold">进货建单</h3>
                <p className="text-sm text-white/50 mt-1">创建后不会变动库存；到订单页确认到货后由 RPC 入库。</p>
              </div>
              <button
                type="button"
                onClick={() => {
                  setShowPurchaseModal(false);
                  setPurchaseStoreId(null);
                  setPurchaseSupplierId(null);
                  setPurchaseSearchKeyword('');
                }}
                className="p-2 rounded-lg bg-white/10 text-white/60 hover:text-white"
              >
                <X size={16} />
              </button>
            </div>

            <div className="flex flex-col sm:flex-row gap-4">
              <select
                value={purchaseStoreId || ''}
                onChange={(event) => {
                  setPurchaseStoreId(event.target.value || null);
                  setPurchaseSearchKeyword('');
                }}
                className="bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white outline-none"
              >
                <option value="" className="bg-[#121217]">-- 请选择进货店铺 --</option>
                {stores
                  .filter((store) => store.status === 'active')
                  .map((store) => (
                    <option key={store.id} value={store.id} className="bg-[#121217]">
                      {store.name} ({store.city_name})
                    </option>
                  ))}
              </select>
              <select
                value={purchaseSupplierId || ''}
                onChange={(event) => setPurchaseSupplierId(event.target.value || null)}
                className="bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white outline-none"
              >
                <option value="" className="bg-[#121217]">-- 不关联供应商 --</option>
                {suppliers.map((supplier) => (
                  <option key={supplier.id} value={supplier.id} className="bg-[#121217]">
                    {supplier.company_name}
                  </option>
                ))}
              </select>
              <input
                value={purchaseSearchKeyword}
                onChange={(event) => setPurchaseSearchKeyword(event.target.value)}
                placeholder="搜索商品名称/条码"
                className="flex-1 w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3"
              />
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <div className="max-h-[420px] overflow-auto border border-white/10 rounded-2xl">
                {selectedPurchaseStore ? filteredPurchaseProducts.map((product) => {
                  const cartKey = `${selectedPurchaseStore.id}:${product.id}`;
                  const qty = purchaseCart.get(cartKey) || 0;
                  return (
                    <div key={product.id} className="p-4 border-b border-white/5 last:border-b-0 space-y-3">
                      <div className="flex items-center justify-between gap-3">
                        <div className="flex-1 min-w-0">
                          <p className="font-semibold">{product.name}</p>
                          <p className="text-xs text-white/40">{product.city_name} · 成本 ¥{Number(product.cost || 0).toFixed(2)} · 条码 {product.barcode || '无'}</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => setPurchaseQuantity(selectedPurchaseStore.id, product.id, Math.max(0, qty - 1))}
                          className="px-3 py-1.5 rounded-lg bg-white/10"
                        >
                          -1
                        </button>
                        <input
                          value={qty > 0 ? String(qty) : ''}
                          onChange={(event) => {
                            const value = Number(event.target.value.replace(/[^0-9]/g, ''));
                            setPurchaseQuantity(selectedPurchaseStore.id, product.id, Number.isNaN(value) ? 0 : value);
                          }}
                          placeholder="进货数量"
                          className="w-40 bg-white/5 border border-white/10 rounded-lg px-3 py-1.5"
                        />
                        <button
                          type="button"
                          onClick={() => setPurchaseQuantity(selectedPurchaseStore.id, product.id, qty + 1)}
                          className="px-3 py-1.5 rounded-lg bg-white/10"
                        >
                          +1
                        </button>
                      </div>
                    </div>
                  );
                }) : (
                  <p className="px-4 py-8 text-sm text-white/40">请先选择店铺</p>
                )}
                {selectedPurchaseStore && filteredPurchaseProducts.length === 0 && (
                  <p className="px-4 py-8 text-sm text-white/40">当前店铺城市下暂无可选商品</p>
                )}
              </div>

              <div className="border border-white/10 rounded-2xl p-4 flex flex-col">
                <h4 className="font-semibold mb-3">进货清单</h4>
                <div className="space-y-2 max-h-[300px] overflow-auto pr-1">
                  {purchaseCartItems.map((item) => (
                    <div key={item.cartKey} className="flex items-center justify-between bg-white/5 rounded-lg px-3 py-2">
                      <div>
                        <p className="text-sm font-medium">{item.product.name}</p>
                        <p className="text-xs text-white/40">{item.store.name} · 数量 {item.quantity} · 成本小计 ¥{(Number(item.product.cost || 0) * item.quantity).toFixed(2)}</p>
                      </div>
                      <button type="button" onClick={() => setPurchaseQuantity(item.store.id, item.product.id, 0)} className="text-xs text-red-300 hover:text-red-200">移除</button>
                    </div>
                  ))}
                  {purchaseCartItems.length === 0 && <p className="text-sm text-white/40">暂无商品</p>}
                </div>

                <div className="mt-auto pt-4 border-t border-white/10 space-y-1 text-sm">
                  <div className="flex justify-between"><span className="text-white/60">店铺数</span><span>{new Set(purchaseCartItems.map((item) => item.store.id)).size}</span></div>
                  <div className="flex justify-between"><span className="text-white/60">商品总数</span><span>{purchaseCartItems.reduce((sum, item) => sum + item.quantity, 0)}</span></div>
                  <div className="flex justify-between"><span className="text-white/60">成本总额</span><span className="text-accent font-bold">¥{purchaseTotalCost.toFixed(2)}</span></div>
                </div>

                <button
                  type="button"
                  onClick={() => { void handleCreatePurchaseOrder(); }}
                  disabled={submittingPurchase || purchaseCartItems.length === 0}
                  className="mt-4 w-full py-2.5 rounded-xl bg-tech-gradient font-bold disabled:opacity-50"
                >
                  {submittingPurchase ? '提交中...' : '确认创建进货单'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
