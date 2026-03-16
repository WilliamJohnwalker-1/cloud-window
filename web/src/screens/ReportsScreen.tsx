import React, { useMemo } from 'react';
import { Bar, BarChart, CartesianGrid, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { AlertTriangle, DollarSign, Download, Package, TrendingDown, TrendingUp } from 'lucide-react';
import { motion } from 'framer-motion';
import { useAppStore } from '../store/useAppStore';

const colors = ['#FF6B9D', '#5B8DEF', '#82ca9d', '#ffc658', '#bb86fc'];

export const ReportsScreen: React.FC = () => {
  const { orders, products } = useAppStore();

  const medalStyles = [
    'from-amber-400/30 to-amber-600/20 border-amber-300/40 text-amber-200',
    'from-slate-300/30 to-slate-500/20 border-slate-300/30 text-slate-100',
    'from-orange-500/30 to-orange-700/20 border-orange-300/30 text-orange-200',
  ];

  const { stats, productVolumeRanking, cityData, productAmountRanking, productVelocityRanking, profitData } = useMemo(() => {
    const totalRetail = orders.reduce((sum, order) => sum + Number(order.total_retail_amount || 0), 0);
    const totalDiscount = orders.reduce((sum, order) => sum + Number(order.total_discount_amount || 0), 0);
    const pendingCount = orders.filter((order) => order.status === 'pending').length;

    const cityMap = new Map<string, number>();
    const productAmountMap = new Map<string, number>();
    const productVolumeMap = new Map<string, number>();
    const productVolumeByIdMap = new Map<string, number>();

    orders.forEach((order) => {
      const cityName = order.city_name || '未知';
      cityMap.set(cityName, (cityMap.get(cityName) || 0) + Number(order.total_discount_amount || 0));

      order.items.forEach((item) => {
        const key = item.product_name || item.product_id;
        const productIdKey = item.product_id;
        const itemQty = Number(item.quantity || 0);
        const itemAmount = Number(item.discount_price || 0) * itemQty;
        productAmountMap.set(key, (productAmountMap.get(key) || 0) + itemAmount);
        productVolumeMap.set(key, (productVolumeMap.get(key) || 0) + itemQty);
        productVolumeByIdMap.set(productIdKey, (productVolumeByIdMap.get(productIdKey) || 0) + itemQty);
      });
    });

    const sortedCities = Array.from(cityMap.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6)
      .map(([name, value]) => ({ name, value }));

    const sortedProductAmount = Array.from(productAmountMap.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 15)
      .map(([name, value]) => ({ name, value }));

    const sortedProductVolume = Array.from(productVolumeMap.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 15)
      .map(([name, value]) => ({ name, value }));

    const velocityRows = products.map((product) => {
      const soldQty = productVolumeByIdMap.get(product.id) || 0;
      const inventoryQty = Number(product.quantity || 0);
      const velocity = inventoryQty > 0 ? soldQty / inventoryQty : 0;
      return {
        name: product.name,
        soldQty,
        inventoryQty,
        velocity,
        isUnhealthy: velocity < 0.5,
      };
    });

    const sortedVelocityRows = velocityRows
      .sort((a, b) => b.velocity - a.velocity)
      .slice(0, 10);

    const productProfit: Record<string, {
      name: string;
      quantity: number;
      retailPrice: number;
      retailRevenue: number;
      discountPrice: number;
      discountRevenue: number;
      unitCostTotal: number;
      oneTimeCost: number;
    }> = {};

    orders.forEach((order) => {
      order.items.forEach((item) => {
        const key = item.product_id;
        if (!productProfit[key]) {
          productProfit[key] = {
            name: item.product_name || item.product_id,
            quantity: 0,
            retailPrice: Number(item.retail_price || 0),
            retailRevenue: 0,
            discountPrice: Number(item.discount_price || 0),
            discountRevenue: 0,
            unitCostTotal: 0,
            oneTimeCost: Number(item.one_time_cost || 0),
          };
        }

        productProfit[key].quantity += Number(item.quantity || 0);
        productProfit[key].retailRevenue += Number(item.quantity || 0) * Number(item.retail_price || 0);
        productProfit[key].discountRevenue += Number(item.quantity || 0) * Number(item.discount_price || 0);
        productProfit[key].unitCostTotal += Number(item.quantity || 0) * Number(item.unit_cost || 0);
        if (productProfit[key].oneTimeCost === 0) {
          productProfit[key].oneTimeCost = Number(item.one_time_cost || 0);
        }
      });
    });

    const profitByProduct = Object.values(productProfit)
      .map((entry) => {
        const cost = entry.unitCostTotal + entry.oneTimeCost;
        return {
          name: entry.name,
          quantity: entry.quantity,
          retailPrice: entry.retailPrice,
          retailRevenue: entry.retailRevenue,
          discountPrice: entry.discountPrice,
          discountRevenue: entry.discountRevenue,
          cost,
          profit: entry.discountRevenue - cost,
        };
      })
      .sort((a, b) => b.profit - a.profit);

    const totalRetailRevenue = profitByProduct.reduce((sum, row) => sum + row.retailRevenue, 0);
    const totalDiscountRevenue = profitByProduct.reduce((sum, row) => sum + row.discountRevenue, 0);
    const totalCost = profitByProduct.reduce((sum, row) => sum + row.cost, 0);

    return {
      stats: [
        { label: '总零售额', value: `¥${totalRetail.toFixed(2)}`, icon: DollarSign, trend: `订单 ${orders.length} 笔`, isUp: true },
        { label: '折扣成交额', value: `¥${totalDiscount.toFixed(2)}`, icon: Package, trend: `待处理 ${pendingCount} 笔`, isUp: true },
        { label: '折扣差额', value: `¥${(totalRetail - totalDiscount).toFixed(2)}`, icon: TrendingUp, trend: '零售额 - 折扣额', isUp: totalRetail - totalDiscount >= 0 },
        { label: '待处理订单', value: String(pendingCount), icon: TrendingDown, trend: 'pending', isUp: pendingCount === 0 },
      ],
      productVolumeRanking: sortedProductVolume,
      cityData: sortedCities,
      productAmountRanking: sortedProductAmount,
      productVelocityRanking: sortedVelocityRows,
      profitData: {
        totalRetailRevenue,
        totalDiscountRevenue,
        totalCost,
        totalProfit: totalDiscountRevenue - totalCost,
        profitByProduct,
      },
    };
  }, [orders, products]);

  const exportVolumeCsv = (): void => {
    const header = '商品,销量';
    const lines = productVolumeRanking.map((row) => `${row.name},${row.value}`);
    const blob = new Blob([[header, ...lines].join('\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `product-volume-ranking-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const exportProductCsv = (): void => {
    const header = '商品,销售额';
    const lines = productAmountRanking.map((row) => `${row.name},${row.value}`);
    const blob = new Blob([[header, ...lines].join('\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `product-ranking-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const exportProfitExcel = async (): Promise<void> => {
    const XLSX = await import('xlsx');
    const headers = ['商品名称', '销量', '零售价', '零售总价', '折扣价', '折扣总收入', '总成本', '总利润'];
    const dataRows = profitData.profitByProduct.map((row) => [
      row.name,
      row.quantity,
      Number(row.retailPrice.toFixed(2)),
      Number(row.retailRevenue.toFixed(2)),
      Number(row.discountPrice.toFixed(2)),
      Number(row.discountRevenue.toFixed(2)),
      Number(row.cost.toFixed(2)),
      Number(row.profit.toFixed(2)),
    ]);

    const worksheet = XLSX.utils.aoa_to_sheet([headers, ...dataRows]);
    const colWidths = headers.map((header, colIdx) => {
      let maxLen = header.length * 2;
      dataRows.forEach((row) => {
        const len = String(row[colIdx]).length;
        if (len > maxLen) maxLen = len;
      });
      return { wch: Math.max(maxLen + 2, 10) };
    });
    worksheet['!cols'] = colWidths;

    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, '利润报表');
    XLSX.writeFile(workbook, `profit-report-${Date.now()}.xlsx`);
  };

  const volumeTop3 = productVolumeRanking.slice(0, 3);
  const amountTop3 = productAmountRanking.slice(0, 3);
  const volumeChartData = productVolumeRanking.slice(0, 10).map((row) => ({
    ...row,
    shortName: row.name.length > 6 ? `${row.name.slice(0, 6)}…` : row.name,
  }));
  const amountChartData = productAmountRanking.slice(0, 10).map((row) => ({
    ...row,
    shortName: row.name.length > 6 ? `${row.name.slice(0, 6)}…` : row.name,
  }));

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
            <h3 className="text-xl font-bold">商品销量排行</h3>
            <button type="button" onClick={exportVolumeCsv} className="text-white/40 hover:text-white transition-colors">
              <Download size={20} />
            </button>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-6">
            {volumeTop3.map((row, idx) => (
              <div
                key={row.name}
                className={`rounded-2xl border bg-gradient-to-br px-4 py-3 ${medalStyles[idx] ?? 'border-white/10 text-white/80'}`}
              >
                <p className="text-[10px] font-black uppercase tracking-widest opacity-80">TOP {idx + 1}</p>
                <p className="text-sm font-bold mt-1 truncate">{row.name}</p>
                <p className="text-lg font-black mt-1">{row.value}</p>
              </div>
            ))}
            {volumeTop3.length === 0 && <p className="text-sm text-white/40 col-span-3">暂无销量排行数据</p>}
          </div>
          <div className="h-[300px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={volumeChartData} margin={{ top: 8, right: 10, left: 0, bottom: 28 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#ffffff10" vertical={false} />
                <XAxis
                  dataKey="shortName"
                  stroke="#ffffff40"
                  fontSize={11}
                  tickLine={false}
                  axisLine={false}
                  interval={0}
                />
                <YAxis
                  stroke="#ffffff40"
                  fontSize={12}
                  tickLine={false}
                  axisLine={false}
                />
                <Tooltip
                  contentStyle={{ backgroundColor: '#1a1a1c', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '12px' }}
                  itemStyle={{ color: '#fff' }}
                  formatter={(value: number) => [value, '销量']}
                  labelFormatter={(_, payload) => String(payload?.[0]?.payload?.name || '')}
                />
                <Bar dataKey="value" radius={[10, 10, 0, 0]}>
                  {volumeChartData.map((entry, index) => (
                    <Cell key={entry.name} fill={colors[index % colors.length]} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="bg-white/5 border border-white/10 p-8 rounded-[40px]">
          <div className="flex items-center justify-between mb-8">
            <h3 className="text-xl font-bold">城市销售占比</h3>
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
          <h3 className="text-xl font-bold">商品动销率排行</h3>
        </div>
        <p className="text-sm text-white/50 mb-4">动销率 = 销量 / 当前库存，低于 0.5 的商品用风险样式标记。</p>
        <div className="space-y-3">
          {productVelocityRanking.map((row, index) => (
            <div
              key={`${row.name}-${row.soldQty}-${row.inventoryQty}`}
              className={`rounded-2xl border px-4 py-3 flex items-center justify-between ${row.isUnhealthy ? 'border-red-400/30 bg-red-500/10' : 'border-white/10 bg-white/[0.03]'}`}
            >
              <div className="flex items-center gap-3">
                <div className="w-7 h-7 rounded-full bg-accent/80 text-white text-xs font-black flex items-center justify-center">{index + 1}</div>
                <div>
                  <p className={`text-sm font-bold ${row.isUnhealthy ? 'text-red-200' : 'text-white/90'}`}>{row.name}</p>
                  <p className="text-xs text-white/50">销量 {row.soldQty} / 库存 {row.inventoryQty}</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                {row.isUnhealthy && <AlertTriangle size={14} className="text-red-300" />}
                <p className={`text-sm font-black ${row.isUnhealthy ? 'text-red-200' : 'text-accent'}`}>{row.velocity.toFixed(2)}</p>
              </div>
            </div>
          ))}
          {productVelocityRanking.length === 0 && <p className="text-sm text-white/40">暂无动销率数据</p>}
        </div>
      </div>

      <div className="bg-white/5 border border-white/10 p-8 rounded-[40px]">
        <div className="flex items-center justify-between mb-6">
          <h3 className="text-xl font-bold">利润报表导出</h3>
          <button type="button" onClick={() => { void exportProfitExcel(); }} className="text-white/40 hover:text-white transition-colors">
            <Download size={20} />
          </button>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3 mb-4">
          <div className="bg-white/[0.03] rounded-xl px-4 py-3">
            <p className="text-xs text-white/50">零售总价</p>
            <p className="text-lg font-black">¥{profitData.totalRetailRevenue.toFixed(2)}</p>
          </div>
          <div className="bg-white/[0.03] rounded-xl px-4 py-3">
            <p className="text-xs text-white/50">折扣总收入</p>
            <p className="text-lg font-black">¥{profitData.totalDiscountRevenue.toFixed(2)}</p>
          </div>
          <div className="bg-white/[0.03] rounded-xl px-4 py-3">
            <p className="text-xs text-white/50">总成本</p>
            <p className="text-lg font-black">¥{profitData.totalCost.toFixed(2)}</p>
          </div>
          <div className="bg-white/[0.03] rounded-xl px-4 py-3">
            <p className="text-xs text-white/50">总利润</p>
            <p className="text-lg font-black text-accent">¥{profitData.totalProfit.toFixed(2)}</p>
          </div>
        </div>
        <p className="text-sm text-white/50">导出格式与移动端一致：商品名称、销量、零售价、零售总价、折扣价、折扣总收入、总成本、总利润。</p>
      </div>

      <div className="bg-white/5 border border-white/10 p-8 rounded-[40px]">
        <div className="flex items-center justify-between mb-6">
          <h3 className="text-xl font-bold">商品销售额排行</h3>
          <button type="button" onClick={exportProductCsv} className="text-white/40 hover:text-white transition-colors">
            <Download size={20} />
          </button>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-6">
          {amountTop3.map((row, idx) => (
            <div
              key={row.name}
              className={`rounded-2xl border bg-gradient-to-br px-4 py-3 ${medalStyles[idx] ?? 'border-white/10 text-white/80'}`}
            >
              <p className="text-[10px] font-black uppercase tracking-widest opacity-80">TOP {idx + 1}</p>
              <p className="text-sm font-bold mt-1 truncate">{row.name}</p>
              <p className="text-lg font-black mt-1">¥{row.value.toFixed(2)}</p>
            </div>
          ))}
          {amountTop3.length === 0 && <p className="text-sm text-white/40 col-span-3">暂无销售额排行数据</p>}
        </div>
        <div className="h-[360px]">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={amountChartData} margin={{ top: 8, right: 10, left: 0, bottom: 28 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#ffffff10" vertical={false} />
              <XAxis
                dataKey="shortName"
                stroke="#ffffff40"
                fontSize={11}
                tickLine={false}
                axisLine={false}
                interval={0}
              />
              <YAxis
                stroke="#ffffff40"
                fontSize={12}
                tickLine={false}
                axisLine={false}
                tickFormatter={(value: number) => `¥${value}`}
              />
              <Tooltip
                contentStyle={{ backgroundColor: '#1a1a1c', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '12px' }}
                itemStyle={{ color: '#fff' }}
                formatter={(value: number) => [`¥${value.toFixed(2)}`, '销售额']}
                labelFormatter={(_, payload) => String(payload?.[0]?.payload?.name || '')}
              />
              <Bar dataKey="value" radius={[10, 10, 0, 0]}>
                {amountChartData.map((entry, index) => (
                  <Cell key={entry.name} fill={colors[index % colors.length]} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
        {productAmountRanking.length === 0 && <p className="text-sm text-white/40 mt-4">暂无可导出的报表数据</p>}
      </div>
    </div>
  );
};
