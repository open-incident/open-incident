"use server";

/**
 * Creating, pausing and checking a monitor.
 *
 * A monitor is created with criteria already written — the sentence the screen
 * showed — so it does something the minute it exists. "Check now" really runs
 * the check in-process and shows the answer, because a monitor you cannot try
 * is a monitor you do not trust.
 */

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import {
  monitorChecks,
  monitorSecrets,
  monitors,
  withTenant,
  type MonitorType,
  type TelemetryQuery,
} from "@openincident/db";
import {
  SYNTHETIC_MIN_INTERVAL_SECONDS,
  SYNTHETIC_SECRET_NAME,
  enqueueSyntheticRun,
  parseSyntheticConfig,
  performCheck,
  stateFromSample,
  evaluateTelemetryMonitorNow,
  syntheticConfigOf,
  syntheticRunnerLive,
} from "@openincident/oncall";
import { encryptSecret } from "@openincident/crypto";
import { deletePrefix, storageConfigured } from "@openincident/storage";
import { recordAudit } from "@/lib/audit";
import { requireResponder } from "@/lib/session";
import { DEFAULT_ACTION, defaultCriteria } from "@/lib/monitors";
import { observeService } from "@/lib/services";
import { telemetryQueryError } from "@/lib/telemetry-monitors";
import {
  applyMonitorChoices,
  dropMonitorRoute,
  isDefaultChoices,
  type MonitorChoices,
} from "@/lib/monitor-choices";

const TYPES = [
  "http",
  "api",
  "port",
  "dns",
  "ssl",
  "domain",
  "ping",
  "synthetic",
  "incoming",
  "manual",
  "logs",
  "traces",
  "metrics",
  "exceptions",
] as const;

/** The four whose subject is a query rather than an address. */
const TELEMETRY_TYPES = ["logs", "traces", "metrics", "exceptions"] as const;

const createSchema = z.object({
  type: z.enum(TYPES),
  name: z.string().trim().min(1).max(120),
  target: z.string().trim().max(500),
  intervalSeconds: z.coerce.number().int().min(30).max(86_400),
  service: z.string().trim().max(120).optional(),
  page: z.enum(["owner", "me", "nobody"]).default("owner"),
  // Three, not four: the pipeline knows "always", "when urgent" and "never".
  // Offering P1 and P2 separately promised a distinction nothing could make.
  incident: z.enum(["triage", "urgent", "never"]).default("urgent"),
  autoResolve: z.enum(["on", "off"]).default("on"),
  /** Synthetic only: the journey, as the step editor serialised it. */
  steps: z.string().max(20_000).optional(),
  /** Synthetic only: the credentials the journey signs in with. */
  secrets: z.string().max(20_000).optional(),
  /* Telemetry only: the question, and what makes it an alert. */
  telemetryQuery: z.string().trim().max(2_000).optional(),
  telemetryAggregate: z
    .enum(["count", "rate", "sum", "avg", "min", "max", "p50", "p95", "p99"])
    .default("count"),
  telemetryField: z.string().trim().max(120).optional(),
  telemetryWindow: z.coerce.number().int().min(1).max(60).default(5),
  telemetryCondition: z.enum(["threshold", "anomaly"]).default("threshold"),
  telemetryOp: z.enum([">", ">=", "<", "<=", "==", "!="]).default(">"),
  telemetryValue: z.coerce.number().default(0),
  telemetryDirection: z.enum(["high", "low", "any"]).default("high"),
  telemetryFor: z.coerce.number().int().min(1).max(10).default(2),
  telemetryGroupBy: z.string().trim().max(200).optional(),
  telemetryNoData: z.enum(["ignore", "trigger", "zero"]).default("ignore"),
});

/** JSON from a form field, or null — a malformed field is a refused monitor. */
function readJson(raw: string | undefined): unknown {
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/** `[{ name, value }]` from the creation form, or nothing. */
function readSecretPairs(raw: string | undefined): { name: string; value: string }[] {
  if (!raw) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  const out: { name: string; value: string }[] = [];
  for (const item of parsed) {
    const name = String((item as { name?: unknown })?.name ?? "").trim();
    const value = String((item as { value?: unknown })?.value ?? "");
    if (!SYNTHETIC_SECRET_NAME.test(name) || value === "") continue;
    out.push({ name, value });
  }
  return out;
}

export async function createMonitor(formData: FormData) {
  const current = await requireResponder();
  const parsed = createSchema.safeParse({
    type: formData.get("type"),
    name: formData.get("name"),
    // Empty, not absent: a manual, incoming or synthetic monitor's form has no
    // target field at all, and `z.string()` on a null refused every one of
    // them with a bare "invalid".
    target: formData.get("target") ?? "",
    intervalSeconds: formData.get("intervalSeconds") ?? 60,
    service: formData.get("service") ?? undefined,
    page: formData.get("page") ?? "owner",
    // The fallback has to be one of the three the enum knows; "p2" was not one
    // and would have failed the whole parse rather than defaulting.
    incident: formData.get("incident") ?? "urgent",
    autoResolve: formData.get("autoResolve") ?? "on",
    steps: formData.get("steps") ?? undefined,
    secrets: formData.get("secrets") ?? undefined,
    telemetryQuery: formData.get("telemetryQuery") ?? undefined,
    telemetryAggregate: formData.get("telemetryAggregate") ?? "count",
    telemetryField: formData.get("telemetryField") ?? undefined,
    telemetryWindow: formData.get("telemetryWindow") ?? 5,
    telemetryCondition: formData.get("telemetryCondition") ?? "threshold",
    telemetryOp: formData.get("telemetryOp") ?? ">",
    telemetryValue: formData.get("telemetryValue") ?? 0,
    telemetryDirection: formData.get("telemetryDirection") ?? "high",
    telemetryFor: formData.get("telemetryFor") ?? 2,
    telemetryGroupBy: formData.get("telemetryGroupBy") ?? undefined,
    telemetryNoData: formData.get("telemetryNoData") ?? "ignore",
  });
  if (!parsed.success) redirect("/app/monitors?error=invalid");
  const v = parsed.data;

  // A synthetic monitor is its journey: without a readable list of steps there
  // is nothing to run, and a monitor that cannot run is not created.
  let journey = null;
  if (v.type === "synthetic") {
    journey = parseSyntheticConfig(readJson(v.steps));
    if (!journey) redirect("/app/monitors?error=steps");
  }
  // A browser run costs a few hundred megabytes and several seconds of CPU. The
  // floor is five minutes, stated in @openincident/oncall and enforced here —
  // the form only offers intervals above it, and a hand-made POST does not get
  // to go under it either.
  const intervalSeconds =
    v.type === "synthetic"
      ? Math.max(SYNTHETIC_MIN_INTERVAL_SECONDS, v.intervalSeconds)
      : v.intervalSeconds;
  const secrets = v.type === "synthetic" ? readSecretPairs(v.secrets) : [];

  /*
   * A telemetry monitor is its query, and a query that does not compile is a
   * monitor that would evaluate to an error every minute for ever. So it is
   * compiled here, before the row exists: a filter naming a field we do not
   * have, or PromQL we cannot answer, is a refusal at creation rather than a
   * red mark on a screen somebody has stopped reading.
   */
  let telemetryQuery: TelemetryQuery | null = null;
  if ((TELEMETRY_TYPES as readonly string[]).includes(v.type)) {
    if (!v.telemetryQuery) redirect("/app/monitors?error=telemetry-query");
    telemetryQuery = {
      query: v.telemetryQuery,
      aggregate: v.telemetryAggregate,
      ...(v.telemetryField ? { field: v.telemetryField } : {}),
      windowMinutes: v.telemetryWindow,
      condition:
        v.telemetryCondition === "anomaly"
          ? { kind: "anomaly", direction: v.telemetryDirection }
          : { kind: "threshold", op: v.telemetryOp, value: v.telemetryValue },
      forEvaluations: v.telemetryFor,
      groupBy: (v.telemetryGroupBy ?? "")
        .split(/[,\s]+/)
        .map((s) => s.trim())
        .filter(Boolean)
        .slice(0, 5),
      noData: v.telemetryNoData,
    };
    const refusal = telemetryQueryError(v.type, telemetryQuery);
    if (refusal) redirect(`/app/monitors?error=telemetry-query&why=${encodeURIComponent(refusal)}`);
  }

  const id = await withTenant(current.tenant.id, async (tx) => {
    const serviceId = v.service
      ? await observeService(tx, current.tenant.id, v.service, "monitor")
      : null;
    const [row] = await tx
      .insert(monitors)
      .values({
        tenantId: current.tenant.id,
        name: v.name,
        type: v.type as MonitorType,
        // The journey's first address, so the list reads like every other row.
        target: journey?.steps.find((step) => step.kind === "goto")?.value ?? v.target,
        intervalSeconds,
        config: journey ? { ...journey } : {},
        telemetryQuery,
        criteria: defaultCriteria(v.type as MonitorType),
        action: {
          ...DEFAULT_ACTION,
          page:
            v.page === "me"
              ? { kind: "member", memberId: current.member.id }
              : v.page === "nobody"
                ? { kind: "nobody" }
                : { kind: "owner" },
          incident: { from: v.incident },
          autoResolve: v.autoResolve === "on",
        },
        serviceId,
        state: "waiting",
        createdByMemberId: current.member.id,
      })
      .returning({ id: monitors.id });
    await recordAudit(tx, current, "config", "monitor.created", {
      name: v.name,
      type: v.type,
    });
    // Written once, encrypted, never read back by a screen. The audit line
    // records the NAMES so a reader can see a credential was added, and
    // nothing else.
    if (secrets.length > 0) {
      await tx.insert(monitorSecrets).values(
        secrets.map((secret) => ({
          tenantId: current.tenant.id,
          monitorId: row!.id,
          name: secret.name,
          encryptedValue: encryptSecret(secret.value),
        })),
      );
      await recordAudit(tx, current, "config", "monitor.secret.set", {
        name: v.name,
        secrets: secrets.map((secret) => secret.name).join(", "),
      });
    }
    // The choices become a rule of this monitor's own, so the next alert
    // really follows them. Nothing is written when they match what the
    // pipeline already does: an extra rule nobody asked for is noise in the
    // list of rules.
    const choices: MonitorChoices = {
      page:
        v.page === "me"
          ? { kind: "member", memberId: current.member.id }
          : v.page === "nobody"
            ? { kind: "nobody" }
            : { kind: "owner" },
      incident: v.incident,
      autoResolve: v.autoResolve === "on",
    };
    if (!isDefaultChoices(choices)) {
      await applyMonitorChoices(
        tx,
        current.tenant.id,
        { memberId: current.member.id, name: current.member.name },
        { id: row!.id, name: v.name },
        choices,
      );
    }
    return row!.id;
  });

  revalidatePath("/app/monitors");
  revalidatePath("/app");
  redirect(`/app/monitors/${id}`);
}

export async function togglePause(formData: FormData) {
  const current = await requireResponder();
  const id = z.string().uuid().parse(formData.get("id"));
  await withTenant(current.tenant.id, async (tx) => {
    const [row] = await tx
      .select({ paused: monitors.paused, name: monitors.name })
      .from(monitors)
      .where(and(eq(monitors.tenantId, current.tenant.id), eq(monitors.id, id)));
    if (!row) return;
    await tx
      .update(monitors)
      .set({
        paused: !row.paused,
        state: !row.paused ? "paused" : "waiting",
        updatedAt: new Date(),
      })
      .where(eq(monitors.id, id));
    await recordAudit(tx, current, "config", row.paused ? "monitor.resumed" : "monitor.paused", {
      name: row.name,
    });
  });
  revalidatePath(`/app/monitors/${id}`);
  revalidatePath("/app/monitors");
}

/**
 * Runs the check now and records it like any other.
 *
 * Every type but one runs in this request. A synthetic journey does not: it
 * needs a browser, which lives in another service, so the click puts a job on
 * the queue and the runner writes the result the same way the sweep's runs are
 * written. Without a runner the click reports that, rather than queueing work
 * nobody will do.
 */
export async function checkNow(formData: FormData) {
  const current = await requireResponder();
  const id = z.string().uuid().parse(formData.get("id"));
  const monitor = await withTenant(current.tenant.id, async (tx) => {
    const [row] = await tx
      .select({
        id: monitors.id,
        name: monitors.name,
        type: monitors.type,
        target: monitors.target,
        config: monitors.config,
        criteria: monitors.criteria,
      })
      .from(monitors)
      .where(and(eq(monitors.tenantId, current.tenant.id), eq(monitors.id, id)));
    return row ?? null;
  });
  if (!monitor) redirect("/app/monitors");

  if (monitor.type === "synthetic") {
    const journey = syntheticConfigOf(monitor);
    if (!journey) redirect(`/app/monitors/${id}?error=steps`);
    if (!(await syntheticRunnerLive())) redirect(`/app/monitors/${id}?error=no-runner`);
    const queued = await enqueueSyntheticRun({
      tenantId: current.tenant.id,
      monitorId: monitor.id,
      monitorName: monitor.name,
      steps: journey.steps,
      budgetMs: journey.budgetMs,
      viewport: journey.viewport,
      trigger: "manual",
    });
    redirect(`/app/monitors/${id}?${queued ? "queued=1" : "error=no-runner"}`);
  }

  /*
   * A telemetry monitor has nothing to reach, so "check now" runs the sweep
   * rather than a probe: it evaluates the query, moves the series and posts
   * whatever that produced, which is precisely what the minute tick does.
   * Anything less would be a button that says it checked and did not.
   */
  if ((TELEMETRY_TYPES as readonly string[]).includes(monitor.type)) {
    const out = await evaluateTelemetryMonitorNow(current.tenant.id, monitor.id);
    revalidatePath(`/app/monitors/${id}`);
    redirect(`/app/monitors/${id}?${out.failed ? "error=telemetry-eval" : "evaluated=1"}`);
  }

  const sample = await performCheck({
    type: monitor.type,
    target: monitor.target,
    config: monitor.config,
  });
  const { state, why } = stateFromSample(monitor.criteria, sample);
  const now = new Date();
  await withTenant(current.tenant.id, async (tx) => {
    await tx.insert(monitorChecks).values({
      tenantId: current.tenant.id,
      monitorId: id,
      at: now,
      state,
      latencyMs: sample.latencyMs ?? null,
      detail: why.slice(0, 500),
    });
    await tx
      .update(monitors)
      .set({
        state,
        lastCheckAt: now,
        lastLatencyMs: sample.latencyMs ?? null,
        lastDetail: why.slice(0, 500),
        updatedAt: now,
      })
      .where(eq(monitors.id, id));
  });
  revalidatePath(`/app/monitors/${id}`);
}

export async function deleteMonitor(formData: FormData) {
  const current = await requireResponder();
  const id = z.string().uuid().parse(formData.get("id"));
  // The failure screenshots go with it. The check rows cascade away with the
  // monitor; the objects they point at would have stayed in the bucket forever,
  // costing money for a monitor nobody can reach any more.
  if (storageConfigured())
    await deletePrefix(`tenants/${current.tenant.id}/monitors/${id}/`).catch(() => 0);
  await withTenant(current.tenant.id, async (tx) => {
    const [row] = await tx
      .delete(monitors)
      .where(and(eq(monitors.tenantId, current.tenant.id), eq(monitors.id, id)))
      .returning({ name: monitors.name });
    if (row) await recordAudit(tx, current, "config", "monitor.deleted", { name: row.name });
    // Its rule goes with it: an orphan rule keeps deciding for a monitor that
    // no longer exists, and nobody would think to look for it.
    await dropMonitorRoute(tx, current.tenant.id, id);
  });
  revalidatePath("/app/monitors");
  redirect("/app/monitors");
}

/* ---------- Synthetic journeys ---------- */

/** Replaces the journey of a synthetic monitor with the edited list of steps. */
export async function saveSyntheticJourney(formData: FormData) {
  const current = await requireResponder();
  const id = z.string().uuid().parse(formData.get("id"));
  const journey = parseSyntheticConfig(readJson(String(formData.get("steps") ?? "")));
  if (!journey) redirect(`/app/monitors/${id}?error=steps`);
  await withTenant(current.tenant.id, async (tx) => {
    const [row] = await tx
      .select({ name: monitors.name, type: monitors.type })
      .from(monitors)
      .where(and(eq(monitors.tenantId, current.tenant.id), eq(monitors.id, id)));
    if (!row || row.type !== "synthetic") return;
    await tx
      .update(monitors)
      .set({
        config: { ...journey },
        target: journey.steps.find((step) => step.kind === "goto")?.value ?? "",
        updatedAt: new Date(),
      })
      .where(eq(monitors.id, id));
    await recordAudit(tx, current, "config", "monitor.journey.saved", {
      name: row.name,
      steps: String(journey.steps.length),
    });
  });
  revalidatePath(`/app/monitors/${id}`);
}

/**
 * Stores one credential, encrypted.
 *
 * Replacing an existing one overwrites it: there is no read-back, so "change
 * the password" can only mean writing a new one over the old.
 */
export async function saveMonitorSecret(formData: FormData) {
  const current = await requireResponder();
  const id = z.string().uuid().parse(formData.get("id"));
  const name = String(formData.get("name") ?? "").trim();
  const value = String(formData.get("value") ?? "");
  if (!SYNTHETIC_SECRET_NAME.test(name) || value === "")
    redirect(`/app/monitors/${id}?error=secret`);
  await withTenant(current.tenant.id, async (tx) => {
    const [row] = await tx
      .select({ name: monitors.name })
      .from(monitors)
      .where(and(eq(monitors.tenantId, current.tenant.id), eq(monitors.id, id)));
    if (!row) return;
    await tx
      .insert(monitorSecrets)
      .values({
        tenantId: current.tenant.id,
        monitorId: id,
        name,
        encryptedValue: encryptSecret(value),
      })
      .onConflictDoUpdate({
        target: [monitorSecrets.monitorId, monitorSecrets.name],
        set: { encryptedValue: encryptSecret(value), updatedAt: new Date() },
      });
    // The name, never the value — not even its length.
    await recordAudit(tx, current, "config", "monitor.secret.set", {
      name: row.name,
      secrets: name,
    });
  });
  revalidatePath(`/app/monitors/${id}`);
}

export async function deleteMonitorSecret(formData: FormData) {
  const current = await requireResponder();
  const id = z.string().uuid().parse(formData.get("id"));
  const name = String(formData.get("name") ?? "").trim();
  await withTenant(current.tenant.id, async (tx) => {
    await tx
      .delete(monitorSecrets)
      .where(
        and(
          eq(monitorSecrets.tenantId, current.tenant.id),
          eq(monitorSecrets.monitorId, id),
          eq(monitorSecrets.name, name),
        ),
      );
    await recordAudit(tx, current, "config", "monitor.secret.removed", { secrets: name });
  });
  revalidatePath(`/app/monitors/${id}`);
}
