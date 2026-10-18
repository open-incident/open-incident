"use client";

/**
 * Settings › Atlas, the design's "Settings — Atlas" screen
 * (V2AtlasGovernance): the kill switch banner, the five levels, the services
 * with their record and cap, the allowed actions, "Always ask a person first",
 * the backtest, the budget and the data line. Every control acts at once and
 * says what it did in the settings toast. The words arrive computed by the
 * server (page.tsx); this file only draws them and wires the controls.
 */
import { useEffect, useState, useTransition, type CSSProperties, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { flash } from "@/components/settings/controls";
import { DialogField, SettingsDialog, dialogInputStyle } from "@/components/settings/dialog";
import {
  changeCap,
  rotateSecret,
  runBacktest,
  saveActionEndpoints,
  saveBudget,
  toggleAction,
  toggleGuardrail,
  toggleKillSwitch,
  type AtlasSettingsResult,
} from "./actions";

export type LevelCard = {
  n: number;
  name: string;
  desc: string;
  gate: string;
  color: string;
  services: string;
};
export type ServiceRow = {
  id: string;
  key: string;
  level: string;
  levelInk: string;
  levelBg: string;
  right: string;
  rightInk: string;
  backtest: string;
  progress: number;
  next: string;
  cap: string;
};
export type ActionRowView = {
  key: string;
  label: string;
  desc: string;
  chip: string;
  chipBg: string;
  chipInk: string;
  level: string;
  on: boolean;
  irreversible: boolean;
  connected: boolean;
  http: { doUrl: string; undoUrl: string; verifyUrl: string };
};
export type LimitRow = {
  key: string;
  label: string;
  desc: string | null;
  on: boolean;
  locked: boolean;
};
export type BacktestCard = {
  available: boolean;
  button: string;
  busy: boolean;
  bars: Array<{ label: string; n: number; color: string; width: string }>;
  right: string | null;
  rest: string | null;
  empty: string | null;
  failed: string | null;
};
export type BudgetCard = {
  spent: string;
  of: string;
  pct: number;
  capPerRun: string;
  median: string;
  exhausted: boolean;
  month: string;
  perRun: string;
};

export type GovernanceView = {
  manages: boolean;
  kill: { on: boolean; title: string; detail: string; button: string };
  levels: { title: string; hint: string; cards: LevelCard[]; downTitle: string; downText: string };
  services: {
    title: string;
    hint: string;
    cols: string[];
    rows: ServiceRow[];
    capOptions: Array<{ value: string; label: string }>;
    empty: string;
  };
  actions: { title: string; hint: string; rows: ActionRowView[]; foot: string };
  limits: { title: string; hint: string; rows: LimitRow[] };
  backtest: { title: string; desc: string; card: BacktestCard };
  budget: { title: string; card: BudgetCard; note: string };
  data: string;
  words: {
    capPerRun: string;
    median: string;
    exhausted: string;
    edit: string;
    month: string;
    perRun: string;
    emptyHelp: string;
    save: string;
    cancel: string;
    endpointTitle: string;
    endpointLead: string;
    doUrl: string;
    undoUrl: string;
    verifyUrl: string;
    verifyHelp: string;
    endpointSave: string;
    secretTitle: string;
    secretHelp: string;
    secretRotate: string;
    connectFirst: string;
    irreversible: string;
    managersOnly: string;
  };
};

const card: CSSProperties = {
  background: "var(--panel)",
  border: "1px solid var(--line)",
  borderRadius: "var(--radius-card)",
  boxShadow: "var(--shadow-card)",
};

function say(r: AtlasSettingsResult) {
  flash(r.message);
}

/** The design's switch: 34 × 19, a 15 px knob. */
function Knob({
  on,
  onClick,
  disabled,
  locked,
  label,
  testId,
}: {
  on: boolean;
  onClick?: () => void;
  disabled?: boolean;
  locked?: boolean;
  label: string;
  testId?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      data-testid={testId}
      onClick={onClick}
      disabled={disabled}
      className="oi-focus"
      style={{
        position: "relative",
        width: 34,
        height: 19,
        borderRadius: 999,
        background: on ? "var(--brand)" : "var(--line)",
        cursor: locked ? "not-allowed" : disabled ? "default" : "pointer",
        flex: "none",
        border: 0,
        padding: 0,
        opacity: locked ? 0.6 : 1,
        transition: "background .15s",
      }}
    >
      <span
        style={{
          position: "absolute",
          top: 2,
          left: on ? 17 : 2,
          width: 15,
          height: 15,
          borderRadius: "50%",
          background: "#fff",
          boxShadow: "0 1px 2px rgba(0,0,0,.2)",
          transition: "left .15s",
        }}
      />
    </button>
  );
}

function CardHeader({ title, hint }: { title: ReactNode; hint: ReactNode }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "baseline",
        gap: 10,
        padding: "13px 18px",
        flexWrap: "wrap",
      }}
    >
      <span style={{ fontSize: 14, fontWeight: 600 }}>{title}</span>
      <span style={{ fontSize: 12, color: "var(--ink-3)" }}>{hint}</span>
    </div>
  );
}

const GRID = "minmax(130px,1fr) 120px 90px 90px minmax(150px,1.2fr) 110px";

export function AtlasGovernance({ v }: { v: GovernanceView }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const run = (fn: () => Promise<AtlasSettingsResult>) =>
    start(async () => {
      say(await fn());
    });

  // A backtest in flight: its progress is read again every few seconds.
  useEffect(() => {
    if (!v.backtest.card.busy) return;
    const id = setInterval(() => router.refresh(), 4000);
    return () => clearInterval(id);
  }, [v.backtest.card.busy, router]);

  const ks = v.kill;
  return (
    <>
      <div
        data-testid="atlas-kill-banner"
        style={{
          display: "flex",
          alignItems: "center",
          gap: 14,
          flexWrap: "wrap",
          background: ks.on ? "var(--dang)" : "var(--topbar-dark)",
          color: "#fff",
          borderRadius: "var(--radius-card)",
          padding: "14px 18px",
        }}
      >
        <span
          style={{
            width: 10,
            height: 10,
            borderRadius: "50%",
            background: ks.on ? "#fff" : "#86EFAC",
            animation: ks.on ? "none" : "oi-pulse 2s infinite",
            flex: "none",
          }}
        />
        <div style={{ flex: "1 1 300px", minWidth: 0 }}>
          <div style={{ fontSize: 14.5, fontWeight: 600 }}>{ks.title}</div>
          <div style={{ fontSize: 12.5, color: "rgba(255,255,255,.72)", marginTop: 2 }}>
            {ks.detail}
          </div>
        </div>
        <button
          type="button"
          data-testid="atlas-kill"
          disabled={pending || !v.manages}
          title={v.manages ? undefined : v.words.managersOnly}
          onClick={() => run(() => toggleKillSwitch(!ks.on))}
          style={{
            height: 36,
            padding: "0 15px",
            borderRadius: 10,
            background: "#fff",
            color: ks.on ? "var(--ink)" : "var(--dang)",
            display: "flex",
            alignItems: "center",
            gap: 8,
            fontSize: 13,
            fontWeight: 700,
            cursor: v.manages ? "pointer" : "default",
            whiteSpace: "nowrap",
            border: 0,
            fontFamily: "inherit",
          }}
        >
          <span
            style={{
              width: 10,
              height: 10,
              borderRadius: 2,
              background: ks.on ? "var(--ink)" : "var(--dang)",
            }}
          />
          {ks.button}
        </button>
      </div>

      <div
        style={{ ...card, padding: "14px 16px", display: "flex", flexDirection: "column", gap: 12 }}
      >
        <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
          <span style={{ fontSize: 15, fontWeight: 600 }}>{v.levels.title}</span>
          <span style={{ fontSize: 12, color: "var(--ink-3)" }}>{v.levels.hint}</span>
        </div>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit,minmax(170px,1fr))",
            gap: 8,
          }}
        >
          {v.levels.cards.map((l) => (
            <div
              key={l.n}
              data-testid={`atlas-level-${l.n}`}
              style={{
                border: "1px solid var(--line)",
                borderTop: `3px solid ${l.color}`,
                borderRadius: 12,
                padding: "11px 12px",
                display: "flex",
                flexDirection: "column",
                gap: 6,
                background: "var(--panel)",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <span
                  style={{
                    fontFamily: "var(--mono)",
                    fontSize: 11,
                    fontWeight: 700,
                    color: l.color,
                  }}
                >
                  L{l.n}
                </span>
                <span style={{ fontSize: 13.5, fontWeight: 700 }}>{l.name}</span>
              </div>
              <div style={{ fontSize: 12, lineHeight: 1.5, color: "var(--ink-2)", flex: 1 }}>
                {l.desc}
              </div>
              <div
                style={{
                  fontSize: 11,
                  lineHeight: 1.45,
                  color: "var(--ink-3)",
                  borderTop: "1px solid var(--line-2)",
                  paddingTop: 6,
                }}
              >
                {l.gate}
              </div>
              <div style={{ fontFamily: "var(--mono)", fontSize: 11, color: "var(--ink-2)" }}>
                {l.services}
              </div>
            </div>
          ))}
        </div>
        <div
          style={{
            display: "flex",
            gap: 10,
            alignItems: "flex-start",
            background: "var(--sunk)",
            borderRadius: 10,
            padding: "10px 12px",
            fontSize: 12.5,
            lineHeight: 1.55,
            color: "var(--ink-2)",
          }}
        >
          <span style={{ fontWeight: 700, color: "var(--dang)", whiteSpace: "nowrap" }}>
            {v.levels.downTitle}
          </span>
          <span>{v.levels.downText}</span>
        </div>
      </div>

      <div style={{ display: "flex", flexWrap: "wrap", gap: 14, alignItems: "flex-start" }}>
        <div
          style={{
            flex: "10 1 460px",
            minWidth: 0,
            display: "flex",
            flexDirection: "column",
            gap: 14,
          }}
        >
          <div style={{ ...card, overflow: "hidden" }} data-testid="atlas-services">
            <CardHeader title={v.services.title} hint={v.services.hint} />
            <div style={{ overflowX: "auto" }}>
              <div style={{ minWidth: 640 }}>
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: GRID,
                    gap: 10,
                    padding: "8px 18px",
                    background: "var(--sunk)",
                    fontSize: 10.5,
                    fontWeight: 700,
                    letterSpacing: ".06em",
                    textTransform: "uppercase",
                    color: "var(--ink-3)",
                  }}
                >
                  {v.services.cols.map((c) => (
                    <span key={c}>{c}</span>
                  ))}
                </div>
                {v.services.rows.length === 0 && (
                  <div
                    style={{
                      padding: "12px 18px",
                      borderTop: "1px solid var(--line-2)",
                      fontSize: 12.5,
                      color: "var(--ink-3)",
                    }}
                  >
                    {v.services.empty}
                  </div>
                )}
                {v.services.rows.map((s) => (
                  <div
                    key={s.id}
                    data-testid={`atlas-service-${s.key}`}
                    style={{
                      display: "grid",
                      gridTemplateColumns: GRID,
                      gap: 10,
                      alignItems: "center",
                      padding: "10px 18px",
                      borderTop: "1px solid var(--line-2)",
                      fontSize: 12.5,
                    }}
                  >
                    <span
                      style={{
                        fontFamily: "var(--mono)",
                        fontWeight: 600,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                      }}
                    >
                      {s.key}
                    </span>
                    <span>
                      <span
                        data-testid="atlas-service-level"
                        style={{
                          fontSize: 11,
                          fontWeight: 700,
                          borderRadius: 999,
                          padding: "2px 9px",
                          background: s.levelBg,
                          color: s.levelInk,
                          whiteSpace: "nowrap",
                        }}
                      >
                        {s.level}
                      </span>
                    </span>
                    <span style={{ fontFamily: "var(--mono)", fontWeight: 600, color: s.rightInk }}>
                      {s.right}
                    </span>
                    <span style={{ fontFamily: "var(--mono)", color: "var(--ink-2)" }}>
                      {s.backtest}
                    </span>
                    <div style={{ display: "flex", flexDirection: "column", gap: 3, minWidth: 0 }}>
                      <div
                        style={{
                          height: 5,
                          borderRadius: 999,
                          background: "var(--sunk)",
                          overflow: "hidden",
                        }}
                      >
                        <div
                          style={{
                            height: "100%",
                            width: `${Math.round(s.progress * 100)}%`,
                            background: "var(--viol)",
                            borderRadius: 999,
                          }}
                        />
                      </div>
                      <span
                        style={{
                          fontSize: 11,
                          color: "var(--ink-3)",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                        title={s.next}
                      >
                        {s.next}
                      </span>
                    </div>
                    <select
                      aria-label={`${v.services.cols[5]} · ${s.key}`}
                      data-testid="atlas-service-cap"
                      value={s.cap}
                      disabled={pending || !v.manages}
                      onChange={(e) => {
                        const value = e.target.value;
                        run(() => changeCap(s.id, value));
                      }}
                      style={{
                        height: 28,
                        border: "1px solid var(--line)",
                        borderRadius: 7,
                        padding: "0 6px",
                        fontSize: 12,
                        background: "var(--panel)",
                        outline: "none",
                        color: "var(--ink)",
                        fontFamily: "inherit",
                      }}
                    >
                      {v.services.capOptions.map((o) => (
                        <option key={o.value} value={o.value}>
                          {o.label}
                        </option>
                      ))}
                    </select>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div style={{ ...card, overflow: "hidden" }} data-testid="atlas-actions">
            <CardHeader title={v.actions.title} hint={v.actions.hint} />
            {v.actions.rows.map((a) => (
              <ActionLine key={a.key} a={a} v={v} pending={pending} run={run} />
            ))}
            <div
              style={{
                padding: "10px 18px",
                borderTop: "1px solid var(--line-2)",
                background: "var(--sunk)",
                fontSize: 12,
                color: "var(--ink-2)",
                lineHeight: 1.5,
              }}
            >
              {v.actions.foot}
              {v.manages && <SecretLine v={v} />}
            </div>
          </div>
        </div>

        <div
          style={{
            flex: "1 1 300px",
            maxWidth: 380,
            minWidth: 280,
            display: "flex",
            flexDirection: "column",
            gap: 14,
          }}
        >
          <div style={{ ...card, overflow: "hidden" }} data-testid="atlas-limits">
            <div style={{ padding: "13px 16px" }}>
              <div style={{ fontSize: 14, fontWeight: 600 }}>{v.limits.title}</div>
              <div style={{ fontSize: 12, color: "var(--ink-3)", marginTop: 2 }}>
                {v.limits.hint}
              </div>
            </div>
            {v.limits.rows.map((g) => (
              <div
                key={g.key}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  padding: "9px 16px",
                  borderTop: "1px solid var(--line-2)",
                }}
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 12.5, fontWeight: 500 }}>{g.label}</div>
                  {g.desc && (
                    <div style={{ fontSize: 11, color: "var(--ink-3)", marginTop: 1 }}>
                      {g.desc}
                    </div>
                  )}
                </div>
                <Knob
                  on={g.on}
                  locked={g.locked}
                  disabled={pending || g.locked || !v.manages}
                  label={g.label}
                  testId={`atlas-limit-${g.key}`}
                  onClick={() => run(() => toggleGuardrail(g.key, !g.on, g.label))}
                />
              </div>
            ))}
          </div>

          <div
            style={{
              ...card,
              padding: "14px 16px",
              display: "flex",
              flexDirection: "column",
              gap: 10,
            }}
            data-testid="atlas-backtest"
          >
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ fontSize: 14, fontWeight: 600 }}>{v.backtest.title}</span>
              <span style={{ flex: 1 }} />
              <button
                type="button"
                data-testid="atlas-backtest-run"
                disabled={
                  pending || v.backtest.card.busy || !v.backtest.card.available || !v.manages
                }
                onClick={() => run(runBacktest)}
                className="oi-hover"
                style={{
                  height: 28,
                  padding: "0 11px",
                  borderRadius: 8,
                  border: "1px solid var(--line)",
                  display: "flex",
                  alignItems: "center",
                  fontSize: 12,
                  fontWeight: 600,
                  cursor:
                    v.backtest.card.available && !v.backtest.card.busy ? "pointer" : "default",
                  background: "var(--panel)",
                  color: v.backtest.card.available ? "var(--ink)" : "var(--ink-3)",
                  fontFamily: "inherit",
                }}
              >
                {v.backtest.card.button}
              </button>
            </div>
            <div style={{ fontSize: 12, color: "var(--ink-3)", lineHeight: 1.5 }}>
              {v.backtest.desc}
            </div>
            {v.backtest.card.bars.length > 0 && (
              <>
                <div
                  style={{
                    display: "flex",
                    height: 10,
                    borderRadius: 999,
                    overflow: "hidden",
                    background: "var(--sunk)",
                  }}
                >
                  {v.backtest.card.bars.map((b) => (
                    <span key={b.label} style={{ width: b.width, background: b.color }} />
                  ))}
                </div>
                {v.backtest.card.bars.map((b) => (
                  <div
                    key={b.label}
                    style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12 }}
                  >
                    <span style={{ width: 9, height: 9, borderRadius: 3, background: b.color }} />
                    <span style={{ flex: 1 }}>{b.label}</span>
                    <span style={{ fontFamily: "var(--mono)", fontWeight: 600 }}>{b.n}</span>
                  </div>
                ))}
              </>
            )}
            {v.backtest.card.right && (
              <div
                data-testid="atlas-backtest-summary"
                style={{
                  fontSize: 12.5,
                  lineHeight: 1.5,
                  borderTop: "1px solid var(--line-2)",
                  paddingTop: 8,
                }}
              >
                <strong>{v.backtest.card.right}</strong>
                {v.backtest.card.rest}
              </div>
            )}
            {v.backtest.card.empty && (
              <div style={{ fontSize: 12, color: "var(--ink-3)", lineHeight: 1.5 }}>
                {v.backtest.card.empty}
              </div>
            )}
            {v.backtest.card.failed && (
              <div style={{ fontSize: 12, color: "var(--dang)", lineHeight: 1.5 }}>
                {v.backtest.card.failed}
              </div>
            )}
          </div>

          <BudgetBlock v={v} pending={pending} run={run} />

          <div
            style={{
              background: "var(--sunk)",
              borderRadius: "var(--radius-card)",
              padding: "12px 14px",
              fontSize: 12,
              lineHeight: 1.55,
              color: "var(--ink-2)",
            }}
          >
            {v.data}
          </div>
        </div>
      </div>
    </>
  );
}

function ActionLine({
  a,
  v,
  pending,
  run,
}: {
  a: ActionRowView;
  v: GovernanceView;
  pending: boolean;
  run: (fn: () => Promise<AtlasSettingsResult>) => void;
}) {
  const [open, setOpen] = useState(false);
  const toggle = () => {
    if (a.irreversible) return flash(v.words.irreversible);
    if (!a.connected && !a.on) return flash(v.words.connectFirst.replace("{action}", a.label));
    run(() => toggleAction(a.key, !a.on, a.label));
  };
  return (
    <div
      data-testid={`atlas-action-${a.key}`}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
        padding: "10px 18px",
        borderTop: "1px solid var(--line-2)",
        flexWrap: "wrap",
        opacity: a.irreversible ? 0.6 : 1,
      }}
    >
      <div style={{ flex: "1 1 240px", minWidth: 0 }}>
        <button
          type="button"
          onClick={() => v.manages && !a.irreversible && setOpen(true)}
          data-testid="atlas-action-name"
          style={{
            all: "unset",
            fontSize: 13,
            fontWeight: 600,
            cursor: v.manages && !a.irreversible ? "pointer" : "default",
          }}
        >
          {a.label}
        </button>
        <div style={{ fontSize: 11.5, color: "var(--ink-3)", marginTop: 1 }}>{a.desc}</div>
      </div>
      <span
        style={{
          fontSize: 11,
          fontWeight: 600,
          borderRadius: 999,
          padding: "2px 9px",
          background: a.chipBg,
          color: a.chipInk,
          whiteSpace: "nowrap",
        }}
      >
        {a.chip}
      </span>
      <span style={{ fontFamily: "var(--mono)", fontSize: 11, color: "var(--ink-2)", width: 52 }}>
        {a.level}
      </span>
      <Knob
        on={a.on}
        locked={a.irreversible}
        disabled={pending || !v.manages}
        label={a.label}
        testId="atlas-action-switch"
        onClick={toggle}
      />
      {open && (
        <SettingsDialog
          open={open}
          onOpenChange={setOpen}
          title={v.words.endpointTitle.replace("{action}", a.label)}
          lead={v.words.endpointLead}
          primary={v.words.endpointSave}
          action={saveActionEndpoints}
          testId="atlas-endpoint-dialog"
        >
          <input type="hidden" name="key" value={a.key} />
          <input type="hidden" name="label" value={a.label} />
          <DialogField label={v.words.doUrl}>
            <input
              name="doUrl"
              defaultValue={a.http.doUrl}
              placeholder="https://"
              style={dialogInputStyle(true)}
            />
          </DialogField>
          <DialogField label={v.words.undoUrl}>
            <input
              name="undoUrl"
              defaultValue={a.http.undoUrl}
              placeholder="https://"
              style={dialogInputStyle(true)}
            />
          </DialogField>
          <DialogField label={v.words.verifyUrl} help={v.words.verifyHelp}>
            <input
              name="verifyUrl"
              defaultValue={a.http.verifyUrl}
              placeholder="https://"
              style={dialogInputStyle(true)}
            />
          </DialogField>
        </SettingsDialog>
      )}
    </div>
  );
}

function SecretLine({ v }: { v: GovernanceView }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 6, flexWrap: "wrap" }}>
      <span style={{ fontWeight: 600 }}>{v.words.secretTitle}</span>
      <span style={{ color: "var(--ink-3)", flex: "1 1 260px" }}>{v.words.secretHelp}</span>
      <SettingsDialog
        trigger={(open) => (
          <button
            type="button"
            onClick={open}
            data-testid="atlas-secret-rotate"
            className="oi-hover"
            style={{
              height: 26,
              padding: "0 10px",
              borderRadius: 7,
              border: "1px solid var(--line)",
              background: "var(--panel)",
              fontSize: 11.5,
              fontWeight: 600,
              cursor: "pointer",
              fontFamily: "inherit",
              color: "var(--ink)",
            }}
          >
            {v.words.secretRotate}
          </button>
        )}
        title={v.words.secretTitle}
        lead={v.words.secretHelp}
        primary={v.words.secretRotate}
        action={rotateSecret}
        testId="atlas-secret-dialog"
      />
    </div>
  );
}

function BudgetBlock({
  v,
  pending,
  run,
}: {
  v: GovernanceView;
  pending: boolean;
  run: (fn: () => Promise<AtlasSettingsResult>) => void;
}) {
  const b = v.budget.card;
  const [edit, setEdit] = useState(false);
  const [month, setMonth] = useState(b.month);
  const [perRun, setPerRun] = useState(b.perRun);
  useEffect(() => {
    setMonth(b.month);
    setPerRun(b.perRun);
  }, [b.month, b.perRun]);
  const field: CSSProperties = { ...dialogInputStyle(true), height: 30, width: 110 };
  return (
    <div
      data-testid="atlas-budget"
      style={{ ...card, padding: "14px 16px", display: "flex", flexDirection: "column", gap: 9 }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ fontSize: 14, fontWeight: 600 }}>{v.budget.title}</span>
        <span style={{ flex: 1 }} />
        {v.manages && !edit && (
          <button
            type="button"
            data-testid="atlas-budget-edit"
            onClick={() => setEdit(true)}
            style={{
              all: "unset",
              fontSize: 12,
              fontWeight: 600,
              color: "var(--brand)",
              cursor: "pointer",
            }}
          >
            {v.words.edit}
          </button>
        )}
      </div>
      <div style={{ display: "flex", alignItems: "baseline", gap: 6, flexWrap: "wrap" }}>
        <span style={{ fontFamily: "var(--title)", fontSize: 24, fontWeight: 600 }}>{b.spent}</span>
        <span style={{ fontSize: 12, color: "var(--ink-3)" }}>{b.of}</span>
      </div>
      <div style={{ height: 6, borderRadius: 999, background: "var(--sunk)", overflow: "hidden" }}>
        <div
          style={{
            height: "100%",
            width: `${Math.min(100, Math.round(b.pct * 100))}%`,
            background: b.exhausted ? "var(--dang)" : "var(--brand)",
            borderRadius: 999,
          }}
        />
      </div>
      {edit ? (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            run(async () => {
              const r = await saveBudget(month, perRun);
              if (r.ok) setEdit(false);
              return r;
            });
          }}
          style={{ display: "flex", flexDirection: "column", gap: 8 }}
        >
          <label
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              fontSize: 12,
              color: "var(--ink-2)",
            }}
          >
            <span>{v.words.month}</span>
            <input
              name="month"
              data-testid="atlas-budget-month"
              value={month}
              onChange={(e) => setMonth(e.target.value)}
              inputMode="decimal"
              style={field}
            />
          </label>
          <label
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              fontSize: 12,
              color: "var(--ink-2)",
            }}
          >
            <span>{v.words.perRun}</span>
            <input
              name="perRun"
              data-testid="atlas-budget-per-run"
              value={perRun}
              onChange={(e) => setPerRun(e.target.value)}
              inputMode="decimal"
              style={field}
            />
          </label>
          <div style={{ fontSize: 11.5, color: "var(--ink-3)" }}>{v.words.emptyHelp}</div>
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
            <button
              type="button"
              onClick={() => setEdit(false)}
              className="oi-hover"
              style={{
                height: 28,
                padding: "0 11px",
                borderRadius: 8,
                border: "1px solid var(--line)",
                background: "var(--panel)",
                fontSize: 12,
                fontWeight: 600,
                cursor: "pointer",
                fontFamily: "inherit",
                color: "var(--ink)",
              }}
            >
              {v.words.cancel}
            </button>
            <button
              type="submit"
              data-testid="atlas-budget-save"
              disabled={pending}
              className="oi-hover-brand-2"
              style={{
                height: 28,
                padding: "0 11px",
                borderRadius: 8,
                border: "1px solid var(--brand)",
                background: "var(--brand)",
                color: "#fff",
                fontSize: 12,
                fontWeight: 600,
                cursor: "pointer",
                fontFamily: "inherit",
              }}
            >
              {v.words.save}
            </button>
          </div>
        </form>
      ) : (
        <>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              fontSize: 12,
              color: "var(--ink-2)",
            }}
          >
            <span>{v.words.capPerRun}</span>
            <span style={{ fontFamily: "var(--mono)", fontWeight: 600 }}>{b.capPerRun}</span>
          </div>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              fontSize: 12,
              color: "var(--ink-2)",
            }}
          >
            <span>{v.words.median}</span>
            <span style={{ fontFamily: "var(--mono)", fontWeight: 600 }}>{b.median}</span>
          </div>
        </>
      )}
      {b.exhausted && (
        <div style={{ fontSize: 11.5, color: "var(--dang)", fontWeight: 600 }}>
          {v.words.exhausted}
        </div>
      )}
      <div style={{ fontSize: 11.5, color: "var(--ink-3)", lineHeight: 1.45 }}>{v.budget.note}</div>
    </div>
  );
}
