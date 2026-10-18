import Link from "next/link";
import { aiProviderLabel } from "@openincident/ai";
import type { Citation, Confidence, InvestigationGrade } from "@openincident/db";
import { getT, type Translate } from "@/i18n/server";
import type { IncidentDetail } from "@/lib/incidents";
import { investigationAccess } from "@/lib/investigations";
import { getTenantFromHeaders } from "@/lib/tenant";
import { levelAfter } from "@/lib/atlas/levels";
import { loadRun, type AtlasRun } from "@/components/atlas/data";
import { costSteps, gainAtNextLevel, isUndone, canUndo, namedSteps } from "@/components/atlas/run";
import { eyebrow, levelKey, panel, sourcePill, TONE, tokensShort } from "@/components/atlas/ui";
import {
  actionTitle,
  approverOf,
  criterionNeed,
  fixName,
  journalText,
} from "@/components/atlas/words";
import { AtlasRunBar } from "./atlas-bar";
import { AtlasJournal, type JournalRow } from "./atlas-journal";
import { InvestigationLive } from "./investigation-live";
import {
  addInvestigationNote,
  gradeInvestigation,
  rerunInvestigation,
} from "./investigation-actions";

const CONFIDENCE_BARS: Record<Confidence, number> = {
  speculation: 1,
  plausible: 2,
  likely: 3,
  strong: 4,
  validated: 5,
};
const CONFIDENCE_INK: Record<Confidence, string> = {
  speculation: "var(--ink-3)",
  plausible: "var(--wait)",
  likely: "var(--open)",
  strong: "var(--ok)",
  validated: "var(--ok)",
};
const GRADES: InvestigationGrade[] = ["bullseye", "on_target", "miss", "nowhere_near"];
const GRADE_TONE: Record<InvestigationGrade, keyof typeof TONE> = {
  bullseye: "ok",
  on_target: "ok",
  miss: "wait",
  nowhere_near: "dang",
};

/**
 * The Atlas tab (design V2 "Incident — Atlas"): the run of this incident as
 * Atlas lived it. A dark bar that always carries Pause and Stop; where things
 * stand, in four lines with their sources; the journal of every action with
 * who decided it and how to take it back; what one more level would have
 * changed, measured on this run; the hypotheses; and on the right the grade
 * after closure, a note for Atlas, and what the run cost. Every figure is
 * read off the investigation and its journal — a sentence that cannot be
 * backed is not written.
 */
export async function AtlasTab({
  inc,
  tenantId,
  number,
  canAct,
}: {
  inc: IncidentDetail;
  tenantId: string;
  number: number;
  canAct: boolean;
  alerts?: number;
}) {
  const t = await getT();
  const tenant = await getTenantFromHeaders();
  const access = tenant
    ? await investigationAccess(tenant)
    : ({ ok: false, reason: "edition" } as const);
  const run = await loadRun(tenantId, inc.row.id);
  const { inv } = run;
  const running = inv?.status === "queued" || inv?.status === "running";
  const lastEventId = inc.events.at(-1)?.id ?? "";

  if (!inv || (inv.runs === 0 && run.actions.length === 0))
    return (
      <div
        data-testid="atlas-tab"
        style={{
          ...panel,
          padding: "18px 20px",
          display: "flex",
          flexDirection: "column",
          gap: 10,
          animation: "oi-rise .16s ease backwards",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ ...eyebrow, color: "var(--viol)" }}>✦ Atlas</span>
          {access.ok && (
            <InvestigationLive
              incidentId={inc.row.id}
              lastEventId={lastEventId}
              running={running}
              label={t("ai.investigation.refreshing")}
            />
          )}
          <span style={{ flex: 1 }} />
          {canAct && access.ok && !running && inc.row.phase !== "closed" && (
            <form action={rerunInvestigation} style={{ display: "contents" }}>
              <input type="hidden" name="number" value={number} />
              <button
                type="submit"
                data-testid="atlas-start"
                style={{
                  height: 32,
                  padding: "0 13px",
                  borderRadius: 9,
                  border: 0,
                  background: "var(--viol)",
                  color: "#fff",
                  fontSize: 12.5,
                  fontWeight: 600,
                  cursor: "pointer",
                }}
              >
                {t("ai.investigation.start")}
              </button>
            </form>
          )}
        </div>
        <p style={{ margin: 0, fontSize: 13.5, lineHeight: 1.6, color: "var(--ink-2)" }}>
          {!access.ok
            ? access.reason === "edition"
              ? t("ai.investigation.unavailableEdition")
              : t(`ai.refusal.${access.reason}`)
            : running
              ? t("ai.investigation.status.running")
              : t("atlas.ui.empty")}
        </p>
        <p style={{ margin: 0, fontSize: 12.5, lineHeight: 1.6, color: "var(--ink-3)" }}>
          {t("atlas.ui.emptyLead")}
        </p>
      </div>
    );

  const serviceKey = run.autonomy?.key ?? null;
  const level = run.autonomy?.effective ?? null;
  const tokens = tokensShort(inv.tokensTotal);
  const lastUpdate = inv.completedAt ?? inv.updatedAt;
  // Stopped (not merely paused): the journal's last stop/resume step says so.
  const lastSwitch = [...run.actions]
    .reverse()
    .find((a) => /^atlas\.j\.(stopped|resumed)$/.test(journalText(a).key ?? ""));
  const stoppedBy =
    inv.paused && lastSwitch && journalText(lastSwitch).key === "atlas.j.stopped"
      ? ((lastSwitch.decidedByMemberId ? run.names.get(lastSwitch.decidedByMemberId) : null) ??
        String(journalText(lastSwitch).params.member ?? "—"))
      : null;
  const state = run.killSwitch
    ? t("atlas.ui.run.killSwitch")
    : stoppedBy
      ? t("atlas.ui.run.stopped", { name: stoppedBy })
      : inv.paused
        ? t("atlas.ui.run.paused")
        : inv.status === "running"
          ? t("atlas.ui.run.running")
          : inv.status === "queued"
            ? t("atlas.ui.run.queued")
            : inv.status === "failed"
              ? t("atlas.ui.run.failed", { time: t.fmt.time(lastUpdate, t.timeZone) })
              : t("atlas.ui.run.finished", { time: t.fmt.time(lastUpdate, t.timeZone) });
  const levelLine =
    serviceKey != null && level != null
      ? (() => {
          const [before, after] = t.parts("atlas.ui.run.levelLine", "name", {
            service: serviceKey,
            level,
            role: t(`atlas.ui.role.${levelKey(level)}`),
          });
          return { before, name: t(`atlas.ui.level.${levelKey(level)}`), after };
        })()
      : null;

  return (
    <div
      data-testid="atlas-tab"
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 12,
        minWidth: 0,
        animation: "oi-rise .16s ease backwards",
      }}
    >
      <AtlasRunBar
        incidentId={inc.row.id}
        state={state}
        running={running && !inv.paused}
        levelLine={levelLine}
        noService={t("atlas.ui.run.noService")}
        cost={`${t("atlas.ui.eur", { amount: t.fmt.amount(inv.costEur) })} · ${
          tokens.k
            ? t("atlas.ui.tokensK", { count: tokens.value })
            : t("atlas.ui.tokens", { count: tokens.value })
        }`}
        paused={inv.paused}
        stopped={Boolean(stoppedBy)}
        canAct={canAct && inc.row.phase !== "closed"}
      />
      <InvestigationLive
        incidentId={inc.row.id}
        lastEventId={lastEventId}
        running={running}
        label=""
        silent
      />

      <div style={{ display: "flex", flexWrap: "wrap", gap: 14, alignItems: "flex-start" }}>
        <div
          style={{
            flex: "10 1 480px",
            minWidth: 0,
            display: "flex",
            flexDirection: "column",
            gap: 12,
          }}
        >
          <WhereThingsStand run={run} t={t} lastUpdate={lastUpdate} />
          <JournalCard
            run={run}
            t={t}
            serviceKey={serviceKey}
            canAct={canAct && inc.row.phase !== "closed"}
          />
          <Hypotheses run={run} t={t} number={number} />
        </div>

        <div
          style={{
            flex: "1 1 300px",
            maxWidth: 360,
            minWidth: 270,
            display: "flex",
            flexDirection: "column",
            gap: 12,
          }}
        >
          <GradeCard
            run={run}
            t={t}
            number={number}
            canGrade={canAct && (inc.row.phase === "post_incident" || inc.row.phase === "closed")}
            resolved={Boolean(inc.row.resolvedAt)}
          />
          {canAct && inc.row.phase !== "closed" && (
            <div
              style={{
                ...panel,
                padding: "14px 16px",
                display: "flex",
                flexDirection: "column",
                gap: 9,
              }}
            >
              <div style={eyebrow}>{t("atlas.ui.tell.title")}</div>
              <form
                action={addInvestigationNote}
                data-testid="atlas-tell"
                style={{ display: "flex", flexDirection: "column", gap: 9 }}
              >
                <input type="hidden" name="number" value={number} />
                <textarea
                  name="body"
                  required
                  minLength={3}
                  maxLength={2000}
                  rows={3}
                  placeholder={t("atlas.ui.tell.placeholder")}
                  className="oi-field"
                  style={{
                    border: "1px solid var(--line)",
                    borderRadius: 10,
                    padding: "9px 11px",
                    fontSize: 12.5,
                    lineHeight: 1.5,
                    resize: "vertical",
                    outline: "none",
                    fontFamily: "inherit",
                    background: "var(--panel)",
                    color: "var(--ink)",
                  }}
                />
                <button
                  type="submit"
                  disabled={!access.ok}
                  className="oi-hover-brand-2"
                  style={{
                    alignSelf: "flex-start",
                    height: 30,
                    padding: "0 12px",
                    borderRadius: 8,
                    border: 0,
                    background: "var(--brand)",
                    color: "#fff",
                    display: "flex",
                    alignItems: "center",
                    fontSize: 12,
                    fontWeight: 600,
                    cursor: "pointer",
                    fontFamily: "inherit",
                  }}
                >
                  {t("atlas.ui.tell.send")}
                </button>
              </form>
            </div>
          )}
          <CostCard run={run} t={t} />
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
            {t("atlas.ui.allowedNote")}
          </div>
        </div>
      </div>
    </div>
  );
}

function citationLabel(c: Citation | undefined, id: string): string {
  return c ? c.label : id;
}

function WhereThingsStand({
  run,
  t,
  lastUpdate,
}: {
  run: AtlasRun;
  t: Translate;
  lastUpdate: Date;
}) {
  const inv = run.inv!;
  const cites = new Map(inv.citations.map((c) => [c.id, c]));
  const top = inv.hypotheses.find((h) => h.id === inv.summary?.topHypothesisId) ?? null;
  const findings = top ? inv.findings.filter((f) => top.findings.includes(f.id)) : [];
  // What's going on: what the alerts and the telemetry say, first.
  const goingCites = inv.citations
    .filter((c) => c.kind === "alert" || c.kind === "telemetry")
    .slice(0, 3)
    .map((c) => c.label);
  const steps = namedSteps(run.actions);
  const undoable = run.actions.filter((a) => canUndo(a) && !isUndone(a)).length;
  // The engine may write its own sentence; otherwise the journal's named steps.
  const engineDid = (inv.summary as unknown as { whatAtlasDid?: unknown } | null)?.whatAtlasDid;
  const didText =
    typeof engineDid === "string" && engineDid
      ? engineDid
      : steps.length
        ? steps
            .slice(0, 6)
            .map((a) => actionTitle(t, a))
            .join(" · ") +
          (steps.length > 6 ? ` · ${t("atlas.ui.more", { count: steps.length - 6 })}` : "")
        : null;
  const rows: Array<{ h: string; text: string | null; cites: string[] }> = [
    {
      h: t("atlas.ui.stand.going"),
      text: inv.summary?.whatsGoingOn ?? null,
      cites: goingCites,
    },
    {
      h: t("atlas.ui.stand.caused"),
      text: inv.summary?.whatCaused ?? top?.whatBroke ?? null,
      cites: findings.map(
        (f) =>
          `${f.id} · ${citationLabel(cites.get(f.citations[0] ?? ""), t(`ai.investigation.check.${f.check}`))}`,
      ),
    },
    {
      h: t("atlas.ui.stand.did"),
      text: didText,
      cites: run.actions.length
        ? [
            t("atlas.ui.stand.actions", { count: run.actions.length }),
            ...(undoable ? [t("atlas.ui.stand.undoable", { count: undoable })] : []),
          ]
        : [],
    },
    {
      h: t("atlas.ui.stand.next"),
      text: inv.summary?.nextSteps?.length ? inv.summary.nextSteps.join(" · ") : null,
      cites: top ? [top.id] : [],
    },
  ];
  return (
    <div style={{ ...panel, overflow: "hidden" }} data-testid="atlas-stand">
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "12px 18px",
          borderBottom: "1px solid var(--line-2)",
          flexWrap: "wrap",
        }}
      >
        <span style={{ fontSize: 14, fontWeight: 600 }}>{t("atlas.ui.stand.title")}</span>
        <span style={{ fontSize: 11, color: "var(--ink-3)" }}>
          {t("atlas.ui.stand.hint", { time: t.fmt.time(lastUpdate, t.timeZone) })}
        </span>
      </div>
      {rows.map((r) => (
        <div
          key={r.h}
          style={{
            display: "grid",
            gridTemplateColumns: "150px minmax(0,1fr)",
            gap: 14,
            padding: "12px 18px",
            borderTop: "1px solid var(--line-2)",
          }}
        >
          <span
            style={{
              fontSize: 11,
              fontWeight: 700,
              letterSpacing: ".08em",
              textTransform: "uppercase",
              color: "var(--ink-3)",
              paddingTop: 2,
            }}
          >
            {r.h}
          </span>
          <div style={{ display: "flex", flexDirection: "column", gap: 6, minWidth: 0 }}>
            <span
              style={{
                fontSize: 13.5,
                lineHeight: 1.6,
                textWrap: "pretty",
                color: r.text ? "var(--ink)" : "var(--ink-3)",
              }}
            >
              {r.text ?? t("atlas.ui.stand.notYet")}
            </span>
            {r.cites.length > 0 && (
              <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                {r.cites.map((c, i) => (
                  <span key={i} style={sourcePill} title={c}>
                    {c}
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

function JournalCard({
  run,
  t,
  serviceKey,
  canAct,
}: {
  run: AtlasRun;
  t: Translate;
  serviceKey: string | null;
  canAct: boolean;
}) {
  const now = Date.now();
  const rows: JournalRow[] = run.actions.map((a) => {
    const undone = isUndone(a);
    const chips: JournalRow["chips"] = [];
    if (undone) {
      chips.push({
        label: a.undoneByMemberId
          ? t("atlas.ui.chip.undoneBy", { name: run.names.get(a.undoneByMemberId) ?? "—" })
          : t("atlas.ui.chip.undone"),
        tone: "dang",
      });
    } else {
      if (a.kind === "human") chips.push({ label: t("atlas.ui.chip.human"), tone: "ok" });
      if (a.autonomous && a.kind !== "human")
        chips.push({ label: t("atlas.ui.chip.autonomous"), tone: "viol" });
      if (a.approvalState === "waiting" && a.approvalRequestedAt)
        chips.push({
          label: t("atlas.ui.chip.waiting", {
            duration: t.fmt.duration((now - a.approvalRequestedAt.getTime()) / 60_000),
          }),
          tone: "wait",
        });
      if (a.approvalState === "approved" && a.approvalRequestedAt) {
        // How long it waited for a person: until approved, else until it ran.
        const approvedAt =
          typeof a.payload.approvedAt === "string" ? new Date(a.payload.approvedAt) : null;
        const until = approvedAt && !Number.isNaN(approvedAt.getTime()) ? approvedAt : a.executedAt;
        if (until)
          chips.push({
            label: t("atlas.ui.chip.waiting", {
              duration: t.fmt.duration(
                (until.getTime() - a.approvalRequestedAt.getTime()) / 60_000,
              ),
            }),
            tone: "wait",
          });
      }
      if (a.approvalState === "rejected")
        chips.push({ label: t("atlas.ui.chip.rejected"), tone: "dang" });
      if (a.approvalState === "withdrawn")
        chips.push({ label: t("atlas.ui.chip.withdrawn"), tone: "mute" });
      if (a.approvalState !== "none" && a.level != null)
        chips.push({
          label: t("atlas.ui.chip.level", {
            level: a.level,
            name: t(`atlas.ui.level.${levelKey(a.level)}`),
          }),
          tone: "mute",
        });
      if (a.reversible && a.executedAt && a.kind === "system")
        chips.push({ label: t("atlas.ui.chip.reversible"), tone: "ok" });
      if (a.verifiedAt)
        chips.push({
          label: t("atlas.ui.chip.verified", { time: t.fmt.time(a.verifiedAt, t.timeZone) }),
          tone: "ok",
        });
      if (typeof a.payload.durationMs === "number" && a.payload.durationMs > 0)
        chips.push({
          label: t("atlas.ui.chip.seconds", {
            count: Math.max(1, Math.round(a.payload.durationMs / 1000)),
          }),
          tone: "mute",
        });
    }
    return {
      id: a.id,
      at: a.at.getTime(),
      time: t.fmt.time(a.at, t.timeZone),
      kind: a.kind,
      what: actionTitle(t, a),
      how: a.detail,
      chips,
      undone,
      autonomous: a.autonomous,
      button: !canAct
        ? null
        : a.approvalState === "waiting"
          ? "decide"
          : canUndo(a)
            ? undone
              ? "redo"
              : "undo"
            : null,
    };
  });
  // What people told Atlas is part of the run: credited, in its place.
  for (const n of run.inv?.notes ?? []) {
    const at = new Date(n.at);
    rows.push({
      id: n.id,
      at: at.getTime(),
      time: t.fmt.time(at, t.timeZone),
      kind: "human",
      what: t("atlas.ui.journal.told", { name: n.memberName }),
      how: `“${n.body}”`,
      chips: [{ label: t("atlas.ui.chip.credited"), tone: "ok" }],
      undone: false,
      autonomous: false,
      button: null,
    });
  }
  rows.sort((a, b) => a.at - b.at);
  const gain = gainAtNextLevel(run.actions, run.inv?.levelAtStart ?? null);
  return (
    <div style={{ ...panel, overflow: "hidden" }}>
      <AtlasJournal rows={rows} />
      {gain && serviceKey && <GainBox run={run} t={t} gain={gain} serviceKey={serviceKey} />}
    </div>
  );
}

function GainBox({
  run,
  t,
  gain,
  serviceKey,
}: {
  run: AtlasRun;
  t: Translate;
  gain: NonNullable<ReturnType<typeof gainAtNextLevel>>;
  serviceKey: string;
}) {
  const approver = approverOf(run.actions, gain.action, run.names);
  const params = {
    title: fixName(gain.action),
    time: t.fmt.time(gain.at, t.timeZone),
    minutes:
      gain.minutes < 60
        ? t("atlas.ui.minutes", { count: gain.minutes })
        : t.fmt.duration(gain.minutes),
    ...(approver ? { name: approver } : {}),
  };
  const sentence = approver
    ? t("atlas.ui.gain.body", params)
    : t("atlas.ui.gain.bodyNoName", params);
  const a = run.autonomy;
  let tail = "";
  if (a && a.effective >= 3)
    tail = t("atlas.ui.gain.there", { service: serviceKey, level: a.effective });
  else if (a && a.level === 2) {
    const missing = a.next.criteria.filter((c) => !c.met).map((c) => criterionNeed(t, c));
    if (missing.length)
      tail = t("atlas.ui.gain.needs", {
        service: serviceKey,
        what: new Intl.ListFormat(t.locale.tag, { type: "conjunction" }).format(missing),
      });
  }
  return (
    <div
      data-testid="atlas-gain"
      style={{
        padding: "10px 18px",
        borderTop: "1px solid var(--line-2)",
        background: "var(--viol-t)",
        fontSize: 12.5,
        lineHeight: 1.55,
        color: "var(--ink)",
      }}
    >
      <strong style={{ color: "var(--viol)" }}>{t("atlas.ui.gain.lead", { level: 3 })}</strong>
      {sentence}
      {tail ? ` ${tail}` : ""}
    </div>
  );
}

function Hypotheses({ run, t, number }: { run: AtlasRun; t: Translate; number: number }) {
  const inv = run.inv!;
  if (inv.hypotheses.length === 0) return null;
  const top = inv.hypotheses.find((h) => h.id === inv.summary?.topHypothesisId) ?? null;
  const verdict = top?.challenge ?? inv.hypotheses.find((h) => h.challenge)?.challenge ?? null;
  return (
    <div style={{ ...panel, overflow: "hidden" }} data-testid="atlas-hypotheses">
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          padding: "12px 18px",
          borderBottom: "1px solid var(--line-2)",
          flexWrap: "wrap",
        }}
      >
        <span style={{ fontSize: 14, fontWeight: 600 }}>{t("atlas.ui.hyp.title")}</span>
        <span style={{ fontSize: 11.5, color: "var(--ink-3)" }}>{t("atlas.ui.hyp.hint")}</span>
        <span style={{ flex: 1 }} />
        <Link
          href={`/app/incidents/${number}?tab=rca`}
          style={{ fontSize: 12, fontWeight: 600, color: "var(--brand)", textDecoration: "none" }}
        >
          {t("atlas.ui.hyp.full")}
        </Link>
      </div>
      {inv.hypotheses.map((h) => {
        const x = h.state === "contradicted";
        const n = CONFIDENCE_BARS[h.confidence] ?? 0;
        const conf = x
          ? t("atlas.ui.hyp.contradicted")
          : t(`ai.investigation.confidence.${h.confidence}`);
        return (
          <div
            key={h.id}
            style={{
              display: "flex",
              gap: 12,
              padding: "11px 18px",
              borderTop: "1px solid var(--line-2)",
              alignItems: "center",
              flexWrap: "wrap",
              opacity: x ? 0.6 : 1,
            }}
          >
            <span
              style={{
                fontFamily: "var(--mono)",
                fontSize: 12,
                fontWeight: 700,
                color: "var(--viol)",
                width: 22,
              }}
            >
              {h.id}
            </span>
            <span
              style={{
                flex: "1 1 260px",
                fontSize: 13,
                lineHeight: 1.45,
                textDecoration: x ? "line-through" : "none",
              }}
            >
              {h.whatBroke}
            </span>
            <div style={{ display: "flex", gap: 3, alignItems: "center" }} title={conf}>
              {[0, 1, 2, 3, 4].map((i) => (
                <span
                  key={i}
                  style={{
                    width: 14,
                    height: 6,
                    borderRadius: 2,
                    background: i < n ? "var(--viol)" : "var(--line)",
                  }}
                />
              ))}
            </div>
            <span
              title={x && h.challenge ? h.challenge : undefined}
              style={{
                fontSize: 11,
                fontWeight: 600,
                color: x ? "var(--dang)" : CONFIDENCE_INK[h.confidence],
                width: 150,
                textAlign: "right",
              }}
            >
              {conf}
            </span>
          </div>
        );
      })}
      {verdict && (
        <div
          style={{
            padding: "10px 18px",
            borderTop: "1px solid var(--line-2)",
            fontSize: 12,
            color: "var(--ink-2)",
            lineHeight: 1.5,
          }}
        >
          <strong>{t("atlas.ui.hyp.challenger")}</strong> {verdict}
        </div>
      )}
    </div>
  );
}

function GradeCard({
  run,
  t,
  number,
  canGrade,
  resolved,
}: {
  run: AtlasRun;
  t: Translate;
  number: number;
  canGrade: boolean;
  resolved: boolean;
}) {
  const inv = run.inv!;
  const a = run.autonomy;
  const grader = inv.gradedByMemberId ? run.names.get(inv.gradedByMemberId) : null;
  let note: string;
  if (!resolved) note = t("atlas.ui.grade.open");
  else if (!inv.grade) note = t("atlas.ui.grade.pending");
  else if (!a) note = t("atlas.ui.grade.noService");
  else if (inv.grade === "bullseye" || inv.grade === "on_target") {
    const runs = a.next.criteria.find((c) => c.key === "gradedRuns");
    note = a.next.next
      ? t("atlas.ui.grade.counts", {
          service: a.key,
          level: a.next.next.level,
          runs: a.gradedRuns,
          target: runs?.target ?? a.gradedRuns,
          pct: a.rightPct == null ? "—" : t.fmt.decimal(a.rightPct, 0),
        })
      : t("atlas.ui.grade.top", { service: a.key });
  } else {
    const after = levelAfter(a.level, inv.grade === "miss" ? "miss" : "nowhere_near");
    note = t("atlas.ui.grade.costs", {
      grade: t(`ai.investigation.grade.${inv.grade}`),
      service: a.key,
      level: after,
    });
  }
  return (
    <div
      data-testid="atlas-grade"
      style={{ ...panel, padding: "14px 16px", display: "flex", flexDirection: "column", gap: 10 }}
    >
      <div style={{ display: "flex", alignItems: "center" }}>
        <span style={eyebrow}>{t("atlas.ui.grade.title")}</span>
        <span style={{ flex: 1 }} />
        {inv.grade && inv.gradedAt && (
          <span style={{ fontSize: 11, color: "var(--ink-3)" }}>
            {t("atlas.ui.grade.by", {
              name: grader ?? "—",
              date: t.fmt.dateCompact(inv.gradedAt),
            })}
          </span>
        )}
      </div>
      <form action={gradeInvestigation} style={{ display: "flex", gap: 4 }}>
        <input type="hidden" name="number" value={number} />
        {GRADES.map((g) => {
          const on = inv.grade === g;
          const tone = TONE[GRADE_TONE[g]];
          return (
            <button
              key={g}
              type="submit"
              name="grade"
              value={g}
              disabled={!canGrade}
              aria-pressed={on}
              data-testid={`atlas-grade-${g}`}
              style={{
                flex: 1,
                minWidth: 0,
                height: 30,
                borderRadius: 8,
                border: `1px solid ${on ? tone.ink : "var(--line)"}`,
                background: on ? tone.bg : "var(--panel)",
                color: on ? tone.ink : "var(--ink-3)",
                display: "grid",
                placeItems: "center",
                fontSize: 11,
                fontWeight: 700,
                lineHeight: 1.1,
                cursor: canGrade ? "pointer" : "default",
                fontFamily: "inherit",
                padding: "0 4px",
              }}
            >
              {t(`ai.investigation.grade.${g}`)}
            </button>
          );
        })}
      </form>
      <div style={{ fontSize: 12, color: "var(--ink-2)", lineHeight: 1.5 }}>{note}</div>
    </div>
  );
}

function CostCard({ run, t }: { run: AtlasRun; t: Translate }) {
  const steps = costSteps(run.actions);
  const inv = run.inv!;
  if (steps.length === 0 && inv.costEur <= 0 && inv.tokensTotal <= 0) return null;
  const provider = inv.provider ?? aiProviderLabel();
  const fmtTok = (n: number) => {
    const k = tokensShort(n);
    return k.k ? `${t.fmt.number(k.value)} k` : t.fmt.number(k.value);
  };
  const rows = steps.length
    ? steps
    : [{ label: t("atlas.ui.cost.total"), tokens: inv.tokensTotal, eur: inv.costEur }];
  return (
    <div style={{ ...panel, overflow: "hidden" }} data-testid="atlas-cost">
      <div style={{ ...eyebrow, padding: "12px 16px" }}>{t("atlas.ui.cost.title")}</div>
      {rows.map((c, i) => (
        <div
          key={i}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            padding: "7px 16px",
            borderTop: "1px solid var(--line-2)",
            fontSize: 12,
          }}
        >
          <span style={{ flex: 1, minWidth: 0 }}>{c.label}</span>
          <span style={{ fontFamily: "var(--mono)", color: "var(--ink-3)" }}>
            {fmtTok(c.tokens)}
          </span>
          <span
            style={{ fontFamily: "var(--mono)", fontWeight: 600, width: 52, textAlign: "right" }}
          >
            {t("atlas.ui.eur", { amount: t.fmt.amount(c.eur) })}
          </span>
        </div>
      ))}
      <div
        style={{
          padding: "8px 16px",
          borderTop: "1px solid var(--line-2)",
          fontSize: 11,
          color: "var(--ink-3)",
        }}
      >
        {run.capPerRunEur != null
          ? t("atlas.ui.cost.footerCap", {
              provider,
              cap: t("atlas.ui.eurShort", { amount: t.fmt.decimal(run.capPerRunEur, 2) }),
            })
          : t("atlas.ui.cost.footer", { provider })}
      </div>
    </div>
  );
}
