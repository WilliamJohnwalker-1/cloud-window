import React, { useMemo, useState } from 'react';
import { Filter, Package, Plus } from 'lucide-react';
import { motion } from 'framer-motion';
import { BarcodePreview } from '../components/BarcodePreview';
import { useAppStore } from '../store/useAppStore';

export const ProductsScreen: React.FC = () => {
  const { user, cities, products, addProduct, updateProduct, fetchProducts, updateInventoryByProduct } = useAppStore();
  const isAdminOrManager = user?.role === 'admin' || user?.role === 'inventory_manager';

  const [cityFilter, setCityFilter] = useState<string>('all');
  const [showCreate, setShowCreate] = useState(false);
  const [editingProductId, setEditingProductId] = useState<string | null>(null);
  const [form, setForm] = useState({
    name: '',
    price: '',
    cost: '',
    one_time_cost: '0',
    discount_price: '',
    city_id: '',
  });

  const filteredProducts = useMemo(() => {
    if (cityFilter === 'all') return products;
    return products.filter((product) => product.city_id === cityFilter);
  }, [cityFilter, products]);

  const handleCreateProduct = async (): Promise<void> => {
    if (!form.name.trim()) {
      window.alert('请输入商品名称');
      return;
    }
    const payload = {
      name: form.name.trim(),
      price: Number(form.price),
      cost: Number(form.cost),
      one_time_cost: Number(form.one_time_cost || 0),
      discount_price: Number(form.discount_price || form.price),
      city_id: form.city_id,
    };

    if (!payload.city_id || Number.isNaN(payload.price) || Number.isNaN(payload.cost)) {
      window.alert('请完整填写城市、零售价、成本价');
      return;
    }

    const { error } = await addProduct(payload);
    if (error) {
      window.alert(`新增失败：${error.message}`);
      return;
    }
    await fetchProducts();
    setShowCreate(false);
    setForm({ name: '', price: '', cost: '', one_time_cost: '0', discount_price: '', city_id: '' });
  };

  const openCreateModal = (): void => {
    setEditingProductId(null);
    setForm({ name: '', price: '', cost: '', one_time_cost: '0', discount_price: '', city_id: '' });
    setShowCreate(true);
  };

  const openEditModal = (productId: string): void => {
    const product = products.find((item) => item.id === productId);
    if (!product) return;

    setEditingProductId(product.id);
    setForm({
      name: product.name,
      price: String(product.price),
      cost: String(product.cost),
      one_time_cost: String(product.one_time_cost || 0),
      discount_price: String(product.discount_price),
      city_id: product.city_id,
    });
    setShowCreate(true);
  };

  const handleSaveProduct = async (): Promise<void> => {
    if (editingProductId) {
      const payload = {
        name: form.name.trim(),
        price: Number(form.price),
        cost: Number(form.cost),
        one_time_cost: Number(form.one_time_cost || 0),
        discount_price: Number(form.discount_price || form.price),
        city_id: form.city_id,
      };

      if (!payload.name || !payload.city_id || Number.isNaN(payload.price) || Number.isNaN(payload.cost)) {
        window.alert('请完整填写商品名称、城市、零售价、成本价');
        return;
      }

      const { error } = await updateProduct(editingProductId, payload);
      if (error) {
        window.alert(`更新失败：${error.message}`);
        return;
      }
      setShowCreate(false);
      setEditingProductId(null);
      return;
    }

    await handleCreateProduct();
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-2 flex-wrap">
          <div className="w-9 h-9 rounded-lg bg-white/5 border border-white/10 flex items-center justify-center text-white/40">
            <Filter size={16} />
          </div>
          <button
            type="button"
            onClick={() => setCityFilter('all')}
            className={`px-4 py-2 rounded-xl border text-sm font-medium transition-colors ${cityFilter === 'all' ? 'bg-white/10 border-white/20 text-white' : 'bg-white/5 border-white/10 text-white/60 hover:text-white hover:bg-white/10'}`}
          >
            全部城市
          </button>
          {cities.map((city) => (
            <button
              type="button"
              key={city.id}
              onClick={() => setCityFilter(city.id)}
              className={`px-4 py-2 rounded-xl border text-sm font-medium transition-colors ${cityFilter === city.id ? 'bg-white/10 border-white/20 text-white' : 'bg-white/5 border-white/10 text-white/60 hover:text-white hover:bg-white/10'}`}
            >
              {city.name}
            </button>
          ))}
        </div>

        {isAdminOrManager && (
          <button
            type="button"
            onClick={openCreateModal}
            className="bg-tech-gradient px-6 py-2.5 rounded-xl font-bold flex items-center space-x-2 shadow-neon hover:scale-[1.02] transition-all active:scale-[0.98]"
          >
            <Plus size={20} />
            <span>添加新商品</span>
          </button>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
        {filteredProducts.map((product, index) => (
          <motion.div
            key={product.id}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: index * 0.03 }}
            className="group bg-white/5 border border-white/10 rounded-3xl overflow-hidden hover:border-accent/50 transition-all duration-300 flex flex-col"
            onClick={() => {
              if (!isAdminOrManager) return;
              openEditModal(product.id);
            }}
          >
            <div className="aspect-square relative overflow-hidden bg-white/5">
              {product.image_url ? (
                <img
                  src={product.image_url}
                  alt={product.name}
                  className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-110"
                />
              ) : (
                <div className="w-full h-full flex items-center justify-center text-white/10">
                  <Package size={64} />
                </div>
              )}
              <div className="absolute top-4 right-4 bg-background/80 backdrop-blur-md px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider text-accent border border-white/10">
                {product.city_name}
              </div>
            </div>

            <div className="p-6 flex-1 flex flex-col">
              <div className="mb-4">
                <h3 className="text-lg font-bold group-hover:text-accent transition-colors truncate">{product.name}</h3>
                <div className="flex items-center space-x-2 mt-1.5">
                  <div className="bg-white/10 border border-white/10 rounded px-2 py-0.5 flex items-center space-x-1.5">
                    <span className="text-[9px] font-black text-white/30 uppercase tracking-tighter">Barcode</span>
                    <span className="text-xs font-mono text-accent font-bold">{product.barcode || '无条码'}</span>
                  </div>
                </div>
                <BarcodePreview code={product.barcode} />
              </div>

              <div className="grid grid-cols-2 gap-4 mb-6">
                <div className="bg-white/5 p-3 rounded-2xl border border-white/5">
                  <p className="text-[10px] text-white/40 uppercase font-bold tracking-tighter mb-1">零售价</p>
                  <p className="text-lg font-black text-primary-light">¥{product.price}</p>
                </div>
                <div className="bg-white/5 p-3 rounded-2xl border border-white/5">
                  <p className="text-[10px] text-white/40 uppercase font-bold tracking-tighter mb-1">当前库存</p>
                  <p className={product.quantity !== undefined && product.quantity < (product.min_quantity || 10) ? 'text-lg font-black text-red-500' : 'text-lg font-black text-green-500'}>
                    {product.quantity ?? 0}
                  </p>
                </div>
              </div>

              <div className="mt-auto flex items-center justify-between pt-4 border-t border-white/5">
                <div className="flex flex-col">
                  <span className="text-[10px] text-white/40 uppercase font-bold tracking-tighter">分销折扣价</span>
                  <span className="text-sm font-bold text-white/80">¥{product.discount_price}</span>
                </div>
                {isAdminOrManager && (
                  <button
                    type="button"
                    onClick={async (event) => {
                      event.stopPropagation();
                      const next = Number(product.quantity || 0) + 5;
                      const { error } = await updateInventoryByProduct(product.id, next, {
                        action: 'quick_add',
                        note: '商品页快捷补货 +5',
                      });
                      if (error) window.alert(`补货失败：${error.message}`);
                    }}
                    className="p-2 rounded-xl hover:bg-white/10 text-white/40 hover:text-white transition-colors"
                  >
                    <Plus size={20} />
                  </button>
                )}
              </div>
            </div>
          </motion.div>
        ))}
      </div>

      {filteredProducts.length === 0 && (
        <div className="h-[400px] flex flex-col items-center justify-center text-white/20">
          <Package size={80} strokeWidth={1} className="mb-4" />
          <p className="text-xl font-medium">暂无商品数据</p>
          <p className="text-sm mt-2">点击上方按钮添加您的第一个商品</p>
        </div>
      )}

      {showCreate && isAdminOrManager && (
        <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4">
          <div className="w-full max-w-lg bg-[#121217] border border-white/10 rounded-3xl p-6 space-y-4">
            <h3 className="text-xl font-bold">{editingProductId ? '编辑商品' : '新增商品'}</h3>
            <div className="grid grid-cols-2 gap-3">
              <input value={form.name} onChange={(event) => setForm((prev) => ({ ...prev, name: event.target.value }))} placeholder="商品名" className="col-span-2 bg-white/5 border border-white/10 rounded-xl px-3 py-2" />
              <input value={form.price} onChange={(event) => setForm((prev) => ({ ...prev, price: event.target.value }))} placeholder="零售价" className="bg-white/5 border border-white/10 rounded-xl px-3 py-2" />
              <input value={form.cost} onChange={(event) => setForm((prev) => ({ ...prev, cost: event.target.value }))} placeholder="成本价" className="bg-white/5 border border-white/10 rounded-xl px-3 py-2" />
              <input value={form.discount_price} onChange={(event) => setForm((prev) => ({ ...prev, discount_price: event.target.value }))} placeholder="折扣价(可选)" className="bg-white/5 border border-white/10 rounded-xl px-3 py-2" />
              <input value={form.one_time_cost} onChange={(event) => setForm((prev) => ({ ...prev, one_time_cost: event.target.value }))} placeholder="一次性成本" className="bg-white/5 border border-white/10 rounded-xl px-3 py-2" />
              <select value={form.city_id} onChange={(event) => setForm((prev) => ({ ...prev, city_id: event.target.value }))} className="col-span-2 bg-white/5 border border-white/10 rounded-xl px-3 py-2">
                <option value="" className="bg-black">请选择城市</option>
                {cities.map((city) => (
                  <option key={city.id} value={city.id} className="bg-black">{city.name}</option>
                ))}
              </select>
            </div>
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setShowCreate(false)} className="px-4 py-2 rounded-xl bg-white/5">取消</button>
              <button type="button" onClick={handleSaveProduct} className="px-4 py-2 rounded-xl bg-tech-gradient font-bold">保存</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
