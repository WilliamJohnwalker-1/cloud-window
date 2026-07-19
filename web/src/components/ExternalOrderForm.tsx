import React, { useMemo, useState } from 'react';

import { Plus, Trash2, X } from 'lucide-react';

import { useAppStore } from '../store/useAppStore';
import { EXTERNAL_CHANNEL_LABELS } from '../types';
import type { ExternalChannel } from '../types';

interface ExternalOrderFormProps {
  visible: boolean;
  onClose: () => void;
}

export const ExternalOrderForm: React.FC<ExternalOrderFormProps> = ({ visible, onClose }) => {
  const { products, stores, createExternalOrder } = useAppStore();
  const [channel, setChannel] = useState<ExternalChannel>('xiaohongshu');
  const [externalOrderNo, setExternalOrderNo] = useState('');
  const [selectedStoreId, setSelectedStoreId] = useState<string>('');
  const [searchKeyword, setSearchKeyword] = useState('');
  const [cart, setCart] = useState<Map<string, number>>(new Map());
  const [submitting, setSubmitting] = useState(false);
  const [notice, setNotice] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const activeStores = useMemo(
    () => stores.filter((store) => store.status === 'active').sort((a, b) => a.name.localeCompare(b.name, 'zh-CN')),
    [stores],
  );

  const filteredProducts = useMemo(() => {
    const keyword = searchKeyword.trim().toLowerCase();
    return products
      .filter((product) => {
        if (!keyword) return true;
        return product.name.toLowerCase().includes(keyword)
          || String(product.barcode || '').toLowerCase().includes(keyword)
          || String(product.city_name || '').toLowerCase().includes(keyword);
      })
      .sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'));
  }, [products, searchKeyword]);

  const cartEntries = useMemo(() => Array.from(cart.entries()), [cart]);

  const totalAmount = useMemo(() => cartEntries.reduce((sum, [productId, quantity]) => {
    const product = products.find((item) => item.id === productId);
    return sum + Number(product?.price || 0) * quantity;
  }, 0), [cartEntries, products]);

  const resetForm = (): void => {
    setChannel('xiaohongshu');
    setExternalOrderNo('');
    setSelectedStoreId('');
    setSearchKeyword('');
    setCart(new Map());
    setSubmitting(false);
    setNotice(null);
  };

  const closeForm = (): void => {
    if (submitting) return;
    resetForm();
    onClose();
  };

  const setItemQuantity = (productId: string, nextQuantity: number): void => {
    const normalized = Number.isFinite(nextQuantity) ? Math.max(0, Math.floor(nextQuantity)) : 0;
    setCart((prev) => {
      const next = new Map(prev);
      if (normalized <= 0) {
        next.delete(productId);
      } else {
        next.set(productId, normalized);
      }
      return next;
    });
  };

  const handleSubmit = async (): Promise<void> => {
    if (!externalOrderNo.trim()) {
      setNotice({ type: 'error', text: '请输入外部订单号' });
      return;
    }

    if (cart.size === 0) {
      setNotice({ type: 'error', text: '请至少添加一个商品' });
      return;
    }

    const items = cartEntries.map(([productId, quantity]) => ({
      productId,
      quantity,
    }));

    setSubmitting(true);
    const { error } = await createExternalOrder(items, channel, externalOrderNo.trim(), selectedStoreId || undefined);
    setSubmitting(false);

    if (error) {
      setNotice({ type: 'error', text: `外部订单创建失败：${error.message}` });
      return;
    }

    setNotice({ type: 'success', text: '外部订单已创建，等待确认签收' });
    window.setTimeout(() => {
      resetForm();
      onClose();
    }, 900);
  };

  if (!visible) return null;

  return (
    <div className="fixed inset-0 bg-black/70 z-[85] flex items-center justify-center p-4 overflow-y-auto">
      <div className="w-full max-w-6xl max-h-[calc(100vh-2rem)] overflow-y-auto bg-gray-900 border border-gray-700 rounded-3xl p-6 space-y-5 text-white shadow-2xl">
        {notice && (
          <div className={`rounded-2xl border px-4 py-3 text-sm ${notice.type === 'success' ? 'bg-emerald-500/20 border-emerald-400/40 text-emerald-100' : 'bg-red-500/20 border-red-400/40 text-red-100'}`}>
            <div className="flex items-start justify-between gap-3">
              <span>{notice.text}</span>
              <button
                type="button"
                onClick={() => setNotice(null)}
                className="text-current/80 hover:text-current"
              >
                <X size={14} />
              </button>
            </div>
          </div>
        )}

        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-xl font-bold text-white">录入外部订单</h3>
            <p className="text-sm text-white/50 mt-1">支持小红书 / 淘宝渠道，先录入待确认订单，再由管理员确认签收。</p>
          </div>
          <button
            type="button"
            onClick={closeForm}
            className="p-2 rounded-lg bg-gray-800 text-white/60 hover:text-white"
          >
            <X size={16} />
          </button>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <label className="space-y-2">
            <span className="text-sm text-white/60">渠道</span>
            <select
              value={channel}
              onChange={(event) => setChannel(event.target.value as ExternalChannel)}
              className="w-full bg-gray-800 border border-gray-700 rounded-xl px-4 py-3 text-white outline-none"
            >
              {Object.entries(EXTERNAL_CHANNEL_LABELS).map(([value, label]) => (
                <option key={value} value={value} className="bg-gray-900">
                  {label}
                </option>
              ))}
            </select>
          </label>

          <label className="space-y-2 lg:col-span-2">
            <span className="text-sm text-white/60">外部订单号</span>
            <input
              value={externalOrderNo}
              onChange={(event) => setExternalOrderNo(event.target.value)}
              placeholder="必填，例如 XHS-20260707-001"
              className="w-full bg-gray-800 border border-gray-700 rounded-xl px-4 py-3 text-white placeholder:text-white/30 outline-none"
            />
          </label>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <label className="space-y-2">
            <span className="text-sm text-white/60">关联店铺（可选）</span>
            <select
              value={selectedStoreId}
              onChange={(event) => setSelectedStoreId(event.target.value)}
              className="w-full bg-gray-800 border border-gray-700 rounded-xl px-4 py-3 text-white outline-none"
            >
              <option value="" className="bg-gray-900">-- 不指定，默认云窗 --</option>
              {activeStores.map((store) => (
                <option key={store.id} value={store.id} className="bg-gray-900">
                  {store.name} ({store.city_name || '未知城市'})
                </option>
              ))}
            </select>
          </label>

          <label className="space-y-2 lg:col-span-2">
            <span className="text-sm text-white/60">搜索商品</span>
            <input
              value={searchKeyword}
              onChange={(event) => setSearchKeyword(event.target.value)}
              placeholder="搜索商品名称 / 条码 / 城市"
              className="w-full bg-gray-800 border border-gray-700 rounded-xl px-4 py-3 text-white placeholder:text-white/30 outline-none"
            />
          </label>
        </div>

        <div className="grid grid-cols-1 xl:grid-cols-[1.2fr_0.8fr] gap-4">
          <div className="border border-gray-700 rounded-2xl overflow-hidden bg-gray-900/80">
            <div className="px-4 py-3 border-b border-gray-700 flex items-center justify-between bg-gray-800/70">
              <h4 className="font-semibold text-white">可选商品</h4>
              <span className="text-xs text-white/40">数量步长 1</span>
            </div>
            <div className="max-h-[440px] overflow-y-auto divide-y divide-gray-800">
              {filteredProducts.map((product) => {
                const quantity = cart.get(product.id) || 0;
                const retailPrice = Number(product.price || 0);
                return (
                  <div key={product.id} className="p-4 flex items-center justify-between gap-4">
                    <div className="min-w-0 flex-1">
                      <p className="font-semibold text-white truncate">{product.name}</p>
                      <p className="text-xs text-white/40">{product.city_name || '未知城市'} · 零售价 ¥{retailPrice.toFixed(2)}</p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {quantity > 0 ? (
                        <>
                          <button
                            type="button"
                            onClick={() => setItemQuantity(product.id, quantity - 1)}
                            className="px-3 py-1.5 rounded-lg bg-gray-800 text-white"
                          >
                            -1
                          </button>
                          <input
                            value={quantity > 0 ? String(quantity) : ''}
                            onChange={(event) => {
                              const value = Number(event.target.value.replace(/[^0-9]/g, ''));
                              if (Number.isNaN(value)) {
                                setItemQuantity(product.id, 0);
                                return;
                              }
                              setItemQuantity(product.id, value);
                            }}
                            placeholder="数量"
                            className="w-24 bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5 text-white text-center"
                          />
                          <button
                            type="button"
                            onClick={() => setItemQuantity(product.id, quantity + 1)}
                            className="px-3 py-1.5 rounded-lg bg-gray-800 text-white"
                          >
                            +1
                          </button>
                        </>
                      ) : (
                        <button
                          type="button"
                          onClick={() => setItemQuantity(product.id, 1)}
                          className="px-3 py-2 rounded-xl bg-tech-gradient font-semibold text-white inline-flex items-center gap-2"
                        >
                          <Plus size={14} />
                          <span>添加</span>
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
              {filteredProducts.length === 0 && (
                <p className="px-4 py-8 text-sm text-white/40 text-center">没有匹配的商品</p>
              )}
            </div>
          </div>

          <div className="border border-gray-700 rounded-2xl p-4 flex flex-col gap-4 bg-gray-900/80">
            <div>
              <h4 className="font-semibold text-white">已选商品</h4>
              <p className="text-xs text-white/40 mt-1">创建时按零售价汇总，签收时走外部订单专属确认链路。</p>
            </div>

            <div className="space-y-3 max-h-[360px] overflow-y-auto pr-1">
              {cartEntries.map(([productId, quantity]) => {
                const product = products.find((item) => item.id === productId);
                if (!product) return null;

                const retailPrice = Number(product.price || 0);
                const subtotal = retailPrice * quantity;

                return (
                  <div key={productId} className="rounded-2xl border border-gray-700 bg-gray-800/60 p-3 space-y-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="font-semibold text-white truncate">{product.name}</p>
                        <p className="text-xs text-white/40">零售价 ¥{retailPrice.toFixed(2)}</p>
                      </div>
                      <button
                        type="button"
                        onClick={() => setItemQuantity(productId, 0)}
                        className="text-red-200 hover:text-red-100"
                        title="移除商品"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>

                    <div className="grid grid-cols-3 gap-2 text-sm">
                      <label className="space-y-1 col-span-2">
                        <span className="text-xs text-white/50">数量</span>
                        <input
                          value={quantity > 0 ? String(quantity) : ''}
                          onChange={(event) => {
                            const value = Number(event.target.value.replace(/[^0-9]/g, ''));
                            if (Number.isNaN(value)) {
                              setItemQuantity(productId, 0);
                              return;
                            }
                            setItemQuantity(productId, value);
                          }}
                          className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white"
                        />
                      </label>
                      <div className="space-y-1">
                        <span className="text-xs text-white/50">小计</span>
                        <div className="h-[42px] rounded-lg border border-gray-700 bg-gray-800 px-3 flex items-center justify-end text-accent font-semibold">
                          ¥{subtotal.toFixed(2)}
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}

              {cart.size === 0 && (
                <div className="rounded-2xl border border-dashed border-gray-700 px-4 py-8 text-center text-sm text-white/40">
                  请从左侧添加商品
                </div>
              )}
            </div>

            <div className="mt-auto pt-4 border-t border-gray-700 space-y-2 text-sm">
              <div className="flex justify-between text-white/70">
                <span>商品件数</span>
                <span>{cartEntries.reduce((sum, [, quantity]) => sum + quantity, 0)}</span>
              </div>
              <div className="flex justify-between text-white font-semibold">
                <span>订单总额</span>
                <span className="text-accent text-lg">¥{totalAmount.toFixed(2)}</span>
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={closeForm}
                className="px-4 py-2 rounded-xl border border-gray-700 bg-gray-800 text-white/80"
              >
                取消
              </button>
              <button
                type="button"
                onClick={() => {
                  void handleSubmit();
                }}
                disabled={submitting}
                className="px-4 py-2 rounded-xl bg-tech-gradient text-white font-semibold disabled:opacity-60"
              >
                {submitting ? '提交中...' : '创建待确认外部订单'}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ExternalOrderForm;
