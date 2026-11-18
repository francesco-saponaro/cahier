/** Everything the server reads from the environment, in one place, with the defaults of `.env.example`. */
export interface Config {
  databaseUrl: string;
  port: number;
  host: string;
  webOrigin: string | null;
  sessionHours: number;
  seedOnStart: boolean;
}

export function readConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const databaseUrl = env["DATABASE_URL"];
  if (!databaseUrl) throw new Error("DATABASE_URL is not set");
  const port = Number(env["PORT"] ?? 3001);
  const sessionHours = Number(env["SESSION_HOURS"] ?? 72);
  if (!Number.isInteger(port) || port <= 0) throw new Error(`PORT must be a positive integer, got ${env["PORT"]}`);
  if (!Number.isFinite(sessionHours) || sessionHours <= 0) throw new Error(`SESSION_HOURS must be positive, got ${env["SESSION_HOURS"]}`);
  return {
    databaseUrl,
    port,
    host: env["HOST"] ?? "127.0.0.1",
    webOrigin: env["WEB_ORIGIN"] || null,
    sessionHours,
    seedOnStart: env["SEED"] === "1",
  };
}
