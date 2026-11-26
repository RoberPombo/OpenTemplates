import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
// @ts-expect-error type error without @types/node package
import process from "node:process";
const host = process.env.TAURI_DEV_HOST;

// https://vite.dev/config/
export default defineConfig(async ({ mode }) => {
  const analyze = mode === "analyze";
  const analyzePlugins = analyze
    ? [
        (await import("rollup-plugin-visualizer")).visualizer({
          filename: "dist/bundle-analysis.html",
          template: "treemap",
          gzipSize: true,
          brotliSize: true,
        }),
      ]
    : [];

  return {
    plugins: [react(), tailwindcss(), ...analyzePlugins],

    build: {
      // The budget check resolves the entry and its static imports from the
      // manifest, so hashed asset names do not matter.
      manifest: true,
      // Sourcemaps are only useful for the optional bundle report; keep them
      // out of normal production builds.
      sourcemap: analyze,
    },

    // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
    //
    // 1. prevent Vite from obscuring rust errors
    clearScreen: false,
    // 2. tauri expects a fixed port, fail if that port is not available
    server: {
      port: 1420,
      strictPort: true,
      host: host || false,
      hmr: host
        ? {
            protocol: "ws",
            host,
            port: 1421,
          }
        : undefined,
      watch: {
        // 3. tell Vite to ignore watching `src-tauri`
        ignored: ["**/src-tauri/**"],
      },
    },
  };
});
