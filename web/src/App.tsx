import React, { useEffect, useState } from 'react';
import { useAppStore } from './store/useAppStore';
import { Sidebar } from './components/Sidebar';
import { LoginScreen } from './screens/LoginScreen';
import { ProductsScreen } from './screens/ProductsScreen';
import { InventoryScreen } from './screens/InventoryScreen';
import { OrdersScreen } from './screens/OrdersScreen';
import { ReportsScreen } from './screens/ReportsScreen';
import { ProfileScreen } from './screens/ProfileScreen';
import { Bell, Search } from 'lucide-react';

function App() {
  const { user, fetchAllData, isLoading, markAllNotificationsRead, notifications } = useAppStore();
  const [activeTab, setActiveTab] = useState('products');

  useEffect(() => {
    if (user) {
      fetchAllData();
    }
  }, [fetchAllData, user]);

  if (!user) {
    return <LoginScreen />;
  }

  const renderContent = () => {
    switch (activeTab) {
      case 'products': return <ProductsScreen />;
      case 'inventory': return <InventoryScreen />;
      case 'orders': return <OrdersScreen />;
      case 'reports': return <ReportsScreen />;
      case 'profile': return <ProfileScreen />;
      default: return <ProductsScreen />;
    }
  };

  const getTitle = () => {
    switch (activeTab) {
      case 'products': return '商品管理';
      case 'inventory': return '库存管理';
      case 'orders': return '订单中心';
      case 'reports': return '数据报表';
      case 'profile': return '个人中心';
      default: return '云窗文创';
    }
  };

  return (
    <div className="min-h-screen bg-background text-white flex">
      <Sidebar activeTab={activeTab} setActiveTab={setActiveTab} />
      
      <main className="flex-1 ml-64 p-8">
        <header className="flex items-center justify-between mb-8">
          <div>
            <h2 className="text-3xl font-bold tracking-tight">{getTitle()}</h2>
            <p className="text-white/40 text-sm mt-1">
              欢迎回来, <span className="text-white/80">{user.email}</span>
            </p>
          </div>

          <div className="flex items-center space-x-6">
            <div className="relative group">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-white/20 group-focus-within:text-accent transition-colors" size={18} />
              <input 
                type="text" 
                placeholder="搜索内容..." 
                className="bg-white/5 border border-white/10 rounded-full pl-10 pr-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent/50 focus:border-accent transition-all w-64"
              />
            </div>
            
            <button
              type="button"
              onClick={markAllNotificationsRead}
              className="relative p-2 rounded-full hover:bg-white/5 transition-colors"
            >
              <Bell size={20} className="text-white/60" />
              {notifications.some((item) => !item.is_read) && <span className="absolute top-1 right-1 w-2 h-2 bg-red-500 rounded-full" />}
            </button>
          </div>
        </header>

        <div className="relative">
          {isLoading && (
            <div className="absolute inset-0 bg-background/50 backdrop-blur-sm z-10 flex items-center justify-center rounded-2xl">
              <div className="w-10 h-10 border-4 border-accent border-t-transparent rounded-full animate-spin"></div>
            </div>
          )}
          {renderContent()}
        </div>
      </main>
    </div>
  );
}

export default App;
