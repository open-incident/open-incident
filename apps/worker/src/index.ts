import { Queue, Worker, type Processor } from "bullmq";
import IORedis from "ioredis";
import { and, eq, isNotNull, isNull, lt } from "drizzle-orm";
import {
  incidentEvents,
  incidents,
  listLiveTenants,
  mailDeliveries,
  memberNotifications,
  members,
  monitorChecks,
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
  sweepMonitors,
  sweepTelemetryMonitors,
  sweepShiftReminders,
  isSyntheticResult,
  type NotifyJob,
  type TickJob,
} from "@openincident/oncall";
import { notificationDeliveries } from "@openincident/db";
import { sweepMaintenances } from "@openincident/statuspages";
import { assertStorageConfig, deleteObject, storageConfigured } from "@openincident/storage";
import { sweepRunbooks } from "@openincident/ai";
import { runInvestigation, type InvestigationJob } from "@openincident/investigations";
import { syncTrackerStatuses } from "@openincident/trackers";
import { QA_QUEUE, type QaJob } from "@openincident/qa";
import { runQaJob } from "@openincident/qa/runner";
import {
  QA_QUEUE_NAME,
  WORK_QUEUES,
  concurrencyFor,
  selectedQueues,
  type QueueName,
  type WorkQueue,
} from "./queues";

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

/** Sending one logged delivery. The two mail queues differ only in urgency. */
function sendMail(queue: string): Processor {
  return async (job) => {
    const data = job.data as MailSendJob;
    const result = await deliverEmail(data);
    // Throwing lets BullMQ retry with its exponential backoff; a delivery closed
    // on purpose (suspended workspace) is final and must not be retried.
    if (!result.delivered && !result.handled) throw new Error(result.error ?? "send failed");
    console.log(
      `[${queue}] delivery ${data.deliveryId} ${result.delivered ? "sent" : `handled (${result.error})`}`,
    );
  };
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
  investigation: async (job) => {
    // One assessment; the engine writes its own outcome, so nothing here is retried.
    const data = job.data as InvestigationJob;
    await runInvestigation(data);
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
  "monitor-sweep": async () => {
    const tenants = (await listLiveTenants()).map((t) => t.id);
    const n = await sweepMonitors(tenants);
    if (n) console.log(`[monitor-sweep] ${n} monitor state change(s) published`);
  },
  "telemetry-monitors": async () => {
    const tenants = (await listLiveTenants()).map((t) => t.id);
    const r = await sweepTelemetryMonitors(tenants);
    if (r.evaluated || r.failed)
      console.log(
        `[telemetry-monitors] ${r.evaluated} evaluated, ${r.published} alert(s), ${r.failed} failed`,
      );
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
  "mail-send": sendMail("mail-send"),
  // Same work, its own queue and its own slots: see MailClass. The fan-out to a
  // status page's subscribers must not be able to sit in front of a reset link.
  "mail-bulk": sendMail("mail-bulk"),
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
    // 90-day retention, per workspace: the mail log, and the bell. Neither is
    // an archive — the audit log is what keeps a record.
    //
    // A monitor's raw checks and the screenshots of its failures go at 30 days,
    // together. The day rollup is what the ninety-day bars and the uptime
    // figure are made of; the raw rows exist for the recent list and the last
    // day's latency chart, and a monitor checked every minute writes half a
    // million of them a year that nobody reads. They leave with their pictures
    // rather than after them, so no row is ever left pointing at an object that
    // is gone.
    const cutoff = new Date(Date.now() - 90 * DAY_MS);
    const checkCutoff = new Date(Date.now() - 30 * DAY_MS);
    for (const tenant of await listLiveTenants()) {
      await withTenant(tenant.id, async (tx) => {
        await tx
          .delete(mailDeliveries)
          .where(
            and(
              eq(mailDeliveries.tenantId, tenant.id),
              lt(mailDeliveries.createdAt, cutoff),
              isNull(mailDeliveries.error),
            ),
          );
        await tx
          .delete(memberNotifications)
          .where(
            and(
              eq(memberNotifications.tenantId, tenant.id),
              lt(memberNotifications.createdAt, cutoff),
            ),
          );
        // The pictures first: an object outlives its row otherwise, and
        // nothing would ever name it again.
        if (storageConfigured()) {
          const shots = await tx
            .select({ id: monitorChecks.id, result: monitorChecks.result })
            .from(monitorChecks)
            .where(
              and(
                eq(monitorChecks.tenantId, tenant.id),
                lt(monitorChecks.at, checkCutoff),
                isNotNull(monitorChecks.result),
              ),
            )
            .limit(1000);
          for (const shot of shots) {
            const key = isSyntheticResult(shot.result) ? shot.result.screenshotKey : undefined;
            if (key) await deleteObject(key).catch(() => {});
          }
        }
        await tx
          .delete(monitorChecks)
          .where(and(eq(monitorChecks.tenantId, tenant.id), lt(monitorChecks.at, checkCutoff)));
      });
    }
    console.log("[housekeeping] purges done");
  },
};

const served = selectedQueues();
const serves = (q: WorkQueue) => served.includes(q);

const workers = served.map((name) => {
  const concurrency = concurrencyFor(name);
  if (name === QA_QUEUE_NAME)
    // A suite is minutes of Playwright: the default lock would expire mid-run
    // and BullMQ would hand the same suite to a second worker.
    return new Worker(
      QA_QUEUE,
      async (job) => {
        await runQaJob(job.data as QaJob);
      },
      { connection, concurrency, lockDuration: 120_000 },
    );
  return new Worker(name, processors[name as QueueName], { connection, concurrency });
});

for (const w of workers) {
  w.on("failed", (job, err) => {
    console.error(`[${w.name}] job ${job?.id} failed:`, err.message);
  });
}

/**
 * Periodic sweeps — repeatable BullMQ schedulers (idempotent).
 *
 * Only for the queues this process serves. Two reasons, and the second is the
 * important one: a scheduler registered for a queue nobody consumes ticks into
 * a pile forever, and when the worker that owns it comes back it finds a
 * backlog of sweeps that were all meant to run at once. Whoever serves the
 * queue is the one who schedules it.
 *
 * The retention is on the template rather than on the worker, because it is a
 * property of the job and BullMQ reads it when the job is created. Without it
 * every completed tick stays in Redis for good: this instance had accumulated
 * 63,000 keys, 18,500 of them a single sweep's fifteen days of ticks, on a
 * database whose useful contents is a few hundred rows.
 */
async function registerSchedulers() {
  const schedules: Array<[QueueName, number]> = [
    ["update-reminders", 60_000],
    ["oncall-sweep", 30_000],
    ["status-sweep", 60_000],
    ["tracker-sync", 300_000],
    ["heartbeat-sweep", 30_000],
    ["monitor-sweep", 30_000],
    ["telemetry-monitors", 60_000],
    ["coverage-sweep", 6 * 3_600_000],
    ["runbook-sync", 6 * 3_600_000],
    ["housekeeping", DAY_MS],
  ];
  for (const [name, every] of schedules) {
    if (!serves(name)) continue;
    const queue = new Queue(name, { connection });
    await queue.upsertJobScheduler(
      `${name}-tick`,
      { every },
      { opts: { removeOnComplete: 100, removeOnFail: 500 } },
    );
    await queue.close();
    console.log(`[scheduler] ${name} every ${Math.round(every / 1000)} s`);
  }
}

await registerSchedulers();
console.log(
  `Open Incident worker started — ${served.length}/${WORK_QUEUES.length} queues: ` +
    served.map((q) => `${q}×${concurrencyFor(q)}`).join(", "),
);

async function shutdown() {
  console.log("Stopping the worker…");
  await Promise.all(workers.map((w) => w.close()));
  await connection.quit();
  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
