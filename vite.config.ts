// PrismOS-AI — Local-First Agentic Personal AI Operating System

/// <reference types="vitest" />
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import net from "net";

const host = process.env.TAURI_DEV_HOST;
const DEV_PORT = 1420;

/**
 * Preflight check: probes the dev port before Vite tries to bind.
 * Gives a clear, actionable error instead of Vite's generic EADDRINUSE.
 */
function portPreflightPlugin(port: number): Plugin {
  return {
    name: "prismos-port-preflight",
    apply: "serve", // dev-server only
    configureServer() {
      return new Promise<void>((resolve, reject) => {
        const tester = net
          .createServer()
          .once("error", (err: NodeJS.ErrnoException) => {
            if (err.code === "EADDRINUSE") {
              const msg =
                `\n\x1b[31m❌ Port ${port} is already in use.\x1b[0m\n` +
                `   Kill the existing process or run:\n` +
                `   \x1b[33mnpx kill-port ${port}\x1b[0m\n`;
              console.error(msg);
              reject(new Error(`Port ${port} in use`));
            } else {
              resolve(); // other errors — let Vite handle
            }
          })
          .once("listening", () => {
            tester.close(() => resolve());
          })
          .listen(port);
      });
    },
  };
}

export default defineConfig(async () => ({
  define: {
    "import.meta.env.VITE_PRISMOS_BUILD": JSON.stringify(
      process.env.VITE_PRISMOS_BUILD || new Date().toISOString(),
    ),
  },
  plugins: [react(), portPreflightPlugin(DEV_PORT)],
  clearScreen: false,
  build: {
    // Split core UI libraries; let Rollup keep the lazy WebGL renderer and its
    // heavy dependencies out of the initial application bundle. A catch-all
    // vendor chunk eagerly loads Three.js and creates circular graph chunks.
    rollupOptions: {
      output: {
        manualChunks(id: string) {
          if (id.includes("node_modules")) {
            if (id.includes("/framer-motion/")) return "vendor-animation";
            if (id.includes("/react-dom/")) return "vendor-react-dom";
            if (id.includes("/react/") || id.includes("/scheduler/"))
              return "vendor-react";
            if (id.includes("@tauri-apps")) return "vendor-tauri";
          }
        },
      },
    },
  },
  test: {
    globals: true,
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"],
    include: ["src/**/*.{test,spec}.{ts,tsx}"],
  },
  server: {
    port: DEV_PORT,
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
      ignored: ["**/src-tauri/**"],
    },
  },
}));
