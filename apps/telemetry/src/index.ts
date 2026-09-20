/**
 * The ingestion service — separate from the web app, on purpose (D23).
 *
 * A burst of logs must never slow down an acknowledgement. `apps/web` serves
 * people who are handling an incident; this serves machines that are talking
 * about one, and the two scale on different curves. Keeping them apart also
 * means the ingestion process is stateless and replicable, and that a crash
 * here never takes a pager with it.
 *
 * Node's own http server, no framework: three routes, one authentication
 * check, no templating, no sessions. Anything more would be furniture.
 */
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { gunzipSync } from "node:zlib";
import { resolveRumApp } from "@openincident/db";
import { telemetryInstalled } from "@openincident/telemetry";
import { callerFor, keyFromHeaders } from "./auth";
import { ingestLogs, ingestSpans, settingsFor, type Outcome } from "./ingest";
import { keepRateFor } from "./budget";
import { samplingNotice } from "./sampling";
import { record, type Signal } from "./usage";
import { decodeLogs, decodeSpans } from "./otlp";
import {
  decodeLogsProto,
  decodeMetricsProto,
  decodeSpansProto,
  encodeLogsResponse,
  encodeMetricsResponse,
  encodeTraceResponse,
} from "./protobuf";
import { decodeMetricsJson } from "./metrics";
import { ingestMetrics } from "./metrics-ingest";
import { decodeRemoteWrite, remoteWriteVersion, RemoteWriteError } from "./remote-write";
import { decodePprof, PprofError } from "./pprof";
import { decodeRumBatch, originAllowed, RumError } from "./rum";
import { decodeFluent } from "./fluent";
import { startSyslog, syslogConfig } from "./syslog-server";
import { ingestRum } from "./rum-ingest";
import { ingestProfiles, parsePyroscopeName } from "./profiles-ingest";
import { SnappyError } from "./snappy";

const PORT = Number(process.env.TELEMETRY_PORT ?? 4318);
/** OTLP's own limit, and the one §15.4 names. */
const MAX_BODY = 16 * 1024 * 1024;

function sendProto(res: ServerResponse, status: number, body: Buffer): void {
  res.writeHead(status, {
    "content-type": "application/x-protobuf",
    "content-length": body.byteLength,
  });
  res.end(body);
}

/**
 * A JSON answer, with whatever extra headers the caller needs.
 *
 * The extras exist for the browser endpoint: a CORS header has to ride on the
 * error responses too, or the page receives an opaque network failure instead
 * of the sentence saying what was wrong.
 */
function send(
  res: ServerResponse,
  status: number,
  body: unknown,
  extra: Record<string, string> = {},
): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json",
    "content-length": Buffer.byteLength(payload),
    ...extra,
  });
  res.end(payload);
}

async function readBody(req: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > MAX_BODY) throw new Error("payload too large");
    chunks.push(chunk as Buffer);
  }
  const raw = Buffer.concat(chunks);
  return req.headers["content-encoding"] === "gzip" ? gunzipSync(raw) : raw;
}

/** An application id is a UUID; anything else is refused before a query runs. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const ROUTES: Record<string, Signal> = {
  "/v1/logs": "logs",
  "/v1/traces": "traces",
  "/v1/metrics": "metrics",
};

/*
 * Prometheus remote write, on the path Prometheus expects.
 *
 * `/api/v1/write` is not a path we chose — it is the one a `remote_write`
 * block appends to whatever URL it is given, and a sender cannot be told
 * otherwise. It is handled apart from the OTLP routes because everything about
 * it differs: snappy rather than raw protobuf, a response that carries nothing,
 * and a 204 rather than a 200.
 */
const REMOTE_WRITE = "/api/v1/write";

/*
 * Profiles, on two paths.
 *
 * `/v1/profiles` is ours and takes a pprof body with the service in the query
 * string. `/ingest` is Pyroscope's, and it is there because that is what the
 * agents already speak: Grafana Alloy, the Pyroscope agent and the Java and
 * Python SDKs all POST there, and accepting it means one line of their
 * configuration changes rather than their whole profiling setup.
 */
const PROFILE_PATHS = new Set(["/v1/profiles", "/ingest", "/ingest/v1/profiles"]);

/*
 * Real user monitoring, from a browser.
 *
 * The only endpoint here that a page calls directly, which makes it the only
 * one that needs CORS and the only one whose caller cannot hold a secret. Both
 * follow from the same fact and neither is worked around: the application id
 * is public, and what stands in for a credential is the origin the browser is
 * required to send and cannot forge.
 */
const RUM_PATH = "/v1/rum";

/*
 * Fluent Bit's HTTP output, which is one line of its configuration.
 *
 * Its native protocol is MessagePack over a socket; its HTTP output is a JSON
 * array and every installation can switch to it by changing `Name forward` to
 * `Name http`. Accepting the second rather than implementing the first is the
 * trade that makes this a day's work instead of a fortnight's, and it costs a
 * sender one line.
 */
const FLUENT_PATH = "/v1/fluent";

/** Each signal answers a protobuf sender in its own response message. */
function protoResponse(signal: Signal, rejected: number, message: string): Buffer {
  if (signal === "logs") return encodeLogsResponse(rejected, message);
  if (signal === "metrics") return encodeMetricsResponse(rejected, message);
  return encodeTraceResponse(rejected, message);
}

async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const path = (req.url ?? "").split("?")[0] ?? "";

  if (req.method === "GET" && path === "/healthz") {
    return send(res, telemetryInstalled() ? 200 : 503, {
      ok: telemetryInstalled(),
      // An instance without a column store is not broken, it is not installed.
      detail: telemetryInstalled() ? "ready" : "telemetry module not installed (CLICKHOUSE_URL)",
    });
  }

  if (req.method === "POST" && path === REMOTE_WRITE) return remoteWrite(req, res);
  if (req.method === "POST" && PROFILE_PATHS.has(path)) return profiles(req, res);
  if (path === RUM_PATH && (req.method === "POST" || req.method === "OPTIONS")) {
    return rum(req, res);
  }
  if (req.method === "POST" && path === FLUENT_PATH) return fluent(req, res);

  const signal = ROUTES[path];
  if (!signal || req.method !== "POST") return send(res, 404, { error: { code: "not_found" } });
  if (!telemetryInstalled())
    return send(res, 503, {
      error: { code: "module_not_installed", message: "this instance has no telemetry storage" },
    });

  const key = keyFromHeaders(req.headers);
  if (!key) return send(res, 401, { error: { code: "missing_key", message: "send x-oi-key" } });

  // The workspace is resolved before a single byte of the body is read.
  const caller = await callerFor(key);
  if (!caller) return send(res, 401, { error: { code: "invalid_key" } });
  if (!caller.signals.includes(signal))
    return send(res, 403, {
      error: { code: "signal_not_allowed", message: `this key may not send ${signal}` },
    });

  // An OTLP sender must be answered in the encoding it used: a protobuf
  // exporter reading a JSON error body logs a parse failure and hides ours.
  const type = String(req.headers["content-type"] ?? "");
  const proto = type.includes("protobuf") || type.includes("octet-stream");
  const fail = (status: number, code: string, message?: string) =>
    proto
      ? sendProto(res, status, protoResponse(signal, 0, message ?? code))
      : send(res, status, { error: { code, ...(message ? { message } : {}) } });

  if (!proto && !type.includes("json")) {
    return send(res, 415, {
      error: {
        code: "unsupported_content_type",
        message: "send OTLP as application/x-protobuf or application/json",
      },
    });
  }

  let body: Buffer;
  try {
    body = await readBody(req);
  } catch {
    return fail(413, "payload_too_large");
  }

  const settings = await settingsFor(caller.tenantId);
  if (!settings.enabledSignals.includes(signal))
    return fail(403, "signal_disabled", `${signal} is turned off for this workspace`);

  // Logs and traces bend when the workspace is over its daily cap; metrics do
  // not, because a chart with holes in it lies where a thinner log stream only
  // says less.
  const keep =
    signal === "metrics" ? 1 : await keepRateFor(caller.tenantId, settings.dailySoftCapGb);

  let outcome: Outcome;
  try {
    if (signal === "logs") {
      const decoded = proto ? decodeLogsProto(body) : decodeLogs(JSON.parse(body.toString("utf8")));
      outcome = await ingestLogs(caller, settings, decoded, keep);
    } else if (signal === "metrics") {
      const decoded = proto
        ? decodeMetricsProto(body)
        : decodeMetricsJson(JSON.parse(body.toString("utf8")));
      outcome = await ingestMetrics(caller, settings, decoded);
    } else {
      const decoded = proto
        ? decodeSpansProto(body)
        : decodeSpans(JSON.parse(body.toString("utf8")));
      outcome = await ingestSpans(caller, settings, decoded, keep);
    }
  } catch (err) {
    if (!proto && err instanceof SyntaxError)
      return send(res, 400, { error: { code: "invalid_json" } });
    console.error(`[telemetry] ${signal} failed:`, err);
    // 503 rather than 500: the OTel SDKs retry on it, and the data is still
    // in the collector's queue. A 500 tells them to give up.
    return fail(503, "storage_unavailable");
  }

  const rejected = outcome.rejected.length;
  const dropped = outcome.dropped ?? 0;
  // Sampled rows ride OTLP's partial-success field, which is the only channel
  // the protocol has for "I did not store all of that". Calling them rejected
  // is not quite what the word means, and silence is worse: the sender logs a
  // warning carrying the reason, which is the notice the cap promises and the
  // only one that reaches whoever configured the exporter.
  const notice = dropped > 0 ? samplingNotice(dropped, keep) : "";
  if (proto) {
    sendProto(
      res,
      200,
      protoResponse(signal, rejected + dropped, outcome.rejected[0]?.reason || notice),
    );
  } else {
    send(res, outcome.accepted > 0 || rejected === 0 ? 200 : 422, {
      accepted: outcome.accepted,
      rejected,
      ...(dropped > 0 ? { sampled: dropped, keeping: Number(keep.toFixed(4)), notice } : {}),
    });
  }
  void record(caller, signal, outcome, body.byteLength);
}

/**
 * One Prometheus remote-write request.
 *
 * Prometheus is not an OTLP sender and must not be answered like one: it reads
 * the status code and nothing else, retries on 5xx, and gives up permanently
 * on 4xx. So a body it cannot use is a 400 it will not retry, and a store that
 * is briefly unavailable is a 503 it will — the write-ahead log holds the
 * samples in the meantime, and answering 500 there loses them.
 */
async function remoteWrite(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (!telemetryInstalled()) return send(res, 503, { error: { code: "module_not_installed" } });

  const key = keyFromHeaders(req.headers);
  if (!key) return send(res, 401, { error: { code: "missing_key", message: "send x-oi-key" } });
  const caller = await callerFor(key);
  if (!caller) return send(res, 401, { error: { code: "invalid_key" } });
  if (!caller.signals.includes("metrics"))
    return send(res, 403, { error: { code: "signal_not_allowed" } });

  let body: Buffer;
  try {
    body = await readBody(req);
  } catch {
    return send(res, 413, { error: { code: "payload_too_large" } });
  }

  const settings = await settingsFor(caller.tenantId);
  if (!settings.enabledSignals.includes("metrics"))
    return send(res, 403, { error: { code: "signal_disabled" } });

  let outcome: Outcome;
  try {
    const decoded = decodeRemoteWrite(body, remoteWriteVersion(req.headers));
    outcome = await ingestMetrics(caller, settings, decoded);
  } catch (err) {
    // A body we cannot read is the sender's problem and will not be fixed by
    // sending it again; anything else is ours and is worth retrying.
    const ours = !(err instanceof SnappyError || err instanceof RemoteWriteError);
    if (!ours) {
      console.warn(`[telemetry] remote write refused: ${(err as Error).message}`);
      return send(res, 400, { error: { code: "invalid_body", message: (err as Error).message } });
    }
    console.error("[telemetry] remote write failed:", err);
    return send(res, 503, { error: { code: "storage_unavailable" } });
  }

  // 204: Prometheus reads the status and discards the body, and sending one it
  // will not look at is bytes on every request for ever.
  res.writeHead(204).end();
  void record(caller, "metrics", outcome, body.byteLength);
}

/**
 * One profile upload, whichever path it arrived on.
 *
 * The service can be named three ways, and all three are read because all
 * three are what somebody will send: our own `service` parameter, Pyroscope's
 * `name` (which also carries the kind and a label set), and the key's pinned
 * name for a collector that cannot be trusted to say.
 */
async function profiles(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (!telemetryInstalled()) return send(res, 503, { error: { code: "module_not_installed" } });

  const key = keyFromHeaders(req.headers);
  if (!key) return send(res, 401, { error: { code: "missing_key", message: "send x-oi-key" } });
  const caller = await callerFor(key);
  if (!caller) return send(res, 401, { error: { code: "invalid_key" } });
  if (!caller.signals.includes("profiles"))
    return send(res, 403, {
      error: { code: "signal_not_allowed", message: "this key may not send profiles" },
    });

  const query = new URL(req.url ?? "/", "http://localhost").searchParams;
  const pyroscope = query.get("name") ? parsePyroscopeName(query.get("name")!) : null;
  const serviceName = query.get("service") ?? pyroscope?.service ?? "";
  const hint = query.get("type") ?? pyroscope?.type;

  let body: Buffer;
  try {
    body = await readBody(req);
  } catch {
    return send(res, 413, { error: { code: "payload_too_large" } });
  }

  const settings = await settingsFor(caller.tenantId);
  if (!settings.enabledSignals.includes("profiles"))
    return send(res, 403, { error: { code: "signal_disabled" } });

  let outcome: Outcome;
  try {
    const decoded = decodePprof(body, hint);
    outcome = await ingestProfiles(
      caller,
      settings,
      {
        serviceName,
        environment:
          query.get("environment") ?? pyroscope?.labels.env ?? pyroscope?.labels.environment ?? "",
        release: query.get("release") ?? pyroscope?.labels.version ?? "",
        labels: pyroscope?.labels ?? {},
      },
      decoded,
    );
  } catch (err) {
    if (err instanceof PprofError) {
      console.warn(`[telemetry] profile refused: ${err.message}`);
      return send(res, 400, { error: { code: "invalid_profile", message: err.message } });
    }
    console.error("[telemetry] profile failed:", err);
    return send(res, 503, { error: { code: "storage_unavailable" } });
  }

  const rejected = outcome.rejected.length;
  // A Pyroscope agent reads the status and nothing else. 200 with a body the
  // others can read costs nothing and tells a person using curl what happened.
  send(res, outcome.accepted > 0 || rejected === 0 ? 200 : 422, {
    accepted: outcome.accepted,
    rejected,
    ...(rejected ? { reason: outcome.rejected[0]?.reason } : {}),
  });
  void record(caller, "profiles", outcome, body.byteLength);
}

/**
 * One batch from a browser.
 *
 * A preflight is answered before anything else, because a browser will not
 * send the real request until it is — and it is answered per-origin rather
 * than with `*`, so the list of origins a workspace declared is enforced at
 * the first opportunity rather than after the data has arrived.
 */
/**
 * The headers a browser needs to accept our answer.
 *
 * `allow-credentials` is here for one reason and it is not a preference:
 * `sendBeacon` always sends in credentials mode `include`, with no way to ask
 * it not to, and a browser rejects any cross-origin response to such a request
 * that does not say `true`. Without this line the beacon is refused before it
 * is read — and the beacon is the only thing that carries LCP, CLS and INP,
 * because those are only final once the page is going away. The symptom was a
 * RUM table with every event in it except the three that matter, and nothing
 * in any server log, because the request never left the browser.
 *
 * The origin is echoed rather than starred: `*` is not allowed with
 * credentials, and echoing is exact here because the origin was already
 * checked against the workspace's own list.
 */
function CORS(origin: string): Record<string, string> {
  return {
    "access-control-allow-origin": origin,
    "access-control-allow-credentials": "true",
    // Two origins can be allowed for one application, and a cache that
    // remembers the first would refuse the second.
    vary: "Origin",
  };
}

async function rum(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const origin = String(req.headers.origin ?? "");
  const appId = new URL(req.url ?? "/", "http://localhost").searchParams.get("app") ?? "";

  const caller = appId && UUID.test(appId) ? await resolveRumApp(appId) : null;
  const allowed = caller !== null && origin !== "" && originAllowed(origin, caller.allowedOrigins);

  if (req.method === "OPTIONS") {
    if (!allowed) {
      res.writeHead(403).end();
      return;
    }
    res
      .writeHead(204, {
        ...CORS(origin),
        "access-control-allow-methods": "POST, OPTIONS",
        "access-control-allow-headers": "content-type",
        // A day, so a page that reports every few seconds preflights once.
        "access-control-max-age": "86400",
      })
      .end();
    return;
  }

  // The reasons are not distinguished to the caller. A page that can tell an
  // unknown application id from a disallowed origin is a page that can
  // enumerate which ids exist.
  if (!allowed) return send(res, 403, { error: { code: "origin_not_allowed" } });
  if (!telemetryInstalled()) return send(res, 503, { error: { code: "module_not_installed" } });

  const cors = CORS(origin);

  let body: Buffer;
  try {
    body = await readBody(req);
  } catch {
    return send(res, 413, { error: { code: "payload_too_large" } }, cors);
  }

  const settings = await settingsFor(caller!.tenantId);
  if (!settings.enabledSignals.includes("rum"))
    return send(res, 403, { error: { code: "signal_disabled" } }, cors);

  let outcome: Outcome;
  try {
    const events = decodeRumBatch(JSON.parse(body.toString("utf8")), {
      userAgent: String(req.headers["user-agent"] ?? ""),
      // Whatever the proxy in front of this resolved. Nothing derives it from
      // the address here, and the address is not read at all: it is the field
      // that would make these rows about a person.
      country: String(req.headers["cf-ipcountry"] ?? req.headers["x-country"] ?? "").slice(0, 2),
      salt: caller!.tenantId,
    });
    outcome = await ingestRum(caller!.tenantId, caller!.appId, settings, events);
  } catch (err) {
    if (err instanceof RumError || err instanceof SyntaxError) {
      return send(
        res,
        400,
        { error: { code: "invalid_batch", message: String(err.message) } },
        cors,
      );
    }
    console.error("[telemetry] rum failed:", err);
    return send(res, 503, { error: { code: "storage_unavailable" } }, cors);
  }

  // 204: the SDK uses sendBeacon where it can, which discards the response
  // entirely, and a body nobody reads is bytes on every page in the world.
  res.writeHead(204, cors).end();
  void record(
    { tenantId: caller!.tenantId, keyId: caller!.appId } as never,
    "rum",
    outcome,
    body.byteLength,
  );
}

/**
 * One batch from Fluent Bit.
 *
 * Its HTTP output sends an array of flat objects — whatever the parser
 * produced, plus a `date`. Nothing about that is OTLP, so the mapping is
 * stated here rather than guessed at: `log` or `message` is the body, `level`
 * or `severity` the severity, and the tag names the service because a Fluent
 * tag is exactly "which thing this came from".
 *
 * Everything else becomes an attribute. A Kubernetes filter adds a dozen
 * useful ones and dropping them would lose the pod the line came from.
 */
async function fluent(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (!telemetryInstalled()) return send(res, 503, { error: { code: "module_not_installed" } });

  const key = keyFromHeaders(req.headers);
  if (!key) return send(res, 401, { error: { code: "missing_key", message: "send x-oi-key" } });
  const caller = await callerFor(key);
  if (!caller) return send(res, 401, { error: { code: "invalid_key" } });
  if (!caller.signals.includes("logs"))
    return send(res, 403, { error: { code: "signal_not_allowed" } });

  let body: Buffer;
  try {
    body = await readBody(req);
  } catch {
    return send(res, 413, { error: { code: "payload_too_large" } });
  }

  const settings = await settingsFor(caller.tenantId);
  if (!settings.enabledSignals.includes("logs"))
    return send(res, 403, { error: { code: "signal_disabled" } });

  let outcome: Outcome;
  try {
    // The tag rides in the query string or the header, because Fluent Bit's
    // HTTP output puts it in neither by default and both are one line to add.
    const url = new URL(req.url ?? "/", "http://localhost");
    const tag = url.searchParams.get("tag") ?? String(req.headers["x-oi-tag"] ?? "");
    const parsed: unknown = JSON.parse(body.toString("utf8"));
    const decoded = decodeFluent(parsed, tag || "fluent");
    /*
     * A batch that arrived and was understood by nobody is not a success. The
     * commonest cause is a parser putting the message under a key this does
     * not know, and answering 200 to it means an operator sees a green output
     * plugin and an empty screen with nothing to connect them.
     */
    const sent = Array.isArray(parsed) ? parsed.length : parsed ? 1 : 0;
    if (sent > 0 && decoded.length === 0) {
      return send(res, 422, {
        error: {
          code: "nothing_understood",
          message:
            "no record carried a message: this reads log, message, msg, short_message or MESSAGE",
        },
      });
    }
    outcome = await ingestLogs(
      caller,
      settings,
      decoded,
      await keepRateFor(caller.tenantId, settings.dailySoftCapGb),
    );
  } catch (err) {
    if (err instanceof SyntaxError) return send(res, 400, { error: { code: "invalid_json" } });
    console.error("[telemetry] fluent failed:", err);
    return send(res, 503, { error: { code: "storage_unavailable" } });
  }

  send(res, outcome.accepted > 0 || outcome.rejected.length === 0 ? 200 : 422, {
    accepted: outcome.accepted,
    rejected: outcome.rejected.length,
    ...(outcome.dropped ? { sampled: outcome.dropped } : {}),
  });
  void record(caller, "logs", outcome, body.byteLength);
}

createServer((req, res) => {
  handle(req, res).catch((err) => {
    console.error("[telemetry] unhandled:", err);
    if (!res.headersSent) send(res, 500, { error: { code: "internal" } });
  });
}).listen(PORT, () => {
  // The syslog listener, when one is configured. Off by default and on its own
  // port: syslog carries no credential, so the port is the credential and one
  // port belongs to one workspace.
  const syslog = syslogConfig();
  if (syslog) startSyslog(syslog);
  console.log(
    telemetryInstalled()
      ? `Open Incident telemetry ingestion on :${PORT} — OTLP logs, traces, metrics and profiles, Prometheus remote write, browser RUM, Fluent`
      : `Open Incident telemetry ingestion on :${PORT} — no storage configured, answering 503`,
  );
});
