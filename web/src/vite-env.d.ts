/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_PAYMENT_API_URL?: string;
  readonly VITE_PAYMENT_MOCK?: string;
  readonly EXPO_PUBLIC_PAYMENT_API_URL?: string;
  readonly EXPO_PUBLIC_PAYMENT_MOCK?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
