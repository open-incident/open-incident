import Link from "next/link";
import { withTenant, type EscalationGraph, type EscalationNode } from "@openincident/db";
import { isManagerRole } from "@openincident/config";
import { getT } from "@/i18n/server";
import { requireMember } from "@/lib/session";
import { listPaths, targetLabels } from "@/lib/oncall";
import { avatarTone, initials } from "@/lib/avatar";
import { OnCallRail } from "../rail";
import { AddNodeDialog, NewPathDialog } from "./dialogs";
import { discardDraft, publishPath, removeNode, testPath, updateNode } from "./actions";

/**
 * Escalation paths — the graph of the selected path drawn top-down (trigger,
 * conditions with their two branches, levels with who they page, the ack and
 * retry chips), the properties of the selected node on the right, the version
 * history, a dry run of who would be paged now, and publication of the draft.
 */
export default async function PathsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { tenant, member } = await requireMember();
  const t = await getT();
  const q = await searchParams;
  const manages = isManagerRole(member);
  const data = await withTenant(tenant.id, async (tx) => ({
    paths: await listPaths(tx, tenant.id),
    labels: await targetLabels(tx, tenant.id),
  }));
  const entry = data.paths.find((p) => p.path.id === q.path) ?? data.paths[0] ?? null;
  const graph: EscalationGraph = entry?.graph ?? { start: null, nodes: [] };
  const selected =
    graph.nodes.find((n) => n.id === q.node) ?? graph.nodes.find((n) => n.kind === "level") ?? null;
  const test = q.test
    ? (JSON.parse(Buffer.from(q.test, "base64url").toString()) as Array<{
        level: number;
        offset: number;
        members: string[];
        urgency: string;
        ack: number;
      }>)
    : null;
  const memberName = (id: string) => data.labels.members.find((m) => m.id === id)?.name ?? "—";
  const scheduleName = (id: string) => data.labels.schedules.find((s) => s.id === id)?.name ?? "—";
  const teamName = (id: string) => `#${id.slice(0, 6)}`;
  const setName = (id: string) => data.labels.workingHours.find((w) => w.id === id)?.name ?? "—";
  const targetLabel = (tg: Extract<EscalationNode, { kind: "level" }>["targets"][number]) =>
    tg.kind === "member"
      ? memberName(tg.memberId)
      : tg.kind === "schedule"
        ? `${t("oncall.targetSchedule")} · ${scheduleName(tg.scheduleId)} — ${t(`oncall.mode.${tg.mode}`)}`
        : `${t("oncall.targetTeam")} · ${teamName(tg.teamEntryId)}`;
  const condLabel = (n: Extract<EscalationNode, { kind: "condition" }>) =>
    n.test.type === "working_hours"
      ? t("oncall.condHours", { set: setName(n.test.setId) })
      : n.test.type === "priority"
        ? t("oncall.condPriority", { rank: n.test.maxRank + 1 })
        : t("oncall.condUrgency", { urgency: n.test.urgency });
  const nodeHref = (id: string) => `/app/on-call/paths?path=${entry?.path.id}&node=${id}`;

  /** Main chain: follow next / whenTrue; side branches are summarised beside their condition. */
  const chain: EscalationNode[] = [];
  let cursor = graph.start;
  const seen = new Set<string>();
  while (cursor && !seen.has(cursor)) {
    seen.add(cursor);
    const n = graph.nodes.find((x) => x.id === cursor);
    if (!n) break;
    chain.push(n);
    cursor = n.kind === "condition" ? n.whenTrue : n.kind === "reassign" ? null : n.next;
  }
  const branchSummary = (startId: string | null): EscalationNode[] => {
    const out: EscalationNode[] = [];
    let c = startId;
    const s = new Set<string>();
    while (c && !s.has(c) && out.length < 4) {
      s.add(c);
      const n = graph.nodes.find((x) => x.id === c);
      if (!n || seen.has(n.id)) break;
      out.push(n);
      c = n.kind === "condition" ? n.whenTrue : n.kind === "reassign" ? null : n.next;
    }
    return out;
  };
  let levelNo = 0;
  const tag = (text: string, bg: string, ink: string) => (
    <span
      style={{
        fontSize: 9.5,
        fontWeight: 700,
        background: bg,
        color: ink,
        borderRadius: 6,
        padding: "2px 7px",
      }}
    >
      {text}
    </span>
  );
  const chip = (text: string, tone: "dang" | "sunk" | "wait" = "sunk") => (
    <span
      style={{
        fontSize: 10.5,
        fontWeight: 600,
        background:
          tone === "dang" ? "var(--dang-t)" : tone === "wait" ? "var(--wait-t)" : "var(--sunk)",
        color: tone === "dang" ? "var(--dang)" : tone === "wait" ? "var(--wait)" : "var(--ink-2)",
        borderRadius: 999,
        padding: "2px 9px",
      }}
    >
      {text}
    </span>
  );
  const connector = (label?: string) => (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
      <div style={{ width: 2, height: 12, background: "var(--line-2)" }} />
      {label && (
        <span
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: 10,
            fontWeight: 600,
            color: "var(--ink-3)",
            border: "1px solid var(--line)",
            background: "var(--sunk)",
            borderRadius: 999,
            padding: "2px 9px",
          }}
        >
          {label}
        </span>
      )}
      <div style={{ width: 2, height: 12, background: "var(--line-2)" }} />
    </div>
  );
  const levelCard = (
    n: Extract<EscalationNode, { kind: "level" }>,
    no: number,
    offset: string,
    isSel: boolean,
  ) => {
    const first = n.targets[0];
    const name = first
      ? first.kind === "member"
        ? memberName(first.memberId)
        : first.kind === "schedule"
          ? scheduleName(first.scheduleId)
          : t("oncall.targetTeam")
      : "—";
    const tone = avatarTone(name);
    return (
      <Link
        href={nodeHref(n.id)}
        data-testid="path-level"
        style={{
          width: 400,
          maxWidth: "100%",
          border: isSel ? "1.5px solid var(--brand)" : "1px solid var(--line)",
          borderRadius: 14,
          background: "var(--panel)",
          textDecoration: "none",
          color: "inherit",
          display: "block",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            padding: "7px 13px",
            background: isSel ? "var(--brand-t)" : "transparent",
            borderBottom: `1px solid ${isSel ? "var(--brand-b)" : "var(--line-2)"}`,
            borderRadius: "13px 13px 0 0",
          }}
        >
          {tag(`${t("oncall.levelTag")} ${no}`, "var(--dang-t)", "var(--dang)")}
          <span style={{ flex: 1 }} />
          <span
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: 10.5,
              fontWeight: 600,
              color: isSel ? "var(--brand)" : "var(--ink-3)",
            }}
          >
            {offset}
          </span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 13px 7px" }}>
          <span
            style={{
              width: 30,
              height: 30,
              borderRadius: "50%",
              background: tone.bg,
              color: tone.ink,
              display: "grid",
              placeItems: "center",
              fontWeight: 700,
              fontSize: 10,
              flex: "none",
            }}
          >
            {first?.kind === "member" ? initials(name) : first?.kind === "schedule" ? "⟳" : "👥"}
          </span>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ fontSize: 13, fontWeight: 600 }}>
              {first ? targetLabel(first) : t("oncall.noTarget")}
            </div>
            <div style={{ fontSize: 11.5, color: "var(--ink-3)" }}>
              {n.targets.length > 1
                ? t("oncall.moreTargets", { count: n.targets.length - 1 })
                : first?.kind === "schedule"
                  ? t("oncall.currentOnCall")
                  : ""}
            </div>
          </div>
        </div>
        <div style={{ display: "flex", gap: 5, padding: "0 13px 11px", flexWrap: "wrap" }}>
          {chip(
            n.urgency === "high" ? t("oncall.urgencyHigh") : t("oncall.urgencyLow"),
            n.urgency === "high" ? "dang" : "sunk",
          )}
          {chip(t("oncall.ackIn", { count: n.ackTimeoutMinutes }))}
          {n.retries > 0 && chip(t("oncall.retries", { count: n.retries }))}
          {n.everyoneMustAck && chip(t("oncall.everyoneMustAck"), "wait")}
          {n.roundRobin && chip(t("oncall.roundRobin"))}
        </div>
      </Link>
    );
  };
  const smallCard = (n: EscalationNode, isSel: boolean) => (
    <Link
      href={nodeHref(n.id)}
      style={{
        width: 400,
        maxWidth: "100%",
        border: isSel
          ? "1.5px solid var(--brand)"
          : n.kind === "condition"
            ? "1px solid var(--note-b)"
            : "1px solid var(--line)",
        borderRadius: 14,
        padding: "12px 15px",
        background: n.kind === "condition" ? "var(--wait-t)" : "var(--panel)",
        display: "flex",
        gap: 11,
        alignItems: "center",
        textDecoration: "none",
        color: "inherit",
      }}
    >
      <span
        style={{
          width: 32,
          height: 32,
          borderRadius: 10,
          background: "var(--panel)",
          border: "1px solid var(--note-b)",
          color: n.kind === "condition" ? "var(--wait)" : "var(--viol)",
          display: "grid",
          placeItems: "center",
          fontSize: 15,
          flex: "none",
        }}
      >
        {n.kind === "condition" ? "⏱" : n.kind === "delay" ? "⏸" : n.kind === "retry" ? "↻" : "➜"}
      </span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 7, flexWrap: "wrap" }}>
          {tag(
            t(`oncall.nodeKind.${n.kind}`).toUpperCase(),
            "var(--panel)",
            n.kind === "condition" ? "var(--wait)" : "var(--viol)",
          )}
          <span style={{ fontSize: 13.5, fontWeight: 600 }}>
            {n.kind === "condition"
              ? condLabel(n)
              : n.kind === "delay"
                ? n.untilWorkingHoursSetId
                  ? t("oncall.delayUntil", { set: setName(n.untilWorkingHoursSetId) })
                  : t("oncall.delayMinutes", { count: n.minutes ?? 0 })
                : n.kind === "retry"
                  ? t("oncall.retryTo", { count: n.maxLoops, interval: n.intervalMinutes })
                  : n.kind === "reassign"
                    ? t("oncall.reassignTo", {
                        path: data.paths.find((p) => p.path.id === n.pathId)?.path.name ?? "—",
                      })
                    : ""}
          </span>
        </div>
        {n.kind === "condition" &&
          n.test.type === "working_hours" &&
          (() => {
            const w = data.labels.workingHours.find(
              (x) => x.id === (n.test as { setId: string }).setId,
            );
            return w ? (
              <div style={{ fontSize: 11.5, color: "var(--ink-3)" }}>
                {w.days.length === 5 ? t("oncall.weekdays") : w.days.join(",")} {w.startTime}–
                {w.endTime} · {w.timezone}
              </div>
            ) : null;
          })()}
      </div>
    </Link>
  );

  return (
    <div style={{ flex: 1, minHeight: 0, display: "flex" }}>
      <OnCallRail active={{ paths: true }} />
      <main style={{ flex: 1, minWidth: 0, padding: "16px 20px 24px", overflow: "auto" }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            marginBottom: 12,
            flexWrap: "wrap",
          }}
        >
          {data.paths.map((p) => (
            <Link
              key={p.path.id}
              href={`/app/on-call/paths?path=${p.path.id}`}
              style={{
                height: 30,
                padding: "0 12px",
                borderRadius: 999,
                border: `1px solid ${p.path.id === entry?.path.id ? "var(--brand)" : "var(--line)"}`,
                background: p.path.id === entry?.path.id ? "var(--brand)" : "var(--panel)",
                color: p.path.id === entry?.path.id ? "#fff" : "var(--ink-2)",
                display: "flex",
                alignItems: "center",
                fontSize: 12.5,
                fontWeight: 600,
                textDecoration: "none",
              }}
            >
              {p.path.name}
              {p.hasDraft && (
                <span
                  style={{
                    marginLeft: 6,
                    width: 6,
                    height: 6,
                    borderRadius: "50%",
                    background: p.path.id === entry?.path.id ? "#fff" : "var(--wait)",
                  }}
                />
              )}
            </Link>
          ))}
          {manages && <NewPathDialog />}
        </div>
        {!entry ? (
          <div
            style={{
              padding: 36,
              border: "1.5px dashed var(--line)",
              borderRadius: 14,
              color: "var(--ink-3)",
              fontSize: 13,
              textAlign: "center",
            }}
          >
            {t("oncall.noPaths")}
          </div>
        ) : (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 16, alignItems: "flex-start" }}>
            <div
              className="oi-panel"
              style={{ flex: "10 1 420px", minWidth: 400, padding: "18px 22px" }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 9,
                  flexWrap: "wrap",
                  marginBottom: 14,
                }}
              >
                <span style={{ fontFamily: "var(--font-title)", fontSize: 16, fontWeight: 600 }}>
                  {entry.path.name}
                </span>
                {entry.current ? (
                  <span
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 6,
                      padding: "3px 10px 3px 8px",
                      borderRadius: 999,
                      background: "var(--ok-t)",
                      color: "var(--ok)",
                      fontSize: 11.5,
                      fontWeight: 600,
                    }}
                  >
                    <span
                      style={{
                        width: 5,
                        height: 5,
                        borderRadius: "50%",
                        background: "currentColor",
                      }}
                    />
                    v{entry.current.version} · {t("oncall.published")}
                  </span>
                ) : (
                  <span
                    style={{
                      padding: "3px 10px",
                      borderRadius: 999,
                      background: "var(--wait-t)",
                      color: "var(--wait)",
                      fontSize: 11.5,
                      fontWeight: 600,
                    }}
                  >
                    {t("oncall.neverPublished")}
                  </span>
                )}
                {entry.hasDraft && (
                  <span
                    style={{
                      padding: "2px 8px",
                      borderRadius: 6,
                      background: "var(--wait-t)",
                      color: "var(--wait)",
                      fontSize: 10,
                      fontWeight: 700,
                    }}
                  >
                    {t("oncall.draftBadge")}
                  </span>
                )}
                <span style={{ fontSize: 12, color: "var(--ink-3)" }}>
                  {t("oncall.usedByRoutes", { count: entry.routes.length })}
                </span>
                <span style={{ flex: 1 }} />
                <Link
                  href={`/app/on-call/paths?path=${entry.path.id}${q.history ? "" : "&history=1"}`}
                  className="oi-hover"
                  style={{
                    height: 30,
                    padding: "0 12px",
                    border: "1px solid var(--line)",
                    borderRadius: 8,
                    background: "var(--panel)",
                    display: "flex",
                    alignItems: "center",
                    fontSize: 12.5,
                    fontWeight: 500,
                    color: "inherit",
                    textDecoration: "none",
                  }}
                >
                  {t("oncall.versionHistory")}
                </Link>
                <form action={testPath}>
                  <input type="hidden" name="pathId" value={entry.path.id} />
                  <button
                    type="submit"
                    data-testid="path-test"
                    className="oi-hover-edge-fill"
                    style={{
                      height: 30,
                      padding: "0 12px",
                      border: "1px solid var(--line)",
                      borderRadius: 8,
                      background: "var(--panel)",
                      fontSize: 12.5,
                      fontWeight: 600,
                      color: "var(--brand)",
                      cursor: "pointer",
                    }}
                  >
                    {t("oncall.testPath")}
                  </button>
                </form>
              </div>
              {q.history && (
                <div
                  style={{
                    marginBottom: 14,
                    border: "1px solid var(--line)",
                    borderRadius: 12,
                    overflow: "hidden",
                  }}
                >
                  {entry.versions.map((v) => (
                    <div
                      key={v.id}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 10,
                        padding: "8px 12px",
                        borderBottom: "1px solid var(--line-2)",
                        fontSize: 12.5,
                      }}
                    >
                      <span style={{ fontFamily: "var(--font-mono)", fontWeight: 600 }}>
                        v{v.version}
                      </span>
                      <span style={{ color: "var(--ink-3)" }}>{t.fmt.dateTime(v.publishedAt)}</span>
                      <span style={{ color: "var(--ink-3)" }}>
                        {v.publishedByMemberId ? memberName(v.publishedByMemberId) : "—"}
                      </span>
                      <span style={{ flex: 1 }} />
                      <span style={{ color: "var(--ink-3)" }}>
                        {t("oncall.levelsCount", {
                          count: v.graph.nodes.filter((n) => n.kind === "level").length,
                        })}
                      </span>
                      {v.id === entry.path.currentVersionId && (
                        <span
                          style={{
                            padding: "1px 7px",
                            borderRadius: 6,
                            background: "var(--ok-t)",
                            color: "var(--ok)",
                            fontSize: 10.5,
                            fontWeight: 700,
                          }}
                        >
                          {t("oncall.currentVersion")}
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              )}
              {test && (
                <div
                  data-testid="path-test-result"
                  style={{
                    marginBottom: 14,
                    border: "1px solid var(--brand-b)",
                    background: "var(--brand-t)",
                    borderRadius: 12,
                    padding: "10px 14px",
                    display: "flex",
                    flexDirection: "column",
                    gap: 6,
                    fontSize: 12.5,
                  }}
                >
                  <div style={{ fontWeight: 600, color: "var(--brand)" }}>
                    {t("oncall.testResultTitle")}
                  </div>
                  {test.map((l) => (
                    <div key={l.level} style={{ color: "var(--ink-2)" }}>
                      {t("oncall.testResultLine", {
                        level: l.level,
                        offset: l.offset,
                        members: l.members.join(", ") || t("oncall.nobody"),
                        ack: l.ack,
                      })}
                    </div>
                  ))}
                  {test.length === 0 && (
                    <div style={{ color: "var(--ink-2)" }}>{t("oncall.testResultEmpty")}</div>
                  )}
                </div>
              )}
              {q.published && (
                <div
                  role="status"
                  style={{
                    marginBottom: 14,
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    background: "var(--ok-t)",
                    border: "1px solid var(--ok)",
                    borderRadius: 12,
                    padding: "10px 14px",
                    fontSize: 13,
                    color: "var(--ink-2)",
                  }}
                >
                  <span
                    style={{ width: 8, height: 8, borderRadius: "50%", background: "var(--ok)" }}
                  />
                  {t("oncall.publishedAs", { version: q.published })}
                </div>
              )}

              <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-start" }}>
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 9,
                    border: "1px solid var(--line)",
                    background: "var(--sunk)",
                    borderRadius: 999,
                    padding: "5px 16px 5px 6px",
                  }}
                >
                  <span
                    style={{
                      width: 24,
                      height: 24,
                      borderRadius: "50%",
                      background: "var(--panel)",
                      border: "1px solid var(--line)",
                      color: "var(--wait)",
                      display: "grid",
                      placeItems: "center",
                      fontSize: 12,
                      flex: "none",
                    }}
                  >
                    ⚡
                  </span>
                  <span style={{ fontSize: 12, fontWeight: 600, color: "var(--ink-2)" }}>
                    {entry.routes.length > 0
                      ? t("oncall.triggerRoutes", {
                          routes: entry.routes.map((r) => `« ${r.name} »`).join(", "),
                        })
                      : t("oncall.triggerManual")}
                  </span>
                </div>
                <div
                  style={{
                    width: 2,
                    height: 20,
                    background: "linear-gradient(180deg, var(--line-2), var(--wait))",
                  }}
                />
                {chain.map((n, i) => {
                  const isSel = selected?.id === n.id;
                  const offset = chain
                    .slice(0, i)
                    .reduce(
                      (acc, x) =>
                        acc +
                        (x.kind === "level"
                          ? x.ackTimeoutMinutes
                          : x.kind === "delay"
                            ? (x.minutes ?? 0)
                            : 0),
                      0,
                    );
                  const prev = chain[i - 1];
                  const label =
                    prev?.kind === "level"
                      ? t("oncall.noAckWithin", { count: prev.ackTimeoutMinutes })
                      : undefined;
                  if (n.kind === "level") {
                    levelNo += 1;
                    return (
                      <div
                        key={n.id}
                        style={{
                          display: "flex",
                          flexDirection: "column",
                          alignItems: "flex-start",
                        }}
                      >
                        {i > 0 && connector(label)}
                        {levelCard(n, levelNo, offset === 0 ? "t+0" : `t+${offset} min`, isSel)}
                      </div>
                    );
                  }
                  if (n.kind === "condition") {
                    const falseBranch = branchSummary(n.whenFalse);
                    return (
                      <div
                        key={n.id}
                        style={{
                          display: "flex",
                          flexDirection: "column",
                          alignItems: "flex-start",
                          width: "100%",
                          maxWidth: 640,
                        }}
                      >
                        {i > 0 && connector(label)}
                        {smallCard(n, isSel)}
                        <div style={{ width: "100%", height: 26, display: "flex" }}>
                          <div
                            style={{
                              width: "25%",
                              height: 24,
                              borderTop: "2px solid var(--line-2)",
                              borderLeft: "2px solid var(--line-2)",
                              borderTopLeftRadius: 14,
                              marginLeft: "25%",
                            }}
                          />
                          <div
                            style={{
                              width: "25%",
                              height: 24,
                              borderTop: "2px solid var(--line-2)",
                              borderRight: "2px solid var(--line-2)",
                              borderTopRightRadius: 14,
                            }}
                          />
                        </div>
                        <div
                          style={{
                            display: "grid",
                            gridTemplateColumns: "1fr 1fr",
                            gap: 14,
                            width: "100%",
                          }}
                        >
                          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                            <span
                              style={{
                                fontSize: 10,
                                fontWeight: 700,
                                color: "var(--ok)",
                                background: "var(--ok-t)",
                                borderRadius: 999,
                                padding: "2px 10px",
                                width: "fit-content",
                              }}
                            >
                              ✓ {t("oncall.branchYes")}
                            </span>
                            <span style={{ fontSize: 11.5, color: "var(--ink-3)" }}>
                              {t("oncall.branchContinues")}
                            </span>
                          </div>
                          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                            <span
                              style={{
                                fontSize: 10,
                                fontWeight: 700,
                                color: "var(--wait)",
                                background: "var(--wait-t)",
                                borderRadius: 999,
                                padding: "2px 10px",
                                width: "fit-content",
                              }}
                            >
                              ☾ {t("oncall.branchNo")}
                            </span>
                            {falseBranch.length === 0 ? (
                              <span style={{ fontSize: 11.5, color: "var(--ink-3)" }}>
                                {t("oncall.branchEnds")}
                              </span>
                            ) : (
                              <div
                                style={{
                                  border: "1px solid var(--line)",
                                  borderRadius: 14,
                                  padding: "11px 13px",
                                  background: "var(--panel)",
                                  display: "flex",
                                  flexDirection: "column",
                                  gap: 6,
                                }}
                              >
                                {falseBranch.map((b) => (
                                  <Link
                                    key={b.id}
                                    href={nodeHref(b.id)}
                                    style={{
                                      fontSize: 12,
                                      color: "var(--ink-2)",
                                      textDecoration: "none",
                                      display: "flex",
                                      gap: 7,
                                      alignItems: "center",
                                    }}
                                  >
                                    {tag(
                                      t(`oncall.nodeKind.${b.kind}`).toUpperCase(),
                                      "var(--viol-t)",
                                      "var(--viol)",
                                    )}
                                    <span style={{ fontWeight: 600 }}>
                                      {b.kind === "condition"
                                        ? condLabel(b)
                                        : b.kind === "level"
                                          ? `${b.targets[0] ? targetLabel(b.targets[0]) : "—"} · ${b.urgency === "high" ? t("oncall.urgencyHigh") : t("oncall.urgencyLow")}`
                                          : b.kind === "delay"
                                            ? b.untilWorkingHoursSetId
                                              ? t("oncall.delayUntil", {
                                                  set: setName(b.untilWorkingHoursSetId),
                                                })
                                              : t("oncall.delayMinutes", { count: b.minutes ?? 0 })
                                            : b.kind === "retry"
                                              ? t("oncall.retryTo", {
                                                  count: b.maxLoops,
                                                  interval: b.intervalMinutes,
                                                })
                                              : t("oncall.nodeKind.reassign")}
                                    </span>
                                  </Link>
                                ))}
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  }
                  return (
                    <div
                      key={n.id}
                      style={{ display: "flex", flexDirection: "column", alignItems: "flex-start" }}
                    >
                      {i > 0 && connector(label)}
                      {smallCard(n, isSel)}
                    </div>
                  );
                })}
                <div style={{ width: 1.5, height: 18, background: "var(--line)" }} />
                {manages ? (
                  <AddNodeDialog
                    pathId={entry.path.id}
                    labels={{
                      schedules: data.labels.schedules,
                      members: data.labels.members.map((m) => ({ id: m.id, name: m.name })),
                      workingHours: data.labels.workingHours.map((w) => ({
                        id: w.id,
                        name: w.name,
                      })),
                      paths: data.paths
                        .filter((p) => p.path.id !== entry.path.id)
                        .map((p) => ({ id: p.path.id, name: p.path.name })),
                      levels: graph.nodes
                        .filter((n) => n.kind === "level")
                        .map((n) => ({ id: n.id })),
                    }}
                  />
                ) : (
                  <div style={{ fontSize: 12, color: "var(--ink-3)" }}>{t("oncall.readOnly")}</div>
                )}
              </div>
            </div>

            <div
              style={{
                flex: "1 1 280px",
                maxWidth: 340,
                minWidth: 260,
                display: "flex",
                flexDirection: "column",
                gap: 12,
              }}
            >
              {selected && (
                <form
                  action={updateNode}
                  data-testid="node-props"
                  className="oi-panel"
                  style={{
                    padding: "14px 16px",
                    display: "flex",
                    flexDirection: "column",
                    gap: 10,
                  }}
                >
                  <input type="hidden" name="pathId" value={entry.path.id} />
                  <input type="hidden" name="nodeId" value={selected.id} />
                  <div className="oi-eyebrow">
                    {t("oncall.nodeProps", { kind: t(`oncall.nodeKind.${selected.kind}`) })}
                  </div>
                  {selected.kind === "level" && (
                    <>
                      <label
                        style={{
                          display: "flex",
                          flexDirection: "column",
                          gap: 6,
                          fontSize: 12.5,
                          fontWeight: 600,
                          color: "var(--ink-2)",
                        }}
                      >
                        {t("oncall.target")}
                        <select
                          name="target"
                          defaultValue={
                            selected.targets[0]
                              ? selected.targets[0].kind === "member"
                                ? `member:${selected.targets[0].memberId}`
                                : selected.targets[0].kind === "team"
                                  ? `team:${selected.targets[0].teamEntryId}`
                                  : `schedule:${selected.targets[0].scheduleId}:${selected.targets[0].mode}`
                              : ""
                          }
                          disabled={!manages}
                          className="oi-field"
                          style={{
                            height: 38,
                            padding: "0 11px",
                            border: "1px solid var(--line)",
                            borderRadius: 9,
                            fontSize: 12.5,
                            background: "var(--panel)",
                          }}
                        >
                          <optgroup label={t("oncall.schedules")}>
                            {data.labels.schedules.flatMap((s) =>
                              (["current", "next", "everyone"] as const).map((mode) => (
                                <option key={`${s.id}:${mode}`} value={`schedule:${s.id}:${mode}`}>
                                  {s.name} — {t(`oncall.mode.${mode}`)}
                                </option>
                              )),
                            )}
                          </optgroup>
                          <optgroup label={t("oncall.members")}>
                            {data.labels.members.map((m) => (
                              <option key={m.id} value={`member:${m.id}`}>
                                {m.name}
                              </option>
                            ))}
                          </optgroup>
                        </select>
                      </label>
                      <div
                        style={{
                          display: "flex",
                          flexDirection: "column",
                          gap: 6,
                          fontSize: 12.5,
                          fontWeight: 600,
                          color: "var(--ink-2)",
                        }}
                      >
                        {t("oncall.urgency")}
                        <div
                          style={{
                            display: "flex",
                            gap: 2,
                            background: "var(--sunk)",
                            borderRadius: 9,
                            padding: 3,
                          }}
                        >
                          {(["high", "low"] as const).map((u) => (
                            <label
                              key={u}
                              style={{
                                flex: 1,
                                padding: "6px 0",
                                borderRadius: 7,
                                textAlign: "center",
                                fontSize: 12.5,
                                fontWeight: 600,
                                cursor: "pointer",
                                background: selected.urgency === u ? "var(--panel)" : "transparent",
                                color: selected.urgency === u ? "var(--ink)" : "var(--ink-3)",
                              }}
                            >
                              <input
                                type="radio"
                                name="urgency"
                                value={u}
                                defaultChecked={selected.urgency === u}
                                style={{ display: "none" }}
                              />
                              {u === "high" ? t("oncall.urgencyHighWakes") : t("oncall.urgencyLow")}
                            </label>
                          ))}
                        </div>
                      </div>
                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                        <label
                          style={{
                            display: "flex",
                            flexDirection: "column",
                            gap: 6,
                            fontSize: 12.5,
                            fontWeight: 600,
                            color: "var(--ink-2)",
                          }}
                        >
                          {t("oncall.ackTimeout")}
                          <select
                            name="ackTimeoutMinutes"
                            defaultValue={selected.ackTimeoutMinutes}
                            className="oi-field"
                            style={{
                              height: 36,
                              padding: "0 11px",
                              border: "1px solid var(--line)",
                              borderRadius: 9,
                              fontSize: 12.5,
                              background: "var(--panel)",
                            }}
                          >
                            {[1, 2, 3, 5, 10, 15, 20, 30, 60].map((m) => (
                              <option key={m} value={m}>
                                {m} min
                              </option>
                            ))}
                          </select>
                        </label>
                        <label
                          style={{
                            display: "flex",
                            flexDirection: "column",
                            gap: 6,
                            fontSize: 12.5,
                            fontWeight: 600,
                            color: "var(--ink-2)",
                          }}
                        >
                          {t("oncall.retriesLabel")}
                          <select
                            name="retries"
                            defaultValue={selected.retries}
                            className="oi-field"
                            style={{
                              height: 36,
                              padding: "0 11px",
                              border: "1px solid var(--line)",
                              borderRadius: 9,
                              fontSize: 12.5,
                              background: "var(--panel)",
                            }}
                          >
                            {[0, 1, 2, 3, 5].map((r) => (
                              <option key={r} value={r}>
                                {r === 0
                                  ? t("oncall.noRetry")
                                  : t("oncall.retriesEvery", {
                                      count: r,
                                      interval: selected.retryIntervalMinutes,
                                    })}
                              </option>
                            ))}
                          </select>
                        </label>
                      </div>
                      <input
                        type="hidden"
                        name="retryIntervalMinutes"
                        value={selected.retryIntervalMinutes}
                      />
                      <label
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 10,
                          fontSize: 12.5,
                          color: "var(--ink-2)",
                        }}
                      >
                        <input
                          type="checkbox"
                          name="roundRobin"
                          defaultChecked={Boolean(selected.roundRobin)}
                        />{" "}
                        {t("oncall.roundRobinLabel")}
                      </label>
                      <label
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 10,
                          fontSize: 12.5,
                          color: "var(--ink-2)",
                        }}
                      >
                        <input
                          type="checkbox"
                          name="everyoneMustAck"
                          defaultChecked={Boolean(selected.everyoneMustAck)}
                        />{" "}
                        {t("oncall.everyoneMustAck")}
                      </label>
                    </>
                  )}
                  {selected.kind === "delay" && (
                    <>
                      <label
                        style={{
                          display: "flex",
                          flexDirection: "column",
                          gap: 6,
                          fontSize: 12.5,
                          fontWeight: 600,
                          color: "var(--ink-2)",
                        }}
                      >
                        {t("oncall.delayMinutesLabel")}
                        <input
                          name="minutes"
                          type="number"
                          min={1}
                          max={1440}
                          defaultValue={selected.minutes ?? 15}
                          className="oi-field"
                          style={{
                            height: 36,
                            padding: "0 11px",
                            border: "1px solid var(--line)",
                            borderRadius: 9,
                            fontSize: 12.5,
                          }}
                        />
                      </label>
                      <label
                        style={{
                          display: "flex",
                          flexDirection: "column",
                          gap: 6,
                          fontSize: 12.5,
                          fontWeight: 600,
                          color: "var(--ink-2)",
                        }}
                      >
                        {t("oncall.delayUntilLabel")}
                        <select
                          name="untilWorkingHoursSetId"
                          defaultValue={selected.untilWorkingHoursSetId ?? ""}
                          className="oi-field"
                          style={{
                            height: 36,
                            padding: "0 11px",
                            border: "1px solid var(--line)",
                            borderRadius: 9,
                            fontSize: 12.5,
                            background: "var(--panel)",
                          }}
                        >
                          <option value="">{t("oncall.fixedDelay")}</option>
                          {data.labels.workingHours.map((w) => (
                            <option key={w.id} value={w.id}>
                              {w.name}
                            </option>
                          ))}
                        </select>
                      </label>
                    </>
                  )}
                  {selected.kind === "retry" && (
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                      <label
                        style={{
                          display: "flex",
                          flexDirection: "column",
                          gap: 6,
                          fontSize: 12.5,
                          fontWeight: 600,
                          color: "var(--ink-2)",
                        }}
                      >
                        {t("oncall.maxLoops")}
                        <input
                          name="maxLoops"
                          type="number"
                          min={1}
                          max={10}
                          defaultValue={selected.maxLoops}
                          className="oi-field"
                          style={{
                            height: 36,
                            padding: "0 11px",
                            border: "1px solid var(--line)",
                            borderRadius: 9,
                            fontSize: 12.5,
                          }}
                        />
                      </label>
                      <label
                        style={{
                          display: "flex",
                          flexDirection: "column",
                          gap: 6,
                          fontSize: 12.5,
                          fontWeight: 600,
                          color: "var(--ink-2)",
                        }}
                      >
                        {t("oncall.intervalMinutes")}
                        <input
                          name="intervalMinutes"
                          type="number"
                          min={1}
                          max={120}
                          defaultValue={selected.intervalMinutes}
                          className="oi-field"
                          style={{
                            height: 36,
                            padding: "0 11px",
                            border: "1px solid var(--line)",
                            borderRadius: 9,
                            fontSize: 12.5,
                          }}
                        />
                      </label>
                    </div>
                  )}
                  {(selected.kind === "condition" || selected.kind === "reassign") && (
                    <div style={{ fontSize: 12.5, color: "var(--ink-3)" }}>
                      {t("oncall.nodeNoProps")}
                    </div>
                  )}
                  {manages && (
                    <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                      <button
                        type="submit"
                        data-testid="node-save"
                        style={{
                          height: 32,
                          padding: "0 13px",
                          borderRadius: 8,
                          background: "var(--brand)",
                          color: "#fff",
                          border: 0,
                          fontSize: 12.5,
                          fontWeight: 600,
                          cursor: "pointer",
                        }}
                      >
                        {t("oncall.saveDraft")}
                      </button>
                      <button
                        type="submit"
                        formAction={removeNode}
                        className="oi-hover-dang"
                        style={{
                          height: 32,
                          padding: "0 11px",
                          border: "1px solid var(--line)",
                          borderRadius: 8,
                          background: "var(--panel)",
                          fontSize: 12,
                          color: "var(--dang)",
                          cursor: "pointer",
                        }}
                      >
                        {t("oncall.removeNode")}
                      </button>
                    </div>
                  )}
                </form>
              )}
              {entry.hasDraft && manages && (
                <div
                  className="oi-panel"
                  style={{ padding: "14px 16px", display: "flex", flexDirection: "column", gap: 8 }}
                >
                  <div style={{ fontSize: 13, fontWeight: 600 }}>
                    {t("oncall.draftTitle", { version: (entry.current?.version ?? 0) + 1 })}
                  </div>
                  <div style={{ fontSize: 12.5, color: "var(--ink-3)" }}>
                    {t("oncall.draftNote", {
                      current: entry.current?.version ?? 0,
                      next: (entry.current?.version ?? 0) + 1,
                    })}
                  </div>
                  <div style={{ display: "flex", gap: 8 }}>
                    <form action={publishPath}>
                      <input type="hidden" name="pathId" value={entry.path.id} />
                      <button
                        type="submit"
                        data-testid="path-publish"
                        style={{
                          height: 32,
                          padding: "0 13px",
                          borderRadius: 8,
                          background: "var(--brand)",
                          color: "#fff",
                          border: 0,
                          fontSize: 12.5,
                          fontWeight: 600,
                          cursor: "pointer",
                        }}
                      >
                        {t("oncall.publishVersion", { version: (entry.current?.version ?? 0) + 1 })}
                      </button>
                    </form>
                    {entry.current && (
                      <form action={discardDraft}>
                        <input type="hidden" name="pathId" value={entry.path.id} />
                        <button
                          type="submit"
                          className="oi-hover"
                          style={{
                            height: 32,
                            padding: "0 11px",
                            border: "1px solid var(--line)",
                            borderRadius: 8,
                            background: "var(--panel)",
                            fontSize: 12,
                            cursor: "pointer",
                          }}
                        >
                          {t("oncall.discardDraft")}
                        </button>
                      </form>
                    )}
                  </div>
                </div>
              )}
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
                {t("oncall.engineNote")}
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
