/**
 * Global polyfills for exceljs in React Native.
 * Import this file early in the app (e.g., in App.tsx or index.ts)
 * to ensure Buffer and process are available before exceljs loads.
 */

import { Buffer } from 'buffer';
import process from 'process';

type NextTickCallback = (...args: unknown[]) => void;
type NextTickFn = (callback: NextTickCallback, ...args: unknown[]) => void;

// Polyfill global Buffer for React Native
if (typeof global.Buffer === 'undefined') {
  global.Buffer = Buffer;
}

// Polyfill global process for React Native
if (typeof global.process === 'undefined') {
  global.process = process;
}

// Polyfill global process.nextTick if missing
if (typeof global.process?.nextTick !== 'function') {
  const nextTickFallback: NextTickFn = (callback, ...args) => {
    const run = (): void => {
      callback(...args);
    };

    if (typeof global.setImmediate === 'function') {
      global.setImmediate(run);
      return;
    }

    setTimeout(run, 0);
  };

  (global.process as { nextTick?: NextTickFn }).nextTick = nextTickFallback;
}

export { Buffer, process };
