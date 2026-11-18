import { describe, expect, test } from "vitest";
import { readConfig } from "../src/config.js";

describe("readConfig", () => {
  test("reads the variables of .env.example with their defaults", () => {
    expect(readConfig({ DATABASE_URL: "postgres://x" })).toEqual({
      databaseUrl: "postgres://x",
      port: 3001,
      host: "127.0.0.1",
      webOrigin: null,
      sessionHours: 72,
      seedOnStart: false,
    });
    expect(readConfig({ DATABASE_URL: "postgres://x", PORT: "4000", HOST: "0.0.0.0", WEB_ORIGIN: "http://localhost:3000", SESSION_HOURS: "24", SEED: "1" })).toMatchObject({
      port: 4000,
      host: "0.0.0.0",
      webOrigin: "http://localhost:3000",
      sessionHours: 24,
      seedOnStart: true,
    });
  });

  test("refuses to start without a database or with a port that is not one", () => {
    expect(() => readConfig({})).toThrow(/DATABASE_URL/);
    expect(() => readConfig({ DATABASE_URL: "postgres://x", PORT: "eighty" })).toThrow(/PORT/);
    expect(() => readConfig({ DATABASE_URL: "postgres://x", SESSION_HOURS: "0" })).toThrow(/SESSION_HOURS/);
  });
});
