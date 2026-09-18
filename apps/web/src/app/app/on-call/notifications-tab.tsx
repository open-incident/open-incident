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
};

/**
 * On-call · My notifications — the addresses that can reach me, and the two
 * rules that decide in which order they are tried.
 *
 * A channel this instance cannot send on is drawn as a dashed, dead row that
 * names what is missing: the one thing this screen must never do is offer a
 * button that pretends to ring a phone nobody can call.
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
      .limit(8),
    slack: await getSlackInstall(tx, tenant.id),
    teams: await getTeamsInstall(tx, tenant.id),
  }));

  const channelLabel = (k: NotificationStep["kind"]) => t(`oc2.notif.ch.${k}`);
  const stepsOf = (urgency: "high" | "low") =>
    data.rules.find((r) => r.urgency === urgency)?.steps ?? defaultSteps(urgency);

  /** The chip: what really happened last on that channel, else how it stands. */
  const lastOn = (kind: NotificationStep["kind"]) =>
    data.recent.find((d) => d.methodKind === kind) ?? null;
  const deliveryChip = (kind: NotificationStep["kind"]) => {
    const last = lastOn(kind);
    if (!last) return null;
    const when = t.fmt.relativeCompact(last.sentAt ?? last.createdAt);
    if (last.status === "failed") return { text: t("oc2.notif.stFailed"), tone: "dang" as const };
    if (last.status === "queued") return { text: t("oc2.notif.stQueued"), tone: "wait" as const };
    if (last.status === "handled")
      return { text: t("oc2.notif.stHandled", { when }), tone: "ok" as const };
    if (last.status === "delivered")
      return { text: t("oc2.notif.stDelivered", { when }), tone: "ok" as const };
    return { text: t("oc2.notif.stSent", { when }), tone: "ok" as const };
  };

  const chip = (text: string, tone: "ok" | "wait" | "dang") => (
    <span
      style={{
        fontSize: 11,
        fontWeight: 700,
        borderRadius: 999,
        padding: "2px 9px",
        background:
          tone === "ok" ? "var(--ok-t)" : tone === "wait" ? "var(--wait-t)" : "var(--dang-t)",
        color: tone === "ok" ? "var(--ok)" : tone === "wait" ? "var(--wait)" : "var(--dang)",
        flex: "none",
      }}
    >
      {text}
    </span>
  );

  const row = (key: string, title: string, value: string, right: React.ReactNode) => (
    <div
      key={key}
      data-testid="contact-row"
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

  const phones = data.methods.filter((m) => m.kind === "sms" || m.kind === "voice");
  const pushes = data.methods.filter((m) => m.kind === "webpush");
  const slackMethod = data.methods.find((m) => m.kind === "slack") ?? null;
  const teamsMethod = data.methods.find((m) => m.kind === "teams") ?? null;
  const verifying = q.verify ? data.methods.find((m) => m.id === q.verify && !m.verifiedAt) : null;
  const emailChip = deliveryChip("email");
  const admin = canOpenSettings(member);

  const connectLink = (target: "slack" | "teams") =>
    admin ? (
      <Link
        href={`/app/settings/integrations?connect=${target}`}
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

  const ruleCard = (urgency: "high" | "low") => {
    const steps = stepsOf(urgency);
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
        {steps.length === 0 && (
          <div style={{ fontSize: 12.5, color: "var(--ink-3)" }}>{t("oc2.notif.noSteps")}</div>
        )}
        {steps.map((s, i) => {
          const off = !available.includes(s.kind);
          return (
            <div
              key={`${s.kind}-${i}`}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                fontSize: 13,
                opacity: off ? 0.6 : 1,
              }}
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
              <span style={{ fontWeight: 500 }}>
                {channelLabel(s.kind)}
                {off ? `${t("oc2.sep")}${t("oc2.notif.unavailableHere")}` : ""}
              </span>
              <span style={{ flex: 1 }} />
              <span style={{ color: "var(--ink-3)", fontSize: 12 }}>
                {s.delayMinutes === 0
                  ? t("oc2.notif.immediately")
                  : t("oc2.notif.afterNoAck", { count: s.delayMinutes })}
              </span>
              <form action={updateRule}>
                <input type="hidden" name="urgency" value={urgency} />
                <input type="hidden" name="op" value="remove" />
                <input type="hidden" name="index" value={i} />
                <button
                  type="submit"
                  aria-label={t("common.delete")}
                  className="oi-hover-dang"
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
        {steps.length < 10 && (
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
            <select name="kind" className="oi-field" style={FIELD}>
              {(["voice", "sms", "webpush", "email"] as const).map((k) => (
                <option key={k} value={k} disabled={!available.includes(k)}>
                  {channelLabel(k)}
                  {available.includes(k) ? "" : ` — ${t("oc2.notif.unavailableHere")}`}
                </option>
              ))}
            </select>
            <span style={{ fontSize: 12.5, color: "var(--ink-2)" }}>{t("oc2.notif.after")}</span>
            <select
              name="delayMinutes"
              defaultValue={urgency === "high" ? "5" : "0"}
              className="oi-field"
              style={FIELD}
            >
              {[0, 1, 2, 3, 5, 10, 15, 30].map((m) => (
                <option key={m} value={m}>
                  {m === 0 ? t("oc2.notif.immediately") : `${m} min`}
                </option>
              ))}
            </select>
            <span style={{ fontSize: 12.5, color: "var(--ink-2)" }}>
              {t("oc2.notif.withoutAck")}
            </span>
            <span style={{ flex: 1 }} />
            <button
              type="submit"
              data-testid={`rule-add-${urgency}`}
              style={{
                border: 0,
                background: "transparent",
                padding: 0,
                fontSize: 12,
                fontWeight: 600,
                color: "var(--brand)",
                cursor: "pointer",
              }}
            >
              {t("oc2.notif.addStep")}
            </button>
          </form>
        )}
      </div>
    );
  };

  return (
    <div
      className="oi-rise-fast"
      style={{
        display: "grid",
        gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)",
        gap: 14,
        alignItems: "start",
        maxWidth: 980,
      }}
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
              {t("oc2.notif.testQueued")}
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

          {row(
            "email",
            t("oc2.notif.ch.email"),
            member.email,
            emailChip
              ? chip(emailChip.text, emailChip.tone)
              : chip(t("oc2.notif.stVerified"), "ok"),
          )}

          {pushes.map((m) =>
            row(
              m.id,
              t("oc2.notif.ch.webpush"),
              `${t("oc2.notif.thisBrowser")}${m.label ? `${t("oc2.sep")}${m.label}` : ""}`,
              <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                {(() => {
                  const c = deliveryChip("webpush");
                  return c ? chip(c.text, c.tone) : chip(t("oc2.notif.stActive"), "ok");
                })()}
                {bin(m.id)}
              </div>,
            ),
          )}
          {available.includes("webpush")
            ? row(
                "push-add",
                t("oc2.notif.ch.webpush"),
                t("oc2.notif.pushHint"),
                <PushButton vapidPublicKey={process.env.WEBPUSH_VAPID_PUBLIC_KEY ?? ""} />,
              )
            : dead("push-off", t("oc2.notif.ch.webpush"), t("oc2.notif.unavailablePush"))}

          {phones.map((m) =>
            row(
              m.id,
              channelLabel(m.kind),
              m.value,
              <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                {m.verifiedAt ? (
                  chip(t("oc2.notif.stVerified"), "ok")
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
          )}
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
          {available.includes("sms") || available.includes("voice") ? (
            <form
              action={addPhoneMethod}
              style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}
            >
              <select name="kind" defaultValue="voice" className="oi-field" style={FIELD}>
                {(["voice", "sms"] as const)
                  .filter((k) => available.includes(k))
                  .map((k) => (
                    <option key={k} value={k}>
                      {channelLabel(k)}
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
          ) : (
            <>
              {dead("voice-off", t("oc2.notif.ch.voice"), t("oc2.notif.unavailableVoice"))}
              {dead("sms-off", t("oc2.notif.ch.sms"), t("oc2.notif.unavailableSms"))}
            </>
          )}

          {slackMethod
            ? row(
                slackMethod.id,
                t("oc2.notif.ch.slack"),
                `${data.slack?.teamName ?? ""}${data.slack ? t("oc2.sep") : ""}${slackMethod.value}`,
                <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                  {chip(t("oc2.notif.stConnected"), "ok")}
                  {bin(slackMethod.id)}
                </div>,
              )
            : data.slack && available.includes("slack")
              ? row(
                  "slack-link",
                  t("oc2.notif.ch.slack"),
                  t("oc2.notif.slackHint", { team: data.slack.teamName }),
                  <form action={linkSlackMethod}>
                    <button type="submit" data-testid="slack-link" style={CTA}>
                      {t("oc2.notif.link")}
                    </button>
                  </form>,
                )
              : dead(
                  "slack-off",
                  t("oc2.notif.ch.slack"),
                  t("oc2.notif.unavailableSlack"),
                  connectLink("slack"),
                )}

          {teamsMethod
            ? row(
                teamsMethod.id,
                t("oc2.notif.ch.teams"),
                `${data.teams?.teamName ?? ""}${data.teams ? t("oc2.sep") : ""}${teamsMethod.value}`,
                <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                  {chip(t("oc2.notif.stConnected"), "ok")}
                  {bin(teamsMethod.id)}
                </div>,
              )
            : data.teams && available.includes("teams")
              ? row(
                  "teams-link",
                  t("oc2.notif.ch.teams"),
                  t("oc2.notif.teamsHint", { team: data.teams.teamName }),
                  <form action={linkTeamsMethod}>
                    <button type="submit" data-testid="teams-link" style={CTA}>
                      {t("oc2.notif.link")}
                    </button>
                  </form>,
                )
              : dead(
                  "teams-off",
                  t("oc2.notif.ch.teams"),
                  t("oc2.notif.unavailableTeams"),
                  connectLink("teams"),
                )}

          {data.recent.length > 0 && (
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <span
                style={{
                  fontSize: 10.5,
                  fontWeight: 700,
                  letterSpacing: ".08em",
                  color: "var(--ink-3)",
                  textTransform: "uppercase",
                }}
              >
                {t("oc2.notif.deliveries")}
              </span>
              <div
                style={{ border: "1px solid var(--line-2)", borderRadius: 10, overflow: "hidden" }}
              >
                {data.recent.map((d) => (
                  <div
                    key={d.id}
                    data-testid="delivery-row"
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 10,
                      padding: "7px 10px",
                      borderBottom: "1px solid var(--line-2)",
                      fontSize: 11.5,
                    }}
                  >
                    <span
                      style={{
                        fontFamily: "var(--mono)",
                        color: "var(--ink-3)",
                        width: 92,
                        flex: "none",
                      }}
                    >
                      {t.fmt.messageTime(d.createdAt)}
                    </span>
                    <span
                      style={{
                        flex: 1,
                        minWidth: 0,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {channelLabel(d.methodKind)}
                      {t("oc2.sep")}
                      {d.target}
                      {t("oc2.sep")}
                      {t(`oc2.notif.kind.${d.kind}`)}
                    </span>
                    {chip(
                      d.status === "failed"
                        ? t("oc2.notif.stFailed")
                        : d.status === "queued"
                          ? t("oc2.notif.stQueued")
                          : d.status === "handled"
                            ? t("oc2.notif.stHandled", {
                                when: t.fmt.relativeCompact(d.handledAt ?? d.createdAt),
                              })
                            : d.status === "delivered"
                              ? t("oc2.notif.stDelivered", {
                                  when: t.fmt.relativeCompact(d.deliveredAt ?? d.createdAt),
                                })
                              : t("oc2.notif.stSent", {
                                  when: t.fmt.relativeCompact(d.sentAt ?? d.createdAt),
                                }),
                      d.status === "failed" ? "dang" : d.status === "queued" ? "wait" : "ok",
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
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
        {ruleCard("high")}
        {ruleCard("low")}
      </div>
    </div>
  );
}
