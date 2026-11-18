import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    // Tests run against the domain package's source, so nothing needs building first.
    alias: { "@cahier/domain": fileURLToPath(new URL("../domain/src/index.ts", import.meta.url)) },
  },
  test: {
    name: "db",
    include: ["test/**/*.test.ts"],
    testTimeout: 60000,
    hookTimeout: 60000,
  },
});
