"use client";

/**
 * Getting your first page, in three steps, on the screen that is explaining
 * them.
 *
 * The steps used to be signposts: three cards that each sent the reader to
 * another screen. A workspace's first five minutes were spent navigating, and
 * the page that had just promised "nothing to read first" was the first thing
 * you left. Each step happens here now — the phone is verified here, the
 * source is created here and shows its secret here, and the test really rings.
 *
 * What a step cannot do honestly, it says. No SMS operator on the instance
 * means the email is the pager, and the card says so instead of offering a
 * field that would verify nothing.
 */

import { useActionState, useState } from "react";
import { useT } from "@/i18n/client";
import { IntegrationIcon } from "@/app/app/settings/integrations/icons";
import { createSource } from "@/app/app/settings/alert-sources/actions";
import {
  confirmPhone,
  inviteBackup,
  pageMeFirst,
  sendFirstPage,
  startPhone,
  watchUrl,
  type StepAnswer,
} from "./onboarding-actions";

type Kind = { kind: string; label: string; icon: string };

const FIELD: React.CSSProperties = {
  height: 38,
  border: "1px solid var(--line)",
  borderRadius: 10,
  padding: "0 12px",
  fontSize: 14,
  outline: "none",
  background: "var(--panel)",
  color: "inherit",
};

const LABEL: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 600,
  letterSpacing: ".08em",
  textTransform: "uppercase",
  color: "var(--ink-3)",
};

const PRIMARY: React.CSSProperties = {
  height: 38,
  padding: "0 16px",
  borderRadius: 10,
  background: "var(--brand)",
  color: "var(--on-brand)",
  border: 0,
  display: "flex",
  alignItems: "center",
  fontSize: 13,
  fontWeight: 600,
  cursor: "pointer",
};

const NOTE: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 10,
  background: "var(--sunk)",
  borderRadius: 10,
  padding: "10px 13px",
  fontSize: 12.5,
  color: "var(--ink-2)",
  lineHeight: 1.5,
  flexWrap: "wrap",
};

function Err({ text }: { text?: string }) {
  if (!text) return null;
  return (
    <div role="alert" style={{ fontSize: 12.5, color: "var(--dang)" }}>
      {text}
    </div>
  );
}

/** Our own strings carry <b>; nothing user-written passes through here. */
function Rich({ text }: { text: string }) {
  const parts = text.split(/<b>|<\/b>/);
  return (
    <span>
      {parts.map((p, i) => (i % 2 ? <strong key={i}>{p}</strong> : <span key={i}>{p}</span>))}
    </span>
  );
}

export function Onboarding({
  memberName,
  workspaceName,
  done,
  phone,
  hasBackup,
  backupName,
  canPhone,
  kinds,
  sourceCount,
  monitorCount,
  manages,
}: {
  memberName: string;
  workspaceName: string;
  /** The three steps, as the workspace's own state answers them. */
  done: [boolean, boolean, boolean];
  /** The verified number the pager already calls, masked. */
  phone: string | null;
  hasBackup: boolean;
  backupName: string | null;
  /** The instance has an SMS or voice operator; without one the email is the pager. */
  canPhone: boolean;
  kinds: Kind[];
  sourceCount: number;
  monitorCount: number;
  manages: boolean;
}) {
  const t = useT();
  const doneN = done.filter(Boolean).length;
  const first = done.findIndex((d) => !d);
  const [open, setOpen] = useState<number>(first === -1 ? -1 : first);

  const ETA = ["4 min", "3 min", "1 min", "0 min"];

  return (
    <div
      className="oi-rise"
      style={{
        maxWidth: 800,
        margin: "28px auto 0",
        padding: "0 28px 60px",
        display: "flex",
        flexDirection: "column",
        gap: 22,
      }}
    >
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "minmax(0,1fr) 250px",
          gap: 24,
          alignItems: "end",
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <div
            style={{
              fontSize: 11,
              fontWeight: 700,
              letterSpacing: ".1em",
              textTransform: "uppercase",
              color: "var(--brand-2)",
            }}
          >
            {t("home.welcome", { name: memberName, workspace: workspaceName })}
          </div>
          <h1
            style={{
              margin: 0,
              fontFamily: "var(--title)",
              fontSize: 32,
              fontWeight: 600,
              letterSpacing: "-.02em",
              lineHeight: 1.1,
            }}
          >
            {t("home.setupTitle")}
          </h1>
          <p
            style={{
              margin: 0,
              fontSize: 14.5,
              lineHeight: 1.6,
              color: "var(--ink-2)",
              textWrap: "pretty",
            }}
          >
            {t("home.setupLead")}
          </p>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
            <span
              style={{
                fontFamily: "var(--title)",
                fontSize: 26,
                fontWeight: 600,
                color: "var(--brand)",
                letterSpacing: "-.02em",
              }}
            >
              {Math.round((doneN / 3) * 100)} %
            </span>
            <span style={{ fontSize: 12, color: "var(--ink-3)" }}>
              {t("home.setupProgress", { done: doneN, eta: ETA[doneN]! })}
            </span>
          </div>
          <div
            style={{
              height: 6,
              borderRadius: 999,
              background: "var(--sunk)",
              overflow: "hidden",
              display: "flex",
              gap: 2,
            }}
          >
            {[0, 1, 2].map((i) => (
              <span
                key={i}
                style={{
                  flex: 1,
                  borderRadius: 999,
                  background:
                    i < doneN ? "var(--ok)" : i === doneN ? "var(--brand-b)" : "var(--line)",
                }}
              />
            ))}
          </div>
        </div>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <Card
          n={1}
          done={done[0]}
          open={open === 0}
          onToggle={() => setOpen(open === 0 ? -1 : 0)}
          title={t("home.step1")}
          minutes="~1 min"
          description={t("home.step1Body")}
          doneLabel={phone ?? t("home.emailIsPager")}
        >
          <PagerStep
            canPhone={canPhone}
            hasBackup={hasBackup}
            backupName={backupName}
            pagesMe={done[0]}
            manages={manages}
          />
        </Card>

        <Card
          n={2}
          done={done[1]}
          open={open === 1}
          onToggle={() => setOpen(open === 1 ? -1 : 1)}
          title={t("home.step2")}
          minutes="~2 min"
          description={t("home.step2Body")}
          doneLabel={t("home.step2Done", { count: sourceCount + monitorCount })}
        >
          <SourceStep kinds={kinds} manages={manages} />
        </Card>

        <Card
          n={3}
          done={done[2]}
          open={open === 2}
          onToggle={() => setOpen(open === 2 ? -1 : 2)}
          title={t("home.step3")}
          minutes="~1 min"
          description={t("home.step3Body")}
          doneLabel={t("home.step3Done")}
        >
          <TestStep />
        </Card>
      </div>
    </div>
  );
}

/* ---------- Step 1: who the pager calls ---------- */

function PagerStep({
  canPhone,
  hasBackup,
  backupName,
  pagesMe,
  manages,
}: {
  canPhone: boolean;
  hasBackup: boolean;
  backupName: string | null;
  /** A route already names a path that pages somebody. */
  pagesMe: boolean;
  manages: boolean;
}) {
  const t = useT();
  const [who, setWho] = useState<"me" | "mate" | "sched" | null>(pagesMe ? "me" : null);
  const [wired, wireAction, wiring] = useActionState<StepAnswer, FormData>(
    async () => pageMeFirst(),
    {},
  );
  const [sent, action, pending] = useActionState<StepAnswer, FormData>(startPhone, {});
  const [confirmed, confirmAction, confirming] = useActionState<StepAnswer, FormData>(
    confirmPhone,
    {},
  );
  const [invited, inviteAction, inviting] = useActionState<StepAnswer, FormData>(inviteBackup, {});
  const [backupOpen, setBackupOpen] = useState(false);

  /** The person paged after you, once there is one. */
  const backup = hasBackup || invited.note ? (invited.note ?? backupName) : null;

  const tile = (id: "me" | "mate" | "sched", title: string, body: string) => {
    const on = who === id;
    return (
      <button
        key={id}
        type="button"
        data-testid={`onboarding-who-${id}`}
        onClick={() => {
          setWho(id);
          if (id === "mate") setBackupOpen(true);
        }}
        className="oi-hover-edge"
        style={{
          border: on ? "1.5px solid var(--brand)" : "1px solid var(--line)",
          borderRadius: 12,
          padding: "13px 14px",
          background: on ? "var(--brand-t)" : "var(--panel)",
          textAlign: "left",
          color: "inherit",
          cursor: "pointer",
        }}
      >
        <div style={{ fontSize: 13.5, fontWeight: 600 }}>{title}</div>
        <div style={{ fontSize: 12, color: "var(--ink-3)", marginTop: 3, lineHeight: 1.45 }}>
          {body}
        </div>
      </button>
    );
  };

  return (
    <>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 10 }}>
        {tile("me", t("home.whoMe"), t("home.whoMeBody"))}
        {tile("mate", t("home.whoMate"), t("home.whoMateBody"))}
        {tile("sched", t("home.whoSched"), t("home.whoSchedBody"))}
      </div>

      {who === "sched" && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            background: "var(--wait-t)",
            border: "1px solid rgba(180,83,9,.25)",
            borderRadius: 10,
            padding: "10px 13px",
            fontSize: 12.5,
            color: "var(--ink-2)",
          }}
        >
          <span style={{ width: 7, height: 7, borderRadius: "50%", background: "var(--wait)" }} />
          {t("home.schedNeedsTwo")}
        </div>
      )}

      {who === "me" && !pagesMe && !wired.ok && (
        <form action={wireAction}>
          <button type="submit" disabled={!manages || wiring} style={PRIMARY}>
            {t("home.pageMeFirst")}
          </button>
        </form>
      )}
      <Err text={wired.error} />

      {who === "me" &&
        (canPhone ? (
          <>
            <form
              action={action}
              data-testid="onboarding-phone"
              style={{ display: "flex", gap: 8, alignItems: "flex-end", flexWrap: "wrap" }}
            >
              <input type="hidden" name="kind" value="sms" />
              <label
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: 5,
                  flex: 1,
                  minWidth: 200,
                }}
              >
                <span style={LABEL}>{t("home.phoneLabel")}</span>
                <input
                  name="value"
                  required
                  placeholder="+33 6 12 34 56 78"
                  className="oi-field"
                  style={{ ...FIELD, fontFamily: "var(--mono)" }}
                />
              </label>
              <button type="submit" disabled={pending} style={PRIMARY}>
                {sent.methodId ? t("home.resendCode") : t("home.sendCode")}
              </button>
            </form>
            <Err text={sent.error} />

            {sent.methodId && !confirmed.ok && (
              <form
                action={confirmAction}
                data-testid="onboarding-code"
                style={{ display: "flex", gap: 8, alignItems: "flex-end", flexWrap: "wrap" }}
              >
                <input type="hidden" name="methodId" value={sent.methodId} />
                <label style={{ display: "flex", flexDirection: "column", gap: 5, width: 140 }}>
                  <span style={LABEL}>{t("home.codeLabel")}</span>
                  <input
                    name="code"
                    required
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    placeholder="••••••"
                    className="oi-field"
                    style={{ ...FIELD, fontFamily: "var(--mono)", letterSpacing: ".2em" }}
                  />
                </label>
                <button type="submit" disabled={confirming} style={PRIMARY}>
                  {t("home.confirm")}
                </button>
              </form>
            )}
            <Err text={confirmed.error} />
          </>
        ) : (
          <div style={NOTE}>{t("home.noSms")}</div>
        ))}

      <div style={NOTE}>
        <span style={{ flex: 1, minWidth: 200 }}>
          <Rich text={t("home.pagedFirst")} />
          {backup ? <Rich text={t("home.pagedThen", { name: backup })} /> : null}
        </span>
        {!backup && !backupOpen && (
          <button
            type="button"
            onClick={() => setBackupOpen(true)}
            style={{
              border: 0,
              background: "none",
              fontSize: 12,
              fontWeight: 600,
              color: "var(--brand)",
              cursor: "pointer",
              padding: 0,
            }}
          >
            {t("home.addBackup")}
          </button>
        )}
      </div>

      {backupOpen && !invited.ok && (
        <form
          action={inviteAction}
          data-testid="onboarding-backup"
          style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}
        >
          <input
            name="email"
            type="email"
            required
            placeholder={t("home.backupPlaceholder")}
            className="oi-field"
            style={{ ...FIELD, flex: 1, minWidth: 200, height: 36 }}
          />
          <button
            type="submit"
            disabled={inviting}
            style={{ ...PRIMARY, height: 36, background: "var(--ink)" }}
          >
            {t("home.inviteBackup")}
          </button>
          <span style={{ fontSize: 11.5, color: "var(--ink-3)" }}>{t("home.backupAfter")}</span>
        </form>
      )}
      <Err text={invited.error} />
      {invited.ok && invited.note && (
        <div style={{ fontSize: 12.5, color: "var(--ok)", fontWeight: 600 }}>
          {t("home.backupInvited", { email: invited.note })}
        </div>
      )}
    </>
  );
}

/* ---------- Step 2: where the alerts come from ---------- */

function SourceStep({ kinds, manages }: { kinds: Kind[]; manages: boolean }) {
  const t = useT();
  const [picked, setPicked] = useState<Kind | null>(null);
  const [created, createAction, creating] = useActionState(createSource, {});
  const [watched, watchAction, watching] = useActionState<StepAnswer, FormData>(watchUrl, {});
  const [copied, setCopied] = useState(false);

  return (
    <>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <div
          style={{
            border: "1px solid var(--line)",
            borderRadius: 12,
            padding: "13px 14px",
            display: "flex",
            flexDirection: "column",
            gap: 10,
          }}
        >
          <div style={{ fontSize: 13.5, fontWeight: 600 }}>{t("home.aToolSends")}</div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 6 }}>
            {kinds.map((k) => {
              const on = picked?.kind === k.kind;
              return (
                <button
                  key={k.kind}
                  type="button"
                  data-testid={`onboarding-tool-${k.kind}`}
                  onClick={() => setPicked(on ? null : k)}
                  className="oi-hover-edge"
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    gap: 5,
                    padding: "9px 4px",
                    border: on ? "1.5px solid var(--brand)" : "1px solid var(--line)",
                    borderRadius: 10,
                    background: on ? "var(--brand-t)" : "var(--panel)",
                    color: "inherit",
                    cursor: "pointer",
                  }}
                >
                  <span style={{ width: 22, height: 22, display: "grid", placeItems: "center" }}>
                    <IntegrationIcon id={k.icon} />
                  </span>
                  <span
                    style={{
                      fontSize: 11,
                      fontWeight: 600,
                      textAlign: "center",
                      lineHeight: 1.2,
                    }}
                  >
                    {k.label}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        <form
          action={watchAction}
          data-testid="onboarding-url"
          style={{
            border: "1px solid var(--line)",
            borderRadius: 12,
            padding: "13px 14px",
            display: "flex",
            flexDirection: "column",
            gap: 10,
          }}
        >
          <div style={{ fontSize: 13.5, fontWeight: 600 }}>{t("home.weWatchUrl")}</div>
          <input
            name="url"
            type="url"
            required
            placeholder={t("home.watchUrlPlaceholder")}
            className="oi-field"
            style={{ ...FIELD, height: 36, fontFamily: "var(--mono)", fontSize: 13 }}
          />
          <div style={{ fontSize: 12, color: "var(--ink-3)", lineHeight: 1.5 }}>
            {t("home.weWatchUrlBody")}
          </div>
          <button type="submit" disabled={watching} style={{ ...PRIMARY, height: 34 }}>
            {t("home.watch")}
          </button>
          <Err text={watched.error} />
          {watched.ok && watched.note && (
            <div style={{ fontSize: 12.5, color: "var(--ok)", fontWeight: 600 }}>
              {t("home.watching", { host: watched.note })}
            </div>
          )}
        </form>
      </div>

      {picked && !created.endpoint && (
        <form
          action={createAction}
          data-testid="onboarding-source"
          style={{ display: "flex", gap: 8, alignItems: "flex-end", flexWrap: "wrap" }}
        >
          <input type="hidden" name="kind" value={picked.kind} />
          <input type="hidden" name="page" value="owner" />
          <input type="hidden" name="incident" value="urgent" />
          <input type="hidden" name="autoResolve" value="on" />
          <label
            style={{ display: "flex", flexDirection: "column", gap: 5, flex: 1, minWidth: 200 }}
          >
            <span style={LABEL}>{t("home.sourceName")}</span>
            <input
              name="name"
              required
              defaultValue={picked.label}
              maxLength={80}
              className="oi-field"
              style={FIELD}
            />
          </label>
          <button type="submit" disabled={!manages || creating} style={PRIMARY}>
            {t("home.createSource")}
          </button>
        </form>
      )}
      <Err text={created.error ? t("home.err.sourceName") : undefined} />

      {created.endpoint && (
        <div
          data-testid="onboarding-endpoint"
          style={{
            border: "1px solid var(--brand-b)",
            background: "var(--brand-t)",
            borderRadius: 12,
            padding: "13px 15px",
            display: "flex",
            flexDirection: "column",
            gap: 10,
          }}
        >
          <div style={{ fontSize: 12.5, color: "var(--ink-2)", lineHeight: 1.55 }}>
            <Rich text={t("home.sourceChoices")} />
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ ...LABEL, letterSpacing: ".08em" }}>{t("home.webhookUrl")}</span>
            <span style={{ fontSize: 11, color: "var(--wait)", fontWeight: 600 }}>
              {t("home.secretOnce")}
            </span>
          </div>
          <div style={{ display: "flex", gap: 6 }}>
            <code
              style={{
                flex: 1,
                minWidth: 0,
                fontFamily: "var(--mono)",
                fontSize: 11.5,
                background: "var(--panel)",
                border: "1px solid var(--brand-b)",
                borderRadius: 8,
                padding: "8px 10px",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {created.endpoint}?secret={created.secret}
            </code>
            <button
              type="button"
              onClick={() => {
                void navigator.clipboard
                  ?.writeText(`${created.endpoint}?secret=${created.secret}`)
                  .then(
                    () => {
                      setCopied(true);
                      setTimeout(() => setCopied(false), 2000);
                    },
                    () => setCopied(false),
                  );
              }}
              style={{ ...PRIMARY, height: 34, flex: "none" }}
            >
              {copied ? t("home.copied") : t("home.copy")}
            </button>
          </div>
          <div style={{ fontSize: 12, color: "var(--ink-2)", lineHeight: 1.55 }}>
            {t("home.pasteIn", { tool: picked?.label ?? "" })}
          </div>
        </div>
      )}
    </>
  );
}

/* ---------- Step 3: the only proof ---------- */

function TestStep() {
  const t = useT();
  const [answer, action, pending] = useActionState<StepAnswer, FormData>(
    async () => sendFirstPage(),
    {},
  );
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ fontSize: 13, color: "var(--ink-2)", lineHeight: 1.55 }}>
        <Rich text={t("home.testMarked")} />
      </div>
      <form action={action}>
        <button
          type="submit"
          disabled={pending}
          data-testid="onboarding-test"
          style={{ ...PRIMARY, height: 44, padding: "0 22px", fontSize: 14 }}
        >
          {t("home.sendTestPage")}
        </button>
      </form>
      <Err text={answer.error} />
      {answer.ok && (
        <div
          data-testid="onboarding-test-sent"
          style={{
            border: "1px solid var(--viol)",
            background: "var(--viol-t)",
            borderRadius: 12,
            padding: "13px 15px",
            fontSize: 13,
            color: "var(--ink-2)",
          }}
        >
          {t("home.testSent")}
        </div>
      )}
    </div>
  );
}

/* ---------- The card ---------- */

function Card({
  n,
  done,
  open,
  onToggle,
  title,
  minutes,
  description,
  doneLabel,
  children,
}: {
  n: number;
  done: boolean;
  open: boolean;
  onToggle: () => void;
  title: string;
  minutes: string;
  description: string;
  doneLabel: string;
  children: React.ReactNode;
}) {
  return (
    <div
      data-testid="onboarding-step"
      style={{
        background: "var(--panel)",
        border: open ? "1.5px solid var(--brand)" : "1px solid var(--line)",
        borderRadius: "var(--radius-card)",
        boxShadow: open ? "var(--shadow-card-hover)" : "var(--shadow-card)",
        overflow: "hidden",
      }}
    >
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        style={{
          width: "100%",
          display: "flex",
          alignItems: "center",
          gap: 14,
          padding: "16px 20px",
          background: "none",
          border: 0,
          textAlign: "left",
          color: "inherit",
          cursor: "pointer",
        }}
      >
        <span
          style={{
            width: 30,
            height: 30,
            borderRadius: "50%",
            background: done ? "var(--ok)" : open ? "var(--brand)" : "var(--sunk)",
            color: done || open ? "var(--on-brand)" : "var(--ink-3)",
            display: "grid",
            placeItems: "center",
            fontSize: 13,
            fontWeight: 700,
            flex: "none",
          }}
        >
          {done ? "✓" : n}
        </span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
            <span style={{ fontSize: 15, fontWeight: 600, whiteSpace: "nowrap" }}>{title}</span>
            <span
              style={{
                fontSize: 11,
                color: "var(--ink-3)",
                border: "1px solid var(--line)",
                borderRadius: 5,
                padding: "0 6px",
                whiteSpace: "nowrap",
                flex: "none",
              }}
            >
              {minutes}
            </span>
          </div>
          <div style={{ fontSize: 13, color: "var(--ink-2)", marginTop: 2 }}>{description}</div>
        </div>
        {done && (
          <span
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              fontSize: 12,
              fontWeight: 600,
              color: "var(--ok)",
              background: "var(--ok-t)",
              borderRadius: 999,
              padding: "3px 10px",
              maxWidth: 260,
              flex: "none",
              minWidth: 0,
            }}
          >
            <span
              style={{
                width: 6,
                height: 6,
                borderRadius: "50%",
                background: "var(--ok)",
                flex: "none",
              }}
            />
            <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {doneLabel}
            </span>
          </span>
        )}
        <span style={{ fontSize: 14, color: "var(--ink-3)", lineHeight: 1, flex: "none" }}>
          {open ? "⌃" : "⌄"}
        </span>
      </button>
      {open && (
        <div
          className="oi-rise-fast"
          style={{
            borderTop: "1px solid var(--line-2)",
            padding: "18px 20px 20px",
            display: "flex",
            flexDirection: "column",
            gap: 14,
          }}
        >
          {children}
        </div>
      )}
    </div>
  );
}
