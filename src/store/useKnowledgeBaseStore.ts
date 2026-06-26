import { create } from 'zustand';
import type { KnowledgeBaseFile } from '../types';
import { supabase } from '../lib/supabase';

type KnowledgeBaseUploadInput = Omit<KnowledgeBaseFile, 'id' | 'created_at'>;

interface KnowledgeBaseStore {
  files: KnowledgeBaseFile[];
  isLoading: boolean;
  error: string | null;
  fetchFiles: () => Promise<void>;
  uploadFile: (input: KnowledgeBaseUploadInput) => Promise<{ error: Error | null }>;
  deleteFile: (id: string) => Promise<{ error: Error | null }>;
}

export const useKnowledgeBaseStore = create<KnowledgeBaseStore>()((set, get) => ({
  files: [],
  isLoading: false,
  error: null,

  fetchFiles: async () => {
    set({ isLoading: true, error: null });
    try {
      const { data, error } = await supabase
        .from('knowledge_base_files')
        .select('*')
        .order('created_at', { ascending: false });

      if (error) throw error;
      set({ files: data as KnowledgeBaseFile[] });
    } catch (error) {
      set({ error: (error as Error).message });
    } finally {
      set({ isLoading: false });
    }
  },

  uploadFile: async (input) => {
    try {
      const { error } = await supabase
        .from('knowledge_base_files')
        .insert(input);

      if (error) throw error;
      await get().fetchFiles();
      return { error: null };
    } catch (error) {
      return { error: error as Error };
    }
  },

  deleteFile: async (id) => {
    try {
      // First get the file to know its path
      const { data: file, error: fetchError } = await supabase
        .from('knowledge_base_files')
        .select('file_path')
        .eq('id', id)
        .single();

      if (fetchError) throw fetchError;

      // Delete from storage
      if (file?.file_path) {
        const { error: storageError } = await supabase.storage
          .from('knowledge_base')
          .remove([file.file_path]);
        if (storageError) throw storageError;
      }

      // Delete from database
      const { error: dbError } = await supabase
        .from('knowledge_base_files')
        .delete()
        .eq('id', id);

      if (dbError) throw dbError;

      await get().fetchFiles();
      return { error: null };
    } catch (error) {
      return { error: error as Error };
    }
  },
}));
