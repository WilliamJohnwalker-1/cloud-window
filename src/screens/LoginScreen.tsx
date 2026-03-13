import React, { useState } from 'react';
import {
  View,
  Text,
  Image,
  TextInput,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useShallow } from 'zustand/react/shallow';

import { useAppStore } from '../store/useAppStore';
import { Colors, Gradients, Shadow, Radius, LightColors, DarkColors } from '../theme';
import logoAvatar from '../../assets/ui/login-avatar.png';

export default function LoginScreen() {
  const [isLogin, setIsLogin] = useState(true);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [selectedCityId, setSelectedCityId] = useState('');
  const [storeName, setStoreName] = useState('');
  const { signIn, signUp, fetchCities, cities, isLoading } = useAppStore(
    useShallow((state) => ({
      signIn: state.signIn,
      signUp: state.signUp,
      fetchCities: state.fetchCities,
      cities: state.cities,
      isLoading: state.isLoading,
    })),
  );
  const isDarkMode = useAppStore((state) => state.isDarkMode);
  const theme = isDarkMode ? DarkColors : LightColors;

  React.useEffect(() => {
    fetchCities();
  }, [fetchCities]);

  const handleAuth = async () => {
    if (!email || !password) {
      alert('Please fill in all fields');
      return;
    }

    if (!isLogin && password !== confirmPassword) {
      alert('Passwords do not match');
      return;
    }

    if (isLogin) {
      const { error } = await signIn(email, password);
      if (error) {
        alert(error.message);
      }
    } else {
      if (!selectedCityId) {
        alert('请选择归属城市');
        return;
      }
      if (!storeName.trim()) {
        alert('请输入店面名称');
        return;
      }

      const { error } = await signUp(email, password, 'distributor', selectedCityId, storeName.trim());
      if (error) {
        alert(error.message);
      } else {
        alert('注册成功！请检查邮箱验证或直接登录。');
        setIsLogin(true);
      }
    }
  };

  return (
    <LinearGradient
      colors={[Colors.gradientStart, Colors.gradientMid, Colors.gradientEnd]}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={styles.gradient}
    >
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.container}
      >
        <View style={styles.content}>
          <View style={styles.logoContainer}>
            <View style={styles.logoCircle}>
              <Image source={logoAvatar} style={styles.logoImage} resizeMode="contain" />
            </View>
            <Text style={styles.title}>云窗文创</Text>
            <Text style={styles.subtitle}>供销管理系统</Text>
          </View>

          <View style={[styles.form, { backgroundColor: isDarkMode ? 'rgba(37,37,66,0.96)' : 'rgba(255,255,255,0.95)' }] }>
            <TextInput
              style={[styles.input, { backgroundColor: theme.surfaceSecondary, color: theme.textPrimary }]}
              placeholder="邮箱"
              value={email}
              onChangeText={setEmail}
              keyboardType="email-address"
              autoCapitalize="none"
              placeholderTextColor={theme.textTertiary}
            />
            
            <TextInput
              style={[styles.input, { backgroundColor: theme.surfaceSecondary, color: theme.textPrimary }]}
              placeholder="密码"
              value={password}
              onChangeText={setPassword}
              secureTextEntry
              placeholderTextColor={theme.textTertiary}
            />
            
            {!isLogin && (
              <>
                <TextInput
                  style={[styles.input, { backgroundColor: theme.surfaceSecondary, color: theme.textPrimary }]}
                  placeholder="确认密码"
                  value={confirmPassword}
                  onChangeText={setConfirmPassword}
                  secureTextEntry
                  placeholderTextColor={theme.textTertiary}
                />
                <TextInput
                  style={[styles.input, { backgroundColor: theme.surfaceSecondary, color: theme.textPrimary }]}
                  placeholder="店面名称"
                  value={storeName}
                  onChangeText={setStoreName}
                  placeholderTextColor={theme.textTertiary}
                />

                <Text style={[styles.sectionLabel, { color: theme.textSecondary }]}>归属城市</Text>
                {cities.length === 0 ? (
                  <Text style={styles.emptyCityText}>暂无可选城市，请联系管理员先创建城市</Text>
                ) : (
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.cityScroll}>
                    {cities.map((city) => (
                      <TouchableOpacity
                        key={city.id}
                        style={[styles.cityChip, { backgroundColor: theme.surfaceSecondary }, selectedCityId === city.id && styles.cityChipActive]}
                        onPress={() => setSelectedCityId(city.id)}
                      >
                        <Text style={[styles.cityChipText, { color: theme.textSecondary }, selectedCityId === city.id && styles.cityChipTextActive]}>
                          {city.name}
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </ScrollView>
                )}
              </>
            )}

            <TouchableOpacity
              style={[styles.buttonWrap, isLoading && styles.buttonDisabled]}
              onPress={handleAuth}
              disabled={isLoading}
              activeOpacity={0.85}
            >
              <LinearGradient
                colors={Gradients.primary}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 0 }}
                style={styles.button}
              >
                {isLoading ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Text style={styles.buttonText}>
                    {isLogin ? '登录' : '注册'}
                  </Text>
                )}
              </LinearGradient>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.switchButton}
              onPress={() => setIsLogin(!isLogin)}
            >
              <Text style={[styles.switchText, { color: theme.pink }]}>
                {isLogin ? '没有账号？点击注册' : '已有账号？点击登录'}
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </KeyboardAvoidingView>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  gradient: {
    flex: 1,
  },
  container: {
    flex: 1,
  },
  content: {
    flex: 1,
    justifyContent: 'center',
    padding: 24,
  },
  logoContainer: {
    alignItems: 'center',
    marginBottom: 36,
  },
  logoCircle: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: 'rgba(255,255,255,0.25)',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 16,
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.4)',
  },
  logoImage: {
    width: 68,
    height: 68,
  },
  title: {
    fontSize: 32,
    fontWeight: '800',
    color: '#FFFFFF',
    marginBottom: 6,
    letterSpacing: 4,
  },
  subtitle: {
    fontSize: 14,
    color: 'rgba(255,255,255,0.75)',
    fontWeight: '500',
    letterSpacing: 6,
  },
  form: {
    backgroundColor: 'rgba(255,255,255,0.95)',
    borderRadius: Radius.xxl,
    padding: 28,
    ...Shadow.elevated,
  },
  input: {
    height: 52,
    borderWidth: 0,
    borderRadius: Radius.lg,
    paddingHorizontal: 18,
    marginBottom: 14,
    fontSize: 16,
    backgroundColor: Colors.surfaceSecondary,
    color: Colors.textPrimary,
    paddingVertical: 0,
    includeFontPadding: false,
    textAlignVertical: 'center',
  },
  sectionLabel: {
    fontSize: 13,
    color: Colors.textSecondary,
    marginTop: 2,
    marginBottom: 8,
    fontWeight: '600',
  },
  cityScroll: {
    marginBottom: 10,
  },
  cityChip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 18,
    backgroundColor: Colors.surfaceSecondary,
    marginRight: 8,
  },
  cityChipActive: {
    backgroundColor: Colors.pink,
  },
  cityChipText: {
    color: Colors.textSecondary,
    fontSize: 13,
  },
  cityChipTextActive: {
    color: '#fff',
    fontWeight: '600',
  },
  emptyCityText: {
    color: Colors.danger,
    fontSize: 12,
    marginBottom: 10,
  },
  buttonWrap: {
    borderRadius: 26,
    overflow: 'hidden',
    marginTop: 8,
  },
  button: {
    height: 52,
    borderRadius: 26,
    justifyContent: 'center',
    alignItems: 'center',
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  buttonText: {
    color: '#fff',
    fontSize: 17,
    fontWeight: '600',
  },
  switchButton: {
    marginTop: 22,
    alignItems: 'center',
  },
  switchText: {
    color: Colors.pink,
    fontSize: 14,
    fontWeight: '500',
  },
});
