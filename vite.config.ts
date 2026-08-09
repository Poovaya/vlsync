import { defineConfig } from "vite";

const API_TARGET = process.env.VSYNC_SERVER ?? "http://127.0.0.1:8787";

export default defineConfig({
  server: {
    port: 5173,
    // The media server owns /api/*; Vite just forwards to it during dev so the
    // browser sees a single origin and range requests behave normally.
    proxy: {
      "/api": {
        target: API_TARGET,
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: "dist",
    sourcemap: true,
    target: "es2022",
  },
});
