import React, { useEffect, useState, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  Modal,
  TextInput,
  Alert,
  RefreshControl,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Plus, X, ChevronRight, Trash2, Edit2, Calendar, FileText, CheckCircle } from 'lucide-react-native';
import Toast from 'react-native-toast-message';

import { useProductDevStore } from '../store/useProductDevStore';
import { useAppStore } from '../store/useAppStore';
import { Colors, LightColors, DarkColors, Shadow, Radius, Spacing, Typography } from '../theme';
import type { DevelopmentStage, ProductDevelopment, ProductWithDetails, PurchaseOrder } from '../types';

const STAGE_LABELS: Record<DevelopmentStage, string> = {
  concept: '立项',
  artist_search: '约稿',
  design_finalize: '打样',
  factory_search: '生产',
  launched: '已上架',
};

const STAGE_COLORS: Record<DevelopmentStage, string> = {
  concept: Colors.blue,
  artist_search: Colors.gradientMid, // purple
  design_finalize: Colors.warning, // orange
  factory_search: Colors.success, // green
  launched: Colors.textSecondary, // gray
};

const NEXT_STAGE_MAP: Record<DevelopmentStage, DevelopmentStage | null> = {
  concept: 'artist_search',
  artist_search: 'design_finalize',
  design_finalize: 'factory_search',
  factory_search: 'launched',
  launched: null,
};

type ProjectQuickFilter = 'all' | 'inProgress' | 'conceptStage' | 'nearDue' | 'overdue';

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

export default function ProductDevScreen() {
  // 1. Store hooks
  const {
    projects,
    isLoading,
    fetchAllProjects,
    addProject,
    updateProject,
    advanceStage,
    deleteProject,
  } = useProductDevStore();
  const { products, purchaseOrders, fetchProducts, fetchPurchaseOrders } = useAppStore();
  const user = useAppStore((state) => state.user);
  const isDarkMode = useAppStore((state) => state.isDarkMode);
  const theme = isDarkMode ? DarkColors : LightColors;

  // 2. Local state
  const [refreshing, setRefresh] = useState(false);
  const [modalVisible, setModalVisible] = useState(false);
  const [editingProject, setEditingProject] = useState<ProductDevelopment | null>(null);
  const [activeFilter, setActiveFilter] = useState<ProjectQuickFilter>('all');
  
  // Form state
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [notes, setNotes] = useState('');
  const [targetDate, setTargetDate] = useState('');
  const [productId, setProductId] = useState('');
  const [createStage, setCreateStage] = useState<DevelopmentStage>('concept');

  // 3. Derived state
  const stats = useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    let pending = 0;
    let overdue = 0;
    let inProgress = 0;

    projects.forEach(p => {
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
    if (activeFilter === 'all') {
      return projects;
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    return projects.filter((project) => {
      if (activeFilter === 'inProgress') {
        return project.stage !== 'launched';
      }

      if (activeFilter === 'conceptStage') {
        return project.stage === 'concept';
      }

      const timingStatus = getProjectTimingStatus(project, today);
      if (activeFilter === 'nearDue') {
        return timingStatus === 'nearDue';
      }

      return timingStatus === 'overdue';
    });
  }, [activeFilter, projects]);

  const boundProduct = useMemo(() => {
    if (!editingProject || editingProject.stage !== 'launched') {
      return null;
    }

    return resolveBoundProduct(productId, products);
  }, [editingProject, productId, products]);

  const arrivalSummary = useMemo(() => {
    if (!boundProduct) {
      return null;
    }

    return buildArrivalSummary(boundProduct.id, purchaseOrders);
  }, [boundProduct, purchaseOrders]);

  // 4. Effects
  useEffect(() => {
    void Promise.all([fetchAllProjects(), fetchProducts(), fetchPurchaseOrders()]);
  }, [fetchAllProjects, fetchProducts, fetchPurchaseOrders]);

  // 5. Handlers
  const handleRefresh = async () => {
    setRefresh(true);
    await fetchAllProjects();
    setRefresh(false);
  };

  const openCreateModal = () => {
    setEditingProject(null);
    setName('');
    setDescription('');
    setNotes('');
    setTargetDate('');
    setProductId('');
    setCreateStage('concept');
    setModalVisible(true);
  };

  const openEditModal = (project: ProductDevelopment) => {
    setEditingProject(project);
    setName(project.name);
    setDescription(project.description || '');
    setNotes(project.notes || '');
    setTargetDate(project.target_date || '');
    setProductId(project.product_id || '');
    setCreateStage(project.stage);
    setModalVisible(true);
  };

  const handleSave = async () => {
    if (!name.trim()) {
      Toast.show({ type: 'error', text1: '错误', text2: '请输入项目名称' });
      return;
    }

    if (targetDate && !/^\d{4}-\d{2}-\d{2}$/.test(targetDate)) {
      Toast.show({ type: 'error', text1: '错误', text2: '目标日期格式必须为 YYYY-MM-DD' });
      return;
    }

    if (editingProject) {
      const { error } = await updateProject(editingProject.id, {
        name: name.trim(),
        description: description.trim() || null,
        notes: notes.trim() || null,
        target_date: targetDate.trim() || null,
        product_id: productId.trim() || null,
      });

      if (error) {
        Toast.show({ type: 'error', text1: '更新失败', text2: error.message });
        return;
      }
      Toast.show({ type: 'success', text1: '成功', text2: '项目已更新' });
    } else {
      const { error } = await addProject({
        name: name.trim(),
        description: description.trim() || null,
        stage: createStage,
        notes: notes.trim() || null,
        target_date: targetDate.trim() || null,
        product_id: null,
        created_by: user?.id || '',
      });

      if (error) {
        Toast.show({ type: 'error', text1: '创建失败', text2: error.message });
        return;
      }
      Toast.show({ type: 'success', text1: '成功', text2: '项目已创建' });
    }

    setModalVisible(false);
  };

  const handleDelete = (project: ProductDevelopment) => {
    Alert.alert('确认删除', `确定要删除项目 "${project.name}" 吗？此操作不可恢复。`, [
      { text: '取消', style: 'cancel' },
      {
        text: '删除',
        style: 'destructive',
        onPress: async () => {
          const { error } = await deleteProject(project.id);
          if (error) {
            Toast.show({ type: 'error', text1: '删除失败', text2: error.message });
          } else {
            Toast.show({ type: 'success', text1: '成功', text2: '项目已删除' });
          }
        },
      },
    ]);
  };

  const handleAdvanceStage = (project: ProductDevelopment) => {
    const nextStage = NEXT_STAGE_MAP[project.stage];
    if (!nextStage) return;

    Alert.alert(
      '推进阶段',
      `确定将 "${project.name}" 推进到 [${STAGE_LABELS[nextStage]}] 吗？`,
      [
        { text: '取消', style: 'cancel' },
        {
          text: '确定',
          onPress: async () => {
            const { error } = await advanceStage(project.id, nextStage);
            if (error) {
              Toast.show({ type: 'error', text1: '推进失败', text2: error.message });
            } else {
              Toast.show({ type: 'success', text1: '成功', text2: `已推进至 ${STAGE_LABELS[nextStage]}` });
            }
          },
        },
      ]
    );
  };

  const handleRollbackStage = (project: ProductDevelopment, toStage: DevelopmentStage) => {
    Alert.alert(
      '回退阶段',
      `确定将 "${project.name}" 回退到 [${STAGE_LABELS[toStage]}] 吗？`,
      [
        { text: '取消', style: 'cancel' },
        {
          text: '确定',
          style: 'destructive',
          onPress: async () => {
            const { error } = await advanceStage(project.id, toStage);
            if (error) {
              Toast.show({ type: 'error', text1: '回退失败', text2: error.message });
            } else {
              Toast.show({ type: 'success', text1: '成功', text2: `已回退至 ${STAGE_LABELS[toStage]}` });
              setModalVisible(false);
            }
          },
        },
      ]
    );
  };

  const handleTogglePin = async (project: ProductDevelopment): Promise<void> => {
    const nextPinned = !project.is_pinned;
    if (nextPinned) {
      const pinnedCount = projects.filter((item) => item.is_pinned).length;
      if (pinnedCount >= 2) {
        Toast.show({ type: 'error', text1: '错误', text2: '最多只能置顶 2 个项目' });
        return;
      }
    }

    const { error } = await updateProject(project.id, { is_pinned: nextPinned });
    if (error) {
      Toast.show({ type: 'error', text1: '置顶更新失败', text2: error.message });
      return;
    }

    Toast.show({ type: 'success', text1: '成功', text2: nextPinned ? '已置顶项目' : '已取消置顶' });
  };

  // 6. Render helpers
  const renderProjectCard = ({ item }: { item: ProductDevelopment }) => {
    return (
      <TouchableOpacity
        style={[
          styles.compactCard,
          { backgroundColor: theme.surface },
        ]}
        onPress={() => openEditModal(item)}
        activeOpacity={0.7}
      >
        <View style={styles.compactCardRow}>
          <View style={styles.compactCardLeft}>
            <Text style={[styles.compactTitle, { color: theme.textPrimary }]} numberOfLines={1}>
              {item.name}
            </Text>
            {item.is_pinned ? (
              <Text style={[styles.compactPinnedText, { color: theme.warning }]}>置顶</Text>
            ) : null}
          </View>
          <TouchableOpacity
            style={[styles.pinBtn, { borderColor: theme.border }]}
            onPress={() => {
              void handleTogglePin(item);
            }}
          >
            <Text style={[styles.pinBtnText, { color: theme.textSecondary }]}>{item.is_pinned ? '取消置顶' : '置顶'}</Text>
          </TouchableOpacity>
        </View>
      </TouchableOpacity>
    );
  };

  // 7. Return JSX
  return (
    <View style={[styles.container, { backgroundColor: theme.background }]}>
      <LinearGradient
        colors={[theme.pink, theme.blue]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={styles.header}
      >
        <View style={styles.headerTop}>
          <Text style={styles.headerTitle}>产品开发</Text>
          <TouchableOpacity style={styles.addBtn} onPress={openCreateModal}>
            <Plus size={24} color={theme.pink} />
          </TouchableOpacity>
        </View>
        
        <View style={styles.statsRow}>
          <View style={styles.statItem}>
            <Text style={styles.statValue}>{stats.inProgress}</Text>
            <Text style={styles.statLabel}>进行中</Text>
          </View>
          <View style={styles.statDivider} />
          <View style={styles.statItem}>
            <Text style={styles.statValue}>{stats.pending}</Text>
            <Text style={styles.statLabel}>临近</Text>
          </View>
          <View style={styles.statDivider} />
          <View style={styles.statItem}>
            <Text style={[styles.statValue, stats.overdue > 0 && { color: '#FFE5E5' }]}>{stats.overdue}</Text>
            <Text style={styles.statLabel}>逾期</Text>
          </View>
        </View>

        <View style={styles.filterRow}>
          <TouchableOpacity
            style={[styles.filterChip, activeFilter === 'all' && styles.filterChipActive]}
            onPress={() => setActiveFilter('all')}
          >
            <Text style={[styles.filterChipText, activeFilter === 'all' && styles.filterChipTextActive]}>全部</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.filterChip, activeFilter === 'inProgress' && styles.filterChipActive]}
            onPress={() => setActiveFilter('inProgress')}
          >
            <Text style={[styles.filterChipText, activeFilter === 'inProgress' && styles.filterChipTextActive]}>进行中</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.filterChip, activeFilter === 'conceptStage' && styles.filterChipActive]}
            onPress={() => setActiveFilter('conceptStage')}
          >
            <Text style={[styles.filterChipText, activeFilter === 'conceptStage' && styles.filterChipTextActive]}>立项</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.filterChip, activeFilter === 'nearDue' && styles.filterChipActive]}
            onPress={() => setActiveFilter('nearDue')}
          >
            <Text style={[styles.filterChipText, activeFilter === 'nearDue' && styles.filterChipTextActive]}>临近</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.filterChip, activeFilter === 'overdue' && styles.filterChipActive]}
            onPress={() => setActiveFilter('overdue')}
          >
            <Text style={[styles.filterChipText, activeFilter === 'overdue' && styles.filterChipTextActive]}>逾期</Text>
          </TouchableOpacity>
        </View>
      </LinearGradient>

      <FlatList
        data={filteredProjects}
        keyExtractor={(item) => item.id}
        renderItem={renderProjectCard}
        contentContainerStyle={styles.listContent}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor={theme.pink} />
        }
        ListEmptyComponent={
          !isLoading ? (
            <View style={styles.emptyContainer}>
              <Text style={[styles.emptyText, { color: theme.textSecondary }]}>暂无开发项目</Text>
            </View>
          ) : null
        }
      />

      <Modal visible={modalVisible} animationType="slide" transparent>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={styles.modalOverlay}
        >
          <View style={[styles.modalContent, { backgroundColor: theme.surface }]}>
            <View style={styles.modalHeader}>
              <Text style={[styles.modalTitle, { color: theme.textPrimary }]}>
                {editingProject ? '编辑项目' : '新建项目'}
              </Text>
              <TouchableOpacity onPress={() => setModalVisible(false)} style={styles.closeBtn}>
                <X size={24} color={theme.textSecondary} />
              </TouchableOpacity>
            </View>

            <ScrollView style={styles.modalBody} showsVerticalScrollIndicator={false}>
              {editingProject && (
                <View style={styles.stageInfoRow}>
                  <Text style={[styles.label, { color: theme.textSecondary }]}>当前阶段</Text>
                  <View style={[styles.stageBadge, { backgroundColor: `${STAGE_COLORS[editingProject.stage]}20` }]}>
                    <Text style={[styles.stageText, { color: STAGE_COLORS[editingProject.stage] }]}>
                      {STAGE_LABELS[editingProject.stage]}
                    </Text>
                  </View>
                </View>
              )}

              <Text style={[styles.label, { color: theme.textSecondary }]}>项目名称 *</Text>
              <TextInput
                style={[styles.input, { backgroundColor: theme.surfaceSecondary, color: theme.textPrimary }]}
                value={name}
                onChangeText={setName}
                placeholder="输入项目名称"
                placeholderTextColor={theme.textTertiary}
              />

              <Text style={[styles.label, { color: theme.textSecondary }]}>描述 (可选)</Text>
              <TextInput
                style={[styles.input, { backgroundColor: theme.surfaceSecondary, color: theme.textPrimary }]}
                value={description}
                onChangeText={setDescription}
                placeholder="输入项目描述"
                placeholderTextColor={theme.textTertiary}
              />

              {!editingProject && (
                <View>
                  <Text style={[styles.label, { color: theme.textSecondary }]}>当前阶段</Text>
                  <View style={styles.stageSelectRow}>
                    {(Object.keys(STAGE_LABELS) as DevelopmentStage[])
                      .filter((stage) => stage !== 'launched')
                      .map((stage) => (
                        <TouchableOpacity
                          key={stage}
                          style={[
                            styles.stageSelectChip,
                            createStage === stage && styles.stageSelectChipActive,
                            { borderColor: theme.border },
                          ]}
                          onPress={() => setCreateStage(stage)}
                        >
                          <Text style={[
                            styles.stageSelectChipText,
                            { color: createStage === stage ? Colors.pink : theme.textSecondary },
                          ]}
                          >
                            {STAGE_LABELS[stage]}
                          </Text>
                        </TouchableOpacity>
                      ))}
                  </View>
                </View>
              )}

              <Text style={[styles.label, { color: theme.textSecondary }]}>目标日期 (可选)</Text>
              <TextInput
                style={[styles.input, { backgroundColor: theme.surfaceSecondary, color: theme.textPrimary }]}
                value={targetDate}
                onChangeText={setTargetDate}
                placeholder="YYYY-MM-DD"
                placeholderTextColor={theme.textTertiary}
              />

              <Text style={[styles.label, { color: theme.textSecondary }]}>备注 (可选)</Text>
              <TextInput
                style={[styles.input, styles.textArea, { backgroundColor: theme.surfaceSecondary, color: theme.textPrimary }]}
                value={notes}
                onChangeText={setNotes}
                placeholder="输入阶段备注"
                placeholderTextColor={theme.textTertiary}
                multiline
                numberOfLines={3}
                textAlignVertical="top"
              />

              {editingProject?.stage === 'launched' && (
                <>
                  <Text style={[styles.label, { color: theme.textSecondary }]}>关联商品标识（ID 或 EAN-13）</Text>
                  <TextInput
                    style={[styles.input, { backgroundColor: theme.surfaceSecondary, color: theme.textPrimary }]}
                    value={productId}
                    onChangeText={setProductId}
                    placeholder="输入商品ID或13位EAN条码"
                    placeholderTextColor={theme.textTertiary}
                  />

                  <View style={[styles.monitorCard, { backgroundColor: theme.surfaceSecondary, borderColor: theme.border }]}> 
                    <Text style={[styles.monitorTitle, { color: theme.textPrimary }]}>进货到货进度</Text>
                    {!productId.trim() ? (
                      <Text style={[styles.monitorText, { color: theme.textSecondary }]}>请先填写商品标识</Text>
                    ) : !boundProduct ? (
                      <Text style={[styles.monitorText, { color: theme.danger }]}>未匹配到商品，请检查ID或EAN-13</Text>
                    ) : (
                      <>
                        <Text style={[styles.monitorText, { color: theme.textSecondary }]}>
                          商品：{boundProduct.name}
                        </Text>
                        <Text style={[styles.monitorText, { color: theme.textSecondary }]}>
                          EAN：{boundProduct.barcode || '未绑定'}
                        </Text>
                        <Text style={[styles.monitorStatus, { color: theme.textPrimary }]}>状态：{arrivalSummary?.statusLabel}</Text>
                        <Text style={[styles.monitorText, { color: theme.textSecondary }]}>关联进货单：{arrivalSummary?.orderCount || 0}</Text>
                        <Text style={[styles.monitorText, { color: theme.textSecondary }]}>到货数量：{arrivalSummary?.deliveredQuantity || 0} / {arrivalSummary?.orderedQuantity || 0}</Text>
                      </>
                    )}
                  </View>
                </>
              )}

              {editingProject && editingProject.stage !== 'concept' && (
                <View style={styles.rollbackSection}>
                  <Text style={[styles.label, { color: theme.textSecondary, marginTop: Spacing.lg }]}>阶段回退</Text>
                  <View style={styles.rollbackButtons}>
                    {(Object.keys(STAGE_LABELS) as DevelopmentStage[]).map((stage) => {
                      if (stage === editingProject.stage || stage === 'launched') return null;
                      // Only show stages before current stage
                      const stagesOrder: DevelopmentStage[] = ['concept', 'artist_search', 'design_finalize', 'factory_search', 'launched'];
                      if (stagesOrder.indexOf(stage) >= stagesOrder.indexOf(editingProject.stage)) return null;
                      
                      return (
                        <TouchableOpacity
                          key={stage}
                          style={[styles.rollbackBtn, { borderColor: theme.border }]}
                          onPress={() => handleRollbackStage(editingProject, stage)}
                        >
                          <Text style={[styles.rollbackBtnText, { color: theme.textSecondary }]}>
                            退至 {STAGE_LABELS[stage]}
                          </Text>
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                </View>
              )}
            </ScrollView>

            <View style={[styles.modalFooter, { borderTopColor: theme.border }]}>
              {editingProject ? (
                <TouchableOpacity
                  style={[styles.deleteBtn, { backgroundColor: theme.dangerBg }]}
                  onPress={() => {
                    setModalVisible(false);
                    handleDelete(editingProject);
                  }}
                >
                  <Trash2 size={20} color={theme.danger} />
                </TouchableOpacity>
              ) : <View />}
              <TouchableOpacity style={[styles.saveBtn, { backgroundColor: theme.pink }]} onPress={handleSave}>
                <Text style={styles.saveBtnText}>保存</Text>
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

// 8. Styles
const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    paddingTop: Platform.OS === 'ios' ? 50 : 20,
    paddingBottom: Spacing.xl,
    paddingHorizontal: Spacing.lg,
    borderBottomLeftRadius: Radius.xl,
    borderBottomRightRadius: Radius.xl,
    ...Shadow.elevated,
  },
  headerTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: Spacing.lg,
  },
  headerTitle: {
    ...Typography.h1,
    color: '#FFF',
  },
  addBtn: {
    backgroundColor: '#FFF',
    width: 40,
    height: 40,
    borderRadius: Radius.circle,
    justifyContent: 'center',
    alignItems: 'center',
    ...Shadow.soft,
  },
  statsRow: {
    flexDirection: 'row',
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
    borderRadius: Radius.lg,
    padding: Spacing.md,
  },
  filterRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.sm,
    marginTop: Spacing.md,
  },
  filterChip: {
    borderRadius: Radius.pill,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.35)',
    paddingHorizontal: Spacing.md,
    paddingVertical: 6,
    backgroundColor: 'rgba(255, 255, 255, 0.16)',
  },
  filterChipActive: {
    backgroundColor: '#FFF',
    borderColor: '#FFF',
  },
  filterChipText: {
    ...Typography.caption,
    color: 'rgba(255, 255, 255, 0.9)',
    fontWeight: '600',
  },
  filterChipTextActive: {
    color: Colors.pink,
  },
  statItem: {
    flex: 1,
    alignItems: 'center',
  },
  statValue: {
    ...Typography.h2,
    color: '#FFF',
    marginBottom: 2,
  },
  statLabel: {
    ...Typography.caption,
    color: 'rgba(255, 255, 255, 0.8)',
  },
  statDivider: {
    width: 1,
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
    marginVertical: Spacing.sm,
  },
  listContent: {
    padding: Spacing.lg,
    paddingBottom: 100,
  },
  compactCard: {
    borderRadius: Radius.lg,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    minHeight: 56,
    justifyContent: 'center',
    marginBottom: Spacing.sm,
    ...Shadow.card,
  },
  compactCardRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  compactCardLeft: {
    flex: 1,
    marginRight: Spacing.sm,
  },
  compactTitle: {
    ...Typography.body,
    fontWeight: '600',
  },
  compactPinnedText: {
    ...Typography.caption,
    marginTop: 2,
  },
  pinBtn: {
    borderWidth: 1,
    borderRadius: Radius.pill,
    paddingHorizontal: Spacing.sm,
    paddingVertical: 4,
  },
  pinBtnText: {
    ...Typography.caption,
    fontWeight: '600',
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: Spacing.sm,
  },
  cardTitle: {
    ...Typography.h3,
    flex: 1,
    marginRight: Spacing.sm,
  },
  stageBadge: {
    paddingHorizontal: Spacing.sm,
    paddingVertical: 4,
    borderRadius: Radius.pill,
  },
  stageText: {
    ...Typography.caption,
    fontWeight: '600',
  },
  cardDesc: {
    ...Typography.body,
    marginBottom: Spacing.md,
  },
  cardFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
    marginTop: Spacing.sm,
  },
  cardMeta: {
    flex: 1,
    marginRight: Spacing.md,
  },
  metaItem: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 4,
  },
  metaText: {
    ...Typography.caption,
    marginLeft: 6,
    flex: 1,
  },
  cardActions: {
    flexDirection: 'row',
  },
  actionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Spacing.md,
    paddingVertical: 6,
    borderRadius: Radius.pill,
  },
  actionBtnText: {
    color: '#FFF',
    fontSize: 13,
    fontWeight: '600',
    marginRight: 2,
  },
  emptyContainer: {
    padding: Spacing.xxxl,
    alignItems: 'center',
  },
  emptyText: {
    ...Typography.body,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    borderTopLeftRadius: Radius.xl,
    borderTopRightRadius: Radius.xl,
    maxHeight: '90%',
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: Spacing.lg,
    borderBottomWidth: 1,
    borderBottomColor: 'transparent',
  },
  modalTitle: {
    ...Typography.h2,
  },
  closeBtn: {
    padding: Spacing.xs,
  },
  modalBody: {
    padding: Spacing.lg,
  },
  stageInfoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: Spacing.lg,
    paddingBottom: Spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Colors.border,
  },
  label: {
    ...Typography.bodyBold,
    marginBottom: Spacing.sm,
  },
  input: {
    borderRadius: Radius.md,
    padding: Spacing.md,
    marginBottom: Spacing.lg,
    fontSize: 15,
  },
  textArea: {
    height: 80,
  },
  stageSelectRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.sm,
    marginBottom: Spacing.lg,
  },
  stageSelectChip: {
    borderWidth: 1,
    borderRadius: Radius.pill,
    paddingHorizontal: Spacing.md,
    paddingVertical: 6,
    backgroundColor: 'rgba(255,255,255,0.04)',
  },
  stageSelectChipActive: {
    backgroundColor: '#FFF',
  },
  stageSelectChipText: {
    ...Typography.caption,
    fontWeight: '600',
  },
  rollbackSection: {
    marginBottom: Spacing.xl,
  },
  rollbackButtons: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.sm,
  },
  rollbackBtn: {
    borderWidth: 1,
    borderRadius: Radius.pill,
    paddingHorizontal: Spacing.md,
    paddingVertical: 6,
  },
  rollbackBtnText: {
    fontSize: 13,
  },
  monitorCard: {
    borderWidth: 1,
    borderRadius: Radius.md,
    padding: Spacing.md,
    marginBottom: Spacing.lg,
  },
  monitorTitle: {
    ...Typography.bodyBold,
    marginBottom: Spacing.xs,
  },
  monitorStatus: {
    ...Typography.bodyBold,
    marginTop: Spacing.xs,
  },
  monitorText: {
    ...Typography.caption,
    marginTop: 2,
  },
  modalFooter: {
    flexDirection: 'row',
    padding: Spacing.lg,
    borderTopWidth: 1,
    paddingBottom: Platform.OS === 'ios' ? 34 : Spacing.lg,
  },
  deleteBtn: {
    width: 48,
    height: 48,
    borderRadius: Radius.md,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: Spacing.md,
  },
  saveBtn: {
    flex: 1,
    height: 48,
    borderRadius: Radius.md,
    justifyContent: 'center',
    alignItems: 'center',
  },
  saveBtnText: {
    color: '#FFF',
    fontSize: 16,
    fontWeight: '600',
  },
});
