import React from 'react';
import { 
  Package, 
  Database, 
  ScanLine,
  ShoppingCart, 
  BarChart3, 
  User, 
  LogOut
} from 'lucide-react';
import { useAppStore } from '../store/useAppStore';
import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { parseEmojiAvatar } from '../utils/avatar';

interface SidebarProps {
  activeTab: string;
  setActiveTab: (tab: string) => void;
}

export const Sidebar: React.FC<SidebarProps> = ({ activeTab, setActiveTab }) => {
  const { user, signOut, notifications } = useAppStore();
  const unreadCount = notifications.filter((item) => !item.is_read).length;
  const selectedEmojiAvatar = parseEmojiAvatar(user?.avatar_url);

  const menuItems = [
    { id: 'products', label: '商品', icon: Package },
    { id: 'inventory', label: '库存', icon: Database, roles: ['admin', 'inventory_manager'] },
    { id: 'orders', label: '订单', icon: ShoppingCart },
    { id: 'payment', label: '收款台', icon: ScanLine, roles: ['admin', 'inventory_manager'] },
    { id: 'reports', label: '报表', icon: BarChart3, roles: ['admin'] },
    { id: 'profile', label: '我的', icon: User },
  ];

  const filteredItems = menuItems.filter(item => 
    !item.roles || (user && item.roles.includes(user.role))
  );

  return (
    <aside className="w-64 h-screen bg-background border-r border-white/10 flex flex-col fixed left-0 top-0 z-50">
      <div className="p-8">
        <h1 className="text-xl font-bold bg-tech-gradient bg-clip-text text-transparent">
          云窗文创
        </h1>
        <p className="text-xs text-white/40 mt-1 uppercase tracking-widest">Inventory System</p>
      </div>

      <nav className="flex-1 px-4 space-y-2">
        {filteredItems.map((item) => {
          const Icon = item.icon;
          const isActive = activeTab === item.id;
          
          return (
            <button
              type="button"
              key={item.id}
              onClick={() => setActiveTab(item.id)}
              className={twMerge(
                "w-full flex items-center space-x-3 px-4 py-3 rounded-xl transition-all duration-300 group",
                isActive 
                  ? "bg-tech-gradient text-white shadow-neon" 
                  : "text-white/60 hover:bg-white/5 hover:text-white"
              )}
            >
              <Icon size={20} className={clsx(
                "transition-transform duration-300 group-hover:scale-110",
                isActive ? "text-white" : "text-white/40 group-hover:text-white"
              )} />
              <span className="font-medium">{item.label}</span>
            </button>
          );
        })}
      </nav>

      <div className="p-4 border-t border-white/10 space-y-4">
        {user && (
          <div className="px-4 py-3 bg-white/5 rounded-xl flex items-center space-x-3">
            <div className="w-8 h-8 rounded-full bg-tech-gradient flex items-center justify-center text-xs font-bold overflow-hidden shadow-neon/40">
              {selectedEmojiAvatar ? (
                <div
                  className="w-full h-full flex items-center justify-center text-base"
                  style={{ backgroundColor: selectedEmojiAvatar.bgColor }}
                >
                  {selectedEmojiAvatar.emoji}
                </div>
              ) : user.avatar_url ? (
                <img src={user.avatar_url} alt="用户头像" className="w-full h-full object-cover" />
              ) : (
                user.email[0].toUpperCase()
              )}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium truncate">{user.store_name || user.email}</p>
              <p className="text-[10px] text-white/40 uppercase tracking-tighter">
                {user.role}
              </p>
            </div>
          </div>
        )}

        <button
          type="button"
          onClick={signOut}
          className="w-full flex items-center space-x-3 px-4 py-3 rounded-xl text-white/40 hover:bg-red-500/10 hover:text-red-500 transition-colors"
        >
          <LogOut size={20} />
          <span className="font-medium">退出登录</span>
        </button>
        {unreadCount > 0 && <p className="text-xs text-white/40 text-center">未读通知：{unreadCount}</p>}
      </div>
    </aside>
  );
};
