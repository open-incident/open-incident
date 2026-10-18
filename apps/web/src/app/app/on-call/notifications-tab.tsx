import Link from "next/link";
import { and, asc, desc, eq } from "drizzle-orm";
import {
  notificationDeliveries,
  notificationMethods,
  notificationRules,
  withTenant,
  type NotificationStep,
} from "@openincident/db";
import { availableChannels, defaultSteps } from "@openincident/oncall";
import { getSlackInstall, getTeamsInstall } from "@openincident/chat";
import { canOpenSettings, requireMember } from "@/lib/session";
import { getT } from "@/i18n/server";
import { AtlasNotifyCard } from "@/components/atlas/notify-card";
import { PushButton } from "./notifications/push-button";
import {
  addPhoneMethod,
  linkSlackMethod,
  linkTeamsMethod,
  removeMethod,
  saveShiftReminders,
  sendTest,
  updateRule,
  verifyMethod,
} from "./notifications/actions";

type Kind = NotificationStep["kind"];

const CARD: React.CSSProperties = {
  background: "var(--panel)",
  border: "1px solid var(--line)",
  borderRadius: "var(--radius-card)",
  boxShadow: "var(--shadow-card)",
  padding: "16px 18px",
  display: "flex",
  flexDirection: "column",
  gap: 10,
};

const FIELD: React.CSSProperties = {
  height: 30,
  padding: "0 8px",
  border: "1px solid var(--line)",
  borderRadius: 8,
  background: "var(--panel)",
  fontSize: 12.5,
};

const CTA: React.CSSProperties = {
  height: 30,
  padding: "0 13px",
  borderRadius: 9,
  background: "var(--brand)",
  color: "var(--on-brand)",
  border: 0,
  display: "flex",
  alignItems: "center",
  fontSize: 12.5,
  fontWeight: 600,
  textDecoration: "none",
  cursor: "pointer",
  whiteSpace: "nowrap",
};

/** One line of a rule card: every step that goes out at the same moment. */
type StepGroup = { key: string; delayMinutes: number; at: string | null; kinds: Kind[] };

function groupSteps(steps: NotificationStep[]): StepGroup[] {
  const groups: StepGroup[] = [];
  for (const s of steps) {
    const key = s.at ? `at:${s.at}` : `+${s.delayMinutes}`;
    const hit = groups.find((g) => g.key === key);
    if (hit) {
      if (!hit.kinds.includes(s.kind)) hit.kinds.push(s.kind);
    } else groups.push({ key, delayMinutes: s.delayMinutes, at: s.at ?? null, kinds: [s.kind] });
  }
  return groups.sort((a, b) => (a.at ? 1 : 0) - (b.at ? 1 : 0) || a.delayMinutes - b.delayMinutes);
}

/**
 * On-call · My notifications — the addresses that can reach me, the two rules
 * that decide in which order they are tried, and what Atlas tells me when it
 * resolves something on its own.
 *
 * A channel this instance cannot send on is drawn as a dashed row that names
 * what is missing: the one thing this screen must never do is offer a button
 * that pretends to ring a phone nobody can call. The statuses on the rows are
 * the last real deliveries: queued → sent → delivered.
 */
export async function NotificationsTab({ q }: { q: Record<string, string | undefined> }) {
  const { tenant, member } = await requireMember();
  const t = await getT();
  const available = availableChannels();
  const data = await withTenant(tenant.id, async (tx) => ({
    methods: await tx
      .select()
      .from(notificationMethods)
      .where(
        and(
          eq(notificationMethods.tenantId, tenant.id),
          eq(notificationMethods.memberId, member.id),
        ),
      ),
    rules: await tx
      .select()
      .from(notificationRules)
      .where(eq(notificationRules.memberId, member.id)),
    recent: await tx
      .select()
      .from(notificationDeliveries)
      .where(eq(notificationDeliveries.memberId, member.id))
      // Same instant, two channels: the immediate one above the deferred one.
      .orderBy(desc(notificationDeliveries.createdAt), asc(notificationDeliveries.sendAfter))
      .limit(30),
    slack: await getSlackInstall(tx, tenant.id),
    teams: await getTeamsInstall(tx, tenant.id),
  }));

  const phones = data.methods.filter((m) => m.kind === "sms" || m.kind === "voice");
  const pushes = data.methods.filter((m) => m.kind === "webpush");
  const slackMethod = data.methods.find((m) => m.kind === "slack") ?? null;
  const teamsMethod = data.methods.find((m) => m.kind === "teams") ?? null;
  const verifying = q.verify ? data.methods.find((m) => m.id === q.verify && !m.verifiedAt) : null;
  const admin = canOpenSettings(member);

  // An administrator may turn pages in chat off for the workspace (Settings › Slack & Teams).
  const slackOn = Boolean(data.slack && available.includes("slack") && data.slack.settings.dmPages);
  const teamsOn = Boolean(data.teams && available.includes("teams") && data.teams.settings.dmPages);

  /** Whether a step on this channel would really go out: the instance can send, and I have an address. */
  const usable = (kind: Kind) =>
    available.includes(kind) &&
    (kind !== "slack" || slackOn) &&
    (kind !== "teams" || teamsOn) &&
    (kind === "email" || data.methods.some((m) => m.kind === kind && m.verifiedAt));

  /** The chip: what really happened last on that channel, else how it stands. */
  const lastChip = (kind: Kind): { text: string; tone: "ok" | "wait" | "dang" } | null => {
    const last = data.recent.find((d) => d.methodKind === kind && d.kind !== "verification");
    if (!last) return null;
    if (last.status === "failed") return { text: t("oc2.notif.stFailed"), tone: "dang" };
    if (last.status === "queued") return { text: t("oc2.notif.stQueued"), tone: "wait" };
    if (last.status === "handled")
      return {
        text: t("oc2.notif.stHandled", {
          when: t.fmt.relativeCompact(last.handledAt ?? last.createdAt),
        }),
        tone: "ok",
      };
    if (last.status === "delivered")
      return {
        text: t("oc2.notif.stDelivered", {
          when: t.fmt.relativeCompact(last.deliveredAt ?? last.createdAt),
        }),
        tone: "ok",
      };
    return {
      text: t("oc2.notif.stSent", { when: t.fmt.relativeCompact(last.sentAt ?? last.createdAt) }),
      tone: "ok",
    };
  };

  const chip = (text: string, tone: "ok" | "wait" | "dang") => (
    <span
      data-testid="contact-status"
      style={{
        fontSize: 11,
        fontWeight: 700,
        borderRadius: 999,
        padding: "2px 9px",
        background:
          tone === "ok" ? "var(--ok-t)" : tone === "wait" ? "var(--wait-t)" : "var(--dang-t)",
        color: tone === "ok" ? "var(--ok)" : tone === "wait" ? "var(--wait)" : "var(--dang)",
        flex: "none",
        whiteSpace: "nowrap",
      }}
    >
      {text}
    </span>
  );

  const row = (key: string, kind: string, title: string, value: string, right: React.ReactNode) => (
    <div
      key={key}
      data-testid="contact-row"
      data-kind={kind}
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
        <div style={{ fontSize: 13, fontWeight: 600 }}>{title}</div>
        <div
          style={{
            fontSize: 12,
            color: "var(--ink-3)",
            fontFamily: "var(--mono)",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {value}
        </div>
      </div>
      {right}
    </div>
  );

  const dead = (key: string, title: string, why: string, right?: React.ReactNode) => (
    <div
      key={key}
      data-testid="contact-unavailable"
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        border: "1px dashed var(--line)",
        borderRadius: 11,
        padding: "10px 13px",
        color: "var(--ink-3)",
      }}
    >
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 600 }}>{title}</div>
        <div style={{ fontSize: 12, lineHeight: 1.45 }}>{why}</div>
      </div>
      {right}
    </div>
  );

  const bin = (id: string) => (
    <form action={removeMethod}>
      <input type="hidden" name="id" value={id} />
      <button
        type="submit"
        aria-label={t("common.delete")}
        className="oi-hover-dang"
        style={{
          width: 24,
          height: 24,
          border: 0,
          borderRadius: 6,
          background: "transparent",
          color: "var(--ink-3)",
          cursor: "pointer",
          fontSize: 12,
        }}
      >
        ✕
      </button>
    </form>
  );

  const linkedRight = (kind: Kind, id: string, fallback: string) => {
    const c = lastChip(kind);
    return (
      <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
        {c ? chip(c.text, c.tone) : chip(fallback, "ok")}
        {bin(id)}
      </div>
    );
  };

  const connectLink = (target: "slack" | "teams", settingsOnly = false) =>
    admin ? (
      <Link
        href={settingsOnly ? "/app/settings/chat" : `/app/settings/chat?connect=${target}&step=1`}
        style={{
          padding: "2px 8px",
          borderRadius: 7,
          border: "1px solid var(--line)",
          fontSize: 10.5,
          fontWeight: 600,
          color: "inherit",
          textDecoration: "none",
          flex: "none",
        }}
      >
        {t("oc2.notif.connect")}
      </Link>
    ) : undefined;

  /* ---------- The rows, in the design's order: what reaches me, then what cannot ---------- */

  const live: React.ReactNode[] = [];
  const off: React.ReactNode[] = [];

  // Slack — direct message
  // Pages in chat turned off by an admin: the method is not offered at all.
  if (data.slack && available.includes("slack") && !slackOn) {
    /* hidden */
  } else if (slackMethod && slackOn)
    live.push(
      row(
        slackMethod.id,
        "slack",
        t("ocv2.notif.slackTitle"),
        t("ocv2.notif.withAck", {
          who: slackMethod.label?.startsWith("@")
            ? slackMethod.label
            : (data.slack?.teamName ?? slackMethod.label ?? ""),
        }),
        linkedRight("slack", slackMethod.id, t("ocv2.notif.linked")),
      ),
    );
  else if (slackOn)
    live.push(
      row(
        "slack-link",
        "slack",
        t("ocv2.notif.slackTitle"),
        t("oc2.notif.slackHint", { team: data.slack?.teamName ?? "" }),
        <form action={linkSlackMethod}>
          <button type="submit" data-testid="slack-link" className="oi-hover-brand-2" style={CTA}>
            {t("oc2.notif.link")}
          </button>
        </form>,
      ),
    );
  else
    off.push(
      dead(
        "slack-off",
        t("ocv2.notif.slackTitle"),
        available.includes("slack")
          ? t("oc2.notif.unavailableSlack")
          : t("ocv2.notif.unavailableSlackApp"),
        available.includes("slack") ? connectLink("slack") : undefined,
      ),
    );

  // Microsoft Teams — chat
  // Pages in chat turned off by an admin: the method is not offered at all.
  if (data.teams && available.includes("teams") && !teamsOn) {
    /* hidden */
  } else if (teamsMethod && teamsOn)
    live.push(
      row(
        teamsMethod.id,
        "teams",
        t("ocv2.notif.teamsTitle"),
        t("ocv2.notif.withAck", {
          who: teamsMethod.label?.includes("@") ? teamsMethod.label : member.email,
        }),
        linkedRight("teams", teamsMethod.id, t("ocv2.notif.linked")),
      ),
    );
  else if (teamsOn)
    live.push(
      row(
        "teams-link",
        "teams",
        t("ocv2.notif.teamsTitle"),
        t("oc2.notif.teamsHint", { team: data.teams?.teamName ?? "" }),
        <form action={linkTeamsMethod}>
          <button type="submit" data-testid="teams-link" className="oi-hover-brand-2" style={CTA}>
            {t("oc2.notif.link")}
          </button>
        </form>,
      ),
    );
  else
    off.push(
      dead(
        "teams-off",
        t("ocv2.notif.teamsTitle"),
        available.includes("teams")
          ? t("oc2.notif.unavailableTeams")
          : t("ocv2.notif.unavailableTeamsApp"),
        available.includes("teams") ? connectLink("teams") : undefined,
      ),
    );

  // Push
  if (available.includes("webpush")) {
    for (const m of pushes)
      live.push(
        row(
          m.id,
          "webpush",
          t("oc2.notif.ch.webpush"),
          `${t("oc2.notif.thisBrowser")}${m.label ? `${t("oc2.sep")}${m.label}` : ""}`,
          linkedRight("webpush", m.id, t("oc2.notif.stActive")),
        ),
      );
    live.push(
      row(
        "push-add",
        "webpush",
        t("oc2.notif.ch.webpush"),
        t("oc2.notif.pushHint"),
        <PushButton vapidPublicKey={process.env.WEBPUSH_VAPID_PUBLIC_KEY ?? ""} />,
      ),
    );
  } else off.push(dead("push-off", t("oc2.notif.ch.webpush"), t("oc2.notif.unavailablePush")));

  // Voice call, SMS
  for (const m of phones.filter((p) => available.includes(p.kind)))
    live.push(
      row(
        m.id,
        m.kind,
        t(`oc2.notif.ch.${m.kind}`),
        m.value,
        <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
          {m.verifiedAt ? (
            (() => {
              const c = lastChip(m.kind);
              return c ? chip(c.text, c.tone) : chip(t("oc2.notif.stVerified"), "ok");
            })()
          ) : (
            <Link
              href={`/app/on-call?tab=notifications&verify=${m.id}`}
              style={{
                fontSize: 11.5,
                fontWeight: 600,
                color: "var(--wait)",
                textDecoration: "none",
              }}
            >
              {t("oc2.notif.stToVerify")}
            </Link>
          )}
          {bin(m.id)}
        </div>,
      ),
    );
  if (!available.includes("voice"))
    off.push(dead("voice-off", t("oc2.notif.ch.voice"), t("oc2.notif.unavailableVoice")));
  if (!available.includes("sms"))
    off.push(dead("sms-off", t("oc2.notif.ch.sms"), t("oc2.notif.unavailableSms")));

  // Email — always there: the account address.
  {
    const c = lastChip("email");
    live.push(
      row(
        "email",
        "email",
        t("oc2.notif.ch.email"),
        member.email,
        c ? chip(c.text, c.tone) : chip(t("oc2.notif.stVerified"), "ok"),
      ),
    );
  }

  /* ---------- The test banner: the channels really queued ---------- */

  const shortName = (k: string) =>
    (["slack", "teams", "webpush", "voice", "sms", "email"] as const).includes(k as Kind)
      ? t(`ocv2.notif.short.${k as Kind}`)
      : null;
  const testChannels = (q.ch ?? "")
    .split(",")
    .map(shortName)
    .filter((x): x is string => Boolean(x));
  const channelList = testChannels.length
    ? new Intl.ListFormat(t.locale.tag, { type: "conjunction" }).format(testChannels)
    : null;

  /* ---------- The two rules ---------- */

  const stepLabel = (kind: Kind, group: StepGroup) =>
    group.at && kind === "email" ? t("ocv2.notif.step.digest") : t(`ocv2.notif.step.${kind}`);

  const ruleCard = (urgency: "high" | "low") => {
    const stored = data.rules.find((r) => r.urgency === urgency)?.steps;
    const steps = stored ?? defaultSteps(urgency);
    const groups = groupSteps(steps);
    const seen = new Set<Kind>();
    const anyUsable = steps.some((s) => usable(s.kind));
    const adding = q.add === urgency;
    let delayed = 0;
    return (
      <div style={CARD} data-testid={`rule-${urgency}`}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 14, fontWeight: 700 }}>
            {t(urgency === "high" ? "oc2.notif.wakes" : "oc2.notif.waits")}
          </span>
          <span
            style={{
              fontSize: 10.5,
              fontWeight: 700,
              background: urgency === "high" ? "var(--dang-t)" : "var(--sunk)",
              color: urgency === "high" ? "var(--dang)" : "var(--ink-2)",
              borderRadius: 999,
              padding: "2px 8px",
            }}
          >
            {t(urgency === "high" ? "oc2.notif.wakesTag" : "oc2.notif.waitsTag")}
          </span>
        </div>
        {groups.length === 0 && (
          <div style={{ fontSize: 12.5, color: "var(--ink-3)" }}>{t("oc2.notif.noSteps")}</div>
        )}
        {groups.map((g, i) => {
          const parts = g.kinds.map((k) => {
            const label = seen.has(k)
              ? t("ocv2.notif.retry", { label: stepLabel(k, g) })
              : stepLabel(k, g);
            return { k, label, ok: usable(k) };
          });
          for (const k of g.kinds) seen.add(k);
          const silent = urgency === "low" && g.kinds.includes("webpush") && !g.at;
          const when = g.at
            ? t("ocv2.notif.at", { time: g.at })
            : g.delayMinutes === 0
              ? t("oc2.notif.immediately")
              : delayed++ === 0
                ? t("ocv2.notif.afterNoAck", { count: g.delayMinutes })
                : t("ocv2.notif.afterMin", { count: g.delayMinutes });
          const allOff = parts.every((p) => !p.ok);
          return (
            <div
              key={g.key}
              data-testid="rule-step"
              className="oi-step"
              style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 13 }}
            >
              <span
                style={{
                  width: 22,
                  height: 22,
                  borderRadius: 7,
                  background: "var(--sunk)",
                  display: "grid",
                  placeItems: "center",
                  fontSize: 11,
                  fontWeight: 700,
                  color: "var(--ink-2)",
                  flex: "none",
                }}
              >
                {i + 1}
              </span>
              <span style={{ fontWeight: 500, minWidth: 0 }}>
                {parts.map((p, j) => (
                  <span key={`${p.k}-${j}`}>
                    {j > 0 && " + "}
                    <span
                      title={p.ok ? undefined : t("ocv2.notif.cannotReach")}
                      style={
                        p.ok ? undefined : { color: "var(--ink-3)", textDecoration: "line-through" }
                      }
                    >
                      {p.label}
                    </span>
                  </span>
                ))}
                {silent && t("ocv2.notif.silent")}
              </span>
              <span style={{ flex: 1 }} />
              <span
                style={{
                  color: "var(--ink-3)",
                  fontSize: 12,
                  whiteSpace: "nowrap",
                  opacity: allOff ? 0.7 : 1,
                }}
              >
                {when}
              </span>
              <form action={updateRule}>
                <input type="hidden" name="urgency" value={urgency} />
                <input type="hidden" name="op" value="removeGroup" />
                <input type="hidden" name="group" value={g.key} />
                <button
                  type="submit"
                  aria-label={t("common.delete")}
                  data-testid="rule-step-remove"
                  className="oi-hover-dang oi-step-x"
                  style={{
                    width: 22,
                    height: 22,
                    border: 0,
                    borderRadius: 6,
                    background: "transparent",
                    color: "var(--ink-3)",
                    cursor: "pointer",
                    fontSize: 11,
                  }}
                >
                  ✕
                </button>
              </form>
            </div>
          );
        })}
        {!anyUsable && (
          <div
            data-testid={`rule-fallback-${urgency}`}
            style={{ fontSize: 12, color: "var(--wait)", lineHeight: 1.45 }}
          >
            {t("ocv2.notif.fallback", { email: member.email })}
          </div>
        )}
        {steps.length < 10 &&
          (adding ? (
            <form
              action={updateRule}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                borderTop: "1px solid var(--line-2)",
                paddingTop: 10,
                flexWrap: "wrap",
              }}
            >
              <input type="hidden" name="urgency" value={urgency} />
              <input type="hidden" name="op" value="add" />
              <select name="kind" className="oi-field" style={FIELD} defaultValue="email">
                {(["slack", "teams", "webpush", "voice", "sms", "email"] as const).map((k) => (
                  <option key={k} value={k} disabled={!available.includes(k)}>
                    {t(`ocv2.notif.step.${k}`)}
                    {available.includes(k) ? "" : ` — ${t("oc2.notif.unavailableHere")}`}
                  </option>
                ))}
                {urgency === "low" && <option value="digest">{t("ocv2.notif.step.digest")}</option>}
              </select>
              <select
                name="delayMinutes"
                defaultValue={urgency === "high" ? "5" : "0"}
                className="oi-field"
                style={FIELD}
                aria-label={t("oc2.notif.after")}
              >
                {[0, 1, 2, 3, 4, 5, 10, 15, 30].map((m) => (
                  <option key={m} value={m}>
                    {m === 0 ? t("oc2.notif.immediately") : t("ocv2.notif.afterMin", { count: m })}
                  </option>
                ))}
              </select>
              <span style={{ flex: 1 }} />
              <Link
                href="/app/on-call?tab=notifications"
                style={{ fontSize: 12, color: "var(--ink-3)", textDecoration: "none" }}
              >
                {t("common.cancel")}
              </Link>
              <button
                type="submit"
                data-testid={`rule-add-${urgency}`}
                className="oi-hover-brand-2"
                style={{ ...CTA, height: 28 }}
              >
                {t("ocv2.notif.addCta")}
              </button>
            </form>
          ) : (
            <Link
              href={`/app/on-call?tab=notifications&add=${urgency}`}
              data-testid={`rule-open-${urgency}`}
              scroll={false}
              style={{
                fontSize: 12,
                fontWeight: 600,
                color: "var(--brand)",
                textDecoration: "none",
                width: "fit-content",
              }}
            >
              {t("oc2.notif.addStep")}
            </Link>
          ))}
      </div>
    );
  };

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)",
        gap: 14,
        alignItems: "start",
        maxWidth: 980,
        animation: "oi-rise .16s ease backwards",
      }}
      data-screen-label="My notifications"
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <div style={CARD}>
          <div style={{ display: "flex", alignItems: "center" }}>
            <span style={{ fontSize: 14, fontWeight: 700 }}>{t("oc2.notif.reach")}</span>
            <span style={{ flex: 1 }} />
            <form action={sendTest}>
              <button
                type="submit"
                data-testid="notif-test"
                className="oi-hover-brand-2"
                style={CTA}
              >
                {t("oc2.notif.sendTest")}
              </button>
            </form>
          </div>
          {q.test === "1" && (
            <div
              role="status"
              data-testid="notif-test-queued"
              style={{
                display: "flex",
                alignItems: "center",
                gap: 9,
                background: "var(--viol-t)",
                borderRadius: 10,
                padding: "9px 12px",
                fontSize: 12.5,
                lineHeight: 1.45,
              }}
            >
              <span
                className="oi-pulse"
                style={{
                  width: 7,
                  height: 7,
                  borderRadius: "50%",
                  background: "var(--viol)",
                  flex: "none",
                }}
              />
              {channelList
                ? t("ocv2.notif.testQueued", { channels: channelList })
                : t("oc2.notif.testQueued")}
            </div>
          )}
          {q.verified === "1" && (
            <div role="status" style={{ fontSize: 12.5, color: "var(--ok)", fontWeight: 600 }}>
              {t("oc2.notif.verifiedOk")}
            </div>
          )}
          {q.error && (
            <div role="alert" style={{ fontSize: 12.5, color: "var(--dang)" }}>
              {q.error === "phone"
                ? t("oc2.notif.errorPhone")
                : q.error === "code"
                  ? t("oc2.notif.errorCode")
                  : q.error === "slack"
                    ? t("oc2.notif.slackFailed")
                    : q.error === "teams"
                      ? t("oc2.notif.teamsFailed")
                      : t("oc2.notif.errorUnavailable")}
            </div>
          )}

          {live}

          {verifying && (
            <form
              action={verifyMethod}
              style={{
                display: "flex",
                gap: 8,
                alignItems: "center",
                background: "var(--brand-t)",
                border: "1px solid var(--brand-b)",
                borderRadius: 10,
                padding: "8px 10px",
                flexWrap: "wrap",
              }}
            >
              <input type="hidden" name="id" value={verifying.id} />
              <span style={{ fontSize: 12.5, color: "var(--ink-2)" }}>
                {t("oc2.notif.enterCode", { target: verifying.value })}
              </span>
              <input
                name="code"
                inputMode="numeric"
                pattern="\d{6}"
                maxLength={6}
                required
                className="oi-field"
                style={{ ...FIELD, width: 90, fontFamily: "var(--mono)", fontSize: 13 }}
              />
              <button type="submit" style={CTA}>
                {t("oc2.notif.verify")}
              </button>
            </form>
          )}
          {(available.includes("sms") || available.includes("voice")) && (
            <form
              action={addPhoneMethod}
              style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}
            >
              <select name="kind" defaultValue="voice" className="oi-field" style={FIELD}>
                {(["voice", "sms"] as const)
                  .filter((k) => available.includes(k))
                  .map((k) => (
                    <option key={k} value={k}>
                      {t(`oc2.notif.ch.${k}`)}
                    </option>
                  ))}
              </select>
              <input
                name="value"
                type="tel"
                required
                placeholder="+33612345678"
                className="oi-field"
                style={{ ...FIELD, flex: 1, minWidth: 150, fontFamily: "var(--mono)" }}
              />
              <button type="submit" style={CTA}>
                {t("oc2.notif.addPhone")}
              </button>
            </form>
          )}

          {off}
        </div>

        <form action={saveShiftReminders} style={CARD}>
          <span style={{ fontSize: 14, fontWeight: 700 }}>{t("oc2.notif.reminders")}</span>
          {(["beforeStart", "atEnd"] as const).map((k) => (
            <label
              key={k}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                fontSize: 13,
                color: "var(--ink-2)",
                cursor: "pointer",
              }}
            >
              <input
                type="checkbox"
                name={k}
                defaultChecked={member.shiftReminders?.[k] ?? k === "beforeStart"}
              />
              {t(k === "beforeStart" ? "oc2.notif.reminderBefore" : "oc2.notif.reminderEnd")}
            </label>
          ))}
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <button
              type="submit"
              className="oi-hover"
              style={{
                height: 30,
                padding: "0 12px",
                border: "1px solid var(--line)",
                borderRadius: 8,
                background: "var(--panel)",
                color: "var(--ink)",
                fontSize: 12,
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              {t("common.save")}
            </button>
            {q.saved === "1" && (
              <span role="status" style={{ fontSize: 12, color: "var(--ok)", fontWeight: 600 }}>
                {t("common.saved")}
              </span>
            )}
          </div>
        </form>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <AtlasNotifyCard tenantId={tenant.id} memberId={member.id} />
        {ruleCard("high")}
        {ruleCard("low")}
      </div>
    </div>
  );
}
