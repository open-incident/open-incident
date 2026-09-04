import Link from "next/link";
import { notFound } from "next/navigation";
import { getQaRun } from "@openincident/qa";
import { getT } from "@/i18n/server";
import { requireMember } from "@/lib/session";
import { cancelQaRun } from "../actions";
import { AutoRefresh } from "../refresh";
import { button, card, chip, durationLabel, statusTone } from "../shared";

/** One QA run: what was run, how it ended, what failed, and the log as it arrives. */
export default async function QaRunPage({ params }: { params: Promise<{ id: string }> }) {
  const { tenant, member } = await requireMember();
  const t = await getT();
  const { id } = await params;
  if (member.role !== "owner") notFound();
  const run = await getQaRun(tenant.id, id);
  if (!run) notFound();
  const alive = run.status === "queued" || run.status === "running";
  const failures = run.summary.failures ?? [];
  const logTail = run.log.length > 200_000 ? run.log.slice(-200_000) : run.log;
  return (
    <div
      className="oi-rise"
      style={{ display: "flex", flexDirection: "column", gap: 16, maxWidth: 1040 }}
    >
      <AutoRefresh active={alive} />
      <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <Link href="/app/settings/qa" className="oi-link" style={{ fontSize: 13 }}>
          ← {t("qa.title")}
        </Link>
        <h1 className="oi-title" style={{ margin: 0 }}>
          {t(`qa.suite.${run.suite}.name`)}
        </h1>
        <span data-testid="qa-run-status" style={chip(statusTone(run.status))}>
          {t(`qa.status.${run.status}`)}
        </span>
        <span style={{ flex: 1 }} />
        {alive && (
          <form action={cancelQaRun}>
            <input type="hidden" name="id" value={run.id} />
            <button
              type="submit"
              data-testid="qa-stop"
              disabled={run.cancelRequested}
              style={{ ...button("danger"), opacity: run.cancelRequested ? 0.5 : 1 }}
            >
              {run.cancelRequested ? t("qa.stopping") : t("qa.stop")}
            </button>
          </form>
        )}
      </div>

      <section style={card}>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "auto 1fr",
            gap: "6px 14px",
            fontSize: 13,
          }}
        >
          <span style={{ color: "var(--ink-3)" }}>{t("qa.detail.command")}</span>
          <code style={{ fontFamily: "var(--font-mono)", fontSize: 12, wordBreak: "break-all" }}>
            {run.command || "—"}
          </code>
          <span style={{ color: "var(--ink-3)" }}>{t("qa.detail.queued")}</span>
          <span>
            {t.fmt.relative(run.queuedAt)} · {run.triggeredByName}
          </span>
          <span style={{ color: "var(--ink-3)" }}>{t("qa.detail.duration")}</span>
          <span style={{ fontVariantNumeric: "tabular-nums" }}>
            {durationLabel(run.startedAt, run.finishedAt)}
          </span>
          <span style={{ color: "var(--ink-3)" }}>{t("qa.detail.exitCode")}</span>
          <span style={{ fontVariantNumeric: "tabular-nums" }}>{run.exitCode ?? "—"}</span>
          {run.summary.total !== undefined && (
            <>
              <span style={{ color: "var(--ink-3)" }}>{t("qa.detail.results")}</span>
              <span data-testid="qa-run-counts">
                {t("qa.counts", {
                  passed: run.summary.passed ?? 0,
                  failed: run.summary.failed ?? 0,
                  total: run.summary.total,
                })}
                {run.summary.flaky ? ` · ${t("qa.flaky", { count: run.summary.flaky })}` : ""}
                {run.summary.skipped ? ` · ${t("qa.skipped", { count: run.summary.skipped })}` : ""}
              </span>
            </>
          )}
        </div>
        {(run.summary.notes ?? []).length > 0 && (
          <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12.5, color: "var(--ink-2)" }}>
            {run.summary.notes!.map((n, i) => (
              <li key={i}>{n}</li>
            ))}
          </ul>
        )}
      </section>

      <section style={card}>
        <div className="oi-eyebrow">{t("qa.failures")}</div>
        {failures.length === 0 ? (
          <div style={{ fontSize: 13, color: "var(--ink-3)" }}>
            {alive ? t("qa.inProgress") : t("qa.noFailures")}
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {failures.map((f, i) => (
              <div
                key={i}
                data-testid="qa-failure"
                style={{
                  padding: "8px 10px",
                  borderRadius: 10,
                  background: "var(--dang-t)",
                  fontSize: 12.5,
                  display: "flex",
                  flexDirection: "column",
                  gap: 3,
                }}
              >
                <span style={{ fontWeight: 600, color: "var(--dang)" }}>{f.title}</span>
                {f.location && (
                  <code
                    style={{
                      fontFamily: "var(--font-mono)",
                      fontSize: 11.5,
                      color: "var(--ink-2)",
                    }}
                  >
                    {f.location}
                  </code>
                )}
                {f.message && <span style={{ color: "var(--ink-2)" }}>{f.message}</span>}
              </div>
            ))}
          </div>
        )}
      </section>

      <section style={card}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div className="oi-eyebrow">{t("qa.log")}</div>
          {run.logTruncated && (
            <span style={{ fontSize: 12, color: "var(--ink-3)" }}>{t("qa.logTruncated")}</span>
          )}
          {alive && <span style={{ fontSize: 12, color: "var(--ink-3)" }}>{t("qa.logLive")}</span>}
        </div>
        <pre
          data-testid="qa-log"
          style={{
            margin: 0,
            padding: "10px 12px",
            background: "var(--sunk)",
            borderRadius: 10,
            fontSize: 11.5,
            lineHeight: 1.5,
            maxHeight: 560,
            overflow: "auto",
            whiteSpace: "pre-wrap",
            wordBreak: "break-word",
            fontFamily: "var(--font-mono)",
          }}
        >
          {logTail || t("qa.logEmpty")}
        </pre>
      </section>
    </div>
  );
}
