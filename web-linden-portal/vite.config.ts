import path from "path";

import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// https://vitejs.dev/config/
export default defineConfig(() => ({
  base: '/',
  define: { 'import.meta.env.VITE_HOSTED_LINDEN': JSON.stringify('true') },
  publicDir: '../agentic-portal-demo/portal/public',
  server: {
    host: "::",
    port: 8080,
    hmr: {
      overlay: false,
    },
  },
  plugins: [
    react(),
    {
      name: 'hosted-portal-font-paths',
      enforce: 'pre',
      transform(code, id) {
        if (id.endsWith('/portal/src/styles.css')) return code.replaceAll('/portal/fonts/', '/fonts/');
      },
    },
  ],
  resolve: {
    dedupe: ['react', 'react-dom', 'react-router-dom'],
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  // Expose both VITE_* (Vite default) and EXPO_PUBLIC_* (Rork's cross-platform
  // public-env convention, written by tools like getOrCreateAuthConfig).
  envPrefix: ["VITE_", "EXPO_PUBLIC_"],
}));
