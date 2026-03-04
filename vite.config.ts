// Patent Pending — PrismOS-AI (US Provisional Patent, Feb 2026)
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
              const msg = `\n\x1b[31m❌ Port ${port} is already in use.\x1b[0m\n` +
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
  plugins: [react(), portPreflightPlugin(DEV_PORT)],
  clearScreen: false,
  build: {
    // Split vendor libraries into separate chunks to stay under 500 kB
    rollupOptions: {
      output: {
        manualChunks(id: string) {
          if (id.includes("node_modules")) {
            if (id.includes("framer-motion")) return "vendor-animation";
            if (id.includes("react-dom")) return "vendor-react-dom";
            if (id.includes("react")) return "vendor-react";
            if (id.includes("@tauri-apps")) return "vendor-tauri";
            return "vendor";
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
