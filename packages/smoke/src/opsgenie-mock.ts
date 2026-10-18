import { createServer, type Server } from "node:http";
import {
  createDemoAccount,
  DEMO_KEYS,
  type DemoAccount,
  type DemoAccountOptions,
} from "../../migrate-opsgenie/src/demo-account";

/**
 * A mock of Opsgenie's REST API v2 for the smoke suite (port 3193, see .env
 * OPSGENIE_API_BASE): the EU region answers under /eu, the US one under /us,
 * exactly the paths the product's client builds from that base.
 *
 * The account itself — Skylark's users, teams, schedules with layers and
 * restrictions, escalations, routing rules, integrations, heartbeats and an
 * alert history — is the demo account the product's own tests use
 * (packages/migrate-opsgenie/src/demo-account.ts). It behaves like Opsgenie
 * where it matters for a migration:
 *
 * - `GenieKey` authentication; a key of the EU account means nothing to the
 *   US region (401 "Could not authenticate");
 * - a key without Configuration Access is refused with 403 on users,
 *   schedules, policies; a team's key only sees its team and gets 403 on
 *   the account;
 * - one request in `throttleEvery` answers 429 with Retry-After, so the
 *   client's backoff runs for real;
 * - lists page by offset, 100 at most, and an alert search refuses to reach
 *   past 20 000 (422);
 * - every call is a GET, and the mock records them — a write would be a bug.
 *
 * `POST /_override` adds an override "made in Opsgenie" after the inventory,
 * which is what shadow mode must catch.
 */
export { DEMO_KEYS };
export type OpsgenieCall = { method: string; path: string; status: number };

export function startOpsgenieMock(
  port = 3193,
  options: DemoAccountOptions = { alerts: 420, throttleEvery: 23, retryAfter: 1 },
): Promise<{ server: Server; account: DemoAccount; calls: OpsgenieCall[] }> {
  const account = createDemoAccount(options);
  const calls: OpsgenieCall[] = [];
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      if (req.method === "POST" && url.pathname === "/_override") {
        const b = JSON.parse(raw || "{}") as {
          schedule: string;
          rotation: string | null;
          person: string;
          start: string;
          end: string;
        };
        account.addOverride(b.schedule, b.rotation, b.person, new Date(b.start), new Date(b.end));
        res.writeHead(200, { "content-type": "application/json" });
        res.end("{}");
        return;
      }
      const r = account.handle(req.method ?? "GET", url, req.headers.authorization ?? null);
      calls.push({ method: req.method ?? "GET", path: url.pathname, status: r.status });
      res.writeHead(r.status, { "content-type": "application/json", ...(r.headers ?? {}) });
      res.end(JSON.stringify(r.body));
    });
  });
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => resolve({ server, account, calls }));
  });
}
