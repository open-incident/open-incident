import Link from "next/link";
import type { CSSProperties, ReactNode } from "react";
import { withTenant } from "@openincident/db";
import { getEdition } from "@openincident/config";
import { decryptSecret } from "@openincident/crypto";
import { daysLeft } from "@openincident/migrate-opsgenie";
import { getT, type Translate } from "@/i18n/server";
import { hasPermission, requireMember } from "@/lib/session";
import { currentOrigin } from "@/lib/tenant";
import {
  goTo,
  importNow,
  readAgain,
  rereadOverrides,
  fixSlot,
  rollbackTeamAction,
  settleOverride,
  startArchive,
  switchTeamAction,
  finishMigration,
  toPreview,
  type CheckState,
} from "./actions";
import {
  STEPS,
  archiveModel,
  connectModel,
  inventoryModel,
  loadBase,
  loadRun,
  peopleModel,
  pctLabel,
  previewModel,
  reachOf,
  shadowDays,
  shadowModel,
  stepLines,
  switchModel,
  type Base,
  type StepKey,
} from "./data";
import {
  ActionButton,
  ConfirmButton,
  ConnectCard,
  CopyUrl,
  IntegrationsCard,
  PersonSelect,
  Poller,
  RepointRow,
  Toaster,
  type IntegrationLine,
} from "./ui";

/**
 * Settings › Migrate from Opsgenie (design V2, "Settings — Migrate from
 * Opsgenie"): seven steps in a left column, the shutdown countdown, and the
 * step on the right. Every step reads and writes for real; nothing pages
 * anybody until a team is switched.
 */
export const dynamic = "force-dynamic";

const card: CSSProperties = {
  background: "var(--panel)",
  border: "1px solid var(--line)",
  borderRadius: "var(--radius-card)",
  boxShadow: "var(--shadow-card)",
};
const rise = "ohd-rise .14s ease backwards";
const brandBtn = (on = true): CSSProperties => ({
  height: 36,
  padding: "0 16px",
  borderRadius: 10,
  background: on ? "var(--brand)" : "var(--line)",
  color: "#fff",
  border: "none",
  display: "flex",
  alignItems: "center",
  fontSize: 13,
  fontWeight: 600,
  cursor: on ? "pointer" : "default",
  fontFamily: "inherit",
  textDecoration: "none",
});
const ghostBtn: CSSProperties = {
  height: 30,
  padding: "0 12px",
  border: "1px solid var(--line)",
  borderRadius: 9,
  display: "flex",
  alignItems: "center",
  fontSize: 12.5,
  fontWeight: 600,
  cursor: "pointer",
  background: "var(--panel)",
  color: "var(--ink)",
  fontFamily: "inherit",
};
const chip = (tone: "ok" | "wait" | "dang" | "open" | "mute"): CSSProperties => {
  const m = {
    ok: ["var(--ok-t)", "var(--ok)"],
    wait: ["var(--wait-t)", "var(--wait)"],
    dang: ["var(--dang-t)", "var(--dang)"],
    open: ["var(--open-t)", "var(--open)"],
    mute: ["var(--sunk)", "var(--ink-2)"],
  }[tone];
  return {
    fontSize: 11,
    fontWeight: 600,
    borderRadius: 999,
    padding: "2px 9px",
    background: m[0],
    color: m[1],
    whiteSpace: "nowrap",
  };
};
const eyebrow: CSSProperties = {
  fontSize: 10,
  fontWeight: 700,
  letterSpacing: ".08em",
  textTransform: "uppercase",
  color: "var(--ink-3)",
};

/** A sentence with bold or italic words in it, from one key. */
function rich(text: string, marks: Record<string, ReactNode>): ReactNode[] {
  const keys = Object.keys(marks);
  if (!keys.length) return [text];
  const re = new RegExp(`(${keys.map((k) => `\\{${k}\\}`).join("|")})`);
  return text.split(re).map((p, i) => {
    const m = p.match(/^\{(\w+)\}$/);
    return m && m[1]! in marks ? <span key={i}>{marks[m[1]!]}</span> : p;
  });
}

export default async function MigratePage({
  searchParams,
}: {
  searchParams: Promise<{ step?: string; toast?: string }>;
}) {
  const { member, tenant } = await requireMember();
  const t = await getT();
  const q = await searchParams;
  if (!hasPermission(member, "settings.platform"))
    return (
      <p data-testid="role-restricted" style={{ fontSize: 13.5, color: "var(--ink-2)" }}>
        {t("migrate.forbidden")}
      </p>
    );

  const run = await loadRun(tenant.id);
  const base = await withTenant(tenant.id, (tx) => loadBase(tx, run));
  const reach = reachOf(run, { matchOk: base.matchOk });
  const requested = STEPS.indexOf((q.step ?? "") as StepKey);
  const unlocked = (i: number) => i <= reach || (base.imported && i <= 6);
  const idx = requested >= 0 && unlocked(requested) ? requested : Math.min(reach, 6);
  const step = STEPS[idx]!;
  const subs = stepLines(t, base);
  const left = daysLeft();

  let body: ReactNode = null;
  let poll = false;
  if (step === "connect") body = <ConnectStep t={t} base={base} />;
  else if (step === "inventory") {
    poll = run?.steps.inventory === "running";
    body = <InventoryStep t={t} base={base} />;
  } else if (step === "people") body = await PeopleStep({ t, base, tenantId: tenant.id });
  else if (step === "preview") body = await PreviewStep({ t, base, tenantId: tenant.id });
  else if (step === "shadow") body = await ShadowStep({ t, base, tenantId: tenant.id });
  else if (step === "switch") body = await SwitchStep({ t, base, tenantId: tenant.id });
  else {
    poll = run?.steps.archive === "running";
    body = <ArchiveStep t={t} base={base} />;
  }

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 16,
        color: "var(--ink)",
        minWidth: 0,
      }}
      data-screen-label="Settings — Migrate from Opsgenie"
    >
      {poll && <Poller />}
      <Toaster initial={q.toast === "imported" ? t("migrate.toast.imported") : null} />
      <div style={{ display: "flex", alignItems: "flex-end", gap: 14, flexWrap: "wrap" }}>
        <div style={{ flex: "1 1 380px", minWidth: 0 }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              fontSize: 12,
              color: "var(--ink-3)",
            }}
          >
            <Link
              href="/app/settings"
              className="oi-hover-ink-brand"
              style={{ color: "inherit", textDecoration: "none" }}
            >
              {t("migrate.crumb.settings")}
            </Link>
            <span>/</span>
            <span>{t("migrate.crumb.platform")}</span>
          </div>
          <h1
            style={{
              margin: "3px 0 0",
              fontFamily: "var(--title)",
              fontSize: 24,
              fontWeight: 600,
              letterSpacing: "-.02em",
              lineHeight: 1.15,
            }}
          >
            {t("migrate.title")}
          </h1>
          <p
            style={{
              margin: "5px 0 0",
              fontSize: 13.5,
              lineHeight: 1.55,
              color: "var(--ink-2)",
              maxWidth: 700,
              textWrap: "pretty",
            }}
          >
            {t("migrate.lead")}
          </p>
        </div>
        <div
          data-testid="migrate-countdown"
          style={{
            display: "flex",
            alignItems: "center",
            gap: 12,
            background: "var(--topbar-dark)",
            color: "#fff",
            borderRadius: 12,
            padding: "10px 16px",
          }}
        >
          <div style={{ display: "flex", flexDirection: "column" }}>
            <span
              style={{
                fontSize: 10,
                fontWeight: 700,
                letterSpacing: ".1em",
                textTransform: "uppercase",
                color: "rgba(255,255,255,.55)",
              }}
            >
              {t("migrate.shutdown")}
            </span>
            <span style={{ fontSize: 13, fontWeight: 600 }}>{t("migrate.shutdownDate")}</span>
          </div>
          <span
            style={{
              fontFamily: "var(--title)",
              fontSize: 30,
              fontWeight: 600,
              letterSpacing: "-.02em",
              lineHeight: 1,
            }}
          >
            {t.fmt.number(left)}
          </span>
          <span style={{ fontSize: 12, color: "rgba(255,255,255,.7)", lineHeight: 1.2 }}>
            {t("migrate.days", { count: left })}
            <br />
            {t("migrate.left")}
          </span>
        </div>
      </div>

      <div style={{ display: "flex", flexWrap: "wrap", gap: 16, alignItems: "flex-start" }}>
        <nav
          aria-label={t("migrate.title")}
          style={{ flex: "0 0 230px", position: "sticky", top: 12, ...card, padding: 8 }}
        >
          {STEPS.map((s, i) => {
            const on = i === idx;
            const done = i < reach && !on;
            const ok = unlocked(i);
            const inner = (
              <>
                <span
                  style={{
                    width: 22,
                    height: 22,
                    borderRadius: "50%",
                    background: on ? "var(--brand)" : done ? "var(--ok)" : "var(--panel)",
                    color: on || done ? "#fff" : "var(--ink-3)",
                    border: on || done ? "none" : "1.5px solid var(--line)",
                    display: "grid",
                    placeItems: "center",
                    fontSize: 11,
                    fontWeight: 700,
                    flex: "none",
                  }}
                >
                  {done ? "✓" : i + 1}
                </span>
                <div style={{ minWidth: 0 }}>
                  <div
                    style={{
                      fontSize: 13,
                      fontWeight: on ? 600 : 500,
                      color: on ? "var(--brand)" : "var(--ink)",
                    }}
                  >
                    {t(`migrate.step.${s}`)}
                  </div>
                  <div
                    style={{ fontSize: 11, color: "var(--ink-3)", marginTop: 1, lineHeight: 1.35 }}
                  >
                    {subs[s]}
                  </div>
                </div>
              </>
            );
            const style: CSSProperties = {
              display: "flex",
              alignItems: "flex-start",
              gap: 10,
              padding: "9px 10px",
              borderRadius: 10,
              background: on ? "var(--brand-t)" : "transparent",
              opacity: ok ? 1 : 0.45,
              textDecoration: "none",
              color: "inherit",
            };
            return ok ? (
              <Link
                key={s}
                href={`/app/settings/migrate?step=${s}`}
                data-testid={`migrate-step-${s}`}
                aria-current={on ? "step" : undefined}
                className={on ? undefined : "oi-hover"}
                style={{ ...style, cursor: "pointer" }}
              >
                {inner}
              </Link>
            ) : (
              <div
                key={s}
                data-testid={`migrate-step-${s}`}
                aria-disabled
                style={{ ...style, cursor: "default" }}
              >
                {inner}
              </div>
            );
          })}
          <div
            style={{
              margin: "6px 10px 4px",
              paddingTop: 9,
              borderTop: "1px solid var(--line-2)",
              fontSize: 11,
              color: "var(--ink-3)",
              lineHeight: 1.45,
            }}
          >
            {t("migrate.navNote")}
          </div>
        </nav>
        <div
          style={{
            flex: "10 1 520px",
            minWidth: 0,
            display: "flex",
            flexDirection: "column",
            gap: 12,
          }}
          data-testid={`migrate-at-${step}`}
        >
          {body}
        </div>
      </div>
    </div>
  );
}

/* ---------- 1 · Connect ---------- */

function ConnectStep({ base }: { t: Translate; base: Base }) {
  const m = connectModel(base.run);
  const keys = ["reach", "read", "config", "account"] as const;
  const stored: CheckState | null =
    base.run && Object.keys(m.checks).length === 4 && m.saved
      ? {
          checked: true,
          ok: keys.every((k) => m.checks[k]?.ok),
          hint: keys.every((k) => m.checks[k]?.ok) ? "ok" : "idle",
          rows: keys.map((k) => ({
            key: k,
            ok: Boolean(m.checks[k]?.ok),
            detail: m.checks[k]?.detail ?? "",
            ...(k === "account"
              ? { name: m.account ?? undefined, teams: m.teamsVisible ?? 0 }
              : {}),
          })),
        }
      : null;
  return <ConnectCard region={m.region} saved={m.saved} stored={stored} />;
}

/* ---------- 2 · Inventory ---------- */

function InventoryStep({ t, base }: { t: Translate; base: Base }) {
  const run = base.run!;
  const reading = run.steps.inventory === "running";
  const m = inventoryModel(base);
  const c = m?.counters ?? {};
  const now = new Date();
  const switched = base.switches.some((s) => s.state === "switched");
  const sub = reading
    ? t("migrate.inv.reading", { pct: run.progress })
    : run.inventoryReadAt
      ? t(switched ? "migrate.inv.readSwitched" : "migrate.inv.read", {
          ago: t.fmt.relative(run.inventoryReadAt, now),
        })
      : t("migrate.sub.inventoryNone");
  const pct = reading ? run.progress : run.steps.inventory === "done" ? 100 : run.progress;
  const month = m?.oldest
    ? m.oldest.toLocaleDateString(t.locale.tag, {
        month: "short",
        year: "numeric",
        timeZone: "UTC",
      })
    : null;
  const tiles = [
    [
      t("migrate.inv.users"),
      c.users,
      c.blockedScheduled
        ? t("migrate.inv.blocked", { count: c.blockedScheduled })
        : t("migrate.inv.noneBlocked"),
    ],
    [t("migrate.inv.teams"), c.teams, m?.teams.join(" · ") ?? ""],
    [
      t("migrate.inv.schedules"),
      c.schedules,
      t("migrate.inv.rotations", { rotations: c.rotations ?? 0, overrides: c.overrides ?? 0 }),
    ],
    [
      t("migrate.inv.escalations"),
      c.escalations,
      t("migrate.inv.repeat", { count: c.repeating ?? 0 }),
    ],
    [t("migrate.inv.rules"), c.routingRules, t("migrate.inv.acrossTeams", { count: c.teams ?? 0 })],
    [
      t("migrate.inv.integrations"),
      c.integrations,
      t("migrate.inv.activity", { live: c.live ?? 0, quiet: c.quiet ?? 0, dead: c.silent ?? 0 }),
    ],
    [t("migrate.inv.heartbeats"), c.heartbeats, m?.heartbeats.join(" · ") || t("migrate.inv.none")],
    [t("migrate.inv.alerts"), c.alerts, month ? t("migrate.inv.since", { month }) : ""],
  ] as const;
  const shortRelative = new Intl.RelativeTimeFormat(t.locale.tag, {
    numeric: "auto",
    style: "short",
  });
  const ago = (d: Date) => {
    const diff = Math.max(0, now.getTime() - d.getTime());
    if (diff < 3_600_000)
      return shortRelative.format(-Math.max(1, Math.floor(diff / 60_000)), "minute");
    if (diff < 86_400_000) return shortRelative.format(-Math.floor(diff / 3_600_000), "hour");
    return shortRelative.format(-Math.floor(diff / 86_400_000), "day");
  };
  const lines: IntegrationLine[] = (m?.rows ?? []).map((r) => ({
    key: r.key,
    glyph: r.glyph,
    name: r.name,
    sub: r.team
      ? t("migrate.int.team", { type: r.type, team: r.team })
      : t("migrate.int.noTeam", { type: r.type }),
    status: r.status,
    statusLabel:
      r.status === "live"
        ? t("migrate.int.live")
        : r.status === "quiet"
          ? t("migrate.int.quiet")
          : t("migrate.int.silent"),
    last:
      r.last.kind === "never"
        ? t("migrate.int.never")
        : r.last.kind === "every"
          ? t("migrate.int.every", {
              interval: r.last.interval,
              unit: t(`migrate.int.unit.${r.last.unit}` as "migrate.int.unit.minutes"),
            })
          : ago(r.last.at),
    target:
      r.target.kind === "source"
        ? t("migrate.int.to.source", { tool: r.target.tool })
        : r.target.kind === "genieKey"
          ? t("migrate.int.to.genieKey")
          : r.target.kind === "heartbeat"
            ? t("migrate.int.to.heartbeat")
            : r.target.kind === "skipUnless"
              ? t("migrate.int.to.skipUnless")
              : t("migrate.int.to.skip"),
  }));
  const ready = run.steps.inventory === "done";
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12, animation: rise }}>
      <div
        style={{ ...card, padding: "16px 18px", display: "flex", flexDirection: "column", gap: 10 }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <span style={{ fontSize: 16, fontWeight: 600 }}>{t("migrate.inv.title")}</span>
          <span data-testid="migrate-inv-sub" style={{ fontSize: 12, color: "var(--ink-3)" }}>
            {sub}
          </span>
          <span style={{ flex: 1 }} />
          {!reading && !switched && (
            <ActionButton
              testId="migrate-read-again"
              action={readAgain}
              style={ghostBtn}
              className="oi-hover"
            >
              {t("migrate.inv.again")}
            </ActionButton>
          )}
        </div>
        <div
          style={{ height: 6, borderRadius: 999, background: "var(--sunk)", overflow: "hidden" }}
        >
          <div
            data-testid="migrate-inv-progress"
            style={{
              height: "100%",
              width: `${pct}%`,
              background: "var(--brand)",
              borderRadius: 999,
              transition: "width .3s",
            }}
          />
        </div>
        {run.error && !reading && run.steps.inventory !== "done" && (
          <div role="alert" style={{ fontSize: 12.5, color: "var(--dang)" }}>
            {t("migrate.inv.failed", { error: run.error })}
          </div>
        )}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit,minmax(130px,1fr))",
            gap: 1,
            background: "var(--line-2)",
            border: "1px solid var(--line-2)",
            borderRadius: 11,
            overflow: "hidden",
          }}
        >
          {tiles.map(([l, v, s]) => (
            <div
              key={l}
              style={{ background: "var(--panel)", padding: "10px 13px" }}
              data-testid="migrate-counter"
            >
              <div style={eyebrow}>{l}</div>
              <div
                style={{ fontFamily: "var(--title)", fontSize: 21, fontWeight: 600, marginTop: 2 }}
              >
                {ready && v !== undefined ? t.fmt.number(v) : "…"}
              </div>
              <div style={{ fontSize: 11, color: "var(--ink-3)" }}>{ready ? s : ""}</div>
            </div>
          ))}
        </div>
      </div>
      {ready && <IntegrationsCard rows={lines} />}
      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
        <form action={goTo.bind(null, "people")}>
          <button
            type="submit"
            data-testid="migrate-to-people"
            disabled={!ready}
            className={ready ? "oi-hover-brand-2" : undefined}
            style={brandBtn(ready)}
          >
            {t("migrate.toMatch")}
          </button>
        </form>
      </div>
    </div>
  );
}

/* ---------- 3 · Match people ---------- */

async function PeopleStep({ t, base, tenantId }: { t: Translate; base: Base; tenantId: string }) {
  const m = await withTenant(tenantId, (tx) => peopleModel(tx, tenantId, t, base));
  const left = base.translations.length - base.confirmed;
  const hint = base.matchOk
    ? t("migrate.match.ready")
    : [
        base.orphans ? t("migrate.match.people") : "",
        left ? t("migrate.match.translations", { count: left }) : "",
      ]
        .filter(Boolean)
        .join(" · ");
  const chipFor = (p: (typeof m.rows)[number]) =>
    p.kind === "matched"
      ? { l: t("migrate.people.matched"), tone: "ok" as const }
      : p.resolved
        ? { l: t("migrate.people.resolved"), tone: "ok" as const }
        : p.kind === "conflict"
          ? { l: t("migrate.people.conflict"), tone: "wait" as const }
          : p.kind === "blocked"
            ? { l: t("migrate.people.blocked"), tone: "wait" as const }
            : p.kind === "missing"
              ? { l: t("migrate.people.missing"), tone: "wait" as const }
              : { l: t("migrate.people.unscheduled"), tone: "mute" as const };
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12, animation: rise }}>
      <div style={{ ...card, overflow: "hidden" }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            padding: "13px 18px",
            flexWrap: "wrap",
          }}
        >
          <div style={{ flex: "1 1 260px" }}>
            <div style={{ fontSize: 16, fontWeight: 600 }}>{t("migrate.people.title")}</div>
            <div style={{ fontSize: 12, color: "var(--ink-3)", marginTop: 1 }}>
              {t("migrate.people.sub")}
            </div>
          </div>
          <span
            data-testid="migrate-orphans"
            style={{ ...chip(base.orphans ? "wait" : "ok"), fontSize: 11.5, padding: "3px 10px" }}
          >
            {base.orphans
              ? t("migrate.people.orphans", { count: base.orphans })
              : t("migrate.people.noOrphan")}
          </span>
        </div>
        <div style={{ overflowX: "auto" }}>
          <div style={{ minWidth: 580 }}>
            {m.rows.map((p) => {
              const c = chipFor(p);
              return (
                <div
                  key={p.id}
                  data-testid="migrate-person"
                  data-kind={p.kind}
                  style={{
                    display: "grid",
                    gridTemplateColumns: "minmax(170px,1fr) 22px minmax(180px,1.1fr) 130px",
                    gap: 12,
                    alignItems: "center",
                    padding: "9px 18px",
                    borderTop: "1px solid var(--line-2)",
                    fontSize: 12.5,
                  }}
                >
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontWeight: 600 }}>{p.name}</div>
                    <div
                      style={{
                        fontFamily: "var(--mono)",
                        fontSize: 11,
                        color: "var(--ink-3)",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {p.email}
                    </div>
                  </div>
                  <span style={{ color: "var(--ink-3)" }}>→</span>
                  <div style={{ minWidth: 0 }}>
                    {p.kind === "matched" ? (
                      <span style={{ fontWeight: 500 }}>{p.oiName}</span>
                    ) : (
                      <PersonSelect id={p.id} value={p.value} options={p.options} />
                    )}
                    {p.note && (
                      <div
                        style={{
                          fontSize: 11,
                          color: "var(--ink-3)",
                          marginTop: 2,
                          lineHeight: 1.35,
                        }}
                      >
                        {p.note}
                      </div>
                    )}
                  </div>
                  <span>
                    <span style={chip(c.tone)}>{c.l}</span>
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      </div>
      {m.translations.length > 0 && (
        <div style={{ ...card, overflow: "hidden" }}>
          <div style={{ padding: "13px 18px" }}>
            <div style={{ fontSize: 14, fontWeight: 600 }}>{t("migrate.tr.title")}</div>
            <div style={{ fontSize: 12, color: "var(--ink-3)", marginTop: 1 }}>
              {t("migrate.tr.sub")}
            </div>
          </div>
          {m.translations.map((x) => (
            <div
              key={x.kind}
              data-testid={`migrate-translation-${x.kind}`}
              style={{
                display: "flex",
                gap: 14,
                padding: "12px 18px",
                borderTop: "1px solid var(--line-2)",
                flexWrap: "wrap",
                alignItems: "flex-start",
              }}
            >
              <div style={{ flex: "1 1 220px", minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 600 }}>{t(`migrate.tr.${x.kind}`)}</div>
                <div
                  style={{ fontSize: 11.5, color: "var(--ink-3)", marginTop: 2, lineHeight: 1.45 }}
                >
                  {t(`migrate.tr.${x.kind}D`)}
                </div>
              </div>
              <div
                style={{
                  flex: "1 1 280px",
                  display: "grid",
                  gridTemplateColumns: "1fr 1fr",
                  gap: 8,
                }}
              >
                <div style={{ background: "var(--sunk)", borderRadius: 9, padding: "7px 10px" }}>
                  <div
                    style={{
                      fontSize: 10,
                      fontWeight: 700,
                      letterSpacing: ".08em",
                      color: "var(--ink-3)",
                    }}
                  >
                    {t("migrate.tr.opsgenie")}
                  </div>
                  <div
                    style={{
                      fontFamily: "var(--mono)",
                      fontSize: 12,
                      marginTop: 2,
                      lineHeight: 1.45,
                    }}
                  >
                    {x.a}
                  </div>
                </div>
                <div style={{ background: "var(--brand-t)", borderRadius: 9, padding: "7px 10px" }}>
                  <div
                    style={{
                      fontSize: 10,
                      fontWeight: 700,
                      letterSpacing: ".08em",
                      color: "var(--brand)",
                    }}
                  >
                    {t("migrate.tr.oi")}
                  </div>
                  <div
                    style={{
                      fontFamily: "var(--mono)",
                      fontSize: 12,
                      marginTop: 2,
                      lineHeight: 1.45,
                    }}
                  >
                    {x.b}
                  </div>
                </div>
              </div>
              <ConfirmButton kind={x.kind} confirmed={x.confirmed} />
            </div>
          ))}
        </div>
      )}
      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", alignItems: "center" }}>
        <span data-testid="migrate-match-hint" style={{ fontSize: 12, color: "var(--ink-3)" }}>
          {hint}
        </span>
        <form action={toPreview}>
          <button
            type="submit"
            data-testid="migrate-to-preview"
            disabled={!base.matchOk}
            className={base.matchOk ? "oi-hover-brand-2" : undefined}
            style={brandBtn(base.matchOk)}
          >
            {t("migrate.toPreview")}
          </button>
        </form>
      </div>
    </div>
  );
}

/* ---------- 4 · Preview ---------- */

function slotLabel(t: Translate, start: Date, end: Date): string {
  const tz = t.timeZone;
  const day = (d: Date) =>
    d.toLocaleDateString(t.locale.tag, {
      weekday: "short",
      day: "numeric",
      month: "short",
      timeZone: tz,
    });
  const sameDay = day(start) === day(end);
  return sameDay
    ? `${day(start)}, ${t.fmt.time(start, tz)} – ${t.fmt.time(end, tz)}`
    : `${day(start)}, ${t.fmt.time(start, tz)} – ${day(end)}, ${t.fmt.time(end, tz)}`;
}

async function PreviewStep({ t, base, tenantId }: { t: Translate; base: Base; tenantId: string }) {
  const m = await withTenant(tenantId, (tx) => previewModel(tx, tenantId, t, base));
  const c = m.counts;
  const created = [
    [c.members, "members"],
    [c.teams, "teams"],
    [c.schedules, "schedules"],
    [c.rotations, "rotations"],
    [c.policies, "policies"],
    [c.rules, "rules"],
    [c.sources, "sources"],
    [c.monitors, "monitors"],
  ] as const;
  const canImport = base.imported || m.open === 0;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12, animation: rise }}>
      <div
        style={{ ...card, padding: "16px 18px", display: "flex", flexDirection: "column", gap: 10 }}
      >
        <div style={{ fontSize: 16, fontWeight: 600 }}>{t("migrate.create.title")}</div>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {created.map(([n, k]) => (
            <span
              key={k}
              data-testid={`migrate-create-${k}`}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 7,
                height: 30,
                padding: "0 12px",
                borderRadius: 9,
                background: "var(--sunk)",
                fontSize: 12.5,
              }}
            >
              <strong style={{ fontFamily: "var(--mono)" }}>{n}</strong>
              {t(`migrate.create.${k}`, { count: n })}
            </span>
          ))}
        </div>
        <div style={{ fontSize: 12, color: "var(--ink-3)" }}>
          {base.imported && base.run?.shadowStartedAt
            ? t("migrate.create.done", { ago: t.fmt.relative(base.run.shadowStartedAt) })
            : t("migrate.create.note")}
        </div>
      </div>
      <div style={{ ...card, overflow: "hidden" }}>
        <div style={{ padding: "13px 18px" }}>
          <div style={{ fontSize: 14, fontWeight: 600 }}>{t("migrate.sim.title")}</div>
          <div style={{ fontSize: 12, color: "var(--ink-3)", marginTop: 1 }}>
            {t("migrate.sim.sub")}
          </div>
        </div>
        {m.schedules.map((s) => {
          const tone = s.count ? "wait" : "ok";
          const label = s.count
            ? t("migrate.sim.differs", { count: s.count })
            : s.noTimeline
              ? t("migrate.sim.noTimeline")
              : s.fixed
                ? t("migrate.sim.fixed")
                : t("migrate.sim.same");
          const d = s.first;
          const nobody = t("migrate.sim.nobody");
          return (
            <div
              key={s.id}
              data-testid="migrate-sim"
              data-differs={s.count}
              style={{ borderTop: "1px solid var(--line-2)" }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  padding: "10px 18px",
                  flexWrap: "wrap",
                }}
              >
                <span style={{ fontSize: 13, fontWeight: 600, flex: "1 1 200px" }}>{s.name}</span>
                <span style={{ fontSize: 11.5, color: "var(--ink-3)" }}>{s.meta}</span>
                <span style={chip(s.noTimeline ? "mute" : tone)}>{label}</span>
              </div>
              {d && (
                <div
                  style={{
                    margin: "0 18px 12px",
                    border: "1px solid var(--wait)",
                    background: "var(--wait-t)",
                    borderRadius: 10,
                    padding: "10px 12px",
                    display: "flex",
                    gap: 12,
                    alignItems: "center",
                    flexWrap: "wrap",
                  }}
                >
                  <div
                    style={{
                      flex: "1 1 280px",
                      fontSize: 12.5,
                      lineHeight: 1.5,
                      color: "var(--ink)",
                    }}
                  >
                    {rich(t("migrate.sim.slot", { when: "{when}", og: "{og}", oi: "{oi}" }), {
                      when: <strong>{slotLabel(t, d.start, d.end)}</strong>,
                      og: <strong>{d.og.join(", ") || nobody}</strong>,
                      oi: <strong>{d.oi.join(", ") || nobody}</strong>,
                    })}
                    <div style={{ fontSize: 11.5, color: "var(--ink-2)" }}>
                      {d.cause === "pending"
                        ? t("migrate.sim.whyPending", { name: d.pendingName ?? nobody })
                        : d.cause === "override"
                          ? t("migrate.sim.whyOverride")
                          : t("migrate.sim.whyLossy")}
                    </div>
                  </div>
                  {d.cause === "override" ? (
                    <ActionButton
                      testId="migrate-fix"
                      action={rereadOverrides.bind(null, [s.id])}
                      style={fixBtn}
                    >
                      {t("migrate.sim.overrides")}
                    </ActionButton>
                  ) : d.hand ? (
                    <ActionButton
                      testId="migrate-fix"
                      action={fixSlot.bind(null, {
                        scheduleId: s.id,
                        partKey: d.partKey,
                        start: d.start.toISOString(),
                        end: d.end.toISOString(),
                        memberId: d.hand.id,
                      })}
                      style={fixBtn}
                    >
                      {d.cause === "pending"
                        ? t("migrate.sim.hand", { name: d.hand.name.split(" ")[0]! })
                        : t("migrate.sim.copy")}
                    </ActionButton>
                  ) : null}
                </div>
              )}
            </div>
          );
        })}
      </div>
      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", alignItems: "center" }}>
        <span data-testid="migrate-sim-hint" style={{ fontSize: 12, color: "var(--ink-3)" }}>
          {m.open ? t("migrate.sim.left", { count: m.open }) : t("migrate.sim.none")}
        </span>
        {base.imported ? (
          <form action={goTo.bind(null, "shadow")}>
            <button
              type="submit"
              data-testid="migrate-import"
              className="oi-hover-brand-2"
              style={brandBtn(true)}
            >
              {t("migrate.import")}
            </button>
          </form>
        ) : (
          <ActionButton
            testId="migrate-import"
            action={importNow}
            disabled={!canImport}
            className={canImport ? "oi-hover-brand-2" : undefined}
            style={brandBtn(canImport)}
          >
            {t("migrate.import")}
          </ActionButton>
        )}
      </div>
    </div>
  );
}

const fixBtn: CSSProperties = {
  height: 28,
  padding: "0 11px",
  borderRadius: 8,
  background: "var(--panel)",
  border: "1px solid var(--wait)",
  display: "flex",
  alignItems: "center",
  fontSize: 12,
  fontWeight: 600,
  color: "var(--wait)",
  whiteSpace: "nowrap",
};

/* ---------- 5 · Shadow mode ---------- */

async function ShadowStep({ t, base, tenantId }: { t: Translate; base: Base; tenantId: string }) {
  const run = base.run!;
  const m = await withTenant(tenantId, (tx) => shadowModel(tx, tenantId, t, base));
  const token = decryptSecret(run.shadowTokenEncrypted);
  const url = token ? `${await currentOrigin()}/in/opsgenie/${token}` : "";
  const days = shadowDays(run);
  const nobody = t("migrate.sim.nobody");
  const kpis = [
    [
      t("migrate.kpi.read"),
      t.fmt.number(m.total),
      t("migrate.kpi.readSub", { count: days }),
      "var(--ink)",
    ],
    [
      t("migrate.kpi.same"),
      `${pctLabel(t, m.agree, m.total)} %`,
      t("migrate.kpi.sameSub", { agree: m.agree, total: m.total }),
      m.open ? "var(--wait)" : "var(--ok)",
    ],
    [
      t("migrate.kpi.diff"),
      t.fmt.number(m.open),
      m.open ? t("migrate.kpi.diffOpen") : t("migrate.kpi.diffNone"),
      m.open ? "var(--wait)" : "var(--ok)",
    ],
    [t("migrate.kpi.pages"), t.fmt.number(m.pages), t("migrate.kpi.pagesSub"), "var(--ink)"],
  ] as const;
  const howto = rich(
    t("migrate.shadow.howto", {
      webhook: "{webhook}",
      description: "{description}",
      details: "{details}",
    }),
    {
      webhook: <strong>{t("migrate.shadow.webhook")}</strong>,
      description: <em>{t("migrate.shadow.description")}</em>,
      details: <em>{t("migrate.shadow.details")}</em>,
    },
  );
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12, animation: rise }}>
      <div
        style={{ ...card, padding: "16px 18px", display: "flex", flexDirection: "column", gap: 10 }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <span style={{ fontSize: 16, fontWeight: 600 }}>{t("migrate.shadow.title")}</span>
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              fontSize: 11.5,
              fontWeight: 600,
              color: "var(--ok)",
            }}
          >
            <span
              style={{
                width: 7,
                height: 7,
                borderRadius: "50%",
                background: "var(--ok)",
                animation: "oi-pulse 2s infinite",
              }}
            />
            {m.total ? t("migrate.shadow.running", { count: days }) : t("migrate.shadow.waiting")}
          </span>
        </div>
        <div style={{ fontSize: 12.5, lineHeight: 1.55, color: "var(--ink-2)" }}>{howto}</div>
        <CopyUrl url={url} />
      </div>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))",
          gap: 1,
          background: "var(--line)",
          border: "1px solid var(--line)",
          borderRadius: "var(--radius-card)",
          overflow: "hidden",
        }}
      >
        {kpis.map(([l, v, s, ink]) => (
          <div
            key={l}
            data-testid="migrate-kpi"
            style={{ background: "var(--panel)", padding: "12px 15px" }}
          >
            <div style={eyebrow}>{l}</div>
            <div
              style={{
                fontFamily: "var(--title)",
                fontSize: 24,
                fontWeight: 600,
                marginTop: 2,
                color: ink,
              }}
            >
              {v}
            </div>
            <div style={{ fontSize: 11, color: "var(--ink-3)" }}>{s}</div>
          </div>
        ))}
      </div>
      <div style={{ ...card, overflow: "hidden" }}>
        <div style={{ padding: "12px 18px", fontSize: 14, fontWeight: 600 }}>
          {t("migrate.parity.title")}
        </div>
        <div style={{ overflowX: "auto" }}>
          <div style={{ minWidth: 500 }}>
            {m.parity.map((p) => {
              const color = p.pct === 100 ? "var(--ok)" : "var(--wait)";
              const notes = Object.entries(p.causes).map(([k, n]) =>
                k === "override"
                  ? t("migrate.parity.override", { count: n })
                  : k === "rule"
                    ? t("migrate.parity.rule", { count: n })
                    : t("migrate.parity.policy", { count: n }),
              );
              return (
                <div
                  key={p.team}
                  data-testid="migrate-parity"
                  style={{
                    display: "grid",
                    gridTemplateColumns: "minmax(120px,1fr) 70px minmax(140px,1.6fr) 90px",
                    gap: 12,
                    alignItems: "center",
                    padding: "10px 18px",
                    borderTop: "1px solid var(--line-2)",
                    fontSize: 12.5,
                  }}
                >
                  <span style={{ fontWeight: 600 }}>{p.team}</span>
                  <span style={{ fontFamily: "var(--mono)", color: "var(--ink-3)" }}>
                    {t("migrate.parity.alerts", { count: p.n })}
                  </span>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <div
                      style={{
                        flex: 1,
                        height: 7,
                        borderRadius: 999,
                        background: "var(--sunk)",
                        overflow: "hidden",
                      }}
                    >
                      <div
                        style={{
                          height: "100%",
                          width: `${p.n ? p.pct : 0}%`,
                          background: color,
                          borderRadius: 999,
                        }}
                      />
                    </div>
                    <span
                      style={{
                        fontFamily: "var(--mono)",
                        fontWeight: 600,
                        color,
                        width: 46,
                        textAlign: "right",
                      }}
                    >
                      {p.n ? `${p.label} %` : "—"}
                    </span>
                  </div>
                  <span style={{ fontSize: 11.5, color: "var(--ink-3)" }}>
                    {p.n
                      ? notes.join(" · ") || t("migrate.parity.none")
                      : t("migrate.parity.noAlert")}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      </div>
      <div style={{ ...card, overflow: "hidden" }}>
        <div style={{ padding: "12px 18px", fontSize: 14, fontWeight: 600 }}>
          {t("migrate.diff.title")}
        </div>
        {m.disagreements.length === 0 && (
          <div
            style={{
              padding: "11px 18px",
              borderTop: "1px solid var(--line-2)",
              fontSize: 12.5,
              color: "var(--ink-3)",
            }}
          >
            {t("migrate.diff.empty")}
          </div>
        )}
        {m.disagreements.map((d) => {
          const why =
            d.cause === "override"
              ? t("migrate.diff.whyOverride")
              : d.cause === "rule"
                ? d.detail.oiRoute
                  ? t("migrate.diff.whyRule", { og: d.detail.ogRule ?? "—", oi: d.detail.oiRoute })
                  : t("migrate.diff.whyRuleNone", { og: d.detail.ogRule ?? "—" })
                : t("migrate.diff.whyPolicy");
          const btn: CSSProperties = {
            height: 28,
            padding: "0 11px",
            borderRadius: 8,
            border: `1px solid ${d.resolved ? "var(--ok)" : "var(--line)"}`,
            background: d.resolved ? "var(--ok-t)" : "var(--panel)",
            color: d.resolved ? "var(--ok)" : "var(--ink)",
            display: "flex",
            alignItems: "center",
            fontSize: 12,
            fontWeight: 600,
            whiteSpace: "nowrap",
            textDecoration: "none",
          };
          return (
            <div
              key={d.id}
              data-testid="migrate-disagreement"
              data-cause={d.cause}
              data-resolved={d.resolved}
              style={{
                display: "flex",
                gap: 12,
                padding: "11px 18px",
                borderTop: "1px solid var(--line-2)",
                alignItems: "center",
                flexWrap: "wrap",
              }}
            >
              <span
                style={{
                  fontFamily: "var(--mono)",
                  fontSize: 11.5,
                  color: "var(--ink-3)",
                  width: 84,
                }}
              >
                {t.fmt.dateTime(d.at, t.timeZone)}
              </span>
              <div style={{ flex: "1 1 280px", fontSize: 12.5, lineHeight: 1.5 }}>
                <strong>{d.title}</strong>
                <div style={{ fontSize: 11.5, color: "var(--ink-2)" }}>
                  {t("migrate.diff.line", {
                    og: d.og.join(", ") || nobody,
                    oi: d.oi.join(", ") || nobody,
                    why,
                  })}
                </div>
              </div>
              {d.resolved ? (
                <span style={btn}>{t("migrate.diff.resolved")}</span>
              ) : d.cause === "override" ? (
                <ActionButton
                  testId="migrate-settle"
                  action={settleOverride.bind(null, d.id)}
                  className="oi-hover"
                  style={btn}
                >
                  {t("migrate.diff.fixOverride")}
                </ActionButton>
              ) : d.cause === "rule" && d.detail.oiRouteId ? (
                <Link
                  href={`/app/settings/rules/${d.detail.oiRouteId}`}
                  className="oi-hover"
                  style={btn}
                >
                  {t("migrate.diff.fixRule")}
                </Link>
              ) : d.detail.pathId ? (
                <Link
                  href={`/app/on-call/paths/${d.detail.pathId}`}
                  className="oi-hover"
                  style={btn}
                >
                  {d.cause === "rule" ? t("migrate.diff.fixRule") : t("migrate.diff.fixPolicy")}
                </Link>
              ) : null}
            </div>
          );
        })}
      </div>
      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
        <form action={goTo.bind(null, "switch")}>
          <button
            type="submit"
            data-testid="migrate-to-switch"
            className="oi-hover-brand-2"
            style={brandBtn(true)}
          >
            {t("migrate.toSwitch")}
          </button>
        </form>
      </div>
    </div>
  );
}

/* ---------- 6 · Switch teams ---------- */

async function SwitchStep({ t, base, tenantId }: { t: Translate; base: Base; tenantId: string }) {
  const teams = await withTenant(tenantId, (tx) => switchModel(tx, tenantId, t, base));
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12, animation: rise }}>
      <div
        style={{
          fontSize: 12.5,
          lineHeight: 1.55,
          color: "var(--ink-2)",
          background: "var(--sunk)",
          borderRadius: 12,
          padding: "11px 14px",
        }}
      >
        {t("migrate.switch.note")}
      </div>
      {teams.map((team) => {
        const status = team.live
          ? { l: t("migrate.switch.live"), tone: "ok" as const }
          : team.n
            ? {
                l: t("migrate.switch.shadow", { pct: team.label }),
                tone: team.pct === 100 ? ("open" as const) : ("wait" as const),
              }
            : { l: t("migrate.switch.shadowNone"), tone: "open" as const };
        const done = team.checklist.filter((c) => c.done).length;
        return (
          <div
            key={team.id}
            data-testid="migrate-team"
            data-live={team.live}
            style={{
              ...card,
              border: `1px solid ${team.live ? "var(--ok)" : "var(--line)"}`,
              overflow: "hidden",
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 12,
                padding: "13px 18px",
                flexWrap: "wrap",
              }}
            >
              <div style={{ flex: "1 1 220px", minWidth: 0 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ fontSize: 15, fontWeight: 600 }}>{team.name}</span>
                  <span style={chip(status.tone)}>{status.l}</span>
                </div>
                <div style={{ fontSize: 12, color: "var(--ink-3)", marginTop: 2 }}>{team.meta}</div>
              </div>
              {team.live ? (
                <ActionButton
                  testId="migrate-rollback"
                  action={rollbackTeamAction.bind(null, team.id)}
                  className="oi-hover"
                  style={{ ...ghostBtn, height: 32, padding: "0 13px" }}
                >
                  {t("migrate.switch.back")}
                </ActionButton>
              ) : team.blocked ? (
                <span
                  data-testid="migrate-blocked"
                  style={{ fontSize: 12, color: "var(--wait)", fontWeight: 600 }}
                >
                  {t("migrate.switch.blocked", { count: team.blocked })}
                </span>
              ) : (
                <ActionButton
                  testId="migrate-switch"
                  action={switchTeamAction.bind(null, team.id)}
                  className="oi-hover-brand-2"
                  style={{
                    height: 32,
                    padding: "0 14px",
                    borderRadius: 9,
                    background: "var(--brand)",
                    color: "#fff",
                    border: "none",
                    display: "flex",
                    alignItems: "center",
                    fontSize: 12.5,
                    fontWeight: 600,
                  }}
                >
                  {t("migrate.switch.go")}
                </ActionButton>
              )}
            </div>
            {team.live && team.checklist.length > 0 && (
              <div
                style={{
                  borderTop: "1px solid var(--line-2)",
                  padding: "10px 18px 12px",
                  display: "flex",
                  flexDirection: "column",
                  gap: 6,
                }}
              >
                <div
                  style={{
                    fontSize: 11,
                    fontWeight: 700,
                    letterSpacing: ".08em",
                    textTransform: "uppercase",
                    color: "var(--ink-3)",
                  }}
                >
                  {t("migrate.switch.repoint", { done, total: team.checklist.length })}
                </div>
                {team.checklist.map((c) => (
                  <RepointRow
                    key={c.key}
                    team={team.id}
                    item={{
                      key: c.key,
                      label: c.label,
                      done: c.done,
                      hint: c.hint ? t(`migrate.hint.${c.hint}` as "migrate.hint.webhook-url") : "",
                    }}
                  />
                ))}
              </div>
            )}
          </div>
        );
      })}
      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
        <form action={startArchive}>
          <button
            type="submit"
            data-testid="migrate-to-archive"
            className="oi-hover-brand-2"
            style={brandBtn(true)}
          >
            {t("migrate.toArchive")}
          </button>
        </form>
      </div>
    </div>
  );
}

/* ---------- 7 · Archive history ---------- */

function ArchiveStep({ t, base }: { t: Translate; base: Base }) {
  const m = archiveModel(base);
  const from = m.oldest
    ? m.oldest.toLocaleDateString(t.locale.tag, {
        month: "short",
        year: "numeric",
        timeZone: "UTC",
      })
    : "—";
  const sub = m.done
    ? t("migrate.arch.done", { total: t.fmt.number(m.imported), from })
    : m.started
      ? t("migrate.arch.progress", {
          done: t.fmt.number(m.read),
          total: t.fmt.number(m.total),
          pct: m.pct,
        })
      : t("migrate.arch.idle", { total: t.fmt.number(m.total), from });
  const current = m.cursor?.windows.findIndex((w) => !w.done) ?? -1;
  const finishable = m.pending === 0 && m.teams > 0 && m.done;
  const where =
    getEdition() === "cloud" ? t("migrate.arch.whereCloud") : t("migrate.arch.whereSelf");
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12, animation: rise }}>
      <div
        style={{ ...card, padding: "16px 18px", display: "flex", flexDirection: "column", gap: 10 }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <span style={{ fontSize: 16, fontWeight: 600 }}>{t("migrate.arch.title")}</span>
          <span data-testid="migrate-arch-sub" style={{ fontSize: 12, color: "var(--ink-3)" }}>
            {sub}
          </span>
          <span style={{ flex: 1 }} />
          {!m.started && (
            <form action={startArchive}>
              <button
                type="submit"
                data-testid="migrate-arch-start"
                className="oi-hover"
                style={ghostBtn}
              >
                {t("migrate.arch.start")}
              </button>
            </form>
          )}
        </div>
        <div
          style={{ height: 8, borderRadius: 999, background: "var(--sunk)", overflow: "hidden" }}
        >
          <div
            data-testid="migrate-arch-progress"
            style={{
              height: "100%",
              width: `${m.done ? 100 : m.pct}%`,
              background: "var(--brand)",
              borderRadius: 999,
              transition: "width .3s",
            }}
          />
        </div>
        {m.cursor && (
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))",
              gap: 6,
            }}
          >
            {m.cursor.windows.map((w, i) => (
              <div
                key={w.from}
                data-testid="migrate-window"
                data-done={w.done}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  border: "1px solid var(--line-2)",
                  borderRadius: 9,
                  padding: "7px 10px",
                  fontSize: 12,
                }}
              >
                <span
                  style={{
                    width: 8,
                    height: 8,
                    borderRadius: "50%",
                    background: w.done
                      ? "var(--ok)"
                      : i === current && m.running
                        ? "var(--open)"
                        : "var(--line)",
                    flex: "none",
                  }}
                />
                <span style={{ fontFamily: "var(--mono)", flex: 1 }}>{w.label}</span>
                <span style={{ fontFamily: "var(--mono)", color: "var(--ink-3)" }}>
                  {t.fmt.number(w.count)}
                </span>
              </div>
            ))}
          </div>
        )}
        {m.error && m.running && (
          <div role="alert" style={{ fontSize: 12, color: "var(--wait)" }}>
            {t("migrate.arch.failed", { error: m.error })}
          </div>
        )}
        <div style={{ fontSize: 12, color: "var(--ink-3)", lineHeight: 1.5 }}>
          {t("migrate.arch.note", { where })}
          {m.open > 0 && <> {t("migrate.arch.open", { count: m.open })}.</>}
        </div>
      </div>
      <div
        style={{ ...card, padding: "16px 18px", display: "flex", flexDirection: "column", gap: 8 }}
      >
        <div style={{ fontSize: 14, fontWeight: 600 }}>{t("migrate.arch.uses")}</div>
        {(["use1", "use2", "use3"] as const).map((u) => (
          <div key={u} style={{ display: "flex", gap: 10, fontSize: 12.5, lineHeight: 1.5 }}>
            <span
              style={{
                width: 6,
                height: 6,
                borderRadius: "50%",
                background: "var(--brand)",
                marginTop: 7,
                flex: "none",
              }}
            />
            <span>{t(`migrate.arch.${u}`)}</span>
          </div>
        ))}
      </div>
      <div
        style={{
          background: m.complete ? "var(--ok-t)" : "var(--panel)",
          border: `1px solid ${m.complete ? "var(--ok)" : "var(--line)"}`,
          borderRadius: "var(--radius-card)",
          padding: "16px 18px",
          display: "flex",
          alignItems: "center",
          gap: 14,
          flexWrap: "wrap",
        }}
      >
        <div style={{ flex: "1 1 280px" }}>
          <div style={{ fontSize: 14, fontWeight: 600 }}>
            {m.complete
              ? t("migrate.off.doneT")
              : m.pending
                ? t("migrate.off.pending", { count: m.pending })
                : t("migrate.off.allLive")}
          </div>
          <div style={{ fontSize: 12.5, color: "var(--ink-2)", marginTop: 2, lineHeight: 1.5 }}>
            {m.complete ? t("migrate.off.doneD") : t("migrate.off.d")}
          </div>
        </div>
        {m.complete ? (
          <span
            data-testid="migrate-finished"
            style={{
              height: 34,
              padding: "0 15px",
              borderRadius: 9,
              background: "var(--ok)",
              color: "#fff",
              display: "flex",
              alignItems: "center",
              fontSize: 12.5,
              fontWeight: 600,
              whiteSpace: "nowrap",
            }}
          >
            {t("migrate.off.finished")}
          </span>
        ) : (
          <ActionButton
            testId="migrate-finish"
            action={finishMigration}
            style={{
              height: 34,
              padding: "0 15px",
              borderRadius: 9,
              background: finishable ? "var(--ok)" : "var(--line)",
              color: "#fff",
              border: "none",
              display: "flex",
              alignItems: "center",
              fontSize: 12.5,
              fontWeight: 600,
              whiteSpace: "nowrap",
              cursor: "pointer",
            }}
          >
            {t("migrate.off.finish")}
          </ActionButton>
        )}
      </div>
    </div>
  );
}
