import React, { useMemo, useState } from 'react';
import { CheckCircle2, ChevronRight, Clock, Download, MapPin, ShoppingCart, Store } from 'lucide-react';
import { motion } from 'framer-motion';
import { useAppStore } from '../store/useAppStore';

type OrderFilter = 'all' | 'pending' | 'accepted';

export const OrdersScreen: React.FC = () => {
  const { orders, user, acceptOrder } = useAppStore();
  const [filter, setFilter] = useState<OrderFilter>('all');

  const filteredOrders = useMemo(() => {
    if (filter === 'all') return orders;
    return orders.filter((order) => order.status === filter);
  }, [filter, orders]);

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

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
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
                filter === tab.key ? 'bg-white/10 text-white' : 'text-white/40 hover:bg-white/5 hover:text-white'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <button
          type="button"
          onClick={exportCsv}
          className="bg-white/5 border border-white/10 px-6 py-2.5 rounded-xl font-bold flex items-center space-x-2 hover:bg-white/10 transition-all"
        >
          <Download size={18} />
          <span>导出列表</span>
        </button>
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
    </div>
  );
};
