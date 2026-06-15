import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { CheckCircle2, ChevronRight, Clock, Download, MapPin, Plus, ShoppingCart, Store, Trash2, X } from 'lucide-react';
import { motion } from 'framer-motion';
import { useAppStore } from '../store/useAppStore';
import type { OrderKind } from '../types';
import { getPaymentApiEndpoint } from '../lib/payment';
import { resolvePrice } from '../utils/priceResolver';

type OrderFilter = 'all' | 'pending' | 'accepted';
type StatsRange = 'day' | 'week' | 'month' | 'year' | 'all' | 'range';
type RefundViewFilter = 'all' | 'revenue' | 'refunded';

interface CartDraftItem {
  quantity: number;
  isSample: boolean;
}

interface RefundSubmitResponse {
  success?: boolean;
  status?: string;
  error?: string;
  message?: string;
  msg?: string;
  detail?: string;
  refundAmount?: number;
  requestedAmount?: number;
  orderDeleted?: boolean;
}

const parseRefundResponse = async (response: Response): Promise<RefundSubmitResponse & { rawText?: string }> => {
  const contentType = response.headers.get('content-type') || '';
  if (contentType.includes('application/json')) {
    try {
      return (await response.json()) as RefundSubmitResponse;
    } catch {
      return { success: false, error: `响应 JSON 解析失败（HTTP ${response.status}）` };
    }
  }

  try {
    const rawText = (await response.text()).trim();
    if (rawText.length === 0) {
      return { success: false, error: `网关返回空响应（HTTP ${response.status}）` };
    }
    return {
      success: false,
      error: `网关返回非 JSON（HTTP ${response.status}）`,
      rawText,
    };
  } catch {
    return { success: false, error: `读取网关响应失败（HTTP ${response.status}）` };
  }
};

const wait = (ms: number): Promise<void> => new Promise((resolve) => {
  setTimeout(resolve, ms);
});

const extractRefundErrorText = (payload: RefundSubmitResponse & { rawText?: string } | null): string => {
  if (!payload) return '';
  const candidates = [payload.error, payload.message, payload.msg, payload.detail, payload.rawText]
    .filter((item) => typeof item === 'string' && item.trim().length > 0) as string[];
  return candidates.join(' | ');
};

type CartLineType = 'sale' | 'sample';
const fallbackProductName = '云窗文创';

export const OrdersScreen: React.FC = () => {
  const { orders, products, user, acceptOrder, createBatchOrders, createSettlementOrder, fetchOrderDetail, fetchOrders, deleteOrder, stores, storeProductPrices, storeInventory, fetchStoreInventory, fetchStoreProductPrices, modifyDistributionOrder } = useAppStore();
  const canCreateOrder = user?.role === 'distributor' || user?.role === 'admin' || user?.role === 'super_admin' || user?.role === 'inventory_manager';
  const [filter, setFilter] = useState<OrderFilter>('all');
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [selectedFilterCityId, setSelectedFilterCityId] = useState<string | null>(null);
  const [selectedFilterStoreId, setSelectedFilterStoreId] = useState<string | null>(null);
  const [selectedStoreId, setSelectedStoreId] = useState<string | null>(null);
  const [showSettlementModal, setShowSettlementModal] = useState(false);
  const [settlementStoreId, setSettlementStoreId] = useState<string | null>(null);
  const [settlementCart, setSettlementCart] = useState<Map<string, number>>(new Map());
  const [submittingSettlementOrder, setSubmittingSettlementOrder] = useState(false);
  const [detailOrderId, setDetailOrderId] = useState<string | null>(null);
  const [detailOrderData, setDetailOrderData] = useState<(typeof orders)[number] | null>(null);
  const [detailCache, setDetailCache] = useState<Record<string, (typeof orders)[number]>>({});
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [searchKeyword, setSearchKeyword] = useState('');
  const [cart, setCart] = useState<Map<string, CartDraftItem>>(new Map());
  const [statsRange, setStatsRange] = useState<StatsRange>('month');
  const [rangeStartDate, setRangeStartDate] = useState('');
  const [rangeEndDate, setRangeEndDate] = useState('');
  const [deletingOrderId, setDeletingOrderId] = useState<string | null>(null);
  const [refundingOrderId, setRefundingOrderId] = useState<string | null>(null);
  const [selectedOrderKind, setSelectedOrderKind] = useState<OrderKind | 'all'>('all');
  const [refundModalOrderId, setRefundModalOrderId] = useState<string | null>(null);
  const [refundSelectedItemIds, setRefundSelectedItemIds] = useState<Set<string>>(new Set());
  const [refundReasonInput, setRefundReasonInput] = useState('收银台退款');
  const [refundConfirmPayload, setRefundConfirmPayload] = useState<{
    order: (typeof orders)[number];
    selectedItemIds: string[];
    selectedAmount: number;
    reason: string;
  } | null>(null);
  const [refundViewFilter, setRefundViewFilter] = useState<RefundViewFilter>('revenue');
  const [deleteConfirmOrderId, setDeleteConfirmOrderId] = useState<string | null>(null);
  const [pageNotice, setPageNotice] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [modifyOrder, setModifyOrder] = useState<(typeof orders)[number] | null>(null);
  const [modifyCart, setModifyCart] = useState<Map<string, number>>(new Map());
  const [submittingModify, setSubmittingModify] = useState(false);

  const getOrderKindLabel = (kind: OrderKind): string => {
    if (kind === 'settlement') return '结算单';
    if (kind === 'retail') return '零售单';
    return '供货单';
  };

  const baseOrders = useMemo(() => {
    if (filter === 'all') return orders;
    return orders.filter((order) => order.status === filter);
  }, [filter, orders]);

  const orderFilterCities = useMemo(
    () =>
      orders.reduce<Array<{ id: string; name: string }>>((acc, order) => {
        if (!order.city_id || acc.some((city) => city.id === order.city_id)) return acc;
        acc.push({ id: order.city_id, name: order.city_name || '未知城市' });
        return acc;
      }, []),
    [orders],
  );

  const filteredStoresForOrderFilter = useMemo(
    () => (selectedFilterCityId ? stores.filter((store) => store.city_id === selectedFilterCityId) : stores),
    [selectedFilterCityId, stores],
  );

  useEffect(() => {
    if (!selectedFilterStoreId) return;
    if (!filteredStoresForOrderFilter.some((store) => store.id === selectedFilterStoreId)) {
      setSelectedFilterStoreId(null);
    }
  }, [filteredStoresForOrderFilter, selectedFilterStoreId]);

  const matchesStatsRange = useCallback((createdAt: string): boolean => {
    const date = new Date(createdAt);
    const now = new Date();

    if (statsRange === 'all') return true;
    if (statsRange === 'range') {
      if (!rangeStartDate && !rangeEndDate) return true;

      const start = rangeStartDate ? new Date(`${rangeStartDate}T00:00:00`) : null;
      const end = rangeEndDate ? new Date(`${rangeEndDate}T23:59:59.999`) : null;

      if (start && Number.isNaN(start.getTime())) return true;
      if (end && Number.isNaN(end.getTime())) return true;
      if (start && end && start > end) return false;

      if (start && date < start) return false;
      if (end && date > end) return false;
      return true;
    }
    if (statsRange === 'day') {
      return date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth() && date.getDate() === now.getDate();
    }
    if (statsRange === 'week') {
      const nowCopy = new Date(now);
      const day = nowCopy.getDay();
      const diffToMonday = day === 0 ? 6 : day - 1;
      const weekStart = new Date(nowCopy.getFullYear(), nowCopy.getMonth(), nowCopy.getDate() - diffToMonday);
      weekStart.setHours(0, 0, 0, 0);
      const weekEnd = new Date(weekStart);
      weekEnd.setDate(weekStart.getDate() + 7);
      return date >= weekStart && date < weekEnd;
    }
    if (statsRange === 'month') {
      return date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth();
    }
    return date.getFullYear() === now.getFullYear();
  }, [rangeEndDate, rangeStartDate, statsRange]);

  const filteredOrders = useMemo(() => {
    let result = baseOrders;
    if (selectedOrderKind !== 'all') {
      result = result.filter((order) => order.order_kind === selectedOrderKind);
    }
    if (selectedFilterCityId) {
      result = result.filter((order) => order.city_id === selectedFilterCityId);
    }
    if (selectedFilterStoreId) {
      result = result.filter((order) => order.store_id === selectedFilterStoreId);
    }
    if (refundViewFilter !== 'all') {
      result = result.filter((order) => {
        const paymentStatus = String(order.payment_status || '').toLowerCase();
        const isRefundedOrder = paymentStatus === 'refunded'
          || paymentStatus === 'refund_pending';
        return refundViewFilter === 'refunded' ? isRefundedOrder : !isRefundedOrder;
      });
    }
    return result
      .filter((order) => matchesStatsRange(order.created_at));
  }, [baseOrders, matchesStatsRange, refundViewFilter, selectedFilterCityId, selectedFilterStoreId, selectedOrderKind]);

  const revenueOrders = useMemo(() => {
    return filteredOrders.filter((order) => {
      const paymentStatus = String(order.payment_status || '').toLowerCase();
      return paymentStatus !== 'refunded'
        && paymentStatus !== 'refund_pending';
    });
  }, [filteredOrders]);

  const totalRetail = useMemo(() => {
    return revenueOrders.reduce((sum, order) => sum + Number(order.total_retail_amount || 0), 0);
  }, [revenueOrders]);

  const totalDiscount = useMemo(() => {
    return revenueOrders.reduce((sum, order) => sum + Number(order.total_discount_amount || 0), 0);
  }, [revenueOrders]);

  const filteredRetailTotal = useMemo(() => {
    return filteredOrders.reduce((sum, order) => sum + Number(order.total_retail_amount || 0), 0);
  }, [filteredOrders]);

  const filteredDiscountTotal = useMemo(() => {
    return filteredOrders.reduce((sum, order) => sum + Number(order.total_discount_amount || 0), 0);
  }, [filteredOrders]);

  const rangeLabel = useMemo(() => {
    switch (statsRange) {
      case 'day':
        return '当日';
      case 'week':
        return '本周';
      case 'month':
        return '本月';
      case 'year':
        return '年度';
      case 'range': {
        if (rangeStartDate && rangeEndDate) return `${rangeStartDate}~${rangeEndDate}`;
        if (rangeStartDate) return `${rangeStartDate}~今`;
        if (rangeEndDate) return `~${rangeEndDate}`;
        return '自定义时间段';
      }
      default:
        return '累计';
    }
  }, [rangeEndDate, rangeStartDate, statsRange]);

  const statsCopy = useMemo(() => {
    if (refundViewFilter === 'refunded') {
      return {
        orderCountLabel: `${rangeLabel}退款订单数`,
        retailLabel: `${rangeLabel}退款订单零售总价`,
        discountLabel: `${rangeLabel}退款订单折扣总价`,
        retailValue: filteredRetailTotal,
        discountValue: filteredDiscountTotal,
      };
    }

    if (refundViewFilter === 'all') {
      return {
        orderCountLabel: `${rangeLabel}订单数`,
        retailLabel: `${rangeLabel}订单零售总价`,
        discountLabel: `${rangeLabel}订单折扣总价`,
        retailValue: filteredRetailTotal,
        discountValue: filteredDiscountTotal,
      };
    }

    return {
      orderCountLabel: `${rangeLabel}营收订单数`,
      retailLabel: `${rangeLabel}营收零售总价`,
      discountLabel: `${rangeLabel}营收折扣总价`,
      retailValue: totalRetail,
      discountValue: totalDiscount,
    };
  }, [filteredDiscountTotal, filteredRetailTotal, rangeLabel, refundViewFilter, totalDiscount, totalRetail]);

  const filteredProducts = useMemo(() => {
    let result = products;
    if (selectedStoreId) {
      const store = stores.find((s) => s.id === selectedStoreId);
      if (store && store.city_id) {
        result = result.filter((p) => p.city_id === store.city_id);
      }
    }
    const keyword = searchKeyword.trim().toLowerCase();
    if (!keyword) return result;
    return result.filter((product) => {
      const haystack = [product.name, product.barcode || '', product.city_name || ''].join(' ').toLowerCase();
      return haystack.includes(keyword);
    });
  }, [products, searchKeyword, selectedStoreId, stores]);

  const filteredSettlementProducts = useMemo(() => {
    if (!settlementStoreId) return [];
    const selectedStore = stores.find((store) => store.id === settlementStoreId);
    if (!selectedStore) return [];

    const keyword = searchKeyword.trim().toLowerCase();
    return products
      .filter((product) => product.city_id === selectedStore.city_id)
      .filter((product) => {
        if (!keyword) return true;
        const haystack = [product.name, product.barcode || '', product.city_name || ''].join(' ').toLowerCase();
        return haystack.includes(keyword);
      });
  }, [products, searchKeyword, settlementStoreId, stores]);

  const settlementTotalAmount = useMemo(() => {
    if (!settlementStoreId || settlementCart.size === 0) return 0;
    const selectedStore = stores.find((store) => store.id === settlementStoreId);
    return Array.from(settlementCart.entries()).reduce((sum, [productId, qty]) => {
      const product = products.find((item) => item.id === productId);
      if (!product) return sum;
      const storeOverride = storeProductPrices.find((entry) => entry.store_id === settlementStoreId && entry.product_id === productId);
      const resolvedPrice = resolvePrice({
        price: Number(product.price || 0),
        discount_price: product.discount_price,
        discount_rate: selectedStore?.discount_rate,
        override_price: storeOverride?.override_price,
      }).price;
      return sum + resolvedPrice * qty;
    }, 0);
  }, [products, settlementCart, settlementStoreId, stores, storeProductPrices]);

  const cartItems = useMemo(() => {
    const parseCartKey = (cartKey: string): { productId: string; lineType: CartLineType } => {
      const splitIndex = cartKey.lastIndexOf(':');
      if (splitIndex < 0) return { productId: cartKey, lineType: 'sale' };
      const productId = cartKey.slice(0, splitIndex);
      const lineTypeRaw = cartKey.slice(splitIndex + 1);
      return {
        productId,
        lineType: lineTypeRaw === 'sample' ? 'sample' : 'sale',
      };
    };

    return Array.from(cart.entries())
      .map(([cartKey, draft]) => {
        const { productId, lineType } = parseCartKey(cartKey);
        const product = products.find((item) => item.id === productId);
        if (!product) return null;
        return { cartKey, product, lineType, quantity: draft.quantity, isSample: draft.isSample };
      })
      .filter((item): item is { cartKey: string; product: (typeof products)[number]; lineType: CartLineType; quantity: number; isSample: boolean } => item !== null)
      .filter((item) => item.quantity > 0);
  }, [cart, products]);

  const totalRetailAmount = useMemo(() => {
    return cartItems.reduce((sum, item) => (item.isSample ? sum : sum + Number(item.product.price || 0) * item.quantity), 0);
  }, [cartItems]);

  const totalDiscountAmount = useMemo(() => {
    return cartItems.reduce((sum, item) => {
      if (item.isSample) return sum;
      const store = selectedStoreId ? stores.find((s) => s.id === selectedStoreId) : null;
      const storeOverride = selectedStoreId ? storeProductPrices.find((entry) => entry.store_id === selectedStoreId && entry.product_id === item.product.id) : undefined;
      const resolvedPrice = resolvePrice({
        price: Number(item.product.price || 0),
        discount_price: item.product.discount_price,
        discount_rate: store?.discount_rate,
        override_price: storeOverride?.override_price,
      }).price;
      return sum + resolvedPrice * item.quantity;
    }, 0);
  }, [cartItems, selectedStoreId, stores, storeProductPrices]);

  const detailOrder = detailOrderData;

  const productNameMap = useMemo(() => {
    const map = new Map<string, string>();
    products.forEach((product) => {
      map.set(product.id, product.name);
    });
    return map;
  }, [products]);

  const resolveItemName = (productId: string, productName?: string): string => {
    return productName || productNameMap.get(productId) || fallbackProductName;
  };

  const getResolvedOrder = (orderId: string): (typeof orders)[number] | null => {
    return detailCache[orderId] || orders.find((item) => item.id === orderId) || null;
  };

  const deleteTargetOrder = deleteConfirmOrderId ? getResolvedOrder(deleteConfirmOrderId) : null;
  const deleteWillRestoreStock = String(deleteTargetOrder?.payment_status || '').toLowerCase() !== 'refunded';

  useEffect(() => {
    const candidates = filteredOrders.filter((order) => (order.items?.length || 0) === 0).slice(0, 12);
    if (candidates.length === 0) return;

    void Promise.all(candidates.map(async (order) => {
      const detail = await fetchOrderDetail(order.id);
      if (detail) {
        setDetailCache((prev) => ({ ...prev, [order.id]: detail }));
      }
    }));
  }, [fetchOrderDetail, filteredOrders]);
  useEffect(() => {
    if (selectedStoreId) {
      void fetchStoreProductPrices(selectedStoreId);
    }
  }, [selectedStoreId, fetchStoreProductPrices]);

  useEffect(() => {
    if (settlementStoreId) {
      void fetchStoreInventory(settlementStoreId);
      void fetchStoreProductPrices(settlementStoreId);
    }
  }, [settlementStoreId, fetchStoreInventory, fetchStoreProductPrices]);


  const openOrderDetail = async (orderId: string): Promise<void> => {
    setDetailOrderId(orderId);
    setLoadingDetail(true);
    const localOrder = getResolvedOrder(orderId);
    setDetailOrderData(localOrder);

    const latest = await fetchOrderDetail(orderId);
    if (latest) {
      setDetailCache((prev) => ({ ...prev, [orderId]: latest }));
      setDetailOrderData(latest);
    }
    setLoadingDetail(false);
  };

  const closeOrderDetail = (): void => {
    setDetailOrderId(null);
    setDetailOrderData(null);
    setLoadingDetail(false);
  };

  const canRefundOrder = (order: (typeof orders)[number]): boolean => {
    const canOperate = user?.role === 'admin' || user?.role === 'super_admin' || user?.role === 'inventory_manager';
    if (!canOperate) return false;
    if (order.order_kind !== 'retail') return false;
    const paymentStatus = String(order.payment_status || '').toLowerCase();
    if (!['paid', 'partial_refunded'].includes(paymentStatus)) return false;
    if (order.payment_method !== 'wechat' && order.payment_method !== 'alipay') return false;
    return true;
  };

  const openRefundModal = (order: (typeof orders)[number]): void => {
    const resolvedOrder = getResolvedOrder(order.id) || order;
    setRefundModalOrderId(order.id);
    setRefundSelectedItemIds(new Set(resolvedOrder.items.filter((item) => Number(item.quantity || 0) > 0).map((item) => item.id)));
    setRefundReasonInput('收银台退款');
  };

  const closeRefundModal = (): void => {
    setRefundModalOrderId(null);
    setRefundSelectedItemIds(new Set());
    setRefundReasonInput('收银台退款');
    setRefundConfirmPayload(null);
  };

  const verifyRefundApplied = async (orderId: string): Promise<{ success: boolean; latest: (typeof orders)[number] | null }> => {
    for (let attempt = 0; attempt < 6; attempt += 1) {
      try {
        await fetchOrders();
        const latest = await fetchOrderDetail(orderId);
        const latestStatus = String(latest?.payment_status || '').toLowerCase();
        const refundedLike = latestStatus === 'refunded'
          || latestStatus === 'partial_refunded'
          || latestStatus === 'refund_pending'
          || latestStatus === 'partial_refund_pending';
        if (!latest || refundedLike) {
          return { success: true, latest: latest || null };
        }
      } catch {
        // continue retrying
      }

      if (attempt < 5) {
        await wait(1000);
      }
    }

    return { success: false, latest: null };
  };

  const handleRefundOrder = async (order: (typeof orders)[number], orderItemIds: string[], reason: string): Promise<void> => {
    if (!canRefundOrder(order) || refundingOrderId) return;

    if (orderItemIds.length === 0) {
      setPageNotice({ type: 'error', text: '请至少选择一个退款商品' });
      return;
    }

    const resolvedOrder = getResolvedOrder(order.id) || order;
    const refundAmount = resolvedOrder.items
      .filter((item) => orderItemIds.includes(item.id))
      .reduce((sum, item) => sum + Number(item.discount_price || 0) * Number(item.quantity || 0), 0);
    if (!Number.isFinite(refundAmount) || refundAmount <= 0) {
      setPageNotice({ type: 'error', text: '退款金额无效，请重新选择商品' });
      return;
    }

    setRefundingOrderId(order.id);
    try {
      const requestBody = JSON.stringify({
        orderId: order.id,
        requesterUserId: user?.id,
        orderItemIds,
        reason: reason.trim() || '收银台退款',
      });
      const requestInit: RequestInit = {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: requestBody,
      };

      const paymentEndpoint = getPaymentApiEndpoint();
      const remoteUrl = `${paymentEndpoint}/api/payment/refund-items`;
      const sameOriginUrl = '/api/payment/refund-items';
      const isLocalLikeHost = ['localhost', '127.0.0.1', '::1'].includes(window.location.hostname)
        || window.location.hostname.startsWith('192.168.')
        || window.location.hostname.startsWith('10.')
        || window.location.hostname.startsWith('172.');
      const remoteOrigin = (() => {
        try {
          return new URL(paymentEndpoint).origin;
        } catch {
          return '';
        }
      })();
      const sameOriginAllowed = remoteOrigin === window.location.origin;
      const candidateUrls = (sameOriginAllowed
        ? [remoteUrl, sameOriginUrl]
        : [remoteUrl])
        .filter((url, index, arr) => arr.indexOf(url) === index);

      let response: Response | null = null;
      let lastError: unknown = null;
      for (const url of candidateUrls) {
        try {
          const candidateResponse = await fetch(url, requestInit);
          if (candidateResponse.ok) {
            response = candidateResponse;
            break;
          }
          const canFallback = candidateResponse.status >= 500 || candidateResponse.status === 404;
          if (!canFallback) {
            response = candidateResponse;
            break;
          }
          response = candidateResponse;
          lastError = new Error(`HTTP ${candidateResponse.status} @ ${url}`);
        } catch (error) {
          lastError = error;
        }
      }

      if (!response) {
        const message = lastError instanceof Error ? lastError.message : '未知网络错误';
        throw new Error(`退款网关不可达：${message}`);
      }

      const payload = await parseRefundResponse(response);

      if (!response.ok || !payload?.success) {
        const backendErrorText = extractRefundErrorText(payload);
        const normalizedErrorText = backendErrorText.toLowerCase();
        const alreadyRefunded = /已.*全额.*退款/.test(backendErrorText)
          || backendErrorText.includes('已无可退款金额')
          || normalizedErrorText.includes('already refunded')
          || normalizedErrorText.includes('full refund');

        if (alreadyRefunded) {
          const verifyResult = await verifyRefundApplied(order.id);
          closeRefundModal();
          if (verifyResult.latest) {
            setDetailCache((prev) => ({ ...prev, [order.id]: verifyResult.latest! }));
            setDetailOrderData(verifyResult.latest);
          } else {
            closeOrderDetail();
          }
          setPageNotice({
            type: 'success',
            text: '该订单已退款完成，本次请求按幂等成功处理。',
          });
          return;
        }

        if (response.status === 404) {
          const verifyResult = await verifyRefundApplied(order.id);
          if (verifyResult.success) {
            closeRefundModal();
            if (verifyResult.latest) {
              setDetailCache((prev) => ({ ...prev, [order.id]: verifyResult.latest! }));
              setDetailOrderData(verifyResult.latest);
            } else {
              closeOrderDetail();
            }
            setPageNotice({
              type: 'success',
              text: '退款已成功执行（测试端口网关返回 404 空响应），已按订单状态确认。',
            });
            return;
          }
        }

        const verifyResult = await verifyRefundApplied(order.id);
        if (verifyResult.success) {
          closeRefundModal();
          if (verifyResult.latest) {
            setDetailCache((prev) => ({ ...prev, [order.id]: verifyResult.latest! }));
            setDetailOrderData(verifyResult.latest);
          } else {
            closeOrderDetail();
          }
          setPageNotice({
            type: 'success',
            text: '退款已成功执行（以订单状态复核为准）。',
          });
          return;
        }

        const detail = payload.rawText ? `（${payload.rawText.slice(0, 120)}）` : '';
        const displayError = backendErrorText || `HTTP ${response.status}`;
        setPageNotice({ type: 'error', text: `退款失败：${displayError}${detail}` });
        return;
      }

      setPageNotice({
        type: 'success',
        text: payload.status === 'refunded' || payload.status === 'partial_refunded' || payload.orderDeleted
          ? `退款成功：¥${Number(payload.refundAmount || refundAmount).toFixed(2)}，订单状态已更新`
          : `退款已提交：¥${Number(payload.refundAmount || refundAmount).toFixed(2)}，当前状态 ${String(payload.status || 'pending')}`,
      });

      closeRefundModal();

      try {
        await fetchOrders();
        const latest = await fetchOrderDetail(order.id);
        if (latest) {
          setDetailCache((prev) => ({ ...prev, [order.id]: latest }));
          setDetailOrderData(latest);
        }
      } catch {
        setPageNotice((prev) => {
          if (!prev || prev.type !== 'success') return prev;
          return {
            ...prev,
            text: `${prev.text}（列表刷新失败，请手动刷新）`,
          };
        });
      }
    } catch (error) {
      setPageNotice({ type: 'error', text: `退款异常：${error instanceof Error ? error.message : '未知错误'}` });
    } finally {
      setRefundingOrderId(null);
    }
  };

  const exportOrdersXlsx = async (): Promise<void> => {
    const XLSX = await import('xlsx');
    const rows = filteredOrders.map((order) => {
      const resolvedOrder = getResolvedOrder(order.id) || order;
      const pieces = resolvedOrder.items.reduce((sum, item) => sum + Number(item.quantity || 0), 0);
      return {
        订单号: order.id,
        订单类型: getOrderKindLabel(order.order_kind),
        状态: order.status,
        城市: order.city_name || '',
        配送店铺: order.store_name || '',
        分销商: order.distributor_store || order.distributor_email || '',
        商品种类: resolvedOrder.items.length,
        商品总件数: pieces,
        订单总额: Number(order.total_discount_amount || 0),
        创建时间: order.created_at,
      };
    });

    const sheet = XLSX.utils.json_to_sheet(rows);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, sheet, '订单列表');
    XLSX.writeFile(workbook, `orders-${new Date().toISOString().slice(0, 10)}.xlsx`);
  };

  const exportSingleOrderXlsx = async (orderId: string): Promise<void> => {
    const latestOrder = await fetchOrderDetail(orderId);
    const targetOrder = latestOrder || getResolvedOrder(orderId);
    if (!targetOrder) {
      setPageNotice({ type: 'error', text: '未找到订单，无法导出' });
      return;
    }

    const excelModule = await import('exceljs');
    const ExcelJS = 'default' in excelModule ? excelModule.default : excelModule;
    const workbook = new ExcelJS.Workbook();
    const centered = { horizontal: 'center' as const, vertical: 'middle' as const };

    const downloadWorkbook = async (filename: string): Promise<void> => {
      const buffer = await workbook.xlsx.writeBuffer({ useStyles: true });
      const blob = new Blob([buffer], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    };

    if (targetOrder.order_kind === 'distribution') {
      const boundStore = targetOrder.store_id ? stores.find((store) => store.id === targetOrder.store_id) : null;
      const storeNameRaw = targetOrder.store_name || boundStore?.name || '未指定店铺';
      const safeStoreName = storeNameRaw.replace(/[\\/:*?"<>|]/g, '-').trim() || '未指定店铺';

      const exportDate = new Date(targetOrder.created_at);
      const year = String(exportDate.getFullYear());
      const month = String(exportDate.getMonth() + 1).padStart(2, '0');
      const day = String(exportDate.getDate()).padStart(2, '0');
      const exportBaseName = `云窗&${safeStoreName}*${year}*${month}*${day}上货单`;

      const worksheet = workbook.addWorksheet('上货单');
      worksheet.columns = [
        { width: 8 },
        { width: 24 },
        { width: 12 },
        { width: 12 },
        { width: 12 },
        { width: 14 },
        { width: 14 },
      ];

      const headers = ['序号', '商品名称', '送货数量', '零售价', '结算价', '零售总价', '结算总价'];
      worksheet.addRow(headers);

      targetOrder.items.forEach((item, index) => {
        const quantity = Number(item.quantity || 0);
        const retailPrice = Number(item.retail_price || 0);

        let settlementPrice = Number(item.discount_price || 0);
        if (!item.is_sample && settlementPrice <= 0) {
          const product = products.find((entry) => entry.id === item.product_id);
          const storeOverride = targetOrder.store_id
            ? storeProductPrices.find((entry) => entry.store_id === targetOrder.store_id && entry.product_id === item.product_id)
            : undefined;
          settlementPrice = product
            ? resolvePrice({
              price: Number(product.price || 0),
              discount_price: product.discount_price,
              discount_rate: boundStore?.discount_rate,
              override_price: storeOverride?.override_price,
            }).price
            : 0;
        }

        const retailTotal = retailPrice * quantity;
        const settlementTotal = settlementPrice * quantity;

        worksheet.addRow([
          index + 1,
          resolveItemName(item.product_id, item.product_name),
          quantity,
          Number(retailPrice.toFixed(2)),
          Number(settlementPrice.toFixed(2)),
          Number(retailTotal.toFixed(2)),
          Number(settlementTotal.toFixed(2)),
        ]);
      });

      const sumRetailTotal = targetOrder.items.reduce((sum, item) => sum + Number(item.retail_price || 0) * Number(item.quantity || 0), 0);
      const sumSettlementTotal = targetOrder.items.reduce((sum, item) => {
        let settlementPrice = Number(item.discount_price || 0);
        if (!item.is_sample && settlementPrice <= 0) {
          const product = products.find((entry) => entry.id === item.product_id);
          const storeOverride = targetOrder.store_id
            ? storeProductPrices.find((entry) => entry.store_id === targetOrder.store_id && entry.product_id === item.product_id)
            : undefined;
          settlementPrice = product
            ? resolvePrice({
              price: Number(product.price || 0),
              discount_price: product.discount_price,
              discount_rate: boundStore?.discount_rate,
              override_price: storeOverride?.override_price,
            }).price
            : 0;
        }
        return sum + settlementPrice * Number(item.quantity || 0);
      }, 0);
      const sumRow = ['合计', '', '', '', '', Number(sumRetailTotal.toFixed(2)), Number(sumSettlementTotal.toFixed(2))];
      worksheet.addRow(sumRow);

      worksheet.eachRow((row) => {
        row.eachCell((cell) => {
          cell.alignment = centered;
        });
      });

      await downloadWorkbook(`${exportBaseName}.xlsx`);
      return;
    }

    const worksheet = workbook.addWorksheet('送货单');
    worksheet.columns = [
      { width: 24 },
      { width: 12 },
      { width: 12 },
      { width: 12 },
    ];

    worksheet.addRow(['商品名称', '送货数量', '单价', '查收']);
    targetOrder.items.forEach((item) => {
      worksheet.addRow([
        resolveItemName(item.product_id, item.product_name),
        Number(item.quantity || 0),
        Number(item.discount_price || 0),
        '',
      ]);
    });

    worksheet.eachRow((row) => {
      row.eachCell((cell) => {
        cell.alignment = centered;
      });
    });

    await downloadWorkbook(`delivery-${targetOrder.id.slice(0, 8)}-${Date.now()}.xlsx`);
  };

  const requestDeleteOrder = (orderId: string): void => {
    setDeleteConfirmOrderId(orderId);
  };

  const handleDeleteOrder = async (orderId: string): Promise<void> => {
    setDeletingOrderId(orderId);
    const { error } = await deleteOrder(orderId);
    setDeletingOrderId(null);
    setDeleteConfirmOrderId(null);

    if (error) {
      setPageNotice({ type: 'error', text: `删除失败：${error.message}` });
      return;
    }

    setPageNotice({ type: 'success', text: '订单已删除并恢复库存' });
    if (detailOrderId === orderId) {
      closeOrderDetail();
    }
  };

  const getCartKey = (productId: string, lineType: CartLineType): string => `${productId}:${lineType}`;
  const getLineStep = (lineType: CartLineType): number => (lineType === 'sample' ? 1 : 5);

  const getCombinedQtyByProduct = (entries: Map<string, CartDraftItem>, productId: string): number => {
    let total = 0;
    entries.forEach((draft, key) => {
      if (key.startsWith(`${productId}:`)) total += draft.quantity;
    });
    return total;
  };

  const setCartQuantity = (productId: string, lineType: CartLineType, quantity: number): void => {
    setCart((prev) => {
      const next = new Map(prev);
      const cartKey = getCartKey(productId, lineType);
      const existing = next.get(cartKey);
      const combinedWithoutCurrent = getCombinedQtyByProduct(next, productId) - (existing?.quantity || 0);
      const available = Number(products.find((item) => item.id === productId)?.quantity || 0);

      if (quantity > 0 && combinedWithoutCurrent + quantity > available) {
        return prev;
      }

      if (quantity <= 0) {
        next.delete(cartKey);
      } else {
        next.set(cartKey, {
          quantity,
          isSample: lineType === 'sample',
        });
      }
      return next;
    });
  };

  const handleCreateOrder = async (): Promise<void> => {
    if (cartItems.length === 0) {
      setPageNotice({ type: 'error', text: '请先选择商品' });
      return;
    }

    const invalid = cartItems.find((item) => !item.isSample && item.quantity % 5 !== 0);
    if (invalid) {
      setPageNotice({ type: 'error', text: `${invalid.product.name} 数量必须是5的倍数` });
      return;
    }

    const result = await createBatchOrders(
      cartItems.map((item) => ({
        productId: item.product.id,
        quantity: item.quantity,
        isSample: item.isSample,
      })),
      selectedStoreId
    );
    if (result.error) {
      setPageNotice({ type: 'error', text: `下单失败：${result.error.message}` });
      return;
    }

    setCart(new Map());
    setSearchKeyword('');
    setShowCreateModal(false);
    setSelectedStoreId(null);
    setPageNotice({ type: 'success', text: '订单已创建' });
  };

  const setSettlementQuantity = (productId: string, quantity: number): void => {
    setSettlementCart((prev) => {
      const next = new Map(prev);
      if (!settlementStoreId) return next;

      const available = Number(
        storeInventory.find((item) => item.store_id === settlementStoreId && item.product_id === productId)?.quantity || 0,
      );
      if (quantity <= 0) {
        next.delete(productId);
        return next;
      }
      if (quantity > available) {
        return prev;
      }

      next.set(productId, quantity);
      return next;
    });
  };

  const handleCreateSettlementOrder = async (): Promise<void> => {
    if (!settlementStoreId) {
      setPageNotice({ type: 'error', text: '请先选择店铺' });
      return;
    }
    if (settlementCart.size === 0) {
      setPageNotice({ type: 'error', text: '请先选择商品' });
      return;
    }

    const items = Array.from(settlementCart.entries()).map(([productId, quantity]) => ({
      productId,
      quantity,
    }));

    setSubmittingSettlementOrder(true);
    const { error } = await createSettlementOrder(settlementStoreId, items);
    setSubmittingSettlementOrder(false);

    if (error) {
      setPageNotice({ type: 'error', text: `结算建单失败：${error.message}` });
      return;
    }

    setSettlementCart(new Map());
    setSettlementStoreId(null);
    setSearchKeyword('');
    setShowSettlementModal(false);
    setPageNotice({ type: 'success', text: '结算订单已创建' });
  };

  const handleModifyOrder = async (): Promise<void> => {
    if (!modifyOrder) return;
    const itemsPayload = Array.from(modifyCart.entries()).map(([orderItemId, quantity]) => ({
      order_item_id: orderItemId,
      new_quantity: quantity,
    }));
    setSubmittingModify(true);
    const { error } = await modifyDistributionOrder(modifyOrder.id, itemsPayload);
    setSubmittingModify(false);
    if (error) {
      setPageNotice({ type: 'error', text: `修改失败：${error.message}` });
      return;
    }
    setPageNotice({ type: 'success', text: '订单修改成功' });
    setModifyOrder(null);
    setModifyCart(new Map());
  };

  return (
    <div className="space-y-6">
      {pageNotice && (
        <div className="fixed right-4 top-4 z-[120] max-w-md w-[calc(100vw-2rem)]">
          <div className={`rounded-2xl border px-4 py-3 text-sm shadow-2xl backdrop-blur ${pageNotice.type === 'success' ? 'bg-emerald-500/20 border-emerald-400/40 text-emerald-100' : 'bg-red-500/20 border-red-400/40 text-red-100'}`}>
            <div className="flex items-start justify-between gap-3">
              <span>{pageNotice.text}</span>
              <button
                type="button"
                onClick={() => setPageNotice(null)}
                className="text-white/70 hover:text-white"
              >
                <X size={14} />
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="flex items-center justify-between flex-wrap gap-4">
        <div className="space-y-2">
          <div className="flex space-x-2">
            {[
              { key: 'all', label: '全部' },
              { key: 'pending', label: '待接单' },
              { key: 'accepted', label: '已完成' },
            ].map((tab) => (
              <button
                type="button"
                key={tab.key}
                onClick={() => setFilter(tab.key as OrderFilter)}
                className={`px-4 py-2 rounded-xl text-sm font-medium transition-all ${
                  filter === tab.key ? 'bg-white/10 border border-white/20 text-white' : 'bg-white/5 border border-white/10 text-white/40 hover:bg-white/10 hover:text-white'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
          <div className="flex flex-wrap gap-2">
            {[
              { key: 'revenue', label: '营收订单' },
              { key: 'refunded', label: '退款订单' },
              { key: 'all', label: '全部支付状态' },
            ].map((item) => (
              <button
                type="button"
                key={item.key}
                onClick={() => setRefundViewFilter(item.key as RefundViewFilter)}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold border ${
                  refundViewFilter === item.key ? 'bg-white/15 border-white/30 text-white' : 'bg-white/5 border-white/10 text-white/60'
                }`}
              >
                {item.label}
              </button>
            ))}
          </div>
          <div className="flex flex-wrap gap-2">
            {[
              { key: 'all', label: '全部类型' },
              { key: 'distribution', label: '供货单' },
              { key: 'settlement', label: '结算单' },
              { key: 'retail', label: '零售单' },
            ].map((item) => (
              <button
                type="button"
                key={item.key}
                onClick={() => setSelectedOrderKind(item.key as OrderKind | 'all')}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold border ${
                  selectedOrderKind === item.key ? 'bg-white/15 border-white/30 text-white' : 'bg-white/5 border-white/10 text-white/60'
                }`}
              >
                {item.label}
              </button>
            ))}
          </div>
        </div>

        <div className="flex items-center gap-2">
          {user?.role === 'admin' && (
            <button
              type="button"
              onClick={() => {
                setSettlementStoreId(null);
                setSettlementCart(new Map());
                setSearchKeyword('');
                setShowSettlementModal(true);
              }}
              className="bg-tech-gradient px-5 py-2.5 rounded-xl font-bold flex items-center space-x-2 shadow-neon hover:scale-[1.02] transition-all"
            >
              <Plus size={18} />
              <span>结算</span>
            </button>
          )}
          {canCreateOrder && (
            <button
              type="button"
              onClick={() => setShowCreateModal(true)}
              className="bg-tech-gradient px-5 py-2.5 rounded-xl font-bold flex items-center space-x-2 shadow-neon hover:scale-[1.02] transition-all"
            >
              <Plus size={18} />
              <span>上货</span>
            </button>
          )}
          <button
            type="button"
            onClick={() => {
              void exportOrdersXlsx();
            }}
            className="bg-white/5 border border-white/10 px-6 py-2.5 rounded-xl font-bold flex items-center space-x-2 hover:bg-white/10 transition-all"
          >
            <Download size={18} />
            <span>导出列表</span>
          </button>
        </div>
      </div>

      <div className="bg-white/5 border border-white/10 rounded-2xl p-4 space-y-3">
        <div className="space-y-2">
          <p className="text-sm text-white/60">城市筛选</p>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setSelectedFilterCityId(null)}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold border ${selectedFilterCityId === null ? 'bg-white/15 border-white/30 text-white' : 'bg-white/5 border-white/10 text-white/60'}`}
            >
              全部城市
            </button>
            {orderFilterCities.map((city) => (
              <button
                key={city.id}
                type="button"
                onClick={() => setSelectedFilterCityId(city.id)}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold border ${selectedFilterCityId === city.id ? 'bg-white/15 border-white/30 text-white' : 'bg-white/5 border-white/10 text-white/60'}`}
              >
                {city.name}
              </button>
            ))}
          </div>
        </div>

        <div className="space-y-2">
          <p className="text-sm text-white/60">店铺筛选</p>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setSelectedFilterStoreId(null)}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold border ${selectedFilterStoreId === null ? 'bg-white/15 border-white/30 text-white' : 'bg-white/5 border-white/10 text-white/60'}`}
            >
              全部店铺
            </button>
            {filteredStoresForOrderFilter.map((store) => (
              <button
                key={store.id}
                type="button"
                onClick={() => setSelectedFilterStoreId(store.id)}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold border ${selectedFilterStoreId === store.id ? 'bg-white/15 border-white/30 text-white' : 'bg-white/5 border-white/10 text-white/60'}`}
              >
                {store.name}
              </button>
            ))}
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          {[
            { key: 'day', label: '当日' },
            { key: 'week', label: '本周' },
            { key: 'month', label: '本月' },
            { key: 'year', label: '年度' },
            { key: 'all', label: '累计' },
            { key: 'range', label: '自定义时间段' },
          ].map((item) => (
            <button
              key={item.key}
              type="button"
              onClick={() => setStatsRange(item.key as StatsRange)}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold border ${statsRange === item.key ? 'bg-white/15 border-white/30 text-white' : 'bg-white/5 border-white/10 text-white/60'}`}
            >
              {item.label}
            </button>
          ))}
        </div>

        {statsRange === 'range' && (
          <div className="flex items-center gap-2 text-sm">
            <span className="text-white/60">起止</span>
            <input
              type="date"
              value={rangeStartDate}
              onChange={(event) => setRangeStartDate(event.target.value)}
              className="bg-white/5 border border-white/10 rounded-lg px-3 py-1.5"
            />
            <span className="text-white/50">至</span>
            <input
              type="date"
              value={rangeEndDate}
              onChange={(event) => setRangeEndDate(event.target.value)}
              className="bg-white/5 border border-white/10 rounded-lg px-3 py-1.5"
            />
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div className="bg-white/5 rounded-xl px-4 py-3">
            <p className="text-xs text-white/50">{statsCopy.orderCountLabel}</p>
            <p className="text-xl font-black">{filteredOrders.length}</p>
          </div>
          <div className="bg-white/5 rounded-xl px-4 py-3">
            <p className="text-xs text-white/50">{statsCopy.retailLabel}</p>
            <p className="text-xl font-black">¥{statsCopy.retailValue.toFixed(2)}</p>
          </div>
          <div className="bg-white/5 rounded-xl px-4 py-3">
            <p className="text-xs text-white/50">{statsCopy.discountLabel}</p>
            <p className="text-xl font-black text-accent">¥{statsCopy.discountValue.toFixed(2)}</p>
          </div>
        </div>
      </div>

      <div className="space-y-4">
        {filteredOrders.map((order, index) => (
          (() => {
            const resolvedOrder = getResolvedOrder(order.id) || order;
            const itemKinds = resolvedOrder.items.length;
            const totalPieces = resolvedOrder.items.reduce((sum, item) => sum + Number(item.quantity || 0), 0);
            return (
          <motion.div
            key={order.id}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: index * 0.03 }}
            className="group bg-white/5 border border-white/10 rounded-3xl p-6 hover:border-accent/30 transition-all"
          >
            <div className="flex items-start justify-between mb-6">
              <div className="flex items-center space-x-4">
                <div className="w-12 h-12 rounded-2xl bg-tech-gradient flex items-center justify-center text-white shadow-neon">
                  <ShoppingCart size={24} />
                </div>
                <div>
                  <div className="flex items-center space-x-3">
                    <h3 className="text-lg font-bold">订单 #{order.id.slice(0, 8)}</h3>
                    <div className={`px-3 py-1 rounded-full border text-[10px] font-black uppercase tracking-widest ${order.order_kind === 'retail' ? 'text-sky-300 bg-sky-500/10 border-sky-500/20' : 'text-violet-300 bg-violet-500/10 border-violet-500/20'}`}>
                      {getOrderKindLabel(order.order_kind)}
                    </div>
                    <div className={`flex items-center space-x-1 px-3 py-1 rounded-full border text-[10px] font-black uppercase tracking-widest ${order.status === 'accepted' ? 'text-green-500 bg-green-500/10 border-green-500/20' : 'text-orange-500 bg-orange-500/10 border-orange-500/20'}`}>
                      {order.status === 'accepted' ? <CheckCircle2 size={14} /> : <Clock size={14} />}
                      <span>{order.status === 'accepted' ? '已接单' : '待处理'}</span>
                    </div>
                  </div>
                  <div className="flex items-center space-x-4 mt-1 text-white/40 text-xs">
                    <div className="flex items-center space-x-1"><Clock size={12} /><span>{new Date(order.created_at).toLocaleString()}</span></div>
                    <div className="flex items-center space-x-1"><MapPin size={12} /><span>{order.city_name || '-'}</span></div>
                    <div className="flex items-center space-x-1"><Store size={12} /><span>配送店铺：{order.store_name || '未指定店铺'}</span></div>
                    <div className="flex items-center space-x-1"><span>分销商：{order.distributor_store || order.distributor_email || '-'}</span></div>
                  </div>
                </div>
              </div>

              <div className="text-right space-y-2">
                <p className="text-[10px] text-white/40 uppercase font-bold tracking-widest">订单总额</p>
                <p className="text-2xl font-black text-white">¥{order.total_discount_amount}</p>
                {order.status === 'pending' && (user?.role === 'admin' || user?.role === 'super_admin') && (
                  <button
                    type="button"
                    onClick={async () => {
                      const { error } = await acceptOrder(order.id);
                      if (error) {
                        setPageNotice({ type: 'error', text: `接单失败：${error.message}` });
                        return;
                      }
                      setPageNotice({ type: 'success', text: '接单成功' });
                    }}
                    className="px-3 py-1.5 rounded-lg bg-green-500/20 text-green-400 border border-green-500/30 text-xs font-bold"
                  >
                    确认接单
                  </button>
                )}
              </div>
            </div>

            <div className="bg-white/[0.02] rounded-2xl p-4 flex items-center justify-between">
                <div className="flex -space-x-3 overflow-hidden">
                {resolvedOrder.items.slice(0, 5).map((item) => (
                  <div key={item.id} className="w-10 h-10 rounded-full border-2 border-background bg-white/10 flex items-center justify-center text-[10px] font-bold overflow-hidden">
                    {resolveItemName(item.product_id, item.product_name)[0]}
                  </div>
                ))}
                {resolvedOrder.items.length > 5 && (
                  <div className="w-10 h-10 rounded-full border-2 border-background bg-white/5 flex items-center justify-center text-[10px] font-bold text-white/40">
                    +{resolvedOrder.items.length - 5}
                  </div>
                )}
              </div>

              <div className="flex items-center space-x-4">
                <p className="text-sm text-white/40">共 {totalPieces} 件商品 / {itemKinds} 种</p>
                <button
                  type="button"
                  onClick={() => {
                    void exportSingleOrderXlsx(order.id);
                  }}
                  className="px-2.5 py-1.5 rounded-lg border border-white/10 bg-white/5 text-white/70 hover:bg-white/10 hover:text-white text-xs font-bold inline-flex items-center gap-1"
                >
                  <Download size={14} />
                  <span>导出</span>
                </button>
                {canRefundOrder(order) && (
                  <button
                    type="button"
                    onClick={() => openRefundModal(order)}
                    disabled={refundingOrderId === order.id}
                    className="px-2.5 py-1.5 rounded-lg border border-amber-400/30 bg-amber-500/20 text-amber-100 hover:bg-amber-500/30 text-xs font-bold inline-flex items-center gap-1 disabled:opacity-60"
                  >
                    <span>{refundingOrderId === order.id ? '退款中' : '退款'}</span>
                  </button>
                )}
                {(user?.role === 'admin' || user?.role === 'super_admin') && order.status === 'accepted' && order.order_kind === 'distribution' && order.store_id && (
                  <button
                    type="button"
                    onClick={() => {
                      const resolvedOrder = getResolvedOrder(order.id) || order;
                      setModifyOrder(resolvedOrder);
                      const initialCart = new Map<string, number>();
                      resolvedOrder.items.forEach((i) => initialCart.set(i.id, Number(i.quantity || 0)));
                      setModifyCart(initialCart);
                    }}
                    className="px-2.5 py-1.5 rounded-lg border border-blue-400/30 bg-blue-500/20 text-blue-100 hover:bg-blue-500/30 text-xs font-bold inline-flex items-center gap-1"
                  >
                    <span>修改订单</span>
                  </button>
                )}
                {(user?.role === 'admin' || user?.role === 'super_admin' || user?.role === 'inventory_manager' || user?.id === order.distributor_id) && (
                    <button
                      type="button"
                      onClick={() => {
                        requestDeleteOrder(order.id);
                      }}
                      disabled={deletingOrderId === order.id}
                      className="px-2.5 py-1.5 rounded-lg border border-red-400/30 bg-red-500/10 text-red-200 hover:bg-red-500/20 text-xs font-bold inline-flex items-center gap-1 disabled:opacity-60 disabled:cursor-not-allowed"
                  >
                    <Trash2 size={14} />
                    <span>{deletingOrderId === order.id ? '删除中' : '删除'}</span>
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => {
                    void openOrderDetail(order.id);
                  }}
                  className="w-8 h-8 rounded-full border border-white/10 flex items-center justify-center group-hover:bg-accent group-hover:border-accent transition-all"
                >
                  <ChevronRight size={18} className="text-white group-hover:scale-110 transition-transform" />
                </button>
              </div>
            </div>
          </motion.div>
            );
          })()
        ))}
      </div>

      {showCreateModal && canCreateOrder && (
        <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4 overflow-y-auto">
          <div className="w-full max-w-5xl max-h-[calc(100vh-2rem)] overflow-y-auto bg-[#121217] border border-white/10 rounded-3xl p-6 space-y-5">
            <div className="flex items-center justify-between">
              <h3 className="text-xl font-bold">新建分销订单</h3>
              <button type="button" onClick={() => setShowCreateModal(false)} className="p-2 rounded-lg bg-white/10 text-white/60 hover:text-white">
                <X size={16} />
              </button>
            </div>

            <div className="flex flex-col sm:flex-row gap-4">
              <select
                value={selectedStoreId || ''}
                onChange={(e) => {
                  setSelectedStoreId(e.target.value || null);
                  setCart(new Map());
                }}
                className="bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white outline-none"
              >
                <option value="" className="bg-[#121217]">-- 不指定店铺 (默认) --</option>
                {stores.map((store) => (
                  <option key={store.id} value={store.id} className="bg-[#121217]">
                    {store.name} ({store.city_name}){store.distributor_email ? ` - ${store.distributor_email}` : ''}
                  </option>
                ))}
              </select>
              <input
                value={searchKeyword}
                onChange={(event) => setSearchKeyword(event.target.value)}
                placeholder="搜索商品名称/条码"
                className="flex-1 w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3"
              />
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <div className="max-h-[420px] overflow-auto border border-white/10 rounded-2xl">
                {filteredProducts.map((product) => {
                  const saleKey = getCartKey(product.id, 'sale');
                  const sampleKey = getCartKey(product.id, 'sample');
                  const saleQty = cart.get(saleKey)?.quantity || 0;
                  const sampleQty = cart.get(sampleKey)?.quantity || 0;

                  const store = selectedStoreId ? stores.find((s) => s.id === selectedStoreId) : null;
                  const storeOverride = selectedStoreId ? storeProductPrices.find((entry) => entry.store_id === selectedStoreId && entry.product_id === product.id) : undefined;
                  const resolvedPrice = resolvePrice({
                    price: Number(product.price || 0),
                    discount_price: product.discount_price,
                    discount_rate: store?.discount_rate,
                    override_price: storeOverride?.override_price,
                  }).price;

                  return (
                    <div key={product.id} className="p-4 border-b border-white/5 last:border-b-0 space-y-3">
                      <div className="flex items-center justify-between gap-3">
                        <div className="w-10 h-10 rounded-lg overflow-hidden border border-white/10 bg-white/5 flex items-center justify-center">
                          {product.image_url ? (
                            <img src={product.image_url} alt={product.name} className="w-full h-full object-cover" />
                          ) : (
                            <span className="text-[10px] text-white/40">图</span>
                          )}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="font-semibold">{product.name}</p>
                          <p className="text-xs text-white/40">{product.city_name} · 条码 {product.barcode || '无'}</p>
                        </div>
                        <p className="text-sm text-accent font-bold">¥{resolvedPrice.toFixed(2)}</p>
                      </div>

                      <div className="space-y-2">
                        <div className="flex items-center gap-2">
                          <span className="text-xs w-10 text-white/70">商品</span>
                          <button
                            type="button"
                            onClick={() => setCartQuantity(product.id, 'sale', Math.max(0, saleQty - getLineStep('sale')))}
                            className="px-3 py-1.5 rounded-lg bg-white/10"
                          >
                            -5
                          </button>
                          <input
                            value={saleQty > 0 ? String(saleQty) : ''}
                            onChange={(event) => {
                              const value = Number(event.target.value.replace(/[^0-9]/g, ''));
                              if (Number.isNaN(value)) {
                                setCartQuantity(product.id, 'sale', 0);
                                return;
                              }
                              setCartQuantity(product.id, 'sale', value);
                            }}
                            placeholder="数量(5的倍数)"
                            className="w-40 bg-white/5 border border-white/10 rounded-lg px-3 py-1.5"
                          />
                          <button
                            type="button"
                            onClick={() => setCartQuantity(product.id, 'sale', saleQty + getLineStep('sale'))}
                            className="px-3 py-1.5 rounded-lg bg-white/10"
                          >
                            +5
                          </button>
                        </div>

                        <div className="flex items-center gap-2">
                          <span className="text-xs w-10 text-cyan-300">样品</span>
                          <button
                            type="button"
                            onClick={() => setCartQuantity(product.id, 'sample', Math.max(0, sampleQty - getLineStep('sample')))}
                            className="px-3 py-1.5 rounded-lg bg-cyan-500/20 border border-cyan-400/30"
                          >
                            -1
                          </button>
                          <input
                            value={sampleQty > 0 ? String(sampleQty) : ''}
                            onChange={(event) => {
                              const value = Number(event.target.value.replace(/[^0-9]/g, ''));
                              if (Number.isNaN(value)) {
                                setCartQuantity(product.id, 'sample', 0);
                                return;
                              }
                              setCartQuantity(product.id, 'sample', value);
                            }}
                            placeholder="样品数量(通常1)"
                            className="w-40 bg-white/5 border border-cyan-400/20 rounded-lg px-3 py-1.5"
                          />
                          <button
                            type="button"
                            onClick={() => setCartQuantity(product.id, 'sample', sampleQty + getLineStep('sample'))}
                            className="px-3 py-1.5 rounded-lg bg-cyan-500/20 border border-cyan-400/30"
                          >
                            +1
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>

              <div className="border border-white/10 rounded-2xl p-4 flex flex-col">
                <h4 className="font-semibold mb-3">购物车</h4>
                <div className="space-y-2 max-h-[300px] overflow-auto pr-1">
                  {cartItems.map((item) => (
                    <div key={item.cartKey} className="flex items-center justify-between bg-white/5 rounded-lg px-3 py-2">
                      <div>
                        <p className="text-sm font-medium">{item.product.name}</p>
                        <p className="text-xs text-white/40">数量 {item.quantity}{item.isSample ? ' · 样品' : ''}</p>
                      </div>
                      <button type="button" onClick={() => setCartQuantity(item.product.id, item.lineType, 0)} className="text-xs text-red-300 hover:text-red-200">移除</button>
                    </div>
                  ))}
                  {cartItems.length === 0 && <p className="text-sm text-white/40">暂无商品</p>}
                </div>

                <div className="mt-auto pt-4 border-t border-white/10 space-y-1 text-sm">
                  <div className="flex justify-between"><span className="text-white/60">零售总额</span><span>¥{totalRetailAmount.toFixed(2)}</span></div>
                  <div className="flex justify-between"><span className="text-white/60">折扣总额</span><span className="text-accent font-bold">¥{totalDiscountAmount.toFixed(2)}</span></div>
                </div>

                <button type="button" onClick={handleCreateOrder} className="mt-4 w-full py-2.5 rounded-xl bg-tech-gradient font-bold">
                  确认创建分销订单
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {showSettlementModal && user?.role === 'admin' && (
        <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4 overflow-y-auto">
          <div className="w-full max-w-5xl max-h-[calc(100vh-2rem)] overflow-y-auto bg-[#121217] border border-white/10 rounded-3xl p-6 space-y-5">
            <div className="flex items-center justify-between">
              <h3 className="text-xl font-bold">结算建单</h3>
              <button
                type="button"
                onClick={() => {
                  setShowSettlementModal(false);
                  setSettlementStoreId(null);
                  setSettlementCart(new Map());
                  setSearchKeyword('');
                }}
                className="p-2 rounded-lg bg-white/10 text-white/60 hover:text-white"
              >
                <X size={16} />
              </button>
            </div>

            <div className="flex flex-col sm:flex-row gap-4">
              <select
                value={settlementStoreId || ''}
                onChange={(event) => {
                  setSettlementStoreId(event.target.value || null);
                  setSettlementCart(new Map());
                }}
                className="bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white outline-none"
              >
                <option value="" className="bg-[#121217]">-- 请选择店铺 --</option>
                {stores
                  .filter((store) => store.status === 'active')
                  .map((store) => (
                    <option key={store.id} value={store.id} className="bg-[#121217]">
                      {store.name} ({store.city_name})
                    </option>
                  ))}
              </select>
              <input
                value={searchKeyword}
                onChange={(event) => setSearchKeyword(event.target.value)}
                placeholder="搜索商品名称/条码"
                className="flex-1 w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3"
              />
            </div>

            {settlementStoreId ? (
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                <div className="max-h-[420px] overflow-auto border border-white/10 rounded-2xl">
                  {filteredSettlementProducts.map((product) => {
                    const stock = Number(
                      storeInventory.find((item) => item.store_id === settlementStoreId && item.product_id === product.id)?.quantity || 0,
                    );
                    const qty = settlementCart.get(product.id) || 0;
                    const disabled = stock <= 0;

                    return (
                      <div key={product.id} className="p-4 border-b border-white/5 last:border-b-0 space-y-3">
                        <div className="flex items-center justify-between gap-3">
                          <div className="w-10 h-10 rounded-lg overflow-hidden border border-white/10 bg-white/5 flex items-center justify-center">
                            {product.image_url ? (
                              <img src={product.image_url} alt={product.name} className="w-full h-full object-cover" />
                            ) : (
                              <span className="text-[10px] text-white/40">图</span>
                            )}
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="font-semibold">{product.name}</p>
                            <p className="text-xs text-white/40">库存: {stock} · 零售价: ¥{Number(product.price || 0).toFixed(2)}</p>
                          </div>
                        </div>

                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => setSettlementQuantity(product.id, Math.max(0, qty - 1))}
                            className="px-3 py-1.5 rounded-lg bg-white/10"
                            disabled={disabled || qty <= 0}
                          >
                            -1
                          </button>
                          <input
                            value={qty > 0 ? String(qty) : ''}
                            onChange={(event) => {
                              const value = Number(event.target.value.replace(/[^0-9]/g, ''));
                              if (Number.isNaN(value)) {
                                setSettlementQuantity(product.id, 0);
                                return;
                              }
                              setSettlementQuantity(product.id, value);
                            }}
                            placeholder="数量(步长1)"
                            className="w-40 bg-white/5 border border-white/10 rounded-lg px-3 py-1.5"
                          />
                          <button
                            type="button"
                            onClick={() => setSettlementQuantity(product.id, qty + 1)}
                            className="px-3 py-1.5 rounded-lg bg-white/10"
                            disabled={disabled || qty >= stock}
                          >
                            +1
                          </button>
                        </div>
                      </div>
                    );
                  })}
                  {filteredSettlementProducts.length === 0 && (
                    <p className="px-4 py-6 text-sm text-white/40">当前店铺下暂无可选商品</p>
                  )}
                </div>

                <div className="border border-white/10 rounded-2xl p-4 flex flex-col">
                  <h4 className="font-semibold mb-3">结算购物车</h4>
                  <div className="space-y-2 max-h-[300px] overflow-auto pr-1">
                    {Array.from(settlementCart.entries()).map(([productId, quantity]) => {
                      const product = products.find((item) => item.id === productId);
                      if (!product) return null;
                      return (
                        <div key={productId} className="flex items-center justify-between bg-white/5 rounded-lg px-3 py-2">
                          <div>
                            <p className="text-sm font-medium">{product.name}</p>
                            <p className="text-xs text-white/40">数量 {quantity}</p>
                          </div>
                          <button type="button" onClick={() => setSettlementQuantity(productId, 0)} className="text-xs text-red-300 hover:text-red-200">移除</button>
                        </div>
                      );
                    })}
                    {settlementCart.size === 0 && <p className="text-sm text-white/40">暂无商品</p>}
                  </div>

                  <div className="mt-auto pt-4 border-t border-white/10 space-y-1 text-sm">
                    <div className="flex justify-between"><span className="text-white/60">商品总数</span><span>{Array.from(settlementCart.values()).reduce((sum, qty) => sum + qty, 0)}</span></div>
                    <div className="flex justify-between"><span className="text-white/60">结算总额</span><span className="text-accent font-bold">¥{settlementTotalAmount.toFixed(2)}</span></div>
                  </div>

                  <button
                    type="button"
                    onClick={() => {
                      void handleCreateSettlementOrder();
                    }}
                    disabled={submittingSettlementOrder || !settlementStoreId || settlementCart.size === 0}
                    className="mt-4 w-full py-2.5 rounded-xl bg-tech-gradient font-bold disabled:opacity-50"
                  >
                    {submittingSettlementOrder ? '提交中...' : '确认创建结算订单'}
                  </button>
                </div>
              </div>
            ) : (
              <div className="h-48 flex items-center justify-center text-white/40 border border-white/10 rounded-2xl">
                请先选择店铺
              </div>
            )}
          </div>
        </div>
      )}

      {detailOrder && (
        <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4 overflow-y-auto">
          <div className="w-full max-w-3xl max-h-[90vh] overflow-y-auto bg-[#121217] border border-white/10 rounded-3xl p-6 space-y-4">
            <div className="flex items-center justify-between sticky top-0 z-10 bg-[#121217] py-1">
              <h3 className="text-xl font-bold">订单明细 #{detailOrder.id.slice(0, 8)}</h3>
              <button type="button" onClick={closeOrderDetail} className="p-2 rounded-lg bg-white/10 text-white/60 hover:text-white">
                <X size={16} />
              </button>
            </div>

              <div className="grid grid-cols-2 gap-3 text-sm">
                <div className="bg-white/5 rounded-xl px-4 py-3"><span className="text-white/50">类型：</span>{getOrderKindLabel(detailOrder.order_kind)}</div>
                <div className="bg-white/5 rounded-xl px-4 py-3"><span className="text-white/50">状态：</span>{detailOrder.status}</div>
                <div className="bg-white/5 rounded-xl px-4 py-3"><span className="text-white/50">支付状态：</span>{detailOrder.payment_status || '-'}</div>
                <div className="bg-white/5 rounded-xl px-4 py-3"><span className="text-white/50">支付渠道：</span>{detailOrder.payment_method || '-'}</div>
                <div className="bg-white/5 rounded-xl px-4 py-3"><span className="text-white/50">城市：</span>{detailOrder.city_name || '-'}</div>
                <div className="bg-white/5 rounded-xl px-4 py-3"><span className="text-white/50">配送店铺：</span>{detailOrder.store_name || '未指定'}</div>
                <div className="bg-white/5 rounded-xl px-4 py-3"><span className="text-white/50">分销商：</span>{detailOrder.distributor_store || detailOrder.distributor_email || '-'}</div>
                <div className="bg-white/5 rounded-xl px-4 py-3"><span className="text-white/50">下单时间：</span>{new Date(detailOrder.created_at).toLocaleString()}</div>
                <div className="bg-white/5 rounded-xl px-4 py-3"><span className="text-white/50">交易号：</span>{detailOrder.payment_transaction_id || '-'}</div>
                {detailOrder.payment_note && <div className="bg-white/5 rounded-xl px-4 py-3 col-span-2"><span className="text-white/50">收款备注：</span>{detailOrder.payment_note}</div>}
              </div>

            {canRefundOrder(detailOrder) && (
              <div className="flex justify-end">
                <button
                  type="button"
                  onClick={() => {
                    openRefundModal(detailOrder);
                  }}
                  disabled={refundingOrderId === detailOrder.id}
                  className="px-4 py-2 rounded-xl border border-amber-400/30 bg-amber-500/20 text-amber-100 font-semibold disabled:opacity-60"
                >
                  {refundingOrderId === detailOrder.id ? '退款处理中...' : '按商品退款'}
                </button>
              </div>
            )}

            <div className="border border-white/10 rounded-2xl overflow-hidden">
              {loadingDetail && <p className="px-4 py-3 text-sm text-white/50">正在加载订单详情...</p>}
              <table className="w-full text-sm">
                <thead className="bg-white/[0.03]">
                  <tr>
                    <th className="text-left px-4 py-3 text-white/50">商品</th>
                    <th className="text-right px-4 py-3 text-white/50">数量</th>
                    <th className="text-right px-4 py-3 text-white/50">零售价</th>
                    <th className="text-right px-4 py-3 text-white/50">折扣价</th>
                    <th className="text-right px-4 py-3 text-white/50">小计</th>
                  </tr>
                </thead>
                <tbody>
                  {detailOrder.items.map((item) => (
                    <tr key={item.id} className="border-t border-white/5">
                      <td className="px-4 py-3">
                        {resolveItemName(item.product_id, item.product_name)}
                        {item.is_sample ? <span className="ml-2 text-[10px] text-cyan-300">样品</span> : null}
                        {Number(item.quantity || 0) <= 0 ? <span className="ml-2 text-[10px] text-amber-300">已退款</span> : null}
                      </td>
                      <td className="px-4 py-3 text-right">{item.quantity}</td>
                      <td className="px-4 py-3 text-right">¥{item.retail_price}</td>
                      <td className="px-4 py-3 text-right">¥{item.discount_price}</td>
                      <td className="px-4 py-3 text-right">¥{(item.discount_price * item.quantity).toFixed(2)}</td>
                    </tr>
                  ))}
                  {detailOrder.items.length === 0 && !loadingDetail && (
                    <tr>
                      <td colSpan={5} className="px-4 py-6 text-center text-white/50">暂无商品明细，请刷新后重试</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            {Array.isArray(detailOrder.refunded_items) && detailOrder.refunded_items.length > 0 && (
              <div className="border border-amber-400/20 rounded-2xl overflow-hidden">
                <div className="px-4 py-3 bg-amber-500/10 text-amber-100 text-sm font-semibold">已退款商品明细</div>
                <table className="w-full text-sm">
                  <thead className="bg-white/[0.03]">
                    <tr>
                      <th className="text-left px-4 py-3 text-white/50">商品</th>
                      <th className="text-right px-4 py-3 text-white/50">退款数量</th>
                      <th className="text-right px-4 py-3 text-white/50">退款单价</th>
                      <th className="text-right px-4 py-3 text-white/50">退款小计</th>
                      <th className="text-right px-4 py-3 text-white/50">退款时间</th>
                    </tr>
                  </thead>
                  <tbody>
                    {detailOrder.refunded_items.map((item, index) => (
                      <tr key={`${item.order_item_id}-${item.refunded_at || index}`} className="border-t border-white/5">
                        <td className="px-4 py-3">{resolveItemName(item.product_id, item.product_name)}</td>
                        <td className="px-4 py-3 text-right">{item.quantity}</td>
                        <td className="px-4 py-3 text-right">¥{item.discount_price.toFixed(2)}</td>
                        <td className="px-4 py-3 text-right">¥{(item.discount_price * item.quantity).toFixed(2)}</td>
                        <td className="px-4 py-3 text-right text-white/60">{item.refunded_at ? new Date(item.refunded_at).toLocaleString() : '-'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            <div className="flex justify-end gap-6 text-sm">
              <p><span className="text-white/50">零售总额：</span>¥{detailOrder.total_retail_amount.toFixed(2)}</p>
              <p><span className="text-white/50">折扣总额：</span><span className="text-accent font-bold">¥{detailOrder.total_discount_amount.toFixed(2)}</span></p>
            </div>
          </div>
        </div>
      )}

      {deleteConfirmOrderId && (
        <div className="fixed inset-0 bg-black/70 z-[70] flex items-center justify-center p-4 overflow-y-auto">
          <div className="w-full max-w-md max-h-[calc(100vh-2rem)] overflow-y-auto bg-[#121217] border border-white/10 rounded-3xl p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-bold">确认删除订单</h3>
              <button type="button" onClick={() => setDeleteConfirmOrderId(null)} className="p-2 rounded-lg bg-white/10 text-white/60 hover:text-white">
                <X size={16} />
              </button>
            </div>
            <p className="text-sm text-white/60">
              {deleteWillRestoreStock
                ? `确定删除订单 #${deleteConfirmOrderId.slice(0, 8)} 吗？删除后会自动恢复对应库存。`
                : `确定删除订单 #${deleteConfirmOrderId.slice(0, 8)} 吗？该订单已退款，删除时不会再次回退库存。`}
            </p>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setDeleteConfirmOrderId(null)}
                className="px-4 py-2 rounded-xl border border-white/15 bg-white/5 text-white/80"
              >
                取消
              </button>
              <button
                type="button"
                onClick={() => { void handleDeleteOrder(deleteConfirmOrderId); }}
                disabled={deletingOrderId === deleteConfirmOrderId}
                className="px-4 py-2 rounded-xl border border-red-400/30 bg-red-500/20 text-red-100 font-semibold disabled:opacity-60"
              >
                {deletingOrderId === deleteConfirmOrderId ? '删除中...' : '确认删除'}
              </button>
            </div>
          </div>
        </div>
      )}

      {refundModalOrderId && (
        <div className="fixed inset-0 bg-black/70 z-[80] flex items-center justify-center p-4 overflow-y-auto">
          <div className="w-full max-w-md max-h-[calc(100vh-2rem)] overflow-y-auto bg-[#121217] border border-white/10 rounded-3xl p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-bold">确认退款</h3>
              <button type="button" onClick={closeRefundModal} className="p-2 rounded-lg bg-white/10 text-white/60 hover:text-white">
                <X size={16} />
              </button>
            </div>
            <p className="text-sm text-white/60">订单 #{refundModalOrderId.slice(0, 8)} 请选择要退款的商品。二次确认后将直接发起退款。</p>
            {(() => {
              const order = getResolvedOrder(refundModalOrderId);
              if (!order) {
                return <p className="text-sm text-red-200">订单详情未加载，请关闭后重试。</p>;
              }

              const refundableItems = order.items.filter((item) => Number(item.quantity || 0) > 0);
              const allItemIds = refundableItems.map((item) => item.id);
              const selectedCount = refundableItems.filter((item) => refundSelectedItemIds.has(item.id)).length;
              const selectedAmount = refundableItems
                .filter((item) => refundSelectedItemIds.has(item.id))
                .reduce((sum, item) => sum + Number(item.discount_price || 0) * Number(item.quantity || 0), 0);

              return (
                <div className="space-y-3">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-white/60">已选 {selectedCount}/{refundableItems.length} 项 · 退款金额 ¥{selectedAmount.toFixed(2)}</span>
                    <button
                      type="button"
                      onClick={() => {
                        setRefundSelectedItemIds((prev) => {
                          if (allItemIds.length > 0 && prev.size === allItemIds.length) return new Set();
                          return new Set(allItemIds);
                        });
                      }}
                      className="text-accent hover:text-accent/80"
                    >
                      {allItemIds.length > 0 && refundSelectedItemIds.size === allItemIds.length ? '取消全选' : '全选'}
                    </button>
                  </div>

                  <div className="max-h-48 overflow-y-auto space-y-2 border border-white/10 rounded-xl p-3 bg-white/[0.02]">
                    {refundableItems.map((item) => {
                      const checked = refundSelectedItemIds.has(item.id);
                      return (
                        <label key={item.id} className="flex items-center justify-between gap-3 text-sm cursor-pointer">
                          <span className="flex items-center gap-2 min-w-0">
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={() => {
                                setRefundSelectedItemIds((prev) => {
                                  const next = new Set(prev);
                                  if (next.has(item.id)) {
                                    next.delete(item.id);
                                  } else {
                                    next.add(item.id);
                                  }
                                  return next;
                                });
                              }}
                            />
                            <span className="truncate">{resolveItemName(item.product_id, item.product_name)} × {item.quantity}</span>
                          </span>
                          <span className="text-white/70">¥{(Number(item.discount_price || 0) * Number(item.quantity || 0)).toFixed(2)}</span>
                        </label>
                      );
                    })}
                    {refundableItems.length === 0 && (
                      <p className="text-xs text-white/50">当前无可退款商品（已全部退款）</p>
                    )}
                  </div>
                </div>
              );
            })()}
            <div className="space-y-2">
              <label className="text-xs text-white/50">退款原因</label>
              <input
                value={refundReasonInput}
                onChange={(event) => setRefundReasonInput(event.target.value)}
                placeholder="退款原因"
                className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm"
              />
            </div>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={closeRefundModal}
                className="px-4 py-2 rounded-xl border border-white/15 bg-white/5 text-white/80"
              >
                取消
              </button>
              <button
                type="button"
                onClick={() => {
                  const order = getResolvedOrder(refundModalOrderId);
                  if (!order) return;
                  const selectedItemIds = order.items
                    .filter((item) => refundSelectedItemIds.has(item.id))
                    .map((item) => item.id);
                  const selectedAmount = order.items
                    .filter((item) => refundSelectedItemIds.has(item.id))
                    .reduce((sum, item) => sum + Number(item.discount_price || 0) * Number(item.quantity || 0), 0);
                  setRefundConfirmPayload({
                    order,
                    selectedItemIds,
                    selectedAmount,
                    reason: refundReasonInput,
                  });
                }}
                disabled={refundingOrderId === refundModalOrderId}
                className="px-4 py-2 rounded-xl border border-amber-400/30 bg-amber-500/20 text-amber-100 font-semibold disabled:opacity-60"
              >
                {refundingOrderId === refundModalOrderId ? '提交中...' : '确认退款'}
              </button>
            </div>
          </div>
        </div>
      )}
      {refundConfirmPayload && (
        <div className="fixed inset-0 bg-black/70 z-[85] flex items-center justify-center p-4 overflow-y-auto">
          <div className="w-full max-w-md bg-[#121217] border border-white/10 rounded-3xl p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-bold">二次确认退款</h3>
              <button
                type="button"
                onClick={() => setRefundConfirmPayload(null)}
                className="p-2 rounded-lg bg-white/10 text-white/60 hover:text-white"
              >
                <X size={16} />
              </button>
            </div>
            <p className="text-sm text-white/60">
              请确认是否继续退款：订单 #{refundConfirmPayload.order.id.slice(0, 8)}，
              退款金额 ¥{refundConfirmPayload.selectedAmount.toFixed(2)}。
            </p>
            <p className="text-xs text-white/50">确认后会立即调用微信/支付宝退款接口。</p>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setRefundConfirmPayload(null)}
                className="px-4 py-2 rounded-xl border border-white/15 bg-white/5 text-white/80"
              >
                返回
              </button>
              <button
                type="button"
                onClick={() => {
                  const payload = refundConfirmPayload;
                  setRefundConfirmPayload(null);
                  void handleRefundOrder(payload.order, payload.selectedItemIds, payload.reason);
                }}
                disabled={refundingOrderId === refundConfirmPayload.order.id}
                className="px-4 py-2 rounded-xl border border-amber-400/30 bg-amber-500/20 text-amber-100 font-semibold disabled:opacity-60"
              >
                {refundingOrderId === refundConfirmPayload.order.id ? '提交中...' : '确认直接退款'}
              </button>
            </div>
          </div>
        </div>
      )}
      {modifyOrder && (
        <div className="fixed inset-0 bg-black/70 z-[90] flex items-center justify-center p-4 overflow-y-auto">
          <div className="w-full max-w-3xl max-h-[calc(100vh-2rem)] overflow-y-auto bg-[#121217] border border-white/10 rounded-3xl p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-bold">修改订单 #{modifyOrder.id.slice(0, 8)}</h3>
              <button type="button" onClick={() => setModifyOrder(null)} className="p-2 rounded-lg bg-white/10 text-white/60 hover:text-white">
                <X size={16} />
              </button>
            </div>
            <p className="text-sm text-white/60">仅支持减少商品数量。如需增加，请新建订单。</p>
            <div className="border border-white/10 rounded-2xl overflow-hidden max-h-[400px] overflow-y-auto">
              <table className="w-full text-sm">
                <thead className="bg-white/[0.03]">
                  <tr>
                    <th className="text-left px-4 py-3 text-white/50">商品</th>
                    <th className="text-right px-4 py-3 text-white/50">原数量</th>
                    <th className="text-right px-4 py-3 text-white/50">修改后数量</th>
                  </tr>
                </thead>
                <tbody>
                  {modifyOrder.items.map((item) => {
                    const currentQty = modifyCart.get(item.id) ?? Number(item.quantity || 0);
                    const originalQty = Number(item.quantity || 0);
                    const isSample = Boolean(item.is_sample);
                    const step = 1;
                    return (
                      <tr key={item.id} className="border-t border-white/5">
                        <td className="px-4 py-3">
                          {resolveItemName(item.product_id, item.product_name)}
                          {isSample ? <span className="ml-2 text-[10px] text-cyan-300">样品</span> : null}
                        </td>
                        <td className="px-4 py-3 text-right">{originalQty}</td>
                        <td className="px-4 py-3 text-right">
                          <div className="flex items-center justify-end gap-2">
                            <button
                              type="button"
                              onClick={() => setModifyCart(new Map(modifyCart).set(item.id, Math.max(0, currentQty - step)))}
                              className="px-2 py-1 rounded bg-white/10 hover:bg-white/20"
                            >
                              -{step}
                            </button>
                            <span className="w-8 text-center">{currentQty}</span>
                            <button
                              type="button"
                              onClick={() => setModifyCart(new Map(modifyCart).set(item.id, Math.min(originalQty, currentQty + step)))}
                              disabled={currentQty >= originalQty}
                              className="px-2 py-1 rounded bg-white/10 hover:bg-white/20 disabled:opacity-30"
                            >
                              +{step}
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setModifyOrder(null)}
                className="px-4 py-2 rounded-xl border border-white/15 bg-white/5 text-white/80"
              >
                取消
              </button>
              <button
                type="button"
                onClick={() => { void handleModifyOrder(); }}
                disabled={submittingModify}
                className="px-4 py-2 rounded-xl border border-blue-400/30 bg-blue-500/20 text-blue-100 font-semibold disabled:opacity-60"
              >
                {submittingModify ? '提交中...' : '确认修改'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
