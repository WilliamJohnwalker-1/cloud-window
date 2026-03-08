import React, { useRef } from 'react';
import { TouchableOpacity, Animated, ViewStyle } from 'react-native';
import * as Haptics from 'expo-haptics';

interface AnimatedTouchableProps {
  children: React.ReactNode;
  onPress?: () => void;
  onLongPress?: () => void;
  style?: ViewStyle;
  disabled?: boolean;
  useHaptics?: boolean;
  scaleAmount?: number;
  activeOpacity?: number;
}

export default function AnimatedTouchable({
  children,
  onPress,
  onLongPress,
  style,
  disabled = false,
  useHaptics = false,
  scaleAmount = 0.95,
  activeOpacity,
}: AnimatedTouchableProps) {
  const scaleValue = useRef(new Animated.Value(1)).current;

  const handlePressIn = () => {
    if (useHaptics) {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
    Animated.spring(scaleValue, {
      toValue: scaleAmount,
      useNativeDriver: true,
      speed: 50,
      bounciness: 4,
    }).start();
  };

  const handlePressOut = () => {
    Animated.spring(scaleValue, {
      toValue: 1,
      useNativeDriver: true,
      speed: 50,
      bounciness: 4,
    }).start();
  };

  const animatedStyle = {
    transform: [{ scale: scaleValue }],
  };

  return (
    <TouchableOpacity
      onPress={onPress}
      onLongPress={onLongPress}
      onPressIn={handlePressIn}
      onPressOut={handlePressOut}
      disabled={disabled}
      activeOpacity={activeOpacity}
      style={[animatedStyle, style as ViewStyle]}
    >
      {children}
    </TouchableOpacity>
  );
}