import { asc, eq } from "drizzle-orm";
import Link from "next/link";
import { rumApplications, telemetrySettings, withTenant } from "@openincident/db";
import { isManagerRole } from "@openincident/config";
import { getT } from "@/i18n/server";
import { requireMember } from "@/lib/session";
import { currentOrigin } from "@/lib/tenant";
import { telemetryInstalled } from "@/lib/telemetry";
import { createRumApplication, deleteRumApplication, saveObservabilitySettings } from "./actions";

const CARD: React.CSSProperties = {
  background: "var(--panel)",
  border: "1px solid var(--line)",
  borderRadius: "var(--radius-card)",
  boxShadow: "var(--shadow-card)",
  padding: "16px 18px",
  display: "flex",
  flexDirection: "column",
  gap: 14,
};

const CONTROL: React.CSSProperties = {
  height: 34,
  border: "1px solid var(--line)",
  borderRadius: 9,
  padding: "0 10px",
  fontSize: 13,
  background: "var(--panel)",
  width: "100%",
};

const LABEL: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 600,
  letterSpacing: ".08em",
  textTransform: "uppercase",
  color: "var(--ink-3)",
};

const HINT: React.CSSProperties = { fontSize: 11.5, color: "var(--ink-3)", lineHeight: 1.5 };

/**
 * Settings → Observability: how long the telemetry is kept, what is redacted
 * before it is written, and whether a bug appearing raises an alert.
 *
 * These three had no screen at all until now. They were columns with sensible
 * defaults that nobody could see or change, which for a retention window and a
 * redaction rule is the wrong kind of invisible: one decides a disk bill and
 * the other decides whether a connection string ends up in a log line.
 */
export default async function ObservabilitySettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ saved?: string; error?: string; rule?: string; created?: string }>;
}) {
  const { tenant, member } = await requireMember();
  const t = await getT();
  const q = await searchParams;
  const manages = isManagerRole(member);
  // The instance's own address, so the snippet is one somebody can paste
  // rather than one they have to finish.
  const origin = await currentOrigin();

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
  const row = data.settings;
  const installed = telemetryInstalled();

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14, maxWidth: 720 }}>
      <div>
        <h1
          style={{
            margin: 0,
            fontFamily: "var(--title)",
            fontSize: 20,
            fontWeight: 600,
            letterSpacing: "-.015em",
          }}
        >
          {t("settings.nav.observability")}
        </h1>
        <p style={{ margin: "6px 0 0", fontSize: 13, color: "var(--ink-2)", lineHeight: 1.55 }}>
          {t("settings.telemetry.intro")}
        </p>
      </div>

      {/*
        The module is optional, and these settings are still worth showing
        without it: they are what the instance will do once it is installed.
        Saying so beats a screen that looks broken.
      */}
      {!installed && (
        <div
          style={{
            ...CARD,
            padding: "12px 14px",
            borderColor: "var(--wait)",
            background: "var(--wait-t)",
            fontSize: 12.5,
            color: "var(--ink)",
          }}
        >
          {t("settings.telemetry.notInstalled")}
        </div>
      )}

      {q.saved && (
        <div
          role="status"
          style={{
            ...CARD,
            padding: "10px 14px",
            borderColor: "var(--ok)",
            background: "var(--ok-t)",
            color: "var(--ok)",
            fontSize: 12.5,
          }}
        >
          {t("settings.telemetry.saved")}
        </div>
      )}
      {q.error && (
        <div
          role="alert"
          data-testid="observability-error"
          style={{
            ...CARD,
            padding: "10px 14px",
            borderColor: "var(--dang)",
            background: "var(--dang-t)",
            color: "var(--dang)",
            fontSize: 12.5,
          }}
        >
          {q.error === "regex"
            ? t("settings.telemetry.badRegex", { rule: q.rule ?? "" })
            : q.error === "origin"
              ? t("settings.rum.badOrigin", { rule: q.rule ?? "" })
              : t("settings.telemetry.invalid")}
        </div>
      )}

      <form action={saveObservabilitySettings} style={{ display: "contents" }}>
        <div style={CARD}>
          <span className="oi-eyebrow">{t("settings.telemetry.retention")}</span>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
            {(
              [
                ["retentionLogsDays", row?.retentionLogsDays ?? 15, "settings.telemetry.logs"],
                [
                  "retentionTracesDays",
                  row?.retentionTracesDays ?? 15,
                  "settings.telemetry.traces",
                ],
                [
                  "retentionMetricsDays",
                  row?.retentionMetricsDays ?? 30,
                  "settings.telemetry.metrics",
                ],
              ] as const
            ).map(([name, value, label]) => (
              <label key={name} style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                <span style={LABEL}>{t(label)}</span>
                <input
                  name={name}
                  type="number"
                  min={1}
                  max={365}
                  defaultValue={value}
                  disabled={!manages}
                  style={{ ...CONTROL, fontFamily: "var(--mono)" }}
                />
              </label>
            ))}
          </div>
          <span style={HINT}>{t("settings.telemetry.retentionHint")}</span>
        </div>

        <div style={CARD}>
          <span className="oi-eyebrow">{t("settings.telemetry.scrub")}</span>
          <textarea
            name="scrubRules"
            rows={5}
            disabled={!manages}
            defaultValue={(row?.scrubRules ?? []).join("\n")}
            placeholder={"\\b4[0-9]{12}(?:[0-9]{3})?\\b\ninternal-token-[a-z0-9]+"}
            style={{
              ...CONTROL,
              height: "auto",
              padding: "9px 10px",
              fontFamily: "var(--mono)",
              fontSize: 12,
              lineHeight: 1.5,
              resize: "vertical",
            }}
          />
          <span style={HINT}>{t("settings.telemetry.scrubHint")}</span>
        </div>

        <div style={CARD}>
          <span className="oi-eyebrow">{t("settings.telemetry.budget")}</span>
          <label style={{ display: "flex", flexDirection: "column", gap: 5, maxWidth: 240 }}>
            <span style={LABEL}>{t("settings.telemetry.series")}</span>
            <input
              name="cardinalityBudget"
              type="number"
              min={1000}
              max={10_000_000}
              step={1000}
              defaultValue={row?.cardinalityBudget ?? ""}
              placeholder="50000"
              disabled={!manages}
              style={{ ...CONTROL, fontFamily: "var(--mono)" }}
            />
          </label>
          <span style={HINT}>{t("settings.telemetry.budgetHint")}</span>

          <label style={{ display: "flex", flexDirection: "column", gap: 5, maxWidth: 240 }}>
            <span style={LABEL}>{t("settings.telemetry.softCap")}</span>
            <input
              name="dailySoftCapGb"
              type="number"
              min={1}
              max={10_000}
              step={1}
              defaultValue={row?.dailySoftCapGb ?? ""}
              placeholder="—"
              disabled={!manages}
              style={{ ...CONTROL, fontFamily: "var(--mono)" }}
            />
          </label>
          <span style={HINT}>{t("settings.telemetry.softCapHint")}</span>
        </div>

        <div style={CARD}>
          <span className="oi-eyebrow">{t("settings.telemetry.regressionsTitle")}</span>
          <label style={{ display: "flex", alignItems: "flex-start", gap: 10, fontSize: 13 }}>
            <input
              type="checkbox"
              name="exceptionRegressions"
              defaultChecked={row?.exceptionRegressions ?? true}
              disabled={!manages}
              style={{ marginTop: 3 }}
            />
            <span style={{ flex: 1, lineHeight: 1.5 }}>
              {t("settings.telemetry.regressions")}
              <span style={{ display: "block", ...HINT }}>
                {t("settings.telemetry.regressionsHint")}
              </span>
            </span>
          </label>
          <label style={{ display: "flex", flexDirection: "column", gap: 5, maxWidth: 240 }}>
            <span style={LABEL}>{t("settings.telemetry.regressionSeverity")}</span>
            <select
              name="exceptionRegressionSeverity"
              defaultValue={row?.exceptionRegressionSeverity ?? "P3"}
              disabled={!manages}
              style={CONTROL}
            >
              {(["P1", "P2", "P3", "P4"] as const).map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          </label>
          <span style={HINT}>
            <Link href="/app/telemetry?tab=exceptions" style={{ color: "var(--brand)" }}>
              {t("settings.telemetry.seeExceptions")}
            </Link>
          </span>
        </div>

        {manages && (
          <div style={{ display: "flex" }}>
            <button
              type="submit"
              data-testid="observability-save"
              className="oi-hover-brand-2"
              style={{
                height: 34,
                padding: "0 14px",
                borderRadius: 9,
                background: "var(--brand)",
                color: "var(--on-brand)",
                border: 0,
                fontSize: 12.5,
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              {t("common.save")}
            </button>
          </div>
        )}
      </form>

      {/*
        Outside the settings form on purpose: an application is a thing that is
        created and deleted, not a value that is saved, and putting it inside
        would make "Save" mean two different things.
      */}
      <div style={CARD} data-testid="rum-applications">
        <span className="oi-eyebrow">{t("settings.rum.title")}</span>
        <span style={HINT}>{t("settings.rum.intro")}</span>

        {q.created && (
          <div
            style={{
              border: "1px solid var(--ok)",
              background: "var(--ok-t)",
              borderRadius: 9,
              padding: "10px 12px",
              display: "flex",
              flexDirection: "column",
              gap: 6,
            }}
          >
            <span style={{ fontSize: 12.5, fontWeight: 600, color: "var(--ok)" }}>
              {t("settings.rum.created")}
            </span>
            <pre
              style={{
                fontFamily: "var(--mono)",
                fontSize: 11.5,
                margin: 0,
                overflowX: "auto",
                lineHeight: 1.5,
              }}
            >
              {snippet(q.created, origin)}
            </pre>
          </div>
        )}

        {data.apps.length === 0 && !q.created && (
          <span style={{ fontSize: 12.5, color: "var(--ink-3)" }}>{t("settings.rum.none")}</span>
        )}

        {data.apps.map((a) => (
          <div
            key={a.id}
            style={{
              display: "flex",
              alignItems: "baseline",
              gap: 10,
              padding: "8px 0",
              borderTop: "1px solid var(--line-2)",
              fontSize: 12.5,
              flexWrap: "wrap",
            }}
          >
            <span style={{ fontWeight: 600, minWidth: 140 }}>{a.name}</span>
            <span style={{ fontFamily: "var(--mono)", fontSize: 11, color: "var(--ink-3)" }}>
              {a.id}
            </span>
            <span style={{ fontSize: 11.5, color: "var(--ink-2)" }}>
              {a.allowedOrigins.join(", ")}
              {a.sampleRate < 1 ? ` · ${Math.round(a.sampleRate * 100)} %` : ""}
            </span>
            <span style={{ flex: 1 }} />
            {manages && (
              <form action={deleteRumApplication}>
                <input type="hidden" name="id" value={a.id} />
                <button
                  type="submit"
                  className="oi-hover-dang"
                  style={{
                    border: "1px solid var(--line)",
                    background: "var(--panel)",
                    borderRadius: 7,
                    padding: "3px 9px",
                    fontSize: 11.5,
                    color: "var(--dang)",
                    cursor: "pointer",
                  }}
                >
                  {t("common.delete")}
                </button>
              </form>
            )}
          </div>
        ))}

        {manages && (
          <form
            action={createRumApplication}
            style={{
              display: "grid",
              gridTemplateColumns: "minmax(0,1fr) minmax(0,1.4fr) 110px auto",
              gap: 8,
              alignItems: "end",
              borderTop: "1px solid var(--line-2)",
              paddingTop: 12,
            }}
          >
            <label style={{ display: "flex", flexDirection: "column", gap: 5 }}>
              <span style={LABEL}>{t("settings.rum.name")}</span>
              <input name="name" required className="oi-field" style={CONTROL} />
            </label>
            <label style={{ display: "flex", flexDirection: "column", gap: 5 }}>
              <span style={LABEL}>{t("settings.rum.origins")}</span>
              <input
                name="origins"
                required
                placeholder="https://shop.example.com, https://www.example.com"
                className="oi-field"
                style={{ ...CONTROL, fontFamily: "var(--mono)", fontSize: 12 }}
              />
            </label>
            <label style={{ display: "flex", flexDirection: "column", gap: 5 }}>
              <span style={LABEL}>{t("settings.rum.sample")}</span>
              <select name="sampleRate" defaultValue="1" style={CONTROL}>
                <option value="1">100 %</option>
                <option value="0.5">50 %</option>
                <option value="0.1">10 %</option>
                <option value="0.01">1 %</option>
              </select>
            </label>
            <button
              type="submit"
              data-testid="rum-create"
              className="oi-hover-brand-2"
              style={{
                height: 34,
                padding: "0 13px",
                borderRadius: 9,
                background: "var(--brand)",
                color: "var(--on-brand)",
                border: 0,
                fontSize: 12.5,
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              {t("settings.rum.add")}
            </button>
          </form>
        )}
        <span style={HINT}>{t("settings.rum.originsHint")}</span>
      </div>
    </div>
  );
}

/** The two lines somebody pastes into a page, with the id already in them. */
function snippet(appId: string, origin: string): string {
  return (
    `<script src="${origin}/rum/oi-rum.js"\n` +
    `        data-app="${appId}"\n` +
    `        data-endpoint="${process.env.TELEMETRY_PUBLIC_ORIGIN || "https://otlp.<your workspace host>"}"\n` +
    `        defer></script>`
  );
}
