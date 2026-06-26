import { create } from 'zustand';
import { supabase } from '../lib/supabase';
import type { Supplier } from '../types';

type SupplierCreateInput = Omit<Supplier, 'id' | 'created_at' | 'updated_at'>;
type SupplierUpdateInput = Partial<SupplierCreateInput>;

interface SupplierStore {
  suppliers: Supplier[];
  isLoading: boolean;
  error: string | null;
  fetchSuppliers: () => Promise<void>;
  addSupplier: (input: SupplierCreateInput) => Promise<{ error: Error | null }>;
  updateSupplier: (id: string, input: SupplierUpdateInput) => Promise<{ error: Error | null }>;
  deleteSupplier: (id: string) => Promise<{ error: Error | null }>;
}

export const useSupplierStore = create<SupplierStore>()((set, get) => ({
  suppliers: [],
  isLoading: false,
  error: null,

  fetchSuppliers: async () => {
    set({ isLoading: true, error: null });
    try {
      const { data, error } = await supabase
        .from('suppliers')
        .select('*')
        .order('created_at', { ascending: false });

      if (error) throw error;
      set({ suppliers: data as Supplier[] });
    } catch (error) {
      set({ error: (error as Error).message });
    } finally {
      set({ isLoading: false });
    }
  },

  addSupplier: async (input) => {
    try {
      const { error } = await supabase.from('suppliers').insert(input);
      if (error) throw error;
      await get().fetchSuppliers();
      return { error: null };
    } catch (error) {
      return { error: error as Error };
    }
  },

  updateSupplier: async (id, input) => {
    try {
      const { error } = await supabase
        .from('suppliers')
        .update(input)
        .eq('id', id);
      if (error) throw error;
      await get().fetchSuppliers();
      return { error: null };
    } catch (error) {
      return { error: error as Error };
    }
  },

  deleteSupplier: async (id) => {
    try {
      const { error } = await supabase
        .from('suppliers')
        .delete()
        .eq('id', id);
      if (error) throw error;
      await get().fetchSuppliers();
      return { error: null };
    } catch (error) {
      return { error: error as Error };
    }
  },
}));
