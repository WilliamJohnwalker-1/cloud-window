import React from 'react';
import { AlertTriangle, Check, History, Minus, Pencil, Plus, ScanLine, X } from 'lucide-react';
import { motion } from 'framer-motion';
import { useAppStore } from '../store/useAppStore';

export const InventoryScreen: React.FC = () => {
  const { products, updateInventoryByProduct, inboundStockByBarcode, inventoryLogs } = useAppStore();
  const [showLogs, setShowLogs] = React.useState(false);
  const [editingProductId, setEditingProductId] = React.useState<string | null>(null);
  const [editingQuantityText, setEditingQuantityText] = React.useState('');

  const lowStockCount = products.filter((item) => Number(item.quantity || 0) < Number(item.min_quantity || 10)).length;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="bg-orange-500/10 border border-orange-500/20 px-4 py-2 rounded-xl flex items-center space-x-2">
          <AlertTriangle size={18} className="text-orange-500" />
          <span className="text-sm font-medium text-orange-500">{lowStockCount} 项库存告警</span>
        </div>

        <div className="flex items-center space-x-4">
          <button
            type="button"
            onClick={() => setShowLogs(true)}
            className="bg-white/5 border border-white/10 px-4 py-2 rounded-xl flex items-center space-x-2 hover:bg-white/10 transition-colors text-sm font-medium"
          >
            <History size={18} className="text-white/40" />
            <span>变动日志</span>
          </button>
          <button
            type="button"
            onClick={async () => {
              const barcode = window.prompt('请输入 13 位条码');
              if (!barcode) return;
              const qtyRaw = window.prompt('请输入入库数量', '5');
              if (!qtyRaw) return;
              const qty = Number(qtyRaw);
              const { error } = await inboundStockByBarcode(barcode, qty);
              if (error) {
                window.alert(`入库失败：${error.message}`);
                return;
              }
              window.alert('入库成功');
            }}
            className="bg-tech-gradient px-6 py-2.5 rounded-xl font-bold flex items-center space-x-2 shadow-neon hover:scale-[1.02] transition-all active:scale-[0.98]"
          >
            <ScanLine size={20} />
            <span>扫描入库</span>
          </button>
        </div>
      </div>

      <div className="bg-white/5 border border-white/10 rounded-[32px] overflow-hidden backdrop-blur-md">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="border-b border-white/5 bg-white/[0.02]">
              <th className="px-8 py-5 text-xs font-bold text-white/40 uppercase tracking-widest">商品信息</th>
              <th className="px-8 py-5 text-xs font-bold text-white/40 uppercase tracking-widest text-center">当前库存</th>
              <th className="px-8 py-5 text-xs font-bold text-white/40 uppercase tracking-widest text-center">告警阈值</th>
              <th className="px-8 py-5 text-xs font-bold text-white/40 uppercase tracking-widest text-right">快速操作</th>
            </tr>
          </thead>
          <tbody>
            {products.map((product, index) => {
              const currentQty = Number(product.quantity || 0);
              const isLowStock = currentQty < Number(product.min_quantity || 10);
              return (
                <motion.tr
                  key={product.id}
                  initial={{ opacity: 0, x: -20 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: index * 0.02 }}
                  className="group hover:bg-white/[0.03] transition-colors border-b border-white/5 last:border-0"
                >
                  <td className="px-8 py-5">
                    <div className="flex items-center space-x-4">
                      <div className="w-12 h-12 rounded-xl bg-white/5 border border-white/10 flex items-center justify-center overflow-hidden">
                        {product.image_url ? <img src={product.image_url} className="w-full h-full object-cover" alt={product.name} /> : <span className="text-lg font-bold text-white/20">{product.name[0]}</span>}
                      </div>
                      <div>
                        <p className="font-bold text-white group-hover:text-accent transition-colors">{product.name}</p>
                        <p className="text-xs text-white/30 font-mono mt-1">{product.barcode || '无条码'}</p>
                      </div>
                    </div>
                  </td>
                  <td className="px-8 py-5 text-center">
                    <div className="flex flex-col items-center">
                      <span className={`text-xl font-black ${isLowStock ? 'text-red-500' : 'text-green-500'}`}>{currentQty}</span>
                      {isLowStock && <span className="text-[10px] bg-red-500/10 text-red-500 px-2 py-0.5 rounded-full font-bold mt-1">库存不足</span>}
                    </div>
                  </td>
                  <td className="px-8 py-5 text-center">
                    <span className="text-sm font-medium text-white/60">{product.min_quantity || 10}</span>
                  </td>
                  <td className="px-8 py-5">
                    <div className="flex items-center justify-end space-x-2 opacity-100">
                      <button
                        type="button"
                        onClick={async () => {
                          const confirmed = window.confirm(`确认将 ${product.name} 库存减少 5 吗？`);
                          if (!confirmed) return;
                          const { error } = await updateInventoryByProduct(product.id, Math.max(0, currentQty - 5), {
                            action: 'quick_reduce',
                            note: '库存页快捷 -5',
                          });
                          if (error) window.alert(`减库存失败：${error.message}`);
                        }}
                        className="p-2 rounded-lg bg-white/5 hover:bg-white/10 text-white/40 hover:text-white transition-colors"
                      >
                        <Minus size={16} />
                      </button>
                      <button
                        type="button"
                        onClick={async () => {
                          const confirmed = window.confirm(`确认将 ${product.name} 库存增加 5 吗？`);
                          if (!confirmed) return;
                          const { error } = await updateInventoryByProduct(product.id, currentQty + 5, {
                            action: 'quick_add',
                            note: '库存页快捷 +5',
                          });
                          if (error) window.alert(`加库存失败：${error.message}`);
                        }}
                        className="p-2 rounded-lg bg-white/5 hover:bg-white/10 text-white/40 hover:text-white transition-colors"
                      >
                        <Plus size={16} />
                      </button>
                      {editingProductId === product.id ? (
                        <div className="flex items-center gap-2 bg-white/5 rounded-lg px-2 py-1 border border-white/10">
                          <input
                            value={editingQuantityText}
                            onChange={(event) => setEditingQuantityText(event.target.value.replace(/[^0-9]/g, ''))}
                            className="w-20 bg-transparent outline-none text-sm"
                            placeholder="数量"
                          />
                          <button
                            type="button"
                            onClick={async () => {
                              const qty = Number(editingQuantityText);
                              if (!Number.isFinite(qty)) {
                                window.alert('请输入有效数字');
                                return;
                              }
                              const { error } = await updateInventoryByProduct(product.id, qty, {
                                action: 'manual_adjust',
                                note: '库存页行内编辑',
                              });
                              if (error) {
                                window.alert(`设置库存失败：${error.message}`);
                                return;
                              }
                              setEditingProductId(null);
                              setEditingQuantityText('');
                            }}
                            className="p-1 rounded bg-green-500/20 text-green-300"
                          >
                            <Check size={14} />
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setEditingProductId(null);
                              setEditingQuantityText('');
                            }}
                            className="p-1 rounded bg-red-500/20 text-red-300"
                          >
                            <X size={14} />
                          </button>
                        </div>
                      ) : (
                        <button
                          type="button"
                          onClick={() => {
                            setEditingProductId(product.id);
                            setEditingQuantityText(String(currentQty));
                          }}
                          className="p-2 rounded-lg bg-accent/10 hover:bg-accent/20 text-accent transition-colors"
                        >
                          <Pencil size={16} />
                        </button>
                      )}
                    </div>
                  </td>
                </motion.tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {showLogs && (
        <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4">
          <div className="w-full max-w-4xl bg-[#121217] border border-white/10 rounded-3xl p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-xl font-bold">库存变动日志</h3>
              <button type="button" onClick={() => setShowLogs(false)} className="px-3 py-1 rounded-lg bg-white/10">关闭</button>
            </div>
            <div className="max-h-[65vh] overflow-auto rounded-2xl border border-white/10">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-white/10 bg-white/[0.02]">
                    <th className="px-4 py-3 text-xs text-white/50">时间</th>
                    <th className="px-4 py-3 text-xs text-white/50">商品</th>
                    <th className="px-4 py-3 text-xs text-white/50">动作</th>
                    <th className="px-4 py-3 text-xs text-white/50 text-right">变动</th>
                    <th className="px-4 py-3 text-xs text-white/50 text-right">前后库存</th>
                    <th className="px-4 py-3 text-xs text-white/50">备注</th>
                  </tr>
                </thead>
                <tbody>
                  {inventoryLogs.map((log) => (
                    <tr key={log.id} className="border-b border-white/5">
                      <td className="px-4 py-3 text-xs text-white/70">{new Date(log.created_at).toLocaleString()}</td>
                      <td className="px-4 py-3 text-sm">{log.product_name || log.product_id}</td>
                      <td className="px-4 py-3 text-xs uppercase text-white/60">{log.action}</td>
                      <td className={`px-4 py-3 text-right font-bold ${log.delta_quantity >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                        {log.delta_quantity >= 0 ? '+' : ''}{log.delta_quantity}
                      </td>
                      <td className="px-4 py-3 text-right text-white/70">{log.before_quantity} → {log.after_quantity}</td>
                      <td className="px-4 py-3 text-xs text-white/60">{log.note || '-'}</td>
                    </tr>
                  ))}
                  {inventoryLogs.length === 0 && (
                    <tr>
                      <td colSpan={6} className="px-4 py-8 text-center text-white/40">暂无日志数据（请先执行一次库存变动）</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
