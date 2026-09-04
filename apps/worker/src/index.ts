import { Queue, Worker, type Processor } from "bullmq";
import IORedis from "ioredis";
import { and, eq, isNull, lt } from "drizzle-orm";
import {
  incidentEvents,
  incidents,
  listLiveTenants,
  mailDeliveries,
  members,
  roleAssignments,
  incidentRoles,
  withTenant,
} from "@openincident/db";
import { deliverEmail, type MailSendJob } from "@openincident/mail";
import { deliverWebhookJob, type WebhookJob } from "@openincident/webhooks";
import {
  advanceEscalation,
  deliverNotification,
  jobFromDelivery,
  sweepCoverageReminders,
  sweepEscalations,
  sweepHeartbeats,
  sweepShiftReminders,
  type NotifyJob,
  type TickJob,
} from "@openincident/oncall";
import { notificationDeliveries } from "@openincident/db";
import { sweepMaintenances } from "@openincident/statuspages";
import { assertStorageConfig } from "@openincident/storage";
import { sweepRunbooks } from "@openincident/ai";
import { syncTrackerStatuses } from "@openincident/trackers";
import { QA_QUEUE, type QaJob } from "@openincident/qa";
import { runQaJob } from "@openincident/qa/runner";
import { QUEUE_NAMES, type QueueName } from "./queues";

// A partial S3_* set is a mistake to stop on, not to discover at the first upload.
assertStorageConfig();

const connection = new IORedis(process.env.REDIS_URL ?? "redis://localhost:6381", {
  // Required by BullMQ: commands must not be dropped during a reconnection.
  maxRetriesPerRequest: null,
});

const DAY_MS = 24 * 3600 * 1000;

/**
 * Overdue status updates → one timeline event per incident, once per deadline.
 *
 * The reminder is a job, not a promise of UI: the incident row carries the
 * deadline (`next_update_due_at`), this sweep reads it, writes the reminder as
 * a system event and clears the deadline so the same one never fires twice.
 * Every tenant is swept inside its own context — the worker holds no bypass.
 */
async function sweepUpdateReminders(): Promise<number> {
  let reminded = 0;
  for (const tenant of await listLiveTenants()) {
    reminded += await withTenant(tenant.id, async (tx) => {
      const due = await tx
        .select({ id: incidents.id, number: incidents.number, dueAt: incidents.nextUpdateDueAt })
        .from(incidents)
        .where(
          and(
            eq(incidents.tenantId, tenant.id),
            eq(incidents.phase, "active"),
            lt(incidents.nextUpdateDueAt, new Date()),
          ),
        );
      for (const inc of due) {
        const [lead] = await tx
          .select({ memberId: roleAssignments.memberId, name: members.name })
          .from(roleAssignments)
          .innerJoin(
            incidentRoles,
            and(eq(incidentRoles.id, roleAssignments.roleId), eq(incidentRoles.isLead, true)),
          )
          .innerJoin(members, eq(members.id, roleAssignments.memberId))
          .where(eq(roleAssignments.incidentId, inc.id));
        await tx.insert(incidentEvents).values({
          tenantId: tenant.id,
          incidentId: inc.id,
          kind: "note",
          actorKind: "system",
          payload: {
            system: "update_overdue",
            dueAt: inc.dueAt?.toISOString(),
            lead: lead?.name ?? null,
          },
        });
        await tx.update(incidents).set({ nextUpdateDueAt: null }).where(eq(incidents.id, inc.id));
      }
      return due.length;
    });
  }
  return reminded;
}

/**
 * Lost notification jobs: a delivery still queued well past its send time has
 * no job left in Redis (restart, eviction). The row carries enough to replay it.
 */
async function sweepQueuedNotifications(): Promise<number> {
  let replayed = 0;
  for (const tenant of await listLiveTenants()) {
    const stale = await withTenant(tenant.id, (tx) =>
      tx
        .select({ id: notificationDeliveries.id })
        .from(notificationDeliveries)
        .where(
          and(
            eq(notificationDeliveries.tenantId, tenant.id),
            eq(notificationDeliveries.status, "queued"),
            lt(notificationDeliveries.sendAfter, new Date(Date.now() - 2 * 60_000)),
          ),
        )
        .limit(100),
    );
    for (const d of stale) {
      const job = await jobFromDelivery(tenant.id, d.id);
      if (!job) continue;
      await deliverNotification(job);
      replayed++;
    }
  }
  return replayed;
}

/** Processors, one per queue. */
const processors: Record<QueueName, Processor> = {
  "escalation-tick": async (job) => {
    const data = job.data as TickJob;
    await advanceEscalation(data.tenantId, data.escalationId);
  },
  "notify-send": async (job) => {
    const data = job.data as NotifyJob;
    const result = await deliverNotification(data);
    // A failed provider call is retried by BullMQ; "handled" (acknowledged meanwhile) is final.
    if (result.status === "failed") throw new Error(result.error ?? "notification failed");
    console.log(`[notify-send] ${data.channel} ${result.status}`);
  },
  "status-sweep": async () => {
    const tenants = (await listLiveTenants()).map((t) => t.id);
    const n = await sweepMaintenances(tenants);
    if (n) console.log(`[status-sweep] ${n} maintenance transition(s)`);
  },
  "runbook-sync": async () => {
    const tenants = (await listLiveTenants()).map((t) => t.id);
    const n = await sweepRunbooks(tenants);
    if (n) console.log(`[runbook-sync] ${n} runbook(s) changed`);
  },
  "coverage-sweep": async () => {
    const tenants = (await listLiveTenants()).map((t) => t.id);
    const n = await sweepCoverageReminders(tenants);
    if (n) console.log(`[coverage-sweep] ${n} reminder(s) sent`);
  },
  "heartbeat-sweep": async () => {
    const tenants = (await listLiveTenants()).map((t) => t.id);
    const n = await sweepHeartbeats(tenants);
    if (n) console.log(`[heartbeat-sweep] ${n} heartbeat(s) missed`);
  },
  "tracker-sync": async () => {
    // Issue trackers: a closed issue marks its follow-up done. Per tenant, failures isolated.
    let completed = 0;
    for (const t of await listLiveTenants()) {
      const r = await syncTrackerStatuses(t.id).catch((err) => {
        console.error(
          `[tracker-sync] ${t.slug ?? t.id}:`,
          err instanceof Error ? err.message : err,
        );
        return { checked: 0, completed: 0, errors: 1 };
      });
      completed += r.completed;
    }
    if (completed) console.log(`[tracker-sync] ${completed} follow-up(s) completed from trackers`);
  },
  "oncall-sweep": async () => {
    const tenants = (await listLiveTenants()).map((t) => t.id);
    const ticked = await sweepEscalations(tenants);
    const replayed = await sweepQueuedNotifications();
    const reminded = await sweepShiftReminders(tenants);
    if (ticked || replayed || reminded)
      console.log(
        `[oncall-sweep] ${ticked} tick(s), ${replayed} replayed delivery(ies), ${reminded} shift reminder(s)`,
      );
  },
  "mail-send": async (job) => {
    const data = job.data as MailSendJob;
    const result = await deliverEmail(data);
    // Throwing lets BullMQ retry with its exponential backoff; a delivery closed
    // on purpose (suspended workspace) is final and must not be retried.
    if (!result.delivered && !result.handled) throw new Error(result.error ?? "send failed");
    console.log(
      `[mail-send] delivery ${data.deliveryId} ${result.delivered ? "sent" : `handled (${result.error})`}`,
    );
  },
  "webhook-dispatch": async (job) => {
    const data = job.data as WebhookJob;
    const { httpStatus, ok } = await deliverWebhookJob(data);
    // Throwing lets BullMQ retry with its backoff; a 2xx, or an endpoint that
    // no longer exists, is final.
    if (!ok) throw new Error(`webhook responded ${httpStatus ?? "nothing"}`);
    console.log(`[webhook-dispatch] ${data.event} → ${httpStatus}`);
  },
  "update-reminders": async () => {
    const n = await sweepUpdateReminders();
    if (n) console.log(`[update-reminders] ${n} overdue update(s) flagged`);
  },
  housekeeping: async () => {
    // 90-day retention of the mail log, per workspace.
    for (const tenant of await listLiveTenants()) {
      await withTenant(tenant.id, (tx) =>
        tx
          .delete(mailDeliveries)
          .where(
            and(
              eq(mailDeliveries.tenantId, tenant.id),
              lt(mailDeliveries.createdAt, new Date(Date.now() - 90 * DAY_MS)),
              isNull(mailDeliveries.error),
            ),
          ),
      );
    }
    console.log("[housekeeping] purges done");
  },
};

const workers = QUEUE_NAMES.map(
  (name) => new Worker(name, processors[name], { connection, concurrency: 5 }),
);
// QA: one suite at a time — the smoke suite's mocks bind fixed ports, and two
// Playwright runs against the same instance would trip over each other.
workers.push(
  new Worker(
    QA_QUEUE,
    async (job) => {
      await runQaJob(job.data as QaJob);
    },
    { connection, concurrency: 1, lockDuration: 120_000 },
  ),
);

for (const w of workers) {
  w.on("failed", (job, err) => {
    console.error(`[${w.name}] job ${job?.id} failed:`, err.message);
  });
}

/** Periodic sweeps — repeatable BullMQ schedulers (idempotent). */
async function registerSchedulers() {
  const schedules: Array<[QueueName, number]> = [
    ["update-reminders", 60_000],
    ["oncall-sweep", 30_000],
    ["status-sweep", 60_000],
    ["tracker-sync", 300_000],
    ["heartbeat-sweep", 30_000],
    ["coverage-sweep", 6 * 3_600_000],
    ["runbook-sync", 6 * 3_600_000],
    ["housekeeping", DAY_MS],
  ];
  for (const [name, every] of schedules) {
    const queue = new Queue(name, { connection });
    await queue.upsertJobScheduler(`${name}-tick`, { every });
    await queue.close();
    console.log(`[scheduler] ${name} every ${Math.round(every / 1000)} s`);
  }
}

await registerSchedulers();
console.log(`Open Incident worker started — queues: ${QUEUE_NAMES.join(", ")}, ${QA_QUEUE}`);

async function shutdown() {
  console.log("Stopping the worker…");
  await Promise.all(workers.map((w) => w.close()));
  await connection.quit();
  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
