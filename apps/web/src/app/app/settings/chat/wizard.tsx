"use client";

/**
 * "Connect Slack" / "Connect Microsoft Teams" (design V2Chat, "Connect
 * {{wName}}"): three steps driven by the address (?connect=…&step=…), each
 * one real. Slack: authorize through OAuth → configure → a real test
 * message. Teams: the pairing code typed in a channel of the team → configure
 * → a real test card. Next is greyed until the step is truly done.
 */
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import { useFormStatus } from "react-dom";
import { useT } from "@/i18n/client";
import { saveWizardConfig, startPairing, testFromWizard } from "./actions";
import type { ProviderData } from "./data";

export type WizardData = {
  provider: "slack" | "teams";
  step: 1 | 2 | 3;
  env: boolean;
  connected: boolean;
  team: string | null;
  tenant: string | null;
  error: string | null;
  localEndpoint: boolean;
  pairing: { code: string; expiresAt: string } | null;
  appId: string;
  config: ProviderData["config"];
  channels: Array<{ id: string; name: string }>;
  nextNumber: number;
  tested: string | null;
  testError: string | null;
  invalid: boolean;
};

const PAGE = "/app/settings/chat";

const sunkNote: CSSProperties = {
  background: "var(--sunk)",
  borderRadius: 10,
  padding: "10px 12px",
  fontSize: 12,
  lineHeight: 1.5,
  color: "var(--ink-2)",
};
const okBox: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 9,
  background: "var(--ok-t)",
  color: "var(--ok)",
  borderRadius: 10,
  padding: "10px 13px",
  fontSize: 12.5,
  fontWeight: 600,
};
const fieldLabel: CSSProperties = { fontSize: 12, fontWeight: 600 };

/** "4K7Q2M" → "4K7Q-2M": the code as the design prints it, easier to read aloud. */
export function splitCode(code: string): string {
  return code.length === 6 ? `${code.slice(0, 4)}-${code.slice(4)}` : code;
}

function maskId(id: string): string {
  return id.length > 10 ? `${id.slice(0, 4)}…${id.slice(-4)}` : id;
}

function footBtn(kind: "back" | "cancel" | "next", enabled = true): CSSProperties {
  if (kind === "back")
    return {
      height: 34,
      padding: "0 13px",
      border: "1px solid var(--line)",
      borderRadius: 9,
      background: "var(--panel)",
      display: "flex",
      alignItems: "center",
      fontSize: 13,
      fontWeight: 600,
      cursor: "pointer",
      color: "var(--ink)",
      textDecoration: "none",
    };
  if (kind === "cancel")
    return {
      height: 34,
      padding: "0 13px",
      display: "flex",
      alignItems: "center",
      fontSize: 13,
      fontWeight: 600,
      color: "var(--ink-3)",
      cursor: "pointer",
      textDecoration: "none",
    };
  return {
    height: 34,
    padding: "0 15px",
    borderRadius: 9,
    background: enabled ? "var(--brand)" : "var(--line)",
    color: "#fff",
    display: "flex",
    alignItems: "center",
    fontSize: 13,
    fontWeight: 600,
    cursor: enabled ? "pointer" : "default",
    border: 0,
    textDecoration: "none",
    fontFamily: "inherit",
  };
}

function MiniToggle({ on }: { on: boolean }) {
  return (
    <span
      style={{
        position: "relative",
        width: 36,
        height: 20,
        borderRadius: 999,
        background: on ? "var(--brand)" : "var(--line)",
        flex: "none",
      }}
    >
      <span
        style={{
          position: "absolute",
          top: 2,
          left: on ? 18 : 2,
          width: 16,
          height: 16,
          borderRadius: "50%",
          background: "#fff",
          boxShadow: "0 1px 2px rgba(0,0,0,.2)",
        }}
      />
    </span>
  );
}

function SubmitTest({ label }: { label: string }) {
  const t = useT();
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      data-testid="chat-wiz-test"
      disabled={pending}
      className="oi-hover-edge-fill"
      style={{
        width: "100%",
        height: 40,
        border: "1px solid var(--brand-b)",
        borderRadius: 10,
        background: "var(--brand-t)",
        color: "var(--brand)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontSize: 13,
        fontWeight: 600,
        cursor: "pointer",
        fontFamily: "inherit",
      }}
    >
      {pending ? t("chat2.wiz.sending") : label}
    </button>
  );
}

export function ChatWizard({ w }: { w: WizardData }) {
  const t = useT();
  const router = useRouter();
  const sl = w.provider === "slack";
  const N = sl ? "Slack" : "Microsoft Teams";
  const [mode, setMode] = useState(w.config.mode);
  const [prefix, setPrefix] = useState(w.config.prefix);
  const [invite, setInvite] = useState(w.config.autoInvite);
  const [copied, setCopied] = useState(false);
  const [authorizing, setAuthorizing] = useState(false);
  const [checking, setChecking] = useState(false);
  const [checked, setChecked] = useState(false);
  const expired = w.pairing ? new Date(w.pairing.expiresAt).getTime() < Date.now() : true;

  // Waiting for the code: the page looks again by itself every few seconds.
  useEffect(() => {
    if (sl || w.step !== 1 || w.connected || !w.pairing) return;
    const id = setInterval(() => router.refresh(), 5000);
    return () => clearInterval(id);
  }, [sl, w.step, w.connected, w.pairing, router]);
  useEffect(() => {
    setChecking(false);
  }, [w.connected]);

  const close = () => router.push(PAGE, { scroll: false });
  const labels = sl
    ? [t("chat2.wiz.connection"), t("chat2.wiz.configuration"), t("chat2.wiz.test")]
    : [t("chat2.wiz.pairing"), t("chat2.wiz.configuration"), t("chat2.wiz.test")];
  const done1 = w.connected;
  const tested = Boolean(w.tested);
  const announceLabel = w.config.announceName
    ? sl
      ? `#${w.config.announceName}`
      : w.config.announceName
    : sl
      ? t("chat2.wiz.testDm")
      : (w.team ?? "Teams");
  const announceOptions = w.channels.map((c) => ({
    value: `${c.id}|${c.name}`,
    label: sl ? `#${c.name}` : c.name,
    id: c.id,
  }));
  if (w.config.announceId && !announceOptions.some((o) => o.id === w.config.announceId))
    announceOptions.unshift({
      value: `${w.config.announceId}|${w.config.announceName ?? ""}`,
      label: sl ? `#${w.config.announceName ?? ""}` : (w.config.announceName ?? ""),
      id: w.config.announceId,
    });
  const announceValue = w.config.announceId
    ? `${w.config.announceId}|${w.config.announceName ?? ""}`
    : "";
  const nextEnabled = w.step === 1 ? done1 : w.step === 2 ? true : tested;

  let body: ReactNode = null;
  if (w.step === 1 && sl)
    body = (
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <div style={{ fontSize: 13, lineHeight: 1.6, color: "var(--ink-2)" }}>
          {t("chat2.wiz.slackText")}
        </div>
        {done1 ? (
          <div data-testid="slack-authorized" style={okBox}>
            {t("chat2.wiz.authorized", { team: w.team ?? "" })}
          </div>
        ) : (
          <a
            href="/api/slack/oauth/start"
            data-testid="slack-authorize"
            onClick={() => setAuthorizing(true)}
            style={{
              alignSelf: "flex-start",
              height: 40,
              padding: "0 18px",
              borderRadius: 10,
              background: "var(--topbar-dark)",
              color: "#fff",
              display: "flex",
              alignItems: "center",
              gap: 9,
              fontSize: 13.5,
              fontWeight: 600,
              cursor: "pointer",
              textDecoration: "none",
            }}
          >
            <span
              style={{
                width: 20,
                height: 20,
                borderRadius: 6,
                background: "rgba(255,255,255,.14)",
                display: "grid",
                placeItems: "center",
                fontSize: 9,
                fontWeight: 700,
              }}
            >
              Sl
            </span>
            {authorizing ? t("chat2.wiz.authorizing") : t("chat2.wiz.authorize")}
          </a>
        )}
        {w.error && (
          <div role="alert" style={{ fontSize: 12.5, color: "var(--dang)", lineHeight: 1.5 }}>
            {w.localEndpoint
              ? t("settings.integrations.slackLocalEndpoint")
              : t("chat2.wiz.slackError", { error: w.error })}
          </div>
        )}
        <div style={sunkNote}>
          {t("chat2.wiz.selfHosted")}{" "}
          <a
            href="/api/slack/manifest"
            style={{
              fontWeight: 600,
              color: "var(--brand)",
              cursor: "pointer",
              textDecoration: "none",
            }}
          >
            {t("chat2.manifest")}
          </a>
        </div>
      </div>
    );
  else if (w.step === 1)
    body = (
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 9,
            fontSize: 12,
            color: "var(--ink-2)",
          }}
        >
          <span
            style={{
              width: 16,
              height: 16,
              borderRadius: "50%",
              background: "var(--ok-t)",
              color: "var(--ok)",
              display: "grid",
              placeItems: "center",
              fontSize: 9,
              fontWeight: 800,
            }}
          >
            ✓
          </span>
          {t("chat2.wiz.bot")} <span style={{ fontFamily: "var(--mono)" }}>{maskId(w.appId)}</span>
        </div>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "24px minmax(0,1fr)",
            gap: 10,
            alignItems: "start",
          }}
        >
          <span
            style={{
              width: 22,
              height: 22,
              borderRadius: "50%",
              background: "var(--sunk)",
              display: "grid",
              placeItems: "center",
              fontSize: 11,
              fontWeight: 700,
            }}
          >
            1
          </span>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <span style={{ fontSize: 13, fontWeight: 600 }}>{t("chat2.wiz.addApp")}</span>
            <span style={{ fontSize: 12, color: "var(--ink-3)" }}>{t("chat2.wiz.addAppHelp")}</span>
            <a
              href="/api/teams/package"
              data-testid="teams-package"
              className="oi-hover"
              style={{
                alignSelf: "flex-start",
                height: 30,
                padding: "0 12px",
                border: "1px solid var(--line)",
                borderRadius: 8,
                display: "flex",
                alignItems: "center",
                fontSize: 12,
                fontWeight: 600,
                cursor: "pointer",
                color: "var(--ink)",
                textDecoration: "none",
              }}
            >
              {t("chat2.wiz.package")}
            </a>
          </div>
          <span
            style={{
              width: 22,
              height: 22,
              borderRadius: "50%",
              background: "var(--sunk)",
              display: "grid",
              placeItems: "center",
              fontSize: 11,
              fontWeight: 700,
            }}
          >
            2
          </span>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <span style={{ fontSize: 13, fontWeight: 600 }}>{t("chat2.wiz.typeIn")}</span>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                background: "var(--topbar-dark)",
                borderRadius: 10,
                padding: "10px 14px",
              }}
            >
              <code
                data-testid="teams-pairing-code"
                data-code={w.pairing?.code ?? ""}
                style={{
                  flex: 1,
                  fontFamily: "var(--mono)",
                  fontSize: 13,
                  color: "var(--code-blue)",
                }}
              >
                @Open Incident pair {w.pairing && !expired ? splitCode(w.pairing.code) : "······"}
              </code>
              {w.pairing && !expired && (
                <button
                  type="button"
                  onClick={() => {
                    void navigator.clipboard?.writeText(
                      `@Open Incident pair ${splitCode(w.pairing!.code)}`,
                    );
                    setCopied(true);
                  }}
                  style={{
                    fontSize: 11.5,
                    fontWeight: 600,
                    color: "#fff",
                    opacity: 0.85,
                    cursor: "pointer",
                    background: "transparent",
                    border: 0,
                    padding: 0,
                    fontFamily: "inherit",
                  }}
                >
                  {copied ? t("chat2.wiz.copied") : t("chat2.wiz.copy")}
                </button>
              )}
            </div>
            <span style={{ fontSize: 11.5, color: "var(--ink-3)" }}>{t("chat2.wiz.valid")}</span>
          </div>
        </div>
        {done1 ? (
          <div data-testid="teams-paired" style={okBox}>
            {w.tenant
              ? t("chat2.wiz.paired", { team: w.team ?? "", tenant: w.tenant })
              : t("chat2.wiz.pairedNoTenant", { team: w.team ?? "" })}
          </div>
        ) : !w.pairing || expired ? (
          <form
            action={startPairing}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              border: "1px dashed var(--line)",
              borderRadius: 10,
              padding: "10px 13px",
            }}
          >
            <input type="hidden" name="fresh" value="1" />
            <span style={{ flex: 1, fontSize: 12.5, color: "var(--ink-2)" }}>
              {t("chat2.wiz.expired")}
            </span>
            <button
              type="submit"
              data-testid="teams-pair"
              style={{
                height: 30,
                padding: "0 12px",
                borderRadius: 8,
                background: "var(--brand)",
                color: "#fff",
                display: "flex",
                alignItems: "center",
                fontSize: 12,
                fontWeight: 600,
                cursor: "pointer",
                border: 0,
                fontFamily: "inherit",
              }}
            >
              {t("chat2.wiz.newCode")}
            </button>
          </form>
        ) : (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              border: "1px dashed var(--line)",
              borderRadius: 10,
              padding: "10px 13px",
            }}
          >
            <span
              style={{
                width: 8,
                height: 8,
                borderRadius: "50%",
                background: "var(--wait)",
                animation: "oi-pulse 2s infinite",
                flex: "none",
              }}
            />
            <span style={{ flex: 1, fontSize: 12.5, color: "var(--ink-2)" }}>
              {checking
                ? t("chat2.wiz.checking")
                : checked
                  ? t("chat2.wiz.notYet")
                  : t("chat2.wiz.waiting")}
            </span>
            <button
              type="button"
              data-testid="teams-typed"
              onClick={() => {
                setChecking(true);
                router.refresh();
                setTimeout(() => {
                  setChecking(false);
                  setChecked(true);
                }, 1500);
              }}
              className="oi-hover-brand-2"
              style={{
                height: 30,
                padding: "0 12px",
                borderRadius: 8,
                background: "var(--brand)",
                color: "#fff",
                display: "flex",
                alignItems: "center",
                fontSize: 12,
                fontWeight: 600,
                cursor: "pointer",
                border: 0,
                fontFamily: "inherit",
                whiteSpace: "nowrap",
              }}
            >
              {t("chat2.wiz.typed")}
            </button>
          </div>
        )}
      </div>
    );
  else if (w.step === 2)
    body = (
      <form
        id="chat-wiz-config"
        data-testid={sl ? "slack-config" : "teams-config-form"}
        action={saveWizardConfig}
        style={{ display: "flex", flexDirection: "column", gap: 13 }}
      >
        <input type="hidden" name="provider" value={w.provider} />
        <input type="hidden" name="channelMode" value={mode} />
        <input type="hidden" name="autoInvite" value={invite ? "on" : ""} />
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <span style={fieldLabel}>{t("chat2.wiz.channels")}</span>
          <div
            style={{
              display: "flex",
              gap: 2,
              background: "var(--sunk)",
              borderRadius: 9,
              padding: 3,
              alignSelf: "flex-start",
              flexWrap: "wrap",
            }}
          >
            {(
              [
                ["auto", t("chat2.wiz.modeAuto")],
                ["none", t("chat2.wiz.modeNone")],
              ] as const
            ).map(([id, l]) => (
              <button
                key={id}
                type="button"
                aria-pressed={mode === id}
                onClick={() => setMode(id)}
                style={{
                  height: 30,
                  padding: "0 12px",
                  borderRadius: 7,
                  border: 0,
                  background: mode === id ? "var(--panel)" : "transparent",
                  boxShadow: mode === id ? "0 1px 2px rgba(13,22,28,.12)" : "none",
                  display: "flex",
                  alignItems: "center",
                  fontSize: 12.5,
                  fontWeight: mode === id ? 600 : 500,
                  cursor: "pointer",
                  whiteSpace: "nowrap",
                  color: "var(--ink)",
                  fontFamily: "inherit",
                }}
              >
                {l}
              </button>
            ))}
          </div>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1.4fr", gap: 10 }}>
          <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <span style={fieldLabel}>{t("chat2.wiz.prefix")}</span>
            <input
              name="channelPrefix"
              value={prefix}
              required
              pattern="[a-z0-9_\-]{1,20}"
              onChange={(e) =>
                setPrefix(
                  e.target.value
                    .toLowerCase()
                    .replace(/[^a-z0-9_-]/g, "")
                    .slice(0, 20),
                )
              }
              className="oi-field"
              style={{
                height: 36,
                border: "1px solid var(--line)",
                borderRadius: 9,
                padding: "0 10px",
                fontFamily: "var(--mono)",
                fontSize: 12.5,
                outline: "none",
                background: "var(--panel)",
                color: "var(--ink)",
              }}
            />
            <span style={{ fontFamily: "var(--mono)", fontSize: 11, color: "var(--ink-3)" }}>
              → {sl ? "#" : ""}
              {prefix}
              {w.nextNumber}
            </span>
          </label>
          <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <span style={fieldLabel}>{t("chat2.wiz.announce")}</span>
            <select
              name="announce"
              defaultValue={announceValue}
              className="oi-field"
              style={{
                height: 36,
                border: "1px solid var(--line)",
                borderRadius: 9,
                padding: "0 9px",
                fontFamily: "var(--mono)",
                fontSize: 12.5,
                background: "var(--panel)",
                outline: "none",
                color: "var(--ink)",
              }}
            >
              {announceOptions.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
              <option value="">{t("chat2.ann.none")}</option>
            </select>
          </label>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={invite}
          onClick={() => setInvite((v) => !v)}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            cursor: "pointer",
            background: "transparent",
            border: 0,
            padding: 0,
            textAlign: "left",
            color: "var(--ink)",
            fontFamily: "inherit",
          }}
        >
          <MiniToggle on={invite} />
          <span style={{ fontSize: 12.5 }}>{t("chat2.wiz.invite")}</span>
        </button>
        {w.invalid && (
          <div role="alert" style={{ fontSize: 12.5, color: "var(--dang)" }}>
            {t("chat2.wiz.invalid")}
          </div>
        )}
        <div style={sunkNote}>{sl ? t("chat2.wiz.cfgSlack") : t("chat2.wiz.cfgTeams")}</div>
      </form>
    );
  else
    body = (
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <div style={{ fontSize: 12.5, color: "var(--ink-2)", lineHeight: 1.55 }}>
          {t("chat2.wiz.testText")}
        </div>
        {tested ? (
          <div data-testid={sl ? "slack-tested" : "teams-tested"} style={okBox}>
            {sl
              ? t("chat2.wiz.testedSlack", { where: w.tested ?? "" })
              : t("chat2.wiz.testedTeams")}
          </div>
        ) : (
          <form action={testFromWizard}>
            <input type="hidden" name="provider" value={w.provider} />
            <SubmitTest
              label={
                sl
                  ? t("chat2.wiz.testSlack", { where: announceLabel })
                  : t("chat2.wiz.testTeams", { where: announceLabel })
              }
            />
          </form>
        )}
        {w.testError && (
          <div role="alert" style={{ fontSize: 12.5, color: "var(--dang)" }}>
            {t("chat2.wiz.testFailed", { name: N, error: w.testError })}
          </div>
        )}
        <div style={sunkNote}>{sl ? t("chat2.wiz.nextSlack") : t("chat2.wiz.nextTeams")}</div>
      </div>
    );

  const next =
    w.step === 2 ? (
      <button
        type="submit"
        form="chat-wiz-config"
        data-testid="chat-wiz-next"
        className="oi-hover-brand-2"
        style={footBtn("next")}
      >
        {t("chat2.wiz.next")}
      </button>
    ) : nextEnabled ? (
      <Link
        href={w.step === 1 ? `${PAGE}?connect=${w.provider}&step=2` : `${PAGE}?fresh=${w.provider}`}
        scroll={false}
        data-testid={w.step === 3 ? "chat-wiz-finish" : "chat-wiz-next"}
        className="oi-hover-brand-2"
        style={footBtn("next")}
      >
        {w.step === 3 ? t("chat2.wiz.finish") : t("chat2.wiz.next")}
      </Link>
    ) : (
      <span
        aria-disabled
        data-testid={w.step === 3 ? "chat-wiz-finish" : "chat-wiz-next"}
        style={footBtn("next", false)}
      >
        {w.step === 3 ? t("chat2.wiz.finish") : t("chat2.wiz.next")}
      </span>
    );

  return (
    <div
      onClick={close}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 80,
        background: "rgba(13,22,28,.45)",
        display: "flex",
        alignItems: "flex-start",
        justifyContent: "center",
        padding: "8vh 16px 16px",
        overflow: "auto",
      }}
    >
      <div
        role="dialog"
        aria-modal
        aria-label={t("chat2.wiz.title", { name: N })}
        data-testid={sl ? "slack-connect" : "teams-dialog"}
        data-screen-label={`Connect ${N}`}
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "100%",
          maxWidth: 600,
          background: "var(--panel)",
          borderRadius: "var(--radius-modal)",
          boxShadow: "var(--shadow-modal)",
          overflow: "hidden",
          animation: "ohd-rise .16s ease backwards",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 12,
            padding: "16px 20px",
            borderBottom: "1px solid var(--line)",
          }}
        >
          <span
            style={{
              width: 40,
              height: 40,
              borderRadius: 11,
              background: "var(--topbar-dark)",
              color: "#fff",
              display: "grid",
              placeItems: "center",
              fontSize: 13,
              fontWeight: 700,
              flex: "none",
            }}
          >
            {sl ? "Sl" : "Te"}
          </span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontFamily: "var(--title)", fontSize: 17, fontWeight: 600 }}>
              {t("chat2.wiz.title", { name: N })}
            </div>
            <div style={{ fontSize: 11.5, color: "var(--ink-3)" }}>{t("chat2.wiz.sub")}</div>
          </div>
          <Link
            href={PAGE}
            scroll={false}
            aria-label={t("chat2.cancel")}
            className="oi-hover"
            style={{
              width: 30,
              height: 30,
              borderRadius: 8,
              display: "grid",
              placeItems: "center",
              color: "var(--ink-3)",
              cursor: "pointer",
              textDecoration: "none",
            }}
          >
            ✕
          </Link>
        </div>
        <div
          style={{ padding: "16px 20px 18px", display: "flex", flexDirection: "column", gap: 16 }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            {labels.map((l, i) => {
              const n = i + 1;
              const on = n === w.step;
              const done = n < w.step;
              return (
                <div
                  key={l}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 7,
                    flex: n < 3 ? "1 1 auto" : "none",
                  }}
                >
                  <span
                    style={{
                      width: 22,
                      height: 22,
                      borderRadius: "50%",
                      background: on ? "var(--brand)" : done ? "var(--brand-t)" : "var(--sunk)",
                      color: on ? "#fff" : done ? "var(--brand)" : "var(--ink-3)",
                      border: `1px solid ${n <= w.step ? "var(--brand-b)" : "var(--line)"}`,
                      display: "grid",
                      placeItems: "center",
                      fontSize: 11,
                      fontWeight: 700,
                      flex: "none",
                    }}
                  >
                    {done ? "✓" : n}
                  </span>
                  <span
                    style={{
                      fontSize: 12,
                      fontWeight: on ? 600 : 500,
                      color: on ? "var(--ink)" : "var(--ink-3)",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {l}
                  </span>
                  {n < 3 && (
                    <span style={{ flex: 1, height: 1, background: "var(--line)", minWidth: 12 }} />
                  )}
                </div>
              );
            })}
          </div>
          {body}
        </div>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            padding: "12px 20px",
            borderTop: "1px solid var(--line)",
            background: "var(--sunk)",
          }}
        >
          {w.step > 1 && (
            <Link
              href={`${PAGE}?connect=${w.provider}&step=${w.step - 1}`}
              scroll={false}
              className="oi-hover"
              style={footBtn("back")}
            >
              {t("chat2.wiz.back")}
            </Link>
          )}
          <span style={{ flex: 1 }} />
          <Link href={PAGE} scroll={false} style={footBtn("cancel")}>
            {t("chat2.cancel")}
          </Link>
          {next}
        </div>
      </div>
    </div>
  );
}
