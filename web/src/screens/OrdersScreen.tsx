import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { CheckCircle2, ChevronRight, Clock, Download, MapPin, Plus, ShoppingCart, Store, X } from 'lucide-react';
import { motion } from 'framer-motion';
import { useAppStore } from '../store/useAppStore';

type OrderFilter = 'all' | 'pending' | 'accepted';
type StatsRange = 'day' | 'week' | 'month' | 'year' | 'all' | 'date';

export const OrdersScreen: React.FC = () => {
  const { orders, products, user, acceptOrder, createBatchOrders, fetchOrderDetail } = useAppStore();
  const canCreateOrder = user?.role === 'distributor' || user?.role === 'admin' || user?.role === 'inventory_manager';
  const [filter, setFilter] = useState<OrderFilter>('all');
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [detailOrderId, setDetailOrderId] = useState<string | null>(null);
  const [detailOrderData, setDetailOrderData] = useState<(typeof orders)[number] | null>(null);
  const [detailCache, setDetailCache] = useState<Record<string, (typeof orders)[number]>>({});
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [searchKeyword, setSearchKeyword] = useState('');
  const [cart, setCart] = useState<Map<string, number>>(new Map());
  const [statsRange, setStatsRange] = useState<StatsRange>('month');
  const [selectedDate, setSelectedDate] = useState('');

  const getOrderKindLabel = (kind: 'distribution' | 'retail'): string => {
    return kind === 'retail' ? '零售订单' : '分销订单';
  };

  const baseOrders = useMemo(() => {
    if (filter === 'all') return orders;
    return orders.filter((order) => order.status === filter);
  }, [filter, orders]);

  const matchesStatsRange = useCallback((createdAt: string): boolean => {
    const date = new Date(createdAt);
    const now = new Date();

    if (statsRange === 'all') return true;
    if (statsRange === 'date') {
      if (!selectedDate) return true;
      const [year, month, day] = selectedDate.split('-').map((value) => Number.parseInt(value, 10));
      if (!year || !month || !day) return true;
      return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day;
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
  }, [statsRange, selectedDate]);

  const filteredOrders = useMemo(() => {
    return baseOrders.filter((order) => matchesStatsRange(order.created_at));
  }, [baseOrders, matchesStatsRange]);

  const totalRetail = useMemo(() => {
    return filteredOrders.reduce((sum, order) => sum + Number(order.total_retail_amount || 0), 0);
  }, [filteredOrders]);

  const totalDiscount = useMemo(() => {
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
      case 'date':
        return selectedDate || '指定日期';
      default:
        return '累计';
    }
  }, [statsRange, selectedDate]);

  const filteredProducts = useMemo(() => {
    const keyword = searchKeyword.trim().toLowerCase();
    if (!keyword) return products;
    return products.filter((product) => {
      const haystack = [product.name, product.barcode || '', product.city_name || ''].join(' ').toLowerCase();
      return haystack.includes(keyword);
    });
  }, [products, searchKeyword]);

  const cartItems = useMemo(() => {
    return Array.from(cart.entries())
      .map(([productId, quantity]) => {
        const product = products.find((item) => item.id === productId);
        if (!product) return null;
        return { product, quantity };
      })
      .filter((item): item is { product: (typeof products)[number]; quantity: number } => item !== null)
      .filter((item) => item.quantity > 0);
  }, [cart, products]);

  const totalRetailAmount = useMemo(() => {
    return cartItems.reduce((sum, item) => sum + Number(item.product.price || 0) * item.quantity, 0);
  }, [cartItems]);

  const totalDiscountAmount = useMemo(() => {
    return cartItems.reduce((sum, item) => sum + Number(item.product.discount_price || item.product.price || 0) * item.quantity, 0);
  }, [cartItems]);

  const detailOrder = detailOrderData;

  const productNameMap = useMemo(() => {
    const map = new Map<string, string>();
    products.forEach((product) => {
      map.set(product.id, product.name);
    });
    return map;
  }, [products]);

  const resolveItemName = (productId: string, productName?: string): string => {
    return productName || productNameMap.get(productId) || productId;
  };

  const getResolvedOrder = (orderId: string): (typeof orders)[number] | null => {
    return detailCache[orderId] || orders.find((item) => item.id === orderId) || null;
  };

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

  const setCartQuantity = (productId: string, quantity: number): void => {
    setCart((prev) => {
      const next = new Map(prev);
      if (quantity <= 0) {
        next.delete(productId);
      } else {
        next.set(productId, quantity);
      }
      return next;
    });
  };

  const handleCreateOrder = async (): Promise<void> => {
    if (cartItems.length === 0) {
      window.alert('请先选择商品');
      return;
    }

    const invalid = cartItems.find((item) => item.quantity % 5 !== 0);
    if (invalid) {
      window.alert(`${invalid.product.name} 数量必须是5的倍数`);
      return;
    }

    const result = await createBatchOrders(
      cartItems.map((item) => ({
        productId: item.product.id,
        quantity: item.quantity,
      })),
    );
    if (result.error) {
      window.alert(`下单失败：${result.error.message}`);
      return;
    }

    setCart(new Map());
    setSearchKeyword('');
    setShowCreateModal(false);
    window.alert('订单已创建');
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-4">
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

        <div className="flex items-center gap-2">
          {canCreateOrder && (
            <button
              type="button"
              onClick={() => setShowCreateModal(true)}
              className="bg-tech-gradient px-5 py-2.5 rounded-xl font-bold flex items-center space-x-2 shadow-neon hover:scale-[1.02] transition-all"
            >
              <Plus size={18} />
              <span>新建订单</span>
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
        <div className="flex flex-wrap gap-2">
          {[
            { key: 'day', label: '当日' },
            { key: 'week', label: '本周' },
            { key: 'month', label: '本月' },
            { key: 'year', label: '年度' },
            { key: 'all', label: '累计' },
            { key: 'date', label: '指定日期' },
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

        {statsRange === 'date' && (
          <div className="flex items-center gap-2 text-sm">
            <span className="text-white/60">日期</span>
            <input
              type="date"
              value={selectedDate}
              onChange={(event) => setSelectedDate(event.target.value)}
              className="bg-white/5 border border-white/10 rounded-lg px-3 py-1.5"
            />
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div className="bg-white/5 rounded-xl px-4 py-3">
            <p className="text-xs text-white/50">{rangeLabel}订单数</p>
            <p className="text-xl font-black">{filteredOrders.length}</p>
          </div>
          <div className="bg-white/5 rounded-xl px-4 py-3">
            <p className="text-xs text-white/50">{rangeLabel}零售总价</p>
            <p className="text-xl font-black">¥{totalRetail.toFixed(2)}</p>
          </div>
          <div className="bg-white/5 rounded-xl px-4 py-3">
            <p className="text-xs text-white/50">{rangeLabel}折扣总价</p>
            <p className="text-xl font-black text-accent">¥{totalDiscount.toFixed(2)}</p>
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
                    <div className="flex items-center space-x-1"><MapPin size={12} /><span>{order.city_name}</span></div>
                    <div className="flex items-center space-x-1"><Store size={12} /><span>{order.distributor_store || order.distributor_email}</span></div>
                  </div>
                </div>
              </div>

              <div className="text-right space-y-2">
                <p className="text-[10px] text-white/40 uppercase font-bold tracking-widest">订单总额</p>
                <p className="text-2xl font-black text-white">¥{order.total_discount_amount}</p>
                {order.status === 'pending' && user?.role === 'admin' && (
                  <button
                    type="button"
                    onClick={async () => {
                      const { error } = await acceptOrder(order.id);
                      if (error) {
                        window.alert(`接单失败：${error.message}`);
                        return;
                      }
                      window.alert('接单成功');
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
        <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4">
          <div className="w-full max-w-5xl bg-[#121217] border border-white/10 rounded-3xl p-6 space-y-5">
            <div className="flex items-center justify-between">
              <h3 className="text-xl font-bold">新建分销订单</h3>
              <button type="button" onClick={() => setShowCreateModal(false)} className="p-2 rounded-lg bg-white/10 text-white/60 hover:text-white">
                <X size={16} />
              </button>
            </div>

            <input
              value={searchKeyword}
              onChange={(event) => setSearchKeyword(event.target.value)}
              placeholder="搜索商品名称/条码"
              className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3"
            />

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <div className="max-h-[420px] overflow-auto border border-white/10 rounded-2xl">
                {filteredProducts.map((product) => {
                  const qty = cart.get(product.id) || 0;
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
                        <p className="text-sm text-accent font-bold">¥{product.discount_price}</p>
                      </div>

                      <div className="flex items-center gap-2">
                        <button type="button" onClick={() => setCartQuantity(product.id, Math.max(0, qty - 5))} className="px-3 py-1.5 rounded-lg bg-white/10">-5</button>
                        <input
                          value={qty > 0 ? String(qty) : ''}
                          onChange={(event) => {
                            const value = Number(event.target.value.replace(/[^0-9]/g, ''));
                            if (Number.isNaN(value)) {
                              setCartQuantity(product.id, 0);
                              return;
                            }
                            setCartQuantity(product.id, value);
                          }}
                          placeholder="数量(5的倍数)"
                          className="w-40 bg-white/5 border border-white/10 rounded-lg px-3 py-1.5"
                        />
                        <button type="button" onClick={() => setCartQuantity(product.id, qty + 5)} className="px-3 py-1.5 rounded-lg bg-white/10">+5</button>
                      </div>
                    </div>
                  );
                })}
              </div>

              <div className="border border-white/10 rounded-2xl p-4 flex flex-col">
                <h4 className="font-semibold mb-3">购物车</h4>
                <div className="space-y-2 max-h-[300px] overflow-auto pr-1">
                  {cartItems.map((item) => (
                    <div key={item.product.id} className="flex items-center justify-between bg-white/5 rounded-lg px-3 py-2">
                      <div>
                        <p className="text-sm font-medium">{item.product.name}</p>
                        <p className="text-xs text-white/40">数量 {item.quantity}</p>
                      </div>
                      <button type="button" onClick={() => setCartQuantity(item.product.id, 0)} className="text-xs text-red-300 hover:text-red-200">移除</button>
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

      {detailOrder && (
        <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4">
          <div className="w-full max-w-3xl bg-[#121217] border border-white/10 rounded-3xl p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-xl font-bold">订单明细 #{detailOrder.id.slice(0, 8)}</h3>
              <button type="button" onClick={closeOrderDetail} className="p-2 rounded-lg bg-white/10 text-white/60 hover:text-white">
                <X size={16} />
              </button>
            </div>

            <div className="grid grid-cols-2 gap-3 text-sm">
              <div className="bg-white/5 rounded-xl px-4 py-3"><span className="text-white/50">类型：</span>{getOrderKindLabel(detailOrder.order_kind)}</div>
              <div className="bg-white/5 rounded-xl px-4 py-3"><span className="text-white/50">状态：</span>{detailOrder.status}</div>
              <div className="bg-white/5 rounded-xl px-4 py-3"><span className="text-white/50">城市：</span>{detailOrder.city_name || '-'}</div>
              <div className="bg-white/5 rounded-xl px-4 py-3"><span className="text-white/50">分销商：</span>{detailOrder.distributor_store || detailOrder.distributor_email || '-'}</div>
              <div className="bg-white/5 rounded-xl px-4 py-3"><span className="text-white/50">下单时间：</span>{new Date(detailOrder.created_at).toLocaleString()}</div>
            </div>

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
                      <td className="px-4 py-3">{resolveItemName(item.product_id, item.product_name)}</td>
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

            <div className="flex justify-end gap-6 text-sm">
              <p><span className="text-white/50">零售总额：</span>¥{detailOrder.total_retail_amount.toFixed(2)}</p>
              <p><span className="text-white/50">折扣总额：</span><span className="text-accent font-bold">¥{detailOrder.total_discount_amount.toFixed(2)}</span></p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
