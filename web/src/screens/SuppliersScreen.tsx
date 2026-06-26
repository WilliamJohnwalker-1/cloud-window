import React, { useEffect, useState } from 'react';
import { Truck, Plus, Edit2, Trash2 } from 'lucide-react';
import { motion } from 'framer-motion';
import { useAppStore } from '../store/useAppStore';
import { useSupplierStore } from '../store/useSupplierStore';
import { canViewSuppliers, canEditSuppliers } from '../utils/permissions';

export const SuppliersScreen: React.FC = () => {
  const { user } = useAppStore();
  const { suppliers, fetchSuppliers, addSupplier, updateSupplier, deleteSupplier } = useSupplierStore();
  
  const canView = canViewSuppliers(user?.role);
  const canEdit = canEditSuppliers(user?.role);

  const [showCreate, setShowCreate] = useState(false);
  const [editingSupplierId, setEditingSupplierId] = useState<string | null>(null);
  const [pageNotice, setPageNotice] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [confirmAction, setConfirmAction] = useState<{
    supplierId: string;
    title: string;
    description: string;
  } | null>(null);

  const [form, setForm] = useState({
    company_name: '',
    delivery_cycle_days: '',
    avg_unit_price: '',
    contact: '',
    phone: '',
    address: '',
    status: 'active' as 'active' | 'inactive',
  });

  useEffect(() => {
    if (canView) {
      void fetchSuppliers();
    }
  }, [canView, fetchSuppliers]);

  const handleCreateSupplier = async (): Promise<void> => {
    if (!canEdit) {
      setPageNotice({ type: 'error', text: '仅超级管理员可编辑供应商信息' });
      return;
    }

    if (!form.company_name.trim()) {
      setPageNotice({ type: 'error', text: '请填写供应商名称' });
      return;
    }

    const payload = {
      company_name: form.company_name.trim(),
      delivery_cycle_days: form.delivery_cycle_days ? Number(form.delivery_cycle_days) : null,
      avg_unit_price: form.avg_unit_price ? Number(form.avg_unit_price) : null,
      contact: form.contact.trim() || null,
      phone: form.phone.trim() || null,
      address: form.address.trim() || null,
      status: 'active' as const,
    };

    const { error } = await addSupplier(payload);
    if (error) {
      setPageNotice({ type: 'error', text: `新增失败：${error.message}` });
      return;
    }
    setShowCreate(false);
    setForm({ company_name: '', delivery_cycle_days: '', avg_unit_price: '', contact: '', phone: '', address: '', status: 'active' });
    setPageNotice({ type: 'success', text: '新增供应商成功' });
  };

  const openCreateModal = (): void => {
    if (!canEdit) {
      setPageNotice({ type: 'error', text: '仅超级管理员可编辑供应商信息' });
      return;
    }

    setEditingSupplierId(null);
    setForm({ company_name: '', delivery_cycle_days: '', avg_unit_price: '', contact: '', phone: '', address: '', status: 'active' });
    setShowCreate(true);
  };

  const openEditModal = (supplierId: string): void => {
    if (!canEdit) return;

    const supplier = suppliers.find((item) => item.id === supplierId);
    if (!supplier) return;

    setEditingSupplierId(supplier.id);
    setForm({
      company_name: supplier.company_name,
      delivery_cycle_days: supplier.delivery_cycle_days == null ? '' : String(supplier.delivery_cycle_days),
      avg_unit_price: supplier.avg_unit_price == null ? '' : String(supplier.avg_unit_price),
      contact: supplier.contact || '',
      phone: supplier.phone || '',
      address: supplier.address || '',
      status: supplier.status,
    });
    setShowCreate(true);
  };

  const handleSaveSupplier = async (): Promise<void> => {
    if (!canEdit) {
      setPageNotice({ type: 'error', text: '仅超级管理员可编辑供应商信息' });
      return;
    }

    if (editingSupplierId) {
      if (!form.company_name.trim()) {
        setPageNotice({ type: 'error', text: '请填写供应商名称' });
        return;
      }

      const payload = {
        company_name: form.company_name.trim(),
        delivery_cycle_days: form.delivery_cycle_days ? Number(form.delivery_cycle_days) : null,
        avg_unit_price: form.avg_unit_price ? Number(form.avg_unit_price) : null,
        contact: form.contact.trim() || null,
        phone: form.phone.trim() || null,
        address: form.address.trim() || null,
        status: form.status,
      };

      const { error } = await updateSupplier(editingSupplierId, payload);
      if (error) {
        setPageNotice({ type: 'error', text: `更新失败：${error.message}` });
        return;
      }
      setShowCreate(false);
      setEditingSupplierId(null);
      setPageNotice({ type: 'success', text: '供应商信息已更新' });
      return;
    }

    await handleCreateSupplier();
  };

  const handleDelete = async (supplierId: string, event: React.MouseEvent): Promise<void> => {
    if (!canEdit) return;

    event.stopPropagation();
    setConfirmAction({
      supplierId,
      title: '删除供应商',
      description: '确定要删除该供应商吗？删除后不可恢复。',
    });
  };

  const submitConfirmAction = async (): Promise<void> => {
    if (!canEdit) {
      setPageNotice({ type: 'error', text: '仅超级管理员可编辑供应商信息' });
      setConfirmAction(null);
      return;
    }

    if (!confirmAction) return;

    const { error } = await deleteSupplier(confirmAction.supplierId);
    if (error) {
      setPageNotice({ type: 'error', text: `删除失败：${error.message}` });
      return;
    }
    setPageNotice({ type: 'success', text: '供应商已删除' });
    setConfirmAction(null);
  };

  if (!canView) {
    return (
      <div className="h-[400px] flex flex-col items-center justify-center text-white/20">
        <Truck size={80} strokeWidth={1} className="mb-4" />
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
          <div className="flex items-center gap-2 text-white/60">
            <div className="w-8 h-8 rounded-lg bg-white/5 border border-white/10 flex items-center justify-center text-white/40">
              <Truck size={14} />
            </div>
            <span className="text-sm font-medium">供应商管理</span>
          </div>
        </div>

        {canEdit ? (
          <button
            type="button"
            onClick={openCreateModal}
            className="bg-tech-gradient px-6 py-2.5 rounded-xl font-bold flex items-center space-x-2 shadow-neon hover:scale-[1.02] transition-all active:scale-[0.98]"
          >
            <Plus size={20} />
            <span>添加新供应商</span>
          </button>
        ) : (
          <div className="px-4 py-2 rounded-xl border border-white/10 bg-white/5 text-xs text-white/60">仅超级管理员可编辑供应商</div>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
        {suppliers.map((supplier, index) => (
          <motion.div
            key={supplier.id}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: index * 0.03 }}
            className="group bg-white/5 border border-white/10 rounded-3xl overflow-hidden hover:border-accent/50 transition-all duration-300 flex flex-col"
            onClick={() => {
              if (canEdit) {
                openEditModal(supplier.id);
              }
            }}
          >
            <div className="p-6 flex-1 flex flex-col">
              <div className="mb-4">
                <div className="flex items-center justify-between">
                  <h3 className="text-lg font-bold group-hover:text-accent transition-colors truncate">{supplier.company_name}</h3>
                  <div className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider ${supplier.status === 'active' ? 'bg-green-500/20 text-green-400' : 'bg-red-500/20 text-red-400'}`}>
                    {supplier.status === 'active' ? '合作中' : '已停用'}
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-1 gap-4 mb-6">
                <div className="bg-white/5 p-3 rounded-2xl border border-white/5">
                  <p className="text-[10px] text-white/40 uppercase font-bold tracking-tighter mb-1">联系人 / 电话</p>
                  <p className="text-sm font-medium text-white/80 truncate">{supplier.contact || '未填写'}{supplier.phone ? ` / ${supplier.phone}` : ''}</p>
                </div>
                <div className="bg-white/5 p-3 rounded-2xl border border-white/5">
                  <p className="text-[10px] text-white/40 uppercase font-bold tracking-tighter mb-1">供货周期 (天)</p>
                  <p className="text-sm font-medium text-white/80 truncate">{supplier.delivery_cycle_days ?? '-'}</p>
                </div>
                <div className="bg-white/5 p-3 rounded-2xl border border-white/5">
                  <p className="text-[10px] text-white/40 uppercase font-bold tracking-tighter mb-1">平均客单价</p>
                  <p className="text-sm font-medium text-white/80 truncate">{supplier.avg_unit_price ?? '-'}</p>
                </div>
              </div>

              <div className="mt-auto flex items-center justify-end pt-4 border-t border-white/5">
                <div className="flex items-center space-x-2">
                  {canEdit && (
                    <>
                      <button
                        type="button"
                        onClick={(e) => handleDelete(supplier.id, e)}
                        className="p-2 rounded-xl hover:bg-red-500/20 text-white/40 hover:text-red-400 transition-colors"
                        title="删除供应商"
                      >
                        <Trash2 size={18} />
                      </button>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          openEditModal(supplier.id);
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

      {suppliers.length === 0 && (
        <div className="h-[400px] flex flex-col items-center justify-center text-white/20">
          <Truck size={80} strokeWidth={1} className="mb-4" />
          <p className="text-xl font-medium">暂无供应商数据</p>
          {canEdit && <p className="text-sm mt-2">点击上方按钮添加您的第一个供应商</p>}
        </div>
      )}

      {showCreate && (
        <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4">
          <div className="w-full max-w-lg bg-[#121217] border border-white/10 rounded-3xl p-6 space-y-4">
            <h3 className="text-xl font-bold">{editingSupplierId ? '编辑供应商' : '新增供应商'}</h3>
            <div className="grid grid-cols-2 gap-3">
              <label className="col-span-2 space-y-1 block">
                <span className="text-xs font-bold text-white/40 uppercase tracking-wider">供应商名称</span>
                <input value={form.company_name} disabled={!canEdit} onChange={(event) => setForm((prev) => ({ ...prev, company_name: event.target.value }))} placeholder="供应商名称" className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2 disabled:opacity-60" />
              </label>
              
              <label className="space-y-1 block">
                <span className="text-xs font-bold text-white/40 uppercase tracking-wider">联系人</span>
                <input value={form.contact} disabled={!canEdit} onChange={(event) => setForm((prev) => ({ ...prev, contact: event.target.value }))} placeholder="联系人" className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2 disabled:opacity-60" />
              </label>
              <label className="space-y-1 block">
                <span className="text-xs font-bold text-white/40 uppercase tracking-wider">联系电话</span>
                <input value={form.phone} disabled={!canEdit} onChange={(event) => setForm((prev) => ({ ...prev, phone: event.target.value }))} placeholder="联系电话" className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2 disabled:opacity-60" />
              </label>
              <label className="space-y-1 block">
                <span className="text-xs font-bold text-white/40 uppercase tracking-wider">供货周期 (天)</span>
                <input value={form.delivery_cycle_days} disabled={!canEdit} onChange={(event) => setForm((prev) => ({ ...prev, delivery_cycle_days: event.target.value }))} placeholder="供货周期" type="number" className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2 disabled:opacity-60" />
              </label>
              <label className="space-y-1 block">
                <span className="text-xs font-bold text-white/40 uppercase tracking-wider">平均客单价</span>
                <input value={form.avg_unit_price} disabled={!canEdit} onChange={(event) => setForm((prev) => ({ ...prev, avg_unit_price: event.target.value }))} placeholder="平均客单价" type="number" step="0.01" className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2 disabled:opacity-60" />
              </label>
              <label className="col-span-2 space-y-1 block">
                <span className="text-xs font-bold text-white/40 uppercase tracking-wider">详细地址</span>
                <input value={form.address} disabled={!canEdit} onChange={(event) => setForm((prev) => ({ ...prev, address: event.target.value }))} placeholder="详细地址" className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2 disabled:opacity-60" />
              </label>
              {editingSupplierId && (
                <label className="col-span-2 space-y-1 block">
                  <span className="text-xs font-bold text-white/40 uppercase tracking-wider">状态</span>
                  <select value={form.status} disabled={!canEdit} onChange={(event) => setForm((prev) => ({ ...prev, status: event.target.value as 'active' | 'inactive' }))} className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-white disabled:opacity-60">
                    <option value="active" className="bg-[#121217]">合作中</option>
                    <option value="inactive" className="bg-[#121217]">已停用</option>
                  </select>
                </label>
              )}
            </div>
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setShowCreate(false)} className="px-4 py-2 rounded-xl bg-white/5">取消</button>
              {canEdit ? (
                <button type="button" onClick={handleSaveSupplier} className="px-4 py-2 rounded-xl bg-tech-gradient font-bold">保存</button>
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
                className="px-4 py-2 rounded-xl font-bold bg-red-500/80 hover:bg-red-500"
              >
                确认删除
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
