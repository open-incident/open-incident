import Link from "next/link";
import { withTenant } from "@openincident/db";
import { getT } from "@/i18n/server";
import { requireMember, canRespond } from "@/lib/session";
import { listServices, listTeams, ownerSuggestions } from "@/lib/services";
import { assignOwner } from "./actions";

/**
 * Services — two lists, and nothing to declare.
 *
 * "Confirmed" is what the workspace has adopted. "Seen in traffic" is what the
 * signals named and nobody has claimed: each row is one click from an owner,
 * and the suggestion beside it is read from who actually acknowledged that
 * service's alerts — never invented.
 */
export default async function ServicesPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const { tenant, member } = await requireMember();
  const t = await getT();
  const { tab } = await searchParams;

  const data = await withTenant(tenant.id, async (tx) => {
    const all = await listServices(tx, tenant.id);
    const unowned = all.filter((s) => !s.ownerTeamId);
    const [teams, suggestions] = await Promise.all([
      listTeams(tx, tenant.id),
      ownerSuggestions(
        tx,
        tenant.id,
        unowned.map((s) => s.key),
      ),
    ]);
    return { all, teams, suggestions };
  });

  const seen = data.all.filter((s) => !s.ownerTeamId);
  const confirmed = data.all.filter((s) => s.ownerTeamId);
  const onSeen = tab === "seen";
  const mayAssign = canRespond(member);

  const STATE_DOT: Record<string, string> = {
    online: "var(--ok)",
    degraded: "var(--wait)",
    offline: "var(--dang)",
    unknown: "var(--ink-3)",
  };

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
      </div>

      {!onSeen && seen.length > 0 && (
        <Link
          href="/app/services?tab=seen"
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
            {confirmed.map((s) => (
              <Link
                key={s.id}
                href={`/app/services/${s.id}`}
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
                    background: "var(--sunk)",
                    borderRadius: 999,
                    padding: "2px 9px",
                    width: "fit-content",
                  }}
                >
                  {s.ownerTeamName}
                </span>
                <span style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                  {Object.entries(s.labels)
                    .slice(0, 3)
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
                        }}
                      >
                        {k}:{v}
                      </span>
                    ))}
                </span>
                <span style={{ fontSize: 12, color: "var(--ink-3)" }}>
                  {s.lastSeenAt ? t.fmt.relative(s.lastSeenAt) : "—"}
                </span>
                <span style={{ fontSize: 12.5, fontWeight: 600 }}>{s.incidents90d}</span>
              </Link>
            ))}
          </div>
        ))}

      {onSeen && (
        <div className="oi-rise-fast" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {seen.length === 0 && (
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
              {t("services.emptySeen")}
            </div>
          )}
          {seen.map((s) => {
            const suggestion = data.suggestions.get(s.key) ?? null;
            const options = [
              ...(suggestion ? [{ id: suggestion.teamId, name: suggestion.teamName }] : []),
              ...data.teams
                .filter((x) => x.id !== suggestion?.teamId)
                .slice(0, suggestion ? 2 : 3)
                .map((x) => ({ id: x.id, name: x.name })),
            ];
            return (
              <div
                key={s.id}
                style={{
                  background: "var(--panel)",
                  border: "1px solid var(--line)",
                  borderRadius: "var(--radius-card)",
                  boxShadow: "var(--shadow-card)",
                  padding: "14px 16px",
                  display: "flex",
                  alignItems: "center",
                  gap: 14,
                  flexWrap: "wrap",
                }}
              >
                <div
                  style={{
                    flex: 1,
                    minWidth: 220,
                    display: "flex",
                    flexDirection: "column",
                    gap: 3,
                  }}
                >
                  <span style={{ fontFamily: "var(--mono)", fontSize: 14, fontWeight: 600 }}>
                    {s.key}
                  </span>
                  <span style={{ fontSize: 12, color: "var(--ink-3)" }}>
                    {t("services.seenAs")}{" "}
                    <span style={{ fontFamily: "var(--mono)" }}>service:{s.key}</span>
                    {s.seenIn.length > 0 && ` · ${s.seenIn.join(" · ")}`}
                  </span>
                </div>
                <div
                  style={{
                    flex: 1,
                    minWidth: 220,
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    fontSize: 12.5,
                    color: "var(--ink-2)",
                  }}
                >
                  {suggestion ? (
                    <>
                      <span style={{ color: "var(--viol)" }}>✦</span>
                      <span>
                        {t("services.suggestion", {
                          team: suggestion.teamName,
                          count: suggestion.count,
                        })}
                      </span>
                    </>
                  ) : (
                    <span style={{ color: "var(--ink-3)" }}>{t("services.noSuggestion")}</span>
                  )}
                </div>
                {mayAssign && options.length > 0 && (
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                    {options.map((o, i) => (
                      <form key={o.id} action={assignOwner}>
                        <input type="hidden" name="serviceId" value={s.id} />
                        <input type="hidden" name="teamId" value={o.id} />
                        <button
                          type="submit"
                          className="oi-hover-edge"
                          style={{
                            height: 32,
                            padding: "0 12px",
                            border:
                              i === 0 && suggestion
                                ? "1.5px solid var(--brand)"
                                : "1px solid var(--line)",
                            borderRadius: 9,
                            background: i === 0 && suggestion ? "var(--brand-t)" : "var(--panel)",
                            color: i === 0 && suggestion ? "var(--brand)" : "var(--ink-2)",
                            display: "flex",
                            alignItems: "center",
                            fontSize: 12.5,
                            fontWeight: 600,
                            cursor: "pointer",
                          }}
                        >
                          {o.name}
                        </button>
                      </form>
                    ))}
                  </div>
                )}
                {mayAssign && data.teams.length === 0 && (
                  <span style={{ fontSize: 12, color: "var(--ink-3)" }}>
                    {t("services.noTeams")}
                  </span>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
