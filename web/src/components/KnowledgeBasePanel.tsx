import React, { useEffect, useState, useRef } from 'react';
import { BookOpen, X, Upload, Download, Trash2, FileText } from 'lucide-react';
import { useKnowledgeBaseStore } from '../store/useKnowledgeBaseStore';
import { useAppStore } from '../store/useAppStore';
import { canViewKnowledgeBase, canManageKnowledgeBase } from '../utils/permissions';
import { supabase } from '../lib/supabase';

export function KnowledgeBasePanel() {
  const { user } = useAppStore();
  const { files, isLoading, fetchFiles, uploadFile, deleteFile } = useKnowledgeBaseStore();
  const [isOpen, setIsOpen] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const canView = canViewKnowledgeBase(user?.role);
  const canManage = canManageKnowledgeBase(user?.role);

  useEffect(() => {
    if (canView && isOpen) {
      void fetchFiles();
    }
  }, [canView, isOpen, fetchFiles]);

  if (!canView) return null;

  const handleUploadClick = () => {
    fileInputRef.current?.click();
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !user) return;

    setIsUploading(true);
    try {
      const fileExt = file.name.split('.').pop();
      const fileName = `${Date.now()}-${Math.random().toString(36).substring(2)}.${fileExt}`;
      const filePath = `${user.id}/${fileName}`;

      const { error: uploadError } = await supabase.storage
        .from('knowledge_base')
        .upload(filePath, file);

      if (uploadError) throw uploadError;

      const { error: dbError } = await uploadFile({
        file_name: file.name,
        file_path: filePath,
        file_size: file.size,
        file_type: file.type || 'application/octet-stream',
        category: 'other',
        uploaded_by: user.id,
      });

      if (dbError) throw dbError;

      void fetchFiles();
    } catch (error) {
      console.error('Upload failed:', error);
      alert('上传失败: ' + (error as Error).message);
    } finally {
      setIsUploading(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  const handleDownload = async (filePath: string, fileName: string) => {
    try {
      const { data, error } = await supabase.storage
        .from('knowledge_base')
        .createSignedUrl(filePath, 60);

      if (error) throw error;

      const link = document.createElement('a');
      link.href = data.signedUrl;
      link.download = fileName;
      link.target = '_blank';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    } catch (error) {
      console.error('Download failed:', error);
      alert('下载失败: ' + (error as Error).message);
    }
  };

  const handleDelete = async (id: string, filePath: string) => {
    if (!window.confirm('确定要删除此文件吗？')) return;

    try {
      const { error: storageError } = await supabase.storage
        .from('knowledge_base')
        .remove([filePath]);

      if (storageError) throw storageError;

      const { error: dbError } = await deleteFile(id);
      if (dbError) throw dbError;

      void fetchFiles();
    } catch (error) {
      console.error('Delete failed:', error);
      alert('删除失败: ' + (error as Error).message);
    }
  };

  const formatFileSize = (bytes: number) => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setIsOpen(true)}
        className="fixed bottom-8 right-8 w-14 h-14 bg-accent rounded-full shadow-lg flex items-center justify-center hover:bg-accent/90 transition-transform hover:scale-105 z-40"
        title="知识库"
      >
        <BookOpen size={24} className="text-white" />
      </button>

      {isOpen && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex justify-end">
          <div className="w-[400px] h-full bg-[#111117] border-l border-white/10 shadow-2xl flex flex-col animate-in slide-in-from-right">
            <div className="px-6 py-4 border-b border-white/10 flex items-center justify-between">
              <div className="flex items-center space-x-2">
                <BookOpen size={20} className="text-accent" />
                <h3 className="text-lg font-semibold text-white">知识库</h3>
              </div>
              <button
                type="button"
                onClick={() => setIsOpen(false)}
                className="p-2 hover:bg-white/10 rounded-full transition-colors"
              >
                <X size={20} className="text-white/60" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-6">
              {canManage && (
                <div className="mb-6">
                  <input
                    type="file"
                    ref={fileInputRef}
                    onChange={handleFileChange}
                    className="hidden"
                  />
                  <button
                    type="button"
                    onClick={handleUploadClick}
                    disabled={isUploading}
                    className="w-full py-3 px-4 bg-white/5 border border-white/10 border-dashed rounded-xl flex items-center justify-center space-x-2 hover:bg-white/10 transition-colors disabled:opacity-50"
                  >
                    <Upload size={18} className="text-accent" />
                    <span className="text-sm text-white/80">
                      {isUploading ? '上传中...' : '上传文件'}
                    </span>
                  </button>
                </div>
              )}

              {isLoading ? (
                <div className="flex justify-center py-8">
                  <div className="w-6 h-6 border-2 border-accent border-t-transparent rounded-full animate-spin" />
                </div>
              ) : files.length === 0 ? (
                <div className="text-center py-12">
                  <FileText size={48} className="mx-auto text-white/20 mb-4" />
                  <p className="text-white/40 text-sm">暂无文件</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {files.map((file) => (
                    <div
                      key={file.id}
                      className="bg-white/5 border border-white/10 rounded-xl p-4 flex items-start space-x-3 group"
                    >
                      <div className="p-2 bg-white/5 rounded-lg shrink-0">
                        <FileText size={20} className="text-accent" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-white truncate" title={file.file_name}>
                          {file.file_name}
                        </p>
                        <div className="flex items-center space-x-2 mt-1 text-xs text-white/40">
                          <span>{formatFileSize(file.file_size)}</span>
                          <span>•</span>
                          <span>{new Date(file.created_at).toLocaleDateString()}</span>
                        </div>
                      </div>
                      <div className="flex items-center space-x-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                        <button
                          type="button"
                          onClick={() => handleDownload(file.file_path, file.file_name)}
                          className="p-2 hover:bg-white/10 rounded-lg transition-colors"
                          title="下载"
                        >
                          <Download size={16} className="text-white/80" />
                        </button>
                        {canManage && (
                          <button
                            type="button"
                            onClick={() => handleDelete(file.id, file.file_path)}
                            className="p-2 hover:bg-red-500/20 rounded-lg transition-colors"
                            title="删除"
                          >
                            <Trash2 size={16} className="text-red-400" />
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
