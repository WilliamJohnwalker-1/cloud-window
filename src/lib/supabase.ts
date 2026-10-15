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

const isNetworkError = (error: unknown): boolean => {
  if (!(error instanceof Error)) return false;
  const message = error.message.toLowerCase();
  return message.includes('network request failed')
    || message.includes('failed to fetch')
    || message.includes('connection was reset')
    || message.includes('network error');
};

const replaceBaseUrl = (url: string, fromBase: string, toBase: string): string => {
  if (!url.startsWith(fromBase)) return url;
  return `${toBase}${url.slice(fromBase.length)}`;
};

const supabaseUrlRaw = normalizeConfigValue(
  process.env.EXPO_PUBLIC_SUPABASE_URL ?? Constants.expoConfig?.extra?.supabaseUrl,
);
const supabaseProxyUrlRaw = normalizeConfigValue(
  process.env.EXPO_PUBLIC_SUPABASE_PROXY_URL
  ?? Constants.expoConfig?.extra?.supabaseProxyUrl
  ?? 'https://pay.yunchuang888888.com/supabase',
);
const supabaseAnonKey = normalizeConfigValue(
  process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? Constants.expoConfig?.extra?.supabaseAnonKey,
);
const directSupabaseUrl = isValidHttpsUrl(supabaseUrlRaw) ? supabaseUrlRaw : null;
const proxySupabaseUrl = isValidHttpsUrl(supabaseProxyUrlRaw) ? supabaseProxyUrlRaw : null;
const supabaseUrl = proxySupabaseUrl ?? directSupabaseUrl;
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

const fallbackFetch: typeof fetch = async (input, init) => {
  if (!proxySupabaseUrl || !directSupabaseUrl) {
    return fetch(input, init);
  }

  const requestUrl = typeof input === 'string'
    ? input
    : input instanceof URL
      ? input.toString()
      : input.url;

  const shouldTryDirectFallback = requestUrl.startsWith(proxySupabaseUrl);
  if (!shouldTryDirectFallback) {
    return fetch(input, init);
  }

  try {
    return await fetch(input, init);
  } catch (error) {
    if (!isNetworkError(error)) {
      throw error;
    }

    const directUrl = replaceBaseUrl(requestUrl, proxySupabaseUrl, directSupabaseUrl);
    return fetch(directUrl, init);
  }
};

export const supabase = createClient(supabaseUrl ?? fallbackSupabaseUrl, supabaseAnonKey ?? fallbackSupabaseAnonKey, {
  global: {
    fetch: fallbackFetch,
  },
  auth: {
    storage: AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
});

export const getSupabaseUrl = () => supabaseUrl;
export const getSupabaseAnonKey = () => supabaseAnonKey;
