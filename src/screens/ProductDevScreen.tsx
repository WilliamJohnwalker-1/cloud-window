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
import type { DevelopmentStage, ProductDevelopment } from '../types';

const STAGE_LABELS: Record<DevelopmentStage, string> = {
  concept: '立项',
  artist_search: '找画手',
  design_finalize: '定稿',
  factory_search: '找工厂',
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
  const user = useAppStore((state) => state.user);
  const isDarkMode = useAppStore((state) => state.isDarkMode);
  const theme = isDarkMode ? DarkColors : LightColors;

  // 2. Local state
  const [refreshing, setRefresh] = useState(false);
  const [modalVisible, setModalVisible] = useState(false);
  const [editingProject, setEditingProject] = useState<ProductDevelopment | null>(null);
  
  // Form state
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [notes, setNotes] = useState('');
  const [targetDate, setTargetDate] = useState('');
  const [productId, setProductId] = useState('');

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
      
      if (p.target_date) {
        const target = new Date(`${p.target_date}T00:00:00`);
        if (target.getTime() < today.getTime()) {
          overdue++;
        } else {
          const diffDays = (target.getTime() - today.getTime()) / (1000 * 60 * 60 * 24);
          if (diffDays <= 3) {
            pending++;
          }
        }
      }
    });

    return { pending, overdue, inProgress };
  }, [projects]);

  // 4. Effects
  useEffect(() => {
    fetchAllProjects();
  }, [fetchAllProjects]);

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
    setModalVisible(true);
  };

  const openEditModal = (project: ProductDevelopment) => {
    setEditingProject(project);
    setName(project.name);
    setDescription(project.description || '');
    setNotes(project.notes || '');
    setTargetDate(project.target_date || '');
    setProductId(project.product_id || '');
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
        stage: 'concept',
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

  // 6. Render helpers
  const renderProjectCard = ({ item }: { item: ProductDevelopment }) => {
    const isOverdue = (() => {
      if (item.stage === 'launched' || !item.target_date) return false;
      const target = new Date(`${item.target_date}T00:00:00`);
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      return target.getTime() < today.getTime();
    })();

    const stageColor = STAGE_COLORS[item.stage];
    const nextStage = NEXT_STAGE_MAP[item.stage];

    return (
      <TouchableOpacity
        style={[
          styles.card,
          { backgroundColor: theme.surface },
          isOverdue && { borderColor: theme.danger, borderWidth: 1, backgroundColor: theme.dangerBg }
        ]}
        onPress={() => openEditModal(item)}
        activeOpacity={0.7}
      >
        <View style={styles.cardHeader}>
          <Text style={[styles.cardTitle, { color: theme.textPrimary }]} numberOfLines={1}>
            {item.name}
          </Text>
          <View style={[styles.stageBadge, { backgroundColor: `${stageColor}20` }]}>
            <Text style={[styles.stageText, { color: stageColor }]}>{STAGE_LABELS[item.stage]}</Text>
          </View>
        </View>

        {item.description ? (
          <Text style={[styles.cardDesc, { color: theme.textSecondary }]} numberOfLines={2}>
            {item.description}
          </Text>
        ) : null}

        <View style={styles.cardFooter}>
          <View style={styles.cardMeta}>
            {item.target_date && (
              <View style={styles.metaItem}>
                <Calendar size={14} color={isOverdue ? theme.danger : theme.textSecondary} />
                <Text style={[styles.metaText, { color: isOverdue ? theme.danger : theme.textSecondary }]}>
                  {item.target_date}
                </Text>
              </View>
            )}
            {item.notes && (
              <View style={styles.metaItem}>
                <FileText size={14} color={theme.textSecondary} />
                <Text style={[styles.metaText, { color: theme.textSecondary }]} numberOfLines={1}>
                  {item.notes}
                </Text>
              </View>
            )}
          </View>

          <View style={styles.cardActions}>
            {nextStage && (
              <TouchableOpacity
                style={[styles.actionBtn, { backgroundColor: theme.pink }]}
                onPress={() => handleAdvanceStage(item)}
              >
                <Text style={styles.actionBtnText}>下一阶段</Text>
                <ChevronRight size={14} color="#FFF" />
              </TouchableOpacity>
            )}
          </View>
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
      </LinearGradient>

      <FlatList
        data={projects}
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
                  <Text style={[styles.label, { color: theme.textSecondary }]}>关联商品ID (可选)</Text>
                  <TextInput
                    style={[styles.input, { backgroundColor: theme.surfaceSecondary, color: theme.textPrimary }]}
                    value={productId}
                    onChangeText={setProductId}
                    placeholder="输入已上架的商品ID"
                    placeholderTextColor={theme.textTertiary}
                  />
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
  card: {
    borderRadius: Radius.lg,
    padding: Spacing.lg,
    marginBottom: Spacing.md,
    ...Shadow.card,
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
