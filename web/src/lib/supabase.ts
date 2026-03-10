import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || import.meta.env.EXPO_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || import.meta.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

export const supabaseConfigError =
  !supabaseUrl || !supabaseAnonKey
    ? 'Web 端缺少 Supabase 配置。请在部署环境设置 VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY（或 EXPO_PUBLIC_* 同名变量）。'
    : null;

if (supabaseConfigError) {
  console.error(supabaseConfigError);
}

export const supabase = createClient(
  supabaseUrl || 'https://invalid.local',
  supabaseAnonKey || 'invalid-anon-key',
);
