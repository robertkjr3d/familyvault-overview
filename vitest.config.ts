import { defineConfig } from "vitest/config";
import path from "path";

// Deliberately a separate file from vite.config.ts. That file uses
// @lovable.dev/vite-tanstack-config, which explicitly warns against manual
// additions (duplicate plugins). Tests run independently via `vitest` / the
// "test" script in package.json — they never touch the app's actual build.
export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  test: {
    environment: "node",
  },
});
