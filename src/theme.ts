/**
 * 粉蓝年轻化设计系统
 * Pink-Blue Youthful Design System
 */

// ─── 主色调 ───
export const Colors = {
  // 核心粉蓝渐变
  pink: '#FF6B9D',
  pinkLight: '#FF8FB1',
  pinkSoft: '#FFD6E5',
  pinkBg: '#FFF0F5',

  blue: '#5B8DEF',
  blueLight: '#7EB6FF',
  blueSoft: '#D6E4FF',
  blueBg: '#F0F4FF',

  // 渐变色对
  gradientStart: '#FF6B9D',   // pink
  gradientEnd: '#5B8DEF',     // blue
  gradientMid: '#C77DFF',     // purple (中间过渡)

  // 背景
  background: '#F8F5FF',      // 淡紫调背景
  surface: '#FFFFFF',
  surfaceSecondary: '#F5F0FF', // 浅紫卡片背景

  // 文字
  textPrimary: '#2D2D3F',
  textSecondary: '#8E8EA0',
  textTertiary: '#B8B8CC',
  textOnGradient: '#FFFFFF',

  // 功能色
  success: '#4ECDC4',         // 清新薄荷绿
  successBg: '#E0F7F5',
  warning: '#FFB347',         // 暖橙
  warningBg: '#FFF3E0',
  danger: '#FF6B6B',          // 柔红
  dangerBg: '#FFE5E5',
  info: '#6C9FFF',            // 淡蓝
  infoBg: '#E8F0FF',

  // 边框/分割
  border: '#EDE8F5',
  borderLight: '#F5F0FF',
  divider: '#F0ECF7',

  // 阴影
  shadowPink: 'rgba(255, 107, 157, 0.15)',
  shadowBlue: 'rgba(91, 141, 239, 0.15)',
  shadowNeutral: 'rgba(45, 45, 63, 0.08)',

  // Tab bar
  tabActive: '#FF6B9D',
  tabInactive: '#B8B8CC',
} as const;

// ─── 间距 ───
export const Spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 24,
  xxxl: 32,
} as const;

// ─── 圆角 ───
export const Radius = {
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 25,
  pill: 50,
  circle: 9999,
} as const;

// ─── 字体 ───
export const Typography = {
  h1: { fontSize: 28, fontWeight: '700' as const, color: Colors.textPrimary },
  h2: { fontSize: 22, fontWeight: '700' as const, color: Colors.textPrimary },
  h3: { fontSize: 18, fontWeight: '600' as const, color: Colors.textPrimary },
  body: { fontSize: 15, fontWeight: '400' as const, color: Colors.textPrimary },
  bodyBold: { fontSize: 15, fontWeight: '600' as const, color: Colors.textPrimary },
  caption: { fontSize: 12, fontWeight: '400' as const, color: Colors.textSecondary },
  small: { fontSize: 11, fontWeight: '400' as const, color: Colors.textTertiary },
} as const;

// ─── 阴影 ───
export const Shadow = {
  card: {
    shadowColor: Colors.shadowPink,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 1,
    shadowRadius: 12,
    elevation: 4,
  },
  cardBlue: {
    shadowColor: Colors.shadowBlue,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 1,
    shadowRadius: 12,
    elevation: 4,
  },
  soft: {
    shadowColor: Colors.shadowNeutral,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 1,
    shadowRadius: 8,
    elevation: 2,
  },
  elevated: {
    shadowColor: Colors.shadowPink,
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 1,
    shadowRadius: 20,
    elevation: 8,
  },
} as const;

// ─── 渐变预设 ───
export const Gradients = {
  primary: [Colors.gradientStart, Colors.gradientEnd] as readonly [string, string],
  pinkOnly: [Colors.pink, Colors.pinkLight] as readonly [string, string],
  blueOnly: [Colors.blue, Colors.blueLight] as readonly [string, string],
  warm: [Colors.pink, Colors.gradientMid] as readonly [string, string],
  cool: [Colors.gradientMid, Colors.blue] as readonly [string, string],
  subtle: ['#FFE5EE', '#E5EEFF'] as readonly [string, string],
} as const;
