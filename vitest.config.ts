import path from "node:path";
import { defineConfig } from "vitest/config";

const here = import.meta.dirname;

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(here, "src"),
      "server-only": path.resolve(here, "tests/helpers/empty.ts"),
    },
  },
  test: { include: ["tests/**/*.test.ts"], environment: "node", testTimeout: 20000, hookTimeout: 30000 },
});
