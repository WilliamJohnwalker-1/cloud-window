/**
 * Payment Service - Frontend API Client
 * 
 * Provides a simple interface to the payment backend.
 * Supports both mock mode (for testing) and real payment mode.
 * 
 * In production, this connects to Cloudflare Workers backend.
 * In mock mode, it simulates the payment flow for testing.
 */

import type { PaymentMethod, PaymentStatus } from '../types';

interface PaymentConfig {
  // Backend API URL (set this after deploying Cloudflare Worker)
  apiUrl: string;
  // Mock mode - simulates payment without real backend
  mockMode: boolean;
}

interface MockPaymentState {
  status: PaymentStatus;
  transactionId?: string;
}

let config: PaymentConfig = {
  apiUrl: process.env.EXPO_PUBLIC_PAYMENT_API_URL || '',
  mockMode: process.env.EXPO_PUBLIC_PAYMENT_MOCK !== 'false',
};

const mockPayments = new Map<string, MockPaymentState>();

export function configurePayment(configPartial: Partial<PaymentConfig>) {
  config = { ...config, ...configPartial };
}

export function isMockMode(): boolean {
  return config.mockMode;
}

/**
 * Create a payment order and get QR code URL
 */
export async function createPaymentOrder(params: {
  orderId: string;
  amount: number;
  paymentMethod: PaymentMethod;
  productName?: string;
}): Promise<{
  success: boolean;
  qrCodeUrl?: string;
  orderId?: string;
  error?: string;
}> {
  if (config.mockMode) {
    // Mock mode - generate a test QR code
    const mockQrCode = `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(
      `MOCK:${params.paymentMethod}:${params.orderId}:${params.amount}`
    )}`;
    
    mockPayments.set(params.orderId, { status: 'pending' });

    return {
      success: true,
      qrCodeUrl: mockQrCode,
      orderId: params.orderId,
    };
  }

  try {
    const response = await fetch(`${config.apiUrl}/api/payment/create`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        orderId: params.orderId,
        amount: params.amount,
        paymentMethod: params.paymentMethod,
        productName: params.productName || 'Inventory Order',
      }),
    });

    const data = await response.json();

    if (!response.ok) {
      return {
        success: false,
        error: data.error || 'Payment creation failed',
      };
    }

    return {
      success: true,
      qrCodeUrl: data.qrCodeUrl,
      orderId: data.orderId,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Network error',
    };
  }
}

/**
 * Check payment status by polling
 */
export async function checkPaymentStatus(orderId: string): Promise<{
  status: PaymentStatus;
  transactionId?: string;
}> {
  if (config.mockMode) {
    const state = mockPayments.get(orderId);
    if (!state) {
      return { status: 'failed' };
    }

    return {
      status: state.status,
      transactionId: state.transactionId,
    };
  }

  try {
    const response = await fetch(`${config.apiUrl}/api/payment/status/${orderId}`, {
      method: 'GET',
    });

    const data = await response.json();

    return {
      status: data.status as PaymentStatus,
      transactionId: data.transactionId,
    };
  } catch {
    return {
      status: 'failed',
    };
  }
}

/**
 * Simulate a successful payment (only works in mock mode)
 * This is used for testing the full payment flow
 */
export async function simulatePaymentSuccess(orderId: string): Promise<boolean> {
  if (!config.mockMode) {
    console.warn('Cannot simulate payment in non-mock mode');
    return false;
  }

  mockPayments.set(orderId, {
    status: 'paid',
    transactionId: `mock_${Date.now()}`,
  });

  return true;
}

export function markMockPaymentTimeout(orderId: string): void {
  if (!config.mockMode) return;
  mockPayments.set(orderId, { status: 'timeout' });
}
