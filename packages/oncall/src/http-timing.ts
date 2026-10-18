/**
 * One HTTP check, timed phase by phase.
 *
 * `fetch` answers "how long did it take" and nothing else, and the monitor's
 * page asks the next question: was it the name lookup, the connection, the
 * handshake, or the server thinking. Those four come from the socket's own
 * events — `lookup`, `connect`, `secureConnect`, the first byte of the
 * response — so this speaks `node:http(s)` directly.
 *
 * Kept as close to the `fetch` it replaces as the criteria need: the same
 * method, headers and body, redirects followed unless the monitor says not to
 * (five at most), the body read up to 20 000 characters and no further, the
 * same timeout over the whole exchange. No `Accept-Encoding` is sent, so the
 * body a criterion reads is the body, not gzip.
 *
 * On HTTPS the leaf certificate is read off the same handshake — expiry date
 * and issuer — because the screen shows them and a second connection just to
 * look would be a second check nobody asked for.
 */
import { request as httpRequest, type IncomingMessage } from "node:http";
import { request as httpsRequest } from "node:https";
import type { TLSSocket } from "node:tls";

/** Milliseconds spent in each phase; `tls` is null over plain HTTP. */
export type HttpPhases = { dns: number; connect: number; tls: number | null; firstByte: number };

export type TimedHttpResult = {
  statusCode: number;
  statusText: string;
  headers: Record<string, string>;
  body: string;
  latencyMs: number;
  phases: HttpPhases;
  /** The certificate the server presented, on HTTPS. */
  tls?: { validTo: string; issuer: string | null };
};

const MAX_BODY = 20_000;
const MAX_REDIRECTS = 5;

function once(
  url: URL,
  init: { method: string; headers?: Record<string, string>; body?: string },
  deadline: number,
): Promise<{
  res: IncomingMessage;
  body: string;
  phases: HttpPhases;
  tls?: TimedHttpResult["tls"];
}> {
  return new Promise((resolve, reject) => {
    const started = performance.now();
    let lookupAt: number | null = null;
    let connectAt: number | null = null;
    let secureAt: number | null = null;
    let tls: TimedHttpResult["tls"];
    const secure = url.protocol === "https:";
    const send = secure ? httpsRequest : httpRequest;
    const remaining = Math.max(1, deadline - Date.now());
    const req = send(
      url,
      {
        method: init.method,
        headers: init.headers,
        // A fresh connection every time: a pooled one would measure a lookup
        // and a handshake that never happened.
        agent: false,
        timeout: remaining,
      },
      (res) => {
        const firstByteAt = performance.now();
        let body = "";
        res.setEncoding("utf8");
        res.on("data", (chunk: string) => {
          if (body.length < MAX_BODY) body += chunk;
          if (body.length >= MAX_BODY) res.destroy();
        });
        const finish = () => {
          const t0 = started;
          const dnsEnd = lookupAt ?? t0;
          const connEnd = connectAt ?? dnsEnd;
          const tlsEnd = secureAt ?? connEnd;
          resolve({
            res,
            body: body.slice(0, MAX_BODY),
            phases: {
              dns: Math.max(0, dnsEnd - t0),
              connect: Math.max(0, connEnd - dnsEnd),
              tls: secure ? Math.max(0, tlsEnd - connEnd) : null,
              firstByte: Math.max(0, firstByteAt - tlsEnd),
            },
            tls,
          });
        };
        res.on("end", finish);
        res.on("close", finish);
        res.on("error", finish);
      },
    );
    req.on("socket", (socket) => {
      socket.on("lookup", () => (lookupAt = performance.now()));
      socket.on("connect", () => (connectAt = performance.now()));
      socket.on("secureConnect", () => {
        secureAt = performance.now();
        try {
          const cert = (socket as TLSSocket).getPeerCertificate();
          if (cert && cert.valid_to) {
            const issuer = cert.issuer?.O ?? cert.issuer?.CN ?? null;
            tls = {
              validTo: new Date(cert.valid_to).toISOString(),
              issuer: Array.isArray(issuer) ? (issuer[0] ?? null) : issuer,
            };
          }
        } catch {
          // A certificate that cannot be read is not a failed check.
        }
      });
    });
    req.on("timeout", () => req.destroy(new Error(`timeout after ${remaining} ms`)));
    req.on("error", reject);
    if (init.body) req.write(init.body);
    req.end();
  });
}

/** Performs the request, following redirects; phases are summed across hops. */
export async function timedHttp(
  target: string,
  init: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
    followRedirects?: boolean;
    timeoutMs: number;
  },
): Promise<TimedHttpResult> {
  const started = Date.now();
  const deadline = started + init.timeoutMs;
  let url = new URL(target);
  let method = (init.method ?? "GET").toUpperCase();
  let body = init.body;
  const total: HttpPhases = { dns: 0, connect: 0, tls: null, firstByte: 0 };
  for (let hop = 0; ; hop++) {
    const out = await once(url, { method, headers: init.headers, body }, deadline);
    total.dns += out.phases.dns;
    total.connect += out.phases.connect;
    if (out.phases.tls !== null) total.tls = (total.tls ?? 0) + out.phases.tls;
    total.firstByte += out.phases.firstByte;
    const status = out.res.statusCode ?? 0;
    const location = out.res.headers.location;
    if (
      init.followRedirects !== false &&
      status >= 300 &&
      status < 400 &&
      location &&
      hop < MAX_REDIRECTS
    ) {
      url = new URL(location, url);
      // What a browser does: 303 always becomes GET, and so do 301/302 after a POST.
      if (status === 303 || ((status === 301 || status === 302) && method === "POST")) {
        method = "GET";
        body = undefined;
      }
      continue;
    }
    const headers: Record<string, string> = {};
    for (const [k, v] of Object.entries(out.res.headers)) {
      if (v !== undefined) headers[k.toLowerCase()] = Array.isArray(v) ? v.join(", ") : v;
    }
    return {
      statusCode: status,
      statusText: out.res.statusMessage ?? "",
      headers,
      body: out.body,
      latencyMs: Date.now() - started,
      phases: {
        dns: Math.round(total.dns),
        connect: Math.round(total.connect),
        tls: total.tls === null ? null : Math.round(total.tls),
        firstByte: Math.round(total.firstByte),
      },
      ...(out.tls ? { tls: out.tls } : {}),
    };
  }
}
