import React, { useEffect, useMemo, useState } from 'react';
import { Store as StoreIcon, Plus, Edit2, PowerOff, RotateCcw, Trash2, Copy, ChevronDown, ChevronUp, Check, X } from 'lucide-react';
import { motion } from 'framer-motion';

import { useAppStore } from '../store/useAppStore';
import { ProvinceCityFilter } from '../components/ProvinceCityFilter';
import { supabase } from '../lib/supabase';
import type { Store } from '../types';
import { getProvinceForCity } from '../utils/provinceMapping';

const cooperationModeLabelMap: Record<'consignment' | 'buyout' | 'direct', string> = {
  consignment: '寄售',
  buyout: '买断',
  direct: '直营',
};

export const StoresScreen: React.FC = () => {
  const { user, cities, stores, addStore, updateStore, deactivateStore, deleteStore } = useAppStore();
  const isAdmin = user?.role === 'admin' || user?.role === 'super_admin';
  const isSuperAdmin = user?.role === 'super_admin';

  const [storeFilterProvinceId, setStoreFilterProvinceId] = useState<string | null>(null);
  const [storeFilterCityId, setStoreFilterCityId] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [editingStoreId, setEditingStoreId] = useState<string | null>(null);
  const [pageNotice, setPageNotice] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [confirmAction, setConfirmAction] = useState<{
    kind: 'deactivate' | 'delete';
    storeId: string;
    title: string;
    description: string;
    actionLabel: string;
  } | null>(null);
  const [distributors, setDistributors] = useState<{ id: string; email: string }[]>([]);
  const [expandedInvoiceByStore, setExpandedInvoiceByStore] = useState<Record<string, boolean>>({});
  const [isEditorInvoiceExpanded, setIsEditorInvoiceExpanded] = useState(false);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  
  const [form, setForm] = useState({
    name: '',
    city_id: '',
    distributor_id: '',
    discount_rate: '1',
    contact: '',
    address: '',
    phone: '',
    settlement_day: '',
    cooperation_mode: '' as '' | 'consignment' | 'buyout' | 'direct',
    contract_expiry_date: '',
    grade: '' as '' | 'S' | 'A' | 'B' | 'C' | 'D' | 'E',
    contract_file_url: '',
    invoice_title: '',
    tax_id: '',
    bank_name: '',
    bank_account: '',
  });

  const buildInvoiceText = (store: Store): string => {
    return [
      `发票抬头：${store.invoice_title || '-'}`,
      `纳税人识别号：${store.tax_id || '-'}`,
      `开户行：${store.bank_name || '-'}`,
      `账号：${store.bank_account || '-'}`,
    ].join('\n');
  };

  const hasEditorInvoiceInfo = Boolean(form.invoice_title || form.tax_id || form.bank_name || form.bank_account);

  const buildEditorInvoiceText = (): string => {
    return [
      `发票抬头：${form.invoice_title || '-'}`,
      `纳税人识别号：${form.tax_id || '-'}`,
      `开户行：${form.bank_name || '-'}`,
      `账号：${form.bank_account || '-'}`,
    ].join('\n');
  };

  const hasInvoiceInfo = (store: Store): boolean => {
    return Boolean(store.invoice_title || store.tax_id || store.bank_name || store.bank_account);
  };

  const handleCopy = async (text: string, key: string): Promise<void> => {
    if (!text.trim()) {
      setPageNotice({ type: 'error', text: '无可复制内容' });
      return;
    }

    try {
      if (!navigator.clipboard) {
        throw new Error('当前浏览器不支持剪贴板 API');
      }
      await navigator.clipboard.writeText(text);
      setCopiedKey(key);
      setTimeout(() => {
        setCopiedKey((prev) => (prev === key ? null : prev));
      }, 1500);
      setPageNotice({ type: 'success', text: '已复制到剪贴板' });
    } catch (error) {
      setPageNotice({ type: 'error', text: `复制失败：${error instanceof Error ? error.message : '未知错误'}` });
    }
  };

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
    return stores.filter((store) => {
      const city = cities.find((item) => item.id === store.city_id);
      const province = city?.province || (city ? getProvinceForCity(city.name) : null);
      const matchesProvince = storeFilterProvinceId
        ? (storeFilterProvinceId === '未知省份' ? !province : province === storeFilterProvinceId)
        : true;
      const matchesCity = storeFilterCityId ? store.city_id === storeFilterCityId : true;
      return matchesProvince && matchesCity;
    });
  }, [stores, cities, storeFilterProvinceId, storeFilterCityId]);

  const handleCreateStore = async (): Promise<void> => {
    if (!isSuperAdmin) {
      setPageNotice({ type: 'error', text: '仅超级管理员可编辑店铺信息' });
      return;
    }

    if (!form.name.trim() || !form.city_id) {
      setPageNotice({ type: 'error', text: '请完整填写店铺名称、城市' });
      return;
    }

    const settlementDayValue = form.settlement_day.trim();
    const settlementDay = settlementDayValue ? Number(settlementDayValue) : null;
    if (settlementDayValue && (settlementDay === null || !Number.isInteger(settlementDay) || settlementDay < 1 || settlementDay > 31)) {
      setPageNotice({ type: 'error', text: '每月结算日需在 1-31 之间' });
      return;
    }

    const payload = {
      name: form.name.trim(),
      city_id: form.city_id,
      distributor_id: form.distributor_id || null,
      discount_rate: Number(form.discount_rate || 1),
      contact: form.contact.trim(),
      address: form.address.trim(),
      phone: form.phone.trim(),
      settlement_day: settlementDay,
      cooperation_mode: form.cooperation_mode || null,
      contract_expiry_date: form.contract_expiry_date || null,
      grade: (form.grade || null) as Store['grade'] | null,
      contract_file_url: form.contract_file_url || null,
      invoice_title: form.invoice_title.trim() || null,
      tax_id: form.tax_id.trim() || null,
      bank_name: form.bank_name.trim() || null,
      bank_account: form.bank_account.trim() || null,
    };

    const { error } = await addStore(payload);
    if (error) {
      setPageNotice({ type: 'error', text: `新增失败：${error.message}` });
      return;
    }
    setShowCreate(false);
    setForm({ name: '', city_id: '', distributor_id: '', discount_rate: '1', contact: '', address: '', phone: '', settlement_day: '', cooperation_mode: '', contract_expiry_date: '', grade: '', contract_file_url: '', invoice_title: '', tax_id: '', bank_name: '', bank_account: '' });
    setPageNotice({ type: 'success', text: '新增店铺成功' });
  };

  const openCreateModal = (): void => {
    if (!isSuperAdmin) {
      setPageNotice({ type: 'error', text: '仅超级管理员可编辑店铺信息' });
      return;
    }

    setEditingStoreId(null);
    setIsEditorInvoiceExpanded(false);
    setForm({ name: '', city_id: '', distributor_id: '', discount_rate: '1', contact: '', address: '', phone: '', settlement_day: '', cooperation_mode: '', contract_expiry_date: '', grade: '', contract_file_url: '', invoice_title: '', tax_id: '', bank_name: '', bank_account: '' });
    setShowCreate(true);
  };

  const openEditModal = (storeId: string): void => {
    if (!isSuperAdmin) return;

    const store = stores.find((item) => item.id === storeId);
    if (!store) return;

    setEditingStoreId(store.id);
    setIsEditorInvoiceExpanded(false);
    setForm({
      name: store.name,
      city_id: store.city_id,
      distributor_id: store.distributor_id || '',
      discount_rate: String(store.discount_rate || 1),
      contact: store.contact || '',
      address: store.address || '',
      phone: store.phone || '',
      settlement_day: store.settlement_day == null ? '' : String(store.settlement_day),
      cooperation_mode: store.cooperation_mode || '',
      contract_expiry_date: store.contract_expiry_date || '',
      grade: store.grade || '',
      contract_file_url: store.contract_file_url || '',
      invoice_title: store.invoice_title || '',
      tax_id: store.tax_id || '',
      bank_name: store.bank_name || '',
      bank_account: store.bank_account || '',
    });
    setShowCreate(true);
  };

  const handleSaveStore = async (): Promise<void> => {
    if (!isSuperAdmin) {
      setPageNotice({ type: 'error', text: '仅超级管理员可编辑店铺信息' });
      return;
    }

    const settlementDayValue = form.settlement_day.trim();
    const settlementDay = settlementDayValue ? Number(settlementDayValue) : null;
    if (settlementDayValue && (settlementDay === null || !Number.isInteger(settlementDay) || settlementDay < 1 || settlementDay > 31)) {
      setPageNotice({ type: 'error', text: '每月结算日需在 1-31 之间' });
      return;
    }

    if (editingStoreId) {
      const payload = {
        name: form.name.trim(),
        city_id: form.city_id,
        distributor_id: form.distributor_id,
        discount_rate: Number(form.discount_rate || 1),
        contact: form.contact.trim(),
        address: form.address.trim(),
        phone: form.phone.trim(),
        settlement_day: settlementDay,
        cooperation_mode: form.cooperation_mode || null,
        contract_expiry_date: form.contract_expiry_date || null,
        grade: (form.grade || null) as Store['grade'] | null,
        contract_file_url: form.contract_file_url || null,
        invoice_title: form.invoice_title.trim() || null,
        tax_id: form.tax_id.trim() || null,
        bank_name: form.bank_name.trim() || null,
        bank_account: form.bank_account.trim() || null,
      };

      if (!payload.name || !payload.city_id) {
        setPageNotice({ type: 'error', text: '请完整填写店铺名称、城市' });
        return;
      }

      const { error } = await updateStore(editingStoreId, payload);
      if (error) {
        setPageNotice({ type: 'error', text: `更新失败：${error.message}` });
        return;
      }
      setShowCreate(false);
      setEditingStoreId(null);
      setPageNotice({ type: 'success', text: '店铺信息已更新' });
      return;
    }

    await handleCreateStore();
  };

  const handleDeactivate = async (storeId: string, event: React.MouseEvent): Promise<void> => {
    if (!isSuperAdmin) return;

    event.stopPropagation();
    setConfirmAction({
      kind: 'deactivate',
      storeId,
      title: '停用店铺',
      description: '确定要停用该店铺吗？',
      actionLabel: '确认停用',
    });
  };

  const handleReactivate = async (storeId: string, event: React.MouseEvent): Promise<void> => {
    if (!isSuperAdmin) return;

    event.stopPropagation();
    const { error } = await updateStore(storeId, { status: 'active' });
    if (error) {
      setPageNotice({ type: 'error', text: `启用失败：${error.message}` });
      return;
    }
    setPageNotice({ type: 'success', text: '店铺已重新启用' });
  };

  const handleDelete = async (storeId: string, event: React.MouseEvent): Promise<void> => {
    if (!isSuperAdmin) return;

    event.stopPropagation();
    setConfirmAction({
      kind: 'delete',
      storeId,
      title: '删除店铺',
      description: '确定要删除该店铺吗？删除后不可恢复。',
      actionLabel: '确认删除',
    });
  };

  const submitConfirmAction = async (): Promise<void> => {
    if (!isSuperAdmin) {
      setPageNotice({ type: 'error', text: '仅超级管理员可编辑店铺信息' });
      setConfirmAction(null);
      return;
    }

    if (!confirmAction) return;
    if (confirmAction.kind === 'deactivate') {
      const { error } = await deactivateStore(confirmAction.storeId);
      if (error) {
        setPageNotice({ type: 'error', text: `停用失败：${error.message}` });
        return;
      }
      setPageNotice({ type: 'success', text: '店铺已停用' });
      setConfirmAction(null);
      return;
    }

    const { error } = await deleteStore(confirmAction.storeId);
    if (error) {
      setPageNotice({ type: 'error', text: `删除失败：${error.message}` });
      return;
    }
    setPageNotice({ type: 'success', text: '店铺已删除' });
    setConfirmAction(null);
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
      {pageNotice && (
        <div className={`rounded-2xl border px-4 py-3 text-sm ${pageNotice.type === 'success' ? 'bg-emerald-500/10 border-emerald-400/30 text-emerald-200' : 'bg-red-500/10 border-red-400/30 text-red-200'}`}>
          <div className="flex items-center justify-between gap-3">
            <span>{pageNotice.text}</span>
            <button
              type="button"
              onClick={() => setPageNotice(null)}
              className="text-white/60 hover:text-white"
            >
              ×
            </button>
          </div>
        </div>
      )}

      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex-1 min-w-[280px] bg-white/5 border border-white/10 rounded-2xl p-3">
          <div className="flex items-center gap-2 mb-2 text-white/60">
            <div className="w-8 h-8 rounded-lg bg-white/5 border border-white/10 flex items-center justify-center text-white/40">
              <StoreIcon size={14} />
            </div>
            <span className="text-sm font-medium">店铺筛选</span>
          </div>
          <ProvinceCityFilter
            cities={cities}
            selectedProvinceId={storeFilterProvinceId}
            selectedCityId={storeFilterCityId}
            onProvinceChange={setStoreFilterProvinceId}
            onCityChange={setStoreFilterCityId}
            showProvince
          />
        </div>

        {isSuperAdmin ? (
          <button
            type="button"
            onClick={openCreateModal}
            className="bg-tech-gradient px-6 py-2.5 rounded-xl font-bold flex items-center space-x-2 shadow-neon hover:scale-[1.02] transition-all active:scale-[0.98]"
          >
            <Plus size={20} />
            <span>添加新店铺</span>
          </button>
        ) : (
          <div className="px-4 py-2 rounded-xl border border-white/10 bg-white/5 text-xs text-white/60">仅超级管理员可编辑店铺</div>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
        {filteredStores.map((store, index) => (
          <motion.div
            key={store.id}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: index * 0.03 }}
            className="group bg-white/5 border border-white/10 rounded-3xl overflow-hidden hover:border-accent/50 transition-all duration-300 flex flex-col"
            onClick={() => {
              if (isSuperAdmin) {
                openEditModal(store.id);
              }
            }}
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
                  <p className="text-[10px] text-white/40 uppercase font-bold tracking-tighter mb-1">联系人 / 电话</p>
                  <p className="text-sm font-medium text-white/80 truncate">{store.contact || '未填写'}{store.phone ? ` / ${store.phone}` : ''}</p>
                </div>
                <div className="bg-white/5 p-3 rounded-2xl border border-white/5">
                  <p className="text-[10px] text-white/40 uppercase font-bold tracking-tighter mb-1">每月结算日</p>
                  <p className="text-sm font-medium text-white/80 truncate">{store.settlement_day ?? '-'}</p>
                </div>
                <div className="bg-white/5 p-3 rounded-2xl border border-white/5">
                  <p className="text-[10px] text-white/40 uppercase font-bold tracking-tighter mb-1">合作模式</p>
                  <p className="text-sm font-medium text-white/80 truncate">
                    {store.cooperation_mode ? cooperationModeLabelMap[store.cooperation_mode] : '-'}
                  </p>
                </div>
                <div className="bg-white/5 p-3 rounded-2xl border border-white/5">
                  <p className="text-[10px] text-white/40 uppercase font-bold tracking-tighter mb-1">等级 / 合同到期</p>
                  <p className="text-sm font-medium text-white/80 truncate">{store.grade || '-'}{store.contract_expiry_date ? ` / ${store.contract_expiry_date}` : ''}</p>
                </div>
                {store.contract_file_url && (
                  <div className="bg-white/5 p-3 rounded-2xl border border-white/5 col-span-1 md:col-span-2">
                    <p className="text-[10px] text-white/40 uppercase font-bold tracking-tighter mb-1">合同文件</p>
                    <p className="text-sm font-medium text-accent truncate">{store.contract_file_url}</p>
                  </div>
                )}
                {hasInvoiceInfo(store) && (
                  <div className="bg-white/5 p-3 rounded-2xl border border-white/5 col-span-1 md:col-span-2">
                    <div className="flex items-center justify-between gap-2">
                      <button
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation();
                          setExpandedInvoiceByStore((prev) => ({
                            ...prev,
                            [store.id]: !prev[store.id],
                          }));
                        }}
                        className="flex items-center gap-2 text-left"
                      >
                        <span className="text-[10px] text-white/40 uppercase font-bold tracking-tighter">开票信息</span>
                        {expandedInvoiceByStore[store.id] ? <ChevronUp size={14} className="text-white/50" /> : <ChevronDown size={14} className="text-white/50" />}
                      </button>
                      <button
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation();
                          void handleCopy(buildInvoiceText(store), `${store.id}:all`);
                        }}
                        className="inline-flex items-center gap-1 text-xs text-white/70 hover:text-white"
                      >
                        {copiedKey === `${store.id}:all` ? <Check size={14} /> : <Copy size={14} />}
                        一键复制全部
                      </button>
                    </div>
                    {expandedInvoiceByStore[store.id] && (
                      <div className="mt-2 space-y-2">
                        <div className="flex items-center justify-between gap-2 text-sm text-white/80">
                          <span className="truncate">发票抬头：{store.invoice_title || '-'}</span>
                          <button
                            type="button"
                            onClick={(event) => {
                              event.stopPropagation();
                              void handleCopy(store.invoice_title || '', `${store.id}:title`);
                            }}
                            className="text-white/70 hover:text-white"
                            title="复制发票抬头"
                          >
                            {copiedKey === `${store.id}:title` ? <Check size={14} /> : <Copy size={14} />}
                          </button>
                        </div>
                        <div className="flex items-center justify-between gap-2 text-sm text-white/80">
                          <span className="truncate">纳税人识别号：{store.tax_id || '-'}</span>
                          <button
                            type="button"
                            onClick={(event) => {
                              event.stopPropagation();
                              void handleCopy(store.tax_id || '', `${store.id}:tax`);
                            }}
                            className="text-white/70 hover:text-white"
                            title="复制纳税人识别号"
                          >
                            {copiedKey === `${store.id}:tax` ? <Check size={14} /> : <Copy size={14} />}
                          </button>
                        </div>
                        <div className="flex items-center justify-between gap-2 text-sm text-white/80">
                          <span className="truncate">开户行+账号：{store.bank_name || '-'} / {store.bank_account || '-'}</span>
                          <button
                            type="button"
                            onClick={(event) => {
                              event.stopPropagation();
                              void handleCopy(`${store.bank_name || '-'} / ${store.bank_account || '-'}`, `${store.id}:bank`);
                            }}
                            className="text-white/70 hover:text-white"
                            title="复制开户行与账号"
                          >
                            {copiedKey === `${store.id}:bank` ? <Check size={14} /> : <Copy size={14} />}
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>

              <div className="mt-auto flex items-center justify-between pt-4 border-t border-white/5">
                <div className="flex flex-col">
                  <span className="text-[10px] text-white/40 uppercase font-bold tracking-tighter">折扣率</span>
                  <span className="text-sm font-bold text-white/80">{store.discount_rate}</span>
                </div>
                <div className="flex items-center space-x-2">
                  {isSuperAdmin && store.status === 'active' && (
                    <button
                      type="button"
                      onClick={(e) => handleDeactivate(store.id, e)}
                      className="p-2 rounded-xl hover:bg-red-500/20 text-white/40 hover:text-red-400 transition-colors"
                      title="停用店铺"
                    >
                      <PowerOff size={18} />
                    </button>
                  )}
                  {isSuperAdmin && store.status === 'inactive' && (
                    <button
                      type="button"
                      onClick={(e) => handleReactivate(store.id, e)}
                      className="p-2 rounded-xl hover:bg-green-500/20 text-white/40 hover:text-green-400 transition-colors"
                      title="重新启用店铺"
                    >
                      <RotateCcw size={18} />
                    </button>
                  )}
                  {isSuperAdmin && (
                    <>
                      <button
                        type="button"
                        onClick={(e) => handleDelete(store.id, e)}
                        className="p-2 rounded-xl hover:bg-red-500/20 text-white/40 hover:text-red-400 transition-colors"
                        title="删除店铺"
                      >
                        <Trash2 size={18} />
                      </button>
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
                    </>
                  )}
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
        <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4 overflow-y-auto">
          <div className="w-full max-w-lg bg-[#121217] border border-white/10 rounded-3xl p-6 space-y-4 max-h-[80vh] overflow-y-auto">
            <div className="sticky top-0 z-10 -mx-6 px-6 py-1 bg-[#121217] flex items-center justify-between">
              <h3 className="text-xl font-bold">{editingStoreId ? '编辑店铺' : '新增店铺'}</h3>
              <button type="button" onClick={() => setShowCreate(false)} className="p-2 rounded-lg bg-white/10 text-white/60 hover:text-white">
                <X size={16} />
              </button>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <label className="col-span-2 space-y-1 block">
                <span className="text-xs font-bold text-white/40 uppercase tracking-wider">店铺名称</span>
                <input value={form.name} disabled={!isSuperAdmin} onChange={(event) => setForm((prev) => ({ ...prev, name: event.target.value }))} placeholder="店铺名称" className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2 disabled:opacity-60" />
              </label>
              
              <div className="col-span-2 space-y-2">
                <p className="text-xs font-bold text-white/40 uppercase tracking-wider">选择城市</p>
                <div className="flex flex-wrap gap-2">
                  {cities.map((city) => (
                    <button
                      type="button"
                      key={city.id}
                      onClick={() => isSuperAdmin && setForm((prev) => ({ ...prev, city_id: city.id }))}
                      className={`px-3 py-1.5 rounded-xl border text-sm font-medium transition-colors ${form.city_id === city.id ? 'bg-white/10 border-white/20 text-white' : 'bg-white/5 border-white/10 text-white/60 hover:text-white hover:bg-white/10'}`}
                    >
                      {city.name}
                    </button>
                  ))}
                </div>
              </div>

              <label className="col-span-2 space-y-2 block">
                <span className="text-xs font-bold text-white/40 uppercase tracking-wider block">选择分销商</span>
                <select
                  value={form.distributor_id}
                  disabled={!isSuperAdmin}
                  onChange={(event) => setForm((prev) => ({ ...prev, distributor_id: event.target.value }))}
                  className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-white focus:outline-none focus:ring-2 focus:ring-accent/50 disabled:opacity-60"
                >
                  <option value="" className="bg-[#121217]">暂不绑定分销商（后续可编辑）</option>
                  {distributors.map((d) => (
                    <option key={d.id} value={d.id} className="bg-[#121217]">
                      {d.email}
                    </option>
                  ))}
                </select>
              </label>

              <label className="space-y-1 block">
                <span className="text-xs font-bold text-white/40 uppercase tracking-wider">折扣率</span>
                <input value={form.discount_rate} disabled={!isSuperAdmin} onChange={(event) => setForm((prev) => ({ ...prev, discount_rate: event.target.value }))} placeholder="折扣率 (默认1)" className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2 disabled:opacity-60" />
              </label>
              <label className="space-y-1 block">
                <span className="text-xs font-bold text-white/40 uppercase tracking-wider">联系人</span>
                <input value={form.contact} disabled={!isSuperAdmin} onChange={(event) => setForm((prev) => ({ ...prev, contact: event.target.value }))} placeholder="联系人" className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2 disabled:opacity-60" />
              </label>
              <label className="space-y-1 block">
                <span className="text-xs font-bold text-white/40 uppercase tracking-wider">联系电话</span>
                <input value={form.phone} disabled={!isSuperAdmin} onChange={(event) => setForm((prev) => ({ ...prev, phone: event.target.value }))} placeholder="联系电话" className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2 disabled:opacity-60" />
              </label>
              <label className="space-y-1 block">
                <span className="text-xs font-bold text-white/40 uppercase tracking-wider">每月结算日</span>
                <input value={form.settlement_day} disabled={!isSuperAdmin} onChange={(event) => setForm((prev) => ({ ...prev, settlement_day: event.target.value }))} placeholder="1-31（选填）" className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2 disabled:opacity-60" />
              </label>
              <label className="space-y-1 block">
                <span className="text-xs font-bold text-white/40 uppercase tracking-wider">合作模式</span>
                <select value={form.cooperation_mode} disabled={!isSuperAdmin} onChange={(event) => setForm((prev) => ({ ...prev, cooperation_mode: event.target.value as '' | 'consignment' | 'buyout' | 'direct' }))} className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-white disabled:opacity-60">
                  <option value="" className="bg-[#121217]">未设置</option>
                  <option value="consignment" className="bg-[#121217]">寄售</option>
                  <option value="buyout" className="bg-[#121217]">买断</option>
                  <option value="direct" className="bg-[#121217]">直营</option>
                </select>
              </label>
              <label className="col-span-2 space-y-1 block">
                <span className="text-xs font-bold text-white/40 uppercase tracking-wider">详细地址</span>
                <input value={form.address} disabled={!isSuperAdmin} onChange={(event) => setForm((prev) => ({ ...prev, address: event.target.value }))} placeholder="详细地址" className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2 disabled:opacity-60" />
              </label>
              <label className="space-y-1 block">
                <span className="text-xs font-bold text-white/40 uppercase tracking-wider">合同到期日</span>
                <input value={form.contract_expiry_date} disabled={!isSuperAdmin} onChange={(event) => setForm((prev) => ({ ...prev, contract_expiry_date: event.target.value }))} placeholder="如 2026-12-31" className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2 disabled:opacity-60" />
              </label>
              <label className="space-y-1 block">
                <span className="text-xs font-bold text-white/40 uppercase tracking-wider">店铺等级</span>
                <select value={form.grade} disabled={!isSuperAdmin} onChange={(event) => setForm((prev) => ({ ...prev, grade: event.target.value as '' | 'S' | 'A' | 'B' | 'C' | 'D' | 'E' }))} className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-white disabled:opacity-60">
                  <option value="" className="bg-[#121217]">未设置</option>
                  <option value="S" className="bg-[#121217]">S</option>
                  <option value="A" className="bg-[#121217]">A</option>
                  <option value="B" className="bg-[#121217]">B</option>
                  <option value="C" className="bg-[#121217]">C</option>
                  <option value="D" className="bg-[#121217]">D</option>
                  <option value="E" className="bg-[#121217]">E</option>
                </select>
              </label>
              <label className="col-span-2 space-y-1 block">
                <span className="text-xs font-bold text-white/40 uppercase tracking-wider">合同文件链接</span>
                <input value={form.contract_file_url} disabled={!isSuperAdmin} onChange={(event) => setForm((prev) => ({ ...prev, contract_file_url: event.target.value }))} placeholder="合同文件链接" className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2 disabled:opacity-60" />
              </label>
              <label className="col-span-2 space-y-1 block">
                <span className="text-xs font-bold text-white/40 uppercase tracking-wider">发票抬头</span>
                <input value={form.invoice_title} disabled={!isSuperAdmin} onChange={(event) => setForm((prev) => ({ ...prev, invoice_title: event.target.value }))} placeholder="发票抬头" className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2 disabled:opacity-60" />
              </label>
              <label className="col-span-2 space-y-1 block">
                <span className="text-xs font-bold text-white/40 uppercase tracking-wider">纳税人识别号</span>
                <input value={form.tax_id} disabled={!isSuperAdmin} onChange={(event) => setForm((prev) => ({ ...prev, tax_id: event.target.value }))} placeholder="纳税人识别号" className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2 disabled:opacity-60" />
              </label>
              <label className="space-y-1 block">
                <span className="text-xs font-bold text-white/40 uppercase tracking-wider">开户银行</span>
                <input value={form.bank_name} disabled={!isSuperAdmin} onChange={(event) => setForm((prev) => ({ ...prev, bank_name: event.target.value }))} placeholder="开户银行" className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2 disabled:opacity-60" />
              </label>
              <label className="space-y-1 block">
                <span className="text-xs font-bold text-white/40 uppercase tracking-wider">银行账号</span>
                <input value={form.bank_account} disabled={!isSuperAdmin} onChange={(event) => setForm((prev) => ({ ...prev, bank_account: event.target.value }))} placeholder="银行账号" className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2 disabled:opacity-60" />
              </label>

              {hasEditorInvoiceInfo && (
                <div className="col-span-2 bg-white/5 p-3 rounded-2xl border border-white/10">
                  <div className="flex items-center justify-between gap-2">
                    <button
                      type="button"
                      onClick={() => setIsEditorInvoiceExpanded((prev) => !prev)}
                      className="flex items-center gap-2 text-left"
                    >
                      <span className="text-[10px] text-white/40 uppercase font-bold tracking-tighter">开票信息</span>
                      {isEditorInvoiceExpanded ? <ChevronUp size={14} className="text-white/50" /> : <ChevronDown size={14} className="text-white/50" />}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        void handleCopy(buildEditorInvoiceText(), 'editor:all');
                      }}
                      className="inline-flex items-center gap-1 text-xs text-white/70 hover:text-white"
                    >
                      {copiedKey === 'editor:all' ? <Check size={14} /> : <Copy size={14} />}
                      一键复制全部
                    </button>
                  </div>

                  {isEditorInvoiceExpanded && (
                    <div className="mt-2 space-y-2">
                      <div className="flex items-center justify-between gap-2 text-sm text-white/80">
                        <span className="truncate">发票抬头：{form.invoice_title || '-'}</span>
                        <button type="button" onClick={() => { void handleCopy(form.invoice_title || '', 'editor:title'); }} className="text-white/70 hover:text-white" title="复制发票抬头">
                          {copiedKey === 'editor:title' ? <Check size={14} /> : <Copy size={14} />}
                        </button>
                      </div>
                      <div className="flex items-center justify-between gap-2 text-sm text-white/80">
                        <span className="truncate">纳税人识别号：{form.tax_id || '-'}</span>
                        <button type="button" onClick={() => { void handleCopy(form.tax_id || '', 'editor:tax'); }} className="text-white/70 hover:text-white" title="复制纳税人识别号">
                          {copiedKey === 'editor:tax' ? <Check size={14} /> : <Copy size={14} />}
                        </button>
                      </div>
                      <div className="flex items-center justify-between gap-2 text-sm text-white/80">
                        <span className="truncate">开户行+账号：{form.bank_name || '-'} / {form.bank_account || '-'}</span>
                        <button type="button" onClick={() => { void handleCopy(`${form.bank_name || '-'} / ${form.bank_account || '-'}`, 'editor:bank'); }} className="text-white/70 hover:text-white" title="复制开户行与账号">
                          {copiedKey === 'editor:bank' ? <Check size={14} /> : <Copy size={14} />}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setShowCreate(false)} className="px-4 py-2 rounded-xl bg-white/5">取消</button>
              {isSuperAdmin ? (
                <button type="button" onClick={handleSaveStore} className="px-4 py-2 rounded-xl bg-tech-gradient font-bold">保存</button>
              ) : null}
            </div>
          </div>
        </div>
      )}

      {confirmAction && (
        <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4">
          <div className="w-full max-w-md bg-[#121217] border border-white/10 rounded-3xl p-6 space-y-4">
            <h3 className="text-xl font-bold">{confirmAction.title}</h3>
            <p className="text-sm text-white/60 leading-6">{confirmAction.description}</p>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setConfirmAction(null)}
                className="px-4 py-2 rounded-xl bg-white/5"
              >
                取消
              </button>
              <button
                type="button"
                onClick={() => {
                  void submitConfirmAction();
                }}
                className={`px-4 py-2 rounded-xl font-bold ${confirmAction.kind === 'delete' ? 'bg-red-500/80 hover:bg-red-500' : 'bg-tech-gradient'}`}
              >
                {confirmAction.actionLabel}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
