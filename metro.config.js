const {getDefaultConfig, mergeConfig} = require('@react-native/metro-config');

/**
 * Metro configuration
 * https://reactnative.dev/docs/metro
 *
 * @type {import('@react-native/metro-config').MetroConfig}
 */
const defaultConfig = getDefaultConfig(__dirname);

// Keep Metro out of native build outputs (android/app/build had grown huge).
const existingBlockList = defaultConfig.resolver.blockList;
const existingBlockArr = Array.isArray(existingBlockList)
  ? existingBlockList
  : existingBlockList
  ? [existingBlockList]
  : [];

const config = {
  resolver: {
    // watchman on this machine hangs while crawling the project, which makes
    // `createBundleReleaseJsAndAssets` stall at 0% forever. Metro's built-in
    // node crawler handles these exact files in ~35s, and a release bundle is
    // a one-shot build that never needs a file watcher. So bypass watchman.
    useWatchman: false,
    blockList: [
      ...existingBlockArr,
      /.*\/android\/build\/.*/,
      /.*\/android\/app\/build\/.*/,
      /.*\/android\/\.gradle\/.*/,
      /.*\/ios\/build\/.*/,
      /.*\/ios\/Pods\/.*/,
    ],
  },
};

module.exports = mergeConfig(defaultConfig, config);
