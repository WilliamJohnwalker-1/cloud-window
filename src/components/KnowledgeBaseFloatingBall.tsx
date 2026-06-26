import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Modal,
  FlatList,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { BookOpen, X, Upload, FileText, Trash2, Download } from 'lucide-react-native';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import Toast from 'react-native-toast-message';
import { useAppStore } from '../store/useAppStore';
import { useKnowledgeBaseStore } from '../store/useKnowledgeBaseStore';
import { canViewKnowledgeBase, canManageKnowledgeBase } from '../utils/permissions';
import { Colors, LightColors, DarkColors, Shadow } from '../theme';
import { supabase } from '../lib/supabase';
import type { KnowledgeBaseFile } from '../types';

export default function KnowledgeBaseFloatingBall() {
  const user = useAppStore((state) => state.user);
  const isDarkMode = useAppStore((state) => state.isDarkMode);
  const theme = isDarkMode ? DarkColors : LightColors;

  const { files, isLoading, fetchFiles, uploadFile, deleteFile } = useKnowledgeBaseStore();
  const [modalVisible, setModalVisible] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);

  const canView = canViewKnowledgeBase(user?.role);
  const canManage = canManageKnowledgeBase(user?.role);

  useEffect(() => {
    if (modalVisible && canView) {
      fetchFiles();
    }
  }, [modalVisible, canView, fetchFiles]);

  if (!canView) {
    return null;
  }

  const handleUpload = async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: '*/*',
        copyToCacheDirectory: true,
      });

      if (result.canceled) return;

      const file = result.assets[0];
      if (!file.uri || !file.name) return;

      setIsUploading(true);

      // Read file as base64
      const base64 = await FileSystem.readAsStringAsync(file.uri, {
        encoding: FileSystem.EncodingType.Base64,
      });

      const ext = file.name.split('.').pop()?.toLowerCase() || '';
      const fileName = `${Date.now()}_${Math.random().toString(36).substring(7)}.${ext}`;
      const filePath = `${user?.id}/${fileName}`;

      // Upload to Supabase Storage
      const { error: storageError } = await supabase.storage
        .from('knowledge-base')
        .upload(filePath, decodeBase64(base64), {
          contentType: file.mimeType || 'application/octet-stream',
        });

      if (storageError) throw storageError;

      // Insert into database
      const { error: dbError } = await uploadFile({
        file_name: file.name,
        file_path: filePath,
        file_size: file.size || 0,
        file_type: file.mimeType || 'application/octet-stream',
        category: 'other', // Default category
        uploaded_by: user?.id || '',
      });

      if (dbError) throw dbError;

      Toast.show({ type: 'success', text1: '上传成功' });
    } catch (error) {
      Toast.show({ type: 'error', text1: '上传失败', text2: (error as Error).message });
    } finally {
      setIsUploading(false);
    }
  };

  const handleDelete = (id: string) => {
    Alert.alert('确认删除', '确定要删除这个文件吗？', [
      { text: '取消', style: 'cancel' },
      {
        text: '删除',
        style: 'destructive',
        onPress: async () => {
          const { error } = await deleteFile(id);
          if (error) {
            Toast.show({ type: 'error', text1: '删除失败', text2: error.message });
          } else {
            Toast.show({ type: 'success', text1: '删除成功' });
          }
        },
      },
    ]);
  };

  const handleOpen = async (file: KnowledgeBaseFile) => {
    try {
      setDownloadingId(file.id);

      // Get signed URL or public URL
      const { data } = supabase.storage
        .from('knowledge-base')
        .getPublicUrl(file.file_path);

      if (!data.publicUrl) throw new Error('无法获取文件链接');

      const localUri = `${FileSystem.documentDirectory}${file.file_name}`;
      
      const { uri } = await FileSystem.downloadAsync(data.publicUrl, localUri);

      const canShare = await Sharing.isAvailableAsync();
      if (canShare) {
        await Sharing.shareAsync(uri);
      } else {
        Toast.show({ type: 'error', text1: '无法打开文件', text2: '设备不支持分享/打开文件' });
      }
    } catch (error) {
      Toast.show({ type: 'error', text1: '打开失败', text2: (error as Error).message });
    } finally {
      setDownloadingId(null);
    }
  };

  const renderItem = ({ item }: { item: KnowledgeBaseFile }) => (
    <View style={[styles.fileCard, { backgroundColor: theme.surfaceSecondary }]}>
      <View style={styles.fileInfo}>
        <FileText size={24} color={theme.pink} />
        <View style={styles.fileTextContainer}>
          <Text style={[styles.fileName, { color: theme.textPrimary }]} numberOfLines={1}>
            {item.file_name}
          </Text>
          <Text style={[styles.fileMeta, { color: theme.textSecondary }]}>
            {(item.file_size / 1024 / 1024).toFixed(2)} MB • {new Date(item.created_at).toLocaleDateString()}
          </Text>
        </View>
      </View>
      <View style={styles.fileActions}>
        {downloadingId === item.id ? (
          <ActivityIndicator size="small" color={theme.pink} style={styles.actionBtn} />
        ) : (
          <TouchableOpacity onPress={() => handleOpen(item)} style={styles.actionBtn}>
            <Download size={20} color={theme.textSecondary} />
          </TouchableOpacity>
        )}
        {canManage && (
          <TouchableOpacity onPress={() => handleDelete(item.id)} style={styles.actionBtn}>
            <Trash2 size={20} color={theme.danger} />
          </TouchableOpacity>
        )}
      </View>
    </View>
  );

  return (
    <>
      <TouchableOpacity
        style={[styles.floatingBall, { backgroundColor: theme.pink }]}
        onPress={() => setModalVisible(true)}
        activeOpacity={0.8}
      >
        <BookOpen size={24} color="#FFF" />
      </TouchableOpacity>

      <Modal visible={modalVisible} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setModalVisible(false)}>
        <View style={[styles.modalContainer, { backgroundColor: theme.background }]}>
          <View style={[styles.header, { backgroundColor: theme.surface }]}>
            <Text style={[styles.headerTitle, { color: theme.textPrimary }]}>知识库</Text>
            <View style={styles.headerRight}>
              {canManage && (
                <TouchableOpacity onPress={handleUpload} disabled={isUploading} style={styles.headerBtn}>
                  {isUploading ? (
                    <ActivityIndicator size="small" color={theme.pink} />
                  ) : (
                    <Upload size={24} color={theme.pink} />
                  )}
                </TouchableOpacity>
              )}
              <TouchableOpacity onPress={() => setModalVisible(false)} style={styles.headerBtn}>
                <X size={24} color={theme.textPrimary} />
              </TouchableOpacity>
            </View>
          </View>

          {isLoading && files.length === 0 ? (
            <View style={styles.center}>
              <ActivityIndicator size="large" color={theme.pink} />
            </View>
          ) : (
            <FlatList
              data={files}
              keyExtractor={(item) => item.id}
              renderItem={renderItem}
              contentContainerStyle={styles.listContent}
              ListEmptyComponent={
                <View style={styles.center}>
                  <BookOpen size={48} color={theme.textSecondary} opacity={0.5} />
                  <Text style={[styles.emptyText, { color: theme.textSecondary }]}>暂无文件</Text>
                </View>
              }
            />
          )}
        </View>
      </Modal>
    </>
  );
}

// Helper to decode base64 to Uint8Array for Supabase storage upload
function decodeBase64(base64: string): Uint8Array {
  return new Uint8Array(Buffer.from(base64, 'base64'));
}

const styles = StyleSheet.create({
  floatingBall: {
    position: 'absolute',
    right: 20,
    bottom: 100,
    width: 56,
    height: 56,
    borderRadius: 28,
    justifyContent: 'center',
    alignItems: 'center',
    ...Shadow.elevated,
    zIndex: 999,
  },
  modalContainer: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 60,
    paddingBottom: 16,
    ...Shadow.soft,
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: '700',
  },
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  headerBtn: {
    marginLeft: 16,
    padding: 4,
  },
  listContent: {
    padding: 16,
    flexGrow: 1,
  },
  fileCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 16,
    borderRadius: 12,
    marginBottom: 12,
  },
  fileInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  fileTextContainer: {
    marginLeft: 12,
    flex: 1,
  },
  fileName: {
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 4,
  },
  fileMeta: {
    fontSize: 13,
  },
  fileActions: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  actionBtn: {
    padding: 8,
    marginLeft: 8,
  },
  center: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingTop: 100,
  },
  emptyText: {
    marginTop: 16,
    fontSize: 16,
  },
});
