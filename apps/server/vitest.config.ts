import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const src = (p: string) => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
  resolve: {
    alias: [
      { find: "@cahier/domain", replacement: src("../../packages/domain/src/index.ts") },
      { find: /^@cahier\/db\/(.*)$/, replacement: `${src("../../packages/db/src/")}$1` },
      { find: "@cahier/db", replacement: src("../../packages/db/src/index.ts") },
    ],
  },
  test: {
    name: "server",
    include: ["test/**/*.test.ts"],
    testTimeout: 60000,
    hookTimeout: 60000,
  },
});
