import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CreditCard, ScanLine } from 'lucide-react';
import { useAppStore } from '../store/useAppStore';
import {
  collectByAuthCode,
  runPaymentReadinessPrecheck,
  isPaymentMockMode,
  queryPaymentStatus,
  validateAuthCode,
  validateAuthCodeForMethod,
  type WebPaymentStatus,
} from '../lib/payment';
import { supabase } from '../lib/supabase';
import { calculateRetailOrderTotals } from '../utils/orderPricing';

const wait = (ms: number): Promise<void> => new Promise((resolve) => {
  window.setTimeout(resolve, ms);
});

const defaultScanResetThresholdMs = 420;
const scanThresholdPresets = [300, 420, 650, 900] as const;
const unpaidRetailAutoDeleteMs = 10 * 60 * 1000;
const collectSoftWaitMs = 2500;
const paidRetailStatuses = new Set(['paid', 'partial_refunded', 'partial_refund_pending', 'refunded', 'refund_pending']);
const unpaidRetailStatuses = new Set(['', 'pending', 'unpaid', 'failed', 'timeout', 'closed', 'cancelled']);

interface ActiveOrderItemDraft {
  id: string;
  productName: string;
  quantity: number;
  retailPrice: number;
  discountPrice: number;
  draftDiscountPrice: string;
}

interface TimingEntry {
  label: string;
  durationMs: number;
  timestamp: number;
  isError?: boolean;
}

interface OperationLog {
  id: string;
  type: 'order' | 'payment';
  entries: TimingEntry[];
  totalMs: number;
  timestamp: number;
  hitFallback?: boolean;
}
const playSuccessSpeech = (amount: number): void => {
  if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
    try {
      const utterance = new SpeechSynthesisUtterance(`收款成功，金额${amount}元`);
      utterance.lang = 'zh-CN';
      window.speechSynthesis.speak(utterance);
    } catch {
      window.speechSynthesis.cancel();
    }
  }
};

const normalizeDigits = (input: string): string => input.replace(/\D/g, '');
const normalizeProductBarcode = (input: string): string => normalizeDigits(input).slice(0, 13);
const getPaymentPollDelayMs = (attemptIndex: number): number => {
  if (attemptIndex < 16) return 200;
  if (attemptIndex < 26) return 500;
  return 1500;
};
const detectPaymentMethodByAuthCode = (input: string): 'wechat' | 'alipay' | null => {
  const digits = normalizeDigits(input).slice(0, 24);
  if (digits.length < 16 || digits.length > 24) return null;
  const prefix = Number(digits.slice(0, 2));
  if (prefix >= 10 && prefix <= 15) return 'wechat';
  if (prefix >= 25 && prefix <= 30) return 'alipay';
  return null;
};

export const PaymentScreen: React.FC = () => {
  const { user, products, createRetailOrders, fetchOrders, fetchOrderDetail, deleteOrder, orders } = useAppStore();
  const [productScanCode, setProductScanCode] = useState('');
  const [paymentAuthCode, setPaymentAuthCode] = useState('');
  const [cart, setCart] = useState<Map<string, number>>(new Map());
  const [activeOrder, setActiveOrder] = useState<{ id: string; amount: number; originalAmount: number; items: ActiveOrderItemDraft[]; createdAtMs: number } | null>(null);
  const [isApplyingItemRounding, setIsApplyingItemRounding] = useState(false);
  const [isCreatingOrder, setIsCreatingOrder] = useState(false);
  const [isCollecting, setIsCollecting] = useState(false);
  const [status, setStatus] = useState<WebPaymentStatus>('pending');
  const [statusMessage, setStatusMessage] = useState('等待创建订单');
  const [transactionId, setTransactionId] = useState('');
  const [configMessage, setConfigMessage] = useState('检查支付配置中...');
  const [paymentMethod, setPaymentMethod] = useState<'wechat' | 'alipay'>('alipay');
  const [scanTarget, setScanTarget] = useState<'product' | 'payment'>('product');
  const [scanResetThresholdMs, setScanResetThresholdMs] = useState<number>(defaultScanResetThresholdMs);
  const [showTimingPanel, setShowTimingPanel] = useState(false);
  const [operationLogs, setOperationLogs] = useState<OperationLog[]>([]);
  const [currentTiming, setCurrentTiming] = useState<TimingEntry[]>([]);

  const productInputRef = useRef<HTMLInputElement | null>(null);
  const paymentInputRef = useRef<HTMLInputElement | null>(null);
  const scanBufferRef = useRef('');
  const lastKeyTsRef = useRef(0);
  const scanTargetRef = useRef<'product' | 'payment'>('product');
  const isScannerProcessingRef = useRef(false);
  const scanDisplaySyncTimeoutRef = useRef<number | null>(null);
  const currentTimingRef = useRef<TimingEntry[]>([]);
  const addProductByBarcodeRef = useRef<(code: string) => void>(() => undefined);
  const collectByCodeRef = useRef<(code: string) => Promise<void>>(async () => undefined);
  const finalizedPaidOrderIdRef = useRef<string | null>(null);

  const canUseCashier = user?.role === 'admin' || user?.role === 'super_admin' || user?.role === 'inventory_manager';
  const canAdjustAmount = user?.role === 'admin' || user?.role === 'super_admin';

  const syncScanDisplay = useCallback((target: 'product' | 'payment', value: string): void => {
    if (target === 'product') {
      setProductScanCode(value.slice(0, 13));
      return;
    }
    setPaymentAuthCode(value.slice(0, 24));
  }, []);

  const scheduleScanDisplaySync = useCallback((target: 'product' | 'payment'): void => {
    if (scanDisplaySyncTimeoutRef.current) {
      window.clearTimeout(scanDisplaySyncTimeoutRef.current);
    }
    scanDisplaySyncTimeoutRef.current = window.setTimeout(() => {
      syncScanDisplay(target, scanBufferRef.current);
      scanDisplaySyncTimeoutRef.current = null;
    }, 80);
  }, [syncScanDisplay]);

  const resetCurrentTiming = useCallback((): void => {
    currentTimingRef.current = [];
    setCurrentTiming([]);
  }, []);

  const pushTimingEntry = useCallback((label: string, startTime: number, isError = false): void => {
    const durationMs = Number((performance.now() - startTime).toFixed(1));
    const nextEntry: TimingEntry = {
      label,
      durationMs,
      timestamp: Date.now(),
      isError,
    };
    const next = [...currentTimingRef.current, nextEntry];
    currentTimingRef.current = next;
    setCurrentTiming(next);
  }, []);

  const commitOperationLog = useCallback((type: 'order' | 'payment', hitFallback = false): void => {
    const entries = currentTimingRef.current;
    if (entries.length === 0) return;

    const totalMs = Number(entries.reduce((sum, item) => sum + item.durationMs, 0).toFixed(1));
    const timestamp = Date.now();
    const log: OperationLog = {
      id: `${type}-${timestamp}-${Math.random().toString(36).slice(2, 8)}`,
      type,
      entries,
      totalMs,
      timestamp,
      hitFallback,
    };
    setOperationLogs((prev) => [log, ...prev].slice(0, 20));
    currentTimingRef.current = [];
    setCurrentTiming([]);
  }, []);

  const resetScannerState = useCallback((): void => {
    scanBufferRef.current = '';
    scheduleScanDisplaySync(scanTargetRef.current);
    setStatus('pending');
    setStatusMessage('已重置扫码状态');
  }, [scheduleScanDisplaySync]);

  const finalizePaid = useCallback((orderId: string, amount: number, message: string): boolean => {
    if (finalizedPaidOrderIdRef.current === orderId) {
      return false;
    }

    finalizedPaidOrderIdRef.current = orderId;
    setStatus('paid');
    setStatusMessage(message);
    setCart(new Map());
    playSuccessSpeech(amount);
    void fetchOrders();
    return true;
  }, [fetchOrders]);

  const confirmPaidSettlement = useCallback(async (
    orderId: string,
    amount: number,
    message: string,
  ): Promise<boolean> => {
    const latest = await queryPaymentStatus(orderId);
    if (latest.transactionId) {
      setTransactionId(latest.transactionId);
    }

    if (latest.status !== 'paid') {
      setStatus('pending');
      setStatusMessage('支付处理中，等待支付网关最终确认...');
      return false;
    }

    finalizePaid(orderId, amount, message);
    return true;
  }, [finalizePaid]);

  const productById = useMemo(() => {
    const byId = new Map<string, (typeof products)[number]>();
    products.forEach((product) => {
      byId.set(product.id, product);
    });
    return byId;
  }, [products]);

  const productByBarcode = useMemo(() => {
    const byBarcode = new Map<string, (typeof products)[number]>();
    products.forEach((product) => {
      const normalized = normalizeProductBarcode(String(product.barcode || ''));
      if (normalized.length === 13) {
        byBarcode.set(normalized, product);
      }
    });
    return byBarcode;
  }, [products]);

  const cartItems = useMemo(() => {
    return Array.from(cart.entries())
      .map(([productId, quantity]) => {
        const product = productById.get(productId);
        if (!product) return null;
        return { product, quantity };
      })
      .filter((item): item is { product: (typeof products)[number]; quantity: number } => item !== null);
  }, [cart, productById]);

  const totalAmount = useMemo(() => {
    return calculateRetailOrderTotals(cartItems).totalRetail;
  }, [cartItems]);

  useEffect(() => {
    window.requestAnimationFrame(() => {
      productInputRef.current?.focus();
    });
  }, []);

  useEffect(() => {
    scanTargetRef.current = scanTarget;
  }, [scanTarget]);

  useEffect(() => {
    return () => {
      if (scanDisplaySyncTimeoutRef.current) {
        window.clearTimeout(scanDisplaySyncTimeoutRef.current);
      }
    };
  }, []);

  useEffect(() => {
    const loadConfig = async (): Promise<void> => {
      try {
        const readiness = await runPaymentReadinessPrecheck();
        if (!readiness.health.ok) {
          setConfigMessage(`支付网关健康检查未通过：${readiness.endpoint}`);
          return;
        }

        if (readiness.config.mock) {
          setConfigMessage(`当前为 Mock 模式（PAYMENT_MOCK=true） · 网关 ${readiness.endpoint}`);
          return;
        }

        if (readiness.config.channels) {
          const wechatReady = Boolean(readiness.config.channels.wechat?.liveReady);
          const alipayReady = Boolean(readiness.config.channels.alipay?.liveReady);
          const missingWechat = readiness.config.channels.wechat?.missing || [];
          const missingAlipay = readiness.config.channels.alipay?.missing || [];

          if (!wechatReady && !alipayReady) {
            const missing = Array.from(new Set([...missingWechat, ...missingAlipay]));
            setConfigMessage(`真实收款未就绪，微信/支付宝都缺少变量：${missing.join(', ')} · 网关 ${readiness.endpoint}`);
            return;
          }

          setConfigMessage(`真实收款通道状态：微信${wechatReady ? '已就绪' : '未就绪'}，支付宝${alipayReady ? '已就绪' : '未就绪'} · 网关 ${readiness.endpoint}`);
          return;
        }

        if (!readiness.config.liveReady) {
          setConfigMessage(`真实收款未就绪，缺少变量：${readiness.config.missing.join(', ')} · 网关 ${readiness.endpoint}`);
          return;
        }

        setConfigMessage(`真实收款已就绪，可以开始扫码收款 · 网关 ${readiness.endpoint}`);
      } catch (error) {
        setConfigMessage(`配置检查失败：${error instanceof Error ? error.message : '未知错误'}`);
      }
    };

    void loadConfig();
  }, []);

  const updateCartQuantity = useCallback((productId: string, quantity: number): void => {
    setCart((prev) => {
      const next = new Map(prev);
      if (quantity <= 0) {
        next.delete(productId);
      } else {
        next.set(productId, quantity);
      }
      return next;
    });
  }, []);

  const addProductByBarcode = useCallback((rawCode: string): void => {
    const digits = normalizeDigits(rawCode.trim());
    if (digits.length >= 16 && digits.length <= 24) {
      const detectedMethod = detectPaymentMethodByAuthCode(digits);
      setScanTarget('payment');
      setPaymentAuthCode(digits.slice(0, 24));
      if (detectedMethod) {
        setPaymentMethod(detectedMethod);
      }
      setStatus('failed');
      setStatusMessage(
        detectedMethod
          ? `检测到付款码（16-24位），已切换到付款码扫码目标，并推荐${detectedMethod === 'wechat' ? '微信' : '支付宝'}通道`
          : '检测到付款码（16-24位），已切换到付款码扫码目标，请确认支付通道',
      );
      paymentInputRef.current?.focus();
      return;
    }

    const barcode = normalizeProductBarcode(digits);
    if (barcode.length !== 13) {
      setStatus('failed');
      setStatusMessage('商品条码必须是 13 位数字');
      return;
    }

    const product = productByBarcode.get(barcode);
    if (!product) {
      setStatus('failed');
      setStatusMessage(`未找到条码 ${barcode} 对应商品`);
      return;
    }

    const currentQty = cart.get(product.id) || 0;
    updateCartQuantity(product.id, currentQty + 1);
    setStatus('pending');
    setStatusMessage(`已加入 ${product.name} x1`);
  }, [cart, productByBarcode, updateCartQuantity]);

  const handleProductScanSubmit = (): void => {
    addProductByBarcode(productScanCode);
    setProductScanCode('');
    productInputRef.current?.focus();
  };

  const resolveCreatedOrderId = (amount: number): string | null => {
    const now = Date.now();
    const recentOrders = [...orders].sort((left, right) => {
      return new Date(right.created_at).getTime() - new Date(left.created_at).getTime();
    });

    const matched = recentOrders.find((order) => {
      if (user && order.distributor_id !== user.id) return false;
      if (order.order_kind !== 'retail') return false;
      const ageMs = now - new Date(order.created_at).getTime();
      if (ageMs > 3 * 60 * 1000) return false;
      const paymentStatus = String(order.payment_status || '').toLowerCase();
      if (paidRetailStatuses.has(paymentStatus)) return false;
      if (!unpaidRetailStatuses.has(paymentStatus)) return false;
      return Math.abs(Number(order.total_discount_amount || 0) - amount) < 0.01;
    });

    return matched?.id || null;
  };

  const handleCreateOrder = async (): Promise<void> => {
    if (cartItems.length === 0) {
      setStatus('failed');
      setStatusMessage('请先扫码商品条码，加入商品后再创建订单');
      return;
    }

    const invalid = cartItems.find((item) => item.quantity <= 0);
    if (invalid) {
      setStatus('failed');
      setStatusMessage(`${invalid.product.name} 数量必须大于 0`);
      return;
    }

    setIsCreatingOrder(true);
    resetCurrentTiming();
    let shouldCommitLog = false;
    let hitFallback = false;
    try {
      shouldCommitLog = true;
      const rpcStart = performance.now();
      const result = await createRetailOrders(cartItems.map((item) => ({
        productId: item.product.id,
        quantity: item.quantity,
      })));
      pushTimingEntry('建单 (RPC)', rpcStart, Boolean(result.error));

      if (result.error) {
        setStatus('failed');
        setStatusMessage(`创建订单失败：${result.error.message}`);
        return;
      }

      if (!result.orderId) {
        hitFallback = true;
        await fetchOrders();
      }
      const orderId = result.orderId || resolveCreatedOrderId(totalAmount);
      if (!orderId) {
        setStatus('failed');
        setStatusMessage('订单已创建，但未能自动定位订单号，请到订单列表确认');
        return;
      }

      const detailStart = performance.now();
      const detail = await fetchOrderDetail(orderId);
      pushTimingEntry('订单详情拉取', detailStart, !detail || detail.items.length === 0);
      if (!detail || detail.items.length === 0) {
        setStatus('failed');
        setStatusMessage('订单已创建，但未能加载商品明细，请到订单页刷新后重试');
        return;
      }

      if (detail.order_kind !== 'retail') {
        setStatus('failed');
        setStatusMessage('收银台仅允许绑定零售单，请在订单页核对后重试建单');
        return;
      }

      const orderItems: ActiveOrderItemDraft[] = detail.items.map((item) => {
        const discountPrice = Number(item.discount_price || 0);
        return {
          id: item.id,
          productName: item.product_name || '云窗文创',
          quantity: Number(item.quantity || 0),
          retailPrice: Number(item.retail_price || 0),
          discountPrice,
          draftDiscountPrice: discountPrice.toFixed(2),
        };
      });

      const originalAmount = Number(detail.total_retail_amount || totalAmount);
      const discountedAmount = Number(detail.payment_amount || detail.total_discount_amount || totalAmount);

      setActiveOrder({
        id: orderId,
        amount: discountedAmount,
        originalAmount,
        items: orderItems,
        createdAtMs: Number.isFinite(new Date(detail.created_at).getTime()) ? new Date(detail.created_at).getTime() : Date.now(),
      });
      finalizedPaidOrderIdRef.current = null;
      setTransactionId('');
      setPaymentAuthCode('');
      setScanTarget('payment');
      setStatus('pending');
      setStatusMessage(`零售订单已创建：#${orderId.slice(0, 8)}，请扫描客户付款码`);
      paymentInputRef.current?.focus();
    } finally {
      setIsCreatingOrder(false);
      if (shouldCommitLog) {
        commitOperationLog('order', hitFallback);
      }
    }
  };

  const pollUntilSettled = useCallback(async (
    orderId: string,
    amount: number,
    shouldStop?: () => boolean,
  ): Promise<void> => {
    let consecutiveFailedCount = 0;
    for (let index = 0; index < 30; index += 1) {
      if (shouldStop?.()) {
        return;
      }

      const latest = await queryPaymentStatus(orderId);
      const isTransientFailed = latest.status === 'failed' && consecutiveFailedCount < 3;
      if (!isTransientFailed) {
        setStatus(latest.status);
      }
      if (latest.transactionId) {
        setTransactionId(latest.transactionId);
      }

      if (latest.status === 'paid') {
        finalizePaid(orderId, amount, '收款成功，订单已标记为已支付');
        return;
      }

      if (latest.status === 'failed' || latest.status === 'timeout') {
        if (latest.status === 'failed') {
          consecutiveFailedCount += 1;
          if (consecutiveFailedCount < 4) {
            setStatus('pending');
            setStatusMessage('支付处理中，状态查询中...');
            await wait(getPaymentPollDelayMs(index));
            continue;
          }
        }
        setStatusMessage(latest.status === 'timeout' ? '收款超时，请重试扫码收款' : '收款失败，请重试');
        return;
      }

      if (shouldStop?.()) {
        return;
      }

      consecutiveFailedCount = 0;

      await wait(getPaymentPollDelayMs(index));
    }

    setStatusMessage('仍在等待支付结果，请稍后在订单页刷新状态');
  }, [finalizePaid]);

  const handleCollect = useCallback(async (inputCode?: string): Promise<void> => {
    if (!activeOrder) {
      setStatus('failed');
      setStatusMessage('请先创建订单，再扫描客户付款码');
      return;
    }

    if (isCollecting) {
      return;
    }

    if (status === 'paid' || finalizedPaidOrderIdRef.current === activeOrder.id) {
      setStatus('paid');
      setStatusMessage('该订单已完成支付，请新建订单后再收款');
      return;
    }

    const authCode = normalizeDigits((inputCode ?? paymentAuthCode).trim()).slice(0, 24);
    if (!validateAuthCode(authCode)) {
      setStatus('failed');
      setStatusMessage('付款码格式错误，应为 16-24 位数字');
      return;
    }

    const detectedMethod = detectPaymentMethodByAuthCode(authCode);
    const resolvedPaymentMethod = detectedMethod || paymentMethod;
    if (detectedMethod && detectedMethod !== paymentMethod) {
      setPaymentMethod(detectedMethod);
    }

    if (!validateAuthCodeForMethod(authCode, resolvedPaymentMethod)) {
      setStatus('failed');
      setStatusMessage(
        resolvedPaymentMethod === 'wechat'
          ? '微信付款码格式错误，应为 18 位数字且以 10-15 开头'
          : '支付宝付款码格式错误，应为 16-24 位数字且以 25-30 开头',
      );
      return;
    }

    setIsCollecting(true);
    resetCurrentTiming();
    let shouldCommitLog = false;
    try {
      shouldCommitLog = true;
      const collectStart = performance.now();
      const collectPromise = collectByAuthCode({
        orderId: activeOrder.id,
        amount: activeOrder.amount,
        paymentMethod: resolvedPaymentMethod,
        authCode,
      });
      const racedCollect = await Promise.race([
        collectPromise.then((result) => ({ timedOut: false as const, result })),
        wait(collectSoftWaitMs).then(() => ({ timedOut: true as const })),
      ]);

      if (racedCollect.timedOut) {
        let settledByLateCollect = false;

        pushTimingEntry('收款 (gateway-short-wait)', collectStart);
        void collectPromise
          .then((lateResult) => {
            if (settledByLateCollect || !lateResult.success || lateResult.status !== 'paid') {
              return;
            }

            if (lateResult.transactionId) {
              setTransactionId(lateResult.transactionId);
            }

            void confirmPaidSettlement(activeOrder.id, activeOrder.amount, '收款成功，订单已完成支付')
              .then((confirmed) => {
                if (confirmed) {
                  settledByLateCollect = true;
                }
              })
              .catch((error) => {
                console.warn('[PaymentScreen] late collect paid confirmation failed', error);
              });
          })
          .catch((error) => {
            console.warn('[PaymentScreen] collect settled after short-wait with error', error);
          });

        setStatus('pending');
        setStatusMessage('支付处理中，正在查询最终状态...');
        const pollingStart = performance.now();
        await pollUntilSettled(activeOrder.id, activeOrder.amount, () => settledByLateCollect);
        pushTimingEntry('支付状态轮询', pollingStart);
        return;
      }

      const { result } = racedCollect;
      pushTimingEntry('收款 (gateway)', collectStart, !result.success);

      if (!result.success) {
        setStatus('failed');
        setStatusMessage(`收款失败：${result.error || '未知错误'}`);
        return;
      }


      setStatus(result.status);
      if (result.transactionId) {
        setTransactionId(result.transactionId);
      }

      if (result.status === 'paid') {
        const confirmed = await confirmPaidSettlement(activeOrder.id, activeOrder.amount, '收款成功，订单已完成支付');
        if (confirmed) {
          return;
        }
      }

      setStatusMessage('支付处理中，正在查询最终状态...');
      const pollingStart = performance.now();
      await pollUntilSettled(activeOrder.id, activeOrder.amount);
      pushTimingEntry('支付状态轮询', pollingStart);
    } catch (error) {
      setStatus('failed');
      setStatusMessage(`收款异常：${error instanceof Error ? error.message : '未知错误'}`);
    } finally {
      setIsCollecting(false);
      setPaymentAuthCode('');
      paymentInputRef.current?.focus();
      if (shouldCommitLog) {
        commitOperationLog('payment');
      }
    }
  }, [activeOrder, commitOperationLog, confirmPaidSettlement, isCollecting, paymentAuthCode, paymentMethod, pollUntilSettled, pushTimingEntry, resetCurrentTiming, status]);

  const updateItemDraftPrice = (itemId: string, value: string): void => {
    if (!activeOrder || isApplyingItemRounding) return;
    const sanitized = value.replace(/[^0-9.]/g, '');
    setActiveOrder({
      ...activeOrder,
      items: activeOrder.items.map((item) => (item.id === itemId ? { ...item, draftDiscountPrice: sanitized } : item)),
    });
  };

  const applyItemLevelRounding = (): void => {
    if (!activeOrder || !canAdjustAmount || isApplyingItemRounding) return;

    const nextItems = activeOrder.items.map((item) => {
      const parsed = Number(item.draftDiscountPrice);
      const parsedValue = Number.isFinite(parsed) ? Number(parsed.toFixed(2)) : Number.NaN;
      return {
        ...item,
        parsedValue,
      };
    });

    const invalidItem = nextItems.find((item) => Number.isNaN(item.parsedValue) || item.parsedValue < 0 || item.parsedValue > item.retailPrice);
    if (invalidItem) {
      setStatus('failed');
      setStatusMessage(`${invalidItem.productName} 单价不合法（应在 0 到 ¥${invalidItem.retailPrice.toFixed(2)} 之间）`);
      return;
    }

    const nextAmount = Number(nextItems.reduce((sum, item) => sum + item.parsedValue * item.quantity, 0).toFixed(2));
    const diff = Number((activeOrder.originalAmount - nextAmount).toFixed(2));
    const note = diff > 0
      ? `收银台按商品抹零：原金额¥${activeOrder.originalAmount.toFixed(2)}，实收¥${nextAmount.toFixed(2)}，抹零¥${diff.toFixed(2)}`
      : null;

    setIsApplyingItemRounding(true);
    void (async () => {
      try {
        const payloadItems = nextItems.map((item) => ({
          order_item_id: item.id,
          new_discount_price: item.parsedValue,
        }));

        const { data, error } = await supabase.rpc('set_retail_order_item_prices_atomic', {
          p_order_id: activeOrder.id,
          p_items: payloadItems,
          p_payment_note: note,
        });

        if (error) {
          setStatus('failed');
          setStatusMessage(`按商品抹零保存失败：${error.message}`);
          return;
        }

        const row = Array.isArray(data) ? data[0] : data;
        const nextOrderAmount = Number(row?.total_discount_amount || nextAmount);

        setActiveOrder({
          ...activeOrder,
          amount: nextOrderAmount,
          items: nextItems.map((item) => ({
            ...item,
            discountPrice: item.parsedValue,
            draftDiscountPrice: item.parsedValue.toFixed(2),
          })),
        });
        setStatus('pending');
        setStatusMessage(diff > 0 ? `已按商品抹零，实收金额：¥${nextOrderAmount.toFixed(2)}` : '已恢复商品原始价格');
        await fetchOrders();
      } finally {
        setIsApplyingItemRounding(false);
      }
    })();
  };

  useEffect(() => {
    addProductByBarcodeRef.current = addProductByBarcode;
  }, [addProductByBarcode]);

  useEffect(() => {
    collectByCodeRef.current = async (code: string) => {
      await handleCollect(code);
    };
  }, [handleCollect]);

  useEffect(() => {
    if (!activeOrder) return;

    const checkAndCleanupUnpaidOrder = async (): Promise<void> => {
      if (isCollecting) {
        return;
      }

      if (Date.now() - activeOrder.createdAtMs < unpaidRetailAutoDeleteMs) {
        return;
      }

      const { data, error: queryError } = await supabase
        .from('orders')
        .select('id, payment_status, order_kind')
        .eq('id', activeOrder.id)
        .maybeSingle();

      if (queryError) {
        // Transient query error — skip this round, do not masquerade as auto-deleted
        return;
      }

      if (!data) {
        // Row missing — order was auto-deleted by cleanup elsewhere
        setActiveOrder(null);
        setStatus('timeout');
        setStatusMessage('未支付订单已超时清理，请重新建单');
        setTransactionId('');
        setPaymentAuthCode('');
        return;
      }

      if (data.order_kind !== 'retail') {
        setActiveOrder(null);
        setStatus('failed');
        setStatusMessage('检测到非零售订单，已停止自动清理保护');
        return;
      }

      const paymentStatus = String(data.payment_status || '').toLowerCase();
      if (paidRetailStatuses.has(paymentStatus)) {
        return;
      }
      if (!unpaidRetailStatuses.has(paymentStatus)) {
        setActiveOrder(null);
        setStatus('failed');
        setStatusMessage('订单状态不属于未支付范围，已停止自动清理');
        return;
      }

      const latest = await queryPaymentStatus(activeOrder.id);
      if (latest.transactionId) {
        setTransactionId(latest.transactionId);
      }

      if (latest.status === 'paid') {
        finalizePaid(activeOrder.id, activeOrder.amount, '收款成功，订单已标记为已支付');
        return;
      }

      if (latest.status !== 'timeout') {
        return;
      }

      const { error } = await deleteOrder(activeOrder.id);
      if (!error) {
        setActiveOrder(null);
        setCart(new Map());
        setStatus('timeout');
        setStatusMessage('未支付订单已超时自动删除，请重新建单');
        setTransactionId('');
        setPaymentAuthCode('');
      }
    };

    void checkAndCleanupUnpaidOrder();
    const timer = window.setInterval(() => {
      void checkAndCleanupUnpaidOrder();
    }, 60 * 1000);

    return () => {
      window.clearInterval(timer);
    };
  }, [activeOrder, deleteOrder, finalizePaid, isCollecting]);

  useEffect(() => {
    const onGlobalKeyDown = (event: KeyboardEvent): void => {
      const target = event.target as EventTarget | null;
      const editableTarget = target instanceof HTMLInputElement
        || target instanceof HTMLTextAreaElement
        || target instanceof HTMLSelectElement
        || (target instanceof HTMLElement && target.isContentEditable);
      if (editableTarget && target !== productInputRef.current && target !== paymentInputRef.current) {
        return;
      }

      if (event.ctrlKey || event.altKey || event.metaKey) return;
      const isDigit = /^\d$/.test(event.key);
      const now = Date.now();

      if (isDigit) {
        const currentTarget = scanTargetRef.current;
        if (scanBufferRef.current.length > 0 && now - lastKeyTsRef.current > scanResetThresholdMs) {
          scanBufferRef.current = '';
        }
        lastKeyTsRef.current = now;
        scanBufferRef.current = `${scanBufferRef.current}${event.key}`;
        scheduleScanDisplaySync(currentTarget);
        return;
      }

      if ((event.key === 'Enter' || event.key === 'Tab') && scanBufferRef.current.length > 0) {
        event.preventDefault();
        if (isScannerProcessingRef.current) return;

        isScannerProcessingRef.current = true;
        void (async () => {
          try {
            const currentTarget = scanTargetRef.current;
            const scanned = scanBufferRef.current;
            scanBufferRef.current = '';
            syncScanDisplay(currentTarget, '');

            if (currentTarget === 'product') {
              addProductByBarcodeRef.current(scanned);
              syncScanDisplay('product', '');
              return;
            }

            const authCode = normalizeDigits(scanned).slice(0, 24);
            syncScanDisplay('payment', authCode);
            const detectedMethod = detectPaymentMethodByAuthCode(authCode);
            if (detectedMethod) {
              setPaymentMethod(detectedMethod);
            }
            if (authCode.length >= 16 && authCode.length <= 24) {
              await collectByCodeRef.current(authCode);
              return;
            }

            setStatus('failed');
            setStatusMessage('付款码格式错误，应为 16-24 位数字');
          } finally {
            isScannerProcessingRef.current = false;
          }
        })();
        return;
      }

      if (event.key === 'Escape' && scanBufferRef.current.length > 0) {
        const currentTarget = scanTargetRef.current;
        scanBufferRef.current = '';
        syncScanDisplay(currentTarget, '');
      }
    };

    window.addEventListener('keydown', onGlobalKeyDown);
    return () => {
      window.removeEventListener('keydown', onGlobalKeyDown);
    };
  }, [scanResetThresholdMs, scheduleScanDisplaySync, syncScanDisplay]);

  if (!canUseCashier) {
    return (
      <div className="bg-white/5 border border-white/10 rounded-3xl p-6 text-white/70">
        当前账号无收款权限，仅管理员/库存管理员可使用扫码收银台。
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="bg-white/5 border border-white/10 rounded-3xl p-5 flex items-start justify-between gap-4">
        <div>
          <h3 className="text-xl font-bold">扫码收银台（Web）</h3>
          <p className="text-sm text-white/50 mt-1">流程：扫商品条码建单 → 扫客户付款码收款（支持微信/支付宝）</p>
          <p className="text-xs text-white/40 mt-2">{configMessage}</p>
        </div>
        <span className={`px-3 py-1 rounded-full border text-xs font-bold ${isPaymentMockMode ? 'text-orange-300 border-orange-400/40 bg-orange-500/10' : 'text-green-300 border-green-400/40 bg-green-500/10'}`}>
          {isPaymentMockMode ? 'MOCK' : 'LIVE'}
        </span>
      </div>

      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => setScanTarget('product')}
          className={`px-4 py-2 rounded-xl border text-sm font-semibold ${scanTarget === 'product' ? 'bg-accent/20 border-accent/40 text-white' : 'bg-white/5 border-white/10 text-white/60'}`}
        >
          扫码目标：商品条码
        </button>
        <button
          type="button"
          onClick={() => setScanTarget('payment')}
          className={`px-4 py-2 rounded-xl border text-sm font-semibold ${scanTarget === 'payment' ? 'bg-emerald-500/20 border-emerald-400/40 text-white' : 'bg-white/5 border-white/10 text-white/60'}`}
        >
          扫码目标：客户付款码
        </button>
      </div>

      <div className="bg-white/5 border border-white/10 rounded-2xl p-4 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <button
            type="button"
            onClick={() => setShowTimingPanel((prev) => !prev)}
            className={`px-3 py-1.5 rounded-lg border text-xs font-semibold ${showTimingPanel ? 'bg-accent/20 border-accent/40 text-white' : 'bg-white/5 border-white/10 text-white/70'}`}
          >
            {showTimingPanel ? '隐藏性能监控' : '显示性能监控'}
          </button>
        </div>

        {showTimingPanel && (
          <div className="space-y-3 border-t border-white/10 pt-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-xs text-white/60">性能分段耗时监控</p>
              <button
                type="button"
                onClick={resetScannerState}
                className="px-3 py-1 rounded-lg border text-xs font-semibold bg-white/5 border-white/20 text-white/70"
              >
                重置扫码状态
              </button>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <p className="text-xs text-white/60">扫码重置阈值：</p>
              {scanThresholdPresets.map((preset) => (
                <button
                  key={preset}
                  type="button"
                  onClick={() => setScanResetThresholdMs(preset)}
                  className={`px-3 py-1 rounded-lg border text-xs font-semibold ${scanResetThresholdMs === preset ? 'bg-accent/20 border-accent/40 text-white' : 'bg-white/5 border-white/10 text-white/60'}`}
                >
                  {preset}ms
                </button>
              ))}
            </div>

            <div className="space-y-2">
              <p className="text-xs text-white/60">当前操作分段耗时</p>
              <div className="max-h-32 overflow-y-auto border border-white/10 rounded-lg divide-y divide-white/5">
                {currentTiming.length === 0 ? <p className="px-3 py-2 text-xs text-white/40">暂无记录</p> : null}
                {currentTiming.map((entry, index) => (
                  <div key={`${entry.timestamp}-${entry.label}-${index}`} className="px-3 py-2 text-xs flex items-center justify-between gap-3">
                    <span className="text-white/70">{entry.label}</span>
                    <span className={`font-mono ${entry.isError ? 'text-red-300' : 'text-white/90'}`}>{entry.durationMs.toFixed(1)}ms</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="space-y-2">
              <p className="text-xs text-white/60">历史操作日志（最近 20 条）</p>
              <div className="max-h-48 overflow-y-auto border border-white/10 rounded-lg divide-y divide-white/5">
                {operationLogs.length === 0 ? <p className="px-3 py-2 text-xs text-white/40">暂无记录</p> : null}
                {operationLogs.map((log) => (
                  <div key={log.id} className="px-3 py-2 text-xs space-y-1">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-white/70">
                        {log.type === 'order' ? '建单' : '收款'} · {new Date(log.timestamp).toLocaleTimeString('zh-CN', { hour12: false })}
                      </span>
                      <div className="flex items-center gap-2">
                        {log.hitFallback ? <span className="px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-200">fallback</span> : null}
                        <span className="font-mono text-white/90">{log.totalMs.toFixed(1)}ms</span>
                      </div>
                    </div>
                    <div className="text-white/50">{log.entries.map((entry) => `${entry.label}:${entry.durationMs.toFixed(1)}ms`).join(' | ')}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="bg-white/5 border border-white/10 rounded-3xl p-5 space-y-4">
          <div className="flex items-center gap-2 text-white/80">
            <ScanLine size={18} />
            <h4 className="font-semibold">1) 扫描商品条码（每次 +1）</h4>
          </div>
          <input
            ref={productInputRef}
            value={productScanCode}
            onChange={(event) => setProductScanCode(event.target.value.replace(/\D/g, '').slice(0, 13))}
            onKeyDown={(event) => {
              event.stopPropagation();
              if (event.key === 'Enter') {
                event.preventDefault();
                handleProductScanSubmit();
              }
            }}
            placeholder="扫描商品条码后自动回车"
            className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3"
          />

          <div className="max-h-[280px] overflow-auto border border-white/10 rounded-2xl divide-y divide-white/5">
            {cartItems.length === 0 && <p className="px-4 py-6 text-sm text-white/50">尚未加入商品</p>}
            {cartItems.map((item) => (
              <div key={item.product.id} className="px-4 py-3 flex items-center justify-between gap-3">
                <div>
                  <p className="font-medium">{item.product.name}</p>
                  <p className="text-xs text-white/40">条码 {item.product.barcode || '无'} · 单价 ¥{item.product.discount_price}</p>
                </div>
                <div className="flex items-center gap-2">
                  <button type="button" onClick={() => updateCartQuantity(item.product.id, Math.max(0, item.quantity - 1))} className="px-2 py-1 rounded bg-white/10">-1</button>
                  <span className="text-sm min-w-8 text-center">{item.quantity}</span>
                  <button type="button" onClick={() => updateCartQuantity(item.product.id, item.quantity + 1)} className="px-2 py-1 rounded bg-white/10">+1</button>
                </div>
              </div>
            ))}
          </div>

          <div className="flex items-center justify-between">
            <p className="text-white/60">订单金额</p>
            <p className="text-xl font-black">¥{totalAmount.toFixed(2)}</p>
          </div>

          <button
            type="button"
            onClick={() => {
              void handleCreateOrder();
            }}
            disabled={isCreatingOrder || cartItems.length === 0}
            className="w-full py-2.5 rounded-xl bg-tech-gradient font-bold disabled:opacity-50"
          >
            {isCreatingOrder ? '创建订单中...' : '创建订单'}
          </button>
        </div>

        <div className="bg-white/5 border border-white/10 rounded-3xl p-5 space-y-4">
          <div className="flex items-center gap-2 text-white/80">
            <CreditCard size={18} />
            <h4 className="font-semibold">2) 扫描客户付款码收款</h4>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setPaymentMethod('alipay')}
              className={`px-3 py-1.5 rounded-lg border text-xs font-semibold ${paymentMethod === 'alipay' ? 'bg-sky-500/20 border-sky-400/40 text-white' : 'bg-white/5 border-white/10 text-white/60'}`}
            >
              支付宝付款码
            </button>
            <button
              type="button"
              onClick={() => setPaymentMethod('wechat')}
              className={`px-3 py-1.5 rounded-lg border text-xs font-semibold ${paymentMethod === 'wechat' ? 'bg-emerald-500/20 border-emerald-400/40 text-white' : 'bg-white/5 border-white/10 text-white/60'}`}
            >
              微信付款码
            </button>
          </div>

          <div className="bg-white/5 rounded-xl p-3 text-sm space-y-1">
            <p>订单号：{activeOrder ? `#${activeOrder.id.slice(0, 8)}` : '未创建'}</p>
            <p>应收金额：{activeOrder ? `¥${activeOrder.amount.toFixed(2)}` : '-'}</p>
            {transactionId && <p>交易号：{transactionId}</p>}
          </div>

          {activeOrder && canAdjustAmount && (
            <div className="bg-white/[0.03] border border-white/10 rounded-xl p-3 space-y-3">
              <div className="flex items-center justify-between gap-2">
                <p className="text-xs text-white/60">管理员按商品抹零（逐个商品单价调整）</p>
                <button
                  type="button"
                  onClick={applyItemLevelRounding}
                  disabled={isApplyingItemRounding}
                  className="px-3 py-1.5 rounded-lg bg-white/10 border border-white/20 text-xs font-semibold disabled:opacity-50"
                >
                  {isApplyingItemRounding ? '保存中...' : '应用抹零'}
                </button>
              </div>
              <div className="max-h-48 overflow-y-auto space-y-2 pr-1">
                {activeOrder.items.map((item) => (
                  <div key={item.id} className="grid grid-cols-[1fr_auto_auto] gap-2 items-center text-xs">
                    <div className="min-w-0">
                      <p className="truncate text-white/90">{item.productName} × {item.quantity}</p>
                      <p className="text-white/40">零售价 ¥{item.retailPrice.toFixed(2)} / 当前实收 ¥{item.discountPrice.toFixed(2)}</p>
                    </div>
                    <input
                      value={item.draftDiscountPrice}
                      onChange={(event) => updateItemDraftPrice(item.id, event.target.value)}
                      placeholder="实收单价"
                      className="w-24 bg-white/5 border border-white/10 rounded-lg px-2 py-1.5 text-right"
                    />
                    <span className="text-white/60 w-20 text-right">¥{(Number(item.draftDiscountPrice || 0) * item.quantity).toFixed(2)}</span>
                  </div>
                ))}
              </div>
              <p className="text-[11px] text-white/40">原始总额：¥{activeOrder.originalAmount.toFixed(2)}，当前应收：¥{activeOrder.amount.toFixed(2)}（仅允许不高于零售价）</p>
            </div>
          )}

          <input
            ref={paymentInputRef}
            value={paymentAuthCode}
            onChange={(event) => {
              const nextCode = event.target.value.replace(/\D/g, '').slice(0, 24);
              setPaymentAuthCode(nextCode);
              const detectedMethod = detectPaymentMethodByAuthCode(nextCode);
              if (detectedMethod && detectedMethod !== paymentMethod) {
                setPaymentMethod(detectedMethod);
                setStatus('pending');
                setStatusMessage(`已根据付款码自动推荐${detectedMethod === 'wechat' ? '微信' : '支付宝'}通道`);
              }
            }}
            onKeyDown={(event) => {
              event.stopPropagation();
              if (event.key === 'Enter' && !isCollecting && status !== 'paid') {
                event.preventDefault();
                void handleCollect();
              }
            }}
            placeholder={`扫描${paymentMethod === 'wechat' ? '微信' : '支付宝'}付款码（16-24位）`}
            className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3"
          />

          <button
            type="button"
            onClick={() => {
              void handleCollect();
            }}
            disabled={isCollecting || !activeOrder || status === 'paid'}
            className="w-full py-2.5 rounded-xl bg-emerald-500/90 font-bold disabled:opacity-50"
          >
            {isCollecting ? '收款处理中...' : '确认收款'}
          </button>

          <div className={`rounded-xl px-4 py-3 text-sm border ${status === 'paid' ? 'bg-green-500/10 border-green-500/30 text-green-300' : status === 'failed' || status === 'timeout' ? 'bg-red-500/10 border-red-500/30 text-red-300' : 'bg-white/5 border-white/10 text-white/70'}`}>
            <p className="font-semibold">当前状态：{status}</p>
            <p className="mt-1">{statusMessage}</p>
          </div>
        </div>
      </div>
    </div>
  );
};
