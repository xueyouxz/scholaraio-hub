import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const exclude = ["node_modules/**", "dist/**"];

if (process.env.ALLOW_SOCKET_TESTS !== "true") {
  exclude.push("test/maintenance/**");
}

export default defineConfig({
  resolve: {
    alias: {
      "@scholaraio-hub/shared": fileURLToPath(new URL("../shared/src/index.ts", import.meta.url)),
    },
  },
  test: {
    exclude,
    passWithNoTests: true,
    maxWorkers: 4,
    minWorkers: 1,
  },
});
