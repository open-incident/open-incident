import { notFound } from "next/navigation";
import { currentSnapshot } from "@/lib/snapshot";
import { fmtDate, relative, tr } from "@/lib/i18n";
import { SubscribeForm } from "./subscribe-form";

export const dynamic = "force-dynamic";

const TICK: Record<string, string> = {
  operational: "var(--ok)",
  maintenance: "var(--viol)",
  degraded: "var(--wait)",
  partial_outage: "var(--wait)",
  major_outage: "var(--dang)",
};
const STATUS_INK: Record<string, string> = {
  investigating: "var(--accent)",
  identified: "var(--wait)",
  monitoring: "var(--viol)",
  resolved: "var(--ok)",
};

/**
 * The public page, from the design: header with the page's brand, the
 * subscribe form, the overall banner, components with their 30-day bars and
 * uptime, past incidents with their update timeline, maintenances, footer.
 */
export default async function StatusPage({
  searchParams,
}: {
  searchParams: Promise<{
    subscribed?: string;
    error?: string;
    confirmed?: string;
    unsubscribed?: string;
  }>;
}) {
  const cur = await currentSnapshot();
  if (!cur) notFound();
  const { snap, origin } = cur;
  const q = await searchParams;
  const t = tr(snap.page.locale);
  const L = snap.page.locale;
  const accent = snap.page.accentColor;
  const overallKey =
    snap.overall === "operational"
      ? "allOk"
      : snap.overall === "degraded"
        ? "degraded"
        : snap.overall === "partial_outage"
          ? "partial"
          : snap.overall === "major_outage"
            ? "major"
            : "maintenance";
  const overallTone =
    snap.overall === "operational"
      ? ["var(--ok-t)", "var(--ok)"]
      : snap.overall === "major_outage"
        ? ["var(--dang-t)", "var(--dang)"]
        : snap.overall === "maintenance"
          ? ["var(--viol-t)", "var(--viol)"]
          : ["var(--wait-t)", "var(--wait)"];
  const stateLabel = (s: string) =>
    s === "operational"
      ? t("operational")
      : s === "degraded"
        ? t("stateDegraded")
        : s === "partial_outage"
          ? t("statePartial")
          : s === "major_outage"
            ? t("stateMajor")
            : t("stateMaintenance");
  const open = snap.incidents.filter((i) => i.status !== "resolved");
  const past = snap.incidents.filter((i) => i.status === "resolved");
  const incidentCard = (i: (typeof snap.incidents)[number]) => (
    <article
      key={i.id}
      id={`incident-${i.id}`}
      style={{
        background: "var(--panel)",
        border: "1px solid var(--line)",
        borderRadius: 14,
        padding: "18px 22px",
        display: "flex",
        flexDirection: "column",
        gap: 13,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <span style={{ fontSize: 14.5, fontWeight: 600 }}>{i.title}</span>
        <span
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            padding: "2px 10px 2px 8px",
            borderRadius: 999,
            background: i.status === "resolved" ? "var(--ok-t)" : "var(--wait-t)",
            color: i.status === "resolved" ? "var(--ok)" : "var(--wait)",
            fontSize: 11.5,
            fontWeight: 700,
          }}
        >
          <span style={{ width: 5, height: 5, borderRadius: "50%", background: "currentColor" }} />
          {t(i.status as "resolved")}
        </span>
        <span style={{ flex: 1 }} />
        <span style={{ fontSize: 12, color: "var(--ink-3)" }}>
          {fmtDate(i.startedAt, L, { day: "numeric", month: "long", year: "numeric" })}
        </span>
      </div>
      {i.components.length > 0 && (
        <div style={{ fontSize: 12.5, color: "var(--ink-3)" }}>
          {t("affected", {
            components: i.components.join(", "),
            impact: t(`impact_${i.impact}` as "impact_degraded"),
          })}
        </div>
      )}
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 11,
          borderLeft: "2px solid var(--line-2)",
          paddingLeft: 14,
        }}
      >
        {i.updates.map((u, k) => (
          <div key={k}>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                fontSize: 12,
                color: "var(--ink-3)",
              }}
            >
              <strong style={{ color: STATUS_INK[u.status] ?? "var(--ink-2)" }}>
                {t(u.status as "resolved")}
              </strong>{" "}
              · {fmtDate(u.at, L, { hour: "2-digit", minute: "2-digit", timeZoneName: "short" })}
            </div>
            <div style={{ fontSize: 13.5, lineHeight: 1.55 }}>{u.body}</div>
          </div>
        ))}
      </div>
    </article>
  );
  return (
    <main
      style={{
        ["--accent" as string]: accent,
        maxWidth: 780,
        margin: "0 auto",
        padding: "36px 24px 60px",
        display: "flex",
        flexDirection: "column",
        gap: 20,
      }}
    >
      <header style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        {snap.page.logoUrl ? (
          <img
            src={snap.page.logoUrl}
            alt=""
            style={{ width: 38, height: 38, borderRadius: 11, objectFit: "contain" }}
          />
        ) : (
          <span
            style={{
              width: 38,
              height: 38,
              borderRadius: 11,
              background: accent,
              color: "#fff",
              display: "grid",
              placeItems: "center",
              fontWeight: 700,
              fontSize: 16,
              fontFamily: "var(--font-title)",
            }}
          >
            {snap.page.name.slice(0, 1).toUpperCase()}
          </span>
        )}
        <div>
          <div style={{ fontFamily: "var(--font-title)", fontSize: 19, fontWeight: 600 }}>
            {snap.page.name}
          </div>
          <div style={{ fontSize: 12.5, color: "var(--ink-3)", fontFamily: "var(--font-mono)" }}>
            {new URL(origin).host}
          </div>
        </div>
        <span style={{ flex: 1 }} />
        {snap.page.visibility !== "internal" && (
          <SubscribeForm
            accent={accent}
            labels={{ subscribe: t("subscribe"), confirm: t("confirm"), optin: t("optin") }}
          />
        )}
      </header>
      {q.subscribed === "1" && (
        <div
          data-testid="subscribed"
          style={{
            display: "flex",
            alignItems: "center",
            gap: 9,
            background: "var(--ok-t)",
            border: "1px solid var(--ok)",
            borderRadius: 13,
            padding: "11px 16px",
            fontSize: 13,
            color: "var(--ink-2)",
          }}
        >
          <span style={{ width: 8, height: 8, borderRadius: "50%", background: "var(--ok)" }} />
          {t("checkMail")}
        </div>
      )}
      {q.subscribed === "already" && (
        <div
          style={{
            background: "var(--sunk)",
            borderRadius: 13,
            padding: "11px 16px",
            fontSize: 13,
            color: "var(--ink-2)",
          }}
        >
          {t("already")}
        </div>
      )}
      {q.error && (
        <div
          role="alert"
          style={{
            background: "var(--dang-t)",
            border: "1px solid var(--dang)",
            borderRadius: 13,
            padding: "11px 16px",
            fontSize: 13,
            color: "var(--dang)",
          }}
        >
          {q.error === "invalid" ? t("invalid") : t("down")}
        </div>
      )}
      {q.confirmed && (
        <div
          data-testid="confirmed"
          style={{
            display: "flex",
            alignItems: "center",
            gap: 9,
            background: "var(--ok-t)",
            border: "1px solid var(--ok)",
            borderRadius: 13,
            padding: "11px 16px",
            fontSize: 13,
            color: "var(--ink-2)",
          }}
        >
          <span style={{ width: 8, height: 8, borderRadius: "50%", background: "var(--ok)" }} />
          {q.confirmed === "1" ? t("confirmed", { name: snap.page.name }) : t("confirmFailed")}
        </div>
      )}
      {q.unsubscribed && (
        <div
          style={{
            background: "var(--sunk)",
            borderRadius: 13,
            padding: "11px 16px",
            fontSize: 13,
            color: "var(--ink-2)",
          }}
        >
          {q.unsubscribed === "1" ? t("unsubscribed", { name: snap.page.name }) : t("unsubFailed")}
        </div>
      )}

      <div
        data-testid="overall"
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          background: overallTone[0],
          border: `1px solid ${overallTone[1]}`,
          borderRadius: 14,
          padding: "17px 20px",
        }}
      >
        <span style={{ width: 11, height: 11, borderRadius: "50%", background: overallTone[1] }} />
        <span style={{ fontFamily: "var(--font-title)", fontSize: 17, fontWeight: 600 }}>
          {t(overallKey)}
        </span>
        <span style={{ flex: 1 }} />
        <span style={{ fontSize: 12, color: "var(--ink-3)" }}>
          {t("updated", { when: relative(snap.generatedAt, L) })}
        </span>
      </div>

      {open.length > 0 && (
        <section style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {open.map(incidentCard)}
        </section>
      )}

      <section
        data-testid="components"
        style={{ background: "var(--panel)", border: "1px solid var(--line)", borderRadius: 14 }}
      >
        {snap.components.map((c, i) => (
          <div
            key={c.id}
            style={{
              display: "grid",
              gridTemplateColumns: "130px minmax(0, 1fr) 130px",
              gap: 16,
              alignItems: "center",
              padding: "13px 20px",
              borderBottom: i < snap.components.length - 1 ? "1px solid var(--line-2)" : undefined,
            }}
          >
            <span style={{ fontSize: 13.5, fontWeight: 600 }} title={c.groupName ?? undefined}>
              {c.name}
            </span>
            <div style={{ display: "flex", gap: 2 }} aria-label={stateLabel(c.state)}>
              {c.ticks.map((tk, k) => (
                <span key={k} className="st-tick" style={{ background: TICK[tk] ?? "var(--ok)" }} />
              ))}
            </div>
            <span
              style={{
                display: "flex",
                justifyContent: "flex-end",
                alignItems: "center",
                gap: 7,
                fontSize: 12.5,
                color: "var(--ink-3)",
                fontVariantNumeric: "tabular-nums",
              }}
            >
              <span
                style={{
                  fontWeight: 700,
                  color:
                    c.uptime90 >= 99.9
                      ? "var(--ok)"
                      : c.uptime90 >= 99
                        ? "var(--wait)"
                        : "var(--dang)",
                }}
              >
                {c.uptime90.toLocaleString(L === "fr" ? "fr-FR" : L === "de" ? "de-DE" : "en-GB", {
                  minimumFractionDigits: 2,
                  maximumFractionDigits: 2,
                })}{" "}
                %
              </span>
              {t("days90")}
              <span
                title={stateLabel(c.state)}
                style={{
                  width: 7,
                  height: 7,
                  borderRadius: "50%",
                  background: TICK[c.state] ?? "var(--ok)",
                }}
              />
            </span>
          </div>
        ))}
      </section>

      <section style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <h2 style={{ fontFamily: "var(--font-title)", fontSize: 16, fontWeight: 600, margin: 0 }}>
          {t("past")}
        </h2>
        {past.map(incidentCard)}
        {snap.maintenances.map((m) => (
          <article
            key={m.id}
            id={`maintenance-${m.id}`}
            style={{
              background: "var(--panel)",
              border: "1px solid var(--line)",
              borderRadius: 14,
              padding: "16px 22px",
              display: "flex",
              alignItems: "center",
              gap: 10,
            }}
          >
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 14, fontWeight: 600 }}>{m.title}</div>
              <div style={{ fontSize: 12.5, color: "var(--ink-3)" }}>
                {t("maint")} · {fmtDate(m.startAt, L, { day: "numeric", month: "long" })},{" "}
                {fmtDate(m.startAt, L, { hour: "2-digit", minute: "2-digit" })} –{" "}
                {fmtDate(m.endAt, L, { hour: "2-digit", minute: "2-digit", timeZoneName: "short" })}{" "}
                ·{" "}
                {m.status === "completed"
                  ? t("maintDone")
                  : m.status === "in_progress"
                    ? t("maintProgress")
                    : m.status === "cancelled"
                      ? t("maintCancelled")
                      : t("maintScheduled")}
              </div>
              {m.body && <div style={{ fontSize: 13, marginTop: 6 }}>{m.body}</div>}
            </div>
            <span style={{ flex: 1 }} />
            <span
              style={{
                padding: "2px 10px",
                borderRadius: 999,
                background: m.status === "in_progress" ? "var(--viol-t)" : "var(--sunk)",
                color: m.status === "in_progress" ? "var(--viol)" : "var(--ink-2)",
                fontSize: 11.5,
                fontWeight: 600,
                whiteSpace: "nowrap",
              }}
            >
              {m.status === "completed"
                ? t("maintDone").split(" ")[0]
                : m.status === "in_progress"
                  ? t("maintProgress")
                  : m.status === "cancelled"
                    ? t("maintCancelled")
                    : t("maintScheduled")}
            </span>
          </article>
        ))}
        {past.length === 0 && snap.maintenances.length === 0 && (
          <div style={{ fontSize: 13, color: "var(--ink-3)" }}>{t("none")}</div>
        )}
      </section>

      <footer
        style={{
          display: "flex",
          alignItems: "center",
          gap: 16,
          paddingTop: 8,
          fontSize: 12,
          color: "var(--ink-3)",
          flexWrap: "wrap",
        }}
      >
        <a href="/rss.xml">RSS</a>
        <a href="/atom.xml">Atom</a>
        {snap.page.privacyUrl && <a href={snap.page.privacyUrl}>{t("privacy")}</a>}
        {snap.page.legalUrl && <a href={snap.page.legalUrl}>{t("legal")}</a>}
        <span style={{ flex: 1 }} />
        <span style={{ display: "flex", alignItems: "center", gap: 7 }}>
          {t("powered")}
          <span style={{ fontFamily: "var(--font-title)", fontWeight: 600, color: "var(--ink)" }}>
            Open<span style={{ color: "var(--brand)" }}>*</span>Incident
          </span>
        </span>
      </footer>
    </main>
  );
}
