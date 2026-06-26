import { create } from 'zustand';
import { supabase } from '../lib/supabase';
import type { KnowledgeBaseFile } from '../types';

type ActionResult = { error: Error | null };

interface KnowledgeBaseStore {
  files: KnowledgeBaseFile[];
  isLoading: boolean;
  error: string | null;
  fetchFiles: () => Promise<void>;
  uploadFile: (payload: Omit<KnowledgeBaseFile, 'id' | 'created_at'>) => Promise<ActionResult>;
  deleteFile: (id: string) => Promise<ActionResult>;
}

export const useKnowledgeBaseStore = create<KnowledgeBaseStore>()((set) => ({
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
      set({ files: data as KnowledgeBaseFile[], isLoading: false });
    } catch (error) {
      set({ error: (error as Error).message, isLoading: false });
    }
  },
  uploadFile: async (payload) => {
    try {
      const { error } = await supabase.from('knowledge_base_files').insert(payload);
      if (error) throw error;
      return { error: null };
    } catch (error) {
      return { error: error as Error };
    }
  },
  deleteFile: async (id) => {
    try {
      const { error } = await supabase.from('knowledge_base_files').delete().eq('id', id);
      if (error) throw error;
      return { error: null };
    } catch (error) {
      return { error: error as Error };
    }
  },
}));
