import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { connectPglite } from "@cahier/db";
import { buildApp } from "../src/app.js";

describe("the server", () => {
  let app: ReturnType<typeof buildApp>;
  let close: () => Promise<void>;

  beforeAll(async () => {
    const conn = await connectPglite();
    close = conn.close;
    app = buildApp({ db: conn.db, webOrigin: "http://localhost:3000", sessionHours: 72 });
    await app.ready();
  });
  afterAll(async () => {
    await app.close();
    await close();
  });

  test("answers the health check with the database reachable", async () => {
    const res = await app.inject({ method: "GET", url: "/health" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true, db: true });
  });

  test("sends the headers that keep a browser from misreading or framing an answer", async () => {
    const res = await app.inject({ method: "GET", url: "/health" });
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
    expect(res.headers["x-frame-options"]).toBe("DENY");
    expect(res.headers["referrer-policy"]).toBe("no-referrer");
    expect(res.headers["x-powered-by"]).toBeUndefined();
  });

  test("allows the web origin and no other", async () => {
    const allowed = await app.inject({ method: "OPTIONS", url: "/health", headers: { origin: "http://localhost:3000", "access-control-request-method": "GET" } });
    expect(allowed.headers["access-control-allow-origin"]).toBe("http://localhost:3000");
    const other = await app.inject({ method: "OPTIONS", url: "/health", headers: { origin: "http://evil.example", "access-control-request-method": "GET" } });
    expect(other.headers["access-control-allow-origin"]).toBeUndefined();
  });
});
