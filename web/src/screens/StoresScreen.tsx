import React, { useEffect, useMemo, useState } from 'react';
import { Store as StoreIcon, Plus, Edit2, PowerOff } from 'lucide-react';
import { motion } from 'framer-motion';
import { useAppStore } from '../store/useAppStore';
import { supabase } from '../lib/supabase';

export const StoresScreen: React.FC = () => {
  const { user, cities, stores, addStore, updateStore, deactivateStore } = useAppStore();
  const isAdmin = user?.role === 'admin';

  const [cityFilter, setCityFilter] = useState<string>('all');
  const [showCreate, setShowCreate] = useState(false);
  const [editingStoreId, setEditingStoreId] = useState<string | null>(null);
  const [distributors, setDistributors] = useState<{ id: string; email: string }[]>([]);
  
  const [form, setForm] = useState({
    name: '',
    city_id: '',
    distributor_id: '',
    discount_rate: '1',
    address: '',
    phone: '',
  });

  useEffect(() => {
    if (isAdmin) {
      supabase
        .from('profiles')
        .select('id, email')
        .eq('role', 'distributor')
        .then(({ data }) => {
          if (data) setDistributors(data);
        });
    }
  }, [isAdmin]);

  const filteredStores = useMemo(() => {
    if (cityFilter === 'all') return stores;
    return stores.filter((store) => store.city_id === cityFilter);
  }, [cityFilter, stores]);

  const handleCreateStore = async (): Promise<void> => {
    if (!form.name.trim() || !form.city_id) {
      window.alert('请完整填写店铺名称、城市');
      return;
    }
    const payload = {
      name: form.name.trim(),
      city_id: form.city_id,
      distributor_id: form.distributor_id || null,
      discount_rate: Number(form.discount_rate || 1),
      address: form.address.trim(),
      phone: form.phone.trim(),
    };

    const { error } = await addStore(payload);
    if (error) {
      window.alert(`新增失败：${error.message}`);
      return;
    }
    setShowCreate(false);
    setForm({ name: '', city_id: '', distributor_id: '', discount_rate: '1', address: '', phone: '' });
  };

  const openCreateModal = (): void => {
    setEditingStoreId(null);
    setForm({ name: '', city_id: '', distributor_id: '', discount_rate: '1', address: '', phone: '' });
    setShowCreate(true);
  };

  const openEditModal = (storeId: string): void => {
    const store = stores.find((item) => item.id === storeId);
    if (!store) return;

    setEditingStoreId(store.id);
    setForm({
      name: store.name,
      city_id: store.city_id,
      distributor_id: store.distributor_id || '',
      discount_rate: String(store.discount_rate || 1),
      address: store.address || '',
      phone: store.phone || '',
    });
    setShowCreate(true);
  };

  const handleSaveStore = async (): Promise<void> => {
    if (editingStoreId) {
      const payload = {
        name: form.name.trim(),
        city_id: form.city_id,
        distributor_id: form.distributor_id,
        discount_rate: Number(form.discount_rate || 1),
        address: form.address.trim(),
        phone: form.phone.trim(),
      };

      if (!payload.name || !payload.city_id) {
        window.alert('请完整填写店铺名称、城市');
        return;
      }

      const { error } = await updateStore(editingStoreId, payload);
      if (error) {
        window.alert(`更新失败：${error.message}`);
        return;
      }
      setShowCreate(false);
      setEditingStoreId(null);
      return;
    }

    await handleCreateStore();
  };

  const handleDeactivate = async (storeId: string, event: React.MouseEvent): Promise<void> => {
    event.stopPropagation();
    if (!window.confirm('确定要停用该店铺吗？')) return;
    const { error } = await deactivateStore(storeId);
    if (error) {
      window.alert(`停用失败：${error.message}`);
    }
  };

  if (!isAdmin) {
    return (
      <div className="h-[400px] flex flex-col items-center justify-center text-white/20">
        <StoreIcon size={80} strokeWidth={1} className="mb-4" />
        <p className="text-xl font-medium">无权限访问</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-2 flex-wrap">
          <div className="w-9 h-9 rounded-lg bg-white/5 border border-white/10 flex items-center justify-center text-white/40">
            <StoreIcon size={16} />
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

        <button
          type="button"
          onClick={openCreateModal}
          className="bg-tech-gradient px-6 py-2.5 rounded-xl font-bold flex items-center space-x-2 shadow-neon hover:scale-[1.02] transition-all active:scale-[0.98]"
        >
          <Plus size={20} />
          <span>添加新店铺</span>
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
        {filteredStores.map((store, index) => (
          <motion.div
            key={store.id}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: index * 0.03 }}
            className="group bg-white/5 border border-white/10 rounded-3xl overflow-hidden hover:border-accent/50 transition-all duration-300 flex flex-col"
            onClick={() => openEditModal(store.id)}
          >
            <div className="p-6 flex-1 flex flex-col">
              <div className="mb-4">
                <div className="flex items-center justify-between">
                  <h3 className="text-lg font-bold group-hover:text-accent transition-colors truncate">{store.name}</h3>
                  <div className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider ${store.status === 'active' ? 'bg-green-500/20 text-green-400' : 'bg-red-500/20 text-red-400'}`}>
                    {store.status === 'active' ? '营业中' : '已停用'}
                  </div>
                </div>
                <div className="flex items-center space-x-2 mt-1.5">
                  <div className="bg-white/10 border border-white/10 rounded px-2 py-0.5 flex items-center space-x-1.5">
                    <span className="text-[9px] font-black text-white/30 uppercase tracking-tighter">City</span>
                    <span className="text-xs font-mono text-accent font-bold">{store.city_name || '未知城市'}</span>
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-1 gap-4 mb-6">
                <div className="bg-white/5 p-3 rounded-2xl border border-white/5">
                  <p className="text-[10px] text-white/40 uppercase font-bold tracking-tighter mb-1">分销商</p>
                  <p className="text-sm font-medium text-white/80 truncate">{store.distributor_email || '未绑定分销商'}</p>
                </div>
                <div className="bg-white/5 p-3 rounded-2xl border border-white/5">
                  <p className="text-[10px] text-white/40 uppercase font-bold tracking-tighter mb-1">联系方式</p>
                  <p className="text-sm font-medium text-white/80 truncate">{store.phone || '未填写'}</p>
                </div>
              </div>

              <div className="mt-auto flex items-center justify-between pt-4 border-t border-white/5">
                <div className="flex flex-col">
                  <span className="text-[10px] text-white/40 uppercase font-bold tracking-tighter">折扣率</span>
                  <span className="text-sm font-bold text-white/80">{store.discount_rate}</span>
                </div>
                <div className="flex items-center space-x-2">
                  {store.status === 'active' && (
                    <button
                      type="button"
                      onClick={(e) => handleDeactivate(store.id, e)}
                      className="p-2 rounded-xl hover:bg-red-500/20 text-white/40 hover:text-red-400 transition-colors"
                      title="停用店铺"
                    >
                      <PowerOff size={18} />
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      openEditModal(store.id);
                    }}
                    className="p-2 rounded-xl hover:bg-white/10 text-white/40 hover:text-white transition-colors"
                  >
                    <Edit2 size={18} />
                  </button>
                </div>
              </div>
            </div>
          </motion.div>
        ))}
      </div>

      {filteredStores.length === 0 && (
        <div className="h-[400px] flex flex-col items-center justify-center text-white/20">
          <StoreIcon size={80} strokeWidth={1} className="mb-4" />
          <p className="text-xl font-medium">暂无店铺数据</p>
          <p className="text-sm mt-2">点击上方按钮添加您的第一个店铺</p>
        </div>
      )}

      {showCreate && (
        <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4">
          <div className="w-full max-w-lg bg-[#121217] border border-white/10 rounded-3xl p-6 space-y-4">
            <h3 className="text-xl font-bold">{editingStoreId ? '编辑店铺' : '新增店铺'}</h3>
            <div className="grid grid-cols-2 gap-3">
              <input value={form.name} onChange={(event) => setForm((prev) => ({ ...prev, name: event.target.value }))} placeholder="店铺名称" className="col-span-2 bg-white/5 border border-white/10 rounded-xl px-3 py-2" />
              
              <div className="col-span-2 space-y-2">
                <p className="text-xs font-bold text-white/40 uppercase tracking-wider">选择城市</p>
                <div className="flex flex-wrap gap-2">
                  {cities.map((city) => (
                    <button
                      type="button"
                      key={city.id}
                      onClick={() => setForm((prev) => ({ ...prev, city_id: city.id }))}
                      className={`px-3 py-1.5 rounded-xl border text-sm font-medium transition-colors ${form.city_id === city.id ? 'bg-white/10 border-white/20 text-white' : 'bg-white/5 border-white/10 text-white/60 hover:text-white hover:bg-white/10'}`}
                    >
                      {city.name}
                    </button>
                  ))}
                </div>
              </div>

              <div className="col-span-2 space-y-2">
                <p className="text-xs font-bold text-white/40 uppercase tracking-wider">选择分销商</p>
                <select
                  value={form.distributor_id}
                  onChange={(event) => setForm((prev) => ({ ...prev, distributor_id: event.target.value }))}
                  className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-white focus:outline-none focus:ring-2 focus:ring-accent/50"
                >
                  <option value="" className="bg-[#121217]">暂不绑定分销商（后续可编辑）</option>
                  {distributors.map((d) => (
                    <option key={d.id} value={d.id} className="bg-[#121217]">
                      {d.email}
                    </option>
                  ))}
                </select>
              </div>

              <input value={form.discount_rate} onChange={(event) => setForm((prev) => ({ ...prev, discount_rate: event.target.value }))} placeholder="折扣率 (默认1)" className="bg-white/5 border border-white/10 rounded-xl px-3 py-2" />
              <input value={form.phone} onChange={(event) => setForm((prev) => ({ ...prev, phone: event.target.value }))} placeholder="联系电话" className="bg-white/5 border border-white/10 rounded-xl px-3 py-2" />
              <input value={form.address} onChange={(event) => setForm((prev) => ({ ...prev, address: event.target.value }))} placeholder="详细地址" className="col-span-2 bg-white/5 border border-white/10 rounded-xl px-3 py-2" />
            </div>
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setShowCreate(false)} className="px-4 py-2 rounded-xl bg-white/5">取消</button>
              <button type="button" onClick={handleSaveStore} className="px-4 py-2 rounded-xl bg-tech-gradient font-bold">保存</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
