import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CreditCard, ScanLine } from 'lucide-react';
import { useAppStore } from '../store/useAppStore';
import {
  collectAlipayByAuthCode,
  runPaymentReadinessPrecheck,
  isPaymentMockMode,
  queryPaymentStatus,
  validateAuthCode,
  type WebPaymentStatus,
} from '../lib/payment';
import { calculateRetailOrderTotals } from '../utils/orderPricing';

const wait = (ms: number): Promise<void> => new Promise((resolve) => {
  window.setTimeout(resolve, ms);
});

const scanResetThresholdMs = 300;

export const PaymentScreen: React.FC = () => {
  const { user, products, createRetailOrders, fetchOrders } = useAppStore();
  const [productScanCode, setProductScanCode] = useState('');
  const [paymentAuthCode, setPaymentAuthCode] = useState('');
  const [cart, setCart] = useState<Map<string, number>>(new Map());
  const [activeOrder, setActiveOrder] = useState<{ id: string; amount: number } | null>(null);
  const [isCreatingOrder, setIsCreatingOrder] = useState(false);
  const [isCollecting, setIsCollecting] = useState(false);
  const [status, setStatus] = useState<WebPaymentStatus>('pending');
  const [statusMessage, setStatusMessage] = useState('等待创建订单');
  const [transactionId, setTransactionId] = useState('');
  const [configMessage, setConfigMessage] = useState('检查支付配置中...');
  const [scanTarget, setScanTarget] = useState<'product' | 'payment'>('product');

  const productInputRef = useRef<HTMLInputElement | null>(null);
  const paymentInputRef = useRef<HTMLInputElement | null>(null);
  const scanBufferRef = useRef('');
  const lastKeyTsRef = useRef(0);
  const addProductByBarcodeRef = useRef<(code: string) => void>(() => undefined);
  const collectByCodeRef = useRef<(code: string) => Promise<void>>(async () => undefined);

  const canUseCashier = user?.role === 'admin' || user?.role === 'inventory_manager';

  const cartItems = useMemo(() => {
    return Array.from(cart.entries())
      .map(([productId, quantity]) => {
        const product = products.find((item) => item.id === productId);
        if (!product) return null;
        return { product, quantity };
      })
      .filter((item): item is { product: (typeof products)[number]; quantity: number } => item !== null);
  }, [cart, products]);

  const totalAmount = useMemo(() => {
    return calculateRetailOrderTotals(cartItems).totalRetail;
  }, [cartItems]);

  useEffect(() => {
    productInputRef.current?.focus();
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
    const barcode = rawCode.replace(/\D/g, '').slice(0, 13);
    if (barcode.length !== 13) {
      setStatus('failed');
      setStatusMessage('商品条码必须是 13 位数字');
      return;
    }

    const product = products.find((item) => item.barcode === barcode);
    if (!product) {
      setStatus('failed');
      setStatusMessage(`未找到条码 ${barcode} 对应商品`);
      return;
    }

    const currentQty = cart.get(product.id) || 0;
    updateCartQuantity(product.id, currentQty + 1);
    setStatus('pending');
    setStatusMessage(`已加入 ${product.name} x1`);
  }, [cart, products, updateCartQuantity]);

  const handleProductScanSubmit = (): void => {
    addProductByBarcode(productScanCode);
    setProductScanCode('');
    productInputRef.current?.focus();
  };

  const resolveCreatedOrder = (amount: number): { id: string; amount: number } | null => {
    const { orders } = useAppStore.getState();
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

    if (!matched) return null;
    return {
      id: matched.id,
      amount: Number(matched.total_discount_amount || amount),
    };
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

      await fetchOrders();
      const created = result.orderId
        ? { id: result.orderId, amount: totalAmount }
        : resolveCreatedOrder(totalAmount);
      if (!created) {
        setStatus('failed');
        setStatusMessage('订单已创建，但未能自动定位订单号，请到订单列表确认');
        return;
      }

      setActiveOrder(created);
      setTransactionId('');
      setPaymentAuthCode('');
      setStatus('pending');
      setStatusMessage(`零售订单已创建：#${created.id.slice(0, 8)}，请扫描客户付款码`);
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
      setStatus('failed');
      setStatusMessage('请先创建订单，再扫描客户付款码');
      return;
    }

    const authCode = (inputCode ?? paymentAuthCode).trim();
    if (!validateAuthCode(authCode)) {
      setStatus('failed');
      setStatusMessage('付款码格式错误，应为 16-24 位数字');
      return;
    }

    setIsCollecting(true);
    try {
      const result = await collectAlipayByAuthCode({
        orderId: activeOrder.id,
        amount: activeOrder.amount,
        authCode,
      });

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
        setStatusMessage('收款成功，订单已完成支付');
        setCart(new Map());
        return;
      }

      setStatusMessage('支付处理中，正在查询最终状态...');
      await pollUntilSettled(activeOrder.id);
    } catch (error) {
      setStatus('failed');
      setStatusMessage(`收款异常：${error instanceof Error ? error.message : '未知错误'}`);
    } finally {
      setIsCollecting(false);
      setPaymentAuthCode('');
      paymentInputRef.current?.focus();
    }
  }, [activeOrder, paymentAuthCode, pollUntilSettled]);

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
      if (event.ctrlKey || event.altKey || event.metaKey) return;
      const isDigit = /^\d$/.test(event.key);
      const now = Date.now();

      if (isDigit) {
        if (now - lastKeyTsRef.current > scanResetThresholdMs) {
          scanBufferRef.current = '';
        }
        lastKeyTsRef.current = now;
        scanBufferRef.current = `${scanBufferRef.current}${event.key}`;

        if (scanTarget === 'product') {
          setProductScanCode(scanBufferRef.current.slice(0, 13));
        } else {
          setPaymentAuthCode(scanBufferRef.current.slice(0, 24));
        }
        return;
      }

      if ((event.key === 'Enter' || event.key === 'Tab') && scanBufferRef.current.length > 0) {
        event.preventDefault();
        const scanned = scanBufferRef.current;
        scanBufferRef.current = '';

        if (scanTarget === 'product') {
          const barcode = scanned.replace(/\D/g, '').slice(0, 13);
          if (barcode.length === 13) {
            addProductByBarcodeRef.current(barcode);
          }
          setProductScanCode('');
          return;
        }

        const authCode = scanned.replace(/\D/g, '').slice(0, 24);
        setPaymentAuthCode(authCode);
        if (authCode.length >= 16 && authCode.length <= 24) {
          void collectByCodeRef.current(authCode);
        }
      }
    };

    window.addEventListener('keydown', onGlobalKeyDown);
    return () => {
      window.removeEventListener('keydown', onGlobalKeyDown);
    };
  }, [scanTarget]);

  if (!canUseCashier) {
    return (
      <div className="bg-white/5 border border-white/10 rounded-3xl p-6 text-white/70">
        当前账号无收款权限，仅管理员/库存管理员可使用扫码收款台。
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="bg-white/5 border border-white/10 rounded-3xl p-5 flex items-start justify-between gap-4">
        <div>
          <h3 className="text-xl font-bold">扫码收款台（Web）</h3>
          <p className="text-sm text-white/50 mt-1">流程：扫商品条码建单 → 扫客户付款码收款（支付宝条码）</p>
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

          <div className="bg-white/5 rounded-xl p-3 text-sm space-y-1">
            <p>订单号：{activeOrder ? `#${activeOrder.id.slice(0, 8)}` : '未创建'}</p>
            <p>应收金额：{activeOrder ? `¥${activeOrder.amount.toFixed(2)}` : '-'}</p>
            {transactionId && <p>交易号：{transactionId}</p>}
          </div>

          <input
            ref={paymentInputRef}
            value={paymentAuthCode}
            onChange={(event) => setPaymentAuthCode(event.target.value.replace(/\D/g, '').slice(0, 24))}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                void handleCollect();
              }
            }}
            placeholder="扫描客户付款码（16-24位）"
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
