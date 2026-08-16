import React, { useEffect, useMemo, useState } from 'react';
import { Edit2, Plus, Trash2, Calendar, FileText, ChevronRight, Lightbulb } from 'lucide-react';
import { motion } from 'framer-motion';

import { useAppStore } from '../store/useAppStore';
import { useProductDevStore } from '../store/useProductDevStore';
import type { DevelopmentStage, ProductDevelopment, ProductWithDetails, PurchaseOrder } from '../types';
import { canViewProductDev } from '../utils/permissions';

const STAGE_LABELS: Record<DevelopmentStage, string> = {
  concept: '立项',
  artist_search: '约稿',
  design_finalize: '打样',
  factory_search: '生产',
  launched: '已上架',
};

const STAGE_COLORS: Record<DevelopmentStage, string> = {
  concept: 'bg-blue-500/15 text-blue-300',
  artist_search: 'bg-purple-500/15 text-purple-300',
  design_finalize: 'bg-orange-500/15 text-orange-300',
  factory_search: 'bg-emerald-500/15 text-emerald-300',
  launched: 'bg-white/10 text-white/50',
};

const NEXT_STAGE_MAP: Record<DevelopmentStage, DevelopmentStage | null> = {
  concept: 'artist_search',
  artist_search: 'design_finalize',
  design_finalize: 'factory_search',
  factory_search: 'launched',
  launched: null,
};

type ProjectQuickFilter = 'all' | 'inProgress' | 'nearDue' | 'overdue';

type ProjectTimingStatus = 'none' | 'nearDue' | 'overdue';

function getProjectTimingStatus(project: ProductDevelopment, today: Date): ProjectTimingStatus {
  if (project.stage === 'launched' || !project.target_date) {
    return 'none';
  }

  const target = new Date(`${project.target_date}T00:00:00`);
  if (target.getTime() < today.getTime()) {
    return 'overdue';
  }

  const diffDays = (target.getTime() - today.getTime()) / (1000 * 60 * 60 * 24);
  if (diffDays <= 3) {
    return 'nearDue';
  }

  return 'none';
}

function resolveBoundProduct(identifier: string, products: ProductWithDetails[]): ProductWithDetails | null {
  const normalized = identifier.trim();
  if (!normalized) {
    return null;
  }

  const byId = products.find((item) => item.id === normalized) || null;
  if (byId) {
    return byId;
  }

  return products.find((item) => item.barcode === normalized) || null;
}

function buildArrivalSummary(productId: string, purchaseOrders: PurchaseOrder[]): {
  orderCount: number;
  orderedQuantity: number;
  deliveredQuantity: number;
  statusLabel: string;
} {
  let orderCount = 0;
  let orderedQuantity = 0;
  let deliveredQuantity = 0;

  purchaseOrders.forEach((order) => {
    let hasMatchedItem = false;
    (order.items || []).forEach((item) => {
      if (item.product_id !== productId) {
        return;
      }

      hasMatchedItem = true;
      orderedQuantity += Number(item.ordered_quantity || 0);
      deliveredQuantity += Number(item.delivered_quantity || 0);
    });

    if (hasMatchedItem) {
      orderCount += 1;
    }
  });

  if (orderCount === 0) {
    return { orderCount, orderedQuantity, deliveredQuantity, statusLabel: '未下进货单' };
  }

  if (deliveredQuantity >= orderedQuantity && orderedQuantity > 0) {
    return { orderCount, orderedQuantity, deliveredQuantity, statusLabel: '已全部到货' };
  }

  return { orderCount, orderedQuantity, deliveredQuantity, statusLabel: '到货中' };
}

interface PageNotice {
  type: 'success' | 'error';
  text: string;
}

interface ConfirmAction {
  projectId: string;
  actionType: 'delete' | 'advance' | 'rollback';
  targetStage?: DevelopmentStage;
  title: string;
  description: string;
}

export const ProductDevScreen: React.FC = () => {
  const { user, products, purchaseOrders, fetchProducts, fetchPurchaseOrders } = useAppStore();
  const {
    projects,
    isLoading,
    error,
    fetchAllProjects,
    addProject,
    updateProject,
    advanceStage,
    deleteProject,
  } = useProductDevStore();

  const canView = canViewProductDev(user?.role);

  const [showCreate, setShowCreate] = useState(false);
  const [editingProjectId, setEditingProjectId] = useState<string | null>(null);
  const [pageNotice, setPageNotice] = useState<PageNotice | null>(null);
  const [confirmAction, setConfirmAction] = useState<ConfirmAction | null>(null);
  const [activeFilter, setActiveFilter] = useState<ProjectQuickFilter>('all');
  const [stageFilter, setStageFilter] = useState<DevelopmentStage | 'all'>('all');

  const [form, setForm] = useState({
    name: '',
    description: '',
    stage: 'concept' as DevelopmentStage,
    notes: '',
    target_date: '',
    product_id: '',
  });

  const stats = useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    let pending = 0;
    let overdue = 0;
    let inProgress = 0;

    projects.forEach((p) => {
      if (p.stage === 'launched') return;

      inProgress++;

      const timingStatus = getProjectTimingStatus(p, today);
      if (timingStatus === 'overdue') {
        overdue++;
      } else if (timingStatus === 'nearDue') {
        pending++;
      }
    });

    return { pending, overdue, inProgress };
  }, [projects]);

  const filteredProjects = useMemo(() => {
    const stageFilteredProjects = stageFilter === 'all'
      ? projects
      : projects.filter((project) => project.stage === stageFilter);

    if (activeFilter === 'all') {
      return stageFilteredProjects;
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    return stageFilteredProjects.filter((project) => {
      if (activeFilter === 'inProgress') {
        return project.stage !== 'launched';
      }

      const timingStatus = getProjectTimingStatus(project, today);
      if (activeFilter === 'nearDue') {
        return timingStatus === 'nearDue';
      }

      return timingStatus === 'overdue';
    });
  }, [activeFilter, projects, stageFilter]);

  const editingProject = projects.find((p) => p.id === editingProjectId);

  const boundProduct = useMemo(() => {
    if (!editingProject || editingProject.stage !== 'launched') {
      return null;
    }

    return resolveBoundProduct(form.product_id, products);
  }, [editingProject, form.product_id, products]);

  const arrivalSummary = useMemo(() => {
    if (!boundProduct) {
      return null;
    }

    return buildArrivalSummary(boundProduct.id, purchaseOrders);
  }, [boundProduct, purchaseOrders]);

  useEffect(() => {
    if (!canView) return;
    void Promise.all([fetchAllProjects(), fetchProducts(), fetchPurchaseOrders()]);
  }, [canView, fetchAllProjects, fetchProducts, fetchPurchaseOrders]);

  useEffect(() => {
    if (!error) return;
    setPageNotice({ type: 'error', text: error });
  }, [error]);

  const openCreateModal = () => {
    setEditingProjectId(null);
    setForm({
      name: '',
      description: '',
      stage: 'concept',
      notes: '',
      target_date: '',
      product_id: '',
    });
    setShowCreate(true);
  };

  const openEditModal = (project: ProductDevelopment) => {
    setEditingProjectId(project.id);
    setForm({
      name: project.name,
      description: project.description || '',
      stage: project.stage,
      notes: project.notes || '',
      target_date: project.target_date || '',
      product_id: project.product_id || '',
    });
    setShowCreate(true);
  };

  const handleSave = async () => {
    if (!form.name.trim()) {
      setPageNotice({ type: 'error', text: '请输入项目名称' });
      return;
    }

    if (form.target_date && !/^\d{4}-\d{2}-\d{2}$/.test(form.target_date)) {
      setPageNotice({ type: 'error', text: '目标日期格式必须为 YYYY-MM-DD' });
      return;
    }

    if (editingProjectId) {
      const { error: updateError } = await updateProject(editingProjectId, {
        name: form.name.trim(),
        description: form.description.trim() || null,
        notes: form.notes.trim() || null,
        target_date: form.target_date.trim() || null,
        product_id: form.product_id.trim() || null,
      });

      if (updateError) {
        setPageNotice({ type: 'error', text: `更新失败：${updateError.message}` });
        return;
      }
      setPageNotice({ type: 'success', text: '项目已更新' });
    } else {
      const { error: createError } = await addProject({
        name: form.name.trim(),
        description: form.description.trim() || null,
        stage: form.stage,
        notes: form.notes.trim() || null,
        target_date: form.target_date.trim() || null,
        product_id: null,
        created_by: user?.id || '',
      });

      if (createError) {
        setPageNotice({ type: 'error', text: `创建失败：${createError.message}` });
        return;
      }
      setPageNotice({ type: 'success', text: '项目已创建' });
    }

    setShowCreate(false);
  };

  const handleDelete = (project: ProductDevelopment, event: React.MouseEvent) => {
    event.stopPropagation();
    setConfirmAction({
      projectId: project.id,
      actionType: 'delete',
      title: '删除项目',
      description: `确定要删除项目 "${project.name}" 吗？此操作不可恢复。`,
    });
  };

  const handleAdvanceStage = (project: ProductDevelopment, event: React.MouseEvent) => {
    event.stopPropagation();
    const nextStage = NEXT_STAGE_MAP[project.stage];
    if (!nextStage) return;

    setConfirmAction({
      projectId: project.id,
      actionType: 'advance',
      targetStage: nextStage,
      title: '推进阶段',
      description: `确定将 "${project.name}" 推进到 [${STAGE_LABELS[nextStage]}] 吗？`,
    });
  };

  const handleRollbackStage = (project: ProductDevelopment, toStage: DevelopmentStage) => {
    setConfirmAction({
      projectId: project.id,
      actionType: 'rollback',
      targetStage: toStage,
      title: '回退阶段',
      description: `确定将 "${project.name}" 回退到 [${STAGE_LABELS[toStage]}] 吗？`,
    });
  };

  const handleTogglePin = async (project: ProductDevelopment, event: React.MouseEvent): Promise<void> => {
    event.stopPropagation();
    const nextPinned = !project.is_pinned;
    if (nextPinned) {
      const pinnedCount = projects.filter((item) => item.is_pinned).length;
      if (pinnedCount >= 2) {
        setPageNotice({ type: 'error', text: '最多只能置顶 2 个项目' });
        return;
      }
    }

    const { error: updateError } = await updateProject(project.id, { is_pinned: nextPinned });
    if (updateError) {
      setPageNotice({ type: 'error', text: `置顶更新失败：${updateError.message}` });
      return;
    }
    setPageNotice({ type: 'success', text: nextPinned ? '已置顶项目' : '已取消置顶' });
  };

  const submitConfirmAction = async () => {
    if (!confirmAction) return;

    if (confirmAction.actionType === 'delete') {
      const { error: deleteError } = await deleteProject(confirmAction.projectId);
      if (deleteError) {
        setPageNotice({ type: 'error', text: `删除失败：${deleteError.message}` });
      } else {
        setPageNotice({ type: 'success', text: '项目已删除' });
      }
    } else if (confirmAction.actionType === 'advance' || confirmAction.actionType === 'rollback') {
      if (confirmAction.targetStage) {
        const { error: advanceError } = await advanceStage(confirmAction.projectId, confirmAction.targetStage);
        if (advanceError) {
          setPageNotice({ type: 'error', text: `操作失败：${advanceError.message}` });
        } else {
          setPageNotice({ type: 'success', text: `已更新至 ${STAGE_LABELS[confirmAction.targetStage]}` });
          if (confirmAction.actionType === 'advance') {
            setShowCreate(false);
          }
        }
      }
    }

    setConfirmAction(null);
  };

  if (!canView) {
    return (
      <div className="h-[400px] flex flex-col items-center justify-center text-white/20">
        <Lightbulb size={80} strokeWidth={1} className="mb-4" />
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
        <div className="flex gap-4 flex-wrap">
          <div className="min-w-[140px] bg-white/5 border border-white/10 rounded-2xl p-4">
            <div className="text-xs text-white/40 uppercase tracking-wider">进行中</div>
            <div className="text-3xl font-bold mt-2">{stats.inProgress}</div>
          </div>
          <div className="min-w-[140px] bg-white/5 border border-white/10 rounded-2xl p-4">
            <div className="text-xs text-white/40 uppercase tracking-wider">临近</div>
            <div className="text-3xl font-bold mt-2">{stats.pending}</div>
          </div>
          <div className={`min-w-[140px] rounded-2xl p-4 border ${stats.overdue > 0 ? 'bg-red-500/10 border-red-500/30' : 'bg-white/5 border-white/10'}`}>
            <div className={`text-xs uppercase tracking-wider ${stats.overdue > 0 ? 'text-red-300/70' : 'text-white/40'}`}>逾期</div>
            <div className={`text-3xl font-bold mt-2 ${stats.overdue > 0 ? 'text-red-400' : 'text-white'}`}>{stats.overdue}</div>
          </div>
        </div>

        <div className="flex items-center gap-2 flex-wrap w-full md:w-auto">
          <button
            type="button"
            onClick={() => setActiveFilter('all')}
            className={`px-3 py-1.5 rounded-xl text-sm border transition-colors ${activeFilter === 'all' ? 'bg-white text-black border-white' : 'bg-white/10 border-white/20 text-white/80 hover:bg-white/15'}`}
          >
            全部
          </button>
          <button
            type="button"
            onClick={() => setActiveFilter('inProgress')}
            className={`px-3 py-1.5 rounded-xl text-sm border transition-colors ${activeFilter === 'inProgress' ? 'bg-white text-black border-white' : 'bg-white/10 border-white/20 text-white/80 hover:bg-white/15'}`}
          >
            进行中
          </button>
          <button
            type="button"
            onClick={() => setActiveFilter('nearDue')}
            className={`px-3 py-1.5 rounded-xl text-sm border transition-colors ${activeFilter === 'nearDue' ? 'bg-white text-black border-white' : 'bg-white/10 border-white/20 text-white/80 hover:bg-white/15'}`}
          >
            临近
          </button>
          <button
            type="button"
            onClick={() => setActiveFilter('overdue')}
            className={`px-3 py-1.5 rounded-xl text-sm border transition-colors ${activeFilter === 'overdue' ? 'bg-white text-black border-white' : 'bg-white/10 border-white/20 text-white/80 hover:bg-white/15'}`}
          >
            逾期
          </button>
          <select
            value={stageFilter}
            onChange={(event) => setStageFilter(event.target.value as DevelopmentStage | 'all')}
            className="px-3 py-1.5 rounded-xl text-sm border bg-white/10 border-white/20 text-white/90"
          >
            <option value="all">全部阶段</option>
            {(Object.keys(STAGE_LABELS) as DevelopmentStage[]).map((stage) => (
              <option key={stage} value={stage}>
                {STAGE_LABELS[stage]}
              </option>
            ))}
          </select>
        </div>

        <button
          type="button"
          onClick={openCreateModal}
          className="bg-tech-gradient px-6 py-2.5 rounded-xl font-bold flex items-center space-x-2 shadow-neon hover:scale-[1.02] transition-all active:scale-[0.98]"
        >
          <Plus size={20} />
          <span>新建项目</span>
        </button>
      </div>

      {isLoading && projects.length === 0 ? (
        <div className="h-[320px] flex items-center justify-center text-white/40">正在加载项目...</div>
      ) : null}

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {filteredProjects.map((project, index) => {
          const isOverdue = (() => {
            if (project.stage === 'launched' || !project.target_date) return false;
            const target = new Date(`${project.target_date}T00:00:00`);
            const today = new Date();
            today.setHours(0, 0, 0, 0);
            return target.getTime() < today.getTime();
          })();

          const nextStage = NEXT_STAGE_MAP[project.stage];

          return (
            <motion.div
              key={project.id}
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: index * 0.03 }}
              className={`group border rounded-3xl p-6 transition-all duration-300 cursor-pointer ${
                isOverdue
                  ? 'bg-red-500/5 border-red-500/30 hover:border-red-500/50'
                  : 'bg-white/5 border-white/10 hover:border-accent/40'
              }`}
              onClick={() => openEditModal(project)}
            >
              <div className="flex items-start justify-between gap-4 mb-3">
                <h3 className="text-lg font-bold text-white truncate flex-1">{project.name}</h3>
                <div className="flex items-center gap-2">
                  {project.is_pinned ? (
                    <span className="px-2.5 py-1 rounded-full text-[11px] font-bold uppercase tracking-wider whitespace-nowrap bg-yellow-500/20 text-yellow-300">
                      置顶
                    </span>
                  ) : null}
                  <span className={`px-2.5 py-1 rounded-full text-[11px] font-bold uppercase tracking-wider whitespace-nowrap ${STAGE_COLORS[project.stage]}`}>
                    {STAGE_LABELS[project.stage]}
                  </span>
                </div>
              </div>

              {project.description ? (
                <p className="text-sm text-white/50 mb-4 line-clamp-2">{project.description}</p>
              ) : null}

              <div className="space-y-2 mt-auto">
                {project.target_date && (
                  <div className="flex items-center gap-2">
                    <Calendar size={14} className={isOverdue ? 'text-red-400' : 'text-white/40'} />
                    <span className={`text-sm ${isOverdue ? 'text-red-400 font-medium' : 'text-white/60'}`}>
                      {project.target_date}
                    </span>
                  </div>
                )}
                {project.notes && (
                  <div className="flex items-center gap-2">
                    <FileText size={14} className="text-white/40" />
                    <span className="text-sm text-white/60 truncate">{project.notes}</span>
                  </div>
                )}
              </div>

              <div className="mt-5 pt-4 border-t border-white/5 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={(event) => {
                      void handleTogglePin(project, event);
                    }}
                    className="px-2.5 py-1.5 rounded-xl border border-white/10 text-xs text-white/70 hover:text-white hover:bg-white/10 transition-colors"
                    title={project.is_pinned ? '取消置顶' : '置顶项目'}
                  >
                    {project.is_pinned ? '取消置顶' : '置顶'}
                  </button>
                  <button
                    type="button"
                    onClick={(event) => handleDelete(project, event)}
                    className="p-2 rounded-xl hover:bg-red-500/20 text-white/50 hover:text-red-400 transition-colors"
                    title="删除项目"
                  >
                    <Trash2 size={18} />
                  </button>
                </div>
                {nextStage && (
                  <button
                    type="button"
                    onClick={(event) => handleAdvanceStage(project, event)}
                    className="flex items-center gap-1 px-3 py-1.5 rounded-xl bg-accent/20 text-accent hover:bg-accent/30 transition-colors text-sm font-medium"
                  >
                    <span>下一阶段</span>
                    <ChevronRight size={14} />
                  </button>
                )}
              </div>
            </motion.div>
          );
        })}
      </div>

      {!isLoading && projects.length === 0 ? (
        <div className="h-[320px] flex flex-col items-center justify-center text-white/20">
          <Lightbulb size={80} strokeWidth={1} className="mb-4" />
          <p className="text-xl font-medium">暂无开发项目</p>
        </div>
      ) : null}

      {showCreate && (
        <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4">
          <div className="w-full max-w-2xl bg-[#121217] border border-white/10 rounded-3xl p-6 space-y-4 max-h-[90vh] overflow-y-auto">
            <h3 className="text-xl font-bold">{editingProjectId ? '编辑项目' : '新建项目'}</h3>
            
            {editingProject && (
              <div className="flex items-center justify-between pb-4 border-b border-white/10">
                <span className="text-sm font-bold text-white/40">当前阶段</span>
                <span className={`px-2.5 py-1 rounded-full text-[11px] font-bold uppercase tracking-wider ${STAGE_COLORS[editingProject.stage]}`}>
                  {STAGE_LABELS[editingProject.stage]}
                </span>
              </div>
            )}

            <div className="space-y-4">
              <label className="space-y-1 block">
                <span className="text-xs font-bold text-white/40 uppercase tracking-wider">项目名称 *</span>
                <input
                  value={form.name}
                  onChange={(event) => setForm((prev) => ({ ...prev, name: event.target.value }))}
                  placeholder="输入项目名称"
                  className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-white"
                />
              </label>

              <label className="space-y-1 block">
                <span className="text-xs font-bold text-white/40 uppercase tracking-wider">描述 (可选)</span>
                <input
                  value={form.description}
                  onChange={(event) => setForm((prev) => ({ ...prev, description: event.target.value }))}
                  placeholder="输入项目描述"
                  className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-white"
                />
              </label>

              {!editingProjectId && (
                <div className="space-y-2">
                  <span className="text-xs font-bold text-white/40 uppercase tracking-wider">当前阶段</span>
                  <div className="flex flex-wrap gap-2">
                    {(Object.keys(STAGE_LABELS) as DevelopmentStage[])
                      .filter((stage) => stage !== 'launched')
                      .map((stage) => (
                        <button
                          key={stage}
                          type="button"
                          onClick={() => setForm((prev) => ({ ...prev, stage }))}
                          className={`px-3 py-1.5 rounded-xl border text-sm transition-colors ${form.stage === stage ? 'bg-white text-black border-white' : 'bg-white/5 border-white/10 text-white/70 hover:text-white hover:bg-white/10'}`}
                        >
                          {STAGE_LABELS[stage]}
                        </button>
                      ))}
                  </div>
                </div>
              )}

              <label className="space-y-1 block">
                <span className="text-xs font-bold text-white/40 uppercase tracking-wider">目标日期 (可选)</span>
                <input
                  type="date"
                  value={form.target_date}
                  onChange={(event) => setForm((prev) => ({ ...prev, target_date: event.target.value }))}
                  className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-white"
                />
              </label>

              <label className="space-y-1 block">
                <span className="text-xs font-bold text-white/40 uppercase tracking-wider">备注 (可选)</span>
                <textarea
                  value={form.notes}
                  onChange={(event) => setForm((prev) => ({ ...prev, notes: event.target.value }))}
                  placeholder="输入阶段备注"
                  rows={3}
                  className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-white resize-none"
                />
              </label>

              {editingProject?.stage === 'launched' && (
                <label className="space-y-1 block">
                  <span className="text-xs font-bold text-white/40 uppercase tracking-wider">关联商品标识（ID 或 EAN-13）</span>
                  <input
                    value={form.product_id}
                    onChange={(event) => setForm((prev) => ({ ...prev, product_id: event.target.value }))}
                    placeholder="输入商品ID或13位EAN条码"
                    className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-white"
                  />

                  <div className="mt-3 rounded-xl border border-white/10 bg-white/5 p-3 space-y-1">
                    <div className="text-sm font-semibold text-white">进货到货进度</div>
                    {!form.product_id.trim() ? (
                      <div className="text-xs text-white/60">请先填写商品标识</div>
                    ) : !boundProduct ? (
                      <div className="text-xs text-red-300">未匹配到商品，请检查ID或EAN-13</div>
                    ) : (
                      <>
                        <div className="text-xs text-white/70">商品：{boundProduct.name}</div>
                        <div className="text-xs text-white/70">EAN：{boundProduct.barcode || '未绑定'}</div>
                        <div className="text-xs text-white/90 font-semibold">状态：{arrivalSummary?.statusLabel}</div>
                        <div className="text-xs text-white/70">关联进货单：{arrivalSummary?.orderCount || 0}</div>
                        <div className="text-xs text-white/70">到货数量：{arrivalSummary?.deliveredQuantity || 0} / {arrivalSummary?.orderedQuantity || 0}</div>
                      </>
                    )}
                  </div>
                </label>
              )}

              {editingProject && editingProject.stage !== 'concept' && (
                <div className="pt-4">
                  <span className="text-xs font-bold text-white/40 uppercase tracking-wider block mb-2">阶段回退</span>
                  <div className="flex flex-wrap gap-2">
                    {(Object.keys(STAGE_LABELS) as DevelopmentStage[]).map((stage) => {
                      if (stage === editingProject.stage || stage === 'launched') return null;
                      const stagesOrder: DevelopmentStage[] = ['concept', 'artist_search', 'design_finalize', 'factory_search', 'launched'];
                      if (stagesOrder.indexOf(stage) >= stagesOrder.indexOf(editingProject.stage)) return null;
                      
                      return (
                        <button
                          key={stage}
                          type="button"
                          onClick={() => handleRollbackStage(editingProject, stage)}
                          className="px-3 py-1.5 rounded-xl border border-white/10 text-sm text-white/60 hover:text-white hover:bg-white/5 transition-colors"
                        >
                          退至 {STAGE_LABELS[stage]}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>

            <div className="flex justify-end gap-2 pt-4 border-t border-white/10">
              <button
                type="button"
                onClick={() => setShowCreate(false)}
                className="px-4 py-2 rounded-xl bg-white/5"
              >
                取消
              </button>
              <button
                type="button"
                onClick={() => {
                  void handleSave();
                }}
                className="px-4 py-2 rounded-xl bg-tech-gradient font-bold"
              >
                保存
              </button>
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
                className={`px-4 py-2 rounded-xl font-bold ${
                  confirmAction.actionType === 'delete' ? 'bg-red-500/80 hover:bg-red-500' : 'bg-tech-gradient'
                }`}
              >
                确认
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
