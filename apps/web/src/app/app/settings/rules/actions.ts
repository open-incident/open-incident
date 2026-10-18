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
import type { DialogResult } from "@/components/settings/dialog";
import { loadRefs, orderedRoutes, previewLastAlerts, writeOrder } from "./data";
import {
  DEFAULT_INCIDENT,
  dialogValues,
  escalationsOf,
  incidentOf,
  isRule,
  parseLabel,
  whenSentence,
  type RouteRow,
} from "./model";

const PAGE = "/app/settings/rules";
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
      await recordAudit(tx, current, "config", "alert_route.updated", {
        id: input.id,
        name: input.name,
      });
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
    await recordAudit(tx, current, "config", "alert_route.created", {
      id: row!.id,
      name: input.name,
    });
    return row!.id;
  });
  revalidatePath(PAGE);
  redirect(`${PAGE}?saved=${id}`);
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

/* ---------- The list and its dialog (design V2) ---------- */

const dialogSchema = z.object({
  id: uuid.optional().or(z.literal("")),
  source: uuid.optional().or(z.literal("")),
  severity: z.string().max(200).default("any"),
  label: z.string().max(400).default(""),
  then: z.string().min(1).max(80),
  /** What "then" said when the dialog opened: only a changed choice is applied. */
  thenWas: z.string().max(80).default(""),
});

/**
 * "New rule" and "Edit rule n": the four fields of the design's dialog,
 * written as a real rule. A choice in "then" changes its own part of the rule
 * and leaves the rest — an edited rule keeps whatever the dialog does not
 * show (grouping, a Slack channel, a wait). A new rule goes at the end of the
 * rules, which is what the dialog's button says.
 */
export async function saveRuleFromDialog(
  _prev: DialogResult,
  formData: FormData,
): Promise<DialogResult> {
  const current = await requireManager();
  const t = await getT();
  const parsed = dialogSchema.safeParse(Object.fromEntries(formData.entries()));
  if (!parsed.success) return { ok: false, error: t("settingsV2.error.invalid") };
  const input = parsed.data;
  const label = input.label.trim() ? parseLabel(input.label) : null;
  if (input.label.trim() && !label) return { ok: false, error: t("settingsV2.rules.err.label") };

  return withTenant(current.tenant.id, async (tx): Promise<DialogResult> => {
    const tenantId = current.tenant.id;
    const refs = await loadRefs(tx, tenantId);
    const routes = await orderedRoutes(tx, tenantId);
    const route = input.id ? (routes.find((r) => r.id === input.id) ?? null) : null;
    if (input.id && !route) return { ok: false, error: t("settingsV2.error.generic") };
    if (route && !dialogValues(route, refs))
      return { ok: false, error: t("settingsV2.error.invalid") };

    // The conditions, rewritten whole from the three fields.
    const all: ConditionGroup["all"] = [];
    if (input.severity !== "any") {
      const names = input.severity.replace(/^in:/, "").split(",").filter(Boolean);
      if (!input.severity.startsWith("in:") || names.length === 0)
        return { ok: false, error: t("settingsV2.error.invalid") };
      all.push(
        names.length === 1
          ? { attribute: "priority", op: "eq", value: names[0]! }
          : { attribute: "priority", op: "in", value: names.join(",") },
      );
    }
    if (label) all.push({ attribute: label.key, op: label.op, value: label.value });
    const sourceIds = input.source ? [input.source] : [];
    if (input.source && !refs.sources.some((s) => s.id === input.source))
      return { ok: false, error: t("settingsV2.error.invalid") };
    const conditions: ConditionGroup[] = all.length ? [{ all }] : [];
    if (sourceIds.length === 0 && conditions.length === 0)
      return { ok: false, error: t("settingsV2.rules.err.empty") };

    // What the rule does: the saved one, or what a new rule starts from.
    let escalations: EscalationRule[] = route
      ? escalationsOf(route)
      : [{ kind: "attribute", attribute: "service", fallbackPathId: null }];
    let incident: IncidentTemplate = route ? incidentOf(route) : DEFAULT_INCIDENT;
    let atlasDirective: RouteRow["atlasDirective"] = route ? route.atlasDirective : null;
    if (!route || input.then !== input.thenWas) {
      const [kind, ref] = input.then.split(":") as [string, string | undefined];
      if (kind === "team") {
        const team = refs.teams.find((x) => x.id === ref);
        if (!team?.policyPathId) return { ok: false, error: t("settingsV2.rules.err.then") };
        escalations = [{ kind: "path", pathId: team.policyPathId }];
      } else if (kind === "path") {
        if (!refs.paths.some((p) => p.id === ref))
          return { ok: false, error: t("settingsV2.rules.err.then") };
        escalations = [{ kind: "path", pathId: ref! }];
      } else if (kind === "owner") {
        escalations = [{ kind: "attribute", attribute: "service", fallbackPathId: null }];
      } else if (kind === "incident") {
        if (!refs.severities.some((s) => s.id === ref))
          return { ok: false, error: t("settingsV2.rules.err.then") };
        incident = {
          ...incident,
          mode: "always",
          startPhase: "triage",
          severity: { mode: "static", severityId: ref! },
        };
        // The design's "open an incident at SEV3 · page nobody": a new rule
        // that opens an incident pages nobody until somebody says who.
        if (!route) escalations = [];
      } else if (kind === "atlas" && (ref === "handle" || ref === "never")) {
        atlasDirective = ref;
      } else if (kind === "mute") {
        escalations = [];
        incident = { ...incident, mode: "never" };
        atlasDirective = null;
      } else return { ok: false, error: t("settingsV2.rules.err.then") };
    }

    const legacy = legacyOf(escalations, incident, conditions);
    const values = {
      sourceIds,
      conditions,
      escalations,
      incident,
      atlasDirective,
      ...legacy,
      updatedAt: new Date(),
    };
    const rules = routes.filter(isRule);
    const others = routes.filter((r) => !isRule(r));

    if (route) {
      await tx
        .update(alertRoutes)
        .set(values)
        .where(and(eq(alertRoutes.tenantId, tenantId), eq(alertRoutes.id, route.id)));
      const n = rules.findIndex((r) => r.id === route.id) + 1;
      await recordAudit(tx, current, "config", "alert_route.updated", {
        id: route.id,
        name: route.name,
      });
      revalidatePath(PAGE);
      return { ok: true, message: t("settingsV2.rules.savedN", { n }) };
    }

    // A name is required and unique; the rule's own sentence is the honest one.
    const base = whenSentence({ sourceIds, conditions, filters: [] }, refs, t).slice(0, 72).trim();
    let name = base;
    for (let i = 2; routes.some((r) => r.name === name); i++) name = `${base} (${i})`;
    const [row] = await tx
      .insert(alertRoutes)
      .values({ tenantId, name, ...values, position: rules.length })
      .returning({ id: alertRoutes.id });
    await writeOrder(
      tx,
      [...rules.map((r) => r.id), row!.id],
      others.map((r) => r.id),
    );
    await recordAudit(tx, current, "config", "alert_route.created", { id: row!.id, name });
    revalidatePath(PAGE);
    return { ok: true, message: t("settingsV2.rules.added", { n: rules.length + 1 }) };
  });
}

/**
 * Moves a rule to another place in the order — the first matching rule wins,
 * so the place is the rule's meaning. The audit line says it in the list's
 * own numbers: "moved rule 2 above rule 3".
 */
export async function moveRule(
  id: string,
  to: number,
): Promise<{ ok: true; message: string } | { ok: false; error: string }> {
  const current = await requireManager();
  const t = await getT();
  const ruleId = uuid.parse(id);
  const target = z.number().int().min(0).parse(to);
  return withTenant(current.tenant.id, async (tx) => {
    const routes = await orderedRoutes(tx, current.tenant.id);
    const rules = routes.filter(isRule);
    const from = rules.findIndex((r) => r.id === ruleId);
    if (from < 0 || target >= rules.length)
      return { ok: false as const, error: t("settingsV2.error.generic") };
    if (from === target) return { ok: true as const, message: "" };
    const moved = rules[from]!;
    const passed = rules[target]!;
    const order = rules.filter((r) => r.id !== ruleId);
    order.splice(target, 0, moved);
    await writeOrder(
      tx,
      order.map((r) => r.id),
      routes.filter((r) => !isRule(r)).map((r) => r.id),
    );
    const above = target < from;
    const words = { from: from + 1, to: target + 1 };
    await recordAudit(tx, current, "config", "alert_route.moved", {
      id: moved.id,
      name: moved.name,
      passed: passed.name,
      from: from + 1,
      to: target + 1,
      summary: above
        ? `moved rule ${from + 1} above rule ${target + 1}`
        : `moved rule ${from + 1} below rule ${target + 1}`,
    });
    revalidatePath(PAGE);
    return {
      ok: true as const,
      message: above
        ? t("settingsV2.rules.movedAbove", words)
        : t("settingsV2.rules.movedBelow", words),
    };
  });
}

/** "Preview on the last 50 alerts": the rules as they stand, replayed — nothing is sent. */
export async function previewRules(): Promise<string> {
  const current = await requireManager();
  const t = await getT();
  const r = await withTenant(current.tenant.id, (tx) => previewLastAlerts(tx, current.tenant.id));
  if (r.total === 0) return t("settingsV2.rules.previewNone");
  return t("settingsV2.rules.previewResult", {
    matched: r.matched,
    total: r.total,
    changes: t("settingsV2.rules.previewChanges", { count: r.changed }),
  });
}

/** Deletes a rule from its own page, then back to the list. */
export async function deleteRuleFromDialog(
  _prev: DialogResult,
  formData: FormData,
): Promise<DialogResult> {
  const current = await requireManager();
  const id = uuid.safeParse(formData.get("id"));
  if (!id.success) return { ok: false, error: (await getT())("settingsV2.error.invalid") };
  await withTenant(current.tenant.id, async (tx) => {
    const [r] = await tx
      .select()
      .from(alertRoutes)
      .where(and(eq(alertRoutes.tenantId, current.tenant.id), eq(alertRoutes.id, id.data)));
    if (!r) return;
    await tx.delete(alertRoutes).where(eq(alertRoutes.id, r.id));
    await recordAudit(tx, current, "config", "alert_route.deleted", { id: r.id, name: r.name });
  });
  revalidatePath(PAGE);
  redirect(`${PAGE}?deleted=1`);
}
