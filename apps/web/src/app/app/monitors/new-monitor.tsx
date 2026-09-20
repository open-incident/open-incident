"use client";

/**
 * "+ New monitor", in two steps: what to watch, then where and what it means.
 *
 * The second step shows the criteria the monitor will start with as a sentence
 * rather than a form: a person creating their first monitor should not have to
 * write a rule to get a useful one, and the rule is right there to be read.
 *
 * The ten types are all shown. One this instance cannot perform is greyed,
 * carries the reason and the command that turns it on, and refuses to be
 * created — the reader learns the feature exists and how to have it, rather
 * than that it does not exist.
 */

import { useState } from "react";
import { useT } from "@/i18n/client";
import { createMonitor } from "./actions";
import { JourneyEditor, SecretsEditor } from "./journey-editor";
import { TelemetryEditor } from "./telemetry-editor";
import type { MessageKey } from "@/i18n/dictionaries/en";

type Kind = { id: string; key: string; name: MessageKey; hint: MessageKey; placeholder: string };

const KINDS: Kind[] = [
  {
    id: "http",
    key: "HTTP",
    name: "monitors.typeHttp",
    hint: "monitors.typeHttpHint",
    placeholder: "https://checkout.example.com/health",
  },
  {
    id: "api",
    key: "API",
    name: "monitors.typeApi",
    hint: "monitors.typeApiHint",
    placeholder: "https://api.example.com/v1/ping",
  },
  {
    id: "port",
    key: "PORT",
    name: "monitors.typePort",
    hint: "monitors.typePortHint",
    placeholder: "db.example.com:5432",
  },
  {
    id: "dns",
    key: "DNS",
    name: "monitors.typeDns",
    hint: "monitors.typeDnsHint",
    placeholder: "api.example.com",
  },
  {
    id: "ssl",
    key: "SSL",
    name: "monitors.typeSsl",
    hint: "monitors.typeSslHint",
    placeholder: "example.com",
  },
  {
    id: "domain",
    key: "DOM",
    name: "monitors.typeDomain",
    hint: "monitors.typeDomainHint",
    placeholder: "example.com",
  },
  {
    id: "ping",
    key: "PING",
    name: "monitors.typePing",
    hint: "monitors.typePingHint",
    placeholder: "edge.example.com",
  },
  {
    id: "synthetic",
    key: "SYN",
    name: "monitors.typeSynthetic",
    hint: "monitors.typeSyntheticHint",
    placeholder: "",
  },
  {
    id: "incoming",
    key: "IN",
    name: "monitors.typeIncoming",
    hint: "monitors.typeIncomingHint",
    placeholder: "",
  },
  {
    id: "manual",
    key: "MAN",
    name: "monitors.typeManual",
    hint: "monitors.typeManualHint",
    placeholder: "",
  },
  /*
   * The four that watch what a service says about itself. They are last
   * because they are the ones that need something installed — a workspace
   * with no column store sees them greyed, with the command that turns them
   * on, which is the same treatment the browser runner gets.
   */
  {
    id: "logs",
    key: "LOG",
    name: "monitors.typeLogs",
    hint: "monitors.typeLogsHint",
    placeholder: "",
  },
  {
    id: "traces",
    key: "TRC",
    name: "monitors.typeTraces",
    hint: "monitors.typeTracesHint",
    placeholder: "",
  },
  {
    id: "metrics",
    key: "MET",
    name: "monitors.typeMetrics",
    hint: "monitors.typeMetricsHint",
    placeholder: "",
  },
  {
    id: "exceptions",
    key: "EXC",
    name: "monitors.typeExceptions",
    hint: "monitors.typeExceptionsHint",
    placeholder: "",
  },
];

/** The four whose subject is a query rather than an address. */
const TELEMETRY = new Set(["logs", "traces", "metrics", "exceptions"]);

const CONTROL: React.CSSProperties = {
  height: 38,
  border: "1px solid var(--line)",
  borderRadius: 10,
  padding: "0 12px",
  fontSize: 13.5,
  outline: "none",
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

export function NewMonitor({
  services,
  capabilities,
  initialOpen = false,
  initialType,
  initialQuery,
}: {
  services: string[];
  /** What this instance can run — a type it cannot is shown, greyed, with why. */
  capabilities: Record<string, { ok: boolean; why?: string }>;
  initialOpen?: boolean;
  /** Arriving from an explorer: the type is known and the filter is written. */
  initialType?: string;
  initialQuery?: string;
}) {
  const t = useT();
  const [open, setOpen] = useState(initialOpen);
  /*
   * Somebody arriving from "watch this" has already chosen the type and
   * written the query. Sending them to step one to pick the type they just
   * came from would be the product forgetting what they did a second ago.
   */
  const [kind, setKind] = useState<Kind | null>(
    initialType ? (KINDS.find((k) => k.id === initialType) ?? null) : null,
  );

  const close = () => {
    setOpen(false);
    setKind(null);
  };

  const synthetic = kind?.id === "synthetic";
  const telemetry = !!kind && TELEMETRY.has(kind.id);
  /** Kinds whose address is not typed: it is derived, or there is none. */
  const targetless = kind?.id === "manual" || kind?.id === "incoming" || synthetic || telemetry;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="oi-hover-brand-2"
        data-testid="monitor-new"
        style={{
          height: 32,
          padding: "0 13px",
          borderRadius: 9,
          background: "var(--brand)",
          color: "var(--on-brand)",
          border: 0,
          display: "flex",
          alignItems: "center",
          fontSize: 12.5,
          fontWeight: 600,
          cursor: "pointer",
        }}
      >
        {t("monitors.new")}
      </button>

      {open && (
        <div
          onClick={close}
          style={{
            position: "fixed",
            inset: 0,
            background: "var(--scrim)",
            display: "flex",
            alignItems: "flex-start",
            justifyContent: "center",
            paddingTop: "7vh",
            zIndex: 50,
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="oi-rise-fast"
            role="dialog"
            aria-modal="true"
            data-testid="monitor-form"
            style={{
              width: synthetic ? 880 : telemetry ? 720 : 640,
              maxWidth: "calc(100vw - 32px)",
              background: "var(--panel)",
              borderRadius: "var(--radius-modal)",
              boxShadow: "var(--shadow-modal)",
              overflow: "hidden",
              // A journey of ten steps makes this dialog taller than the
              // screen, and the footer went with it: "Create monitor" was on
              // the page and out of reach. The header and the footer stay put;
              // the middle scrolls.
              display: "flex",
              flexDirection: "column",
              maxHeight: "86vh",
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                padding: "16px 22px",
                borderBottom: "1px solid var(--line)",
                flex: "none",
              }}
            >
              <span style={{ fontFamily: "var(--title)", fontSize: 17, fontWeight: 600 }}>
                {kind ? t("monitors.newStep2", { type: t(kind.name) }) : t("monitors.newStep1")}
              </span>
              <span style={{ flex: 1 }} />
              <span style={{ fontSize: 11.5, color: "var(--ink-3)" }}>
                {t("monitors.stepOf", { step: kind ? 2 : 1 })}
              </span>
              <button
                type="button"
                onClick={close}
                aria-label={t("common.close")}
                style={{
                  marginLeft: 14,
                  width: 28,
                  height: 28,
                  borderRadius: 8,
                  display: "grid",
                  placeItems: "center",
                  color: "var(--ink-3)",
                  cursor: "pointer",
                  border: 0,
                  background: "none",
                }}
              >
                ✕
              </button>
            </div>

            {!kind ? (
              <div
                style={{
                  padding: "18px 22px",
                  display: "grid",
                  gridTemplateColumns: "repeat(4, 1fr)",
                  gap: 8,
                  overflowY: "auto",
                  minHeight: 0,
                }}
              >
                {KINDS.map((k) => {
                  const cap = capabilities[k.id] ?? { ok: true };
                  return (
                    <button
                      key={k.id}
                      type="button"
                      disabled={!cap.ok}
                      onClick={() => cap.ok && setKind(k)}
                      className={cap.ok ? "oi-hover-edge-fill" : undefined}
                      data-testid={`monitor-type-${k.id}`}
                      title={cap.ok ? undefined : t(`monitors.why.${cap.why}` as MessageKey)}
                      style={{
                        display: "flex",
                        flexDirection: "column",
                        gap: 6,
                        padding: "12px 11px",
                        border: "1px solid var(--line)",
                        borderRadius: 12,
                        cursor: cap.ok ? "pointer" : "not-allowed",
                        minHeight: 92,
                        background: cap.ok ? "var(--panel)" : "var(--sunk)",
                        color: "inherit",
                        opacity: cap.ok ? 1 : 0.75,
                        textAlign: "left",
                      }}
                    >
                      <span
                        style={{
                          fontFamily: "var(--mono)",
                          fontSize: 11,
                          fontWeight: 600,
                          color: cap.ok ? "var(--brand)" : "var(--ink-3)",
                        }}
                      >
                        {k.key}
                      </span>
                      <span style={{ fontSize: 12.5, fontWeight: 600, lineHeight: 1.25 }}>
                        {t(k.name)}
                      </span>
                      <span style={{ fontSize: 10.5, color: "var(--ink-3)", lineHeight: 1.35 }}>
                        {cap.ok ? t(k.hint) : t(`monitors.why.${cap.why}` as MessageKey)}
                      </span>
                    </button>
                  );
                })}
              </div>
            ) : (
              <form
                action={createMonitor}
                style={{ display: "flex", flexDirection: "column", minHeight: 0 }}
              >
                <input type="hidden" name="type" value={kind.id} />
                {/*
                  Three kinds have no target to type: a manual monitor is set by
                  hand, an incoming one is a URL the product hands out, and a
                  synthetic one takes its address from the journey's first step.
                */}
                <div
                  style={{
                    padding: "18px 22px",
                    display: "flex",
                    flexDirection: "column",
                    gap: 14,
                    overflowY: "auto",
                    minHeight: 0,
                  }}
                >
                  <div
                    style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) 130px", gap: 10 }}
                  >
                    <label style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                      <span style={LABEL}>
                        {targetless ? t("monitors.fieldName") : t("monitors.fieldTarget")}
                      </span>
                      <input
                        name={targetless ? "name" : "target"}
                        required
                        placeholder={kind.placeholder}
                        className="oi-field"
                        style={{ ...CONTROL, fontFamily: "var(--mono)" }}
                      />
                    </label>
                    <label style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                      <span style={LABEL}>{t("monitors.fieldEvery")}</span>
                      <select
                        name="intervalSeconds"
                        defaultValue={synthetic ? "300" : "60"}
                        style={CONTROL}
                      >
                        {/*
                          A browser run costs a few hundred megabytes and
                          several seconds of CPU. Five minutes is the floor, so
                          the minute is not even offered — and the server
                          refuses it too, for a request that skips this form.
                        */}
                        {!synthetic && <option value="60">{t("monitors.every1m")}</option>}
                        <option value="300">{t("monitors.every5m")}</option>
                        <option value="900">{t("monitors.every15m")}</option>
                        <option value="3600">{t("monitors.every1h")}</option>
                      </select>
                    </label>
                  </div>

                  {!targetless && (
                    <label style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                      <span style={LABEL}>{t("monitors.fieldName")}</span>
                      <input name="name" required className="oi-field" style={CONTROL} />
                    </label>
                  )}

                  {synthetic && (
                    <>
                      <JourneyEditor />
                      <SecretsEditor />
                    </>
                  )}

                  {telemetry && <TelemetryEditor kind={kind.id} initialQuery={initialQuery} />}

                  <label style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                    <span style={LABEL}>{t("monitors.fieldService")}</span>
                    <input
                      name="service"
                      list="monitor-services"
                      placeholder={t("monitors.serviceHint")}
                      className="oi-field"
                      style={{ ...CONTROL, fontFamily: "var(--mono)" }}
                    />
                    <datalist id="monitor-services">
                      {services.map((s) => (
                        <option key={s} value={s} />
                      ))}
                    </datalist>
                  </label>

                  {/*
                    A telemetry monitor has no criteria panel: the sentence
                    above it *is* its rule, and showing a second one would be
                    two answers to "when does this fire".
                  */}
                  {!telemetry && (
                    <div
                      style={{
                        border: "1px solid var(--line)",
                        borderRadius: 12,
                        padding: "12px 14px",
                        display: "flex",
                        flexDirection: "column",
                        gap: 7,
                        background: "var(--sunk)",
                      }}
                    >
                      <div style={LABEL}>{t("monitors.defaultCriteria")}</div>
                      <div style={{ fontSize: 13, lineHeight: 1.6 }}>
                        {t(`monitors.criteriaSentence.${kind.id}` as MessageKey)}
                      </div>
                      {synthetic && (
                        <div style={{ fontSize: 11.5, color: "var(--ink-3)" }}>
                          {t("synthetic.floorNote")}
                        </div>
                      )}
                    </div>
                  )}

                  <Choice
                    label={t("monitors.whoToPage")}
                    hint={t("monitors.whoToPageHint")}
                    name="page"
                    options={[
                      { v: "owner", l: t("monitors.pageOwner") },
                      { v: "me", l: t("monitors.pageMe") },
                      { v: "nobody", l: t("monitors.pageNobody") },
                    ]}
                  />
                  <Choice
                    label={t("monitors.openIncident")}
                    hint={t("monitors.openIncidentHint")}
                    name="incident"
                    options={[
                      { v: "triage", l: t("monitors.incidentTriage") },
                      { v: "urgent", l: t("monitors.incidentUrgent") },
                      { v: "never", l: t("monitors.incidentNever") },
                    ]}
                    defaultValue="urgent"
                  />
                  <Choice
                    label={t("monitors.autoResolve")}
                    hint={t("monitors.autoResolveHint")}
                    name="autoResolve"
                    options={[
                      { v: "on", l: t("common.on") },
                      { v: "off", l: t("common.off") },
                    ]}
                  />
                </div>
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    padding: "14px 22px",
                    borderTop: "1px solid var(--line)",
                    background: "var(--sunk)",
                    flex: "none",
                  }}
                >
                  <button
                    type="button"
                    onClick={() => setKind(null)}
                    style={{
                      fontSize: 12.5,
                      color: "var(--ink-3)",
                      cursor: "pointer",
                      border: 0,
                      background: "none",
                    }}
                  >
                    ‹ {t("monitors.anotherType")}
                  </button>
                  <span style={{ flex: 1 }} />
                  <button
                    type="button"
                    onClick={close}
                    style={{
                      height: 34,
                      padding: "0 13px",
                      border: "1px solid var(--line)",
                      borderRadius: 9,
                      background: "var(--panel)",
                      display: "flex",
                      alignItems: "center",
                      fontSize: 12.5,
                      cursor: "pointer",
                      color: "inherit",
                    }}
                  >
                    {t("common.cancel")}
                  </button>
                  <button
                    type="submit"
                    data-testid="monitor-create"
                    style={{
                      height: 34,
                      padding: "0 16px",
                      borderRadius: 9,
                      background: "var(--brand)",
                      color: "var(--on-brand)",
                      border: 0,
                      display: "flex",
                      alignItems: "center",
                      fontSize: 12.5,
                      fontWeight: 600,
                      cursor: "pointer",
                    }}
                  >
                    {t("monitors.create")}
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}
    </>
  );
}

/** One of the three choices, as the chip row the design uses everywhere. */
function Choice({
  label,
  hint,
  name,
  options,
  defaultValue,
}: {
  label: string;
  hint: string;
  name: string;
  options: { v: string; l: string }[];
  defaultValue?: string;
}) {
  const [value, setValue] = useState(defaultValue ?? options[0]!.v);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
        <span style={{ fontSize: 13, fontWeight: 600 }}>{label}</span>
        <span style={{ fontSize: 11.5, color: "var(--ink-3)" }}>{hint}</span>
      </div>
      <input type="hidden" name={name} value={value} />
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        {options.map((o) => {
          const on = value === o.v;
          return (
            <button
              key={o.v}
              type="button"
              onClick={() => setValue(o.v)}
              style={{
                height: 32,
                padding: "0 12px",
                border: on ? "1.5px solid var(--brand)" : "1px solid var(--line)",
                borderRadius: 9,
                background: on ? "var(--brand-t)" : "var(--panel)",
                color: on ? "var(--brand)" : "var(--ink-2)",
                display: "flex",
                alignItems: "center",
                fontSize: 12.5,
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              {o.l}
            </button>
          );
        })}
      </div>
    </div>
  );
}
