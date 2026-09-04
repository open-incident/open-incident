import Link from "next/link";
import { withTenant } from "@openincident/db";
import {
  AI_CAPABILITIES,
  aiConfigured,
  aiModel,
  aiProviderLabel,
  getAiSettings,
  recentAiCalls,
} from "@openincident/ai";
import { isManagerRole } from "@openincident/config";
import { getT } from "@/i18n/server";
import { requireMember } from "@/lib/session";
import { saveAiSettings } from "./actions";

/**
 * Settings → AI governance, from the design: the functions (each a switch),
 * the data boundaries, the inference provider, and — because a log that
 * cannot be read is not governance — the calls, who made them, on what.
 */
export default async function AiGovernancePage({
  searchParams,
}: {
  searchParams: Promise<{ saved?: string }>;
}) {
  const { tenant, member } = await requireMember();
  const t = await getT();
  const q = await searchParams;
  const manages = isManagerRole(member);
  const data = await withTenant(tenant.id, async (tx) => ({
    settings: await getAiSettings(tx, tenant.id),
    calls: await recentAiCalls(tx, tenant.id, 40),
  }));
  const configured = aiConfigured();
  const Toggle = ({ name, on, disabled }: { name: string; on: boolean; disabled?: boolean }) => (
    <label
      style={{
        display: "inline-flex",
        alignItems: "center",
        cursor: disabled ? "default" : "pointer",
        flex: "none",
      }}
    >
      <input
        type="checkbox"
        name={name}
        defaultChecked={on}
        disabled={disabled}
        className="oi-switch"
        style={{ position: "absolute", opacity: 0, width: 0, height: 0 }}
      />
      <span
        aria-hidden
        className="oi-switch-track"
        style={{
          width: 38,
          height: 22,
          borderRadius: 999,
          background: on ? "var(--brand)" : "var(--line)",
          position: "relative",
          display: "inline-block",
          transition: "background .15s",
          opacity: disabled ? 0.5 : 1,
        }}
      >
        <span
          className="oi-switch-knob"
          style={{
            position: "absolute",
            top: 2.5,
            left: on ? 18 : 3,
            width: 17,
            height: 17,
            borderRadius: "50%",
            background: "#fff",
            boxShadow: "0 1px 3px rgba(0,0,0,.25)",
            transition: "left .15s",
          }}
        />
      </span>
    </label>
  );
  const card: React.CSSProperties = {
    background: "var(--panel)",
    border: "1px solid var(--line)",
    borderRadius: 14,
    padding: "16px 18px",
    display: "flex",
    flexDirection: "column",
    gap: 11,
  };
  const dot = (color: string) => (
    <span
      style={{
        width: 6,
        height: 6,
        borderRadius: "50%",
        background: color,
        flex: "none",
        marginTop: 6,
      }}
    />
  );
  const capOn = (c: (typeof AI_CAPABILITIES)[number]) => data.settings.capabilities[c] !== false;

  return (
    <form
      action={saveAiSettings}
      className="oi-rise"
      style={{ display: "flex", flexDirection: "column", gap: 14, maxWidth: 1060 }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <h1 className="oi-title" style={{ margin: 0 }}>
          {t("settings.ai.title")}
        </h1>
        <span
          style={{
            padding: "2px 9px",
            borderRadius: 999,
            background: configured ? "var(--viol-t)" : "var(--sunk)",
            color: configured ? "var(--viol)" : "var(--ink-3)",
            fontSize: 11,
            fontWeight: 700,
          }}
        >
          {configured ? t("settings.ai.badgeConfigured") : t("settings.ai.badgeUnconfigured")}
        </span>
        <span style={{ flex: 1 }} />
        {q.saved === "1" && (
          <span role="status" style={{ fontSize: 12.5, fontWeight: 600, color: "var(--ok)" }}>
            {t("common.saved")}
          </span>
        )}
        {manages && (
          <button
            type="submit"
            data-testid="ai-save"
            style={{
              height: 32,
              padding: "0 14px",
              borderRadius: 9,
              background: "var(--brand)",
              color: "#fff",
              border: 0,
              fontSize: 12.5,
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            {t("common.save")}
          </button>
        )}
      </div>
      {!configured && <div className="oi-note">{t("settings.ai.unconfiguredNote")}</div>}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 16, alignItems: "flex-start" }}>
        <div
          style={{
            flex: "10 1 420px",
            minWidth: 400,
            display: "flex",
            flexDirection: "column",
            gap: 14,
          }}
        >
          <section style={card}>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <span style={{ fontSize: 14, fontWeight: 600 }}>{t("settings.ai.functions")}</span>
              <span style={{ flex: 1 }} />
              <span style={{ fontSize: 12, color: "var(--ink-3)" }}>
                {data.settings.enabled ? t("settings.ai.masterOn") : t("settings.ai.masterOff")}
              </span>
              <Toggle name="enabled" on={data.settings.enabled} disabled={!manages} />
            </div>
            {AI_CAPABILITIES.map((c) => (
              <div
                key={c}
                data-testid={`ai-cap-${c}`}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  border: "1px solid var(--line)",
                  borderRadius: 11,
                  padding: "10px 13px",
                }}
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 600 }}>{t(`settings.ai.cap.${c}`)}</div>
                  <div style={{ fontSize: 12, color: "var(--ink-3)" }}>
                    {t(`settings.ai.capDesc.${c}`)}
                  </div>
                </div>
                <Toggle name={`cap_${c}`} on={capOn(c)} disabled={!manages} />
              </div>
            ))}
          </section>
          <section style={card}>
            <span style={{ fontSize: 14, fontWeight: 600 }}>{t("settings.ai.boundaries")}</span>
            <div
              style={{
                display: "flex",
                alignItems: "flex-start",
                gap: 10,
                fontSize: 13,
                lineHeight: 1.5,
              }}
            >
              {dot("var(--ok)")}
              <span>
                {t("settings.ai.boundaryInference", {
                  provider: configured ? aiProviderLabel() : "—",
                })}
              </span>
            </div>
            <div
              style={{
                display: "flex",
                alignItems: "flex-start",
                gap: 10,
                fontSize: 13,
                lineHeight: 1.5,
              }}
            >
              {dot("var(--ok)")}
              <span>{t("settings.ai.boundaryTraining")}</span>
            </div>
            <div
              style={{
                display: "flex",
                alignItems: "flex-start",
                gap: 10,
                fontSize: 13,
                lineHeight: 1.5,
              }}
            >
              {dot("var(--ok)")}
              <span>{t("settings.ai.boundaryRedaction")}</span>
            </div>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                fontSize: 13,
                lineHeight: 1.5,
              }}
            >
              {dot("var(--viol)")}
              <span style={{ flex: 1 }}>
                <strong>{t("settings.ai.boundaryPrivate")}</strong>{" "}
                {t("settings.ai.boundaryPrivateNote")}
              </span>
              <Toggle name="privateOptIn" on={data.settings.privateOptIn} disabled={!manages} />
            </div>
            <div
              style={{
                borderTop: "1px solid var(--line-2)",
                paddingTop: 10,
                display: "flex",
                flexDirection: "column",
                gap: 8,
              }}
            >
              <span className="oi-eyebrow">{t("settings.ai.sources")}</span>
              {(
                [
                  ["catalog", true, true],
                  ["incidents", data.settings.sources.incidents, false],
                  ["changeEvents", data.settings.sources.changeEvents, false],
                ] as const
              ).map(([k, on, locked]) => (
                <div
                  key={k}
                  style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 13 }}
                >
                  <span style={{ flex: 1 }}>{t(`settings.ai.source.${k}`)}</span>
                  {locked ? (
                    <span style={{ fontSize: 11.5, color: "var(--ink-3)" }}>
                      {t("settings.ai.sourceAlways")}
                    </span>
                  ) : (
                    <Toggle name={`src_${k}`} on={on} disabled={!manages} />
                  )}
                </div>
              ))}
              <div style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 13 }}>
                <span style={{ flex: 1 }}>{t("settings.ai.source.docs")}</span>
                <Toggle name="src_docs" on={data.settings.sources.docs} disabled={!manages} />
              </div>
            </div>
          </section>
          <section style={card}>
            <div style={{ display: "flex", alignItems: "center" }}>
              <span style={{ fontSize: 14, fontWeight: 600 }}>{t("settings.ai.log")}</span>
              <span style={{ flex: 1 }} />
              <span style={{ fontSize: 12, color: "var(--ink-3)" }}>
                {t("settings.ai.logNote")}
              </span>
            </div>
            <div
              style={{ border: "1px solid var(--line-2)", borderRadius: 10, overflow: "hidden" }}
            >
              {data.calls.map((c) => (
                <div
                  key={c.id}
                  data-testid="ai-call"
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    padding: "7px 10px",
                    borderBottom: "1px solid var(--line-2)",
                    fontSize: 11.5,
                  }}
                >
                  <span
                    style={{
                      fontFamily: "var(--font-mono)",
                      color: "var(--ink-3)",
                      width: 92,
                      flex: "none",
                    }}
                  >
                    {t.fmt.messageTime(c.createdAt)}
                  </span>
                  <span style={{ fontWeight: 600, width: 130, flex: "none" }}>
                    {c.capability === "embed"
                      ? t("settings.ai.embed")
                      : t(`settings.ai.cap.${c.capability}`)}
                  </span>
                  <span
                    style={{
                      flex: 1,
                      minWidth: 0,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                      color: "var(--ink-2)",
                    }}
                  >
                    {c.actorName ?? c.actorKind}
                    {c.incidentNumber ? (
                      <>
                        {" · "}
                        <Link
                          href={`/app/incidents/${c.incidentNumber}`}
                          className="oi-link"
                          style={{ fontFamily: "var(--font-mono)", fontSize: 11 }}
                        >
                          INC-{c.incidentNumber}
                        </Link>
                      </>
                    ) : null}
                  </span>
                  <span style={{ fontFamily: "var(--font-mono)", color: "var(--ink-3)" }}>
                    {c.model}
                  </span>
                  <span style={{ color: "var(--ink-3)", width: 90, textAlign: "right" }}>
                    {c.inputTokens + c.outputTokens} tok · {Math.round(c.durationMs / 100) / 10} s
                  </span>
                  <span
                    style={{
                      padding: "1px 8px",
                      borderRadius: 999,
                      background: c.status === "ok" ? "var(--ok-t)" : "var(--dang-t)",
                      color: c.status === "ok" ? "var(--ok)" : "var(--dang)",
                      fontSize: 10.5,
                      fontWeight: 700,
                    }}
                  >
                    {c.status}
                  </span>
                </div>
              ))}
              {data.calls.length === 0 && (
                <div style={{ padding: 12, fontSize: 12.5, color: "var(--ink-3)" }}>
                  {t("settings.ai.logEmpty")}
                </div>
              )}
            </div>
          </section>
        </div>
        <div
          style={{
            flex: "1 1 280px",
            maxWidth: 330,
            minWidth: 260,
            display: "flex",
            flexDirection: "column",
            gap: 12,
          }}
        >
          <section style={{ ...card, padding: "15px 16px" }}>
            <div className="oi-eyebrow">{t("settings.ai.provider")}</div>
            <select
              name="provider"
              defaultValue={data.settings.provider ?? ""}
              disabled={!manages || !configured}
              className="oi-field"
              style={{
                height: 38,
                padding: "0 12px",
                border: "1px solid var(--line)",
                borderRadius: 9,
                fontSize: 13,
                background: "var(--panel)",
              }}
            >
              <option value="">
                {configured
                  ? t("settings.ai.providerDefault", {
                      provider: aiProviderLabel(),
                      model: aiModel(),
                    })
                  : t("settings.ai.providerNone")}
              </option>
            </select>
            <div style={{ fontSize: 12, color: "var(--ink-3)", lineHeight: 1.5 }}>
              {t("settings.ai.providerNote")}
            </div>
          </section>
          <div
            style={{
              background: "var(--sunk)",
              borderRadius: 14,
              padding: "13px 15px",
              fontSize: 12.5,
              color: "var(--ink-2)",
              lineHeight: 1.55,
            }}
          >
            {t("settings.ai.draftNote")}
          </div>
        </div>
      </div>
    </form>
  );
}
