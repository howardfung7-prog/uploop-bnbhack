import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({ mode }) => {
  // `API_PROXY_TARGET` has no VITE_ prefix on purpose: it only configures the dev proxy and never
  // reaches the browser bundle.
  const env = loadEnv(mode, ".", "");
  const target = env.API_PROXY_TARGET || "http://127.0.0.1:8787";
  return {
    plugins: [react()],
    build: {
      rollupOptions: {
        output: {
          // React in its own chunk (§71.174): it changes only on an upgrade, so its file name (hash)
          // stays the same across our deploys and a returning visitor keeps it from cache instead of
          // downloading it again inside a new main bundle. viem is deliberately not split this way —
          // the lazy WalletConnect chunk shares some viem modules, and a forced vendor chunk would
          // pull those into the first load.
          manualChunks(id) {
            if (/[\\/]node_modules[\\/](react|react-dom|scheduler)[\\/]/.test(id)) return "react";
          },
        },
      },
    },
    server: {
      port: 5173,
      proxy: { "/api": { target, changeOrigin: false } },
    },
  };
});
