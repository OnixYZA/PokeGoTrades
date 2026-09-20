const path = require('path');
const { getDefaultConfig } = require('expo/metro-config');
const { withNativeWind } = require('nativewind/metro');

const config = getDefaultConfig(__dirname);

// `workers/` holds separate Node workspaces (the OCR worker, SUPABASE_PLAN.md §5.3) with their own manifests and
// node_modules. The app never imports them, so keep Metro from crawling, watching or bundling any of it.
const workersDir = path.join(__dirname, 'workers').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
config.resolver.blockList = [].concat(config.resolver.blockList ?? [], new RegExp(`^${workersDir}[\\\\/]`));

// expo-sqlite on web uses a WebAssembly-backed web worker that needs .wasm as an asset extension
// and cross-origin isolation headers for SharedArrayBuffer support.
config.resolver.assetExts = [...(config.resolver.assetExts ?? []), 'wasm'];

config.server.enhanceMiddleware = (middleware) => {
  return (req, res, next) => {
    // Required for SharedArrayBuffer (used by expo-sqlite's OPFS-backed web worker)
    res.setHeader('Cross-Origin-Embedder-Policy', 'credentialless');
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
    return middleware(req, res, next);
  };
};

module.exports = withNativeWind(config, { input: './global.css' });

