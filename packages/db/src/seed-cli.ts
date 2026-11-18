import { connect } from "./migrate.js";
import { generateSeed, seedDatabase } from "./seed.js";

/** `pnpm seed`: migrate and load the seed into the database at DATABASE_URL. Safe to run twice. */
const url = process.env["DATABASE_URL"];
if (!url) {
  console.error("DATABASE_URL is not set");
  process.exit(1);
}
const { db, close } = await connect(url);
const data = await generateSeed();
await seedDatabase(db, data);
const total = Object.values(data).reduce((n, rows) => n + rows.length, 0);
console.log(`seeded ${total} rows (${data.users.length} users, ${data.documents.length} documents, ${data.conversations.length} conversations)`);
await close();
