import { and, asc, desc, eq, inArray, isNull } from "drizzle-orm";
import {
  apiKeys,
  members,
  webhookDeliveries,
  webhookEndpoints,
  withTenant,
} from "@openincident/db";
import { getT } from "@/i18n/server";
import { isManager, requireMember } from "@/lib/session";
import { currentOrigin } from "@/lib/tenant";
import { CodeCard } from "@/components/settings/controls";
import { ListCard, SettingsPage, type ChipSpec } from "@/components/settings/template";
import { EmptyRow } from "./empty-row";
import { EndpointRow, KeyRow, NewEndpointDialog, NewKeyDialog } from "./dialogs";
import { EVENT_CHOICES, eventsSummary, expiryOf, scopeKey } from "./shape";

/**
 * Settings › API & webhooks (design V2): the keys that call Open Incident and
 * the endpoints it calls. A key says what it may do, on which part of the
 * API, who made it, when it was last used and when it stops; an endpoint
 * says what it receives and how its last delivery went, and "Send test"
 * delivers one now. Secrets are shown once, in the creation dialog, and
 * never again.
 */
export default async function ApiSettingsPage() {
  const { tenant, member } = await requireMember();
  const t = await getT();
  const manages = isManager(member);
  const origin = await currentOrigin();
  const now = Date.now();

  const data = await withTenant(tenant.id, async (tx) => {
    const keys = await tx
      .select({ key: apiKeys, by: members.name })
      .from(apiKeys)
      .leftJoin(members, eq(members.id, apiKeys.createdByMemberId))
      .where(and(eq(apiKeys.tenantId, tenant.id), isNull(apiKeys.revokedAt)))
      .orderBy(asc(apiKeys.createdAt));
    const hooks = await tx
      .select()
      .from(webhookEndpoints)
      .where(eq(webhookEndpoints.tenantId, tenant.id))
      .orderBy(asc(webhookEndpoints.createdAt));
    const deliveries = hooks.length
      ? await tx
          .select()
          .from(webhookDeliveries)
          .where(
            and(
              eq(webhookDeliveries.tenantId, tenant.id),
              inArray(
                webhookDeliveries.endpointId,
                hooks.map((h) => h.id),
              ),
            ),
          )
          .orderBy(desc(webhookDeliveries.createdAt))
          .limit(300)
      : [];
    return { keys, hooks, deliveries };
  });

  /* ---------- Keys ---------- */

  const accessLabel = (scopes: string[]) =>
    scopes.includes("write")
      ? t("settingsV2.api.accessWrite")
      : scopes.includes("read")
        ? t("settingsV2.api.accessRead")
        : t("settingsV2.api.accessCreate");
  const scopeLabel = (resources: string[] | null) => {
    switch (scopeKey(resources)) {
      case "all":
        return t("settingsV2.api.subEverything");
      case "incidents":
        return t("settingsV2.api.subIncidents");
      case "incidents,monitors":
        return t("settingsV2.api.subIncidentsMonitors");
      case "services":
        return t("settingsV2.api.subServices");
      case "status_pages":
        return t("settingsV2.api.subStatusPages");
      default:
        return (resources ?? []).join(", ");
    }
  };
  const expiryChip = (expiresAt: Date | null): ChipSpec => {
    const e = expiryOf(expiresAt, now);
    switch (e.kind) {
      case "never":
        return { label: t("settingsV2.api.neverExpires"), tone: "mute", testId: "key-expiry" };
      case "expired":
        return { label: t("settingsV2.api.expired"), tone: "dang", testId: "key-expiry" };
      case "today":
        return { label: t("settingsV2.api.expiresToday"), tone: "wait", testId: "key-expiry" };
      case "days":
        return {
          label: t("settingsV2.api.expiresDays", { count: e.n }),
          tone: e.n < 30 ? "wait" : "mute",
          testId: "key-expiry",
        };
      case "months":
        return {
          label: t("settingsV2.api.expiresMonths", { count: e.n }),
          tone: "mute",
          testId: "key-expiry",
        };
    }
  };
  const keyRows = data.keys.map(({ key: k, by }) => {
    const parts = [accessLabel(k.scopes), scopeLabel(k.resources ?? null)];
    if (by) parts.push(t("settingsV2.api.createdBy", { name: by }));
    parts.push(
      k.lastUsedAt
        ? t("settingsV2.api.lastUsed", { when: t.fmt.relative(k.lastUsedAt) })
        : t("settingsV2.api.neverUsed"),
    );
    return { id: k.id, name: k.name, sub: parts.join(" · "), chip: expiryChip(k.expiresAt) };
  });

  /* ---------- Endpoints ---------- */

  const at = (d: Date) =>
    new Date(d).toDateString() === new Date().toDateString()
      ? t.fmt.time(d, t.timeZone)
      : t.fmt.dateTime(d, t.timeZone);
  const statusOf = (s: number | null) => (s === null ? t("settingsV2.api.noAnswer") : String(s));
  const hookRows = data.hooks.map((h) => {
    const mine = data.deliveries.filter((d) => d.endpointId === h.id);
    const last = mine[0];
    const off = !h.active || Boolean(h.disabledAt);
    const failing = Boolean(h.failingSince) && !off;
    const failed = mine.filter((d) => d.httpStatus === null || d.httpStatus >= 300);
    const streak = h.failingSince ? failed.filter((d) => d.createdAt >= h.failingSince!).length : 0;
    const events = eventsSummary(h.events) ?? t("settingsV2.api.everyEvent");
    let sub: string;
    let chip: ChipSpec;
    if (off) {
      sub = t("settingsV2.api.subOff", { events });
      chip = { label: t("settingsV2.api.chipDisabled"), tone: "mute", testId: "hook-state" };
    } else if (!last) {
      sub = t("settingsV2.api.subNone", { events });
      chip = { label: t("settingsV2.api.chipNew"), tone: "mute", testId: "hook-state" };
    } else if (failing) {
      sub = t("settingsV2.api.subFailing", {
        events,
        status: statusOf(last.httpStatus),
        count: Math.max(1, streak),
        since: at(h.failingSince!),
      });
      chip = { label: t("settingsV2.api.chipFailing"), tone: "dang", testId: "hook-state" };
    } else {
      sub = t("settingsV2.api.subOk", {
        events,
        status: statusOf(last.httpStatus),
        when: t.fmt.relative(last.createdAt),
      });
      chip = { label: t("settingsV2.api.chipDelivered"), tone: "ok", testId: "hook-state" };
    }
    return {
      id: h.id,
      url: h.url,
      sub,
      chip,
      off,
      events,
      failed: failed.length,
      signing: t("settingsV2.api.signingValue"),
      deliveries: mine.slice(0, 10).map((d) => ({
        id: d.id,
        at: at(d.createdAt),
        event: d.event,
        status: statusOf(d.httpStatus),
        ok: d.httpStatus !== null && d.httpStatus < 300,
        ms: d.latencyMs !== null ? `${t.fmt.number(d.latencyMs)} ms` : "",
      })),
    };
  });

  const choices = EVENT_CHOICES.map((c) => ({
    key: c.key,
    label: c.key === "everything" ? t("settingsV2.api.everything") : c.key,
  }));

  return (
    <SettingsPage
      home={t("settingsV2.home")}
      crumb={t("settingsV2.group.platform")}
      title={t("settingsV2.entry.api")}
      lead={t("settingsV2.api.lead")}
      testId="settings-api"
      actions={
        manages ? (
          <>
            <NewEndpointDialog choices={choices} />
            <NewKeyDialog />
          </>
        ) : undefined
      }
    >
      <ListCard
        title={t("settingsV2.api.keys")}
        hint={t("settingsV2.api.keysHint")}
        testId="api-keys"
      >
        {keyRows.map((k) => (
          <KeyRow key={k.id} k={k} manages={manages} />
        ))}
        {keyRows.length === 0 && <EmptyRow>{t("settingsV2.api.noKeys")}</EmptyRow>}
      </ListCard>

      <ListCard
        title={t("settingsV2.api.hooks")}
        hint={t("settingsV2.api.hooksHint")}
        testId="api-hooks"
      >
        {hookRows.map((h) => (
          <EndpointRow key={h.id} h={h} manages={manages} />
        ))}
        {hookRows.length === 0 && <EmptyRow>{t("settingsV2.api.noHooks")}</EmptyRow>}
      </ListCard>

      <CodeCard
        title={t("settingsV2.api.try")}
        hint={t("settingsV2.api.tryHint")}
        code={`curl -H "Authorization: Bearer $OI_KEY" ${origin}/api/v1/incidents?phase=active`}
        testId="api-try"
      />
    </SettingsPage>
  );
}
