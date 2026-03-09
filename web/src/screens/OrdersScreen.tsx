import React, { useMemo, useState } from 'react';
import { CheckCircle2, ChevronRight, Clock, Download, MapPin, Plus, ShoppingCart, Store, X } from 'lucide-react';
import { motion } from 'framer-motion';
import { useAppStore } from '../store/useAppStore';

type OrderFilter = 'all' | 'pending' | 'accepted';

export const OrdersScreen: React.FC = () => {
  const { orders, products, user, acceptOrder, createBatchOrders } = useAppStore();
  const [filter, setFilter] = useState<OrderFilter>('all');
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [searchKeyword, setSearchKeyword] = useState('');
  const [cart, setCart] = useState<Map<string, number>>(new Map());

  const filteredOrders = useMemo(() => {
    if (filter === 'all') return orders;
    return orders.filter((order) => order.status === filter);
  }, [filter, orders]);

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

  const exportCsv = (): void => {
    const header = '订单号,状态,城市,分销商,总额,创建时间';
    const lines = filteredOrders.map((order) => {
      const distributor = order.distributor_store || order.distributor_email || '';
      return [order.id, order.status, order.city_name || '', distributor, String(order.total_discount_amount), order.created_at].join(',');
    });
    const blob = new Blob([[header, ...lines].join('\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `orders-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
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
          {user?.role === 'distributor' && (
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
            onClick={exportCsv}
            className="bg-white/5 border border-white/10 px-6 py-2.5 rounded-xl font-bold flex items-center space-x-2 hover:bg-white/10 transition-all"
          >
            <Download size={18} />
            <span>导出列表</span>
          </button>
        </div>
      </div>

      <div className="space-y-4">
        {filteredOrders.map((order, index) => (
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
                {order.items.slice(0, 5).map((item) => (
                  <div key={item.id} className="w-10 h-10 rounded-full border-2 border-background bg-white/10 flex items-center justify-center text-[10px] font-bold overflow-hidden">
                    {item.product_name?.[0]}
                  </div>
                ))}
                {order.items.length > 5 && (
                  <div className="w-10 h-10 rounded-full border-2 border-background bg-white/5 flex items-center justify-center text-[10px] font-bold text-white/40">
                    +{order.items.length - 5}
                  </div>
                )}
              </div>

              <div className="flex items-center space-x-4">
                <p className="text-sm text-white/40">共 {order.items.length} 种商品</p>
                <div className="w-8 h-8 rounded-full border border-white/10 flex items-center justify-center group-hover:bg-accent group-hover:border-accent transition-all">
                  <ChevronRight size={18} className="text-white group-hover:scale-110 transition-transform" />
                </div>
              </div>
            </div>
          </motion.div>
        ))}
      </div>

      {showCreateModal && user?.role === 'distributor' && (
        <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4">
          <div className="w-full max-w-5xl bg-[#121217] border border-white/10 rounded-3xl p-6 space-y-5">
            <div className="flex items-center justify-between">
              <h3 className="text-xl font-bold">新建订单</h3>
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
                        <div>
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
                  确认下单
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
