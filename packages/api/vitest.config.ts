import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: { "@cahier/domain": fileURLToPath(new URL("../domain/src/index.ts", import.meta.url)) },
  },
  test: {
    name: "api",
    include: ["test/**/*.test.ts"],
  },
});
