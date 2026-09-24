import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@scholaraio-hub/shared": fileURLToPath(new URL("../shared/src/index.ts", import.meta.url)),
    },
  },
  test: {
    exclude: ["node_modules/**", "dist/**"],
    passWithNoTests: true,
    maxWorkers: 4,
    minWorkers: 1,
  },
});
