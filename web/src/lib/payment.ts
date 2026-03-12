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

const paymentApiUrl =
  String(import.meta.env.VITE_PAYMENT_API_URL || import.meta.env.EXPO_PUBLIC_PAYMENT_API_URL || '').trim();

export const isPaymentMockMode =
  String(import.meta.env.VITE_PAYMENT_MOCK || import.meta.env.EXPO_PUBLIC_PAYMENT_MOCK || 'true') !== 'false';

const withApiBase = (path: string): string => {
  if (!paymentApiUrl) {
    throw new Error('未配置支付网关地址（VITE_PAYMENT_API_URL）');
  }
  return `${paymentApiUrl}${path}`;
};

export const validateAuthCode = (code: string): boolean => /^\d{16,24}$/.test(code.trim());

export async function fetchPaymentConfigCheck(): Promise<PaymentConfigCheckResult> {
  const response = await fetch(withApiBase('/api/payment/config-check'), {
    method: 'GET',
  });

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
