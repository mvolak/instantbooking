import path from "node:path";
import { loadEnv } from "vite";
import { defineConfig } from "vitest/config";

export default defineConfig(({ mode }) => ({
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "src"),
      // `server-only` throws outside the Next.js server bundle; tests run on the server anyway.
      "server-only": path.resolve(import.meta.dirname, "tests/helpers/empty.ts"),
    },
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.{ts,tsx}"],
    env: loadEnv(mode, process.cwd(), ""),
    // Integration tests share one database; run files sequentially for predictable load.
    fileParallelism: false,
    testTimeout: 20_000,
    hookTimeout: 30_000,
  },
}));
