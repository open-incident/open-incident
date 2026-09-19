"use server";

/**
 * Everything that writes an alert source.
 *
 * The screens moved under /app/alerts/sources; this module stayed where it
 * was because the alerting settings and the shared editors under
 * `components/alerting` import it by path, and a server action keeps its
 * identity from the file it lives in.
 */

import { createHash, randomBytes } from "node:crypto";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import {
  alertSources,
  forgetApiKeyLookup,
  registerApiKeyLookup,
  schedules,
  teams,
  withTenant,
  type AlertSourceKind,
  type AttributeMapping,
  type ConditionGroup,
  type EscalationRule,
  type PriorityRule,
  type Tx,
} from "@openincident/db";
import { defaultMappings } from "@openincident/oncall";
import { getT } from "@/i18n/server";
import { recordAudit } from "@/lib/audit";
import { ingestPayload, simulateIngest, type AlertPlan } from "@/lib/alert-ingest";
import { SOURCE_KINDS } from "@/lib/alert-sources";
import { ensureQuickPath } from "@/lib/alerting-setup";
import { requireManager } from "@/lib/session";
import { requestOrigin } from "@/lib/tenant";
import { type IncidentChoice } from "@/app/app/alerts/sources/choices";
import { headers } from "next/headers";

const KINDS = SOURCE_KINDS.map((k) => k.kind) as [AlertSourceKind, ...AlertSourceKind[]];
const PAGE = "/app/alerts/sources";
const uuid = z.string().uuid();

async function currentOrigin(): Promise<string> {
  const h = await headers();
  return requestOrigin({ headers: h, nextUrl: new URL(`http://${h.get("host") ?? "localhost"}/`) });
}

function endpointOf(origin: string, id: string): string {
  return `${origin}/api/ingest/alerts/${id}`;
}

async function loadSource(tenantId: string, id: string) {
  return withTenant(tenantId, async (tx) => {
    const [s] = await tx
      .select()
      .from(alertSources)
      .where(and(eq(alertSources.tenantId, tenantId), eq(alertSources.id, id)));
    return s ?? null;
  });
}

function revalidateSources(id?: string) {
  revalidatePath(PAGE);
  if (id) revalidatePath(`${PAGE}/${id}`);
  revalidatePath("/app/alerts");
  revalidatePath("/app/settings/alerting");
}

/* ---------- The three choices ---------- */

const pageChoice = z.object({
  kind: z.enum(["owner", "me", "team", "schedule", "nobody"]),
  teamId: uuid.optional(),
  scheduleId: uuid.optional(),
});
type PageInput = z.infer<typeof pageChoice>;

/** The escalation rules that express one answer to "who to page". */
async function rulesFor(
  tx: Tx,
  tenantId: string,
  actor: { memberId: string; name: string },
  choice: PageInput,
): Promise<{ rules: EscalationRule[]; pathId: string | null }> {
  const t = await getT();
  if (choice.kind === "nobody") return { rules: [], pathId: null };
  if (choice.kind === "owner")
    return {
      rules: [{ kind: "attribute", attribute: "service", fallbackPathId: null }],
      pathId: null,
    };
  if (choice.kind === "team") {
    const [team] = choice.teamId
      ? await tx
          .select({ pathId: teams.policyPathId })
          .from(teams)
          .where(and(eq(teams.tenantId, tenantId), eq(teams.id, choice.teamId)))
      : [];
    if (!team?.pathId) return { rules: [], pathId: null };
    return { rules: [{ kind: "path", pathId: team.pathId }], pathId: team.pathId };
  }
  if (choice.kind === "schedule") {
    if (!choice.scheduleId) return { rules: [], pathId: null };
    const [sched] = await tx
      .select({ id: schedules.id, name: schedules.name })
      .from(schedules)
      .where(and(eq(schedules.tenantId, tenantId), eq(schedules.id, choice.scheduleId)));
    if (!sched) return { rules: [], pathId: null };
    const path = await ensureQuickPath(
      tx,
      tenantId,
      { memberId: actor.memberId },
      { kind: "schedule", scheduleId: sched.id },
      t("setup.quickPath.schedule", { name: sched.name }),
    );
    return { rules: [{ kind: "path", pathId: path.id }], pathId: path.id };
  }
  const path = await ensureQuickPath(
    tx,
    tenantId,
    { memberId: actor.memberId },
    { kind: "member", memberId: actor.memberId },
    t("setup.quickPath.member", { name: actor.name }),
  );
  return { rules: [{ kind: "path", pathId: path.id }], pathId: path.id };
}

/**
 * Writes one of the three choices onto the source itself.
 *
 * They used to be written into a route scoped to this source alone, created on
 * the first change and slipped in just before the catch-all. That put them in
 * the list of rules where nobody had written them, and gave them a position a
 * rule written afterwards could not beat — the opposite of what the screen
 * promises. They are columns on the source now, and the pipeline lays them
 * over the shared rule after every real rule has had its turn.
 *
 * Touching one choice writes one column: a source that has only ever answered
 * "who to page" keeps following the shared rule on the other two, and says so.
 */
async function applyChoices(
  tx: Tx,
  tenantId: string,
  actor: { memberId: string; name: string },
  source: { id: string; name: string },
  patch: { page?: PageInput; incident?: IncidentChoice; autoResolve?: boolean },
): Promise<void> {
  const next: Partial<typeof alertSources.$inferInsert> = {};
  if (patch.page) {
    const { rules } = await rulesFor(tx, tenantId, actor, patch.page);
    next.escalations = rules;
  }
  if (patch.incident) {
    next.incidentOpens =
      patch.incident === "never" ? "never" : patch.incident === "triage" ? "always" : "conditional";
  }
  if (patch.autoResolve !== undefined) next.autoResolve = patch.autoResolve;
  if (Object.keys(next).length === 0) return;
  await tx
    .update(alertSources)
    .set(next)
    .where(and(eq(alertSources.tenantId, tenantId), eq(alertSources.id, source.id)));
}

/** One chip on the source page: the choice is written and the next alert follows it. */
export async function saveSourceChoices(formData: FormData) {
  const current = await requireManager();
  const input = z
    .object({
      id: uuid,
      field: z.enum(["page", "incident", "autoResolve"]),
      value: z.string().max(80),
      teamId: z.string().max(60).optional(),
      scheduleId: z.string().max(60).optional(),
    })
    .parse(Object.fromEntries(formData.entries()));
  const source = await loadSource(current.tenant.id, input.id);
  if (!source) return;
  const actor = { memberId: current.member.id, name: current.member.name };
  const patch: { page?: PageInput; incident?: IncidentChoice; autoResolve?: boolean } = {};
  if (input.field === "page")
    patch.page = pageChoice.parse({
      kind: input.value,
      teamId: input.teamId || undefined,
      scheduleId: input.scheduleId || undefined,
    });
  if (input.field === "incident")
    patch.incident = z.enum(["triage", "urgent", "never"]).parse(input.value);
  if (input.field === "autoResolve") patch.autoResolve = input.value === "on";
  await withTenant(current.tenant.id, async (tx) => {
    await applyChoices(tx, current.tenant.id, actor, source, patch);
    await recordAudit(tx, current, "config", "alert_source.choices", {
      name: source.name,
      field: input.field,
      value: input.value,
    });
  });
  revalidateSources(input.id);
  revalidatePath("/app/settings/alert-routes");
}

/* ---------- Creating, rotating, deleting ---------- */

/** Creates a source and returns its secret ONCE, with the endpoint to paste into the tool. */
export async function createSource(
  _prev: unknown,
  formData: FormData,
): Promise<{ secret?: string; endpoint?: string; id?: string; error?: string }> {
  const current = await requireManager();
  const parsed = z
    .object({
      kind: z.enum(KINDS),
      name: z.string().trim().min(2).max(80),
      description: z.string().trim().max(300).optional(),
      page: z.enum(["owner", "me", "team", "schedule", "nobody"]).optional(),
      teamId: z.string().max(60).optional(),
      scheduleId: z.string().max(60).optional(),
      incident: z.enum(["triage", "urgent", "never"]).optional(),
      autoResolve: z.enum(["on", "off"]).optional(),
    })
    .safeParse(Object.fromEntries(formData.entries()));
  if (!parsed.success) return { error: "invalid" };
  const secret = `oisrc_${randomBytes(20).toString("hex")}`;
  const actor = { memberId: current.member.id, name: current.member.name };
  const id = await withTenant(current.tenant.id, async (tx) => {
    const [dup] = await tx
      .select({ id: alertSources.id })
      .from(alertSources)
      .where(
        and(eq(alertSources.tenantId, current.tenant.id), eq(alertSources.name, parsed.data.name)),
      );
    if (dup) return null;
    const [row] = await tx
      .insert(alertSources)
      .values({
        tenantId: current.tenant.id,
        kind: parsed.data.kind,
        name: parsed.data.name,
        description: parsed.data.description || null,
        secretHash: createHash("sha256").update(secret).digest("hex"),
        mappings: defaultMappings(parsed.data.kind),
        createdByMemberId: current.member.id,
      })
      .returning({ id: alertSources.id });
    await recordAudit(tx, current, "config", "alert_source.created", {
      name: parsed.data.name,
      kind: parsed.data.kind,
    });
    return row!.id;
  });
  if (!id) return { error: "duplicate" };
  await registerApiKeyLookup(`src:${id}`, current.tenant.id);
  if (parsed.data.page || parsed.data.incident || parsed.data.autoResolve) {
    await withTenant(current.tenant.id, (tx) =>
      applyChoices(
        tx,
        current.tenant.id,
        actor,
        { id, name: parsed.data.name },
        {
          page: parsed.data.page
            ? {
                kind: parsed.data.page,
                teamId: parsed.data.teamId || undefined,
                scheduleId: parsed.data.scheduleId || undefined,
              }
            : undefined,
          incident: parsed.data.incident,
          autoResolve: parsed.data.autoResolve ? parsed.data.autoResolve === "on" : undefined,
        },
      ),
    );
    revalidatePath("/app/settings/alert-routes");
  }
  revalidateSources(id);
  return { secret, endpoint: endpointOf(await currentOrigin(), id), id };
}

/** A new secret, shown once; the old one stops working immediately. */
export async function rotateSecret(
  _prev: unknown,
  formData: FormData,
): Promise<{ secret?: string; endpoint?: string; name?: string; error?: string }> {
  const current = await requireManager();
  const id = uuid.parse(formData.get("id"));
  const secret = `oisrc_${randomBytes(20).toString("hex")}`;
  const name = await withTenant(current.tenant.id, async (tx) => {
    const [s] = await tx
      .select({ name: alertSources.name })
      .from(alertSources)
      .where(and(eq(alertSources.tenantId, current.tenant.id), eq(alertSources.id, id)));
    if (!s) return null;
    await tx
      .update(alertSources)
      .set({ secretHash: createHash("sha256").update(secret).digest("hex") })
      .where(eq(alertSources.id, id));
    await recordAudit(tx, current, "config", "alert_source.secret_rotated", { name: s.name });
    return s.name;
  });
  return name
    ? { secret, endpoint: endpointOf(await currentOrigin(), id), name }
    : { error: "not_found" };
}

export async function saveSourceMeta(formData: FormData) {
  const current = await requireManager();
  const input = z
    .object({
      id: uuid,
      name: z.string().trim().min(2).max(80),
      description: z.string().trim().max(300).optional(),
    })
    .parse(Object.fromEntries(formData.entries()));
  await withTenant(current.tenant.id, (tx) =>
    tx
      .update(alertSources)
      .set({ name: input.name, description: input.description || null })
      .where(and(eq(alertSources.tenantId, current.tenant.id), eq(alertSources.id, input.id))),
  );
  revalidateSources(input.id);
  redirect(`${PAGE}/${input.id}?saved=1`);
}

const mappingSchema = z.array(
  z.object({
    attribute: z.string().trim().min(1).max(60),
    path: z.string().trim().max(200).default(""),
    value: z.string().trim().max(200).optional(),
    transform: z
      .enum(["lower", "upper", "after_colon", "before_colon", "first_word", "trim"])
      .optional(),
    match: z.string().trim().max(200).optional(),
  }),
);

/** The source's mappings — how its payload becomes the workspace's attributes. */
export async function saveSourceMappings(formData: FormData) {
  const current = await requireManager();
  const id = uuid.parse(formData.get("id"));
  let raw: unknown;
  try {
    raw = JSON.parse(String(formData.get("mappings") ?? "[]"));
  } catch {
    redirect(`${PAGE}/${id}?error=mappings`);
  }
  const parsed = mappingSchema.safeParse(raw);
  if (!parsed.success) redirect(`${PAGE}/${id}?error=mappings`);
  const mappings: AttributeMapping[] = parsed.data
    .filter((m) => m.path || m.value)
    .map((m) => ({
      attribute: m.attribute,
      path: m.path,
      ...(m.value ? { value: m.value } : {}),
      ...(m.transform && m.transform !== "trim" ? { transform: m.transform } : {}),
      ...(m.match ? { match: m.match } : {}),
    }));
  await withTenant(current.tenant.id, async (tx) => {
    await tx
      .update(alertSources)
      .set({ mappings })
      .where(and(eq(alertSources.tenantId, current.tenant.id), eq(alertSources.id, id)));
    await recordAudit(tx, current, "config", "alert_source.mappings", { count: mappings.length });
  });
  revalidateSources(id);
  redirect(`${PAGE}/${id}?saved=mappings`);
}

const priorityRuleSchema = z.union([
  z.object({ mode: z.literal("static"), priorityId: uuid }),
  z.object({
    mode: z.literal("field"),
    path: z.string().trim().min(1).max(200),
    map: z.record(z.string(), z.string()),
    fallbackPriorityId: uuid.nullable(),
  }),
]);

export async function saveSourcePriorityRule(formData: FormData) {
  const current = await requireManager();
  const id = uuid.parse(formData.get("id"));
  const text = String(formData.get("rule") ?? "");
  let rule: PriorityRule | null = null;
  if (text) {
    try {
      const parsed = priorityRuleSchema.safeParse(JSON.parse(text));
      if (!parsed.success) redirect(`${PAGE}/${id}?error=priority`);
      rule = parsed.data;
    } catch {
      redirect(`${PAGE}/${id}?error=priority`);
    }
  }
  await withTenant(current.tenant.id, (tx) =>
    tx
      .update(alertSources)
      .set({ priorityRule: rule })
      .where(and(eq(alertSources.tenantId, current.tenant.id), eq(alertSources.id, id))),
  );
  revalidateSources(id);
  redirect(`${PAGE}/${id}?saved=priority`);
}

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

export async function saveSourceFilter(formData: FormData) {
  const current = await requireManager();
  const id = uuid.parse(formData.get("id"));
  let filter: ConditionGroup[] = [];
  try {
    const parsed = conditionsSchema.safeParse(
      JSON.parse(String(formData.get("conditions") ?? "[]")),
    );
    if (!parsed.success) redirect(`${PAGE}/${id}?error=filter`);
    filter = parsed.data.filter((g) => g.all.length > 0);
  } catch {
    redirect(`${PAGE}/${id}?error=filter`);
  }
  await withTenant(current.tenant.id, (tx) =>
    tx
      .update(alertSources)
      .set({ filter })
      .where(and(eq(alertSources.tenantId, current.tenant.id), eq(alertSources.id, id))),
  );
  revalidateSources(id);
  redirect(`${PAGE}/${id}?saved=filter`);
}

export async function toggleSource(formData: FormData) {
  const current = await requireManager();
  const id = uuid.parse(formData.get("id"));
  await withTenant(current.tenant.id, async (tx) => {
    const [s] = await tx
      .select()
      .from(alertSources)
      .where(and(eq(alertSources.tenantId, current.tenant.id), eq(alertSources.id, id)));
    if (!s) return;
    await tx.update(alertSources).set({ active: !s.active }).where(eq(alertSources.id, id));
    await recordAudit(
      tx,
      current,
      "config",
      s.active ? "alert_source.disabled" : "alert_source.enabled",
      {
        name: s.name,
      },
    );
  });
  revalidateSources(id);
}

export async function deleteSource(formData: FormData) {
  const current = await requireManager();
  const id = uuid.parse(formData.get("id"));
  await withTenant(current.tenant.id, async (tx) => {
    const [s] = await tx
      .select()
      .from(alertSources)
      .where(and(eq(alertSources.tenantId, current.tenant.id), eq(alertSources.id, id)));
    if (!s) return;
    await tx.delete(alertSources).where(eq(alertSources.id, id));
    await recordAudit(tx, current, "config", "alert_source.deleted", { name: s.name });
  });
  await forgetApiKeyLookup(`src:${id}`);
  revalidateSources();
  redirect(PAGE);
}

/** "Test": a real alert through the whole pipeline, in test mode — logged, routed, paging nobody. */
export async function testSource(formData: FormData) {
  const current = await requireManager();
  const id = uuid.parse(formData.get("id"));
  const back = String(formData.get("back") ?? "");
  const source = await loadSource(current.tenant.id, id);
  if (!source) return;
  const meta =
    SOURCE_KINDS.find((k) => k.kind === source.kind) ?? SOURCE_KINDS[SOURCE_KINDS.length - 1]!;
  const outcomes = await ingestPayload(
    current.tenant.id,
    source,
    meta.sample(source.name, new Date().toISOString()),
    { test: true, actorName: current.member.name },
  );
  revalidateSources(id);
  const alertId = outcomes[0]?.alertId ?? "";
  if (back === "alerting") redirect(`/app/settings/alerting?saved=test`);
  if (back === "detail") redirect(`${PAGE}/${id}?tested=${alertId}`);
  redirect(`${PAGE}?tested=${id}&alert=${alertId}`);
}

/* ---------- The payload tester ---------- */

export type SimulationView = {
  title: string;
  status: "firing" | "resolved";
  dedupKey: string;
  attributes: Record<string, string>;
  priority: string | null;
  urgency: "high" | "low";
  filtered: boolean;
  route: { id: string; name: string; testMode: boolean } | null;
  escalations: Array<{
    path: string | null;
    via: string | null;
    skipped: "condition" | "unresolved" | "unpublished" | null;
  }>;
  incident: { wants: boolean; type: string | null; phase: string; severity: string | null } | null;
  grouping: { enabled: boolean; key: string | null; joins: string | null } | null;
  missing: string[];
};

function view(p: AlertPlan): SimulationView {
  return {
    title: p.parsed.title,
    status: p.parsed.status,
    dedupKey: p.parsed.dedupKey,
    attributes: p.attributes,
    priority: p.priority?.name ?? null,
    urgency: p.urgency,
    filtered: p.filtered,
    route: p.route ? { id: p.route.id, name: p.route.name, testMode: p.route.testMode } : null,
    escalations: p.escalations.map((e) => ({ path: e.pathName, via: e.via, skipped: e.skipped })),
    incident: p.incident.template
      ? {
          wants: p.incident.wants,
          type: p.incident.typeName,
          phase: p.incident.template.startPhase,
          severity: p.incident.severityName,
        }
      : null,
    grouping: p.grouping.rule
      ? {
          enabled: p.grouping.rule.enabled,
          key: p.grouping.key,
          joins: p.grouping.leader?.title ?? null,
        }
      : null,
    missing: p.missingRequired,
  };
}

/** What the pipeline would do with this payload — read only, nothing stored. */
export async function previewPayload(
  id: string,
  text: string,
): Promise<{ plans: SimulationView[] } | { error: "invalid_json" | "not_found" | "empty" }> {
  const current = await requireManager();
  const source = await loadSource(current.tenant.id, uuid.parse(id));
  if (!source) return { error: "not_found" };
  let payload: unknown;
  try {
    payload = JSON.parse(text);
  } catch {
    return { error: "invalid_json" };
  }
  const plans = await simulateIngest(current.tenant.id, source, payload);
  if (plans.length === 0) return { error: "empty" };
  return { plans: plans.map(view) };
}

/** The payload for real: as a test alert (routed, paging nobody) or as an alert like any other. */
export async function sendPayload(
  id: string,
  text: string,
  test: boolean,
): Promise<
  { alertId: string; action: string; incidentNumber: number | null }[] | { error: string }
> {
  const current = await requireManager();
  const source = await loadSource(current.tenant.id, uuid.parse(id));
  if (!source) return { error: "not_found" };
  let payload: unknown;
  try {
    payload = JSON.parse(text);
  } catch {
    return { error: "invalid_json" };
  }
  const outcomes = await ingestPayload(current.tenant.id, source, payload, {
    test,
    actorName: current.member.name,
  });
  revalidateSources(id);
  return outcomes.map((o) => ({
    alertId: o.alertId,
    action: o.action,
    incidentNumber: o.incidentNumber ?? null,
  }));
}
