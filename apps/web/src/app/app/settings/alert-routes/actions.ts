"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import {
  alertRoutes,
  members,
  schedules,
  withTenant,
  type ConditionGroup,
  type EscalationRule,
  type GroupingRule,
  type IncidentTemplate,
  type NotifyRule,
  type RouteFilter,
} from "@openincident/db";
import { getT } from "@/i18n/server";
import { recordAudit } from "@/lib/audit";
import { ensureQuickPath } from "@/lib/alerting-setup";
import { requireManager } from "@/lib/session";
import {
  PREVIEW_ALERTS,
  insertionIndex,
  previewRuleAgainstAlerts,
  type RulePreview,
} from "@/lib/settings-rule-preview";

const PAGE = "/app/settings/alert-routes";
const uuid = z.string().uuid();

const conditionsSchema = z.array(
  z.object({
    all: z.array(
      z.object({
        attribute: z.string().trim().min(1).max(60),
        op: z.enum(["eq", "neq", "in", "not_in", "contains", "matches", "exists", "missing"]),
        value: z.string().trim().max(300).optional(),
      }),
    ),
  }),
);
const escalationsSchema = z.array(
  z.union([
    z.object({ kind: z.literal("path"), pathId: uuid }),
    z.object({
      kind: z.literal("attribute"),
      attribute: z.string().min(1).max(60),
      fallbackPathId: uuid.nullable(),
    }),
  ]),
);
const incidentSchema = z.object({
  mode: z.enum(["never", "always", "conditional"]),
  typeId: uuid.nullable(),
  startPhase: z.enum(["triage", "active"]),
  severity: z.union([
    z.object({ mode: z.literal("priority") }),
    z.object({ mode: z.literal("static"), severityId: uuid.nullable() }),
    z.object({ mode: z.literal("none") }),
  ]),
  visibility: z.enum(["public", "private"]),
  customFields: z.record(z.string(), z.string()),
  declineOnResolve: z.boolean(),
});
const groupingSchema = z.object({
  enabled: z.boolean(),
  by: z.array(z.string().max(60)).max(6),
  windowMinutes: z.number().int().min(1).max(1440),
  extending: z.boolean(),
  escalate: z.enum(["never", "every", "increase"]),
  graceMinutes: z.number().int().min(0).max(120),
});
const notifySchema = z.object({
  slackChannelId: z.string().nullable(),
  slackChannelName: z.string().nullable(),
});

const schema = z.object({
  id: uuid.optional().or(z.literal("")),
  name: z.string().trim().min(2).max(80),
  description: z.string().trim().max(300).optional(),
  sourceIds: z.string().default("[]"),
  conditions: z.string().default("[]"),
  escalations: z.string().default("[]"),
  incident: z.string().default(""),
  grouping: z.string().default(""),
  notify: z.string().default(""),
  urgencyOverride: z.enum(["", "high", "low"]).default(""),
  priorityId: uuid.or(z.literal("")).optional(),
  deferMinutes: z.coerce.number().int().min(0).max(60).default(0),
  testMode: z.string().optional(),
  active: z.string().optional(),
  resolveClosesEscalation: z.string().optional(),
});

function parseJson<T>(
  text: string,
  parser: { safeParse: (v: unknown) => { success: boolean; data?: T } },
): T | null {
  try {
    const r = parser.safeParse(JSON.parse(text));
    return r.success ? (r.data as T) : null;
  } catch {
    return null;
  }
}

/** Legacy columns mirrored from the rules, so screens not yet rewritten keep reading something true. */
function legacyOf(
  rules: EscalationRule[],
  incident: IncidentTemplate,
  conditions: ConditionGroup[],
) {
  const first = rules[0];
  const escalationMode = !first ? "none" : first.kind === "path" ? "static" : "dynamic";
  const escalationPathId = first
    ? first.kind === "path"
      ? first.pathId
      : first.fallbackPathId
    : null;
  const filters: RouteFilter[] =
    conditions.length === 1
      ? conditions[0]!.all
          .filter((c) => ["eq", "neq", "in", "exists"].includes(c.op))
          .map((c) => ({ attribute: c.attribute, op: c.op as RouteFilter["op"], value: c.value }))
      : [];
  return {
    escalationMode,
    escalationPathId,
    incidentMode: incident.mode,
    incidentTypeId: incident.typeId,
    filters,
  } as const;
}

/** Creates or edits a route from the editor's fields. */
export async function saveRoute(formData: FormData) {
  const current = await requireManager();
  const parsed = schema.safeParse(Object.fromEntries(formData.entries()));
  if (!parsed.success) redirect(`${PAGE}?error=invalid`);
  const input = parsed.data;
  const sourceIds = parseJson<string[]>(input.sourceIds, z.array(uuid)) ?? [];
  const conditions = (parseJson<ConditionGroup[]>(input.conditions, conditionsSchema) ?? []).filter(
    (g) => g.all.length > 0,
  );
  const escalations = parseJson<EscalationRule[]>(input.escalations, escalationsSchema) ?? [];
  const incident: IncidentTemplate = parseJson<IncidentTemplate>(
    input.incident,
    incidentSchema,
  ) ?? {
    mode: "conditional",
    typeId: null,
    startPhase: "triage",
    severity: { mode: "priority" },
    visibility: "public",
    customFields: {},
    declineOnResolve: true,
  };
  const grouping: GroupingRule = parseJson<GroupingRule>(input.grouping, groupingSchema) ?? {
    enabled: true,
    by: ["service"],
    windowMinutes: 5,
    extending: true,
    escalate: "never",
    graceMinutes: 0,
  };
  const notify: NotifyRule | null = parseJson<NotifyRule>(input.notify, notifySchema);
  const legacy = legacyOf(escalations, incident, conditions);
  const values = {
    name: input.name,
    description: input.description || null,
    sourceIds,
    conditions,
    escalations,
    incident,
    grouping,
    notify: notify?.slackChannelId ? notify : null,
    urgencyOverride: input.urgencyOverride || null,
    priorityId: input.priorityId || null,
    deferMinutes: input.deferMinutes,
    testMode: input.testMode === "on",
    active: input.active !== "off",
    resolveClosesEscalation: input.resolveClosesEscalation !== "off",
    ...legacy,
    updatedAt: new Date(),
  } as const;
  const id = await withTenant(current.tenant.id, async (tx) => {
    if (input.id) {
      await tx
        .update(alertRoutes)
        .set(values)
        .where(and(eq(alertRoutes.tenantId, current.tenant.id), eq(alertRoutes.id, input.id)));
      await recordAudit(tx, current, "config", "alert_route.updated", { name: input.name });
      return input.id;
    }
    // A rule is the exception to what a source already decided, so a new one
    // goes above every route that is only a default — the catch-all, and the
    // per-source routes the sources screen creates for its own three choices.
    // Landing after them would leave the rule powerless until someone
    // reordered it, which the screen's own note promises is unnecessary.
    const rows = await tx
      .select({
        id: alertRoutes.id,
        position: alertRoutes.position,
        sourceIds: alertRoutes.sourceIds,
        conditions: alertRoutes.conditions,
        filters: alertRoutes.filters,
      })
      .from(alertRoutes)
      .where(eq(alertRoutes.tenantId, current.tenant.id))
      .orderBy(alertRoutes.position, alertRoutes.createdAt);
    const position = insertionIndex(rows);
    // Positions are renumbered around the hole rather than shifted by one, so
    // the order stays 0…n whatever the sources screen left behind.
    for (const [i, r] of rows.entries())
      if (i >= position)
        await tx
          .update(alertRoutes)
          .set({ position: i + 1 })
          .where(eq(alertRoutes.id, r.id));
      else if (r.position !== i)
        await tx.update(alertRoutes).set({ position: i }).where(eq(alertRoutes.id, r.id));
    const [row] = await tx
      .insert(alertRoutes)
      .values({ tenantId: current.tenant.id, ...values, position })
      .returning({ id: alertRoutes.id });
    await recordAudit(tx, current, "config", "alert_route.created", { name: input.name });
    return row!.id;
  });
  revalidatePath(PAGE);
  revalidatePath("/app/settings/alerting");
  redirect(`${PAGE}?saved=${id}`);
}

/** Up or down in the order: the first route whose conditions hold wins. */
export async function moveRoute(formData: FormData) {
  const current = await requireManager();
  const id = uuid.parse(formData.get("id"));
  const dir = z.enum(["up", "down"]).parse(formData.get("dir"));
  await withTenant(current.tenant.id, async (tx) => {
    const rows = await tx
      .select({ id: alertRoutes.id })
      .from(alertRoutes)
      .where(eq(alertRoutes.tenantId, current.tenant.id))
      .orderBy(alertRoutes.position, alertRoutes.createdAt);
    const i = rows.findIndex((r) => r.id === id);
    const j = dir === "up" ? i - 1 : i + 1;
    if (i < 0 || j < 0 || j >= rows.length) return;
    const order = rows.map((r) => r.id);
    [order[i], order[j]] = [order[j]!, order[i]!];
    for (const [pos, rid] of order.entries())
      await tx.update(alertRoutes).set({ position: pos }).where(eq(alertRoutes.id, rid));
  });
  revalidatePath(PAGE);
  revalidatePath("/app/settings/alerting");
}

export async function toggleRoute(formData: FormData) {
  const current = await requireManager();
  const id = uuid.parse(formData.get("id"));
  await withTenant(current.tenant.id, async (tx) => {
    const [r] = await tx
      .select()
      .from(alertRoutes)
      .where(and(eq(alertRoutes.tenantId, current.tenant.id), eq(alertRoutes.id, id)));
    if (!r) return;
    // "Activate" on a test-mode route leaves test mode; on an inactive route, switches it on.
    if (r.testMode)
      await tx
        .update(alertRoutes)
        .set({ testMode: false, active: true, updatedAt: new Date() })
        .where(eq(alertRoutes.id, id));
    else
      await tx
        .update(alertRoutes)
        .set({ active: !r.active, updatedAt: new Date() })
        .where(eq(alertRoutes.id, id));
    await recordAudit(tx, current, "config", "alert_route.toggled", { name: r.name });
  });
  revalidatePath(PAGE);
  revalidatePath("/app/settings/alerting");
}

/** Duplicates in test mode — activate it once the conditions are verified. */
export async function duplicateRoute(formData: FormData) {
  const current = await requireManager();
  const id = uuid.parse(formData.get("id"));
  const t = await getT();
  const copyId = await withTenant(current.tenant.id, async (tx) => {
    const [r] = await tx
      .select()
      .from(alertRoutes)
      .where(and(eq(alertRoutes.tenantId, current.tenant.id), eq(alertRoutes.id, id)));
    if (!r) return null;
    const copyName = t("settings.routes.copyName", { name: r.name }).slice(0, 80);
    const [row] = await tx
      .insert(alertRoutes)
      .values({
        tenantId: current.tenant.id,
        name: copyName,
        description: r.description,
        active: true,
        testMode: true,
        filters: r.filters,
        sourceIds: r.sourceIds,
        conditions: r.conditions,
        escalations: r.escalations,
        incident: r.incident,
        grouping: r.grouping,
        notify: r.notify,
        escalationMode: r.escalationMode,
        escalationPathId: r.escalationPathId,
        urgencyOverride: r.urgencyOverride,
        priorityId: r.priorityId,
        incidentMode: r.incidentMode,
        incidentTypeId: r.incidentTypeId,
        deferMinutes: r.deferMinutes,
        resolveClosesEscalation: r.resolveClosesEscalation,
        position: r.position,
        alertCount: 0,
      })
      .returning({ id: alertRoutes.id });
    await recordAudit(tx, current, "config", "alert_route.duplicated", {
      from: r.name,
      name: copyName,
    });
    return row!.id;
  });
  revalidatePath(PAGE);
  redirect(copyId ? `${PAGE}/${copyId}` : PAGE);
}

export async function deleteRoute(formData: FormData) {
  const current = await requireManager();
  const id = uuid.parse(formData.get("id"));
  await withTenant(current.tenant.id, async (tx) => {
    const [r] = await tx
      .select()
      .from(alertRoutes)
      .where(and(eq(alertRoutes.tenantId, current.tenant.id), eq(alertRoutes.id, id)));
    if (!r) return;
    await tx.delete(alertRoutes).where(eq(alertRoutes.id, id));
    await recordAudit(tx, current, "config", "alert_route.deleted", { name: r.name });
  });
  revalidatePath(PAGE);
  revalidatePath("/app/settings/alerting");
  redirect(PAGE);
}

/* ---------- The editor's helpers ---------- */

/** A published one-level path for a person or a schedule, returned for the rule the editor adds. */
export async function quickPath(
  target:
    | { kind: "me" }
    | { kind: "member"; memberId: string }
    | { kind: "schedule"; scheduleId: string },
): Promise<{ id: string; name: string } | { error: string }> {
  const current = await requireManager();
  const t = await getT();
  return withTenant(current.tenant.id, async (tx) => {
    if (target.kind === "schedule") {
      const [s] = await tx
        .select({ id: schedules.id, name: schedules.name })
        .from(schedules)
        .where(
          and(
            eq(schedules.tenantId, current.tenant.id),
            eq(schedules.id, uuid.parse(target.scheduleId)),
          ),
        );
      if (!s) return { error: "not_found" };
      return ensureQuickPath(
        tx,
        current.tenant.id,
        { memberId: current.member.id },
        { kind: "schedule", scheduleId: s.id },
        t("setup.quickPath.schedule", { name: s.name }),
      );
    }
    const memberId = target.kind === "me" ? current.member.id : uuid.parse(target.memberId);
    const [m] = await tx
      .select({ id: members.id, name: members.name })
      .from(members)
      .where(and(eq(members.tenantId, current.tenant.id), eq(members.id, memberId)));
    if (!m) return { error: "not_found" };
    return ensureQuickPath(
      tx,
      current.tenant.id,
      { memberId: current.member.id },
      { kind: "member", memberId: m.id },
      t("setup.quickPath.member", { name: m.name }),
    );
  });
}

/**
 * The last alerts against the editor's draft: which ones this rule would
 * catch, and what would change if it were saved. Nothing is sent — the
 * evaluation replays the ingest matcher, it does not run the pipeline.
 */
export async function previewRoute(draft: {
  id?: string | null;
  sourceIds: string[];
  conditions: ConditionGroup[];
  escalations: EscalationRule[];
  incidentMode?: "never" | "always" | "conditional";
  testMode?: boolean;
  active?: boolean;
}): Promise<RulePreview> {
  const current = await requireManager();
  const t = await getT();
  const parsed = {
    id: draft.id ? uuid.parse(draft.id) : null,
    sourceIds: z.array(uuid).parse(draft.sourceIds),
    conditions: conditionsSchema.parse(draft.conditions),
    escalations: escalationsSchema.parse(draft.escalations),
    incidentMode: z
      .enum(["never", "always", "conditional"])
      .catch("conditional")
      .parse(draft.incidentMode),
    testMode: Boolean(draft.testMode),
    active: draft.active !== false,
  };
  return withTenant(current.tenant.id, (tx) =>
    previewRuleAgainstAlerts(tx, current.tenant.id, parsed, t, PREVIEW_ALERTS),
  );
}
