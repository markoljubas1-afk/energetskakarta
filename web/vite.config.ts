/// <reference types="vitest/config" />
import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv } from "vite";

import { localData } from "./vite/localData.ts";
import { securityHeaders } from "./vite/securityHeaders.ts";
import { swPrecache } from "./vite/swPrecache.ts";

export default defineConfig(({ command, mode, isSsrBuild }) => {
  const env = loadEnv(mode, process.cwd(), "VITE_");
  const dataBaseUrl = env.VITE_DATA_BASE_URL ?? "/local-data/";
  // Only a production *build* bakes the data URL in; `vite preview` serves an existing build.
  if (command === "build" && mode === "production" && !env.VITE_DATA_BASE_URL) {
    throw new Error("VITE_DATA_BASE_URL must be set for production builds");
  }
  return {
    plugins: [
      react(),
      localData(process.env.LOCAL_DATA_DIR ?? ".data"),
      securityHeaders(dataBaseUrl),
      // the files the service worker keeps at install, written into /sw.js (Faza 59)
      swPrecache(),
    ],
    // MapLibre's worker is an ES module that imports a shared chunk
    worker: { format: "es" },
    build: {
      target: "es2022",
      sourcemap: true,
      // MapLibre alone is ~1 MB minified; it is loaded lazily with the map, so the shell stays small.
      chunkSizeWarningLimit: 1100,
      // Small font subsets would be inlined as data: URLs, which the site's policy (font-src 'self') refuses:
      // fonts always stay files. Everything else keeps Vite's default limit.
      assetsInlineLimit: (filePath: string) => (/\.woff2?$/.test(filePath) ? false : undefined),
      // The learning page's live box (src/widgets/learnLive.ts) is the one script static pages have. It is
      // built from the map's own modules and keeps a fixed name, because the page that loads it is written by
      // the prerender step, which knows no hashed file names. Not for the SSR builds (`npm run prerender`,
      // `notify:indexnow`): they name their own single entry on the command line.
      ...(isSsrBuild
        ? {}
        : {
            rollupOptions: {
              // the service worker (Faza 59) too: it must live at the root, under a name that never changes
              input: { main: "index.html", "learn-live": "src/widgets/learnLive.ts", sw: "src/pwa/sw.ts" },
              output: {
                entryFileNames: (chunk: { name: string }) =>
                  chunk.name === "learn-live"
                    ? "learn-live.js"
                    : chunk.name === "sw"
                      ? "sw.js"
                      : "assets/[name]-[hash].js",
              },
            },
          }),
    },
    test: {
      environment: "jsdom",
      setupFiles: ["./src/test/setup.ts"],
      include: ["src/**/*.test.{ts,tsx}", "vite/**/*.test.ts"],
      css: false,
      restoreMocks: true,
    },
  };
});
