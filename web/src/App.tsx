import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Bell, Search } from 'lucide-react';
import { Sidebar } from './components/Sidebar';
import { InventoryScreen } from './screens/InventoryScreen';
import { LoginScreen } from './screens/LoginScreen';
import { OrdersScreen } from './screens/OrdersScreen';
import { PaymentScreen } from './screens/PaymentScreen';
import { ProductsScreen } from './screens/ProductsScreen';
import { ProfileScreen } from './screens/ProfileScreen';
import { ReportsScreen } from './screens/ReportsScreen';
import { useAppStore } from './store/useAppStore';

type TabKey = 'products' | 'inventory' | 'orders' | 'payment' | 'reports' | 'profile';

interface SearchResultItem {
  id: string;
  title: string;
  subtitle: string;
  tab: TabKey;
}

function App() {
  const {
    user,
    fetchAllData,
    ensureActiveSession,
    signOut,
    isLoading,
    markAllNotificationsRead,
    markNotificationRead,
    notifications,
    products,
    orders,
  } = useAppStore();

  const [activeTab, setActiveTab] = useState<TabKey>('products');
  const [searchKeyword, setSearchKeyword] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);
  const notifRef = useRef<HTMLDivElement | null>(null);
  const searchRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (user) {
      void fetchAllData();
    }
  }, [fetchAllData, user]);

  useEffect(() => {
    if (!user) return;

    const validateSession = async () => {
      const sessionError = await ensureActiveSession();
      if (sessionError) {
        await signOut();
      }
    };

    const onFocus = () => {
      void validateSession();
    };
    const onVisibility = () => {
      if (document.visibilityState === 'visible') {
        void validateSession();
      }
    };

    const timer = window.setInterval(() => {
      void validateSession();
    }, 10000);

    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      window.clearInterval(timer);
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [ensureActiveSession, signOut, user]);

  useEffect(() => {
    const onClickOutside = (event: MouseEvent): void => {
      const targetNode = event.target as Node;
      if (notifRef.current && !notifRef.current.contains(targetNode)) {
        setNotifOpen(false);
      }
      if (searchRef.current && !searchRef.current.contains(targetNode)) {
        setSearchOpen(false);
      }
    };
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, []);

  const unreadNotifications = useMemo(() => notifications.filter((item) => !item.is_read), [notifications]);

  const searchResults = useMemo<SearchResultItem[]>(() => {
    const keyword = searchKeyword.trim().toLowerCase();
    if (!keyword) return [];

    const productResults: SearchResultItem[] = products
      .filter((item) => [item.name, item.city_name || '', item.barcode || ''].join(' ').toLowerCase().includes(keyword))
      .slice(0, 5)
      .map((item) => ({
        id: `product-${item.id}`,
        title: item.name,
        subtitle: `商品 · ${item.city_name || '未知城市'} · 库存 ${item.quantity || 0}`,
        tab: 'products',
      }));

    const orderResults: SearchResultItem[] = orders
      .filter((item) => {
        const haystack = [
          item.id,
          item.distributor_store || '',
          item.distributor_email || '',
          item.city_name || '',
          item.status,
        ]
          .join(' ')
          .toLowerCase();
        return haystack.includes(keyword);
      })
      .slice(0, 5)
      .map((item) => ({
        id: `order-${item.id}`,
        title: `订单 #${item.id.slice(0, 8)}`,
        subtitle: `订单 · ${item.status} · ${item.distributor_store || item.distributor_email || '未知客户'}`,
        tab: 'orders',
      }));

    const inventoryResults: SearchResultItem[] = products
      .filter((item) => item.quantity !== undefined)
      .filter((item) => [item.name, item.barcode || ''].join(' ').toLowerCase().includes(keyword))
      .slice(0, 5)
      .map((item) => ({
        id: `inventory-${item.id}`,
        title: item.name,
        subtitle: `库存 · 当前 ${item.quantity || 0} · 预警 ${item.min_quantity || 10}`,
        tab: 'inventory',
      }));

    return [...productResults, ...orderResults, ...inventoryResults].slice(0, 10);
  }, [orders, products, searchKeyword]);

  if (!user) {
    return <LoginScreen />;
  }

  const renderContent = (): React.ReactNode => {
    switch (activeTab) {
      case 'products':
        return <ProductsScreen />;
      case 'inventory':
        return <InventoryScreen />;
      case 'orders':
        return <OrdersScreen />;
      case 'payment':
        return <PaymentScreen />;
      case 'reports':
        return <ReportsScreen />;
      case 'profile':
        return <ProfileScreen />;
      default:
        return <ProductsScreen />;
    }
  };

  const getTitle = (): string => {
    switch (activeTab) {
      case 'products':
        return '商品管理';
      case 'inventory':
        return '库存管理';
      case 'orders':
        return '订单中心';
      case 'payment':
        return '扫码收款台';
      case 'reports':
        return '数据报表';
      case 'profile':
        return '个人中心';
      default:
        return '云窗文创';
    }
  };

  return (
    <div className="min-h-screen bg-background text-white flex">
      <Sidebar activeTab={activeTab} setActiveTab={(tab) => setActiveTab(tab as TabKey)} />

      <main className="flex-1 ml-64 p-8">
        <header className="flex items-center justify-between mb-8">
          <div>
            <h2 className="text-3xl font-bold tracking-tight">{getTitle()}</h2>
            <p className="text-white/40 text-sm mt-1">
              欢迎回来, <span className="text-white/80">{user.email}</span>
            </p>
          </div>

          <div className="flex items-center space-x-6">
            <div ref={searchRef} className="relative group">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-white/20 group-focus-within:text-accent transition-colors" size={18} />
              <input
                type="text"
                value={searchKeyword}
                onFocus={() => setSearchOpen(true)}
                onChange={(event) => {
                  setSearchKeyword(event.target.value);
                  setSearchOpen(true);
                }}
                placeholder="搜索商品 / 订单 / 库存..."
                className="bg-white/5 border border-white/10 rounded-full pl-10 pr-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent/50 focus:border-accent transition-all w-72"
              />

              {searchOpen && searchKeyword.trim().length > 0 && (
                <div className="absolute right-0 mt-2 w-[420px] bg-[#111117] border border-white/10 rounded-2xl shadow-2xl overflow-hidden z-50">
                  <div className="px-4 py-2 text-xs text-white/50 border-b border-white/10">搜索结果</div>
                  {searchResults.length === 0 && <p className="px-4 py-4 text-sm text-white/40">未找到匹配内容</p>}
                  {searchResults.map((result) => (
                    <button
                      type="button"
                      key={result.id}
                      onClick={() => {
                        setActiveTab(result.tab);
                        setSearchOpen(false);
                      }}
                      className="w-full px-4 py-3 text-left hover:bg-white/5 border-b border-white/5 last:border-b-0"
                    >
                      <p className="text-sm font-medium">{result.title}</p>
                      <p className="text-xs text-white/50 mt-1">{result.subtitle}</p>
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div ref={notifRef} className="relative">
              <button
                type="button"
                onClick={() => setNotifOpen((prev) => !prev)}
                className="relative p-2 rounded-full hover:bg-white/5 transition-colors"
              >
                <Bell size={20} className="text-white/60" />
                {unreadNotifications.length > 0 && <span className="absolute top-1 right-1 w-2 h-2 bg-red-500 rounded-full" />}
              </button>

              {notifOpen && (
                <div className="absolute right-0 mt-2 w-[360px] bg-[#111117] border border-white/10 rounded-2xl shadow-2xl overflow-hidden z-50">
                  <div className="px-4 py-3 border-b border-white/10 flex items-center justify-between">
                    <p className="text-sm font-semibold">通知</p>
                    <button
                      type="button"
                      onClick={markAllNotificationsRead}
                      className="text-xs text-accent hover:underline"
                    >
                      全部已读
                    </button>
                  </div>

                  <div className="max-h-[360px] overflow-auto">
                    {notifications.length === 0 && <p className="px-4 py-5 text-sm text-white/40">暂无通知</p>}

                    {notifications.map((item) => (
                      <div key={item.id} className="px-4 py-3 border-b border-white/5 last:border-b-0">
                        <button
                          type="button"
                          onClick={() => {
                            setActiveTab('orders');
                            setNotifOpen(false);
                          }}
                          className="w-full text-left"
                        >
                          <p className={`text-sm ${item.is_read ? 'text-white/60' : 'text-white'}`}>{item.message}</p>
                          <p className="text-xs text-white/40 mt-1">{new Date(item.created_at).toLocaleString()}</p>
                        </button>
                        {!item.is_read && (
                          <button
                            type="button"
                            onClick={async () => {
                              await markNotificationRead(item.id);
                            }}
                            className="text-xs text-accent mt-2 hover:underline"
                          >
                            标记已读
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        </header>

        <div className="relative">
          {isLoading && (
            <div className="absolute inset-0 bg-background/50 backdrop-blur-sm z-10 flex items-center justify-center rounded-2xl">
              <div className="w-10 h-10 border-4 border-accent border-t-transparent rounded-full animate-spin" />
            </div>
          )}
          {renderContent()}
        </div>
      </main>
    </div>
  );
}

export default App;
