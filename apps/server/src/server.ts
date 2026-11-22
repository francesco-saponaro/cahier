import { connect, generateSeed, seedDatabase } from "@cahier/db";
import { buildApp } from "./app.js";
import { readConfig } from "./config.js";

const config = readConfig();
const { db } = await connect(config.databaseUrl);
if (config.seedOnStart) await seedDatabase(db, await generateSeed());
const app = buildApp({ db, webOrigin: config.webOrigin, sessionHours: config.sessionHours, streamDelayMs: 12, tickEveryMs: 60_000 });
await app.listen({ port: config.port, host: config.host });
