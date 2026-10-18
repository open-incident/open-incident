import { notFound, redirect } from "next/navigation";
import { and, eq } from "drizzle-orm";
import {
  atlasActions,
  incidents,
  investigations,
  members,
  services,
  withTenant,
} from "@openincident/db";
import { atlas } from "@openincident/investigations";
import { getT } from "@/i18n/server";
import { getTenantFromHeaders } from "@/lib/tenant";
import {
  AtlasRefusal,
  approveAction,
  rejectAction,
  reviewResolution,
  stopIncident,
  undoAction,
  type AtlasActor,
} from "@/lib/atlas/control";

export const dynamic = "force-dynamic";

/**
 * The one-tap Atlas links of the phone and the chat (spec delta §15.5, §16):
 * Undo, Approve, Stop — no sign-in, the signed token is the proof the link
 * reached the person it was sent to. Opening the link changes nothing (chat
 * previews open links too); the button does. Mobile-first, like /ack.
 */
type Claims = NonNullable<ReturnType<typeof atlas.verifyLink>>;

async function load(tenantId: string, c: Claims) {
  return withTenant(tenantId, async (tx) => {
    const [member] = c.m
      ? await tx
          .select({ id: members.id, name: members.name })
          .from(members)
          .where(and(eq(members.tenantId, tenantId), eq(members.id, c.m)))
      : [];
    if (c.op === "stop") {
      const [inc] = await tx
        .select({
          id: incidents.id,
          number: incidents.number,
          name: incidents.name,
          phase: incidents.phase,
        })
        .from(incidents)
        .where(and(eq(incidents.tenantId, tenantId), eq(incidents.id, c.id)));
      if (!inc) return null;
      const [inv] = await tx
        .select({ paused: investigations.paused })
        .from(investigations)
        .where(eq(investigations.incidentId, inc.id));
      return {
        member: member ?? null,
        incident: inc,
        row: null,
        inv: null,
        service: null,
        stopped: inv?.paused ?? false,
      };
    }
    const [row] = await tx
      .select()
      .from(atlasActions)
      .where(and(eq(atlasActions.tenantId, tenantId), eq(atlasActions.id, c.id)));
    if (!row?.incidentId) return null;
    const [inc] = await tx
      .select({
        id: incidents.id,
        number: incidents.number,
        name: incidents.name,
        phase: incidents.phase,
      })
      .from(incidents)
      .where(eq(incidents.id, row.incidentId));
    const [inv] = await tx
      .select()
      .from(investigations)
      .where(eq(investigations.incidentId, row.incidentId));
    const [svc] = row.serviceId
      ? await tx.select({ key: services.key }).from(services).where(eq(services.id, row.serviceId))
      : [];
    return {
      member: member ?? null,
      incident: inc!,
      row,
      inv: inv ?? null,
      service: svc?.key ?? null,
      stopped: false,
    };
  });
}

async function act(formData: FormData) {
  "use server";
  const tenant = await getTenantFromHeaders();
  const token = String(formData.get("token") ?? "");
  const choice = String(formData.get("choice") ?? "");
  if (!tenant) return;
  const claims = atlas.verifyLink(token, tenant.id);
  if (!claims) redirect(`/ack/atlas/${token}?r=expired`);
  const info = await load(tenant.id, claims);
  if (!info) redirect(`/ack/atlas/${token}?r=gone`);
  const t = await getT();
  const by: AtlasActor = {
    memberId: info.member?.id ?? null,
    label: info.member?.name ?? t("atlas.link.someone"),
  };
  let r = "done";
  try {
    if (claims.op === "stop") await stopIncident(tenant.id, claims.id, by);
    else if (claims.op === "approve") {
      if (choice === "reject") {
        await rejectAction(tenant.id, claims.id, by);
        r = "rejected";
      } else await approveAction(tenant.id, claims.id, by);
    } else if (claims.op === "undo") {
      // Undoing a resolution Atlas made alone is the review queue's Reopen:
      // every reversible step goes back, the owner is paged.
      if (info.row?.payload?.op === "resolve" && info.inv?.reviewState === "pending")
        await reviewResolution(tenant.id, info.inv.id, "reopen", by);
      else await undoAction(tenant.id, claims.id, by);
    }
  } catch (err) {
    r = err instanceof AtlasRefusal ? `refused:${err.message}` : "failed";
    if (!(err instanceof AtlasRefusal)) console.error("[atlas link] failed:", err);
  }
  redirect(`/ack/atlas/${token}?r=${encodeURIComponent(r)}`);
}

export default async function AtlasLinkPage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ r?: string }>;
}) {
  const { token } = await params;
  const q = await searchParams;
  const tenant = await getTenantFromHeaders();
  if (!tenant) notFound();
  const t = await getT();
  const claims = atlas.verifyLink(token, tenant.id);
  const info = claims ? await load(tenant.id, claims) : null;
  const what = info?.row
    ? String(info.row.payload?.todo ?? info.row.payload?.done ?? info.row.title)
    : null;
  const reference = info ? `INC-${info.incident.number}` : "";

  // What the link can still do.
  let pending = false;
  let state: string | null = null;
  if (!claims || q.r === "expired") state = t("atlas.link.expired");
  else if (!info || q.r === "gone") state = t("atlas.link.gone");
  else if (q.r === "done")
    state = t(`atlas.link.done.${claims.op === "reject" ? "approve" : claims.op}`);
  else if (q.r === "rejected") state = t("atlas.link.done.rejected");
  else if (q.r?.startsWith("refused:")) state = t("atlas.link.refused", { reason: q.r.slice(8) });
  else if (q.r === "failed") state = t("atlas.link.failed");
  else if (claims.op === "stop")
    pending =
      !info.stopped && (info.incident.phase === "triage" || info.incident.phase === "active");
  else if (claims.op === "approve") pending = info.row?.approvalState === "waiting";
  else if (claims.op === "undo") pending = info.row ? atlas.undoable(info.row).ok : false;
  if (!pending && !state && claims && info)
    state =
      claims.op === "approve"
        ? t("atlas.link.decided")
        : claims.op === "stop"
          ? t("atlas.link.done.stop")
          : info.row?.undoneAt
            ? t("atlas.link.alreadyUndone")
            : t("atlas.link.closed");

  const op = claims?.op === "reject" ? "approve" : (claims?.op ?? "undo");
  const button = {
    undo: "var(--dang)",
    approve: "var(--viol)",
    stop: "var(--dang)",
    review: "var(--viol)",
  }[op];
  return (
    <main
      style={{
        minHeight: "100vh",
        display: "grid",
        placeItems: "center",
        padding: 20,
        background: "var(--canvas)",
      }}
    >
      <div
        data-testid="atlas-link"
        style={{
          width: 420,
          maxWidth: "100%",
          background: "var(--panel)",
          border: "1px solid var(--line)",
          borderRadius: 18,
          boxShadow: "var(--shadow-login)",
          padding: 24,
          display: "flex",
          flexDirection: "column",
          gap: 14,
        }}
      >
        <div style={{ fontFamily: "var(--font-title)", fontSize: 16, fontWeight: 600 }}>
          Open<span style={{ color: "var(--brand)" }}>*</span>Incident
        </div>
        {info?.member && (
          <div style={{ fontSize: 12, color: "var(--ink-3)" }}>
            {t("atlas.link.hello", { name: info.member.name })}
          </div>
        )}
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ color: "var(--viol)", fontSize: 15 }}>✦</span>
          <span style={{ fontSize: 17, fontWeight: 600, lineHeight: 1.35 }}>
            {info
              ? t(`atlas.link.title.${op}`, { incident: reference })
              : t("atlas.link.titleNone")}
          </span>
        </div>
        {info && (
          <div
            style={{
              background: "var(--viol-t)",
              borderRadius: 12,
              padding: "11px 13px",
              display: "flex",
              flexDirection: "column",
              gap: 4,
            }}
          >
            <div style={{ fontSize: 13.5, fontWeight: 600, lineHeight: 1.4 }}>
              {what ?? info.incident.name}
            </div>
            <div style={{ fontSize: 12, color: "var(--ink-2)" }}>
              {reference} · {info.incident.name}
              {info.service ? ` · ${info.service}` : ""}
              {info.row?.level != null
                ? ` · ${t("atlas.link.level", { level: info.row.level })}`
                : ""}
            </div>
          </div>
        )}
        {pending && claims ? (
          <form action={act} style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <input type="hidden" name="token" value={token} />
            <button
              type="submit"
              name="choice"
              value="go"
              data-testid="atlas-link-button"
              style={{
                height: 48,
                borderRadius: 12,
                background: button,
                color: "#fff",
                border: 0,
                fontSize: 15,
                fontWeight: 700,
                cursor: "pointer",
              }}
            >
              {t(`atlas.link.button.${op}`)}
            </button>
            {op === "approve" && (
              <button
                type="submit"
                name="choice"
                value="reject"
                data-testid="atlas-link-reject"
                style={{
                  height: 40,
                  borderRadius: 12,
                  background: "var(--panel)",
                  color: "var(--ink-2)",
                  border: "1px solid var(--line)",
                  fontSize: 13.5,
                  fontWeight: 600,
                  cursor: "pointer",
                }}
              >
                {t("atlas.link.button.reject")}
              </button>
            )}
            <div style={{ fontSize: 12, color: "var(--ink-3)", lineHeight: 1.5 }}>
              {t(`atlas.link.note.${op}`)}
            </div>
          </form>
        ) : (
          <div
            data-testid="atlas-link-done"
            style={{
              border: `1px solid ${q.r === "done" || q.r === "rejected" ? "var(--ok)" : "var(--line)"}`,
              background: q.r === "done" || q.r === "rejected" ? "var(--ok-t)" : "var(--sunk)",
              borderRadius: 12,
              padding: "12px 14px",
              fontSize: 13.5,
              color: "var(--ink-2)",
            }}
          >
            {state}
          </div>
        )}
        {info && (
          <a
            href={`/app/incidents/${info.incident.number}?tab=atlas`}
            className="oi-link"
            style={{ fontSize: 13, fontWeight: 600 }}
          >
            {t("atlas.link.open", { incident: reference })}
          </a>
        )}
      </div>
    </main>
  );
}
