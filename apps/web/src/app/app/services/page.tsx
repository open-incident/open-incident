import Link from "next/link";
import { withTenant } from "@openincident/db";
import { getT, type Translate } from "@/i18n/server";
import { canRespond, requireMember } from "@/lib/session";
import {
  lastSignalOf,
  listServices,
  listTeams,
  ownerSuggestions,
  sightingsOf,
  teamsOfMember,
  type LastSignal,
  type ObservedEdge,
  type OwnerSuggestion,
  type Sightings,
} from "@/lib/services";
import { serviceEdges, telemetryInstalled } from "@/lib/telemetry";
import { NewService } from "./new-service";
import { SeenList, type SeenRow } from "./seen-list";
import { monitorKind, orderedLabels } from "./words";

/**
 * Services — two lists, and almost nothing to declare.
 *
 * "Confirmed" is what the workspace has adopted. "Seen in traffic" is what the
 * signals named and nobody has claimed: each row is one click from an owner,
 * and the suggestion beside it is read from what actually happened — who
 * acknowledged its alerts, what it talks to in the traces — never invented.
 *
 * The one thing to declare is a service whose first alert has not happened
 * yet and must page someone when it does; that is what the small link beside
 * the sentence is for, deliberately the quietest control on the screen.
 */
export default async function ServicesPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string; error?: string }>;
}) {
  const { tenant, member } = await requireMember();
  const t = await getT();
  const { tab, error } = await searchParams;

  // The traces say who talks to whom — the second-best evidence of ownership.
  // A week of edges; an unreachable column store only costs the suggestion.
  const edges: ObservedEdge[] = telemetryInstalled()
    ? await serviceEdges(tenant.id, { sinceMinutes: 7 * 24 * 60 })
        .then((rows) =>
          rows.map((e) => ({
            source: e.source_service,
            target: e.target_service,
            calls: Number(e.n_calls),
          })),
        )
        .catch(() => [])
    : [];

  const data = await withTenant(tenant.id, async (tx) => {
    const all = await listServices(tx, tenant.id);
    const unconfirmed = all.filter((s) => !s.confirmed);
    const [teams, mine, sightings, suggestions] = await Promise.all([
      listTeams(tx, tenant.id),
      teamsOfMember(tx, tenant.id, member.id),
      sightingsOf(tx, tenant.id, all),
      ownerSuggestions(
        tx,
        tenant.id,
        unconfirmed,
        all.filter((s) => s.ownerTeamId),
        edges,
      ),
    ]);
    return { all, teams, mine, sightings, suggestions };
  });

  // The split is what the workspace has adopted, not what happens to have an
  // owner: a service can be declared before any team exists, and one the
  // traffic named is "seen" until somebody claims it. `assignOwner` confirms.
  const seen = data.all.filter((s) => !s.confirmed);
  const confirmed = data.all.filter((s) => s.confirmed);
  const onSeen = tab === "seen";
  const mayAssign = canRespond(member);

  const STATE_DOT: Record<string, string> = {
    online: "var(--ok)",
    degraded: "var(--wait)",
    offline: "var(--dang)",
    unknown: "var(--ink-3)",
  };

  const seenRows: SeenRow[] = seen.map((s) => {
    const suggestion = data.suggestions.get(s.key) ?? null;
    return {
      id: s.id,
      key: s.key,
      name: s.name,
      from: sightingWords(t, data.sightings.get(s.id)),
      hint: suggestion ? suggestionWords(t, suggestion) : null,
      suggestedTeamId: suggestion?.teamId ?? null,
    };
  });

  return (
    <div
      style={{
        maxWidth: 1160,
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
          {t("nav.services")}
        </h1>
        <div
          style={{
            display: "flex",
            gap: 2,
            background: "var(--sunk)",
            borderRadius: 10,
            padding: 3,
          }}
        >
          {[
            { id: "conf", label: t("services.tabConfirmed"), count: confirmed.length, on: !onSeen },
            { id: "seen", label: t("services.tabSeen"), count: seen.length, on: onSeen },
          ].map((x) => (
            <Link
              key={x.id}
              data-testid={`services-tab-${x.id}`}
              href={x.id === "seen" ? "/app/services?tab=seen" : "/app/services"}
              style={{
                height: 28,
                padding: "0 12px",
                borderRadius: 8,
                background: x.on ? "var(--panel)" : "transparent",
                color: x.on ? "var(--ink)" : "var(--ink-3)",
                boxShadow: x.on ? "var(--shadow-card)" : "none",
                display: "flex",
                alignItems: "center",
                gap: 6,
                fontSize: 12.5,
                fontWeight: 600,
                textDecoration: "none",
              }}
            >
              {x.label}
              <span style={{ fontFamily: "var(--mono)", fontSize: 11, opacity: 0.7 }}>
                {x.count}
              </span>
            </Link>
          ))}
        </div>
        <span style={{ flex: 1 }} />
        <span style={{ fontSize: 12, color: "var(--ink-3)" }}>{t("services.howTheyAppear")}</span>
        {mayAssign && <NewService teams={data.teams.map((x) => ({ id: x.id, name: x.name }))} />}
      </div>

      {(error === "key" || error === "team" || error === "exists") && (
        <div
          role="alert"
          style={{
            background: "var(--dang-t)",
            border: "1px solid rgba(192,52,43,.25)",
            borderRadius: 12,
            padding: "11px 15px",
            fontSize: 13,
            color: "var(--dang)",
          }}
        >
          {error === "team" ? t("services.errorTeam") : t("services.errorKey")}
        </div>
      )}

      {!onSeen && seen.length > 0 && (
        <Link
          href="/app/services?tab=seen"
          data-testid="services-banner"
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            background: "var(--wait-t)",
            border: "1px solid rgba(180,83,9,.25)",
            borderRadius: 12,
            padding: "11px 15px",
            fontSize: 13,
            textDecoration: "none",
            color: "inherit",
          }}
        >
          <span style={{ width: 8, height: 8, borderRadius: "50%", background: "var(--wait)" }} />
          <span style={{ flex: 1 }}>
            <strong>{t("services.bannerCount", { count: seen.length })}</strong>{" "}
            {t("services.bannerTail")}
          </span>
          <span style={{ fontSize: 12.5, fontWeight: 600, color: "var(--brand)" }}>
            {t("services.assignOwners")} →
          </span>
        </Link>
      )}

      {!onSeen &&
        (confirmed.length === 0 ? (
          <div
            style={{
              border: "1px dashed var(--line)",
              borderRadius: "var(--radius-card)",
              padding: 26,
              textAlign: "center",
              fontSize: 13,
              color: "var(--ink-2)",
            }}
          >
            {t("services.emptyConfirmed")}
          </div>
        ) : (
          <div
            data-testid="services-confirmed"
            style={{
              background: "var(--panel)",
              border: "1px solid var(--line)",
              borderRadius: "var(--radius-card)",
              boxShadow: "var(--shadow-card)",
              overflow: "hidden",
            }}
          >
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "minmax(0,1fr) 140px 220px 130px 100px",
                gap: 12,
                padding: "8px 16px",
                borderBottom: "1px solid var(--line)",
                fontSize: 10.5,
                fontWeight: 700,
                letterSpacing: ".08em",
                textTransform: "uppercase",
                color: "var(--ink-3)",
              }}
            >
              <span>{t("services.colService")}</span>
              <span>{t("services.colOwner")}</span>
              <span>{t("services.colLabels")}</span>
              <span>{t("services.colLastSignal")}</span>
              <span>{t("services.colIncidents")}</span>
            </div>
            {confirmed.map((s) => {
              const last = lastSignalOf(s, data.sightings.get(s.id));
              return (
                <Link
                  key={s.id}
                  href={`/app/services/${s.id}`}
                  data-testid="service-row"
                  className="oi-hover"
                  style={{
                    display: "grid",
                    gridTemplateColumns: "minmax(0,1fr) 140px 220px 130px 100px",
                    gap: 12,
                    alignItems: "center",
                    padding: "10px 16px",
                    borderBottom: "1px solid var(--line-2)",
                    textDecoration: "none",
                    color: "inherit",
                  }}
                >
                  <span style={{ minWidth: 0, display: "flex", alignItems: "center", gap: 8 }}>
                    <span
                      style={{
                        width: 8,
                        height: 8,
                        borderRadius: "50%",
                        background: STATE_DOT[s.state],
                        flex: "none",
                      }}
                    />
                    <span
                      style={{
                        fontFamily: "var(--mono)",
                        fontSize: 13,
                        fontWeight: 600,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {s.key}
                    </span>
                  </span>
                  <span
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 6,
                      fontSize: 12,
                      fontWeight: 600,
                      background: s.ownerTeamName ? "var(--sunk)" : "var(--wait-t)",
                      color: s.ownerTeamName ? "inherit" : "var(--wait)",
                      borderRadius: 999,
                      padding: "2px 9px",
                      width: "fit-content",
                    }}
                  >
                    {s.ownerTeamName ?? t("services.noOwnerChip")}
                  </span>
                  <span style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                    {orderedLabels(s.labels)
                      .slice(0, 2)
                      .map(([k, v]) => (
                        <span
                          key={k}
                          style={{
                            fontFamily: "var(--mono)",
                            fontSize: 10.5,
                            background: "var(--sunk)",
                            borderRadius: 5,
                            padding: "1px 6px",
                            color: "var(--ink-2)",
                            whiteSpace: "nowrap",
                          }}
                        >
                          {`${k}:${v}`}
                        </span>
                      ))}
                  </span>
                  <span style={{ fontSize: 12, color: "var(--ink-3)" }}>
                    {last ? lastSignalWords(t, last) : "—"}
                  </span>
                  <span style={{ fontSize: 12.5, fontWeight: 600 }}>{s.incidents90d}</span>
                </Link>
              );
            })}
          </div>
        ))}

      {onSeen && (
        <SeenList
          rows={seenRows}
          teams={data.teams.map((x) => ({ id: x.id, name: x.name, policyName: x.policyName }))}
          myTeamIds={data.mine.map((x) => x.id)}
          mayAssign={mayAssign}
        />
      )}
    </div>
  );
}

/** "2 min · Datadog", "now · Datadog", "1 h · SSL monitor". */
function lastSignalWords(t: Translate, last: LastSignal): string {
  const ago = Date.now() - last.at.getTime();
  const when = ago < 60_000 ? t("services.now") : t.fmt.relativeCompact(last.at);
  const where =
    last.kind === "alert"
      ? last.where
      : last.kind === "monitor"
        ? t("services.monitorKind", { kind: monitorKind(last.where) })
        : t("services.traces");
  return `${when} · ${where}`;
}

/** "Datadog ×12 · Grafana ×3 · 1 monitor · traces". */
function sightingWords(t: Translate, s: Sightings | undefined): string {
  if (!s) return "";
  const parts = s.sources.map((x) => `${x.name} ×${x.count}`);
  if (s.monitors > 0) {
    const n = t("services.monitorsCount", { count: s.monitors });
    parts.push(
      s.monitorsWaiting > 0 && s.monitorsWaiting === s.monitors
        ? `${n} ${t("services.waitingFirstCheck")}`
        : n,
    );
  }
  if (s.traces) parts.push(t("services.traces"));
  return parts.join(" · ");
}

function suggestionWords(t: Translate, s: OwnerSuggestion): string {
  switch (s.why) {
    case "ack":
      return t("services.suggestion", { team: s.teamName, count: s.count });
    case "calledBy":
      return t("services.suggestCalledBy", { team: s.teamName, other: s.other });
    case "calls":
      return t("services.suggestCalls", { team: s.teamName, other: s.other });
    case "repo":
      return t("services.suggestRepo", { team: s.teamName, other: s.other });
    case "prefix":
      return t("services.suggestPrefix", { team: s.teamName, other: s.other });
  }
}
