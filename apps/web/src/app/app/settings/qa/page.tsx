import Link from "next/link";
import { listQaRuns, probeQaTargets, qaCapabilities } from "@openincident/qa";
import type { QaSuite } from "@openincident/db";
import { getT } from "@/i18n/server";
import { requireMember } from "@/lib/session";
import { runQaSuite } from "./actions";
import { AutoRefresh } from "./refresh";
import { SUITE_ORDER, button, card, chip, durationLabel, statusTone } from "./shared";

/**
 * Settings → QA. The repository's own test suites, run from the admin by the
 * worker on the machine that has the checkout: Playwright smoke, vitest,
 * typecheck, eslint, prettier. Owner-only; every run is a row with its log.
 */
export default async function QaPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; suite?: string }>;
}) {
  const { tenant, member } = await requireMember();
  const t = await getT();
  const params = await searchParams;
  if (member.role !== "owner") {
    return (
      <section style={{ flex: 1, display: "grid", placeItems: "center", padding: 32 }}>
        <p
          data-testid="qa-owner-only"
          style={{ fontSize: 13.5, color: "var(--ink-2)", maxWidth: 420, textAlign: "center" }}
        >
          {t("qa.ownerOnly")}
        </p>
      </section>
    );
  }
  const caps = qaCapabilities();
  const probes = caps.repoRoot ? await probeQaTargets(caps) : { web: false, mailpit: false };
  const runs = await listQaRuns(tenant.id, 40);
  const lastOf = (suite: QaSuite) => runs.find((r) => r.suite === suite);
  const active = runs.some((r) => r.status === "queued" || r.status === "running");
  const suiteLabel = (s: QaSuite) => t(`qa.suite.${s}.name`);
  const statusLabel = (s: (typeof runs)[number]["status"]) => t(`qa.status.${s}`);
  const ok = (v: boolean) => (
    <span
      style={chip(
        v ? { bg: "var(--ok-t)", ink: "var(--ok)" } : { bg: "var(--dang-t)", ink: "var(--dang)" },
      )}
    >
      {v ? t("qa.prereq.ok") : t("qa.prereq.missing")}
    </span>
  );

  return (
    <div
      className="oi-rise"
      style={{ display: "flex", flexDirection: "column", gap: 18, maxWidth: 920 }}
    >
      <AutoRefresh active={active} everyMs={4_000} />
      <div>
        <h1 className="oi-title" style={{ margin: 0 }}>
          {t("qa.title")}
        </h1>
        <p style={{ margin: "6px 0 0", fontSize: 13.5, color: "var(--ink-2)", lineHeight: 1.55 }}>
          {t("qa.lead")}
        </p>
      </div>

      {params.error && (
        <p
          role="alert"
          data-testid="qa-error"
          style={{
            margin: 0,
            padding: "10px 12px",
            borderRadius: 10,
            background: "var(--dang-t)",
            border: "1px solid var(--dang)",
            color: "var(--dang)",
            fontSize: 13,
          }}
        >
          {params.error === "busy"
            ? t("qa.error.busy", { suite: params.suite ? suiteLabel(params.suite as QaSuite) : "" })
            : params.error === "queue"
              ? t("qa.error.queue")
              : t("qa.error.unavailable")}
        </p>
      )}

      <section data-testid="qa-prereqs" style={card}>
        <div className="oi-eyebrow">{t("qa.prereq.title")}</div>
        {!caps.repoRoot ? (
          <div
            data-testid="qa-unavailable"
            style={{ fontSize: 13, color: "var(--ink-2)", lineHeight: 1.55 }}
          >
            <strong>{t("qa.unavailable.title")}</strong> — {t("qa.unavailable.body")}
          </div>
        ) : (
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "auto 1fr auto",
              gap: "6px 14px",
              fontSize: 13,
              alignItems: "center",
            }}
          >
            <span style={{ color: "var(--ink-3)" }}>{t("qa.prereq.repo")}</span>
            <code style={{ fontFamily: "var(--font-mono)", fontSize: 12 }}>{caps.repoRoot}</code>
            {ok(true)}
            <span style={{ color: "var(--ink-3)" }}>{t("qa.prereq.playwright")}</span>
            <span>{t("qa.prereq.playwrightHint")}</span>
            {ok(caps.playwright)}
            <span style={{ color: "var(--ink-3)" }}>{t("qa.prereq.tools")}</span>
            <span>turbo · eslint · prettier</span>
            {ok(caps.turbo && caps.eslint && caps.prettier)}
            <span style={{ color: "var(--ink-3)" }}>{t("qa.prereq.web")}</span>
            <code style={{ fontFamily: "var(--font-mono)", fontSize: 12 }}>{caps.webHost}</code>
            {ok(probes.web)}
            <span style={{ color: "var(--ink-3)" }}>{t("qa.prereq.mailpit")}</span>
            <code style={{ fontFamily: "var(--font-mono)", fontSize: 12 }}>{caps.mailpitUrl}</code>
            {ok(probes.mailpit)}
          </div>
        )}
        <div style={{ fontSize: 12, color: "var(--ink-3)", lineHeight: 1.5 }}>
          {t("qa.prereq.note")}
        </div>
      </section>

      <section style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div className="oi-eyebrow">{t("qa.suites")}</div>
          <span style={{ flex: 1 }} />
          <form action={runQaSuite}>
            <input type="hidden" name="suite" value="all" />
            <button
              type="submit"
              data-testid="qa-run-all"
              disabled={!caps.repoRoot || active}
              style={{ ...button("primary"), opacity: !caps.repoRoot || active ? 0.5 : 1 }}
            >
              {t("qa.runAll")}
            </button>
          </form>
        </div>
        {SUITE_ORDER.map((suite) => {
          const last = lastOf(suite);
          const busy = last ? last.status === "queued" || last.status === "running" : false;
          return (
            <div
              key={suite}
              data-testid={`qa-suite-${suite}`}
              style={{ ...card, flexDirection: "row", alignItems: "center", gap: 14 }}
            >
              <div
                style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 3 }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ fontWeight: 600, fontSize: 14 }}>{suiteLabel(suite)}</span>
                  {last && (
                    <Link
                      href={`/app/settings/qa/${last.id}`}
                      data-testid="qa-last-status"
                      style={{ ...chip(statusTone(last.status)), textDecoration: "none" }}
                    >
                      {statusLabel(last.status)}
                    </Link>
                  )}
                </div>
                <div style={{ fontSize: 12.5, color: "var(--ink-3)", lineHeight: 1.45 }}>
                  {t(`qa.suite.${suite}.desc`)}
                </div>
                <div style={{ fontSize: 12, color: "var(--ink-3)" }}>
                  {last
                    ? t("qa.lastRun", {
                        when: t.fmt.relative(last.finishedAt ?? last.startedAt ?? last.queuedAt),
                        duration: durationLabel(last.startedAt, last.finishedAt),
                        by: last.triggeredByName,
                      })
                    : t("qa.never")}
                  {last?.summary.total !== undefined &&
                    ` · ${t("qa.counts", { passed: last.summary.passed ?? 0, failed: last.summary.failed ?? 0, total: last.summary.total })}`}
                </div>
              </div>
              <form action={runQaSuite}>
                <input type="hidden" name="suite" value={suite} />
                <button
                  type="submit"
                  data-testid={`qa-run-${suite}`}
                  disabled={!caps.repoRoot || busy}
                  style={{ ...button("plain"), opacity: !caps.repoRoot || busy ? 0.5 : 1 }}
                >
                  {busy ? t("qa.running") : t("qa.run")}
                </button>
              </form>
            </div>
          );
        })}
      </section>

      <section style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <div className="oi-eyebrow">{t("qa.history")}</div>
        {runs.length === 0 && (
          <div style={{ ...card, color: "var(--ink-3)", fontSize: 13 }}>{t("qa.noRuns")}</div>
        )}
        {runs.length > 0 && (
          <div style={{ ...card, padding: 0, overflow: "hidden" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
              <thead>
                <tr
                  style={{
                    fontSize: 11,
                    textTransform: "uppercase",
                    letterSpacing: ".06em",
                    color: "var(--ink-3)",
                  }}
                >
                  <th style={{ textAlign: "left", padding: "9px 14px" }}>{t("qa.col.suite")}</th>
                  <th style={{ textAlign: "left", padding: "9px 14px" }}>{t("qa.col.status")}</th>
                  <th style={{ textAlign: "left", padding: "9px 14px" }}>{t("qa.col.result")}</th>
                  <th style={{ textAlign: "left", padding: "9px 14px" }}>{t("qa.col.when")}</th>
                  <th style={{ textAlign: "left", padding: "9px 14px" }}>{t("qa.col.duration")}</th>
                  <th style={{ textAlign: "left", padding: "9px 14px" }}>{t("qa.col.by")}</th>
                </tr>
              </thead>
              <tbody>
                {runs.map((r) => (
                  <tr
                    key={r.id}
                    data-testid="qa-run-row"
                    style={{ borderTop: "1px solid var(--line-2)" }}
                  >
                    <td style={{ padding: "9px 14px" }}>
                      <Link
                        href={`/app/settings/qa/${r.id}`}
                        className="oi-link"
                        style={{ fontWeight: 600 }}
                      >
                        {suiteLabel(r.suite)}
                      </Link>
                    </td>
                    <td style={{ padding: "9px 14px" }}>
                      <span style={chip(statusTone(r.status))}>{statusLabel(r.status)}</span>
                    </td>
                    <td
                      style={{
                        padding: "9px 14px",
                        color: "var(--ink-2)",
                        fontVariantNumeric: "tabular-nums",
                      }}
                    >
                      {r.summary.total !== undefined
                        ? t("qa.counts", {
                            passed: r.summary.passed ?? 0,
                            failed: r.summary.failed ?? 0,
                            total: r.summary.total,
                          })
                        : r.summary.failed !== undefined
                          ? t("qa.failedCount", { count: r.summary.failed })
                          : "—"}
                    </td>
                    <td style={{ padding: "9px 14px", color: "var(--ink-3)" }}>
                      {t.fmt.relative(r.startedAt ?? r.queuedAt)}
                    </td>
                    <td
                      style={{
                        padding: "9px 14px",
                        color: "var(--ink-3)",
                        fontVariantNumeric: "tabular-nums",
                      }}
                    >
                      {durationLabel(r.startedAt, r.finishedAt)}
                    </td>
                    <td style={{ padding: "9px 14px", color: "var(--ink-3)" }}>
                      {r.triggeredByName}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
