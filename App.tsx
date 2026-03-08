import React, { useEffect, useState } from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { Text, View, ActivityIndicator, StyleSheet } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Toast, { BaseToast, ErrorToast } from 'react-native-toast-message';
import type { ToastConfig } from 'react-native-toast-message';
import { BarChart2, Package, ShoppingCart, TrendingUp, User } from 'lucide-react-native';
import { useShallow } from 'zustand/react/shallow';

import LoginScreen from './src/screens/LoginScreen';
import ProductsScreen from './src/screens/ProductsScreen';
import InventoryScreen from './src/screens/InventoryScreen';
import OrdersScreen from './src/screens/OrdersScreen';
import ReportsScreen from './src/screens/ReportsScreen';
import ProfileScreen from './src/screens/ProfileScreen';
import { useAppStore } from './src/store/useAppStore';
import { Colors, Shadow } from './src/theme';
import { supabase } from './src/lib/supabase';

const Tab = createBottomTabNavigator();

function TabIcon({ name, focused }: { name: string; focused: boolean }) {
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
        color={focused ? Colors.pink : Colors.tabInactive} 
        strokeWidth={focused ? 2.5 : 2} 
      />
      {focused && <View style={styles.tabIndicator} />}
    </View>
  );
}

function MainTabs() {
  const fetchAllData = useAppStore((state) => state.fetchAllData);
  const storedUser = useAppStore((state) => state.user);

  useEffect(() => {
    if (storedUser) {
      fetchAllData();
    }
  }, [storedUser]);

  return (
    <Tab.Navigator
      screenOptions={({ route }) => ({
        tabBarIcon: ({ focused }) => <TabIcon name={route.name} focused={focused} />,
        tabBarActiveTintColor: Colors.pink,
        tabBarInactiveTintColor: Colors.tabInactive,
        tabBarStyle: styles.tabBar,
        tabBarLabelStyle: styles.tabBarLabel,
        headerStyle: styles.header,
        headerTitleStyle: styles.headerTitle,
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
  success: ({ props }) => (
    <BaseToast {...props} style={{ borderLeftColor: Colors.success, borderLeftWidth: 6, backgroundColor: Colors.surface }} />
  ),
  error: ({ props }) => (
    <ErrorToast {...props} style={{ borderLeftColor: Colors.danger, borderLeftWidth: 6, backgroundColor: Colors.surface }} />
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
  const { user, setUser } = useAppStore(
    useShallow((state) => ({
      user: state.user,
      setUser: state.setUser,
    })),
  );

  useEffect(() => {
    const initApp = async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();

        if (!session) {
          setUser(null);
          await AsyncStorage.removeItem('inventory-app-storage');
          return;
        }

        const storedUser = await AsyncStorage.getItem('inventory-app-storage');
        if (storedUser) {
          const parsed = JSON.parse(storedUser);
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
  }, []);

  if (isLoading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color={Colors.pink} />
        <Text style={styles.loadingText}>加载中...</Text>
      </View>
    );
  }

  return (
    <>
      <NavigationContainer>
        {user ? <MainTabs /> : <LoginScreen />}
      </NavigationContainer>
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
