const path = require('path');
const { getDefaultConfig } = require('expo/metro-config');
const { withNativeWind } = require('nativewind/metro');

const config = getDefaultConfig(__dirname);

// `workers/` holds separate Node workspaces (the OCR worker, SUPABASE_PLAN.md §5.3) with their own manifests and
// node_modules. The app never imports them, so keep Metro from crawling, watching or bundling any of it.
const workersDir = path.join(__dirname, 'workers').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
config.resolver.blockList = [].concat(config.resolver.blockList ?? [], new RegExp(`^${workersDir}[\\\\/]`));

module.exports = withNativeWind(config, { input: './global.css' });
