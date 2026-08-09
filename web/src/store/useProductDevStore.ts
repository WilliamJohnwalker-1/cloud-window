import { create } from 'zustand';

import { supabase } from '../lib/supabase';
import type { DevelopmentStage, ProductDevelopment, ProductDevLog } from '../types';

type ActionResult = { error: Error | null };
type ProjectsFetchMode = 'active' | 'all';

type ProductDevelopmentCreateInput = Omit<ProductDevelopment, 'id' | 'created_at' | 'updated_at'>;
type ProductDevelopmentUpdateInput = Partial<
  Pick<ProductDevelopment, 'name' | 'description' | 'notes' | 'target_date' | 'product_id'>
>;

interface ProductDevStore {
  projects: ProductDevelopment[];
  logs: ProductDevLog[];
  isLoading: boolean;
  error: string | null;
  fetchProjects: () => Promise<void>;
  fetchAllProjects: () => Promise<void>;
  addProject: (input: ProductDevelopmentCreateInput) => Promise<ActionResult>;
  updateProject: (id: string, input: ProductDevelopmentUpdateInput) => Promise<ActionResult>;
  advanceStage: (id: string, toStage: DevelopmentStage, notes?: string) => Promise<ActionResult>;
  deleteProject: (id: string) => Promise<ActionResult>;
  fetchLogs: (projectId: string) => Promise<void>;
  getUrgentCount: () => number;
}

let lastProjectsFetchMode: ProjectsFetchMode = 'active';
let lastLogsProjectId: string | null = null;

const millisecondsPerDay = 24 * 60 * 60 * 1000;

function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function parseDateOnly(value: string | null): Date | null {
  if (!value) {
    return null;
  }

  return new Date(`${value}T00:00:00`);
}

function isLaunchedProject(project: ProductDevelopment): boolean {
  return project.stage === 'launched';
}

function isUrgentProject(project: ProductDevelopment): boolean {
  if (isLaunchedProject(project)) {
    return false;
  }

  const targetDate = parseDateOnly(project.target_date);
  if (!targetDate) {
    return false;
  }

  const today = startOfDay(new Date());
  const threshold = new Date(today.getTime() + 3 * millisecondsPerDay);
  return targetDate.getTime() <= threshold.getTime();
}

function sortProjectsByUrgency(projects: ProductDevelopment[]): ProductDevelopment[] {
  const today = startOfDay(new Date()).getTime();

  return [...projects].sort((left, right) => {
    const leftLaunched = isLaunchedProject(left);
    const rightLaunched = isLaunchedProject(right);

    if (leftLaunched !== rightLaunched) {
      return leftLaunched ? 1 : -1;
    }

    const leftTarget = parseDateOnly(left.target_date);
    const rightTarget = parseDateOnly(right.target_date);
    const leftUrgentNow = Boolean(leftTarget && leftTarget.getTime() <= today);
    const rightUrgentNow = Boolean(rightTarget && rightTarget.getTime() <= today);

    if (leftUrgentNow !== rightUrgentNow) {
      return leftUrgentNow ? -1 : 1;
    }

    if (leftTarget && rightTarget) {
      const targetDiff = leftTarget.getTime() - rightTarget.getTime();
      if (targetDiff !== 0) {
        return targetDiff;
      }
    } else if (leftTarget || rightTarget) {
      return leftTarget ? -1 : 1;
    }

    return new Date(left.created_at).getTime() - new Date(right.created_at).getTime();
  });
}

function buildUpdatePayload(input: ProductDevelopmentUpdateInput): ProductDevelopmentUpdateInput {
  const payload: ProductDevelopmentUpdateInput = {};

  if (input.name !== undefined) {
    payload.name = input.name;
  }

  if (input.description !== undefined) {
    payload.description = input.description;
  }

  if (input.notes !== undefined) {
    payload.notes = input.notes;
  }

  if (input.target_date !== undefined) {
    payload.target_date = input.target_date;
  }

  if (input.product_id !== undefined) {
    payload.product_id = input.product_id;
  }

  return payload;
}

async function fetchProjectsList(includeLaunched: boolean): Promise<ProductDevelopment[]> {
  const query = includeLaunched
    ? supabase.from('product_developments').select('*')
    : supabase.from('product_developments').select('*').neq('stage', 'launched');

  const { data, error } = await query.order('created_at', { ascending: true });

  if (error) {
    throw error;
  }

  return sortProjectsByUrgency((data || []) as ProductDevelopment[]);
}

async function refreshProjects(get: () => ProductDevStore): Promise<void> {
  if (lastProjectsFetchMode === 'all') {
    await get().fetchAllProjects();
    return;
  }

  await get().fetchProjects();
}

async function refreshLogsIfNeeded(get: () => ProductDevStore, projectId: string): Promise<void> {
  if (lastLogsProjectId === projectId) {
    await get().fetchLogs(projectId);
  }
}

export const useProductDevStore = create<ProductDevStore>()((set, get) => ({
  projects: [],
  logs: [],
  isLoading: false,
  error: null,

  fetchProjects: async () => {
    lastProjectsFetchMode = 'active';
    set({ isLoading: true, error: null });

    try {
      const projects = await fetchProjectsList(false);
      set({ projects });
    } catch (error) {
      const message = error instanceof Error ? error.message : '获取产品开发项目失败';
      set({ error: message });
    } finally {
      set({ isLoading: false });
    }
  },

  fetchAllProjects: async () => {
    lastProjectsFetchMode = 'all';
    set({ isLoading: true, error: null });

    try {
      const projects = await fetchProjectsList(true);
      set({ projects });
    } catch (error) {
      const message = error instanceof Error ? error.message : '获取全部产品开发项目失败';
      set({ error: message });
    } finally {
      set({ isLoading: false });
    }
  },

  addProject: async (input) => {
    try {
      const { error } = await supabase
        .from('product_developments')
        .insert({
          name: input.name,
          description: input.description,
          stage: input.stage,
          notes: input.notes,
          target_date: input.target_date,
          product_id: input.product_id,
          created_by: input.created_by,
        });

      if (error) {
        throw error;
      }

      await refreshProjects(get);
      return { error: null };
    } catch (error) {
      return { error: error as Error };
    }
  },

  updateProject: async (id, input) => {
    try {
      const payload = buildUpdatePayload(input);

      if (Object.keys(payload).length > 0) {
        const { error } = await supabase.from('product_developments').update(payload).eq('id', id);

        if (error) {
          throw error;
        }
      }

      await refreshProjects(get);
      await refreshLogsIfNeeded(get, id);
      return { error: null };
    } catch (error) {
      return { error: error as Error };
    }
  },

  advanceStage: async (id, toStage, notes) => {
    void notes;

    try {
      let project = get().projects.find((item) => item.id === id) || null;

      if (!project) {
        const { data, error } = await supabase.from('product_developments').select('*').eq('id', id).single();
        if (error) {
          throw error;
        }

        project = (data as ProductDevelopment | null) || null;
      }

      if (!project) {
        throw new Error('产品开发项目不存在');
      }

      const { error: logError } = await supabase.from('product_dev_logs').insert({
        project_id: project.id,
        from_stage: project.stage,
        to_stage: toStage,
        notes: project.notes,
        target_date: project.target_date,
      });

      if (logError) {
        throw logError;
      }

      const { error: updateError } = await supabase
        .from('product_developments')
        .update({
          stage: toStage,
          notes: '',
          target_date: null,
          updated_at: new Date().toISOString(),
        })
        .eq('id', id);

      if (updateError) {
        throw updateError;
      }

      await refreshProjects(get);
      await refreshLogsIfNeeded(get, id);
      return { error: null };
    } catch (error) {
      return { error: error as Error };
    }
  },

  deleteProject: async (id) => {
    try {
      const { error } = await supabase.from('product_developments').delete().eq('id', id);

      if (error) {
        throw error;
      }

      if (lastLogsProjectId === id) {
        lastLogsProjectId = null;
        set({ logs: [] });
      }

      await refreshProjects(get);
      return { error: null };
    } catch (error) {
      return { error: error as Error };
    }
  },

  fetchLogs: async (projectId) => {
    lastLogsProjectId = projectId;
    set({ isLoading: true, error: null });

    try {
      const { data, error } = await supabase
        .from('product_dev_logs')
        .select('*')
        .eq('project_id', projectId)
        .order('created_at', { ascending: false });

      if (error) {
        throw error;
      }

      set({ logs: (data || []) as ProductDevLog[] });
    } catch (error) {
      const message = error instanceof Error ? error.message : '获取产品开发日志失败';
      set({ error: message });
    } finally {
      set({ isLoading: false });
    }
  },

  getUrgentCount: () => {
    return get().projects.filter((project) => isUrgentProject(project)).length;
  },
}));
