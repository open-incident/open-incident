import { asc, eq } from "drizzle-orm";
import { rumApplications, telemetrySettings, withTenant } from "@openincident/db";
import { rumApps } from "@openincident/telemetry";
import { getT } from "@/i18n/server";
import { isManager, requireMember } from "@/lib/session";
import { telemetryInstalled } from "@/lib/telemetry-module";
import {
  FormCard,
  ListCard,
  Row,
  SettingsPage,
  Unavailable,
  selectStyle,
} from "@/components/settings/template";
import { Toggle } from "@/components/settings/controls";
import { SettingsForm } from "@/components/settings/settings-form";
import { EmptyRow } from "../api/empty-row";
import { saveTelemetry } from "./actions";
import { REDACTIONS, redactionsOn } from "./redaction";
import { NewRumDialog, RumRow } from "./rum";

const TRACES = [3, 7, 14, 30];
const LOGS = [7, 14, 30, 90];
const METRICS = [30, 90, 395];

/**
 * Settings › Telemetry (design V2): how long traces, logs and metrics are
 * kept, what is removed before anything is stored, what an exception that
 * comes back does — one form, one save — and the browser applications that
 * report real user monitoring.
 *
 * Without the telemetry module (no column store configured) the screen says
 * so and shows nothing else: these settings would act on nothing.
 */
export default async function TelemetrySettingsPage() {
  const { tenant, member } = await requireMember();
  const t = await getT();
  const manages = isManager(member);
  const page = {
    home: t("settingsV2.home"),
    crumb: t("settingsV2.group.platform"),
    title: t("settingsV2.entry.telemetry"),
    testId: "settings-telemetry",
  };

  if (!telemetryInstalled())
    return (
      <SettingsPage {...page} lead={t("settingsV2.tel.leadOff")}>
        <Unavailable
          testId="telemetry-not-installed"
          title={t("settingsV2.tel.notInstalled")}
          text={t("settingsV2.tel.notInstalledText")}
          code="CLICKHOUSE_URL=http://clickhouse:8123"
        />
      </SettingsPage>
    );

  const data = await withTenant(tenant.id, async (tx) => ({
    settings: (
      await tx.select().from(telemetrySettings).where(eq(telemetrySettings.tenantId, tenant.id))
    )[0],
    apps: await tx
      .select()
      .from(rumApplications)
      .where(eq(rumApplications.tenantId, tenant.id))
      .orderBy(asc(rumApplications.name)),
  }));
  // Sessions per application over thirty days, from the column store; a store
  // that does not answer leaves the figure out rather than inventing one.
  const sessions = data.apps.length ? await rumApps(tenant.id, 30 * 24).catch(() => null) : [];
  const s = data.settings;
  const traces = s?.retentionTracesDays ?? 15;
  const logs = s?.retentionLogsDays ?? 15;
  const metrics = s?.retentionMetricsDays ?? 30;
  const on = redactionsOn(s?.scrubRules ?? []);

  const days = (n: number) =>
    n === 395 ? t("settingsV2.tel.months13") : t("settingsV2.tel.days", { count: n });
  const retention = (name: string, label: string, value: number, opts: number[]) => (
    <Row label={label}>
      <select
        name={name}
        defaultValue={String(value)}
        disabled={!manages}
        aria-label={label}
        className="oi-field"
        style={selectStyle}
      >
        {(opts.includes(value) ? opts : [...opts, value].sort((a, b) => a - b)).map((d) => (
          <option key={d} value={d}>
            {days(d)}
          </option>
        ))}
      </select>
    </Row>
  );

  return (
    <SettingsPage {...page} lead={t("settingsV2.tel.lead")}>
      <SettingsForm action={saveTelemetry} testId="telemetry-form">
        <FormCard title={t("settingsV2.tel.retention")} hint={t("settingsV2.tel.retentionHint")}>
          {retention("retentionTracesDays", t("settingsV2.tel.traces"), traces, TRACES)}
          {retention("retentionLogsDays", t("settingsV2.tel.logs"), logs, LOGS)}
          {retention("retentionMetricsDays", t("settingsV2.tel.metrics"), metrics, METRICS)}
        </FormCard>
        <FormCard title={t("settingsV2.tel.redaction")} hint={t("settingsV2.tel.redactionHint")}>
          {REDACTIONS.map((r) => {
            const label = t(`settingsV2.tel.redact.${r.key}`);
            return (
              <Row
                key={r.key}
                label={label}
                help={r.fixed ? t("settingsV2.tel.redactFixed") : undefined}
              >
                <Toggle
                  name={`redact.${r.key}`}
                  defaultChecked={on.has(r.key)}
                  label={label}
                  disabled={!manages || r.fixed}
                  testId={`redact-${r.key}`}
                />
              </Row>
            );
          })}
        </FormCard>
        <FormCard title={t("settingsV2.tel.exception")}>
          <Row label={t("settingsV2.tel.regress")} help={t("settingsV2.tel.regressHelp")}>
            <Toggle
              name="exceptionRegressions"
              defaultChecked={s?.exceptionRegressions ?? true}
              label={t("settingsV2.tel.regress")}
              disabled={!manages}
              testId="exception-regressions"
            />
          </Row>
          <Row label={t("settingsV2.tel.regressSeverity")}>
            <select
              name="exceptionRegressionSeverity"
              defaultValue={s?.exceptionRegressionSeverity ?? "P3"}
              disabled={!manages}
              aria-label={t("settingsV2.tel.regressSeverity")}
              className="oi-field"
              style={selectStyle}
            >
              {(["P1", "P2", "P3", "P4"] as const).map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          </Row>
        </FormCard>
      </SettingsForm>

      <ListCard
        title={t("settingsV2.tel.rum")}
        hint={t("settingsV2.tel.rumHint")}
        action={manages ? <NewRumDialog /> : undefined}
        testId="rum-applications"
      >
        {data.apps.map((a) => {
          const n = sessions?.find((x) => x.app_id === a.id);
          return (
            <RumRow
              key={a.id}
              manages={manages}
              app={{
                id: a.id,
                name: a.name,
                sub: t("settingsV2.tel.rumSub", {
                  tail: a.id.slice(-4),
                  pct: `${Math.round(a.sampleRate * 100)} %`,
                }),
                right:
                  sessions === null
                    ? ""
                    : t("settingsV2.tel.rumSessions", { count: Number(n?.sessions ?? 0) }),
                origins: a.allowedOrigins.join(", "),
                sampleRate: a.sampleRate,
                replayEnabled: a.replayEnabled,
                replaySampleRate: a.replaySampleRate,
                replayUnmask: a.replayUnmask.join(", "),
                mobileEnabled: a.mobileEnabled,
              }}
            />
          );
        })}
        {data.apps.length === 0 && <EmptyRow>{t("settingsV2.tel.rumNone")}</EmptyRow>}
      </ListCard>
    </SettingsPage>
  );
}
