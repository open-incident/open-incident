/**
 * Telemetry monitors, end to end against a real column store.
 *
 * What is being proved here is not that a query returns a number — that is
 * tested next door in `@openincident/telemetry`. It is the part that decides
 * whether a phone rings: one alert per series and not one for the monitor,
 * `for` holding a spike back, a recovery resolving the alert it opened, and a
 * silence meaning whatever the author said it means.
 *
 * Nothing is mocked except the far end. The sweep posts to the workspace's own
 * ingest endpoint, so the test stands a one-route HTTP server in its place and
 * reads the payloads off it: that is the whole alert contract, checked as the
 * pipeline would receive it, without needing the web app to be running.
 */
import { createServer, type Server } from "node:http";
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  monitors,
  provisionWorkspace,
  telemetryMonitorSeries,
  withTenant,
  type TelemetryQuery,
} from "@openincident/db";
import {
  clickhouse,
  closeClickhouse,
  migrateClickhouse,
  telemetryInstalled,
  type TelemetryMonitorQuery,
} from "@openincident/telemetry";
import { sweepTelemetryMonitors } from "../src/telemetry-monitors";

/* The module is optional in the product, so it is optional here. CI sets
 * CLICKHOUSE_URL, so the guarantee is still enforced on every commit. */
const describeWithClickhouse = telemetryInstalled() ? describe : describe.skip;

const run = randomUUID().slice(0, 8);
const service = `tm-${run}`;
let tenantId = "";
let server: Server;
let received: Array<Record<string, unknown>> = [];
/** Set to make the stand-in ingest endpoint refuse, as an unreachable one would. */
let refuse = false;
let previousOrigin: string | undefined;

/** Far enough ahead that a TTL merge cannot remove the fixtures mid-test. */
const RETENTION = "2099-01-01 00:00:00";

function chTime(d: Date): string {
  return d.toISOString().replace("T", " ").replace("Z", "");
}

async function writeException(type: string, at: Date): Promise<void> {
  await clickhouse().insert({
    table: "otel_exceptions",
    format: "JSONEachRow",
    values: [
      {
        tenant_id: tenantId,
        service_id: randomUUID(),
        service_name: service,
        environment: "test",
        release: "1.0.0",
        ts: chTime(at),
        fingerprint: `${type}-${run}`,
        type,
        message: "something broke",
        stacktrace: "",
        frames: [],
        trace_id: "",
        span_id: "",
        attributes: {},
        retention_at: RETENTION,
      },
    ],
  });
}

async function makeMonitor(
  name: string,
  q: TelemetryQuery,
  type: "exceptions" | "logs" = "exceptions",
): Promise<string> {
  return withTenant(tenantId, async (tx) => {
    const [m] = await tx
      .insert(monitors)
      .values({
        tenantId,
        name,
        type,
        target: "",
        intervalSeconds: 60,
        action: { page: { kind: "owner" }, incident: { from: "never" }, autoResolve: true },
        telemetryQuery: q,
      })
      .returning({ id: monitors.id });
    return m!.id;
  });
}

/*
 * The clock the sweeps run on.
 *
 * Two constraints meet here. The sweep skips a monitor checked less than its
 * interval ago, so each evaluation has to be further ahead than the last; and
 * the window has to still contain the fixtures, or the monitor is looking at
 * an empty stretch of time and every assertion below would pass for the wrong
 * reason. Two minutes apart inside a sixty-minute window satisfies both, and
 * `WELL_AFTER` is the other side of it: far enough that the window has moved
 * past the fixtures entirely, which is how a recovery is staged.
 */
const WINDOW_MINUTES = 60;
const BASE = Date.now();
const WELL_AFTER = new Date(BASE + 3 * 3_600_000);

function laterEachTime(): () => Date {
  let n = 0;
  return () => new Date(BASE + ++n * 120_000);
}

const baseQuery: TelemetryQuery = {
  query: `service_name = '${service}'`,
  aggregate: "count",
  windowMinutes: WINDOW_MINUTES,
  condition: { kind: "threshold", op: ">", value: 0 },
  forEvaluations: 1,
  groupBy: ["type"],
  noData: "ignore",
};

beforeAll(async () => {
  if (!telemetryInstalled()) return;
  await migrateClickhouse();

  const provisioned = await provisionWorkspace({
    slug: `tm-${run}`,
    name: `Telemetry monitors ${run}`,
    owner: { email: `owner-${run}@example.test`, name: "Owner" },
  });
  tenantId = provisioned.tenantId;

  // The far end of the alert road, stood up in place of the web app.
  server = createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      if (refuse) {
        res.writeHead(503, { "content-type": "application/json" });
        res.end('{"ok":false}');
        return;
      }
      received.push(JSON.parse(body || "{}"));
      res.writeHead(202, { "content-type": "application/json" });
      res.end('{"ok":true}');
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as { port: number }).port;
  previousOrigin = process.env.INTERNAL_WEB_ORIGIN;
  process.env.INTERNAL_WEB_ORIGIN = `http://127.0.0.1:${port}`;
}, 60_000);

afterAll(async () => {
  if (previousOrigin === undefined) delete process.env.INTERNAL_WEB_ORIGIN;
  else process.env.INTERNAL_WEB_ORIGIN = previousOrigin;
  if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
  if (tenantId) {
    await clickhouse()
      .command({
        query: `DELETE FROM otel_exceptions WHERE tenant_id = {tenant:UUID}`,
        query_params: { tenant: tenantId },
        clickhouse_settings: { mutations_sync: "2" },
      })
      .catch(() => undefined);
  }
  await closeClickhouse();
});

describe("the stored query and the evaluated query", () => {
  /*
   * The shape is declared twice — in `@openincident/db`, which stores it, and
   * in `@openincident/telemetry`, which runs it — because neither package can
   * import the other. This is the only place that sees both. The day a field
   * is added to one and not the other, this stops compiling, rather than
   * producing a monitor that silently ignores half its own definition.
   */
  it("are the same shape", () => {
    const stored: TelemetryQuery = {
      query: "service_name = 'x'",
      aggregate: "p95",
      field: "duration_ms",
      windowMinutes: 5,
      condition: { kind: "threshold", op: ">", value: 1 },
      forEvaluations: 2,
      groupBy: ["route"],
      noData: "trigger",
      severity: "P1",
    };
    const evaluated: TelemetryMonitorQuery = stored;
    const back: TelemetryQuery = evaluated;
    expect(back).toEqual(stored);
  });
});

describeWithClickhouse("a telemetry monitor pages per series", () => {
  it("says nothing while nothing is wrong", async () => {
    received = [];
    await makeMonitor(`quiet ${run}`, baseQuery);
    const out = await sweepTelemetryMonitors([tenantId]);
    expect(out.evaluated).toBeGreaterThan(0);
    expect(out.failed).toBe(0);
    expect(received).toHaveLength(0);
  });

  it("raises one alert per series, keyed so each can resolve on its own", async () => {
    received = [];
    const id = await makeMonitor(`grouped ${run}`, {
      ...baseQuery,
      query: `service_name = '${service}' AND type =~ '^Grouped'`,
    });
    const clock = laterEachTime();
    await writeException("GroupedPoolTimeout", new Date(BASE));
    await writeException("GroupedPaymentDeclined", new Date(BASE));

    const out = await sweepTelemetryMonitors([tenantId], clock());
    expect(out.failed).toBe(0);

    const mine = received.filter((a) => String(a.dedup_key).startsWith(`telemetry:${id}:`));
    expect(mine).toHaveLength(2);
    expect(new Set(mine.map((a) => a.dedup_key))).toEqual(
      new Set([
        `telemetry:${id}:type=GroupedPoolTimeout`,
        `telemetry:${id}:type=GroupedPaymentDeclined`,
      ]),
    );
    for (const alert of mine) {
      expect(alert.status).toBe("firing");
      expect(alert.severity).toBe("P2");
      expect(String(alert.title)).toContain("is breaching");
    }
  });

  it("does not raise the same alert twice while it stays breaching", async () => {
    received = [];
    const id = await makeMonitor(`steady ${run}`, {
      ...baseQuery,
      query: `service_name = '${service}' AND type = 'Steady'`,
      groupBy: [],
    });
    const clock = laterEachTime();
    await writeException("Steady", new Date(BASE));

    await sweepTelemetryMonitors([tenantId], clock());
    const first = received.filter((a) => String(a.dedup_key).startsWith(`telemetry:${id}:`));
    expect(first).toHaveLength(1);

    received = [];
    await sweepTelemetryMonitors([tenantId], clock());
    expect(received.filter((a) => String(a.dedup_key).startsWith(`telemetry:${id}:`))).toEqual([]);
  });

  it("holds a spike back for `for` evaluations, and does not hold the recovery back", async () => {
    received = [];
    // Above two occurrences, and it must stay there for three evaluations.
    const id = await makeMonitor(`patient ${run}`, {
      ...baseQuery,
      query: `service_name = '${service}' AND type = 'Flapping'`,
      condition: { kind: "threshold", op: ">", value: 2 },
      forEvaluations: 3,
      groupBy: [],
    });
    const clock = laterEachTime();
    const mine = () => received.filter((a) => String(a.dedup_key).startsWith(`telemetry:${id}:`));

    for (let i = 0; i < 3; i++) await writeException("Flapping", new Date(BASE));
    // Two evaluations breaching: still nothing, because `for` is three.
    await sweepTelemetryMonitors([tenantId], clock());
    await sweepTelemetryMonitors([tenantId], clock());
    expect(mine()).toHaveLength(0);

    // The third agrees, so it fires.
    await sweepTelemetryMonitors([tenantId], clock());
    expect(mine()).toHaveLength(1);
    expect(mine()[0]!.status).toBe("firing");

    // Far enough ahead that the window has moved past the fixtures: the
    // monitor counts nothing, and a recovery does not wait for `for`.
    received = [];
    await sweepTelemetryMonitors([tenantId], WELL_AFTER);
    const back = received.filter((a) => String(a.dedup_key).startsWith(`telemetry:${id}:`));
    expect(back).toHaveLength(1);
    expect(back[0]!.status).toBe("resolved");
    expect(String(back[0]!.title)).toContain("back to normal");
  });

  it("restarts the count when an evaluation disagrees", async () => {
    received = [];
    const id = await makeMonitor(`restarting ${run}`, {
      ...baseQuery,
      query: `service_name = '${service}' AND type = 'Intermittent'`,
      condition: { kind: "threshold", op: ">", value: 0 },
      forEvaluations: 2,
      groupBy: [],
    });
    const clock = laterEachTime();
    const mine = () => received.filter((a) => String(a.dedup_key).startsWith(`telemetry:${id}:`));

    await writeException("Intermittent", new Date(BASE));
    await sweepTelemetryMonitors([tenantId], clock()); // breaching, 1 of 2
    expect(mine()).toHaveLength(0);

    // Nothing in the window now, so the next evaluation disagrees and the
    // count starts again rather than carrying on to two.
    await sweepTelemetryMonitors([tenantId], WELL_AFTER);
    expect(mine()).toHaveLength(0);

    const [row] = await withTenant(tenantId, (tx) =>
      tx
        .select({ state: telemetryMonitorSeries.state, n: telemetryMonitorSeries.consecutive })
        .from(telemetryMonitorSeries)
        .where(
          and(
            eq(telemetryMonitorSeries.tenantId, tenantId),
            eq(telemetryMonitorSeries.monitorId, id),
          ),
        ),
    );
    expect(row?.state).toBe("ok");
    expect(row?.n).toBe(1);
  });

  it("keeps the alert pending when the pipeline could not be reached", async () => {
    received = [];
    const id = await makeMonitor(`unreachable ${run}`, {
      ...baseQuery,
      query: `service_name = '${service}' AND type = 'Unreachable'`,
      groupBy: [],
      forEvaluations: 1,
    });
    const clock = laterEachTime();
    const mine = () => received.filter((a) => String(a.dedup_key).startsWith(`telemetry:${id}:`));
    await writeException("Unreachable", new Date(BASE));

    // The ingest endpoint is down. Nothing is received, and — the point of the
    // test — the series must not record itself as breaching, or the next run
    // would see no change and never page at all.
    refuse = true;
    await sweepTelemetryMonitors([tenantId], clock());
    expect(mine()).toHaveLength(0);
    const [pending] = await withTenant(tenantId, (tx) =>
      tx
        .select({ state: telemetryMonitorSeries.state })
        .from(telemetryMonitorSeries)
        .where(
          and(
            eq(telemetryMonitorSeries.tenantId, tenantId),
            eq(telemetryMonitorSeries.monitorId, id),
          ),
        ),
    );
    expect(pending?.state).toBe("ok");

    // It comes back, and the very next run pages.
    refuse = false;
    await sweepTelemetryMonitors([tenantId], clock());
    expect(mine()).toHaveLength(1);
    expect(mine()[0]!.status).toBe("firing");
  });

  it("an anomaly rule with no history says learning rather than firing", async () => {
    received = [];
    const id = await makeMonitor(`unlearned ${run}`, {
      ...baseQuery,
      query: `service_name = '${service}' AND type = 'Novel'`,
      condition: { kind: "anomaly", direction: "any" },
      groupBy: [],
    });
    await writeException("Novel", new Date(BASE));
    await sweepTelemetryMonitors([tenantId], laterEachTime()());

    expect(received.filter((a) => String(a.dedup_key).startsWith(`telemetry:${id}:`))).toEqual([]);
    const [row] = await withTenant(tenantId, (tx) =>
      tx
        .select({ state: telemetryMonitorSeries.state, why: telemetryMonitorSeries.lastDetail })
        .from(telemetryMonitorSeries)
        .where(
          and(
            eq(telemetryMonitorSeries.tenantId, tenantId),
            eq(telemetryMonitorSeries.monitorId, id),
          ),
        ),
    );
    expect(row?.state).toBe("learning");
    expect(row?.why).toMatch(/history/);
  });

  it("silence is news only when the author said so", async () => {
    received = [];
    // An average over no rows is not a number, so the series is absent — which
    // is exactly the case the no-data policy answers. Logs, because that is
    // where a numeric field to average lives.
    const silence: TelemetryQuery = {
      ...baseQuery,
      query: `service_name = '${service}-absent'`,
      aggregate: "avg",
      field: "severity_number",
      groupBy: [],
      noData: "ignore",
    };
    const quiet = await makeMonitor(`silent-ignored ${run}`, silence, "logs");
    const loud = await makeMonitor(
      `silent-reported ${run}`,
      { ...silence, noData: "trigger" },
      "logs",
    );
    const clock = laterEachTime();
    await sweepTelemetryMonitors([tenantId], clock());

    expect(received.filter((a) => String(a.dedup_key).startsWith(`telemetry:${quiet}:`))).toEqual(
      [],
    );
    const raised = received.filter((a) => String(a.dedup_key).startsWith(`telemetry:${loud}:`));
    expect(raised).toHaveLength(1);
    expect(String(raised[0]!.title)).toContain("stopped reporting");
  });
});
