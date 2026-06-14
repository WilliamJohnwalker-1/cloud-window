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

interface ScanDiagnostics {
  totalAttempts: number;
  productAccepted: number;
  paymentAccepted: number;
  switchedToPaymentTarget: number;
  rejectedAttempts: number;
  timeoutResets: number;
}

interface ScanEventRecord {
  ts: number;
  target: 'product' | 'payment';
  code: string;
  result: string;
}

interface ActiveOrderItemDraft {
  id: string;
  productName: string;
  quantity: number;
  retailPrice: number;
  discountPrice: number;
  draftDiscountPrice: string;
}
const normalizeDigits = (input: string): string => input.replace(/\D/g, '');
const normalizeProductBarcode = (input: string): string => normalizeDigits(input).slice(0, 13);
const detectPaymentMethodByAuthCode = (input: string): 'wechat' | 'alipay' | null => {
  const digits = normalizeDigits(input).slice(0, 24);
  if (digits.length < 16 || digits.length > 24) return null;
  const prefix = Number(digits.slice(0, 2));
  if (prefix >= 10 && prefix <= 15) return 'wechat';
  if (prefix >= 25 && prefix <= 30) return 'alipay';
  return null;
};

export const PaymentScreen: React.FC = () => {
  const { user, products, createRetailOrders, fetchOrders, fetchOrderDetail, orders } = useAppStore();
  const [productScanCode, setProductScanCode] = useState('');
  const [paymentAuthCode, setPaymentAuthCode] = useState('');
  const [cart, setCart] = useState<Map<string, number>>(new Map());
  const [activeOrder, setActiveOrder] = useState<{ id: string; amount: number; originalAmount: number; items: ActiveOrderItemDraft[] } | null>(null);
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
  const [showScannerDebug, setShowScannerDebug] = useState(false);
  const [scanDiagnostics, setScanDiagnostics] = useState<ScanDiagnostics>({
    totalAttempts: 0,
    productAccepted: 0,
    paymentAccepted: 0,
    switchedToPaymentTarget: 0,
    rejectedAttempts: 0,
    timeoutResets: 0,
  });
  const [scanEvents, setScanEvents] = useState<ScanEventRecord[]>([]);

  const productInputRef = useRef<HTMLInputElement | null>(null);
  const paymentInputRef = useRef<HTMLInputElement | null>(null);
  const scanBufferRef = useRef('');
  const lastKeyTsRef = useRef(0);
  const scanTargetRef = useRef<'product' | 'payment'>('product');
  const isScannerProcessingRef = useRef(false);
  const scanDisplaySyncTimeoutRef = useRef<number | null>(null);
  const addProductByBarcodeRef = useRef<(code: string) => void>(() => undefined);
  const collectByCodeRef = useRef<(code: string) => Promise<void>>(async () => undefined);

  const canUseCashier = user?.role === 'admin' || user?.role === 'super_admin' || user?.role === 'inventory_manager';
  const canAdjustAmount = user?.role === 'admin' || user?.role === 'super_admin';

  const pushScanEvent = useCallback((event: Omit<ScanEventRecord, 'ts'>): void => {
    setScanEvents((prev) => [{ ...event, ts: Date.now() }, ...prev].slice(0, 20));
  }, []);

  const bumpDiagnostics = useCallback((patch: Partial<ScanDiagnostics>): void => {
    setScanDiagnostics((prev) => ({
      ...prev,
      totalAttempts: prev.totalAttempts + (patch.totalAttempts ?? 0),
      productAccepted: prev.productAccepted + (patch.productAccepted ?? 0),
      paymentAccepted: prev.paymentAccepted + (patch.paymentAccepted ?? 0),
      switchedToPaymentTarget: prev.switchedToPaymentTarget + (patch.switchedToPaymentTarget ?? 0),
      rejectedAttempts: prev.rejectedAttempts + (patch.rejectedAttempts ?? 0),
      timeoutResets: prev.timeoutResets + (patch.timeoutResets ?? 0),
    }));
  }, []);

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

  const resetScannerDiagnostics = useCallback((): void => {
    setScanDiagnostics({
      totalAttempts: 0,
      productAccepted: 0,
      paymentAccepted: 0,
      switchedToPaymentTarget: 0,
      rejectedAttempts: 0,
      timeoutResets: 0,
    });
    setScanEvents([]);
    scanBufferRef.current = '';
    syncScanDisplay(scanTargetRef.current, '');
    setStatus('pending');
    setStatusMessage('已重置扫码调试统计');
  }, [syncScanDisplay]);

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
      bumpDiagnostics({ switchedToPaymentTarget: 1 });
      pushScanEvent({ target: scanTargetRef.current, code: digits.slice(0, 24), result: 'switch_to_payment_target' });
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
      bumpDiagnostics({ rejectedAttempts: 1 });
      pushScanEvent({ target: scanTargetRef.current, code: digits.slice(0, 24), result: 'reject_invalid_product_barcode' });
      setStatus('failed');
      setStatusMessage('商品条码必须是 13 位数字');
      return;
    }

    const product = productByBarcode.get(barcode);
    if (!product) {
      bumpDiagnostics({ rejectedAttempts: 1 });
      pushScanEvent({ target: scanTargetRef.current, code: barcode, result: 'reject_product_not_found' });
      setStatus('failed');
      setStatusMessage(`未找到条码 ${barcode} 对应商品`);
      return;
    }

    const currentQty = cart.get(product.id) || 0;
    updateCartQuantity(product.id, currentQty + 1);
    bumpDiagnostics({ totalAttempts: 1, productAccepted: 1 });
    pushScanEvent({ target: scanTargetRef.current, code: barcode, result: `product_added:${product.name}` });
    setStatus('pending');
    setStatusMessage(`已加入 ${product.name} x1`);
  }, [bumpDiagnostics, cart, productByBarcode, pushScanEvent, updateCartQuantity]);

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
      const ageMs = now - new Date(order.created_at).getTime();
      if (ageMs > 3 * 60 * 1000) return false;
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
    try {
      const result = await createRetailOrders(cartItems.map((item) => ({
        productId: item.product.id,
        quantity: item.quantity,
      })));

      if (result.error) {
        setStatus('failed');
        setStatusMessage(`创建订单失败：${result.error.message}`);
        return;
      }

      if (!result.orderId) {
        await fetchOrders();
      }
      const orderId = result.orderId || resolveCreatedOrderId(totalAmount);
      if (!orderId) {
        setStatus('failed');
        setStatusMessage('订单已创建，但未能自动定位订单号，请到订单列表确认');
        return;
      }

      const detail = await fetchOrderDetail(orderId);
      if (!detail || detail.items.length === 0) {
        setStatus('failed');
        setStatusMessage('订单已创建，但未能加载商品明细，请到订单页刷新后重试');
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
      });
      setTransactionId('');
      setPaymentAuthCode('');
      setScanTarget('payment');
      setStatus('pending');
      setStatusMessage(`零售订单已创建：#${orderId.slice(0, 8)}，请扫描客户付款码`);
      paymentInputRef.current?.focus();
    } finally {
      setIsCreatingOrder(false);
    }
  };

  const pollUntilSettled = useCallback(async (orderId: string): Promise<void> => {
    for (let index = 0; index < 30; index += 1) {
      const latest = await queryPaymentStatus(orderId);
      setStatus(latest.status);
      if (latest.transactionId) {
        setTransactionId(latest.transactionId);
      }

      if (latest.status === 'paid') {
        setStatusMessage('收款成功，订单已标记为已支付');
        return;
      }

      if (latest.status === 'failed' || latest.status === 'timeout') {
        setStatusMessage(latest.status === 'timeout' ? '收款超时，请重试扫码收款' : '收款失败，请重试');
        return;
      }

      await wait(1500);
    }

    setStatusMessage('仍在等待支付结果，请稍后在订单页刷新状态');
  }, []);

  const handleCollect = useCallback(async (inputCode?: string): Promise<void> => {
    if (!activeOrder) {
      bumpDiagnostics({ rejectedAttempts: 1 });
      pushScanEvent({ target: scanTargetRef.current, code: normalizeDigits((inputCode ?? paymentAuthCode).trim()).slice(0, 24), result: 'reject_no_active_order' });
      setStatus('failed');
      setStatusMessage('请先创建订单，再扫描客户付款码');
      return;
    }

    const authCode = normalizeDigits((inputCode ?? paymentAuthCode).trim()).slice(0, 24);
    if (!validateAuthCode(authCode)) {
      bumpDiagnostics({ rejectedAttempts: 1 });
      pushScanEvent({ target: scanTargetRef.current, code: authCode, result: 'reject_invalid_auth_code' });
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
      bumpDiagnostics({ rejectedAttempts: 1 });
      pushScanEvent({ target: scanTargetRef.current, code: authCode, result: `reject_mismatched_channel:${resolvedPaymentMethod}` });
      setStatus('failed');
      setStatusMessage(
        resolvedPaymentMethod === 'wechat'
          ? '微信付款码格式错误，应为 18 位数字且以 10-15 开头'
          : '支付宝付款码格式错误，应为 16-24 位数字且以 25-30 开头',
      );
      return;
    }

    setIsCollecting(true);
    try {
      const result = await collectByAuthCode({
        orderId: activeOrder.id,
        amount: activeOrder.amount,
        paymentMethod: resolvedPaymentMethod,
        authCode,
      });

      if (!result.success) {
        bumpDiagnostics({ rejectedAttempts: 1 });
        pushScanEvent({ target: scanTargetRef.current, code: authCode, result: `reject_collect_failed:${result.error || 'unknown'}` });
        setStatus('failed');
        setStatusMessage(`收款失败：${result.error || '未知错误'}`);
        return;
      }

      bumpDiagnostics({ totalAttempts: 1, paymentAccepted: 1 });
      pushScanEvent({ target: scanTargetRef.current, code: authCode, result: `payment_submitted:${resolvedPaymentMethod}` });

      setStatus(result.status);
      if (result.transactionId) {
        setTransactionId(result.transactionId);
      }

      if (result.status === 'paid') {
        setStatusMessage('收款成功，订单已完成支付');
        setCart(new Map());
        return;
      }

      setStatusMessage('支付处理中，正在查询最终状态...');
      await pollUntilSettled(activeOrder.id);
    } catch (error) {
      bumpDiagnostics({ rejectedAttempts: 1 });
      pushScanEvent({ target: scanTargetRef.current, code: authCode, result: 'reject_collect_exception' });
      setStatus('failed');
      setStatusMessage(`收款异常：${error instanceof Error ? error.message : '未知错误'}`);
    } finally {
      setIsCollecting(false);
      setPaymentAuthCode('');
      paymentInputRef.current?.focus();
    }
  }, [activeOrder, bumpDiagnostics, paymentAuthCode, paymentMethod, pollUntilSettled, pushScanEvent]);

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
          bumpDiagnostics({ timeoutResets: 1 });
          pushScanEvent({
            target: currentTarget,
            code: scanBufferRef.current.slice(0, 24),
            result: `timeout_reset>${scanResetThresholdMs}ms`,
          });
          scanBufferRef.current = '';
        }
        lastKeyTsRef.current = now;
        scanBufferRef.current = `${scanBufferRef.current}${event.key}`;
        scheduleScanDisplaySync(currentTarget);
        return;
      }

      if ((event.key === 'Enter' || event.key === 'Tab') && scanBufferRef.current.length > 0) {
        event.preventDefault();
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
          void collectByCodeRef.current(authCode);
          return;
        }

        bumpDiagnostics({ rejectedAttempts: 1 });
        pushScanEvent({ target: 'payment', code: authCode, result: 'reject_payment_code_length' });
        setStatus('failed');
        setStatusMessage('付款码格式错误，应为 16-24 位数字');
        return;
      }

      if (event.key === 'Escape' && scanBufferRef.current.length > 0) {
        const currentTarget = scanTargetRef.current;
        scanBufferRef.current = '';
        syncScanDisplay(currentTarget, '');
        pushScanEvent({ target: currentTarget, code: '', result: 'manual_buffer_reset' });
      }
    };

    window.addEventListener('keydown', onGlobalKeyDown);
    return () => {
      window.removeEventListener('keydown', onGlobalKeyDown);
    };
  }, [bumpDiagnostics, pushScanEvent, scanResetThresholdMs, scheduleScanDisplaySync, syncScanDisplay]);

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
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setShowScannerDebug((prev) => !prev)}
            className={`px-3 py-1.5 rounded-lg border text-xs font-semibold ${showScannerDebug ? 'bg-amber-500/20 border-amber-400/40 text-white' : 'bg-white/5 border-white/10 text-white/60'}`}
          >
            {showScannerDebug ? '关闭扫码调试' : '开启扫码调试'}
          </button>
          <button
            type="button"
            onClick={resetScannerDiagnostics}
            className="px-3 py-1.5 rounded-lg border text-xs font-semibold bg-white/5 border-white/20 text-white/70"
          >
            重置统计
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

        {showScannerDebug && (
          <div className="space-y-3">
            <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-2">
              <p className="text-xs bg-white/5 rounded-lg px-2 py-1">扫描成功: {scanDiagnostics.totalAttempts}</p>
              <p className="text-xs bg-white/5 rounded-lg px-2 py-1">商品成功: {scanDiagnostics.productAccepted}</p>
              <p className="text-xs bg-white/5 rounded-lg px-2 py-1">付款提交: {scanDiagnostics.paymentAccepted}</p>
              <p className="text-xs bg-white/5 rounded-lg px-2 py-1">自动切目标: {scanDiagnostics.switchedToPaymentTarget}</p>
              <p className="text-xs bg-white/5 rounded-lg px-2 py-1">失败拒绝: {scanDiagnostics.rejectedAttempts}</p>
              <p className="text-xs bg-white/5 rounded-lg px-2 py-1">超时重置: {scanDiagnostics.timeoutResets}</p>
            </div>

            <div className="max-h-[180px] overflow-auto border border-white/10 rounded-xl divide-y divide-white/5">
              {scanEvents.length === 0 ? <p className="px-3 py-2 text-xs text-white/40">暂无扫码事件</p> : null}
              {scanEvents.map((event) => (
                <div key={`${event.ts}-${event.code}-${event.result}`} className="px-3 py-2 text-xs text-white/70 flex items-center justify-between gap-3">
                  <span className="text-white/50">{new Date(event.ts).toLocaleTimeString('zh-CN', { hour12: false })}</span>
                  <span>{event.target === 'product' ? '商品' : '付款'}</span>
                  <span className="truncate max-w-[180px]">{event.code || '-'}</span>
                  <span className="truncate max-w-[220px] text-white/50">{event.result}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
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
              if (event.key === 'Enter') {
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
            disabled={isCollecting || !activeOrder}
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
