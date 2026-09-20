/**
 * BullMQ queues:
 * - mail-send        : transactional email — a link someone is waiting for
 * - mail-bulk        : the fan-out to a status page's subscribers
 * - update-reminders : nudges the lead when an incident's next update is overdue
 * - webhook-dispatch : outbound webhooks, signed POST with retries
 * - housekeeping     : purges (mail log 90 d)
 *
 * - escalation-tick  : the escalation engine's delayed ticks (one per transition)
 * - notify-send      : notifications to responders (email, SMS, voice, web push)
 * - oncall-sweep     : reconciler — due ticks, lost deliveries, shift reminders
 * - status-sweep     : maintenance windows on the clock, status page snapshots
 * - investigation    : one root cause assessment of an incident (declaration, signal, request)
 * - monitor-sweep    : runs the checks whose turn it is, and publishes state changes
 * - telemetry-monitors: evaluates the log, trace, metric and exception monitors
 * - service-map      : rolls traces up into the edges of the dependency map
 * - qa-run           : the repository's own test suites, on demand
 */
import { QA_QUEUE } from "@openincident/qa";

export const QUEUE_NAMES = [
  "mail-send",
  "mail-bulk",
  "update-reminders",
  "webhook-dispatch",
  "housekeeping",
  "escalation-tick",
  "notify-send",
  "oncall-sweep",
  "status-sweep",
  "tracker-sync",
  "heartbeat-sweep",
  "monitor-sweep",
  "telemetry-monitors",
  "service-map",
  "coverage-sweep",
  "runbook-sync",
  "investigation",
] as const;

export type QueueName = (typeof QUEUE_NAMES)[number];

/**
 * Two groups, and they are about deadlines rather than about subject matter.
 *
 * `urgent` is everything a person is waiting on, or that decides whether
 * someone gets woken up: the reset link, the escalation tick, the heartbeat
 * that has stopped. `bulk` is everything that can be a few minutes late without
 * anyone being able to tell: the subscriber fan-out, the purges, the nightly
 * syncs, the repository's own test suites.
 *
 * The groups exist so that an operator who needs to can run two processes — one
 * per group — without building a second image. On a small installation one
 * process still runs both, which is the default.
 */
export const QUEUE_GROUPS = ["urgent", "bulk"] as const;
export type QueueGroup = (typeof QUEUE_GROUPS)[number];

/**
 * The QA queue is declared by @openincident/qa, whose runner the worker calls.
 * It is re-exported rather than spelled again so the two cannot drift apart —
 * and it belongs in the table below, so an operator can exclude it: an
 * installation that is not a development machine has no use for a queue that
 * runs Playwright.
 */
export { QA_QUEUE as QA_QUEUE_NAME } from "@openincident/qa";
export type WorkQueue = QueueName | typeof QA_QUEUE;

type Shape = {
  group: QueueGroup;
  /**
   * Jobs in flight at once. Five was the flat value everywhere; it stays
   * wherever nothing was measured against it.
   */
  concurrency: number;
};

export const QUEUE_SHAPES: Record<WorkQueue, Shape> = {
  // Someone is waiting in front of a screen for these.
  "mail-send": { group: "urgent", concurrency: 5 },
  "notify-send": { group: "urgent", concurrency: 5 },
  "escalation-tick": { group: "urgent", concurrency: 5 },
  "webhook-dispatch": { group: "urgent", concurrency: 5 },
  investigation: { group: "urgent", concurrency: 5 },

  /*
   * The scheduled sweeps run one job at a time, on purpose.
   *
   * A scheduler produces one job per tick, so five slots were never five
   * sweeps — except when a sweep overran its period, and then they were.
   * Fifteen days of recorded runs show monitor-sweep taking up to 32.7 s
   * against a 30 s schedule, which means two sweeps really did run at once and
   * checked every monitor twice. One slot makes the next tick wait instead,
   * which is the honest outcome: late is a fact, checked twice is a lie.
   */
  "oncall-sweep": { group: "urgent", concurrency: 1 },
  "heartbeat-sweep": { group: "urgent", concurrency: 1 },
  "monitor-sweep": { group: "urgent", concurrency: 1 },
  // Same reason, a different bottleneck: two evaluations at once would read
  // the same month of history from the column store twice.
  "telemetry-monitors": { group: "urgent", concurrency: 1 },
  // Not urgent — the map is read by people looking at a screen, never by
  // something deciding whether to wake somebody — but one at a time, because
  // two ticks would roll up the same minute twice.
  "service-map": { group: "bulk", concurrency: 1 },
  "status-sweep": { group: "urgent", concurrency: 1 },
  "update-reminders": { group: "urgent", concurrency: 1 },
  "coverage-sweep": { group: "bulk", concurrency: 1 },

  /*
   * The fan-out, and five is deliberate rather than inherited.
   *
   * Its ceiling is the transport: the pool holds SMTP_MAX_CONNECTIONS
   * connections whatever this number says, and measured against a relay 50 ms
   * away the fan-out drained at 21.5, 22.8 and 22.7 messages a second at five,
   * ten and twenty slots. Six per cent, for twenty slots instead of five.
   *
   * What those extra slots do cost is the thing the split was for. Both mail
   * queues send through the same pool, so a bulk job holding a connection is a
   * transactional job not holding one: in the same runs, a transactional email
   * took 274 ms with five bulk slots, 540 ms with ten and 933 ms with twenty.
   * Matching the number of slots to the number of connections is what keeps the
   * queue separation from being handed straight back to nodemailer.
   */
  "mail-bulk": { group: "bulk", concurrency: 5 },
  housekeeping: { group: "bulk", concurrency: 1 },
  "tracker-sync": { group: "bulk", concurrency: 1 },
  "runbook-sync": { group: "bulk", concurrency: 1 },
  // One suite at a time: the smoke suite's mocks bind fixed ports, and two
  // Playwright runs against the same instance would trip over each other.
  [QA_QUEUE]: { group: "bulk", concurrency: 1 },
};

export const WORK_QUEUES = Object.keys(QUEUE_SHAPES) as WorkQueue[];

/**
 * Which queues this process serves, from `WORKER_QUEUES`.
 *
 * Unset — the default, and the one a `docker compose up` gets — means all of
 * them: nobody should have to run two containers to send an email. Otherwise a
 * comma-separated list of group names (`urgent`, `bulk`) and queue names, so
 * splitting the load is a variable rather than a second image.
 *
 * An unknown name is refused rather than ignored. A typo that silently drops a
 * queue is a queue nobody serves, and the symptom would be jobs that are
 * accepted and never run.
 */
export function selectedQueues(spec = process.env.WORKER_QUEUES): WorkQueue[] {
  const wanted = (spec ?? "").trim();
  if (!wanted || wanted === "all") return WORK_QUEUES;
  const chosen = new Set<WorkQueue>();
  for (const raw of wanted.split(",")) {
    const token = raw.trim();
    if (!token) continue;
    if ((QUEUE_GROUPS as readonly string[]).includes(token)) {
      for (const q of WORK_QUEUES) if (QUEUE_SHAPES[q].group === token) chosen.add(q);
    } else if ((WORK_QUEUES as string[]).includes(token)) {
      chosen.add(token as WorkQueue);
    } else {
      throw new Error(
        `WORKER_QUEUES: "${token}" is neither a group (${QUEUE_GROUPS.join(", ")}) ` +
          `nor a queue (${WORK_QUEUES.join(", ")}).`,
      );
    }
  }
  if (!chosen.size) throw new Error("WORKER_QUEUES selects no queue at all.");
  return WORK_QUEUES.filter((q) => chosen.has(q));
}

/**
 * Jobs in flight per queue, from `WORKER_CONCURRENCY`.
 *
 * A bare number is the flat value for everything, which is what this worker did
 * before anything was measured. `default=5,mail-bulk=16` overrides one queue
 * and leaves the rest alone — the form that lets an operator give the fan-out
 * its own process and its own width without touching the code.
 */
export function concurrencyFor(queue: WorkQueue, spec = process.env.WORKER_CONCURRENCY): number {
  const own = QUEUE_SHAPES[queue].concurrency;
  const wanted = (spec ?? "").trim();
  if (!wanted) return own;
  const flat = Number(wanted);
  if (Number.isFinite(flat)) {
    if (flat < 1) throw new Error(`WORKER_CONCURRENCY: ${wanted} is not a number of jobs.`);
    return flat;
  }
  let fallback = own;
  for (const pair of wanted.split(",")) {
    const [name, value] = pair.split("=").map((s) => s.trim());
    const n = Number(value);
    if (!name || !Number.isFinite(n) || n < 1)
      throw new Error(`WORKER_CONCURRENCY: "${pair}" is not "<queue|default>=<number>".`);
    if (name === queue) return n;
    if (name === "default") fallback = n;
    else if (!(WORK_QUEUES as string[]).includes(name))
      throw new Error(`WORKER_CONCURRENCY: "${name}" is not a queue.`);
  }
  return fallback;
}
