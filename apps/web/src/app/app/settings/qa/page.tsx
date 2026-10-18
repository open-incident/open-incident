import { listQaRuns, probeQaTargets, qaCapabilities } from "@openincident/qa";
import type { QaSuite } from "@openincident/db";
import { getT } from "@/i18n/server";
import { requireMember } from "@/lib/session";
import {
  Chip,
  FormCard,
  ListCard,
  Note,
  ReadOnly,
  Row,
  SettingsPage,
  Unavailable,
  pageActionStyle,
  type ChipSpec,
} from "@/components/settings/template";
import { runQaSuite } from "./actions";
import { AutoRefresh } from "./refresh";
import { SUITE_ORDER, durationLabel, isAlive, statusDot, statusTone } from "./shared";
import { FlashOnce, SuiteRow } from "./suite-row";

/**
 * Settings › Diagnostics (design V2): the repository's own test suites —
 * Playwright smoke, vitest, typecheck, eslint, prettier — run by the worker
 * on the machine that hosts this instance. One row per suite with its last
 * run; the row opens that run (its log, what failed). Owners only: a run
 * seeds and purges workspaces and drives the instance.
 */
export default async function QaPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; suite?: string; queued?: string }>;
}) {
  const { tenant, member } = await requireMember();
  const t = await getT();
  const params = await searchParams;
  const page = {
    home: t("settingsV2.home"),
    crumb: t("settingsV2.group.platform"),
    title: t("settingsV2.entry.qa"),
    testId: "settings-qa",
  };
  if (member.role !== "owner")
    return (
      <SettingsPage {...page} lead={t("settingsV2.qa.leadOwners")}>
        <Unavailable
          testId="qa-owner-only"
          title={t("settingsV2.ownersOnly")}
          text={t("settingsV2.qa.ownersText")}
        />
      </SettingsPage>
    );

  const caps = qaCapabilities();
  const probes = caps.repoRoot ? await probeQaTargets(caps) : { web: false, mailpit: false };
  const runs = await listQaRuns(tenant.id, 60);
  const active = runs.some((r) => isAlive(r.status));
  const suiteName = (s: QaSuite) => t(`settingsV2.qa.suite.${s}`);
  const statusLabel = (s: (typeof runs)[number]["status"]) => t(`qa.status.${s}`);

  const rows = SUITE_ORDER.map((suite) => {
    const last = runs.find((r) => r.suite === suite) ?? null;
    let sub: string;
    if (!last) sub = t("settingsV2.qa.never");
    else if (last.status === "queued")
      sub = t("settingsV2.qa.queuedAt", { when: t.fmt.relative(last.queuedAt) });
    else if (last.status === "running")
      sub = t("settingsV2.qa.runningFor", { duration: durationLabel(last.startedAt, null) });
    else {
      const when = t.fmt.relative(last.finishedAt ?? last.startedAt ?? last.queuedAt);
      const duration = durationLabel(last.startedAt, last.finishedAt);
      const s = last.summary;
      if (last.status === "cancelled") sub = t("settingsV2.qa.subCancelled", { when });
      else if (last.status === "error") sub = t("settingsV2.qa.subError", { when });
      else if (s.total !== undefined && (s.passed ?? 0) >= s.total)
        sub = t("settingsV2.qa.subAll", { count: s.total, duration, when });
      else if (s.total !== undefined)
        sub = t("settingsV2.qa.subSome", { passed: s.passed ?? 0, total: s.total, duration, when });
      else if (s.failed) sub = t("settingsV2.qa.subFailed", { count: s.failed, duration, when });
      else sub = t("settingsV2.qa.subPlain", { duration, when });
    }
    const chip: ChipSpec | null = last
      ? { label: statusLabel(last.status), tone: statusTone(last.status), testId: "qa-last-status" }
      : null;
    return {
      suite,
      name: suiteName(suite),
      dot: statusDot(last?.status ?? null),
      sub,
      chip,
      lastId: last?.id ?? null,
      canRun: Boolean(caps.repoRoot) && !(last && isAlive(last.status)),
    };
  });

  const ready = (ok: boolean) => (
    <Chip tone={ok ? "ok" : "dang"}>
      {ok ? t("settingsV2.qa.ready") : t("settingsV2.qa.missing")}
    </Chip>
  );
  const error =
    params.error === "busy"
      ? t("qa.error.busy", { suite: params.suite ? suiteName(params.suite as QaSuite) : "" })
      : params.error === "queue"
        ? t("qa.error.queue")
        : params.error
          ? t("qa.error.unavailable")
          : null;

  return (
    <SettingsPage
      {...page}
      lead={t("settingsV2.qa.lead")}
      actions={
        <form action={runQaSuite}>
          <input type="hidden" name="suite" value="all" />
          <button
            type="submit"
            data-testid="qa-run-all"
            disabled={!caps.repoRoot || active}
            className="oi-hover-brand-2"
            style={{ ...pageActionStyle(true), opacity: !caps.repoRoot || active ? 0.5 : 1 }}
          >
            {t("settingsV2.qa.runAll")}
          </button>
        </form>
      }
    >
      <AutoRefresh active={active} everyMs={4_000} />
      <FlashOnce
        message={
          params.queued
            ? t("settingsV2.qa.queuedFlash", { count: Number(params.queued) || 0 })
            : null
        }
      />
      {error && (
        <Note tone="dang" testId="qa-error">
          {error}
        </Note>
      )}
      <ListCard title={t("settingsV2.qa.suites")} foot={t("settingsV2.qa.foot")} testId="qa-suites">
        {rows.map((r) => (
          <SuiteRow key={r.suite} {...r} />
        ))}
      </ListCard>
      <div data-testid="qa-prereqs">
        {!caps.repoRoot ? (
          <Unavailable
            testId="qa-unavailable"
            title={t("settingsV2.unavailable")}
            text={t("qa.unavailable.body")}
          />
        ) : (
          <FormCard title={t("settingsV2.qa.machine")} hint={t("settingsV2.qa.machineHint")}>
            <Row label={t("settingsV2.qa.repo")}>
              <ReadOnly mono>{caps.repoRoot}</ReadOnly>
              {ready(true)}
            </Row>
            <Row label={t("settingsV2.qa.playwright")} help={t("qa.prereq.playwrightHint")}>
              {ready(caps.playwright)}
            </Row>
            <Row label={t("settingsV2.qa.tools")} help="turbo · eslint · prettier">
              {ready(caps.turbo && caps.eslint && caps.prettier)}
            </Row>
            <Row label={t("settingsV2.qa.web")}>
              <ReadOnly mono>{caps.webHost}</ReadOnly>
              {ready(probes.web)}
            </Row>
            <Row label={t("settingsV2.qa.mailpit")}>
              <ReadOnly mono>{caps.mailpitUrl}</ReadOnly>
              {ready(probes.mailpit)}
            </Row>
          </FormCard>
        )}
      </div>
    </SettingsPage>
  );
}
