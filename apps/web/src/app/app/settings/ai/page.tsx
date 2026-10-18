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
import { getT, type Translate } from "@/i18n/server";
import { isManager, requireMember } from "@/lib/session";
import { Toggle } from "@/components/settings/controls";
import { SaveBar } from "@/components/settings/form";
import {
  Chip,
  FormCard,
  ListCard,
  ReadOnly,
  Row,
  selectStyle,
} from "@/components/settings/template";
import {
  atlasBacktests,
  atlasBudget,
  atlasGuardrails,
  atlasOverview,
  listAllowedActions,
  listServiceAutonomy,
  type ServiceAutonomyView,
} from "@/lib/atlas/queries";
import { LEVELS, RIGHT_RUNS_AFTER_DROP } from "@/lib/atlas/levels";
import { euros, tokens } from "@/lib/atlas/format";
import { saveAiSettings } from "./actions";
import { AtlasGovernance, type GovernanceView } from "./governance";

/**
 * Settings › Atlas — the design's "Settings — Atlas" (V2AtlasGovernance):
 * autonomy earned per service, what Atlas may do to your systems, what it
 * never does without a person, what it costs. Below it, the AI governance
 * the screen always had — the capabilities, the data, every call.
 */
export const dynamic = "force-dynamic";

const LEVEL_COLOR = ["var(--ink-3)", "var(--open)", "var(--brand-2)", "var(--wait)", "var(--viol)"];
const BT_COLOR = {
  bullseye: "var(--ok)",
  on_target: "#5FB38E",
  miss: "var(--wait)",
  nowhere_near: "var(--dang)",
} as const;

type LevelKey = "observe" | "investigate" | "propose" | "act" | "resolve";

function levelName(t: Translate, n: number): string {
  return t(`atlas.set.level.${(LEVELS[n]?.key ?? "observe") as LevelKey}`);
}

/** "18 of 20 runs · 4 of 5 proposals", "top level · promoted Oct 2", "lowered Oct 12 after a Miss · 5 right runs to go". */
function nextLine(t: Translate, s: ServiceAutonomyView): string {
  if (s.level >= 4)
    return s.changedAt
      ? t("atlas.set.next.top", { date: t.fmt.dateCompact(s.changedAt) })
      : t("atlas.set.next.topNoDate");
  const parts: string[] = [];
  const dropped =
    s.rightSinceDrop !== null &&
    s.rightSinceDrop < RIGHT_RUNS_AFTER_DROP &&
    (s.reason === "grade" || s.reason === "undo" || s.reason === "reopen");
  if (dropped && s.changedAt) {
    parts.push(
      t(`atlas.set.next.lowered.${s.reason as "grade" | "undo" | "reopen"}`, {
        date: t.fmt.dateCompact(s.changedAt),
      }),
    );
    parts.push(
      t("atlas.set.next.toGo", { count: RIGHT_RUNS_AFTER_DROP - (s.rightSinceDrop ?? 0) }),
    );
    return parts.join(" · ");
  }
  const unmet = s.next.criteria.filter((c) => !c.met && c.key !== "rightSinceDrop");
  if (unmet.length === 0)
    return s.next.next ? t("atlas.set.next.ready", { level: s.next.next.level }) : "";
  // The countable criteria first, as the design writes them: runs, fixes, proposals, incidents.
  const order = [
    "gradedRuns",
    "l3FixesOk",
    "proposalsOk",
    "incidentsSeen",
    "rightPct",
    "backtestPct",
    "noMissDays",
  ];
  const shown = s.next.criteria
    .filter((c) => c.key !== "rightSinceDrop")
    .filter(
      (c) => ["gradedRuns", "l3FixesOk", "proposalsOk", "incidentsSeen"].includes(c.key) || !c.met,
    )
    .sort((a, b) => order.indexOf(a.key) - order.indexOf(b.key))
    .slice(0, 2);
  return shown
    .map((c) =>
      t(`atlas.set.next.${c.key as "gradedRuns"}`, {
        current: c.current === null ? "—" : Math.round(c.current),
        target: c.target,
      }),
    )
    .join(" · ");
}

function gateOf(t: Translate, n: number): string {
  if (n === 0) return t("atlas.set.gate.default");
  const reach = LEVELS[n]!.reach;
  const crit = (Object.entries(reach) as Array<[keyof typeof reach, number]>).map(([k, v]) =>
    t(`atlas.set.crit.${k}`, { n: v }),
  );
  return t("atlas.set.gate.reach", { criteria: crit.join(" · ") });
}

export default async function AtlasSettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ saved?: string }>;
}) {
  const { tenant, member } = await requireMember();
  const t = await getT();
  const q = await searchParams;
  const manages = isManager(member);
  const [overview, svcs, actions, guardrails, bts, budget, gov] = await Promise.all([
    atlasOverview(tenant.id),
    listServiceAutonomy(tenant.id),
    listAllowedActions(tenant.id),
    atlasGuardrails(tenant.id),
    atlasBacktests(tenant.id),
    atlasBudget(tenant.id),
    withTenant(tenant.id, async (tx) => ({
      settings: await getAiSettings(tx, tenant.id),
      calls: await recentAiCalls(tx, tenant.id, 30),
    })),
  ]);
  const configured = aiConfigured();
  const pct = (v: number | null) => (v === null ? "—" : `${t.fmt.number(Math.round(v))} %`);

  /* ---- Kill switch ---- */
  const killedBy =
    overview.killSwitchBy === member.name
      ? t("atlas.set.ks.you")
      : (overview.killSwitchBy ?? t("atlas.set.ks.someone"));
  const kill = overview.killSwitch
    ? {
        on: true,
        title: t("atlas.set.ks.stopped"),
        detail: t("atlas.set.ks.stoppedBy", {
          name: killedBy,
          when: overview.killSwitchAt ? t.fmt.relative(overview.killSwitchAt) : "",
        }),
        button: t("atlas.set.ks.resume"),
      }
    : {
        on: false,
        title: t("atlas.set.ks.acting", { count: overview.acting }),
        detail: [
          t("atlas.set.ks.runs", { count: overview.inProgress }),
          t("atlas.set.ks.resolved", { count: overview.resolved24h }),
          t("atlas.set.ks.waiting", { count: overview.waiting }),
        ].join(" · "),
        button: t("atlas.set.ks.stop"),
      };

  /* ---- Services ---- */
  const capValue = (cap: number | null) => (cap === null || cap >= 4 ? "none" : String(cap));
  const rows = svcs.map((s) => {
    const eff = s.effective;
    const name = t("atlas.set.svc.level", { level: eff, name: levelName(t, eff) });
    return {
      id: s.serviceId,
      key: s.key,
      level: overview.killSwitch
        ? t("atlas.set.svc.stopped")
        : eff < s.level
          ? t("atlas.set.svc.capped", { level: name })
          : name,
      levelBg: overview.killSwitch ? "var(--dang-t)" : "var(--sunk)",
      levelInk: overview.killSwitch ? "var(--dang)" : LEVEL_COLOR[eff]!,
      right: pct(s.rightPct),
      rightInk:
        s.rightPct === null ? "var(--ink-3)" : s.rightPct >= 90 ? "var(--ok)" : "var(--wait)",
      backtest: pct(s.backtestPct),
      progress: s.progress,
      next: nextLine(t, s),
      cap: capValue(s.cap),
    };
  });

  /* ---- Allowed actions ---- */
  const builtIn = (key: string) =>
    [
      "rollback_deploy",
      "flag_off",
      "restart_pods",
      "scale_deployment",
      "reload_keys",
      "drain_node",
      "db_failover",
    ].includes(key);
  const actionRows = actions.map((a) => {
    const label = builtIn(a.key) ? t(`atlas.set.action.${a.key as "flag_off"}`) : a.label;
    const desc0 = builtIn(a.key)
      ? t(`atlas.set.action.${a.key as "flag_off"}.desc`)
      : (a.description ?? "");
    const connected = a.available;
    return {
      key: a.key,
      label,
      desc:
        connected || a.irreversible ? desc0 : `${desc0} · ${t("atlas.set.actions.notConnected")}`,
      chip: a.irreversible
        ? t("atlas.set.actions.irreversible")
        : connected && !a.reversible
          ? t("atlas.set.actions.irreversible")
          : t("atlas.set.actions.reversible"),
      chipBg: a.irreversible || (connected && !a.reversible) ? "var(--dang-t)" : "var(--ok-t)",
      chipInk: a.irreversible || (connected && !a.reversible) ? "var(--dang)" : "var(--ok)",
      level: a.irreversible ? t("atlas.set.actions.never") : `L${a.minLevel}`,
      on: a.enabled && !a.irreversible,
      irreversible: a.irreversible,
      connected: connected && a.reversible,
      http: {
        doUrl: a.http.doUrl ?? "",
        undoUrl: a.http.undoUrl ?? "",
        verifyUrl: a.http.verifyUrl ?? "",
      },
    };
  });

  /* ---- Backtest ---- */
  const latest = bts.latest;
  const shown = latest?.status === "completed" ? latest : bts.completed;
  const busy = latest?.status === "queued" || latest?.status === "running";
  const total = shown
    ? shown.grades.bullseye + shown.grades.on_target + shown.grades.miss + shown.grades.nowhere_near
    : 0;
  const btCard = {
    available: bts.available,
    busy,
    button: busy
      ? latest!.status === "queued"
        ? t("atlas.set.bt.queued")
        : t("atlas.set.bt.running", { done: latest!.done, total: latest!.incidents })
      : shown
        ? t("atlas.set.bt.run")
        : t("atlas.set.bt.runFirst"),
    bars:
      shown && total > 0
        ? (["bullseye", "on_target", "miss", "nowhere_near"] as const).map((g) => ({
            label: t(`atlas.set.bt.grade.${g}`),
            n: shown.grades[g],
            color: BT_COLOR[g],
            width: `${((shown.grades[g] / total) * 100).toFixed(1)}%`,
          }))
        : [],
    right:
      shown && shown.rightPct !== null ? t("atlas.set.bt.right", { pct: shown.rightPct }) : null,
    rest:
      shown && shown.rightPct !== null
        ? shown.resolvedAlone !== null && shown.medianMinutesSooner !== null
          ? t("atlas.set.bt.rest", {
              count: total,
              alone: shown.resolvedAlone,
              minutes: shown.medianMinutesSooner,
            })
          : t("atlas.set.bt.restNoAlone", { count: total })
        : null,
    empty: !bts.available
      ? t("atlas.set.bt.unavailable")
      : !shown && !busy
        ? t("atlas.set.bt.none")
        : null,
    failed:
      latest?.status === "failed" ? t("atlas.set.bt.failed", { error: latest.error ?? "—" }) : null,
  };

  /* ---- Budget ---- */
  const tok = tokens(t.fmt, budget.tokens);
  const budgetCard = {
    spent: euros(t.fmt, budget.spentEur),
    of:
      budget.monthEur === null
        ? t("atlas.set.budget.noBudget", { tokens: tok })
        : t("atlas.set.budget.of", { budget: euros(t.fmt, budget.monthEur), tokens: tok }),
    pct: budget.monthEur ? budget.spentEur / budget.monthEur : 0,
    capPerRun:
      budget.perRunEur === null ? t("atlas.set.budget.none") : euros(t.fmt, budget.perRunEur),
    median: budget.medianRunEur === null ? "—" : euros(t.fmt, budget.medianRunEur),
    exhausted: budget.exhausted,
    month: budget.monthEur === null ? "" : String(budget.monthEur),
    perRun: budget.perRunEur === null ? "" : String(budget.perRunEur),
  };

  const view: GovernanceView = {
    manages,
    kill,
    levels: {
      title: t("atlas.set.levels.title"),
      hint: t("atlas.set.levels.hint"),
      cards: LEVELS.map((l) => ({
        n: l.level,
        name: t(`atlas.set.level.${l.key}`),
        desc: t(`atlas.set.levelDesc.${l.key}`),
        gate: gateOf(t, l.level),
        color: LEVEL_COLOR[l.level]!,
        services:
          svcs
            .filter((s) => s.effective === l.level)
            .map((s) => s.key)
            .join(" · ") || "—",
      })),
      downTitle: t("atlas.set.goesDown"),
      downText: t("atlas.set.goesDownText"),
    },
    services: {
      title: t("atlas.set.svc.title"),
      hint: t("atlas.set.svc.hint"),
      cols: [
        t("atlas.set.svc.col.service"),
        t("atlas.set.svc.col.level"),
        t("atlas.set.svc.col.right"),
        t("atlas.set.svc.col.backtest"),
        t("atlas.set.svc.col.next"),
        t("atlas.set.svc.col.cap"),
      ],
      rows,
      capOptions: [
        { value: "none", label: t("atlas.set.cap.none") },
        { value: "3", label: t("atlas.set.cap.3") },
        { value: "2", label: t("atlas.set.cap.2") },
        { value: "1", label: t("atlas.set.cap.1") },
        { value: "0", label: t("atlas.set.cap.0") },
      ],
      empty: t("atlas.set.svc.empty"),
    },
    actions: {
      title: t("atlas.set.actions.title"),
      hint: t("atlas.set.actions.hint"),
      rows: actionRows,
      foot: t("atlas.set.actions.foot"),
    },
    limits: {
      title: t("atlas.set.limits.title"),
      hint: t("atlas.set.limits.hint"),
      rows: (
        [
          ["sev1", true],
          ["securityAndPrivate", false],
          ["firstUseOnService", true],
          ["changeFreeze", true],
          ["publicStatusPage", true],
          ["catalogOnly", true],
        ] as const
      ).map(([key, hasDesc]) => ({
        key,
        label: t(`atlas.set.limit.${key}`),
        desc: hasDesc ? t(`atlas.set.limit.${key}.desc` as "atlas.set.limit.sev1.desc") : null,
        on: key === "catalogOnly" ? true : guardrails[key],
        locked: key === "catalogOnly",
      })),
    },
    backtest: { title: t("atlas.set.bt.title"), desc: t("atlas.set.bt.desc"), card: btCard },
    budget: {
      title: t("atlas.set.budget.title"),
      card: budgetCard,
      note: t("atlas.set.budget.note"),
    },
    data: configured
      ? t("atlas.set.data", { provider: aiProviderLabel() })
      : t("atlas.set.dataNone"),
    words: {
      capPerRun: t("atlas.set.budget.capPerRun"),
      median: t("atlas.set.budget.median"),
      exhausted: t("atlas.set.budget.exhausted"),
      edit: t("atlas.set.budget.edit"),
      month: t("atlas.set.budget.month"),
      perRun: t("atlas.set.budget.perRun"),
      emptyHelp: t("atlas.set.budget.emptyHelp"),
      save: t("atlas.set.budget.save"),
      cancel: t("atlas.set.budget.cancel"),
      endpointTitle: t("atlas.set.endpoint.title", { action: "{action}" }),
      endpointLead: t("atlas.set.endpoint.lead"),
      doUrl: t("atlas.set.endpoint.do"),
      undoUrl: t("atlas.set.endpoint.undo"),
      verifyUrl: t("atlas.set.endpoint.verify"),
      verifyHelp: t("atlas.set.endpoint.verifyHelp"),
      endpointSave: t("atlas.set.endpoint.save"),
      secretTitle: t("atlas.set.secret.title"),
      secretHelp: t("atlas.set.secret.help"),
      secretRotate: t("atlas.set.secret.rotate"),
      connectFirst: t("atlas.set.actions.connectFirst", { action: "{action}" }),
      irreversible: t("atlas.set.actions.irreversibleToast"),
      managersOnly: t("atlas.set.managersOnly"),
    },
  };

  const capOn = (c: (typeof AI_CAPABILITIES)[number]) => gov.settings.capabilities[c] !== false;

  return (
    <div
      data-testid="atlas-settings"
      data-screen-label="Settings — Atlas"
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 14,
        animation: "oi-rise .16s ease backwards",
      }}
    >
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
              className="oi-hover-edge-ink"
              style={{ color: "inherit", textDecoration: "none", cursor: "pointer" }}
            >
              {t("nav.settings")}
            </Link>
            <span>/</span>
            <span>{t("atlas.set.crumb")}</span>
          </div>
          <h1
            style={{
              margin: "3px 0 0",
              fontFamily: "var(--title)",
              fontSize: 24,
              fontWeight: 600,
              letterSpacing: "-.02em",
            }}
          >
            {t("atlas.set.title")}
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
            {t("atlas.set.lead")}
          </p>
        </div>
      </div>

      <AtlasGovernance v={view} />

      {/* The AI governance the screen always had: capabilities, data, every call. */}
      <form action={saveAiSettings} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <FormCard
          title={
            <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
              {t("set2.ai.mayDo")}
              <Chip tone={configured ? "viol" : "mute"}>
                {configured
                  ? t("set2.ai.chipConfigured", { host: aiProviderLabel() })
                  : t("set2.ai.chipNone")}
              </Chip>
            </span>
          }
          hint={t("atlas.set.gov.capsHint")}
          testId="ai-capabilities"
        >
          <Row
            label={gov.settings.enabled ? t("settings.ai.masterOn") : t("settings.ai.masterOff")}
            testId="ai-master"
          >
            <Toggle
              name="enabled"
              defaultChecked={gov.settings.enabled}
              label={t("settings.ai.title")}
              disabled={!manages}
            />
          </Row>
          {AI_CAPABILITIES.map((c) => (
            <Row
              key={c}
              label={t(`settings.ai.cap.${c}`)}
              help={t(`settings.ai.capDesc.${c}`)}
              testId={`ai-cap-${c}`}
            >
              <Toggle
                name={`cap_${c}`}
                defaultChecked={capOn(c)}
                label={t(`settings.ai.cap.${c}`)}
                disabled={!manages}
              />
            </Row>
          ))}
        </FormCard>

        <FormCard
          title={t("atlas.set.gov.data")}
          hint={t("atlas.set.gov.dataHint")}
          testId="ai-data"
        >
          <Row label={t("settings.ai.provider")} help={t("settings.ai.providerHint")}>
            <select
              name="provider"
              defaultValue={gov.settings.provider ?? ""}
              disabled={!manages || !configured}
              className="oi-field"
              style={selectStyle}
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
          </Row>
          <Row label={t("settings.ai.boundaryPrivate")} help={t("settings.ai.boundaryPrivateNote")}>
            <Toggle
              name="privateOptIn"
              defaultChecked={gov.settings.privateOptIn}
              label={t("settings.ai.boundaryPrivate")}
              disabled={!manages}
            />
          </Row>
          {(
            [
              ["incidents", gov.settings.sources.incidents],
              ["changeEvents", gov.settings.sources.changeEvents],
              ["telemetry", gov.settings.sources.telemetry !== false],
              ["docs", gov.settings.sources.docs],
            ] as const
          ).map(([k, on]) => (
            <Row key={k} label={t(`settings.ai.source.${k}`)} testId={`ai-src-${k}`}>
              <Toggle
                name={`src_${k}`}
                defaultChecked={on}
                label={t(`settings.ai.source.${k}`)}
                disabled={!manages}
              />
            </Row>
          ))}
          <Row label={t("settings.ai.boundaries")} help={t("settings.ai.boundaryRedaction")}>
            <ReadOnly>{t("settings.ai.boundaryTraining")}</ReadOnly>
          </Row>
        </FormCard>

        {manages && (
          <SaveBar
            label={t("common.save")}
            testId="ai-save"
            status={q.saved === "1" ? t("common.saved") : undefined}
          />
        )}
      </form>

      <ListCard
        title={t("atlas.set.gov.calls")}
        hint={t("atlas.set.gov.callsHint")}
        testId="ai-calls"
      >
        {gov.calls.map((c) => (
          <div
            key={c.id}
            data-testid="ai-call"
            style={{
              display: "flex",
              alignItems: "center",
              gap: 12,
              padding: "10px 18px",
              borderTop: "1px solid var(--line-2)",
              fontSize: 12.5,
            }}
          >
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 500 }}>
                {c.capability === "embed"
                  ? t("settings.ai.embed")
                  : t(`settings.ai.cap.${c.capability}`)}
                {c.incidentNumber ? (
                  <>
                    {" · "}
                    <Link
                      href={`/app/incidents/${c.incidentNumber}`}
                      className="oi-link"
                      style={{ fontFamily: "var(--mono)", fontSize: 12 }}
                    >
                      INC-{c.incidentNumber}
                    </Link>
                  </>
                ) : null}
              </div>
              <div style={{ fontSize: 11.5, color: "var(--ink-3)", marginTop: 1 }}>
                {c.actorKind === "system"
                  ? t("atlas.set.gov.atlasOwn")
                  : (c.actorName ?? c.actorKind)}{" "}
                · {t.fmt.messageTime(c.createdAt)} · {c.model}
              </div>
            </div>
            <span
              style={{
                fontFamily: "var(--mono)",
                fontSize: 11.5,
                color: "var(--ink-2)",
                whiteSpace: "nowrap",
              }}
            >
              {t("atlas.set.gov.callCost", {
                tokens: t.fmt.number(c.inputTokens + c.outputTokens),
                seconds: t.fmt.decimal(c.durationMs / 1000, 1),
              })}
            </span>
            <Chip tone={c.status === "ok" ? "ok" : "dang"}>{c.status}</Chip>
          </div>
        ))}
        {gov.calls.length === 0 && (
          <div
            style={{
              padding: "10px 18px",
              borderTop: "1px solid var(--line-2)",
              fontSize: 12.5,
              color: "var(--ink-3)",
            }}
          >
            {t("settings.ai.logEmpty")}
          </div>
        )}
      </ListCard>
    </div>
  );
}
