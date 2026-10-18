"use client";

/**
 * Getting your first page, in three steps, on the screen that is explaining
 * them.
 *
 * Each step happens here — the phone is verified here, the source is created
 * here and shows its secret here, and the test really rings. A step opens on
 * the first thing left to do; the next one stays locked until the one before
 * it is finished, as the design draws it, because a source with nobody to
 * page and a test with nowhere to come from prove nothing.
 *
 * What a step cannot do honestly, it says. No SMS operator on the instance
 * means the email is the pager, and the card says so instead of offering a
 * field that would verify nothing.
 */

import Link from "next/link";
import { useActionState, useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useT } from "@/i18n/client";
import {
  confirmPhone,
  createToolSource,
  finishSetup,
  inviteBackup,
  inviteMate,
  pageMeFirst,
  sendFirstPage,
  skipSetup,
  startPhone,
  testPageStatus,
  watchUrl,
  type SourceAnswer,
  type StepAnswer,
  type TestAnswer,
  type TestStatus,
} from "./onboarding-actions";

type Kind = { kind: string; label: string };

/* ---------- The design's vocabulary ---------- */

const FIELD: React.CSSProperties = {
  height: 38,
  border: "1px solid var(--line)",
  borderRadius: 10,
  padding: "0 12px",
  fontSize: 14,
  outline: "none",
  background: "var(--panel)",
  color: "inherit",
  width: "100%",
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
  whiteSpace: "nowrap",
  flex: "none",
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

const EYEBROW: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 700,
  letterSpacing: ".08em",
  color: "var(--ink-3)",
};

/** The tools' glyphs — the design's own monochrome strokes, never a vendor logo. */
const GLYPH: Record<string, React.ReactNode> = {
  datadog: (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" aria-hidden>
      <path d="M12 2l8 5v10l-8 5-8-5V7z" opacity=".15" />
      <path d="M8 9h8v2H8zm0 4h5v2H8z" />
    </svg>
  ),
  prometheus: (
    <svg
      viewBox="0 0 24 24"
      width="20"
      height="20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      aria-hidden
    >
      <circle cx="12" cy="12" r="9" />
      <path d="M8 13c0-3 4-4 4-8 1 3 4 4 4 8z" fill="currentColor" />
      <path d="M8 16h8" />
    </svg>
  ),
  grafana: (
    <svg
      viewBox="0 0 24 24"
      width="20"
      height="20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      aria-hidden
    >
      <path d="M4 19l4-6 4 3 4-8 4 4" />
    </svg>
  ),
  sentry: (
    <svg
      viewBox="0 0 24 24"
      width="20"
      height="20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M12 3l9 16H3z" />
      <path d="M12 9v4" />
      <circle cx="12" cy="16" r=".8" fill="currentColor" />
    </svg>
  ),
  cloudwatch: (
    <svg
      viewBox="0 0 24 24"
      width="20"
      height="20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      aria-hidden
    >
      <path d="M7 18a4 4 0 0 1-.5-8A6 6 0 0 1 18 9a3.5 3.5 0 0 1 0 9z" />
    </svg>
  ),
  uptime_kuma: (
    <svg
      viewBox="0 0 24 24"
      width="20"
      height="20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      aria-hidden
    >
      <path d="M3 12h3l2-5 3 10 3-7 2 2h5" />
    </svg>
  ),
  http: (
    <svg
      viewBox="0 0 24 24"
      width="20"
      height="20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      aria-hidden
    >
      <path d="M7 8l-4 4 4 4M17 8l4 4-4 4M14 5l-4 14" />
    </svg>
  ),
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
    <>
      {parts.map((p, i) =>
        i % 2 ? (
          <strong key={i} style={{ color: "var(--ink)" }}>
            {p}
          </strong>
        ) : (
          <span key={i}>{p}</span>
        ),
      )}
    </>
  );
}

const ETA = ["4 min", "3 min", "1 min", "0 min"];

export function Onboarding({
  memberName,
  workspaceName,
  done,
  phone,
  email,
  pagesMe,
  pagedName,
  backupName,
  canPhone,
  kinds,
  sourceLabel,
  monitorLabel,
  manages,
}: {
  memberName: string;
  workspaceName: string;
  /** The three steps, as the workspace's own state answers them. */
  done: [boolean, boolean, boolean];
  /** The verified number the pager calls, masked. */
  phone: string | null;
  /** The reader's address, masked — the pager when there is no phone. */
  email: string;
  /** The rule that catches every alert pages the reader first. */
  pagesMe: boolean;
  /** Whoever that rule pages first, when it is not the reader. */
  pagedName: string | null;
  /** The second level of that path, when there is one. */
  backupName: string | null;
  /** The instance has an SMS or voice operator; without one the email is the pager. */
  canPhone: boolean;
  kinds: Kind[];
  sourceLabel: string | null;
  monitorLabel: string | null;
  manages: boolean;
}) {
  const t = useT();
  const router = useRouter();
  const [skipping, startSkip] = useTransition();
  const doneN = done.filter(Boolean).length;
  const first = done.findIndex((d) => !d);
  const [open, setOpen] = useState<number>(first === -1 ? -1 : first);
  const locked = [false, !done[0], !done[1]];

  const toggle = (i: number) => {
    if (locked[i]) return;
    setOpen((o) => (o === i ? -1 : i));
  };

  const firstOf = (name: string | null) => (name ? name.split(" ")[0] || name : null);
  const step1Done = pagesMe
    ? [
        t("hm.you"),
        phone ?? email,
        backupName ? t("hm.backup", { name: firstOf(backupName)! }) : null,
      ]
        .filter(Boolean)
        .join(" · ")
    : (pagedName ?? t("home.step1Done"));
  const step2Done =
    sourceLabel ?? (monitorLabel ? t("hm.monitorLabel", { url: monitorLabel }) : "");

  return (
    <div
      data-screen-label="Home — empty workspace"
      style={{
        maxWidth: 800,
        width: "100%",
        margin: "28px auto 0",
        display: "flex",
        flexDirection: "column",
        gap: 22,
        animation: "ohd-rise .2s ease backwards",
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
              data-testid="onboarding-progress"
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
          locked={false}
          lockLabel=""
          onToggle={() => toggle(0)}
          onEdit={() => setOpen(0)}
          title={t("home.step1")}
          minutes="~1 min"
          description={t("home.step1Body")}
          doneLabel={step1Done}
        >
          <PagerStep
            canPhone={canPhone}
            phone={phone}
            pagesMe={pagesMe}
            backupName={backupName}
            manages={manages}
            onNext={() => setOpen(1)}
          />
        </Card>

        <Card
          n={2}
          done={done[1]}
          open={open === 1}
          locked={locked[1]!}
          lockLabel={t("hm.afterStep", { n: 1 })}
          onToggle={() => toggle(1)}
          onEdit={() => setOpen(1)}
          title={t("home.step2")}
          minutes="~2 min"
          description={t("home.step2Body")}
          doneLabel={step2Done}
        >
          <SourceStep kinds={kinds} manages={manages} onNext={() => setOpen(2)} />
        </Card>

        <Card
          n={3}
          done={done[2]}
          open={open === 2}
          locked={locked[2]!}
          lockLabel={t("hm.afterStep", { n: 2 })}
          onToggle={() => toggle(2)}
          onEdit={() => setOpen(2)}
          title={t("home.step3")}
          minutes="~1 min"
          description={t("home.step3Body")}
          doneLabel={t("hm.step3Done")}
        >
          <TestStep target={phone ?? email} />
        </Card>
      </div>

      <Link
        href="/app/settings/migrate"
        data-testid="home-opsgenie"
        data-screen-label="Home — coming from Opsgenie"
        style={{
          background: "var(--topbar-dark)",
          color: "#fff",
          borderRadius: "var(--radius-card)",
          padding: "14px 16px",
          display: "flex",
          alignItems: "center",
          gap: 14,
          flexWrap: "wrap",
          cursor: "pointer",
          textDecoration: "none",
        }}
      >
        <span
          style={{
            width: 30,
            height: 30,
            borderRadius: 9,
            background: "rgba(255,255,255,.12)",
            display: "grid",
            placeItems: "center",
            fontSize: 11,
            fontWeight: 700,
            flex: "none",
          }}
        >
          Og
        </span>
        <div style={{ flex: "1 1 300px", minWidth: 0 }}>
          <div style={{ fontSize: 14, fontWeight: 600 }}>{t("hm.og.title")}</div>
          <div
            style={{
              fontSize: 12.5,
              color: "rgba(255,255,255,.72)",
              marginTop: 2,
              lineHeight: 1.5,
            }}
          >
            {t("hm.og.body")}
          </div>
        </div>
        <span
          style={{
            height: 36,
            padding: "0 14px",
            borderRadius: 10,
            background: "#fff",
            color: "#0D161C",
            display: "flex",
            alignItems: "center",
            fontSize: 13,
            fontWeight: 600,
            whiteSpace: "nowrap",
          }}
        >
          {t("hm.og.cta")}
        </span>
      </Link>

      <div
        data-testid="home-chat"
        data-screen-label="Home — optional chat step"
        style={{
          background: "var(--panel)",
          border: "1.5px dashed var(--line)",
          borderRadius: "var(--radius-card)",
          padding: "14px 16px",
          display: "flex",
          alignItems: "center",
          gap: 14,
          flexWrap: "wrap",
        }}
      >
        <span
          style={{
            width: 28,
            height: 28,
            borderRadius: "50%",
            background: "var(--sunk)",
            color: "var(--ink-3)",
            display: "grid",
            placeItems: "center",
            fontSize: 12,
            fontWeight: 700,
            flex: "none",
          }}
        >
          +
        </span>
        <div style={{ flex: "1 1 300px", minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <span style={{ fontSize: 14, fontWeight: 600 }}>{t("hm.chat.title")}</span>
            <span
              style={{
                fontSize: 10.5,
                fontWeight: 700,
                letterSpacing: ".06em",
                color: "var(--ink-3)",
                border: "1px solid var(--line)",
                borderRadius: 5,
                padding: "1px 6px",
              }}
            >
              {t("hm.chat.optional")}
            </span>
          </div>
          <div style={{ fontSize: 12.5, color: "var(--ink-2)", marginTop: 3, lineHeight: 1.5 }}>
            {t.parts("hm.chat.body", "cmd")[0]}
            <code style={{ fontFamily: "var(--mono)", fontSize: 11.5 }}>/incident</code>
            {t.parts("hm.chat.body", "cmd")[1]}
          </div>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {(
            [
              ["Sl", "hm.chat.slack"],
              ["Te", "hm.chat.teams"],
            ] as const
          ).map(([glyph, key]) => (
            <button
              key={glyph}
              type="button"
              onClick={() => router.push("/app/settings/chat")}
              className="oi-hover"
              style={{
                height: 36,
                padding: "0 13px",
                border: "1px solid var(--line)",
                borderRadius: 10,
                background: "var(--panel)",
                color: "inherit",
                display: "flex",
                alignItems: "center",
                gap: 8,
                fontSize: 13,
                fontWeight: 600,
                cursor: "pointer",
                whiteSpace: "nowrap",
              }}
            >
              <span
                style={{
                  width: 20,
                  height: 20,
                  borderRadius: 6,
                  background: "var(--topbar-dark)",
                  color: "#fff",
                  display: "grid",
                  placeItems: "center",
                  fontSize: 9,
                  fontWeight: 700,
                }}
              >
                {glyph}
              </span>
              {t(key)}
            </button>
          ))}
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 10 }}>
        <div style={TILE}>
          <span style={EYEBROW}>{t("home.youWillHave")}</span>
          <span style={{ fontSize: 12.5, lineHeight: 1.5, color: "var(--ink-2)" }}>
            {t("home.youWillHaveBody")}
          </span>
        </div>
        <div style={TILE}>
          <span style={EYEBROW}>{t("home.youDontNeed")}</span>
          <span style={{ fontSize: 12.5, lineHeight: 1.5, color: "var(--ink-2)" }}>
            {t("home.youDontNeedBody")}
          </span>
        </div>
        <button
          type="button"
          data-testid="home-skip"
          disabled={skipping}
          onClick={() => startSkip(() => skipSetup())}
          className="oi-hover-edge"
          style={{
            ...TILE,
            border: "1px dashed var(--line)",
            cursor: "pointer",
            textAlign: "left",
            color: "inherit",
            font: "inherit",
          }}
        >
          <span style={EYEBROW}>{t("home.alreadySetUp")}</span>
          <span style={{ fontSize: 12.5, lineHeight: 1.5, color: "var(--brand)", fontWeight: 600 }}>
            {t("home.skip")}
          </span>
        </button>
      </div>
      <div style={{ fontSize: 12, color: "var(--ink-3)", textAlign: "center" }}>
        {t("home.stepsDisappear")}
      </div>
    </div>
  );
}

const TILE: React.CSSProperties = {
  background: "var(--panel)",
  border: "1px solid var(--line)",
  borderRadius: 12,
  padding: "12px 14px",
  display: "flex",
  flexDirection: "column",
  gap: 4,
};

/* ---------- Step 1: who the pager calls ---------- */

function PagerStep({
  canPhone,
  phone,
  pagesMe,
  backupName,
  manages,
  onNext,
}: {
  canPhone: boolean;
  phone: string | null;
  pagesMe: boolean;
  backupName: string | null;
  manages: boolean;
  onNext: () => void;
}) {
  const t = useT();
  const [who, setWho] = useState<"me" | "mate" | "sched">("me");
  const [sent, sendAction, sending] = useActionState<StepAnswer, FormData>(startPhone, {});
  const [confirmed, confirmAction, confirming] = useActionState<StepAnswer, FormData>(
    confirmPhone,
    {},
  );
  const [invited, inviteAction, inviting] = useActionState<StepAnswer, FormData>(inviteBackup, {});
  const [mate, mateAction, mating] = useActionState<StepAnswer, FormData>(inviteMate, {});
  const [wiring, startWiring] = useTransition();
  const [wireError, setWireError] = useState<string | undefined>();
  const [backupOpen, setBackupOpen] = useState(false);
  const [edited, setEdited] = useState(false);

  const verified = confirmed.ok ? (confirmed.note ?? phone) : phone;
  const codeStage = Boolean(sent.methodId) && !edited && !confirmed.ok;
  const backup = invited.ok ? invited.note : backupName;
  const canGo = !canPhone || Boolean(verified) || pagesMe;

  const next = () => {
    if (pagesMe) return onNext();
    setWireError(undefined);
    startWiring(async () => {
      const res = await pageMeFirst();
      if (res.error) setWireError(res.error);
      else onNext();
    });
  };

  const tile = (id: "me" | "mate" | "sched", title: string, body: string) => {
    const on = who === id;
    return (
      <button
        key={id}
        type="button"
        data-testid={`onboarding-who-${id}`}
        onClick={() => setWho(id)}
        style={{
          border: on ? "1.5px solid var(--brand)" : "1px solid var(--line)",
          borderRadius: 12,
          padding: "13px 14px",
          background: on ? "var(--brand-t)" : "var(--panel)",
          opacity: id === "sched" ? 0.8 : 1,
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
        {tile("sched", t("home.whoSched"), t("hm.whoSchedBody"))}
      </div>

      {who === "me" &&
        (canPhone ? (
          <form
            action={codeStage ? confirmAction : sendAction}
            data-testid="onboarding-phone"
            style={{ display: "flex", gap: 8, alignItems: "flex-end", flexWrap: "wrap" }}
          >
            <input type="hidden" name="kind" value="sms" />
            {codeStage && <input type="hidden" name="methodId" value={sent.methodId} />}
            <label
              style={{ display: "flex", flexDirection: "column", gap: 5, flex: 1, minWidth: 200 }}
            >
              <span style={LABEL}>{t("home.phoneLabel")}</span>
              <input
                name="value"
                required={!verified}
                readOnly={Boolean(verified) && !edited}
                defaultValue={verified ?? ""}
                onChange={() => setEdited(true)}
                placeholder="+33 6 12 34 56 78"
                className="oi-field"
                style={{ ...FIELD, fontFamily: "var(--mono)" }}
              />
            </label>
            {codeStage && (
              <label style={{ display: "flex", flexDirection: "column", gap: 5, width: 130 }}>
                <span style={LABEL}>{t("hm.codeSms")}</span>
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
            )}
            <button
              type="submit"
              disabled={sending || confirming || (Boolean(verified) && !edited)}
              style={{
                ...PRIMARY,
                background: verified && !edited ? "var(--ok-t)" : "var(--brand)",
                color: verified && !edited ? "var(--ok)" : "var(--on-brand)",
                cursor: verified && !edited ? "default" : "pointer",
              }}
            >
              {verified && !edited
                ? t("hm.verified")
                : codeStage
                  ? t("hm.verify")
                  : t("hm.sendCode")}
            </button>
          </form>
        ) : (
          <div style={NOTE} data-testid="onboarding-no-sms">
            {t("home.noSms")}
          </div>
        ))}
      <Err text={sent.error} />
      <Err text={confirmed.error} />

      {who === "me" && (
        <div style={NOTE}>
          <span style={{ flex: 1, minWidth: 200 }}>
            <Rich
              text={
                backup
                  ? t("hm.pagedThen", { name: backup.split(" ")[0] || backup })
                  : t("hm.pagedFirst")
              }
            />
          </span>
          {manages && !backup && !backupOpen && (
            <button
              type="button"
              data-testid="onboarding-add-backup"
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
      )}

      {who === "me" && backupOpen && !invited.ok && (
        <form
          action={inviteAction}
          data-testid="onboarding-backup"
          style={{
            display: "flex",
            gap: 8,
            alignItems: "center",
            flexWrap: "wrap",
            animation: "ohd-rise .15s ease backwards",
          }}
        >
          <input
            name="email"
            type="email"
            required
            placeholder={t("hm.backupPlaceholder")}
            className="oi-field"
            style={{ ...FIELD, flex: 1, width: "auto", minWidth: 200, height: 36, fontSize: 13.5 }}
          />
          <button
            type="submit"
            disabled={inviting}
            style={{
              ...PRIMARY,
              height: 36,
              padding: "0 14px",
              fontSize: 12.5,
              background: "var(--ink)",
              color: "var(--panel)",
            }}
          >
            {t("home.inviteBackup")}
          </button>
          <span style={{ fontSize: 11.5, color: "var(--ink-3)" }}>{t("hm.backupAfter")}</span>
        </form>
      )}
      <Err text={invited.error} />

      {who === "mate" &&
        (manages ? (
          !mate.ok ? (
            <form
              action={mateAction}
              data-testid="onboarding-mate"
              style={{ display: "flex", gap: 8, alignItems: "flex-end", flexWrap: "wrap" }}
            >
              <label
                style={{ display: "flex", flexDirection: "column", gap: 5, flex: 1, minWidth: 200 }}
              >
                <span style={LABEL}>{t("hm.mateEmail")}</span>
                <input
                  name="email"
                  type="email"
                  required
                  placeholder={t("hm.backupPlaceholder")}
                  className="oi-field"
                  style={FIELD}
                />
              </label>
              <button type="submit" disabled={mating} style={PRIMARY}>
                {t("hm.invite")}
              </button>
            </form>
          ) : (
            <div style={NOTE}>
              <Rich text={t("hm.mateInvited", { name: mate.note ?? "" })} />
            </div>
          )
        ) : (
          <div style={NOTE}>{t("hm.mateNeedsAdmin")}</div>
        ))}
      <Err text={mate.error} />

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
          <span
            style={{
              width: 7,
              height: 7,
              borderRadius: "50%",
              background: "var(--wait)",
              flex: "none",
            }}
          />
          {t("hm.schedNeedsTwo")}
        </div>
      )}

      {who === "me" && canGo && (
        <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <button
            type="button"
            data-testid="onboarding-next-1"
            disabled={wiring}
            onClick={next}
            className="oi-hover-brand-2"
            style={PRIMARY}
          >
            {t("hm.next1")}
          </button>
          <span style={{ fontSize: 12, color: "var(--ink-3)" }}>
            {verified ? t("hm.next1Hint") : t("hm.next1HintEmail")}
          </span>
        </div>
      )}
      {who === "mate" && mate.ok && (
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <button type="button" onClick={onNext} className="oi-hover-brand-2" style={PRIMARY}>
            {t("hm.next1")}
          </button>
        </div>
      )}
      <Err text={wireError} />
    </>
  );
}

/* ---------- Step 2: where the alerts come from ---------- */

function SourceStep({
  kinds,
  manages,
  onNext,
}: {
  kinds: Kind[];
  manages: boolean;
  onNext: () => void;
}) {
  const t = useT();
  const [picked, setPicked] = useState<Kind | "monitor" | null>(null);
  const [url, setUrl] = useState("");
  const [created, createAction, creating] = useActionState<SourceAnswer, FormData>(
    createToolSource,
    {},
  );
  const [watched, setWatched] = useState<StepAnswer>({});
  const [watching, startWatch] = useTransition();
  const [copied, setCopied] = useState(false);
  const tool = picked && picked !== "monitor" ? picked : null;
  const full = created.endpoint ? `${created.endpoint}?secret=${created.secret}` : "";

  const next = () => {
    if (picked !== "monitor" || watched.ok) return onNext();
    startWatch(async () => {
      const fd = new FormData();
      fd.set("url", url);
      const res = await watchUrl(null, fd);
      setWatched(res);
      if (res.ok) onNext();
    });
  };

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
              const on = tool?.kind === k.kind;
              return (
                <button
                  key={k.kind}
                  type="button"
                  data-testid={`onboarding-tool-${k.kind}`}
                  disabled={Boolean(created.endpoint) && !on}
                  onClick={() => setPicked(k)}
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
                  <span
                    style={{
                      width: 22,
                      height: 22,
                      display: "grid",
                      placeItems: "center",
                      color: "var(--ink)",
                    }}
                  >
                    {GLYPH[k.kind] ?? GLYPH.http}
                  </span>
                  <span
                    style={{ fontSize: 11, fontWeight: 600, textAlign: "center", lineHeight: 1.2 }}
                  >
                    {k.label}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        <div
          onClick={() => !created.endpoint && setPicked("monitor")}
          data-testid="onboarding-url"
          style={{
            border: picked === "monitor" ? "1.5px solid var(--brand)" : "1px solid var(--line)",
            borderRadius: 12,
            padding: "13px 14px",
            display: "flex",
            flexDirection: "column",
            gap: 10,
            cursor: "pointer",
            background: picked === "monitor" ? "var(--brand-t)" : "var(--panel)",
          }}
        >
          <div style={{ fontSize: 13.5, fontWeight: 600 }}>{t("home.weWatchUrl")}</div>
          <input
            name="url"
            type="url"
            value={url}
            disabled={Boolean(created.endpoint) || Boolean(watched.ok)}
            onChange={(e) => {
              setUrl(e.target.value);
              setPicked("monitor");
            }}
            placeholder={t("home.watchUrlPlaceholder")}
            className="oi-field"
            style={{
              ...FIELD,
              height: 36,
              borderRadius: 9,
              padding: "0 11px",
              fontFamily: "var(--mono)",
              fontSize: 13,
            }}
          />
          <div style={{ fontSize: 12, color: "var(--ink-3)", lineHeight: 1.5 }}>
            {t("hm.watchBody")}
          </div>
        </div>
      </div>

      {picked && (
        <div
          data-testid="onboarding-picked"
          style={{
            border: "1px solid var(--brand-b)",
            background: "var(--brand-t)",
            borderRadius: 12,
            padding: "13px 15px",
            display: "flex",
            flexDirection: "column",
            gap: 10,
            animation: "ohd-rise .16s ease backwards",
          }}
        >
          <div
            style={{
              display: "flex",
              gap: 16,
              flexWrap: "wrap",
              fontSize: 12.5,
              color: "var(--ink-2)",
            }}
          >
            <span>
              <Rich text={t("hm.choice.pageYou")} />
            </span>
            <span>
              <Rich text={t("hm.choice.incident")} />
            </span>
            <span>
              <Rich text={t("hm.choice.resolve")} />
            </span>
            <span style={{ color: "var(--ink-3)" }}>{t("hm.choice.later")}</span>
          </div>
          {tool && (
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ ...EYEBROW }}>{t("home.webhookUrl")}</span>
                <span style={{ fontSize: 11, color: "var(--wait)", fontWeight: 600 }}>
                  {t("hm.secretOnce")}
                </span>
              </div>
              {created.endpoint ? (
                <div style={{ display: "flex", gap: 6 }} data-testid="onboarding-endpoint">
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
                    {full}
                  </code>
                  <button
                    type="button"
                    onClick={() => {
                      void navigator.clipboard?.writeText(full).then(
                        () => {
                          setCopied(true);
                          setTimeout(() => setCopied(false), 2000);
                        },
                        () => setCopied(false),
                      );
                    }}
                    style={{
                      ...PRIMARY,
                      height: 34,
                      padding: "0 12px",
                      borderRadius: 8,
                      fontSize: 12,
                    }}
                  >
                    {copied ? t("hm.copied") : t("home.copy")}
                  </button>
                </div>
              ) : (
                <form
                  action={createAction}
                  data-testid="onboarding-source"
                  style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}
                >
                  <input type="hidden" name="kind" value={tool.kind} />
                  <button
                    type="submit"
                    data-testid="onboarding-source-create"
                    disabled={!manages || creating}
                    style={{
                      ...PRIMARY,
                      height: 34,
                      padding: "0 12px",
                      borderRadius: 8,
                      fontSize: 12,
                    }}
                  >
                    {t("hm.createSource", { tool: tool.label })}
                  </button>
                  {!manages && (
                    <span style={{ fontSize: 12, color: "var(--ink-3)" }}>
                      {t("hm.sourceNeedsAdmin")}
                    </span>
                  )}
                </form>
              )}
              <Err text={created.error ? t("home.err.sourceName") : undefined} />
              <div style={{ fontSize: 12, color: "var(--ink-2)", lineHeight: 1.55 }}>
                {t("hm.pasteIn", { tool: tool.label })}
              </div>
            </div>
          )}
        </div>
      )}
      <Err text={watched.error} />

      {((tool && created.endpoint) || (picked === "monitor" && url.trim())) && (
        <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <button
            type="button"
            data-testid="onboarding-next-2"
            disabled={watching}
            onClick={next}
            className="oi-hover-brand-2"
            style={PRIMARY}
          >
            {t("hm.next2")}
          </button>
          <span style={{ fontSize: 12, color: "var(--ink-3)" }}>
            {picked === "monitor" ? t("hm.next2HintMonitor") : t("hm.next2HintTool")}
          </span>
        </div>
      )}
    </>
  );
}

/* ---------- Step 3: the only proof ---------- */

function TestStep({ target }: { target: string }) {
  const t = useT();
  const [answer, setAnswer] = useState<TestAnswer>({});
  const [statuses, setStatuses] = useState<TestStatus[]>([]);
  const [pending, start] = useTransition();
  const [finishing, startFinish] = useTransition();
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  // Follow the page out: where each message is, read again every two seconds
  // for a minute — long enough for the immediate channels to leave.
  useEffect(() => {
    const ids = answer.lines?.map((l) => l.id) ?? [];
    if (ids.length === 0) return;
    let rounds = 0;
    const poll = async () => {
      rounds++;
      setStatuses(await testPageStatus(ids));
      if (rounds > 30 && timer.current) clearInterval(timer.current);
    };
    void poll();
    timer.current = setInterval(() => void poll(), 2000);
    return () => {
      if (timer.current) clearInterval(timer.current);
    };
  }, [answer.lines]);

  const started = answer.startedAt ? new Date(answer.startedAt).getTime() : 0;
  const clock = (iso: string | null, plusMinutes = 0) => {
    const at = iso ? new Date(iso).getTime() : started + plusMinutes * 60_000;
    const s = Math.max(0, Math.round((at - started) / 1000));
    return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
  };
  const channelName = (c: string, target: string) => {
    switch (c) {
      case "email":
        return t("hm.log.email", { target });
      case "sms":
        return t("hm.log.sms", { target });
      case "voice":
        return t("hm.log.voice", { target });
      case "webpush":
        return t("hm.log.push");
      case "slack":
        return t("hm.log.slack");
      case "teams":
        return t("hm.log.teams");
      default:
        return c;
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ fontSize: 13, color: "var(--ink-2)", lineHeight: 1.55 }}>
        {t.parts("hm.testMarked", "test", { target })[0]}
        <span
          style={{
            fontWeight: 700,
            color: "var(--viol)",
            background: "var(--viol-t)",
            borderRadius: 5,
            padding: "1px 6px",
          }}
        >
          {t("hm.testChip")}
        </span>
        {t.parts("hm.testMarked", "test", { target })[1]}
      </div>
      {!answer.lines && (
        <button
          type="button"
          disabled={pending}
          data-testid="onboarding-test"
          onClick={() => start(async () => setAnswer(await sendFirstPage()))}
          className="oi-hover-brand-2"
          style={{
            ...PRIMARY,
            height: 44,
            borderRadius: 11,
            padding: "0 22px",
            fontSize: 14,
            width: "fit-content",
          }}
        >
          {t("home.sendTestPage")}
        </button>
      )}
      <Err text={answer.error} />
      {answer.lines && (
        <div
          data-testid="onboarding-test-sent"
          style={{
            border: "1px solid var(--viol)",
            background: "var(--viol-t)",
            borderRadius: 12,
            padding: "13px 15px",
            display: "flex",
            flexDirection: "column",
            gap: 8,
          }}
        >
          <LogLine time="00:00" dot="var(--viol)" text={t("hm.log.created")} />
          {answer.lines.map((l) => {
            const st = statuses.find((s) => s.id === l.id);
            const status = st?.status ?? "queued";
            const failed = status === "failed";
            const gone = status === "sent" || status === "delivered";
            const name = channelName(l.channel, l.target);
            return (
              <LogLine
                key={l.id}
                time={clock(st?.at ?? null, gone ? 0 : l.delayMinutes)}
                dot={failed ? "var(--dang)" : gone ? "var(--brand)" : "var(--ink-3)"}
                pulse={!gone && !failed && l.channel === "voice"}
                text={
                  failed
                    ? t("hm.log.failed", { what: name })
                    : gone
                      ? t("hm.log.sent", { what: name })
                      : l.delayMinutes > 0
                        ? t("hm.log.later", { what: name, count: l.delayMinutes })
                        : t("hm.log.queued", { what: name })
                }
                strong={l.channel === "voice"}
              />
            );
          })}
          <button
            type="button"
            data-testid="onboarding-acked"
            disabled={finishing}
            onClick={() => startFinish(() => finishSetup())}
            style={{
              marginTop: 4,
              height: 34,
              padding: "0 14px",
              border: "1px solid var(--viol)",
              borderRadius: 9,
              background: "var(--panel)",
              color: "var(--viol)",
              display: "flex",
              alignItems: "center",
              fontSize: 12.5,
              fontWeight: 600,
              cursor: "pointer",
              width: "fit-content",
            }}
          >
            {t("hm.acked")}
          </button>
        </div>
      )}
    </div>
  );
}

function LogLine({
  time,
  dot,
  text,
  pulse,
  strong,
}: {
  time: string;
  dot: string;
  text: string;
  pulse?: boolean;
  strong?: boolean;
}) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 13 }}>
      <span style={{ fontFamily: "var(--mono)", fontSize: 11.5, color: "var(--ink-3)", width: 44 }}>
        {time}
      </span>
      <span
        className={pulse ? "oi-pulse" : undefined}
        style={{ width: 7, height: 7, borderRadius: "50%", background: dot, flex: "none" }}
      />
      <span
        style={{
          color: strong ? "var(--ink)" : "var(--ink-2)",
          fontWeight: strong ? 600 : 500,
        }}
      >
        {text}
      </span>
    </div>
  );
}

/* ---------- The card ---------- */

function Card({
  n,
  done,
  open,
  locked,
  lockLabel,
  onToggle,
  onEdit,
  title,
  minutes,
  description,
  doneLabel,
  children,
}: {
  n: number;
  done: boolean;
  open: boolean;
  locked: boolean;
  lockLabel: string;
  onToggle: () => void;
  onEdit: () => void;
  title: string;
  minutes: string;
  description: string;
  doneLabel: string;
  children: React.ReactNode;
}) {
  const t = useT();
  const shut = locked && !open;
  return (
    <div
      data-testid="onboarding-step"
      data-locked={shut ? "true" : undefined}
      style={{
        background: "var(--panel)",
        border: open ? "1.5px solid var(--brand)" : "1px solid var(--line)",
        borderRadius: "var(--radius-card)",
        boxShadow: open ? "var(--shadow-card-hover)" : "var(--shadow-card)",
        opacity: shut ? 0.6 : 1,
        overflow: "hidden",
      }}
    >
      <div
        role="button"
        tabIndex={shut ? -1 : 0}
        aria-expanded={open}
        aria-disabled={shut}
        onClick={onToggle}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onToggle();
          }
        }}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 14,
          padding: "16px 20px",
          cursor: shut ? "default" : "pointer",
        }}
      >
        <span
          style={{
            width: 30,
            height: 30,
            borderRadius: "50%",
            background: done ? "var(--ok)" : open ? "var(--brand)" : "var(--sunk)",
            color: done || open ? "#fff" : "var(--ink-3)",
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
          <>
            <span
              data-testid="onboarding-step-done"
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
                maxWidth: 240,
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
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onEdit();
              }}
              className="oi-hover-ink-brand"
              style={{
                border: 0,
                background: "none",
                padding: 0,
                fontSize: 12,
                fontWeight: 600,
                color: "var(--ink-3)",
                cursor: "pointer",
              }}
            >
              {t("home.change")}
            </button>
          </>
        )}
        {shut && <span style={{ fontSize: 11.5, color: "var(--ink-3)" }}>{lockLabel}</span>}
        {open && <span style={{ fontSize: 14, color: "var(--ink-3)", lineHeight: 1 }}>⌃</span>}
      </div>
      {open && (
        <div
          style={{
            borderTop: "1px solid var(--line-2)",
            padding: "18px 20px 20px",
            display: "flex",
            flexDirection: "column",
            gap: 14,
            animation: "ohd-rise .18s ease backwards",
          }}
        >
          {children}
        </div>
      )}
    </div>
  );
}
