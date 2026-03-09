const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

// Workaround for package exports resolution that can pull ESM builds
// containing import.meta into non-module web bundles.
config.resolver.unstable_enablePackageExports = false;

module.exports = config;
