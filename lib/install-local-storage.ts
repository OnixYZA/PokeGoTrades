/**
 * Web (and any platform without a `.native` override): nothing to install.
 *
 * Browsers already provide `localStorage`, which is all the native shim exists to supply. The whole
 * point of this file is that it does NOT mention `expo-sqlite`: see ./install-local-storage.native.ts.
 */
export {};
