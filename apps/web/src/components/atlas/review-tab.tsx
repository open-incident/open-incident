import Link from "next/link";
import { getT, type Translate } from "@/i18n/server";
import { canRespond, currentMember } from "@/lib/session";
import { listServiceAutonomy } from "@/lib/atlas/queries";
import { UNDO_WINDOW_MS } from "@/lib/atlas/levels";
import { atlasAvailable, reviewQueue, type ReviewCard } from "./data";
import { canUndo, isUndone } from "./run";
import { KindBadge, levelKey, tokensShort } from "./ui";
import { actionTitle } from "./words";
import { ReviewActions } from "./review-actions";
import { UndoButton } from "./undo-button";

/** "today 02:12 – 02:19", "yesterday 16:21 – 16:31", "16 Oct · 23:40 – 23:44". */
export function whenRange(t: Translate, from: Date, to: Date): string {
  const day = (d: Date) => d.toLocaleDateString("en-CA", { timeZone: t.timeZone });
  const range = `${t.fmt.time(from, t.timeZone)} – ${t.fmt.time(to, t.timeZone)}`;
  const today = day(new Date());
  const yesterday = day(new Date(Date.now() - 86_400_000));
  if (day(from) === today) return t("atlas.ui.review.today", { range });
  if (day(from) === yesterday) return t("atlas.ui.review.yesterday", { range });
  return t("atlas.ui.review.onDate", { date: t.fmt.dateCompact(from), range });
}

/** The run in one line: "7 min · 0.62 € · 22 k tokens". */
export function runMeta(t: Translate, minutes: number, eur: number, tokens: number): string {
  const k = tokensShort(tokens);
  return [
    t.fmt.duration(minutes),
    t("atlas.ui.eur", { amount: t.fmt.amount(eur) }),
    k.k ? t("atlas.ui.tokensK", { count: k.value }) : t("atlas.ui.tokens", { count: k.value }),
  ].join(" · ");
}

/**
 * The review queue of autonomous resolutions (Incidents › ✦ Resolved by
 * Atlas): one card per incident Atlas resolved alone — what it was, the level
 * it ran at, who was told, every step with Undo while the 24 h last, the
 * sources it cited — and three verdicts. A verdict grades the run, and the
 * grades are what the service's autonomy is measured on. Owner: atlas-ui.
 */
export async function AtlasReviewTab({ tenantId }: { tenantId: string; memberId: string }) {
  const t = await getT();
  const [current, available] = await Promise.all([currentMember(), atlasAvailable()]);
  const cards = available ? await reviewQueue(tenantId) : [];
  const levels = new Map(
    available ? (await listServiceAutonomy(tenantId)).map((s) => [s.serviceId, s]) : [],
  );
  const acts = Boolean(current && canRespond(current.member));
  const pending = cards.filter((c) => c.reviewState === "pending").length;

  return (
    <div
      data-testid="atlas-review"
      style={{ display: "flex", flexDirection: "column", gap: 12, minWidth: 0 }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          flexWrap: "wrap",
          background: "var(--viol-t)",
          borderRadius: 12,
          padding: "10px 14px",
        }}
      >
        <span style={{ color: "var(--viol)", fontSize: 15 }}>✦</span>
        <span style={{ flex: "1 1 300px", fontSize: 13, lineHeight: 1.5, color: "var(--ink)" }}>
          {!available
            ? t("atlas.ui.review.unavailable")
            : pending
              ? t("atlas.ui.review.head", { count: pending })
              : t("atlas.ui.review.headDone")}
        </span>
        <span style={{ fontSize: 12, color: "var(--ink-2)", whiteSpace: "nowrap" }}>
          {t("atlas.ui.review.undo24")}
        </span>
      </div>

      {cards.map((c) => (
        <Card
          key={c.investigationId}
          c={c}
          t={t}
          acts={acts}
          levelNow={c.serviceId ? (levels.get(c.serviceId)?.effective ?? null) : null}
        />
      ))}

      {cards.length > 0 && (
        <div style={{ fontSize: 12, color: "var(--ink-3)", lineHeight: 1.5 }}>
          {t("atlas.ui.review.footnote")}
        </div>
      )}
    </div>
  );
}

function Card({
  c,
  t,
  acts,
  levelNow,
}: {
  c: ReviewCard;
  t: Translate;
  acts: boolean;
  levelNow: number | null;
}) {
  const open = c.reviewState === "pending";
  const svc = c.serviceKey ?? "—";
  const withinWindow = Date.now() - c.resolvedAt.getTime() <= UNDO_WINDOW_MS;
  const status =
    c.reviewState === "reopened"
      ? t("atlas.ui.review.status.reopened")
      : c.reviewState === "ok"
        ? t("atlas.ui.review.status.reviewed", { grade: t("ai.investigation.grade.on_target") })
        : c.reviewState === "miss"
          ? t("atlas.ui.review.status.reviewed", { grade: t("ai.investigation.grade.miss") })
          : !c.alone && c.told
            ? t("atlas.ui.review.status.told", {
                name: c.told.name.split(" ")[0] ?? c.told.name,
                time: t.fmt.time(c.told.at, t.timeZone),
              })
            : t("atlas.ui.review.status.nobody");
  const reopened = c.reviewState === "reopened";
  const verdict =
    c.reviewState === "ok"
      ? { text: t("atlas.ui.review.verdict.ok", { service: svc }), ink: "var(--ok)" }
      : c.reviewState === "miss"
        ? {
            text:
              levelNow != null
                ? t("atlas.ui.review.verdict.miss", { service: svc, level: levelNow })
                : t("atlas.ui.review.verdict.missNoLevel"),
            ink: "var(--wait)",
          }
        : reopened
          ? {
              text:
                levelNow != null
                  ? t("atlas.ui.review.verdict.reopen", { service: svc, level: levelNow })
                  : t("atlas.ui.review.verdict.reopenNoLevel"),
              ink: "var(--dang)",
            }
          : null;
  // Sources: what the steps cite, else what holds the leading hypothesis up.
  const byId = new Map(c.citations.map((x) => [x.id, x]));
  const cited = [...new Set(c.actions.flatMap((a) => a.sources))];
  const top = c.hypotheses.find((h) => h.id === c.topHypothesisId);
  const fallback = top
    ? c.findings.filter((f) => top.findings.includes(f.id)).flatMap((f) => f.citations)
    : [];
  const sources = [...new Set(cited.length ? cited : fallback)]
    .map((id) => byId.get(id)?.label ?? null)
    .filter((x): x is string => Boolean(x))
    .slice(0, 4);
  const minutes = (c.resolvedAt.getTime() - c.declaredAt.getTime()) / 60_000;
  const steps = c.actions.filter((a) => a.kind !== "human");

  return (
    <div
      data-testid="atlas-review-card"
      data-state={c.reviewState ?? "pending"}
      style={{
        background: "var(--panel)",
        border: `1px solid ${open ? "var(--viol)" : "var(--line)"}`,
        borderRadius: "var(--radius-card)",
        boxShadow: "var(--shadow-card)",
        overflow: "hidden",
        opacity: c.reviewState === "ok" ? 0.75 : 1,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "flex-start",
          gap: 12,
          padding: "14px 18px",
          flexWrap: "wrap",
        }}
      >
        <div
          style={{
            flex: "1 1 320px",
            minWidth: 0,
            display: "flex",
            flexDirection: "column",
            gap: 5,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <Link
              href={`/app/incidents/${c.number}?tab=atlas`}
              style={{
                fontFamily: "var(--mono)",
                fontSize: 11.5,
                fontWeight: 600,
                color: "var(--brand)",
                textDecoration: "none",
              }}
            >
              INC-{c.number}
            </Link>
            {c.severity && (
              <span
                style={{
                  fontSize: 10.5,
                  fontWeight: 700,
                  borderRadius: 999,
                  padding: "1px 8px",
                  background: "var(--sunk)",
                  color: "var(--ink-2)",
                }}
              >
                {c.severity}
              </span>
            )}
            {c.serviceKey && (
              <span style={{ fontFamily: "var(--mono)", fontSize: 11, color: "var(--ink-2)" }}>
                {c.serviceKey}
              </span>
            )}
            {c.levelAtStart != null && (
              <span
                style={{
                  fontSize: 10.5,
                  fontWeight: 700,
                  letterSpacing: ".04em",
                  textTransform: "uppercase",
                  borderRadius: 999,
                  padding: "1px 8px",
                  background: "var(--viol-t)",
                  color: "var(--viol)",
                }}
              >
                {t("atlas.ui.levelLong", {
                  level: c.levelAtStart,
                  name: t(`atlas.ui.level.${levelKey(c.levelAtStart)}`),
                })}
              </span>
            )}
            <span style={{ fontSize: 11.5, color: "var(--ink-3)" }}>
              {whenRange(t, c.declaredAt, c.resolvedAt)}
            </span>
          </div>
          <Link
            href={`/app/incidents/${c.number}?tab=atlas`}
            style={{
              fontSize: 15,
              fontWeight: 600,
              lineHeight: 1.35,
              color: "var(--ink)",
              textDecoration: "none",
            }}
          >
            {c.name}
          </Link>
          {c.summary && (
            <div style={{ fontSize: 12.5, color: "var(--ink-2)", lineHeight: 1.55 }}>
              {c.summary}
            </div>
          )}
        </div>
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "flex-end",
            gap: 4,
            flex: "none",
          }}
        >
          <span
            data-testid="atlas-review-status"
            style={{
              fontSize: 11,
              fontWeight: 600,
              borderRadius: 999,
              padding: "2px 10px",
              background: reopened ? "var(--dang-t)" : "var(--viol-t)",
              color: reopened ? "var(--dang)" : "var(--viol)",
              whiteSpace: "nowrap",
            }}
          >
            {status}
          </span>
          <span
            style={{
              fontFamily: "var(--mono)",
              fontSize: 11,
              color: "var(--ink-3)",
              whiteSpace: "nowrap",
            }}
          >
            {runMeta(t, minutes, c.costEur, c.tokensTotal)}
          </span>
        </div>
      </div>

      {steps.length > 0 && (
        <div
          style={{
            borderTop: "1px solid var(--line-2)",
            padding: "8px 18px 10px",
            display: "flex",
            flexDirection: "column",
            gap: 4,
          }}
        >
          {steps.map((a) => {
            const undone = isUndone(a);
            const offer = acts && open && withinWindow && canUndo(a);
            return (
              <div
                key={a.id}
                data-testid="atlas-review-step"
                style={{
                  display: "grid",
                  gridTemplateColumns: "44px 18px minmax(0,1fr) auto",
                  gap: 10,
                  alignItems: "center",
                  padding: "4px 0",
                }}
              >
                <span style={{ fontFamily: "var(--mono)", fontSize: 11, color: "var(--ink-3)" }}>
                  {t.fmt.time(a.at, t.timeZone)}
                </span>
                <KindBadge kind={a.kind} size={16} />
                <span
                  style={{
                    fontSize: 12.5,
                    lineHeight: 1.45,
                    textDecoration: undone ? "line-through" : "none",
                  }}
                >
                  {actionTitle(t, a)}
                </span>
                {offer ? (
                  <UndoButton
                    actionId={a.id}
                    undone={undone}
                    label={undone ? t("atlas.ui.redo") : t("atlas.ui.undo")}
                    variant="review"
                  />
                ) : (
                  <span />
                )}
              </div>
            );
          })}
        </div>
      )}

      <div
        style={{
          borderTop: "1px solid var(--line-2)",
          padding: "10px 18px",
          display: "flex",
          alignItems: "center",
          gap: 8,
          flexWrap: "wrap",
          background: "var(--sunk)",
        }}
      >
        <div style={{ display: "flex", gap: 4, flexWrap: "wrap", minWidth: 0 }}>
          {sources.map((s, i) => (
            <span
              key={i}
              title={s}
              style={{
                fontSize: 10.5,
                border: "1px solid var(--line)",
                background: "var(--panel)",
                borderRadius: 6,
                padding: "1px 7px",
                color: "var(--ink-2)",
                whiteSpace: "nowrap",
                maxWidth: 260,
                overflow: "hidden",
                textOverflow: "ellipsis",
              }}
            >
              {s}
            </span>
          ))}
        </div>
        <span style={{ flex: 1 }} />
        {open && acts && <ReviewActions investigationId={c.investigationId} number={c.number} />}
        {verdict && (
          <span style={{ fontSize: 12, fontWeight: 600, color: verdict.ink }}>{verdict.text}</span>
        )}
      </div>
    </div>
  );
}
