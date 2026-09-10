"use server";

import { createHash, randomBytes } from "node:crypto";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import {
  alertSources,
  forgetApiKeyLookup,
  registerApiKeyLookup,
  withTenant,
  type AlertSourceKind,
  type AttributeMapping,
  type ConditionGroup,
  type PriorityRule,
} from "@openincident/db";
import { defaultMappings } from "@openincident/oncall";
import { recordAudit } from "@/lib/audit";
import { ingestPayload, simulateIngest, type AlertPlan } from "@/lib/alert-ingest";
import { SOURCE_KINDS } from "@/lib/alert-sources";
import { requireManager } from "@/lib/session";
import { requestOrigin } from "@/lib/tenant";
import { headers } from "next/headers";

const KINDS = SOURCE_KINDS.map((k) => k.kind) as [AlertSourceKind, ...AlertSourceKind[]];
const PAGE = "/app/settings/alert-sources";
const uuid = z.string().uuid();

async function currentOrigin(): Promise<string> {
  const h = await headers();
  return requestOrigin({ headers: h, nextUrl: new URL(`http://${h.get("host") ?? "localhost"}/`) });
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
    })
    .safeParse(Object.fromEntries(formData.entries()));
  if (!parsed.success) return { error: "invalid" };
  const secret = `oisrc_${randomBytes(20).toString("hex")}`;
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
  revalidatePath(PAGE);
  revalidatePath("/app/settings/alerting");
  return { secret, endpoint: `${await currentOrigin()}/api/ingest/alerts/${id}`, id };
}

/** A new secret, shown once; the old one stops working immediately. */
export async function rotateSecret(
  _prev: unknown,
  formData: FormData,
): Promise<{ secret?: string; error?: string }> {
  const current = await requireManager();
  const id = uuid.parse(formData.get("id"));
  const secret = `oisrc_${randomBytes(20).toString("hex")}`;
  const ok = await withTenant(current.tenant.id, async (tx) => {
    const [s] = await tx
      .select({ name: alertSources.name })
      .from(alertSources)
      .where(and(eq(alertSources.tenantId, current.tenant.id), eq(alertSources.id, id)));
    if (!s) return false;
    await tx
      .update(alertSources)
      .set({ secretHash: createHash("sha256").update(secret).digest("hex") })
      .where(eq(alertSources.id, id));
    await recordAudit(tx, current, "config", "alert_source.secret_rotated", { name: s.name });
    return true;
  });
  return ok ? { secret } : { error: "not_found" };
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
  revalidatePath(PAGE);
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
  revalidatePath(PAGE);
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
  revalidatePath(PAGE);
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
  revalidatePath(PAGE);
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
  revalidatePath(PAGE);
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
  revalidatePath(PAGE);
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
  revalidatePath(PAGE);
  revalidatePath("/app/alerts");
  revalidatePath("/app/settings/alerting");
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
  revalidatePath(PAGE);
  revalidatePath("/app/alerts");
  revalidatePath("/app/settings/alerting");
  return outcomes.map((o) => ({
    alertId: o.alertId,
    action: o.action,
    incidentNumber: o.incidentNumber ?? null,
  }));
}
