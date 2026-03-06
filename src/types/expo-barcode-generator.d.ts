declare module 'expo-barcode-generator' {
  import type React from 'react';
  import type { StyleProp, ViewStyle } from 'react-native';

  export interface BarcodeOptions {
    format?: 'EAN13' | string;
    width?: number;
    height?: number;
    displayValue?: boolean;
  }

  export interface BarcodeProps {
    value: string;
    options?: BarcodeOptions;
    style?: StyleProp<ViewStyle>;
  }

  export const Barcode: React.ComponentType<BarcodeProps>;
}
