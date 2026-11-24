import { copyFileSync, mkdirSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/*
 * Copies the committed migrations from `packages/db/drizzle` into `public/demo/`, where the
 * static export serves them: the demo fetches the SQL at runtime and applies it to PostgreSQL in
 * the page, the same file docker compose applies to PostgreSQL 16. PGlite's own WebAssembly and
 * data bundle need no copying; the bundler ships them with the scripts. Runs before `next build`
 * and `next dev`; the folder is not committed.
 */

const here = dirname(fileURLToPath(import.meta.url));
const migrations = join(here, "../../../packages/db/drizzle");
const out = join(here, "../public/demo");

mkdirSync(out, { recursive: true });
const copied = readdirSync(migrations).filter((name) => name.endsWith(".sql"));
for (const name of copied) copyFileSync(join(migrations, name), join(out, name));
console.log(`demo assets: ${copied.join(", ")} copied to public/demo`);
