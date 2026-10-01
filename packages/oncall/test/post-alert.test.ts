import { createServer, type Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { postAlert } from "../src/monitors";

/**
 * The product posts its own alerts — heartbeats, monitors, SLOs, exception
 * regressions — to its ingest endpoint over HTTP, and the endpoint answers
 * 202. This test exists for a precise silence: with INTERNAL_WEB_ORIGIN
 * pointed at a TLS proxy instead of the app, the proxy answered an empty 200
 * for a Host it did not serve, `res.ok` was true, the sweep logged "1
 * heartbeat(s) missed", and no alert existed anywhere.
 */
let server: Server;
let answer: { status: number; body: string } = { status: 202, body: '{"data":[]}' };
let previous: string | undefined;

beforeAll(async () => {
  server = createServer((_req, res) => {
    res.writeHead(answer.status, { "content-type": "application/json" });
    res.end(answer.body);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  previous = process.env.INTERNAL_WEB_ORIGIN;
  process.env.INTERNAL_WEB_ORIGIN = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});

afterAll(async () => {
  if (previous === undefined) delete process.env.INTERNAL_WEB_ORIGIN;
  else process.env.INTERNAL_WEB_ORIGIN = previous;
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

const source = { id: "11111111-1111-4111-8111-111111111111", secret: "s" };
const origin = "https://acme.oi.example";

describe("postAlert", () => {
  it("counts the ingest's 202 as delivered", async () => {
    answer = { status: 202, body: '{"data":[{"alert_id":"a","action":"created"}]}' };
    expect(await postAlert(origin, source, { title: "x" })).toBe(true);
  });

  it("does not count a proxy's empty 200 as delivered", async () => {
    answer = { status: 200, body: "" };
    expect(await postAlert(origin, source, { title: "x" })).toBe(false);
  });

  it("does not count a refusal as delivered", async () => {
    answer = { status: 401, body: '{"error":{"code":"bad_secret"}}' };
    expect(await postAlert(origin, source, { title: "x" })).toBe(false);
  });
});
