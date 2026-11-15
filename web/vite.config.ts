/// <reference types="vitest/config" />
import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv } from "vite";

import { localData } from "./vite/localData.ts";
import { securityHeaders } from "./vite/securityHeaders.ts";

export default defineConfig(({ command, mode }) => {
  const env = loadEnv(mode, process.cwd(), "VITE_");
  const dataBaseUrl = env.VITE_DATA_BASE_URL ?? "/local-data/";
  // Only a production *build* bakes the data URL in; `vite preview` serves an existing build.
  if (command === "build" && mode === "production" && !env.VITE_DATA_BASE_URL) {
    throw new Error("VITE_DATA_BASE_URL must be set for production builds");
  }
  return {
    plugins: [react(), localData(process.env.LOCAL_DATA_DIR ?? ".data"), securityHeaders(dataBaseUrl)],
    // MapLibre's worker is an ES module that imports a shared chunk
    worker: { format: "es" },
    build: {
      target: "es2022",
      sourcemap: true,
      // MapLibre alone is ~1 MB minified; it is loaded lazily with the map, so the shell stays small.
      chunkSizeWarningLimit: 1100,
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
