import Link from "next/link";
import { withTenant } from "@openincident/db";
import { getT } from "@/i18n/server";
import { canRespond, requireMember } from "@/lib/session";
import {
  declareOptions,
  followUpPolicy,
  listFollowUps,
  listIncidents,
  type IncidentRow,
} from "@/lib/incidents";
import { listServices } from "@/lib/services";
import { aiAllowance } from "@/lib/ai-capabilities";
import { connectedTrackers } from "@/lib/trackers";
import { avatarTone, initials } from "@/lib/avatar";
import { FollowUpRowView } from "./follow-up-row";
import { DeclareForm } from "./new/declare-form";
import { servicesOfIncidents } from "./services-of";
import { severityTone, statusInk } from "./tone";

const TABS = ["open", "triage", "post", "all"] as const;
type Tab = (typeof TABS)[number];

/**
 * IN-01 — the incidents list of the V2 design: the title, the four views as a
 * segmented control with their counts, the declare button, then one 7-column
 * row per incident inside a single card — number, severity, title, status,
 * service, lead, last activity.
 *
 * The declaration modal opens over this list (`?declare=1`, what the rail and
 * the palette push), and the cross-incident follow-ups list stays reachable at
 * `?view=follow-ups` — it is a different object than an incident, so the
 * design's four tabs do not carry it.
 */
export default async function IncidentsPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string; view?: string; q?: string; declare?: string }>;
}) {
  const { tenant, member } = await requireMember();
  const t = await getT();
  const sp = await searchParams;
  const followUpsView = sp.view === "follow-ups";
  const tab: Tab = (TABS as readonly string[]).includes(sp.tab ?? "")
    ? (sp.tab as Tab)
    : sp.view === "triage"
      ? "triage"
      : "open";
  const q = (sp.q ?? "").trim();
  const mayDeclare = canRespond(member);
  const declaring = sp.declare === "1" && mayDeclare;

  const data = await withTenant(tenant.id, async (tx) => {
    // "open" already excludes closed and triage, so it carries the active and
    // the post-incident ones; the three lists together are what the four tabs
    // partition, and every count is read off the rows the list itself shows.
    const open = await listIncidents(tx, tenant.id, "open", member.id);
    const triage = await listIncidents(tx, tenant.id, "triage", member.id);
    const resolved = await listIncidents(tx, tenant.id, "resolved", member.id);
    const rows = [...open, ...triage, ...resolved];
    return {
      rows,
      byIncident: await servicesOfIncidents(
        tx,
        tenant.id,
        rows.map((r) => r.id),
      ),
      followUps: followUpsView ? await listFollowUps(tx, tenant.id) : [],
      policy: followUpsView ? await followUpPolicy(tx, tenant.id) : null,
      trackers: followUpsView ? await connectedTrackers(tx, tenant.id) : [],
    };
  });

  const declare = declaring
    ? await withTenant(tenant.id, async (tx) => ({
        options: await declareOptions(tx, tenant.id),
        services: await listServices(tx, tenant.id),
      }))
    : null;
  const declareAi = declaring ? (await aiAllowance(tenant.id, "declare_suggest")).ok : false;

  const groups: Record<Tab, IncidentRow[]> = {
    open: data.rows.filter((r) => r.phase === "active"),
    triage: data.rows.filter((r) => r.phase === "triage"),
    post: data.rows.filter((r) => r.phase === "post_incident"),
    all: data.rows,
  };
  const matches = (r: IncidentRow) =>
    q.length === 0 ||
    r.name.toLowerCase().includes(q.toLowerCase()) ||
    String(r.number).includes(q);
  const rows = groups[tab].filter(matches);

  const href = (x: Tab) =>
    `/app/incidents${x === "open" ? "" : `?tab=${x}`}${q ? `${x === "open" ? "?" : "&"}q=${encodeURIComponent(q)}` : ""}`;

  return (
    <div
      style={{
        maxWidth: 1200,
        margin: "0 auto",
        padding: "22px 28px 60px",
        display: "flex",
        flexDirection: "column",
        gap: 14,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
        <h1
          style={{
            margin: 0,
            fontFamily: "var(--title)",
            fontSize: 22,
            fontWeight: 600,
            letterSpacing: "-.015em",
          }}
        >
          {t("inc2.title")}
        </h1>
        <nav
          aria-label={t("inc2.tabsLabel")}
          style={{
            display: "flex",
            gap: 2,
            background: "var(--sunk)",
            borderRadius: 10,
            padding: 3,
          }}
        >
          {(
            [
              ["open", t("inc2.tab.open"), groups.open.length],
              ["triage", t("inc2.tab.triage"), groups.triage.length],
              ["post", t("inc2.tab.post"), groups.post.length],
              ["all", t("inc2.tab.all"), groups.all.length],
            ] as Array<[Tab, string, number]>
          ).map(([id, label, count]) => {
            const on = id === tab && !followUpsView;
            return (
              <Link
                key={id}
                href={href(id)}
                aria-current={on ? "page" : undefined}
                style={{
                  height: 28,
                  padding: "0 12px",
                  borderRadius: 8,
                  background: on ? "var(--panel)" : "transparent",
                  color: on ? "var(--ink)" : "var(--ink-3)",
                  boxShadow: on ? "var(--shadow-card)" : "none",
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  fontSize: 12.5,
                  fontWeight: 600,
                  textDecoration: "none",
                }}
              >
                {label}
                <span style={{ fontFamily: "var(--mono)", fontSize: 11, opacity: 0.7 }}>
                  {t.fmt.number(count)}
                </span>
              </Link>
            );
          })}
        </nav>
        <span style={{ flex: 1 }} />
        {mayDeclare && (
          <Link
            href="/app/incidents?declare=1"
            data-testid="declare-open"
            className="oi-hover-brand-2"
            style={{
              height: 32,
              padding: "0 13px",
              borderRadius: 9,
              background: "var(--brand)",
              color: "var(--on-brand)",
              display: "flex",
              alignItems: "center",
              fontSize: 12.5,
              fontWeight: 600,
              textDecoration: "none",
            }}
          >
            {t("inc2.declare")}
          </Link>
        )}
      </div>

      {q.length > 0 && !followUpsView && (
        <div style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 12.5 }}>
          <span style={{ color: "var(--ink-2)" }}>{t("inc2.searchResults", { q })}</span>
          <Link href={href(tab)} className="oi-link" style={{ fontWeight: 600 }}>
            {t("inc2.searchClear")}
          </Link>
        </div>
      )}

      {followUpsView ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {data.policy?.p1Days && (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                background: "var(--note)",
                border: "1px solid var(--note-b)",
                borderRadius: "var(--radius-card)",
                padding: "10px 14px",
                fontSize: 13,
              }}
            >
              <span
                style={{ width: 8, height: 8, borderRadius: "50%", background: "var(--wait)" }}
              />
              <span>{t("incidents.followUpPolicy", { count: data.policy.p1Days })}</span>
              {data.policy.overdue > 0 && (
                <span style={{ color: "var(--wait)", fontWeight: 600 }}>
                  {t("incidents.followUpOverdue", { count: data.policy.overdue })}
                </span>
              )}
            </div>
          )}
          {data.followUps.map((fu) => (
            <FollowUpRowView
              key={fu.id}
              row={fu}
              showIncident
              canAct={mayDeclare}
              trackers={data.trackers}
            />
          ))}
          {data.followUps.length === 0 && <Empty label={t("incidents.followUpsEmpty")} />}
        </div>
      ) : rows.length === 0 ? (
        <Empty label={q ? t("inc2.emptySearch", { q }) : t("inc2.empty")} />
      ) : (
        <div
          aria-label={t("inc2.listLabel")}
          style={{
            background: "var(--panel)",
            border: "1px solid var(--line)",
            borderRadius: "var(--radius-card)",
            boxShadow: "var(--shadow-card)",
            overflowX: "auto",
          }}
        >
          {rows.map((r, i) => {
            const sev = severityTone(r.severityRank);
            const av = r.leadName
              ? avatarTone(r.leadName)
              : { bg: "var(--sunk)", ink: "var(--ink-3)" };
            const svc = data.byIncident.get(r.id)?.[0]?.key ?? r.serviceName;
            return (
              <Link
                key={r.id}
                href={`/app/incidents/${r.number}`}
                data-testid="incident-row"
                className="oi-hover"
                style={{
                  display: "grid",
                  gridTemplateColumns: "76px 52px minmax(240px,1fr) 120px 150px 150px 80px",
                  gap: 12,
                  minWidth: 940,
                  alignItems: "center",
                  padding: "11px 16px",
                  borderBottom: i === rows.length - 1 ? 0 : "1px solid var(--line-2)",
                  textDecoration: "none",
                  color: "inherit",
                }}
              >
                <span
                  style={{
                    fontFamily: "var(--mono)",
                    fontSize: 11.5,
                    fontWeight: 600,
                    color: "var(--brand)",
                  }}
                >
                  INC-{r.number}
                </span>
                <span
                  style={{
                    fontSize: 10.5,
                    fontWeight: 700,
                    borderRadius: 999,
                    padding: "2px 0",
                    textAlign: "center",
                    background: sev.bg,
                    color: sev.ink,
                  }}
                >
                  {r.severityName ?? "—"}
                </span>
                <span style={{ display: "flex", alignItems: "center", gap: 7, minWidth: 0 }}>
                  {r.phase === "active" && (
                    <span
                      aria-hidden
                      className="oi-pulse"
                      style={{
                        width: 7,
                        height: 7,
                        borderRadius: "50%",
                        background: "var(--dang)",
                        flex: "none",
                      }}
                    />
                  )}
                  <span
                    style={{
                      fontSize: 13.5,
                      fontWeight: 500,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {r.name}
                  </span>
                  {r.visibility === "private" && (
                    <span
                      style={{
                        fontSize: 10,
                        fontWeight: 600,
                        color: "var(--viol)",
                        background: "var(--viol-t)",
                        borderRadius: 5,
                        padding: "1px 6px",
                        flex: "none",
                      }}
                    >
                      {t("incident.private")}
                    </span>
                  )}
                </span>
                <span
                  style={{
                    fontSize: 11.5,
                    fontWeight: 600,
                    color: statusInk(r.phase, r.statusName),
                  }}
                >
                  {r.phase === "active"
                    ? (r.statusName ?? t("incident.phase.active"))
                    : t(`incident.phase.${r.phase}`)}
                </span>
                <span
                  style={{
                    fontFamily: "var(--mono)",
                    fontSize: 11,
                    color: "var(--ink-2)",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {svc ?? "—"}
                </span>
                <span style={{ display: "flex", alignItems: "center", gap: 7, minWidth: 0 }}>
                  <span
                    aria-hidden
                    style={{
                      width: 20,
                      height: 20,
                      borderRadius: "50%",
                      background: av.bg,
                      color: av.ink,
                      display: "grid",
                      placeItems: "center",
                      fontSize: 8.5,
                      fontWeight: 700,
                      flex: "none",
                    }}
                  >
                    {r.leadName ? initials(r.leadName) : "—"}
                  </span>
                  <span
                    style={{
                      fontSize: 12,
                      color: "var(--ink-2)",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {r.leadName ?? t("inc2.unassigned")}
                  </span>
                </span>
                <span style={{ fontSize: 11.5, color: "var(--ink-3)", textAlign: "right" }}>
                  {t.fmt.relative(r.lastActivityAt)}
                </span>
              </Link>
            );
          })}
        </div>
      )}

      {tab === "all" && !followUpsView && (
        <div style={{ fontSize: 12, color: "var(--ink-3)" }}>{t("inc2.allNote")}</div>
      )}

      {declare && (
        <DeclareForm
          types={declare.options.types
            .filter((ty) => !ty.restrictedToTeamIds || ty.restrictedToTeamIds.length === 0)
            .map((ty) => ({
              id: ty.id,
              name: ty.name,
              isDefault: ty.isDefault,
              declareForm: ty.declareForm,
              privateByDefault: ty.privateByDefault,
            }))}
          severities={declare.options.severities}
          catalogServices={declare.options.services.map((s) => ({ id: s.id, name: s.name }))}
          services={declare.services.map((s) => ({ id: s.id, key: s.key }))}
          fields={declare.options.fields.map((f) => ({
            id: f.id,
            key: f.key,
            label: f.label,
            type: f.type,
            options: f.options,
            incidentTypeId: f.incidentTypeId,
          }))}
          aiSuggest={declareAi}
          timeZone={t.timeZone}
          closeHref="/app/incidents"
        />
      )}
    </div>
  );
}

function Empty({ label }: { label: string }) {
  return (
    <div
      style={{
        padding: 28,
        border: "1.5px dashed var(--line)",
        borderRadius: "var(--radius-card)",
        textAlign: "center",
        color: "var(--ink-3)",
        fontSize: 13.5,
        background: "var(--panel)",
      }}
    >
      {label}
    </div>
  );
}
