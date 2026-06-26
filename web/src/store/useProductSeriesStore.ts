import { create } from 'zustand';

import { supabase } from '../lib/supabase';
import type { ProductSeries } from '../types';

type ActionResult = { error: Error | null };
type ProductSeriesCreateInput = Omit<ProductSeries, 'id' | 'created_at'>;
type ProductSeriesUpdateInput = Partial<ProductSeriesCreateInput>;

interface ProductSeriesStore {
  series: ProductSeries[];
  isLoading: boolean;
  error: string | null;
  fetchSeries: () => Promise<void>;
  addSeries: (input: ProductSeriesCreateInput) => Promise<ActionResult>;
  updateSeries: (id: string, input: ProductSeriesUpdateInput) => Promise<ActionResult>;
  deleteSeries: (id: string) => Promise<ActionResult>;
}

export const useProductSeriesStore = create<ProductSeriesStore>()((set, get) => ({
  series: [],
  isLoading: false,
  error: null,

  fetchSeries: async () => {
    set({ isLoading: true, error: null });
    try {
      const { data, error } = await supabase
        .from('product_series')
        .select('*')
        .order('sort_index', { ascending: true })
        .order('created_at', { ascending: true });

      if (error) {
        throw error;
      }

      set({ series: (data || []) as ProductSeries[] });
    } catch (error) {
      const message = error instanceof Error ? error.message : '获取系列失败';
      set({ error: message });
    } finally {
      set({ isLoading: false });
    }
  },

  addSeries: async (input) => {
    try {
      const { error } = await supabase
        .from('product_series')
        .insert({
          name: input.name,
          sort_index: input.sort_index,
        });

      if (error) {
        throw error;
      }

      await get().fetchSeries();
      return { error: null };
    } catch (error) {
      return { error: error as Error };
    }
  },

  updateSeries: async (id, input) => {
    try {
      const { error } = await supabase
        .from('product_series')
        .update({
          name: input.name,
          sort_index: input.sort_index,
        })
        .eq('id', id);

      if (error) {
        throw error;
      }

      await get().fetchSeries();
      return { error: null };
    } catch (error) {
      return { error: error as Error };
    }
  },

  deleteSeries: async (id) => {
    try {
      const { error } = await supabase
        .from('product_series')
        .delete()
        .eq('id', id);

      if (error) {
        throw error;
      }

      await get().fetchSeries();
      return { error: null };
    } catch (error) {
      return { error: error as Error };
    }
  },
}));
