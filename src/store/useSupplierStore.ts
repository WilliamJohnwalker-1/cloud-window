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

      if (error) {
        throw error;
      }

      set({ suppliers: (data || []) as Supplier[] });
    } catch (error) {
      const message = error instanceof Error ? error.message : '获取供应商失败';
      set({ error: message });
    } finally {
      set({ isLoading: false });
    }
  },

  addSupplier: async (input) => {
    try {
      const { error } = await supabase
        .from('suppliers')
        .insert({
          company_name: input.company_name,
          delivery_cycle_days: input.delivery_cycle_days ?? null,
          avg_unit_price: input.avg_unit_price ?? null,
          contact: input.contact ?? null,
          phone: input.phone ?? null,
          address: input.address ?? null,
          status: input.status,
        });

      if (error) {
        throw error;
      }

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
        .update({
          company_name: input.company_name,
          delivery_cycle_days: input.delivery_cycle_days,
          avg_unit_price: input.avg_unit_price,
          contact: input.contact,
          phone: input.phone,
          address: input.address,
          status: input.status,
        })
        .eq('id', id);

      if (error) {
        throw error;
      }

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

      if (error) {
        throw error;
      }

      await get().fetchSuppliers();
      return { error: null };
    } catch (error) {
      return { error: error as Error };
    }
  },
}));
