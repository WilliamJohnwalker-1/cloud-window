import React, { useMemo } from 'react';
import { CartesianGrid, Cell, Line, LineChart, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { DollarSign, Download, Package, TrendingDown, TrendingUp } from 'lucide-react';
import { motion } from 'framer-motion';
import { useAppStore } from '../store/useAppStore';

const colors = ['#FF6B9D', '#5B8DEF', '#82ca9d', '#ffc658', '#bb86fc'];

export const ReportsScreen: React.FC = () => {
  const { orders } = useAppStore();

  const { stats, salesData, cityData, productRanking } = useMemo(() => {
    const totalRetail = orders.reduce((sum, order) => sum + Number(order.total_retail_amount || 0), 0);
    const totalDiscount = orders.reduce((sum, order) => sum + Number(order.total_discount_amount || 0), 0);
    const pendingCount = orders.filter((order) => order.status === 'pending').length;

    const dayMap = new Map<string, number>();
    const cityMap = new Map<string, number>();
    const productMap = new Map<string, number>();

    orders.forEach((order) => {
      const dayKey = new Date(order.created_at).toISOString().slice(0, 10);
      dayMap.set(dayKey, (dayMap.get(dayKey) || 0) + Number(order.total_discount_amount || 0));

      const cityName = order.city_name || '未知';
      cityMap.set(cityName, (cityMap.get(cityName) || 0) + Number(order.total_discount_amount || 0));

      order.items.forEach((item) => {
        const key = item.product_name || item.product_id;
        productMap.set(key, (productMap.get(key) || 0) + Number(item.discount_price || 0) * Number(item.quantity || 0));
      });
    });

    const sortedDays = Array.from(dayMap.entries())
      .sort(([a], [b]) => (a > b ? 1 : -1))
      .slice(-10)
      .map(([date, value]) => ({ name: date.slice(5), value }));

    const sortedCities = Array.from(cityMap.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6)
      .map(([name, value]) => ({ name, value }));

    const sortedProducts = Array.from(productMap.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 20)
      .map(([name, value]) => ({ name, value }));

    return {
      stats: [
        { label: '总零售额', value: `¥${totalRetail.toFixed(2)}`, icon: DollarSign, trend: `订单 ${orders.length} 笔`, isUp: true },
        { label: '折扣成交额', value: `¥${totalDiscount.toFixed(2)}`, icon: Package, trend: `待处理 ${pendingCount} 笔`, isUp: true },
        { label: '折扣差额', value: `¥${(totalRetail - totalDiscount).toFixed(2)}`, icon: TrendingUp, trend: '零售额 - 折扣额', isUp: totalRetail - totalDiscount >= 0 },
        { label: '待处理订单', value: String(pendingCount), icon: TrendingDown, trend: 'pending', isUp: pendingCount === 0 },
      ],
      salesData: sortedDays,
      cityData: sortedCities,
      productRanking: sortedProducts,
    };
  }, [orders]);

  const exportSalesCsv = (): void => {
    const header = '日期,销售额';
    const lines = salesData.map((row) => `${row.name},${row.value}`);
    const blob = new Blob([[header, ...lines].join('\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `sales-trend-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const exportProductCsv = (): void => {
    const header = '商品,销售额';
    const lines = productRanking.map((row) => `${row.name},${row.value}`);
    const blob = new Blob([[header, ...lines].join('\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `product-ranking-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-8">
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        {stats.map((stat, index) => {
          const Icon = stat.icon;
          return (
            <motion.div
              key={stat.label}
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ delay: index * 0.06 }}
              className="bg-white/5 border border-white/10 p-6 rounded-3xl relative overflow-hidden group hover:border-accent/50 transition-all"
            >
              <div className="absolute -right-4 -bottom-4 opacity-5 group-hover:scale-110 transition-transform">
                <Icon size={120} />
              </div>
              <div className="relative z-10">
                <p className="text-xs font-bold text-white/40 uppercase tracking-widest">{stat.label}</p>
                <h3 className="text-2xl font-black mt-2">{stat.value}</h3>
                <div className={`mt-4 flex items-center text-xs font-bold ${stat.isUp ? 'text-green-500' : 'text-red-500'}`}>
                  {stat.trend}
                </div>
              </div>
            </motion.div>
          );
        })}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        <div className="bg-white/5 border border-white/10 p-8 rounded-[40px]">
          <div className="flex items-center justify-between mb-8">
            <h3 className="text-xl font-bold">销售趋势（真实订单）</h3>
            <button type="button" onClick={exportSalesCsv} className="text-white/40 hover:text-white transition-colors">
              <Download size={20} />
            </button>
          </div>
          <div className="h-[300px]">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={salesData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#ffffff10" vertical={false} />
                <XAxis dataKey="name" stroke="#ffffff40" fontSize={12} tickLine={false} axisLine={false} />
                <YAxis stroke="#ffffff40" fontSize={12} tickLine={false} axisLine={false} tickFormatter={(value: number) => `¥${value}`} />
                <Tooltip contentStyle={{ backgroundColor: '#1a1a1c', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '12px' }} itemStyle={{ color: '#fff' }} />
                <Line type="monotone" dataKey="value" stroke="url(#lineGradient)" strokeWidth={4} dot={{ r: 4, fill: '#5B8DEF', strokeWidth: 2 }} activeDot={{ r: 6, fill: '#FF6B9D', stroke: '#fff' }} />
                <defs>
                  <linearGradient id="lineGradient" x1="0" y1="0" x2="1" y2="0">
                    <stop offset="0%" stopColor="#FF6B9D" />
                    <stop offset="100%" stopColor="#5B8DEF" />
                  </linearGradient>
                </defs>
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="bg-white/5 border border-white/10 p-8 rounded-[40px]">
          <div className="flex items-center justify-between mb-8">
            <h3 className="text-xl font-bold">城市销售占比（真实订单）</h3>
          </div>
          <div className="h-[300px] flex items-center">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={cityData} cx="50%" cy="50%" innerRadius={80} outerRadius={110} paddingAngle={8} dataKey="value">
                  {cityData.map((entry, index) => (
                    <Cell key={entry.name} fill={colors[index % colors.length]} />
                  ))}
                </Pie>
                <Tooltip contentStyle={{ backgroundColor: '#1a1a1c', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '12px' }} />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      <div className="bg-white/5 border border-white/10 p-8 rounded-[40px]">
        <div className="flex items-center justify-between mb-6">
          <h3 className="text-xl font-bold">商品销售额排行（真实订单）</h3>
          <button type="button" onClick={exportProductCsv} className="text-white/40 hover:text-white transition-colors">
            <Download size={20} />
          </button>
        </div>
        <div className="space-y-2 max-h-[360px] overflow-auto">
          {productRanking.map((row) => (
            <div key={row.name} className="flex items-center justify-between bg-white/[0.03] rounded-xl px-4 py-3">
              <span className="text-sm text-white/90">{row.name}</span>
              <span className="font-bold text-accent">¥{row.value.toFixed(2)}</span>
            </div>
          ))}
          {productRanking.length === 0 && <p className="text-sm text-white/40">暂无可导出的报表数据</p>}
        </div>
      </div>
    </div>
  );
};
