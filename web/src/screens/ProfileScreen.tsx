import React from 'react';
import { ArrowDown, ArrowUp, Bell, ChevronRight, LogOut, Mail, MapPin, Palette, Settings, Shield, Store, User } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { motion } from 'framer-motion';
import { useAppStore } from '../store/useAppStore';
import { avatarLibrary } from '../constants/avatarLibrary';
import { parseEmojiAvatar } from '../utils/avatar';
import webPackage from '../../package.json';

interface SectionItem {
  label: string;
  value?: string;
  color?: string;
  icon: LucideIcon;
  onClick?: () => void;
}

export const ProfileScreen: React.FC = () => {
  const { user, cities, signOut, updateOwnProfile, updateOwnAvatar, moveCityOrder } = useAppStore();
  const [showEditModal, setShowEditModal] = React.useState(false);
  const [showAvatarModal, setShowAvatarModal] = React.useState(false);
  const [fullName, setFullName] = React.useState(user?.full_name || '');
  const [storeName, setStoreName] = React.useState(user?.store_name || '');
  const [sortingCityId, setSortingCityId] = React.useState<string | null>(null);

  if (!user) return null;

  const selectedEmojiAvatar = parseEmojiAvatar(user.avatar_url);

  const handleSelectAvatar = async (avatarUrl: string): Promise<void> => {
    const { error } = await updateOwnAvatar(avatarUrl);
    if (error) {
      window.alert(`头像更新失败：${error.message}`);
      return;
    }
    setShowAvatarModal(false);
  };

  const sections: Array<{ title: string; items: SectionItem[] }> = [
    {
      title: '账户设置',
      items: [
        { label: '个人资料', icon: User, value: user.full_name || '未设置', onClick: () => setShowEditModal(true) },
        { label: '电子邮箱', icon: Mail, value: user.email },
        { label: '角色权限', icon: Shield, value: user.role === 'admin' ? '系统管理员' : '业务账号', color: 'text-accent' },
      ],
    },
    {
      title: '业务信息',
      items: [
        { label: '归属城市', icon: MapPin, value: user.city_name || '全城' },
        { label: '店面名称', icon: Store, value: user.store_name || '未设置', onClick: () => setShowEditModal(true) },
      ],
    },
    {
      title: '应用偏好',
      items: [
        { label: '通知设置', icon: Bell, value: '已开启' },
        { label: '主题外观', icon: Palette, value: '深色科技 (默认)' },
        { label: '通用设置', icon: Settings },
      ],
    },
  ];

  return (
    <div className="max-w-4xl space-y-8">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="bg-white/5 border border-white/10 rounded-[40px] p-8 flex items-center space-x-8"
      >
        <div className="flex flex-col items-center gap-3">
          <div className="w-24 h-24 rounded-full bg-tech-gradient flex items-center justify-center text-4xl font-black shadow-neon overflow-hidden">
            {selectedEmojiAvatar ? (
              <div
                className="w-full h-full flex items-center justify-center text-5xl"
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
          <button
            type="button"
            onClick={() => setShowAvatarModal(true)}
            className="px-3 py-1.5 rounded-xl bg-white/10 border border-white/10 text-xs font-bold hover:bg-white/20"
          >
            更换头像
          </button>
        </div>
        <div>
          <h2 className="text-3xl font-bold">{user.store_name || '欢迎使用系统'}</h2>
          <p className="text-white/40 mt-1">{user.email}</p>
          <div className="flex items-center space-x-2 mt-4">
            <span className="px-3 py-1 rounded-full bg-accent/10 border border-accent/20 text-accent text-[10px] font-black uppercase tracking-widest">{user.role}</span>
            <span className="px-3 py-1 rounded-full bg-white/5 border border-white/10 text-white/40 text-[10px] font-black uppercase tracking-widest">v{webPackage.version} Web</span>
          </div>
        </div>
      </motion.div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
        {sections.map((section, sectionIndex) => (
          <motion.div
            key={section.title}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: sectionIndex * 0.08 }}
            className="space-y-4"
          >
            <h3 className="text-xs font-bold text-white/20 uppercase tracking-[0.2em] ml-4">{section.title}</h3>
            <div className="bg-white/5 border border-white/10 rounded-[32px] overflow-hidden">
              {section.items.map((item: SectionItem) => {
                const Icon = item.icon;
                const valueClassName = item.color ?? 'text-white/40';
                return (
                  <button
                    type="button"
                    key={item.label}
                    onClick={item.onClick}
                    className="w-full flex items-center justify-between px-6 py-5 hover:bg-white/5 transition-colors border-b border-white/5 last:border-0 group"
                  >
                    <div className="flex items-center space-x-4">
                      <div className="w-10 h-10 rounded-xl bg-white/5 flex items-center justify-center group-hover:bg-accent/10 group-hover:text-accent transition-all">
                        <Icon size={18} />
                      </div>
                      <span className="text-sm font-medium text-white/60 group-hover:text-white transition-colors">{item.label}</span>
                    </div>
                    <div className="flex items-center space-x-3">
                      {item.value && <span className={`text-sm font-bold ${valueClassName}`}>{item.value}</span>}
                      <ChevronRight size={16} className="text-white/10 group-hover:text-white transition-colors" />
                    </div>
                  </button>
                );
              })}
            </div>
          </motion.div>
        ))}
      </div>

      {user.role === 'admin' && (
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="space-y-4"
        >
          <h3 className="text-xs font-bold text-white/20 uppercase tracking-[0.2em] ml-4">城市排序管理</h3>
          <div className="bg-white/5 border border-white/10 rounded-[32px] p-5 space-y-3">
            {cities.map((city, index) => {
              const isBusy = sortingCityId === city.id;
              const canMoveUp = index > 0;
              const canMoveDown = index < cities.length - 1;
              return (
                <div key={city.id} className="flex items-center justify-between bg-white/5 border border-white/10 rounded-2xl px-4 py-3">
                  <div>
                    <p className="font-semibold">{city.name}</p>
                    <p className="text-xs text-white/40">排序位置：{index + 1}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      disabled={!canMoveUp || isBusy}
                      onClick={async () => {
                        setSortingCityId(city.id);
                        const { error } = await moveCityOrder(city.id, 'up');
                        setSortingCityId(null);
                        if (error) window.alert(`上移失败：${error.message}`);
                      }}
                      className="px-3 py-1.5 rounded-xl border border-white/10 bg-white/5 text-sm font-bold text-white/70 hover:bg-white/10 disabled:opacity-40 disabled:cursor-not-allowed inline-flex items-center gap-1"
                    >
                      <ArrowUp size={14} />
                      <span>上移</span>
                    </button>
                    <button
                      type="button"
                      disabled={!canMoveDown || isBusy}
                      onClick={async () => {
                        setSortingCityId(city.id);
                        const { error } = await moveCityOrder(city.id, 'down');
                        setSortingCityId(null);
                        if (error) window.alert(`下移失败：${error.message}`);
                      }}
                      className="px-3 py-1.5 rounded-xl border border-white/10 bg-white/5 text-sm font-bold text-white/70 hover:bg-white/10 disabled:opacity-40 disabled:cursor-not-allowed inline-flex items-center gap-1"
                    >
                      <ArrowDown size={14} />
                      <span>下移</span>
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </motion.div>
      )}

      <div className="pt-8 flex justify-center">
        <button
          type="button"
          onClick={signOut}
          className="flex items-center space-x-2 px-8 py-4 rounded-2xl bg-red-500/10 border border-red-500/20 text-red-500 font-bold hover:bg-red-500 hover:text-white transition-all active:scale-95"
        >
          <LogOut size={20} />
          <span>注销控制台会话</span>
        </button>
      </div>

      {showEditModal && (
        <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4">
          <div className="w-full max-w-lg bg-[#121217] border border-white/10 rounded-3xl p-6 space-y-4">
            <h3 className="text-xl font-bold">编辑个人资料</h3>
            <div className="space-y-3">
              <label htmlFor="profile-full-name" className="block text-xs text-white/50">姓名</label>
              <input
                id="profile-full-name"
                value={fullName}
                onChange={(event) => setFullName(event.target.value)}
                className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2"
                placeholder="请输入姓名"
              />
              <label htmlFor="profile-store-name" className="block text-xs text-white/50">店面名称</label>
              <input
                id="profile-store-name"
                value={storeName}
                onChange={(event) => setStoreName(event.target.value)}
                className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2"
                placeholder="请输入店面名称"
              />
            </div>
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setShowEditModal(false)} className="px-4 py-2 rounded-xl bg-white/10">取消</button>
              <button
                type="button"
                onClick={async () => {
                  const { error } = await updateOwnProfile({ full_name: fullName, store_name: storeName });
                  if (error) {
                    window.alert(`保存失败：${error.message}`);
                    return;
                  }
                  window.alert('资料已更新');
                  setShowEditModal(false);
                }}
                className="px-4 py-2 rounded-xl bg-tech-gradient font-bold"
              >
                保存
              </button>
            </div>
          </div>
        </div>
      )}

      {showAvatarModal && (
        <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4">
          <div className="w-full max-w-xl bg-[#121217] border border-white/10 rounded-3xl p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-xl font-bold">选择头像</h3>
              <button type="button" onClick={() => setShowAvatarModal(false)} className="px-3 py-1.5 rounded-xl bg-white/10">关闭</button>
            </div>
            <p className="text-xs text-white/50">动物 · 水果 · 蔬菜</p>
            <div className="grid grid-cols-5 gap-3 max-h-[340px] overflow-auto pr-1">
              {avatarLibrary.map((item) => (
                <button
                  type="button"
                  key={item.id}
                  onClick={() => {
                    void handleSelectAvatar(item.value);
                  }}
                  className="flex items-center justify-center w-16 h-16 rounded-full border border-white/10 hover:scale-105 transition-transform"
                  style={{ backgroundColor: item.bgColor }}
                  title={item.label}
                >
                  <span className="text-3xl">{item.emoji}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
