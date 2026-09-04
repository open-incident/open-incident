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
} from "@openincident/db";
import { defaultMappings } from "@openincident/oncall";
import { recordAudit } from "@/lib/audit";
import { ingestPayload } from "@/lib/alert-ingest";
import { requireManager } from "@/lib/session";
import { requestOrigin } from "@/lib/tenant";
import { headers } from "next/headers";

const KINDS = [
  "http",
  "prometheus",
  "grafana",
  "datadog",
  "sentry",
  "cloudwatch",
  "uptime_kuma",
] as const;

/** Creates a source and returns its secret ONCE, with the endpoint to paste into the tool. */
export async function createSource(
  _prev: unknown,
  formData: FormData,
): Promise<{ secret?: string; endpoint?: string; error?: string }> {
  const current = await requireManager();
  const parsed = z
    .object({ kind: z.enum(KINDS), name: z.string().trim().min(2).max(80) })
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
        kind: parsed.data.kind as AlertSourceKind,
        name: parsed.data.name,
        secretHash: createHash("sha256").update(secret).digest("hex"),
        mappings: defaultMappings(parsed.data.kind as AlertSourceKind),
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
  const h = await headers();
  const origin = requestOrigin({
    headers: h,
    nextUrl: new URL(`http://${h.get("host") ?? "localhost"}/`),
  });
  revalidatePath("/app/settings/alert-sources");
  return { secret, endpoint: `${origin}/api/ingest/alerts/${id}` };
}

export async function toggleSource(formData: FormData) {
  const current = await requireManager();
  const id = z.string().uuid().parse(formData.get("id"));
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
      { name: s.name },
    );
  });
  revalidatePath("/app/settings/alert-sources");
}

export async function deleteSource(formData: FormData) {
  const current = await requireManager();
  const id = z.string().uuid().parse(formData.get("id"));
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
  revalidatePath("/app/settings/alert-sources");
}

/** "Test": a real alert through the whole pipeline, in test mode — logged, routed, paging nobody. */
export async function testSource(formData: FormData) {
  const current = await requireManager();
  const id = z.string().uuid().parse(formData.get("id"));
  const source = await withTenant(current.tenant.id, async (tx) => {
    const [s] = await tx
      .select()
      .from(alertSources)
      .where(and(eq(alertSources.tenantId, current.tenant.id), eq(alertSources.id, id)));
    return s ?? null;
  });
  if (!source) return;
  const stamp = new Date().toISOString();
  const payloads: Record<string, unknown> = {
    datadog: {
      monitor_id: 999001,
      title: `[TEST] ${source.name} — synthetic monitor`,
      status: "Triggered",
      priority: "P3",
      scope: "service:checkout-api,env:production",
    },
    prometheus: {
      alerts: [
        {
          status: "firing",
          labels: {
            alertname: "TestAlert",
            severity: "warning",
            service: "checkout-api",
            env: "production",
          },
          annotations: { summary: `[TEST] ${source.name} — synthetic alert` },
          fingerprint: `test-${stamp}`,
        },
      ],
    },
    grafana: {
      title: `[TEST] ${source.name} — synthetic rule`,
      state: "alerting",
      ruleId: `test-${stamp}`,
    },
    sentry: {
      action: "created",
      data: {
        issue: {
          id: `test-${Date.now()}`,
          title: `[TEST] ${source.name} — synthetic issue`,
          level: "error",
        },
      },
    },
    cloudwatch: {
      Message: JSON.stringify({
        AlarmName: `[TEST] ${source.name}`,
        NewStateValue: "ALARM",
        AlarmArn: `arn:test:${Date.now()}`,
      }),
    },
    uptime_kuma: {
      heartbeat: { status: 0, msg: "synthetic down" },
      monitor: { id: `test-${Date.now()}`, name: `[TEST] ${source.name}` },
    },
    http: {
      title: `[TEST] ${source.name} — synthetic alert`,
      priority: "P3",
      service: "checkout-api",
      environment: "production",
      dedup_key: `test-${stamp}`,
    },
  };
  const outcomes = await ingestPayload(
    current.tenant.id,
    source,
    payloads[source.kind] ?? payloads.http,
    { test: true, actorName: current.member.name },
  );
  revalidatePath("/app/settings/alert-sources");
  revalidatePath("/app/alerts");
  redirect(`/app/settings/alert-sources?tested=${id}&alert=${outcomes[0]?.alertId ?? ""}`);
}
