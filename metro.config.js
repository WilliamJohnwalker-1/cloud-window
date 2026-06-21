/* eslint-env node */

const { getDefaultConfig } = require('expo/metro-config');

// Polyfill modules for exceljs (Node.js built-ins not available in React Native)
const { Buffer } = require('buffer');

const config = getDefaultConfig(__dirname);

// Workaround for package exports resolution that can pull ESM builds
// containing import.meta into non-module web bundles.
config.resolver.unstable_enablePackageExports = false;

// Polyfill Node.js built-in modules required by exceljs
config.resolver.extraNodeModules = {
  stream: require.resolve('readable-stream'),
  buffer: require.resolve('buffer/'),
  fs: require.resolve('./src/polyfills/fs-stub.js'),
  zlib: require.resolve('./src/polyfills/zlib-stub.js'),
  events: require.resolve('events/'),
};

// Provide global Buffer for React Native
if (typeof global.Buffer === 'undefined') {
  global.Buffer = Buffer;
}

module.exports = config;
