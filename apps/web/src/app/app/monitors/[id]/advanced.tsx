/**
 * Advanced — what a monitor is, past its rules: its name, address, cadence and
 * service; a journey's steps and credentials; and the way to delete it.
 *
 * The creation dialog asks for an address and nothing else, as the design
 * does; this is where the rest lives once the monitor exists.
 */

import { getT } from "@/i18n/server";
import type { MonitorDetail } from "@/lib/monitors";
import {
  deleteMonitor,
  deleteMonitorSecret,
  saveMonitorSecret,
  saveSyntheticJourney,
  updateMonitorBasics,
} from "../actions";
import { JourneyEditor } from "../journey-editor";

const CARD: React.CSSProperties = {
  background: "var(--panel)",
  border: "1px solid var(--line)",
  borderRadius: "var(--radius-card)",
  boxShadow: "var(--shadow-card)",
  padding: "16px 18px",
  display: "flex",
  flexDirection: "column",
  gap: 12,
};

const LABEL: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 600,
  letterSpacing: ".08em",
  textTransform: "uppercase",
  color: "var(--ink-3)",
};

const CONTROL: React.CSSProperties = {
  height: 38,
  border: "1px solid var(--line)",
  borderRadius: 10,
  padding: "0 12px",
  fontSize: 13.5,
  outline: "none",
  background: "var(--panel)",
  color: "inherit",
  width: "100%",
};

const BUTTON: React.CSSProperties = {
  height: 34,
  padding: "0 14px",
  borderRadius: 9,
  background: "var(--brand)",
  color: "var(--on-brand)",
  border: 0,
  fontSize: 13,
  fontWeight: 600,
  cursor: "pointer",
  width: "fit-content",
};

const TARGETLESS = new Set([
  "manual",
  "incoming",
  "synthetic",
  "logs",
  "traces",
  "metrics",
  "exceptions",
]);

export async function AdvancedTab({
  monitor: m,
  mayEdit,
  saved,
}: {
  monitor: MonitorDetail;
  mayEdit: boolean;
  saved?: string;
}) {
  const t = await getT();
  const intervals = [30, 60, 300, 900, 3600].filter((s) => m.type !== "synthetic" || s >= 300);
  if (!intervals.includes(m.intervalSeconds)) intervals.push(m.intervalSeconds);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12, maxWidth: 820 }}>
      <form action={updateMonitorBasics} style={CARD} data-testid="monitor-basics">
        <input type="hidden" name="id" value={m.id} />
        <div style={{ fontSize: 14, fontWeight: 600 }}>{t("mon2.advancedTitle")}</div>
        <label style={{ display: "flex", flexDirection: "column", gap: 5 }}>
          <span style={LABEL}>{t("monitors.fieldName")}</span>
          <input
            name="name"
            defaultValue={m.name}
            required
            maxLength={120}
            disabled={!mayEdit}
            className="oi-field"
            style={CONTROL}
          />
        </label>
        {!TARGETLESS.has(m.type) && (
          <label style={{ display: "flex", flexDirection: "column", gap: 5 }}>
            <span style={LABEL}>{t("monitors.fieldTarget")}</span>
            <input
              name="target"
              defaultValue={m.target}
              maxLength={500}
              disabled={!mayEdit}
              className="oi-field"
              style={{ ...CONTROL, fontFamily: "var(--mono)" }}
            />
          </label>
        )}
        <div style={{ display: "grid", gridTemplateColumns: "160px minmax(0,1fr)", gap: 10 }}>
          <label style={{ display: "flex", flexDirection: "column", gap: 5 }}>
            <span style={LABEL}>{t("monitors.fieldEvery")}</span>
            <select
              name="intervalSeconds"
              defaultValue={String(m.intervalSeconds)}
              disabled={!mayEdit}
              style={CONTROL}
            >
              {intervals
                .sort((a, b) => a - b)
                .map((s) => (
                  <option key={s} value={s}>
                    {s % 3600 === 0
                      ? t("monitors.everyHours", { count: s / 3600 })
                      : s % 60 === 0
                        ? t("monitors.everyMinutes", { count: s / 60 })
                        : t("monitors.everySeconds", { count: s })}
                  </option>
                ))}
            </select>
          </label>
          <label style={{ display: "flex", flexDirection: "column", gap: 5 }}>
            <span style={LABEL}>{t("monitors.fieldService")}</span>
            <input
              name="service"
              defaultValue={m.serviceKey ?? ""}
              placeholder={t("monitors.serviceHint")}
              disabled={!mayEdit}
              className="oi-field"
              style={{ ...CONTROL, fontFamily: "var(--mono)" }}
            />
          </label>
        </div>
        {mayEdit && (
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <button
              type="submit"
              className="oi-hover-brand-2"
              style={BUTTON}
              data-testid="monitor-basics-save"
            >
              {t("common.save")}
            </button>
            {saved === "basics" && (
              <span style={{ fontSize: 12, color: "var(--ok)", fontWeight: 600 }}>
                {t("common.saved")}
              </span>
            )}
          </div>
        )}
      </form>

      {m.journey && mayEdit && (
        <form action={saveSyntheticJourney} style={CARD}>
          <input type="hidden" name="id" value={m.id} />
          <div style={{ fontSize: 14, fontWeight: 600 }}>{t("synthetic.editJourney")}</div>
          <JourneyEditor initial={m.journey} />
          <button
            type="submit"
            data-testid="journey-save"
            className="oi-hover-brand-2"
            style={BUTTON}
          >
            {t("synthetic.saveJourney")}
          </button>
        </form>
      )}

      {m.journey && mayEdit && (
        <div style={CARD}>
          <div style={{ fontSize: 14, fontWeight: 600 }}>{t("synthetic.credentials")}</div>
          <div style={{ fontSize: 12, color: "var(--ink-3)", lineHeight: 1.45 }}>
            {t("synthetic.credentialsHint")}
          </div>
          {m.secretNames.length === 0 ? (
            <div style={{ fontSize: 12.5, color: "var(--ink-3)" }}>
              {t("synthetic.secretsNone")}
            </div>
          ) : (
            m.secretNames.map((name) => (
              <div
                key={name}
                style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12.5 }}
              >
                <span style={{ fontFamily: "var(--mono)", fontWeight: 600 }}>{name}</span>
                <span style={{ color: "var(--ink-3)", fontSize: 11.5 }}>
                  {t("synthetic.secretStored")}
                </span>
                <span style={{ flex: 1 }} />
                <form action={deleteMonitorSecret}>
                  <input type="hidden" name="id" value={m.id} />
                  <input type="hidden" name="name" value={name} />
                  <button
                    type="submit"
                    style={{
                      border: 0,
                      background: "none",
                      color: "var(--dang)",
                      fontSize: 11.5,
                      cursor: "pointer",
                    }}
                  >
                    {t("synthetic.remove")}
                  </button>
                </form>
              </div>
            ))
          )}
          {/* Written, never read back: the field is empty every time. */}
          <form
            action={saveMonitorSecret}
            style={{ display: "grid", gridTemplateColumns: "200px minmax(0,1fr) auto", gap: 8 }}
          >
            <input type="hidden" name="id" value={m.id} />
            <input
              name="name"
              required
              pattern="[A-Za-z0-9_]{1,64}"
              placeholder="PASSWORD"
              className="oi-field"
              style={{ ...CONTROL, height: 34, fontFamily: "var(--mono)" }}
            />
            <input
              name="value"
              type="password"
              required
              autoComplete="new-password"
              placeholder={t("synthetic.secretValue")}
              className="oi-field"
              style={{ ...CONTROL, height: 34 }}
            />
            <button
              type="submit"
              data-testid="monitor-secret-save"
              className="oi-hover"
              style={{
                ...BUTTON,
                background: "var(--panel)",
                color: "inherit",
                border: "1px solid var(--line)",
              }}
            >
              {t("synthetic.secretSave")}
            </button>
          </form>
        </div>
      )}

      {mayEdit && (
        <div style={{ ...CARD, borderColor: "var(--dang-t)" }}>
          <div style={{ fontSize: 14, fontWeight: 600 }}>{t("mon2.dangerZone")}</div>
          <div style={{ fontSize: 12.5, color: "var(--ink-2)", lineHeight: 1.5 }}>
            {t("mon2.dangerBody")}
          </div>
          <form action={deleteMonitor}>
            <input type="hidden" name="id" value={m.id} />
            <button
              type="submit"
              data-testid="monitor-delete"
              className="oi-hover-dang"
              style={{
                ...BUTTON,
                background: "var(--panel)",
                color: "var(--dang)",
                border: "1px solid var(--dang)",
              }}
            >
              {t("monitors.delete")}
            </button>
          </form>
        </div>
      )}
    </div>
  );
}
