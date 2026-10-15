import { createClient } from '@supabase/supabase-js';
import Constants from 'expo-constants';
import AsyncStorage from '@react-native-async-storage/async-storage';

const normalizeConfigValue = (value: string | null | undefined): string | null => {
  if (!value) return null;

  const trimmed = value.trim();
  if (!trimmed) return null;

  const unquoted = trimmed.replace(/^['\"]+|['\"]+$/g, '').trim();
  return unquoted || null;
};

const isValidHttpsUrl = (value: string | null): value is string => {
  if (!value) return false;

  try {
    const parsed = new URL(value);
    return parsed.protocol === 'https:';
  } catch {
    return false;
  }
};

const supabaseUrlRaw = normalizeConfigValue(
  process.env.EXPO_PUBLIC_SUPABASE_URL ?? Constants.expoConfig?.extra?.supabaseUrl,
);
const supabaseAnonKey = normalizeConfigValue(
  process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? Constants.expoConfig?.extra?.supabaseAnonKey,
);
const supabaseUrl = isValidHttpsUrl(supabaseUrlRaw) ? supabaseUrlRaw : null;
const fallbackSupabaseUrl = 'https://placeholder.supabase.co';
const fallbackSupabaseAnonKey = 'placeholder-anon-key';

export const supabaseConfigError =
  !supabaseUrlRaw
    ? '缺少 Supabase 配置：请在 EAS/环境变量中设置 EXPO_PUBLIC_SUPABASE_URL。'
    : !supabaseAnonKey
      ? '缺少 Supabase 配置：请在 EAS/环境变量中设置 EXPO_PUBLIC_SUPABASE_ANON_KEY。'
      : !supabaseUrl
        ? 'Supabase 配置错误：EXPO_PUBLIC_SUPABASE_URL 必须是有效的 HTTPS 地址（请检查是否含空格或引号）。'
        : null;

export const supabase = createClient(supabaseUrl ?? fallbackSupabaseUrl, supabaseAnonKey ?? fallbackSupabaseAnonKey, {
  auth: {
    storage: AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
});

export const getSupabaseUrl = () => supabaseUrl;
export const getSupabaseAnonKey = () => supabaseAnonKey;
