import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const root = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@ohho/schemas": path.join(root, "packages/schemas/index.ts"),
      "@ohho/connect": path.join(root, "packages/connect/index.ts"),
    },
  },
  test: {
    include: ["packages/**/src/**/*.test.ts"],
    environment: "node",
  },
});
