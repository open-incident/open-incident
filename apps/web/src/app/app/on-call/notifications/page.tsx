import Link from "next/link";
import { and, asc, desc, eq } from "drizzle-orm";
import {
  notificationDeliveries,
  notificationMethods,
  notificationRules,
  withTenant,
} from "@openincident/db";
import { availableChannels, defaultSteps } from "@openincident/oncall";
import { getSlackInstall, getTeamsInstall } from "@openincident/chat";
import { getT } from "@/i18n/server";
import { requireMember } from "@/lib/session";
import { OnCallRail } from "../rail";
import { PushButton } from "./push-button";
import {
  addPhoneMethod,
  linkSlackMethod,
  linkTeamsMethod,
  removeMethod,
  saveShiftReminders,
  sendTest,
  updateRule,
  verifyMethod,
} from "./actions";

/**
 * My notifications: contact methods (verified, with a real test), shift
 * reminders, and the personal rules — the ordered channels for high and low
 * urgency. A channel the instance cannot use is shown as unavailable, never
 * offered as if it worked.
 */
export default async function NotificationsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { tenant, member } = await requireMember();
  const t = await getT();
  const q = await searchParams;
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
      .where(and(eq(notificationDeliveries.memberId, member.id)))
      // Same instant, two channels: the immediate one above the deferred one.
      .orderBy(desc(notificationDeliveries.createdAt), asc(notificationDeliveries.sendAfter))
      .limit(8),
    slackInstall: await getSlackInstall(tx, tenant.id),
    teamsInstall: await getTeamsInstall(tx, tenant.id),
  }));
  const slackInstall = data.slackInstall;
  const slackMethod = data.methods.find((m) => m.kind === "slack") ?? null;
  const teamsInstall = data.teamsInstall;
  const teamsMethod = data.methods.find((m) => m.kind === "teams") ?? null;
  const kindLabel = (k: string) =>
    t(`notif.channel.${k as "email" | "sms" | "voice" | "webpush" | "slack" | "teams"}`);
  const stepsOf = (urgency: "high" | "low") =>
    data.rules.find((r) => r.urgency === urgency)?.steps ?? defaultSteps(urgency);
  const statusTone: Record<string, [string, string]> = {
    sent: ["var(--ok-t)", "var(--ok)"],
    delivered: ["var(--ok-t)", "var(--ok)"],
    handled: ["var(--sunk)", "var(--ink-2)"],
    queued: ["var(--wait-t)", "var(--wait)"],
    failed: ["var(--dang-t)", "var(--dang)"],
  };
  const card: React.CSSProperties = {
    background: "var(--panel)",
    border: "1px solid var(--line)",
    borderRadius: 14,
    padding: "16px 18px",
    display: "flex",
    flexDirection: "column",
    gap: 11,
  };
  const verifying = q.verify ? data.methods.find((m) => m.id === q.verify && !m.verifiedAt) : null;
  const chipVerified = (label: string) => (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        padding: "3px 10px 3px 8px",
        borderRadius: 999,
        background: "var(--ok-t)",
        color: "var(--ok)",
        fontSize: 11,
        fontWeight: 700,
      }}
    >
      <span style={{ width: 5, height: 5, borderRadius: "50%", background: "currentColor" }} />
      {label}
    </span>
  );
  const methodRow = (title: string, detail: string, right: React.ReactNode, muted = false) => (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        border: muted ? "1.5px dashed var(--line)" : "1px solid var(--line)",
        borderRadius: 11,
        padding: "10px 13px",
        color: muted ? "var(--ink-3)" : undefined,
      }}
    >
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 600 }}>{title}</div>
        <div
          style={{
            fontSize: 12,
            color: "var(--ink-3)",
            fontFamily: muted ? undefined : "var(--font-mono)",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {detail}
        </div>
      </div>
      {right}
    </div>
  );
  const phones = data.methods.filter((m) => m.kind === "sms" || m.kind === "voice");
  const pushes = data.methods.filter((m) => m.kind === "webpush");

  return (
    <div style={{ flex: 1, minHeight: 0, display: "flex" }}>
      <OnCallRail active={{ prefs: true }} />
      <main style={{ flex: 1, minWidth: 0, padding: "16px 20px 24px", overflow: "auto" }}>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)",
            gap: 16,
            maxWidth: 1000,
          }}
        >
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <section style={card}>
              <div style={{ display: "flex", alignItems: "center" }}>
                <span style={{ fontFamily: "var(--font-title)", fontSize: 15, fontWeight: 600 }}>
                  {t("notif.methods")}
                </span>
                <span style={{ flex: 1 }} />
                <form action={sendTest}>
                  <button
                    type="submit"
                    data-testid="notif-test"
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
                    {t("notif.sendTest")}
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
                    background: "var(--ok-t)",
                    border: "1px solid var(--ok)",
                    borderRadius: 10,
                    padding: "8px 12px",
                    fontSize: 12.5,
                    color: "var(--ink-2)",
                  }}
                >
                  <span
                    style={{ width: 7, height: 7, borderRadius: "50%", background: "var(--ok)" }}
                  />
                  {t("notif.testQueued")}
                </div>
              )}
              {q.error && (
                <div role="alert" style={{ fontSize: 12.5, color: "var(--dang)" }}>
                  {q.error === "phone"
                    ? t("notif.errorPhone")
                    : q.error === "code"
                      ? t("notif.errorCode")
                      : t("notif.errorUnavailable")}
                </div>
              )}
              {q.verified === "1" && (
                <div role="status" style={{ fontSize: 12.5, color: "var(--ok)", fontWeight: 600 }}>
                  {t("notif.verified")}
                </div>
              )}

              {methodRow(
                t("notif.channel.email"),
                member.email,
                chipVerified(t("notif.verifiedChip")),
              )}
              {phones.map((m) =>
                methodRow(
                  kindLabel(m.kind),
                  m.value,
                  <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                    {m.verifiedAt ? (
                      chipVerified(t("notif.verifiedChip"))
                    ) : (
                      <Link
                        href={`/app/on-call/notifications?verify=${m.id}`}
                        style={{
                          fontSize: 11.5,
                          fontWeight: 600,
                          color: "var(--wait)",
                          textDecoration: "none",
                        }}
                      >
                        {t("notif.toVerify")}
                      </Link>
                    )}
                    <form action={removeMethod}>
                      <input type="hidden" name="id" value={m.id} />
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
                  }}
                >
                  <input type="hidden" name="id" value={verifying.id} />
                  <span style={{ fontSize: 12.5, color: "var(--ink-2)" }}>
                    {t("notif.enterCode", { target: verifying.value })}
                  </span>
                  <input
                    name="code"
                    inputMode="numeric"
                    pattern="\\d{6}"
                    maxLength={6}
                    required
                    className="oi-field"
                    style={{
                      height: 32,
                      width: 90,
                      padding: "0 10px",
                      border: "1px solid var(--line)",
                      borderRadius: 8,
                      fontFamily: "var(--font-mono)",
                      fontSize: 13,
                    }}
                  />
                  <button
                    type="submit"
                    style={{
                      height: 30,
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
                    {t("notif.verify")}
                  </button>
                </form>
              )}
              {available.includes("sms") ? (
                <form
                  action={addPhoneMethod}
                  style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}
                >
                  <select
                    name="kind"
                    defaultValue="sms"
                    className="oi-field"
                    style={{
                      height: 32,
                      padding: "0 8px",
                      border: "1px solid var(--line)",
                      borderRadius: 8,
                      background: "var(--panel)",
                      fontSize: 12.5,
                    }}
                  >
                    <option value="sms">{t("notif.channel.sms")}</option>
                    <option value="voice">{t("notif.channel.voice")}</option>
                  </select>
                  <input
                    name="value"
                    type="tel"
                    required
                    placeholder="+33612345678"
                    className="oi-field"
                    style={{
                      height: 32,
                      padding: "0 10px",
                      border: "1px solid var(--line)",
                      borderRadius: 8,
                      fontFamily: "var(--font-mono)",
                      fontSize: 12.5,
                      flex: 1,
                      minWidth: 160,
                    }}
                  />
                  <button
                    type="submit"
                    style={{
                      height: 30,
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
                    {t("notif.addPhone")}
                  </button>
                </form>
              ) : (
                methodRow(
                  `${t("notif.channel.voice")} · ${t("notif.channel.sms")}`,
                  t("notif.providerMissing"),
                  <span
                    style={{
                      padding: "1px 7px",
                      borderRadius: 6,
                      border: "1px solid var(--line)",
                      fontSize: 10.5,
                      fontWeight: 600,
                    }}
                  >
                    {t("notif.instanceConfig")}
                  </span>,
                  true,
                )
              )}
              {pushes.map((m) =>
                methodRow(
                  t("notif.channel.webpush"),
                  `${t("notif.thisBrowser")} · ${m.label ?? ""}`,
                  <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                    {chipVerified(t("notif.activeChip"))}
                    <form action={removeMethod}>
                      <input type="hidden" name="id" value={m.id} />
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
                  </div>,
                ),
              )}
              {available.includes("webpush")
                ? methodRow(
                    t("notif.channel.webpush"),
                    t("notif.pushHint"),
                    <PushButton vapidPublicKey={process.env.WEBPUSH_VAPID_PUBLIC_KEY ?? ""} />,
                  )
                : methodRow(
                    t("notif.channel.webpush"),
                    t("notif.providerMissingPush"),
                    <span
                      style={{
                        padding: "1px 7px",
                        borderRadius: 6,
                        border: "1px solid var(--line)",
                        fontSize: 10.5,
                        fontWeight: 600,
                      }}
                    >
                      {t("notif.instanceConfig")}
                    </span>,
                    true,
                  )}
              {slackMethod
                ? methodRow(
                    "Slack DM",
                    `${slackInstall?.teamName ?? "Slack"} · ${slackMethod.value}`,
                    <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                      {chipVerified(t("notif.verifiedChip"))}
                      <form action={removeMethod}>
                        <input type="hidden" name="id" value={slackMethod.id} />
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
                    </div>,
                  )
                : slackInstall && available.includes("slack")
                  ? methodRow(
                      "Slack DM",
                      t("notif.slackLinkHint", { team: slackInstall.teamName }),
                      <form action={linkSlackMethod}>
                        <button
                          type="submit"
                          data-testid="slack-link"
                          style={{
                            height: 28,
                            padding: "0 11px",
                            border: "1px solid var(--brand-b)",
                            borderRadius: 8,
                            background: "var(--panel)",
                            color: "var(--brand)",
                            fontSize: 11.5,
                            fontWeight: 600,
                            cursor: "pointer",
                          }}
                        >
                          {t("notif.slackLink")}
                        </button>
                      </form>,
                    )
                  : methodRow(
                      "Slack DM",
                      t("notif.slackNotConnected"),
                      <Link
                        href="/app/settings/integrations?connect=slack"
                        style={{
                          padding: "1px 7px",
                          borderRadius: 6,
                          border: "1px solid var(--line)",
                          fontSize: 10.5,
                          fontWeight: 600,
                          color: "inherit",
                          textDecoration: "none",
                        }}
                      >
                        {t("settings.integrations.connect")}
                      </Link>,
                      true,
                    )}
              {q.error === "slack" && (
                <div role="alert" style={{ fontSize: 12.5, color: "var(--dang)" }}>
                  {t("notif.slackLinkFailed")}
                </div>
              )}
              {teamsMethod
                ? methodRow(
                    "Teams DM",
                    `${teamsInstall?.teamName ?? "Microsoft Teams"} · ${teamsMethod.value}`,
                    <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                      {chipVerified(t("notif.verifiedChip"))}
                      <form action={removeMethod}>
                        <input type="hidden" name="id" value={teamsMethod.id} />
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
                    </div>,
                  )
                : teamsInstall && available.includes("teams")
                  ? methodRow(
                      "Teams DM",
                      t("notif.teamsLinkHint", { team: teamsInstall.teamName }),
                      <form action={linkTeamsMethod}>
                        <button
                          type="submit"
                          data-testid="teams-link"
                          style={{
                            height: 28,
                            padding: "0 11px",
                            border: "1px solid var(--brand-b)",
                            borderRadius: 8,
                            background: "var(--panel)",
                            color: "var(--brand)",
                            fontSize: 11.5,
                            fontWeight: 600,
                            cursor: "pointer",
                          }}
                        >
                          {t("notif.teamsLink")}
                        </button>
                      </form>,
                    )
                  : methodRow(
                      "Teams DM",
                      t("notif.teamsNotConnected"),
                      <Link
                        href="/app/settings/integrations?connect=teams"
                        style={{
                          padding: "1px 7px",
                          borderRadius: 6,
                          border: "1px solid var(--line)",
                          fontSize: 10.5,
                          fontWeight: 600,
                          color: "inherit",
                          textDecoration: "none",
                        }}
                      >
                        {t("settings.integrations.connect")}
                      </Link>,
                      true,
                    )}
              {q.error === "teams" && (
                <div role="alert" style={{ fontSize: 12.5, color: "var(--dang)" }}>
                  {t("notif.teamsLinkFailed")}
                </div>
              )}
              {data.recent.length > 0 && (
                <div
                  style={{
                    border: "1px solid var(--line-2)",
                    borderRadius: 10,
                    overflow: "hidden",
                  }}
                >
                  {data.recent.map((d) => {
                    const [bg, ink] = statusTone[d.status] ?? statusTone.queued!;
                    return (
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
                            fontFamily: "var(--font-mono)",
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
                          {kindLabel(d.methodKind)} · {d.target} · {t(`notif.kind.${d.kind}`)}
                        </span>
                        <span
                          style={{
                            padding: "1px 8px",
                            borderRadius: 999,
                            background: bg,
                            color: ink,
                            fontSize: 10.5,
                            fontWeight: 700,
                          }}
                        >
                          {t(`notif.status.${d.status}`)}
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}
            </section>
            <form action={saveShiftReminders} style={card}>
              <span style={{ fontFamily: "var(--font-title)", fontSize: 15, fontWeight: 600 }}>
                {t("notif.shiftReminders")}
              </span>
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
                  {t(`notif.reminder.${k}`)}
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

          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            {(["high", "low"] as const).map((urgency) => {
              const steps = stepsOf(urgency);
              return (
                <section key={urgency} style={card} data-testid={`rule-${urgency}`}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span
                      style={{ fontFamily: "var(--font-title)", fontSize: 15, fontWeight: 600 }}
                    >
                      {urgency === "high" ? t("notif.high") : t("notif.low")}
                    </span>
                    <span
                      style={{
                        padding: "2px 9px",
                        borderRadius: 999,
                        background: urgency === "high" ? "var(--dang-t)" : "var(--sunk)",
                        color: urgency === "high" ? "var(--dang)" : "var(--ink-2)",
                        fontSize: 11,
                        fontWeight: urgency === "high" ? 700 : 600,
                      }}
                    >
                      {urgency === "high" ? t("notif.wakesYou") : t("notif.silent")}
                    </span>
                  </div>
                  {steps.map((s, i) => {
                    const unavailable = !available.includes(s.kind);
                    return (
                      <div
                        key={`${s.kind}-${i}`}
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 10,
                          fontSize: 13,
                          opacity: unavailable ? 0.6 : 1,
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
                          }}
                        >
                          {i + 1}
                        </span>
                        <span style={{ fontWeight: 500 }}>
                          {kindLabel(s.kind)}
                          {unavailable ? ` · ${t("notif.unavailableHere")}` : ""}
                        </span>
                        <span style={{ flex: 1 }} />
                        <span style={{ color: "var(--ink-3)", fontSize: 12 }}>
                          {s.delayMinutes === 0
                            ? t("notif.immediate")
                            : t("notif.afterNoAck", { count: s.delayMinutes })}
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
                        border: "1px solid var(--brand-b)",
                        background: "var(--brand-t)",
                        borderRadius: 10,
                        padding: "8px 10px",
                        flexWrap: "wrap",
                      }}
                    >
                      <input type="hidden" name="urgency" value={urgency} />
                      <input type="hidden" name="op" value="add" />
                      <select
                        name="kind"
                        className="oi-field"
                        style={{
                          height: 32,
                          padding: "0 8px",
                          border: "1px solid var(--line)",
                          borderRadius: 8,
                          background: "var(--panel)",
                          fontSize: 12.5,
                        }}
                      >
                        {(["voice", "sms", "webpush", "email"] as const).map((k) => (
                          <option key={k} value={k} disabled={!available.includes(k)}>
                            {kindLabel(k)}
                            {available.includes(k) ? "" : ` — ${t("notif.unavailableHere")}`}
                          </option>
                        ))}
                      </select>
                      <span style={{ fontSize: 12.5, color: "var(--ink-2)" }}>
                        {t("notif.after")}
                      </span>
                      <select
                        name="delayMinutes"
                        defaultValue={urgency === "high" ? "5" : "0"}
                        className="oi-field"
                        style={{
                          height: 32,
                          padding: "0 8px",
                          border: "1px solid var(--line)",
                          borderRadius: 8,
                          background: "var(--panel)",
                          fontSize: 12.5,
                        }}
                      >
                        {[0, 1, 2, 3, 5, 10, 15, 30].map((m) => (
                          <option key={m} value={m}>
                            {m === 0 ? t("notif.immediate") : `${m} min`}
                          </option>
                        ))}
                      </select>
                      <span style={{ fontSize: 12.5, color: "var(--ink-2)" }}>
                        {t("notif.withoutAck")}
                      </span>
                      <span style={{ flex: 1 }} />
                      <button
                        type="submit"
                        data-testid={`rule-add-${urgency}`}
                        style={{
                          height: 30,
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
                        {t("notif.addStep")}
                      </button>
                    </form>
                  )}
                </section>
              );
            })}
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
              {t("notif.outboxNote")}
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
