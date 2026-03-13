export type WebPaymentStatus = 'pending' | 'paid' | 'failed' | 'timeout';

interface PaymentCollectParams {
  orderId: string;
  amount: number;
  authCode: string;
  subject?: string;
}

interface PaymentResult {
  success: boolean;
  status: WebPaymentStatus;
  error?: string;
  orderId?: string;
  outTradeNo?: string;
  transactionId?: string;
}

interface PaymentConfigCheckResult {
  ok: boolean;
  mock: boolean;
  liveReady: boolean;
  missing: string[];
}

interface PaymentHealthCheckResult {
  ok: boolean;
}

export interface PaymentReadinessResult {
  endpoint: string;
  health: PaymentHealthCheckResult;
  config: PaymentConfigCheckResult;
}

const defaultPaymentApiUrl = 'https://pay.yunchuang888888.com';

const rawPaymentApiUrl =
  String(import.meta.env.VITE_PAYMENT_API_URL || import.meta.env.EXPO_PUBLIC_PAYMENT_API_URL || '').trim();

const resolvedPaymentApiUrl = rawPaymentApiUrl || defaultPaymentApiUrl;

const paymentApiUrl = (() => {
  try {
    const parsed = new URL(resolvedPaymentApiUrl);
    return parsed.toString().replace(/\/$/, '');
  } catch {
    throw new Error('支付网关地址格式无效，请检查 VITE_PAYMENT_API_URL');
  }
})();

export const isPaymentMockMode =
  String(import.meta.env.VITE_PAYMENT_MOCK || import.meta.env.EXPO_PUBLIC_PAYMENT_MOCK || 'true') !== 'false';

const withApiBase = (path: string): string => {
  return `${paymentApiUrl}${path}`;
};

export const validateAuthCode = (code: string): boolean => /^\d{16,24}$/.test(code.trim());

export const getPaymentApiEndpoint = (): string => paymentApiUrl;

export async function fetchPaymentHealthCheck(): Promise<PaymentHealthCheckResult> {
  let response: Response;
  try {
    response = await fetch(withApiBase('/health'), {
      method: 'GET',
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : '未知网络错误';
    throw new Error(`支付网关健康检查失败（${paymentApiUrl}）：${message}`);
  }

  if (!response.ok) {
    throw new Error(`健康检查失败 (${response.status})`);
  }

  const data = await response.json();
  return {
    ok: Boolean(data.ok),
  };
}

export async function fetchPaymentConfigCheck(): Promise<PaymentConfigCheckResult> {
  let response: Response;
  try {
    response = await fetch(withApiBase('/api/payment/config-check'), {
      method: 'GET',
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : '未知网络错误';
    throw new Error(`支付网关连接失败（${paymentApiUrl}）：${message}`);
  }

  if (!response.ok) {
    throw new Error(`配置检查失败 (${response.status})`);
  }

  const data = await response.json();
  return {
    ok: Boolean(data.ok),
    mock: Boolean(data.mock),
    liveReady: Boolean(data.liveReady),
    missing: Array.isArray(data.missing) ? data.missing.map((item: unknown) => String(item)) : [],
  };
}

export async function runPaymentReadinessPrecheck(): Promise<PaymentReadinessResult> {
  const [health, config] = await Promise.all([
    fetchPaymentHealthCheck(),
    fetchPaymentConfigCheck(),
  ]);

  return {
    endpoint: paymentApiUrl,
    health,
    config,
  };
}

export async function collectAlipayByAuthCode(params: PaymentCollectParams): Promise<PaymentResult> {
  const response = await fetch(withApiBase('/api/payment/collect'), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      orderId: params.orderId,
      amount: params.amount,
      paymentMethod: 'alipay',
      authCode: params.authCode,
      subject: params.subject || `订单收款-${params.orderId.slice(0, 8)}`,
    }),
  });

  const data = await response.json();
  const status = String(data.status || 'failed') as WebPaymentStatus;

  if (!response.ok) {
    return {
      success: false,
      status,
      error: String(data.error || '收款失败'),
      orderId: data.orderId,
      outTradeNo: data.outTradeNo,
      transactionId: data.transactionId,
    };
  }

  return {
    success: Boolean(data.success),
    status,
    error: data.error ? String(data.error) : undefined,
    orderId: data.orderId ? String(data.orderId) : undefined,
    outTradeNo: data.outTradeNo ? String(data.outTradeNo) : undefined,
    transactionId: data.transactionId ? String(data.transactionId) : undefined,
  };
}

export async function queryPaymentStatus(orderId: string): Promise<{ status: WebPaymentStatus; transactionId?: string }> {
  const response = await fetch(withApiBase(`/api/payment/status/${encodeURIComponent(orderId)}`), {
    method: 'GET',
  });

  const data = await response.json();
  const status = String(data.status || 'failed') as WebPaymentStatus;
  return {
    status,
    transactionId: data.transactionId ? String(data.transactionId) : undefined,
  };
}
