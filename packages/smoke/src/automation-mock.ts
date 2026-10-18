import { createHmac } from "node:crypto";
import { createServer, type Server } from "node:http";

/**
 * A customer's automation, for the Atlas smoke spec (port 3192): the do, undo
 * and verify endpoints an allowed action is connected to. Every call is
 * recorded with whether its signature checks against the secret the spec
 * gave it (the one Settings › Atlas showed once).
 */
export type AutomationCall = { path: string; body: Record<string, unknown>; signed: boolean };

export function startAutomationMock(
  port = 3192,
): Promise<{ server: Server; calls: AutomationCall[]; setSecret: (s: string) => void }> {
  const calls: AutomationCall[] = [];
  let secret = "";
  const check = (header: string | undefined, body: string) => {
    if (!header || !secret) return false;
    const p = Object.fromEntries(header.split(",").map((x) => x.split("=", 2)));
    const mac = createHmac("sha256", secret).update(`${p.t}.${body}`).digest("hex");
    return mac === p.v1;
  };
  const server = createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      let body: Record<string, unknown> = {};
      try {
        body = JSON.parse(raw || "{}") as Record<string, unknown>;
      } catch {
        body = {};
      }
      const path = new URL(req.url ?? "/", "http://x").pathname;
      calls.push({
        path,
        body,
        signed: check(req.headers["x-openincident-signature"] as string, raw),
      });
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify(
          path.endsWith("/verify")
            ? { healthy: true, detail: "Mock: healthy for 2 min" }
            : { ok: true, ref: `MOCK-${calls.length}`, detail: "Mock automation ran it" },
        ),
      );
    });
  });
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () =>
      resolve({ server, calls, setSecret: (s) => (secret = s) }),
    );
  });
}
