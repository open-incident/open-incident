/**
 * Queue latency harness — what the worker makes people wait for.
 *
 * It answers one question with numbers rather than with an opinion: does a
 * transactional email (an invitation, a reset link) still leave in seconds
 * while a status page fans out to its subscribers? And it answers it on the
 * product's real path — `sendTenantEmail`, the real BullMQ queues, the real
 * SMTP transport — so the figure is the one a person would experience, not the
 * one a microbenchmark would produce.
 *
 * Three phases:
 *   idle    — probes alone, nothing else in flight: the floor.
 *   loaded  — the same probes while a subscriber fan-out drains: the symptom.
 *   drain   — the tail of the fan-out, so the next run starts from zero.
 *
 * Every probe is broken down, so "where does the time go" is read and never
 * inferred:
 *   producer = the caller's own cost, client clock (outbox row + enqueue)
 *   wait     = BullMQ processedOn − job timestamp (time spent queued)
 *   send     = Mailpit's arrival − processedOn (the job's own work)
 *   after    = finishedOn − arrival (bookkeeping once the mail is gone)
 * Mailpit stamps arrivals with the container's clock; the offset is measured
 * with a throwaway message and subtracted, because an unmeasured skew of even
 * a second would swamp everything reported here.
 *
 * The scheduled sweeps come from the same run at no cost: BullMQ puts the
 * millisecond a repeated job was due at in its id, so drift is `processedOn`
 * minus that, with no instrumentation inside the sweep.
 *
 * Requires a worker on the same Redis, and Mailpit as the SMTP transport:
 *   set -a; source .env; set +a
 *   BASE_DOMAIN=localhost:3106 pnpm --filter @openincident/worker bench
 *
 * Knobs (all optional): BENCH_TENANT, BENCH_BULK, BENCH_ROUNDS, BENCH_PROBES,
 * BENCH_PROBE_GAP_MS, BENCH_BULK_CLASS. The last one forces the fan-out onto
 * the transactional queue, which is what this product did before the classes
 * were split — it is how a "before" run is reproduced.
 */
import { Queue, type Job } from "bullmq";
import IORedis from "ioredis";
import { and, eq, like } from "drizzle-orm";
import { getTenantBySlug, mailDeliveries, withTenant } from "@openincident/db";
import {
  mailQueueForClass,
  sendInstanceEmail,
  sendTenantEmail,
  type MailClass,
  type MailSendJob,
} from "@openincident/mail";

const REDIS_URL = process.env.REDIS_URL ?? "redis://localhost:6381";
const MAILPIT = process.env.BENCH_MAILPIT_URL ?? "http://127.0.0.1:8027";
const TENANT_SLUG = process.env.BENCH_TENANT ?? "skylark";
/** The demo workspace's subscriber count, so the fan-out is the real one. */
const BULK = Number(process.env.BENCH_BULK ?? 128);
/** Publications in a row. One fan-out is over in seconds; a sweep ticks every 30. */
const ROUNDS = Number(process.env.BENCH_ROUNDS ?? 4);
const PROBES = Number(process.env.BENCH_PROBES ?? 6);
/** Spacing between probes: long enough that two probes never measure each other. */
const PROBE_GAP_MS = Number(process.env.BENCH_PROBE_GAP_MS ?? 5_000);
const BULK_CLASS = (process.env.BENCH_BULK_CLASS ?? "bulk") as MailClass;
const ARRIVAL_TIMEOUT_MS = Number(process.env.BENCH_ARRIVAL_TIMEOUT_MS ?? 300_000);
/** Sweeps whose drift is reported. All three are scheduled every 30 s. */
const SWEEPS = (process.env.BENCH_SWEEPS ?? "heartbeat-sweep,monitor-sweep,oncall-sweep").split(
  ",",
);

const RUN_ID = `bench-${Date.now().toString(36)}`;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

type Sent = {
  deliveryId: string;
  subject: string;
  /** Client clock, before the call and after it returns. */
  calledAt: number;
  returnedAt: number;
  arrivedAt?: number;
  jobTimestamp?: number;
  processedOn?: number;
  finishedOn?: number;
};
type Probe = Sent & { phase: "idle" | "loaded"; n: number };

/* ---------- Mailpit ---------- */

type MailpitMessage = { ID: string; Subject: string; Created: string };

async function mailpitSearch(query: string): Promise<MailpitMessage[]> {
  const res = await fetch(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(query)}&limit=2000`);
  if (!res.ok) throw new Error(`mailpit search ${res.status}`);
  return ((await res.json()) as { messages: MailpitMessage[] }).messages ?? [];
}

async function mailpitDelete(ids: string[]): Promise<void> {
  for (let i = 0; i < ids.length; i += 500) {
    await fetch(`${MAILPIT}/api/v1/messages`, {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ IDs: ids.slice(i, i + 500) }),
    });
  }
}

async function measureClockSkew(): Promise<{ skew: number; uncertainty: number }> {
  // Mailpit stores the message somewhere between the call and its return, so
  // one probe brackets the offset to the width of a send. Several probes
  // intersect their brackets, and the result is reported with the width that
  // is left — a skew quoted without its precision is a number to distrust.
  let low = -Infinity;
  let high = Infinity;
  for (let n = 0; n < 8; n++) {
    const subject = `${RUN_ID}-skew-${n}`;
    const before = Date.now();
    await sendInstanceEmail({ to: "skew@bench.invalid", subject, text: "clock skew probe" });
    const after = Date.now();
    let created: number | null = null;
    for (let i = 0; i < 100 && created === null; i++) {
      const [hit] = await mailpitSearch(`subject:${subject}`);
      if (hit) {
        created = new Date(hit.Created).getTime();
        await mailpitDelete([hit.ID]);
      } else await sleep(100);
    }
    if (created === null)
      throw new Error("Mailpit never received the clock-skew probe — is SMTP pointed at it?");
    low = Math.max(low, created - after);
    high = Math.min(high, created - before);
  }
  return { skew: (low + high) / 2, uncertainty: (high - low) / 2 };
}

/* ---------- BullMQ ---------- */

/**
 * The jobs that carried these deliveries, whichever mail queue they went
 * through. Read after the fact rather than followed live: watching a queue from
 * this process would add traffic to the very Redis the measurement is about.
 */
async function findMailJobs(deliveryIds: Set<string>): Promise<Map<string, Job>> {
  const found = new Map<string, Job>();
  const connection = new IORedis(REDIS_URL, { maxRetriesPerRequest: null });
  const names = new Set([mailQueueForClass("transactional"), mailQueueForClass("bulk")]);
  for (const name of names) {
    const queue = new Queue(name, { connection });
    const jobs = await queue.getJobs(["completed", "failed"], 0, 5_000);
    for (const job of jobs) {
      const id = (job.data as MailSendJob | undefined)?.deliveryId;
      if (id && deliveryIds.has(id)) found.set(id, job);
    }
    await queue.close();
  }
  await connection.quit();
  return found;
}

type SweepRun = { scheduledAt: number; drift: number; execution: number | null };

/**
 * Drift of the scheduled sweeps inside a window. A repeated job's id ends with
 * the millisecond it was meant to run at, and that is the only reference that
 * does not move when the worker is late — `timestamp` is when BullMQ created
 * the delayed job, not when the job was due.
 */
async function sweepRuns(queue: string, from: number, to: number): Promise<SweepRun[]> {
  const connection = new IORedis(REDIS_URL, { maxRetriesPerRequest: null });
  const keys: string[] = [];
  let cursor = "0";
  do {
    const [next, batch] = await connection.scan(
      cursor,
      "MATCH",
      `bull:${queue}:repeat:*`,
      "COUNT",
      1_000,
    );
    cursor = next;
    for (const k of batch) {
      const at = Number(/:(\d+)$/.exec(k)?.[1]);
      if (Number.isFinite(at) && at >= from && at <= to) keys.push(k);
    }
  } while (cursor !== "0");

  const runs: SweepRun[] = [];
  const pipe = connection.pipeline();
  for (const k of keys) pipe.hmget(k, "processedOn", "finishedOn");
  const res = (await pipe.exec()) ?? [];
  res.forEach(([, value], i) => {
    const [processedOn, finishedOn] = value as (string | null)[];
    if (!processedOn) return;
    const scheduledAt = Number(/:(\d+)$/.exec(keys[i]!)?.[1]);
    runs.push({
      scheduledAt,
      drift: Number(processedOn) - scheduledAt,
      execution: finishedOn ? Number(finishedOn) - Number(processedOn) : null,
    });
  });
  await connection.quit();
  return runs.sort((a, b) => a.scheduledAt - b.scheduledAt);
}

/* ---------- Statistics ---------- */

function quantile(values: number[], q: number): number {
  if (!values.length) return NaN;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))]!;
}
const ms = (n: number) => (Number.isFinite(n) ? `${Math.round(n)}` : "—");
const span = (v: number[]) =>
  v.length
    ? `n=${v.length} p50=${ms(quantile(v, 0.5))} p90=${ms(quantile(v, 0.9))} max=${ms(Math.max(...v))}`
    : "n=0";

/* ---------- The run ---------- */

async function main() {
  const tenant = await getTenantBySlug(TENANT_SLUG);
  if (!tenant) throw new Error(`No workspace "${TENANT_SLUG}"`);

  const { skew, uncertainty } = await measureClockSkew();
  console.log(
    `# ${RUN_ID}  workspace=${TENANT_SLUG}  fan-out=${BULK}×${ROUNDS} on "${mailQueueForClass(BULK_CLASS)}"` +
      `  probes on "${mailQueueForClass("transactional")}"`,
  );
  console.log(
    `# Mailpit clock offset ${ms(skew)} ± ${ms(uncertainty)} ms, subtracted from every arrival`,
  );

  const probes: Probe[] = [];
  const bulk: Sent[] = [];

  /*
   * Arrivals are collected from the first message on, not once the run is over.
   * Mailpit keeps its last five hundred messages and a fan-out of five hundred
   * and twelve is more than that: read afterwards, the idle probes had already
   * been evicted by the load they were the control for. The poller also spreads
   * its own cost over the run instead of concentrating it at the end.
   */
  const awaiting = new Map<string, Sent>();
  const mailpitIds = new Set<string>();
  let collecting = true;
  const collector = (async () => {
    while (collecting || awaiting.size) {
      for (const message of await mailpitSearch(`subject:"${RUN_ID}"`)) {
        mailpitIds.add(message.ID);
        const s = awaiting.get(message.Subject);
        if (!s) continue;
        s.arrivedAt = new Date(message.Created).getTime() - skew;
        awaiting.delete(message.Subject);
      }
      if (!collecting && !awaiting.size) return;
      await sleep(300);
    }
  })();

  /** One transactional probe: exactly what sending an invitation does. */
  async function probe(phase: Probe["phase"], n: number): Promise<void> {
    const subject = `${RUN_ID} ${phase} probe ${n}`;
    const calledAt = Date.now();
    const sent = await sendTenantEmail({
      tenantId: tenant!.id,
      to: `probe-${n}@bench.invalid`,
      subject,
      text: `Transactional probe ${n}. ${RUN_ID}`,
      kind: "invitation",
      ref: RUN_ID,
    });
    const p: Probe = {
      phase,
      n,
      deliveryId: sent.deliveryId,
      subject,
      calledAt,
      returnedAt: Date.now(),
    };
    probes.push(p);
    awaiting.set(subject, p);
  }

  const startedAt = Date.now();

  console.log(`\n--- 1/3 idle: ${PROBES} probes, ${PROBE_GAP_MS} ms apart`);
  for (let i = 0; i < PROBES; i++) {
    await probe("idle", i);
    await sleep(PROBE_GAP_MS);
  }
  const idleEndedAt = Date.now();

  console.log(
    `--- 2/3 loaded: ${ROUNDS} publication(s) of ${BULK} subscribers, probes interleaved`,
  );
  const loadStartedAt = Date.now();
  let fanOutDone = false;
  // Sequential, one awaited call at a time, because that is how
  // publishIncidentUpdate writes it: 128 subscribers, 128 awaited sends.
  const fanOut = (async () => {
    for (let round = 0; round < ROUNDS; round++) {
      for (let i = 0; i < BULK; i++) {
        const subject = `${RUN_ID} bulk ${round}-${i}`;
        const calledAt = Date.now();
        const sent = await sendTenantEmail({
          tenantId: tenant!.id,
          to: `subscriber-${i}@bench.invalid`,
          subject,
          text: `Subscriber update ${i}. ${RUN_ID}`,
          kind: "other",
          class: BULK_CLASS,
          ref: RUN_ID,
        }).catch(() => null);
        if (sent) {
          const b: Sent = {
            deliveryId: sent.deliveryId,
            subject,
            calledAt,
            returnedAt: Date.now(),
          };
          bulk.push(b);
          awaiting.set(subject, b);
        }
      }
    }
    fanOutDone = true;
    return Date.now() - loadStartedAt;
  })();
  // The first probe goes in once the fan-out has had a moment to fill the
  // queue: a probe enqueued at the same instant as job 1 measures nothing.
  await sleep(500);
  for (let i = 0; !fanOutDone || i < PROBES; i++) {
    await probe("loaded", i);
    await sleep(PROBE_GAP_MS);
  }
  const producerMs = await fanOut;

  console.log(`--- 3/3 draining`);
  const deadline = Date.now() + ARRIVAL_TIMEOUT_MS;
  while (awaiting.size && Date.now() < deadline) await sleep(300);
  collecting = false;
  await collector;
  if (awaiting.size) console.log(`    ! ${awaiting.size} message(s) never arrived`);
  const endedAt = Date.now();

  /* ---------- Report ---------- */

  const jobs = await findMailJobs(new Set([...probes, ...bulk].map((s) => s.deliveryId)));
  for (const s of [...probes, ...bulk]) {
    const job = jobs.get(s.deliveryId);
    if (!job) continue;
    s.jobTimestamp = job.timestamp;
    s.processedOn = job.processedOn ?? undefined;
    s.finishedOn = job.finishedOn ?? undefined;
  }
  const e2e = (s: Sent) => (s.arrivedAt ? s.arrivedAt - s.calledAt : NaN);
  const wait = (s: Sent) =>
    s.processedOn && s.jobTimestamp ? s.processedOn - s.jobTimestamp : NaN;
  const send = (s: Sent) => (s.processedOn && s.arrivedAt ? s.arrivedAt - s.processedOn : NaN);
  const after = (s: Sent) => (s.finishedOn && s.arrivedAt ? s.finishedOn - s.arrivedAt : NaN);
  const finite = (xs: number[]) => xs.filter(Number.isFinite);

  console.log(`\n=== transactional probes, ms`);
  console.log(`phase    #  end-to-end  producer  queue wait   send  after`);
  for (const p of probes)
    console.log(
      `${p.phase.padEnd(7)}${String(p.n).padStart(3)}  ${ms(e2e(p)).padStart(10)}  ` +
        `${ms(p.returnedAt - p.calledAt).padStart(8)}  ${ms(wait(p)).padStart(10)}  ` +
        `${ms(send(p)).padStart(5)}  ${ms(after(p)).padStart(5)}`,
    );
  for (const phase of ["idle", "loaded"] as const) {
    const of = probes.filter((p) => p.phase === phase);
    console.log(
      `${phase.padEnd(7)} end-to-end ${span(finite(of.map(e2e)))}` +
        `  |  queue wait ${span(finite(of.map(wait)))}`,
    );
  }

  console.log(`\n=== the fan-out itself (${bulk.length} messages)`);
  console.log(`producer loop, ${ROUNDS}×${BULK} awaited sendTenantEmail   ${producerMs} ms`);
  console.log(
    `producer cost per message                     ${span(finite(bulk.map((s) => s.returnedAt - s.calledAt)))}`,
  );
  console.log(`queue wait                                    ${span(finite(bulk.map(wait)))}`);
  console.log(`send (pick-up → in the mailbox)               ${span(finite(bulk.map(send)))}`);
  const lastArrival = Math.max(...finite(bulk.map((s) => s.arrivedAt ?? NaN)));
  console.log(
    `first enqueue → last subscriber served        ${Math.round(lastArrival - loadStartedAt)} ms`,
  );
  const delivered = finite(bulk.map((s) => s.arrivedAt ?? NaN)).length;
  console.log(
    `throughput                                    ${(delivered / ((lastArrival - loadStartedAt) / 1000)).toFixed(1)} mail/s`,
  );

  console.log(`\n=== scheduled sweeps, ms late against the tick they were due at`);
  for (const name of SWEEPS) {
    const idle = await sweepRuns(name, startedAt, idleEndedAt);
    const loaded = await sweepRuns(name, loadStartedAt, endedAt);
    console.log(
      `${name.padEnd(16)} idle drift ${span(idle.map((r) => r.drift))}\n` +
        `${" ".repeat(16)} busy drift ${span(loaded.map((r) => r.drift))}\n` +
        `${" ".repeat(16)} busy exec  ${span(finite(loaded.map((r) => r.execution ?? NaN)))}`,
    );
  }

  /* ---------- Cleanup ---------- */

  // The bench writes into a real workspace's outbox and a real mailbox. It
  // takes both back: a demo instance that has to be explained is not a demo.
  await mailpitDelete([...mailpitIds]);
  for (let i = 0; i < 10; i++) {
    const rest = await mailpitSearch(`subject:"${RUN_ID}"`);
    if (!rest.length) break;
    await mailpitDelete(rest.map((m) => m.ID));
  }
  const removed = await withTenant(tenant.id, (tx) =>
    tx
      .delete(mailDeliveries)
      .where(and(eq(mailDeliveries.tenantId, tenant.id), like(mailDeliveries.ref, `${RUN_ID}%`))),
  );
  console.log(`\n# cleaned up: ${removed.count ?? 0} outbox row(s), ${mailpitIds.size} message(s)`);
  process.exit(0);
}

await main();
