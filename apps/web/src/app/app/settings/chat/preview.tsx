"use client";

/**
 * "What people see" — the fixed preview of Settings › Slack & Teams: the
 * messages the open section makes the tools show, drawn the way each tool
 * draws them (Slack: square avatar, flat buttons; Teams: round avatar, a
 * coloured bar on the card, pill buttons). It follows the settings live and
 * fills itself with the workspace's own latest incident, alert and Atlas
 * action; only the Acknowledge button acts — on the preview itself.
 */
import type { CSSProperties, ReactNode } from "react";

export type PreviewButton = {
  l: string;
  tone?: "brand" | "ok" | "dang";
  onClick?: () => void;
};

export type PreviewMsg =
  | { sys: string }
  | {
      who?: string;
      app?: boolean;
      av?: string;
      avBg?: string;
      avInk?: string;
      time: string;
      pinned?: boolean;
      edited?: string;
      text?: string;
      mono?: boolean;
      label?: string;
      labelInk?: string;
      bar?: string;
      title?: string;
      fields?: Array<[string, string, string?]>;
      body?: string;
      btns?: PreviewButton[];
      foot?: string;
    };

const btnColors: Record<
  NonNullable<PreviewButton["tone"]> | "none",
  { bd: string; bg: string; ink: string }
> = {
  none: { bd: "var(--line)", bg: "var(--panel)", ink: "var(--ink)" },
  brand: { bd: "var(--brand)", bg: "var(--brand)", ink: "#fff" },
  ok: { bd: "var(--ok)", bg: "var(--ok)", ink: "#fff" },
  dang: { bd: "var(--dang)", bg: "var(--panel)", ink: "var(--dang)" },
};

export function ChatPreview({
  provider,
  where,
  meta,
  msgs,
  note,
  tabs,
  title,
  appLabel,
  pinnedLabel,
}: {
  provider: "slack" | "teams";
  where: string;
  meta: string;
  msgs: PreviewMsg[];
  note: string;
  tabs: Array<{ id: "slack" | "teams"; label: string; on: boolean; onClick: () => void }>;
  title: string;
  appLabel: string;
  pinnedLabel: string;
}) {
  const sl = provider === "slack";
  const cardR = sl ? "8px" : "12px";
  const btnR = sl ? "7px" : "999px";
  return (
    <div
      data-testid="chat-preview"
      style={{
        flex: "1 1 360px",
        maxWidth: 440,
        minWidth: 300,
        position: "sticky",
        top: 12,
        display: "flex",
        flexDirection: "column",
        gap: 8,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span
          style={{
            fontSize: 10.5,
            fontWeight: 700,
            letterSpacing: ".1em",
            textTransform: "uppercase",
            color: "var(--ink-3)",
          }}
        >
          {title}
        </span>
        <span style={{ flex: 1 }} />
        <div
          role="tablist"
          style={{
            display: "flex",
            gap: 2,
            background: "var(--sunk)",
            borderRadius: 8,
            padding: 2,
          }}
        >
          {tabs.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={t.on}
              data-testid={`chat-preview-tab-${t.id}`}
              onClick={t.onClick}
              style={{
                height: 24,
                padding: "0 9px",
                borderRadius: 6,
                border: 0,
                background: t.on ? "var(--panel)" : "transparent",
                boxShadow: t.on ? "0 1px 2px rgba(13,22,28,.12)" : "none",
                display: "flex",
                alignItems: "center",
                fontSize: 11.5,
                fontWeight: 600,
                color: t.on ? "var(--ink)" : "var(--ink-3)",
                cursor: "pointer",
                fontFamily: "inherit",
              }}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>
      <div
        style={{
          background: "var(--panel)",
          border: "1px solid var(--line)",
          borderRadius: "var(--radius-card)",
          boxShadow: "var(--shadow-pop)",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            padding: "10px 14px",
            background: "var(--topbar-dark)",
            color: "#fff",
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
              fontSize: 9.5,
              fontWeight: 700,
              flex: "none",
            }}
          >
            {sl ? "Sl" : "Te"}
          </span>
          <span
            data-testid="chat-preview-where"
            style={{
              fontFamily: "var(--mono)",
              fontSize: 12.5,
              fontWeight: 600,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {where}
          </span>
          <span style={{ flex: 1 }} />
          <span style={{ fontSize: 11, opacity: 0.6, whiteSpace: "nowrap" }}>{meta}</span>
        </div>
        <div
          style={{
            padding: "12px 14px 14px",
            display: "flex",
            flexDirection: "column",
            gap: 12,
            background: "var(--panel)",
            minHeight: 260,
          }}
        >
          {msgs.map((m, i) =>
            "sys" in m ? (
              <div
                key={i}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  fontSize: 11.5,
                  color: "var(--ink-3)",
                }}
              >
                <span style={{ flex: 1, height: 1, background: "var(--line-2)" }} />
                <span style={{ textAlign: "center", maxWidth: "80%" }}>{m.sys}</span>
                <span style={{ flex: 1, height: 1, background: "var(--line-2)" }} />
              </div>
            ) : (
              <Message
                key={i}
                m={m}
                cardR={cardR}
                btnR={btnR}
                avR={sl ? "8px" : "50%"}
                appLabel={appLabel}
                pinnedLabel={pinnedLabel}
              />
            ),
          )}
        </div>
      </div>
      <div style={{ fontSize: 11.5, color: "var(--ink-3)", lineHeight: 1.5 }}>{note}</div>
    </div>
  );
}

function Message({
  m,
  cardR,
  btnR,
  avR,
  appLabel,
  pinnedLabel,
}: {
  m: Exclude<PreviewMsg, { sys: string }>;
  cardR: string;
  btnR: string;
  avR: string;
  appLabel: string;
  pinnedLabel: string;
}) {
  const app = m.app ?? true;
  const hasCard = Boolean(m.title);
  return (
    <div
      style={{
        display: "flex",
        gap: 10,
        alignItems: "flex-start",
        animation: "ohd-rise .14s ease backwards",
      }}
    >
      <span
        style={{
          width: 32,
          height: 32,
          borderRadius: avR,
          background: m.avBg ?? "var(--brand)",
          color: m.avInk ?? "#fff",
          display: "grid",
          placeItems: "center",
          fontSize: 10.5,
          fontWeight: 700,
          flex: "none",
        }}
      >
        {m.av ?? "OI"}
      </span>
      <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 6 }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 6, flexWrap: "wrap" }}>
          <span style={{ fontSize: 13, fontWeight: 700 }}>{m.who ?? "Open Incident"}</span>
          {app && (
            <span
              style={{
                fontSize: 9.5,
                fontWeight: 700,
                letterSpacing: ".05em",
                background: "var(--sunk)",
                color: "var(--ink-3)",
                borderRadius: 4,
                padding: "1px 5px",
              }}
            >
              {appLabel}
            </span>
          )}
          <span style={{ fontSize: 11, color: "var(--ink-3)" }}>{m.time}</span>
          {m.pinned && (
            <span style={{ fontSize: 10.5, fontWeight: 600, color: "var(--wait)" }}>
              {pinnedLabel}
            </span>
          )}
          {m.edited && <span style={{ fontSize: 10.5, color: "var(--ink-3)" }}>· {m.edited}</span>}
        </div>
        {m.text && !hasCard && (
          <div
            style={{
              fontSize: 13,
              lineHeight: 1.5,
              color: "var(--ink)",
              fontFamily: m.mono ? "var(--mono)" : "inherit",
            }}
          >
            {m.text}
          </div>
        )}
        {hasCard && (
          <div
            style={{
              border: "1px solid var(--line)",
              borderRadius: cardR,
              overflow: "hidden",
              background: "var(--panel)",
            }}
          >
            {m.bar && <div style={{ height: 3, background: m.bar }} />}
            <div style={{ padding: "10px 12px", display: "flex", flexDirection: "column", gap: 8 }}>
              {m.label && (
                <span
                  style={{
                    fontSize: 10.5,
                    fontWeight: 700,
                    letterSpacing: ".06em",
                    color: m.labelInk ?? "var(--ink-3)",
                  }}
                >
                  {m.label}
                </span>
              )}
              <div style={{ fontSize: 13.5, fontWeight: 700, lineHeight: 1.35 }}>{m.title}</div>
              {m.fields && m.fields.length > 0 && (
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(2,minmax(0,1fr))",
                    gap: "6px 12px",
                  }}
                >
                  {m.fields.map(([k, v, ink]) => (
                    <div key={k} style={{ minWidth: 0 }}>
                      <div style={{ fontSize: 10.5, fontWeight: 600, color: "var(--ink-3)" }}>
                        {k}
                      </div>
                      <div
                        style={{
                          fontSize: 12.5,
                          fontWeight: 600,
                          color: ink ?? "var(--ink)",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {v}
                      </div>
                    </div>
                  ))}
                </div>
              )}
              {m.body && (
                <div style={{ fontSize: 12.5, lineHeight: 1.5, color: "var(--ink-2)" }}>
                  {m.body}
                </div>
              )}
              {m.btns && m.btns.length > 0 && (
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap", paddingTop: 2 }}>
                  {m.btns.map((b) => (
                    <PreviewBtn key={b.l} b={b} r={btnR} />
                  ))}
                </div>
              )}
              {m.foot && <div style={{ fontSize: 11, color: "var(--ink-3)" }}>{m.foot}</div>}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function PreviewBtn({ b, r }: { b: PreviewButton; r: string }): ReactNode {
  const c = btnColors[b.tone ?? "none"];
  const style: CSSProperties = {
    height: 28,
    padding: "0 11px",
    borderRadius: r,
    border: `1px solid ${c.bd}`,
    background: c.bg,
    color: c.ink,
    display: "flex",
    alignItems: "center",
    fontSize: 12,
    fontWeight: 600,
    cursor: b.onClick ? "pointer" : "default",
    whiteSpace: "nowrap",
    fontFamily: "inherit",
  };
  return b.onClick ? (
    <button type="button" onClick={b.onClick} style={style} data-testid="chat-preview-action">
      {b.l}
    </button>
  ) : (
    <span style={style}>{b.l}</span>
  );
}
