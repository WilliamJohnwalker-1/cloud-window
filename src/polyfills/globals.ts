/**
 * Global polyfills for exceljs in React Native.
 * Import this file early in the app (e.g., in App.tsx or index.ts)
 * to ensure Buffer and process are available before exceljs loads.
 */

import { Buffer } from 'buffer';
import process from 'process';

// Polyfill global Buffer for React Native
if (typeof global.Buffer === 'undefined') {
  global.Buffer = Buffer;
}

// Polyfill global process for React Native
if (typeof global.process === 'undefined') {
  global.process = process;
}

// Polyfill global process.nextTick if missing
if (typeof global.process?.nextTick === 'undefined') {
  (global.process as Record<string, unknown>).nextTick = (fn: () => void) => Promise.resolve().then(fn);
}

export { Buffer, process };