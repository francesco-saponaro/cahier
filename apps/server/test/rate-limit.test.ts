import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { startServer, type Server } from "./harness.js";

/*
 * The auth procedures are rate limited by IP in Fastify, before the router sees the call, so a
 * password can be tried only so many times a minute. The rest of the router is not: the member's
 * own rate limit on questions is the domain's, and lands with the pipeline.
 */

let server: Server;

beforeAll(async () => {
  server = await startServer({ authRateLimit: 3 });
}, 120_000);

afterAll(async () => {
  await server.close();
});

describe("the rate limit on auth", () => {
  test("stops the fourth sign-in attempt in a minute with a 429, and leaves the other procedures alone", async () => {
    const attempt = () => fetch(`${server.url}/trpc/auth.signIn`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ json: { email: "lea@example.com", password: "wrong-every-time" } }) });
    const statuses: number[] = [];
    for (let i = 0; i < 4; i++) statuses.push((await attempt()).status);
    expect(statuses).toEqual([401, 401, 401, 429]);
    const health = await fetch(`${server.url}/trpc/health`);
    expect(health.status).toBe(200);
    const again = await attempt();
    expect(again.status).toBe(429);
    expect(again.headers.get("retry-after")).not.toBeNull();
  });
});
