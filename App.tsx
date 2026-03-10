import React, { useEffect, useState } from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { Text, View, ActivityIndicator, StyleSheet, AppState } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Toast, { BaseToast, ErrorToast } from 'react-native-toast-message';
import type { ToastConfig } from 'react-native-toast-message';
import { BarChart2, Package, ShoppingCart, TrendingUp, User } from 'lucide-react-native';
import { useShallow } from 'zustand/react/shallow';
import * as Updates from 'expo-updates';

import LoginScreen from './src/screens/LoginScreen';
import ProductsScreen from './src/screens/ProductsScreen';
import InventoryScreen from './src/screens/InventoryScreen';
import OrdersScreen from './src/screens/OrdersScreen';
import ReportsScreen from './src/screens/ReportsScreen';
import ProfileScreen from './src/screens/ProfileScreen';
import { useAppStore } from './src/store/useAppStore';
import AppConfirmModal from './src/components/AppConfirmModal';
import { Colors, LightColors, DarkColors, Shadow } from './src/theme';
import { supabase, supabaseConfigError } from './src/lib/supabase';

const Tab = createBottomTabNavigator();

function TabIcon({ name, focused }: { name: string; focused: boolean }) {
  const isDarkMode = useAppStore((state) => state.isDarkMode);
  const theme = isDarkMode ? DarkColors : LightColors;

  const IconComponent = {
    Products: Package,
    Inventory: BarChart2,
    Orders: ShoppingCart,
    Reports: TrendingUp,
    Profile: User,
  }[name] || Package;

  return (
    <View style={styles.tabIconContainer}>
      <IconComponent 
        size={24} 
        color={focused ? theme.pink : theme.tabInactive} 
        strokeWidth={focused ? 2.5 : 2} 
      />
      {focused && <View style={[styles.tabIndicator, { backgroundColor: theme.pink }]} />}
    </View>
  );
}

function MainTabs() {
  const fetchAllData = useAppStore((state) => state.fetchAllData);
  const storedUser = useAppStore((state) => state.user);
  const isDarkMode = useAppStore((state) => state.isDarkMode);
  const theme = isDarkMode ? DarkColors : LightColors;

  useEffect(() => {
    if (storedUser) {
      fetchAllData();
    }
  }, [fetchAllData, storedUser]);

  return (
    <Tab.Navigator
      screenOptions={({ route }) => ({
        tabBarIcon: ({ focused }) => <TabIcon name={route.name} focused={focused} />,
        tabBarActiveTintColor: theme.pink,
        tabBarInactiveTintColor: theme.tabInactive,
        tabBarStyle: [styles.tabBar, { backgroundColor: theme.surface }],
        tabBarLabelStyle: styles.tabBarLabel,
        headerStyle: [styles.header, { backgroundColor: theme.surface }],
        headerTitleStyle: [styles.headerTitle, { color: theme.textPrimary }],
        headerShadowVisible: false,
      })}
    >

      <Tab.Screen 
        name="Products" 
        component={ProductsScreen}
        options={{ title: '商品' }}
      />
      <Tab.Screen 
        name="Inventory" 
        component={InventoryScreen}
        options={{ title: '库存' }}
      />
      <Tab.Screen 
        name="Orders" 
        component={OrdersScreen}
        options={{ title: '订单' }}
      />
      <Tab.Screen 
        name="Reports" 
        component={ReportsScreen}
        options={{ title: '报表' }}
      />
      <Tab.Screen 
        name="Profile" 
        component={ProfileScreen}
        options={{ title: '我的' }}
      />
    </Tab.Navigator>
  );
}

const toastConfig: ToastConfig = {
  success: ({ ...props }) => (
    <BaseToast
      {...props}
      style={{ borderLeftColor: Colors.success, borderLeftWidth: 6, backgroundColor: Colors.surface }}
      text1Style={{ color: Colors.textPrimary, fontSize: 15, fontWeight: '700' }}
      text2Style={{ color: Colors.textSecondary, fontSize: 13 }}
    />
  ),
  error: ({ ...props }) => (
    <ErrorToast
      {...props}
      style={{ borderLeftColor: Colors.danger, borderLeftWidth: 6, backgroundColor: Colors.surface }}
      text1Style={{ color: Colors.textPrimary, fontSize: 15, fontWeight: '700' }}
      text2Style={{ color: Colors.textSecondary, fontSize: 13 }}
    />
  ),
};

const toastAnimationConfig = {
  //
  // Automatically configure Toast message animations with a subtle spring bounce
  // for entrance and a smooth fade for exit, creating a playful yet professional feel.
  // This draws attention to the message without being jarring.
  //
  velocity: 1000, // Speed of the bounce
  tension: 68,     // Tension for bounciness (higher = more bounce)
  friction: 12,    // Friction to slow down (higher = slower)
};

export default function App() {
  const [isLoading, setIsLoading] = useState(true);
  const [launchUpdateVisible, setLaunchUpdateVisible] = useState(false);
  const { user, setUser, isDarkMode } = useAppStore(
    useShallow((state) => ({
      user: state.user,
      setUser: state.setUser,
      isDarkMode: state.isDarkMode,
    })),
  );
  const theme = isDarkMode ? DarkColors : LightColors;
  const ensureActiveSession = useAppStore((state) => state.ensureActiveSession);

  useEffect(() => {
    const initApp = async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();

        if (!session) {
          setUser(null);
          await AsyncStorage.removeItem('inventory-app-storage');
          return;
        }

        const sessionError = await ensureActiveSession();
        if (sessionError) {
          setUser(null);
          await AsyncStorage.removeItem('inventory-app-storage');
          return;
        }

        const storedData = await AsyncStorage.getItem('inventory-app-storage');
        if (storedData) {
          const parsed = JSON.parse(storedData);
          if (parsed && parsed.state && parsed.state.user) {
            setUser(parsed.state.user);
          }
        }
      } catch (error) {
        console.error('Error loading stored user:', error);
        try {
          await AsyncStorage.removeItem('inventory-app-storage');
        } catch (storageError) {
          console.warn('Failed clearing local storage after init error:', storageError);
        }
      } finally {
        setIsLoading(false);
      }
    };

    initApp();
  }, [setUser, ensureActiveSession]);

  useEffect(() => {
    const checkUpdatesOnLaunch = async (): Promise<void> => {
      if (__DEV__) return;

      try {
        const update = await Updates.checkForUpdateAsync();
        if (!update.isAvailable) return;

        await Updates.fetchUpdateAsync();
        setLaunchUpdateVisible(true);
      } catch (error) {
        console.warn('Failed checking OTA updates on launch:', error);
      }
    };

    if (!isLoading) {
      void checkUpdatesOnLaunch();
    }
  }, [isLoading]);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (nextState) => {
      if (nextState !== 'active') return;
      if (!user) return;
      const checkSession = async () => {
        const sessionError = await ensureActiveSession();
        if (sessionError && sessionError.message.includes('其他设备')) {
          Toast.show({ type: 'error', text1: '登录状态失效', text2: sessionError.message });
        }
      };
      void checkSession();
    });

    return () => {
      subscription.remove();
    };
  }, [ensureActiveSession, user]);

  useEffect(() => {
    if (!user) return;

    const timer = setInterval(() => {
      void ensureActiveSession();
    }, 15000);

    return () => {
      clearInterval(timer);
    };
  }, [ensureActiveSession, user]);

  useEffect(() => {
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_OUT') {
        setUser(null);
      }
    });

    return () => {
      subscription.unsubscribe();
    };
  }, [setUser]);

  if (isLoading) {
    return (
      <View style={[styles.loadingContainer, { backgroundColor: theme.background }]}>
        <ActivityIndicator size="large" color={theme.pink} />
        <Text style={[styles.loadingText, { color: theme.textSecondary }]}>加载中...</Text>
      </View>
    );
  }

  if (supabaseConfigError) {
    return (
      <View style={[styles.loadingContainer, { backgroundColor: theme.background }]}>
        <Text style={[styles.configErrorTitle, { color: theme.danger }]}>配置错误</Text>
        <Text style={[styles.configErrorText, { color: theme.textSecondary }]}>{supabaseConfigError}</Text>
      </View>
    );
  }


  return (
    <>
      <NavigationContainer>
        {user ? <MainTabs /> : <LoginScreen />}
      </NavigationContainer>
      <AppConfirmModal
        visible={launchUpdateVisible}
        isDarkMode={isDarkMode}
        title="发现新版本"
        message="更新已下载，是否立即重启应用完成更新？"
        confirmText="立即更新"
        cancelText="稍后"
        onCancel={() => setLaunchUpdateVisible(false)}
        onConfirm={() => {
          setLaunchUpdateVisible(false);
          void Updates.reloadAsync();
        }}
      />
      <Toast config={toastConfig} />
    </>
  );
}

const styles = StyleSheet.create({
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: Colors.background,
  },
  loadingText: {
    marginTop: 12,
    color: Colors.textSecondary,
    fontSize: 15,
  },
  configErrorTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: Colors.danger,
  },
  configErrorText: {
    marginTop: 12,
    paddingHorizontal: 24,
    color: Colors.textSecondary,
    fontSize: 14,
    lineHeight: 20,
    textAlign: 'center',
  },
  tabBar: {
    backgroundColor: Colors.surface,
    borderTopWidth: 0,
    paddingTop: 6,
    paddingBottom: 8,
    height: 65,
    ...Shadow.soft,
  },
  tabBarLabel: {
    fontSize: 11,
    fontWeight: '500',
    marginBottom: 4,
  },
  tabIconContainer: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  tabIndicator: {
    width: 5,
    height: 5,
    borderRadius: 2.5,
    backgroundColor: Colors.pink,
    marginTop: 2,
  },
  header: {
    backgroundColor: Colors.surface,
    shadowOpacity: 0,
    elevation: 0,
  },
  headerTitle: {
    fontWeight: '700',
    color: Colors.textPrimary,
    fontSize: 18,
  },
});
