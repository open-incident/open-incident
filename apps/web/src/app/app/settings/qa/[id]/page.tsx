import { notFound } from "next/navigation";
import { getQaRun, listQaRuns } from "@openincident/qa";
import { getT } from "@/i18n/server";
import { requireMember } from "@/lib/session";
import {
  Card,
  Chip,
  FormCard,
  ListCard,
  ListItem,
  PageLink,
  ReadOnly,
  Row,
  SettingsPage,
  pageActionStyle,
} from "@/components/settings/template";
import { EmptyRow } from "../../api/empty-row";
import { cancelQaRun } from "../actions";
import { AutoRefresh } from "../refresh";
import { durationLabel, isAlive, statusDot, statusTone } from "../shared";

/**
 * One diagnostics run, on the settings template: what was run and how it
 * ended, what failed, the log as it arrives, and the suite's earlier runs.
 */
export default async function QaRunPage({ params }: { params: Promise<{ id: string }> }) {
  const { tenant, member } = await requireMember();
  const t = await getT();
  const { id } = await params;
  if (member.role !== "owner") notFound();
  const run = await getQaRun(tenant.id, id);
  if (!run) notFound();
  const alive = isAlive(run.status);
  const failures = run.summary.failures ?? [];
  const logTail = run.log.length > 200_000 ? run.log.slice(-200_000) : run.log;
  const earlier = (await listQaRuns(tenant.id, 120))
    .filter((r) => r.suite === run.suite && r.id !== run.id)
    .slice(0, 10);
  const counts =
    run.summary.total !== undefined
      ? [
          t("qa.counts", {
            passed: run.summary.passed ?? 0,
            failed: run.summary.failed ?? 0,
            total: run.summary.total,
          }),
          run.summary.flaky ? t("qa.flaky", { count: run.summary.flaky }) : null,
          run.summary.skipped ? t("qa.skipped", { count: run.summary.skipped }) : null,
        ]
          .filter(Boolean)
          .join(" · ")
      : null;

  return (
    <SettingsPage
      home={t("settingsV2.home")}
      crumb={t("settingsV2.group.platform")}
      title={t(`settingsV2.qa.suite.${run.suite}`)}
      lead={t("settingsV2.qa.runLead", {
        when: t.fmt.relative(run.queuedAt),
        by: run.triggeredByName || "—",
      })}
      testId="settings-qa-run"
      actions={
        <>
          <PageLink href="/app/settings/qa">{t("settingsV2.qa.allSuites")}</PageLink>
          {alive && (
            <form action={cancelQaRun}>
              <input type="hidden" name="id" value={run.id} />
              <button
                type="submit"
                data-testid="qa-stop"
                disabled={run.cancelRequested}
                className="oi-hover"
                style={{ ...pageActionStyle(false, true), opacity: run.cancelRequested ? 0.5 : 1 }}
              >
                {run.cancelRequested ? t("qa.stopping") : t("qa.stop")}
              </button>
            </form>
          )}
        </>
      }
    >
      <AutoRefresh active={alive} />
      <FormCard title={t("settingsV2.qa.run")} testId="qa-run">
        <Row label={t("settingsV2.qa.state")}>
          <Chip tone={statusTone(run.status)} testId="qa-run-status">
            {t(`qa.status.${run.status}`)}
          </Chip>
        </Row>
        <Row label={t("qa.detail.command")}>
          <ReadOnly mono>{run.command || "—"}</ReadOnly>
        </Row>
        <Row label={t("qa.detail.duration")}>
          <ReadOnly>{durationLabel(run.startedAt, run.finishedAt)}</ReadOnly>
        </Row>
        <Row label={t("qa.detail.exitCode")}>
          <ReadOnly mono>{run.exitCode ?? "—"}</ReadOnly>
        </Row>
        {counts && (
          <Row label={t("qa.detail.results")}>
            <ReadOnly testId="qa-run-counts">{counts}</ReadOnly>
          </Row>
        )}
        {(run.summary.notes ?? []).map((n, i) => (
          <Row key={i} label={i === 0 ? t("settingsV2.qa.notes") : ""}>
            <ReadOnly>{n}</ReadOnly>
          </Row>
        ))}
      </FormCard>

      <ListCard title={t("qa.failures")} testId="qa-failures">
        {failures.map((f, i) => (
          <ListItem
            key={i}
            testId="qa-failure"
            dot="var(--dang)"
            title={f.title}
            titleWeight={500}
            sub={[f.location, f.message].filter(Boolean).join(" — ") || undefined}
          />
        ))}
        {failures.length === 0 && (
          <EmptyRow>{alive ? t("qa.inProgress") : t("qa.noFailures")}</EmptyRow>
        )}
      </ListCard>

      <Card padding="13px 18px 16px" gap={10}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ fontSize: 14, fontWeight: 600 }}>{t("qa.log")}</span>
          {run.logTruncated && (
            <span style={{ fontSize: 12, color: "var(--ink-3)" }}>{t("qa.logTruncated")}</span>
          )}
          {alive && <span style={{ fontSize: 12, color: "var(--ink-3)" }}>{t("qa.logLive")}</span>}
        </div>
        <pre
          data-testid="qa-log"
          style={{
            margin: 0,
            padding: "11px 14px",
            background: "var(--topbar-dark)",
            color: "var(--code-blue)",
            borderRadius: 10,
            fontSize: 11.5,
            lineHeight: 1.55,
            maxHeight: 560,
            overflow: "auto",
            whiteSpace: "pre-wrap",
            wordBreak: "break-word",
            fontFamily: "var(--mono)",
          }}
        >
          {logTail || t("qa.logEmpty")}
        </pre>
      </Card>

      {earlier.length > 0 && (
        <ListCard title={t("settingsV2.qa.earlier")} testId="qa-earlier">
          {earlier.map((r) => (
            <ListItem
              key={r.id}
              testId="qa-run-row"
              href={`/app/settings/qa/${r.id}`}
              dot={statusDot(r.status)}
              title={t.fmt.dateTime(r.queuedAt, t.timeZone)}
              titleWeight={500}
              sub={[
                durationLabel(r.startedAt, r.finishedAt),
                r.summary.total !== undefined
                  ? t("settingsV2.qa.passedOf", {
                      passed: r.summary.passed ?? 0,
                      total: r.summary.total,
                    })
                  : null,
                r.triggeredByName || null,
              ]
                .filter(Boolean)
                .join(" · ")}
              chips={[{ label: t(`qa.status.${r.status}`), tone: statusTone(r.status) }]}
            />
          ))}
        </ListCard>
      )}
    </SettingsPage>
  );
}
