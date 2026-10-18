"use client";

/**
 * Settings › Slack & Teams (design V2Chat, "Settings — Slack & Teams"): the
 * two tools side by side, the eight sections of the selected one, and the
 * "What people see" preview that follows them. Every control saves at once
 * through a server action and says so in a toast; nothing on this screen is
 * decorative — a switch that cannot act on this instance is not drawn as one.
 */
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
  type CSSProperties,
  type ReactNode,
} from "react";
import { useT } from "@/i18n/client";
import { initials } from "@/i18n/format";
import type { MessageKey } from "@/i18n/dictionaries/en";
import {
  disconnectProvider,
  linkMember,
  linkMemberTo,
  saveChatSetting,
  startPairing,
  testFromHealth,
} from "./actions";
import type { ChatEventView, ChatPageData, ProviderData, Tone } from "./data";
import { ChatPreview, type PreviewMsg } from "./preview";
import { ChatWizard, type WizardData } from "./wizard";
import { LinkPicker, type PickState } from "./link-picker";

type P = "slack" | "teams";
type SecId = "channels" | "ann" | "page" | "alerts" | "atlas" | "cmd" | "people" | "health";
type T = ReturnType<typeof useT>;

const TONE: Record<Tone, { bg: string; ink: string }> = {
  dang: { bg: "var(--dang-t)", ink: "var(--dang)" },
  wait: { bg: "var(--wait-t)", ink: "var(--wait)" },
  open: { bg: "var(--open-t)", ink: "var(--open)" },
  ok: { bg: "var(--ok-t)", ink: "var(--ok)" },
  mute: { bg: "var(--sunk)", ink: "var(--ink-3)" },
};

const SEC_ICON: Record<SecId, [string, string, string]> = {
  channels: ["#", "var(--brand-t)", "var(--brand)"],
  ann: ["◎", "var(--ok-t)", "var(--ok)"],
  page: ["!", "var(--dang-t)", "var(--dang)"],
  alerts: ["⚡", "var(--wait-t)", "var(--wait)"],
  atlas: ["✦", "var(--viol-t)", "var(--viol)"],
  cmd: ["/", "var(--sunk)", "var(--ink-2)"],
  people: ["◐", "var(--open-t)", "var(--open)"],
  health: ["♥", "var(--ok-t)", "var(--ok)"],
};

/** "just now", "2 min ago", "3 h ago", "4 days ago" — the card's last event. */
function rel(t: T, iso: string): string {
  const diff = Math.max(0, Date.now() - new Date(iso).getTime());
  const min = Math.floor(diff / 60_000);
  if (min < 1) return t("chat2.rel.now");
  if (min < 60) return t("chat2.rel.min", { n: min });
  const h = Math.floor(min / 60);
  if (h < 24) return t("chat2.rel.h", { n: h });
  return t("chat2.rel.d", { count: Math.floor(h / 24) });
}

function toolName(p: P): string {
  return p === "slack" ? "Slack" : "Microsoft Teams";
}

/** The last event in a few words — the third figure of a card. */
function shortEvent(t: T, p: P, e: ChatEventView): string {
  const target = e.target ?? "";
  switch (e.kind) {
    case "channel":
      return t("chat2.evs.channel", { target });
    case "header":
      return t("chat2.evs.header", { target });
    case "update":
      return t(p === "teams" ? "chat2.evs.updateTeams" : "chat2.evs.update", { target });
    case "note":
      return t("chat2.evs.note", { target });
    case "announcement":
      return t("chat2.evs.announcement", { target });
    case "page":
      return t("chat2.evs.page", { target });
    case "invite":
      return t("chat2.evs.invite", { target });
    case "test":
      return t(p === "slack" ? "chat2.evs.testSlack" : "chat2.evs.testTeams");
    case "alert":
      return t("chat2.evs.alert", { target });
    case "rca":
      return t("chat2.evs.rca", { target });
    case "atlas":
      return t("chat2.evs.atlas", { target });
    case "draft":
      return t("chat2.evs.draft", { target });
    case "command":
      return target
        ? t("chat2.evs.command", { detail: e.detail ?? "", target })
        : t("chat2.evs.commandDm", { detail: e.detail ?? "" });
    case "pin":
      return t(p === "slack" ? "chat2.evs.pinSlack" : "chat2.evs.pinTeams", { target });
    case "install":
      return t(p === "slack" ? "chat2.evs.installSlack" : "chat2.evs.installTeams");
    default:
      return t("chat2.evs.lookup");
  }
}

/** One line of the Health list. */
function eventLine(t: T, e: ChatEventView): string {
  const target = e.target ?? "—";
  switch (e.kind) {
    case "channel":
      return t("chat2.ev.channel", { target });
    case "header":
      return t("chat2.ev.header", { target });
    case "update":
      return t("chat2.ev.update", { target });
    case "note":
      return t("chat2.ev.note", { target });
    case "announcement":
      return t(e.meta.edited ? "chat2.ev.announcementEdited" : "chat2.ev.announcement", { target });
    case "page":
      return e.meta.ackAt
        ? t("chat2.ev.pageAck", {
            target,
            time: t.fmt.time(new Date(e.meta.ackAt), t.timeZone),
          })
        : t("chat2.ev.page", { target });
    case "invite":
      return t("chat2.ev.invite", { target, detail: e.detail ?? "" });
    case "test":
      return t("chat2.ev.test", { target });
    case "alert":
      return t(e.meta.resolved ? "chat2.ev.alertResolved" : "chat2.ev.alert", { target });
    case "rca":
      return t(e.meta.edited ? "chat2.ev.rcaEdited" : "chat2.ev.rca", { target });
    case "atlas":
      return t("chat2.ev.atlas", { target });
    default:
      return t("chat2.ev.draft", { target });
  }
}

/* ---------- Small pieces of the design's vocabulary ---------- */

function Toggle({
  on,
  onClick,
  testId,
  disabled,
}: {
  on: boolean;
  onClick: () => void;
  testId?: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      data-testid={testId}
      disabled={disabled}
      onClick={onClick}
      style={{
        position: "relative",
        width: 36,
        height: 20,
        borderRadius: 999,
        background: on ? "var(--brand)" : "var(--line)",
        cursor: disabled ? "default" : "pointer",
        flex: "none",
        transition: "background .15s",
        border: 0,
        padding: 0,
        opacity: disabled ? 0.6 : 1,
      }}
    >
      <span
        style={{
          position: "absolute",
          top: 2,
          left: on ? 18 : 2,
          width: 16,
          height: 16,
          borderRadius: "50%",
          background: "#fff",
          boxShadow: "0 1px 2px rgba(0,0,0,.2)",
          transition: "left .15s",
        }}
      />
    </button>
  );
}

function Seg<V extends string>({
  value,
  options,
  onChange,
  disabled,
  testId,
}: {
  value: V;
  options: Array<[V, string]>;
  onChange: (v: V) => void;
  disabled?: boolean;
  testId?: string;
}) {
  return (
    <div
      data-testid={testId}
      style={{
        display: "flex",
        gap: 2,
        background: "var(--sunk)",
        borderRadius: 9,
        padding: 3,
        flexWrap: "wrap",
      }}
    >
      {options.map(([id, l]) => {
        const on = id === value;
        return (
          <button
            key={id}
            type="button"
            aria-pressed={on}
            disabled={disabled}
            onClick={() => !on && onChange(id)}
            style={{
              height: 28,
              padding: "0 11px",
              borderRadius: 7,
              border: 0,
              background: on ? "var(--panel)" : "transparent",
              boxShadow: on ? "0 1px 2px rgba(13,22,28,.12)" : "none",
              display: "flex",
              alignItems: "center",
              fontSize: 12.5,
              fontWeight: on ? 600 : 500,
              cursor: disabled ? "default" : "pointer",
              whiteSpace: "nowrap",
              color: "var(--ink)",
              fontFamily: "inherit",
            }}
          >
            {l}
          </button>
        );
      })}
    </div>
  );
}

function Row({
  label,
  help,
  children,
}: {
  label: ReactNode;
  help?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 14,
        padding: "10px 16px",
        flexWrap: "wrap",
      }}
    >
      <div style={{ flex: "1 1 220px", minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 500 }}>{label}</div>
        {help && (
          <div style={{ fontSize: 11.5, color: "var(--ink-3)", marginTop: 1, lineHeight: 1.45 }}>
            {help}
          </div>
        )}
      </div>
      <div
        style={{
          flex: "0 1 340px",
          minWidth: 160,
          display: "flex",
          justifyContent: "flex-end",
          alignItems: "center",
          gap: 8,
        }}
      >
        {children}
      </div>
    </div>
  );
}

type Item = {
  key: string;
  av?: string;
  avBg?: string;
  avInk?: string;
  code?: string;
  t: string;
  sub?: string;
  chip?: string;
  chipTone?: Tone;
  btn?: string;
  onBtn?: () => void;
  testId?: string;
};

function List({ items }: { items: Item[] }) {
  return (
    <div
      style={{
        margin: "2px 16px 8px",
        border: "1px solid var(--line-2)",
        borderRadius: 11,
        overflow: "hidden",
      }}
    >
      {items.map((li) => (
        <div
          key={li.key}
          data-testid={li.testId}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            padding: "9px 12px",
            borderTop: "1px solid var(--line-2)",
            flexWrap: "wrap",
          }}
        >
          {li.av && (
            <span
              style={{
                width: 24,
                height: 24,
                borderRadius: "50%",
                background: li.avBg ?? "var(--sunk)",
                color: li.avInk ?? "var(--ink-2)",
                display: "grid",
                placeItems: "center",
                fontSize: 9.5,
                fontWeight: 700,
                flex: "none",
              }}
            >
              {li.av}
            </span>
          )}
          {li.code && (
            <code
              style={{
                fontFamily: "var(--mono)",
                fontSize: 12,
                fontWeight: 600,
                background: "var(--sunk)",
                borderRadius: 6,
                padding: "2px 8px",
                whiteSpace: "nowrap",
              }}
            >
              {li.code}
            </code>
          )}
          <div style={{ flex: "1 1 200px", minWidth: 0 }}>
            <div style={{ fontSize: 12.5, fontWeight: 500, lineHeight: 1.4 }}>{li.t}</div>
            {li.sub && (
              <div style={{ fontSize: 11.5, color: "var(--ink-3)", lineHeight: 1.4 }}>{li.sub}</div>
            )}
          </div>
          {li.chip && (
            <span
              style={{
                fontSize: 11,
                fontWeight: 600,
                borderRadius: 999,
                padding: "2px 9px",
                background: TONE[li.chipTone ?? "mute"].bg,
                color:
                  li.chipTone === "mute" || !li.chipTone ? "var(--ink-2)" : TONE[li.chipTone].ink,
                whiteSpace: "nowrap",
              }}
            >
              {li.chip}
            </span>
          )}
          {li.btn && li.onBtn && (
            <button
              type="button"
              onClick={li.onBtn}
              className="oi-hover"
              style={{
                height: 26,
                padding: "0 10px",
                border: "1px solid var(--line)",
                borderRadius: 7,
                display: "flex",
                alignItems: "center",
                fontSize: 11.5,
                fontWeight: 600,
                cursor: "pointer",
                whiteSpace: "nowrap",
                background: "transparent",
                color: "var(--ink)",
                fontFamily: "inherit",
              }}
            >
              {li.btn}
            </button>
          )}
        </div>
      ))}
    </div>
  );
}

function Note({ children, tone }: { children: ReactNode; tone?: Tone }) {
  return (
    <div
      style={{
        margin: "2px 16px 8px",
        background: tone ? TONE[tone].bg : "var(--sunk)",
        borderRadius: 10,
        padding: "9px 12px",
        fontSize: 12,
        lineHeight: 1.5,
        color: tone ? TONE[tone].ink : "var(--ink-2)",
      }}
    >
      {children}
    </div>
  );
}

const ctaStyle: CSSProperties = {
  height: 36,
  padding: "0 15px",
  borderRadius: 10,
  background: "var(--brand)",
  color: "#fff",
  display: "flex",
  alignItems: "center",
  fontSize: 13,
  fontWeight: 600,
  cursor: "pointer",
  border: 0,
  textDecoration: "none",
  fontFamily: "inherit",
  whiteSpace: "nowrap",
};

/* ---------- The screen ---------- */

export function ChatScreen({
  data,
  wizard,
  flash,
  openSection,
}: {
  data: ChatPageData;
  wizard: WizardData | null;
  flash: string | null;
  openSection: SecId | null;
}) {
  const t = useT();
  const router = useRouter();
  const [, startTransition] = useTransition();
  const firstConnected: P = data.providers.slack.connected
    ? "slack"
    : data.providers.teams.connected
      ? "teams"
      : "slack";
  const [pv, setPv] = useState<P>(wizard?.provider ?? firstConnected);
  const [sec, setSec] = useState<SecId | "">(openSection ?? "channels");
  const [ack, setAck] = useState(false);
  const [toast, setToast] = useState<string | null>(flash);
  const [cfg, setCfg] = useState(() => ({
    slack: data.providers.slack.config,
    teams: data.providers.teams.config,
  }));
  const [prefixDraft, setPrefixDraft] = useState({
    slack: data.providers.slack.config.prefix,
    teams: data.providers.teams.config.prefix,
  });
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);
  const [pick, setPick] = useState<PickState | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Server data wins after a refresh (a change made elsewhere, a test that ran).
  useEffect(() => {
    setCfg({ slack: data.providers.slack.config, teams: data.providers.teams.config });
    setPrefixDraft({
      slack: data.providers.slack.config.prefix,
      teams: data.providers.teams.config.prefix,
    });
  }, [data]);

  const say = (m: string) => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast(m);
    toastTimer.current = setTimeout(() => setToast(null), 2600);
  };
  useEffect(() => {
    if (!flash) return;
    toastTimer.current = setTimeout(() => setToast(null), 2600);
    // The one-shot query (?fresh=, ?reinstalled=) leaves the address once read.
    router.replace("/app/settings/chat", { scroll: false });
    return () => {
      if (toastTimer.current) clearTimeout(toastTimer.current);
    };
  }, []);

  const P = data.providers[pv];
  const c = cfg[pv];
  const sl = pv === "slack";
  const N = toolName(pv);
  const manage = data.manage;
  const inc = data.preview.incident;
  const number = inc ? inc.reference.replace(/^INC-/, "") : String(data.preview.nextNumber);
  const chanOf = (p: P, prefix: string) => `${p === "slack" ? "#" : ""}${prefix}${number}`;
  const chan = chanOf(pv, prefixDraft[pv]);

  async function save(key: string, value: unknown, done: string, revert: () => void) {
    const r = await saveChatSetting(pv, { key, value });
    if (r.ok) say(done);
    else {
      revert();
      say(t("chat2.toast.failed", { error: r.error }));
    }
  }
  function setBool(key: "autoInvite" | "inviteOnCall" | "dmPages" | "postRca" | "atlasDrafts") {
    const before = c[key];
    setCfg((s) => ({ ...s, [pv]: { ...s[pv], [key]: !before } }));
    void save(key, !before, t(before ? "chat2.toast.off" : "chat2.toast.on", { name: N }), () =>
      setCfg((s) => ({ ...s, [pv]: { ...s[pv], [key]: before } })),
    );
  }
  function setMode(mode: "auto" | "none") {
    const before = c.mode;
    setCfg((s) => ({ ...s, [pv]: { ...s[pv], mode } }));
    void save(
      "channelMode",
      mode,
      mode === "auto" ? t("chat2.toast.modeAuto", { name: N }) : t("chat2.toast.modeNone"),
      () => setCfg((s) => ({ ...s, [pv]: { ...s[pv], mode: before } })),
    );
  }
  function commitPrefix() {
    const v = prefixDraft[pv];
    if (v === c.prefix) return;
    if (!/^[a-z0-9_-]{1,20}$/.test(v)) {
      setPrefixDraft((s) => ({ ...s, [pv]: c.prefix }));
      say(t("chat2.wiz.invalid"));
      return;
    }
    const before = c.prefix;
    setCfg((s) => ({ ...s, [pv]: { ...s[pv], prefix: v } }));
    void save("channelPrefix", v, t("chat2.toast.prefix", { chan: chanOf(pv, v) }), () => {
      setCfg((s) => ({ ...s, [pv]: { ...s[pv], prefix: before } }));
      setPrefixDraft((s) => ({ ...s, [pv]: before }));
    });
  }
  function setAnnounce(value: string) {
    const before = { id: c.announceId, name: c.announceName };
    const [id, ...rest] = value ? value.split("|") : [""];
    const name = id ? rest.join("|") : null;
    setCfg((s) => ({ ...s, [pv]: { ...s[pv], announceId: id || null, announceName: name } }));
    void save(
      "announce",
      value,
      name ? t("chat2.toast.ann", { channel: sl ? `#${name}` : name }) : t("chat2.toast.annNone"),
      () =>
        setCfg((s) => ({
          ...s,
          [pv]: { ...s[pv], announceId: before.id, announceName: before.name },
        })),
    );
  }
  async function runTest() {
    const r = await testFromHealth(pv);
    if (r.ok)
      say(t(sl ? "chat2.toast.testedSlack" : "chat2.toast.testedTeams", { where: r.detail ?? "" }));
    else say(t("chat2.toast.testFailed", { name: N, error: r.error }));
    startTransition(() => router.refresh());
  }
  async function disconnect() {
    if (!confirmDisconnect) {
      setConfirmDisconnect(true);
      setTimeout(() => setConfirmDisconnect(false), 3000);
      return;
    }
    setConfirmDisconnect(false);
    const r = await disconnectProvider(pv);
    say(
      r.ok
        ? t("chat2.toast.disconnected", { name: N })
        : t("chat2.toast.failed", { error: r.error }),
    );
    startTransition(() => router.refresh());
  }
  async function link(memberId: string, name: string, email: string, method: boolean) {
    const r = await linkMember(pv, memberId);
    if (r.ok) {
      say(t("chat2.toast.linked", { member: name, name: N }));
      startTransition(() => router.refresh());
      return;
    }
    if (r.error === "no_match") {
      setPick({ provider: pv, memberId, member: name, email, accounts: r.accounts ?? [], method });
      return;
    }
    say(t("chat2.toast.failed", { error: r.error }));
  }
  async function linkTo(externalId: string) {
    if (!pick) return;
    const r = await linkMemberTo(pick.provider, pick.memberId, externalId);
    if (r.ok) {
      say(t("chat2.toast.linked", { member: pick.member, name: toolName(pick.provider) }));
      setPick(null);
      startTransition(() => router.refresh());
    } else
      say(
        r.error === "already_linked"
          ? t("chat2.pick.taken")
          : t("chat2.toast.failed", { error: r.error }),
      );
  }

  /* ----- Provider cards ----- */
  const card = (p: P) => {
    const d = data.providers[p];
    const on = p === pv;
    const name = toolName(p);
    const status =
      !d.env && !d.connected
        ? t("chat2.st.unavailable")
        : d.connected
          ? t(p === "slack" ? "chat2.st.connected" : "chat2.st.paired")
          : t("chat2.st.notConnected");
    const okTone = d.connected;
    const who = d.installedBy
      ? d.installedBy.you
        ? t("chat2.where.you")
        : (d.installedBy.name ?? t("chat2.where.former"))
      : t("chat2.where.former");
    const when = d.installedAt
      ? Date.now() - new Date(d.installedAt).getTime() < 60_000
        ? t("chat2.rel.now")
        : t.fmt.dateCompact(new Date(d.installedAt))
      : "";
    const where = d.connected
      ? p === "slack"
        ? t("chat2.where.slack", { team: d.team ?? "", who, when })
        : d.tenantDomain
          ? t("chat2.where.teams", { team: d.team ?? "", tenant: d.tenantDomain, who, when })
          : t("chat2.where.teamsNoTenant", { team: d.team ?? "", who, when })
      : !d.env
        ? t(p === "slack" ? "chat2.unavailable.slack" : "chat2.unavailable.teams")
        : t(p === "slack" ? "chat2.notConnected.slack" : "chat2.notConnected.teams");
    const unlinked = d.stats.members - d.stats.linked;
    const fresh = d.stats.channels90 === 0 && d.health.events.length <= 1;
    const stats: Array<{ l: string; v: string; sub: string; ink: string }> = [
      {
        l: t("chat2.stat.channels"),
        v: String(d.stats.channels90),
        sub:
          d.stats.channels90 > 0
            ? t("chat2.stat.channelsSub")
            : d.config.mode === "auto"
              ? t("chat2.stat.channelsNone")
              : t("chat2.stat.channelsAsked"),
        ink: "var(--ink)",
      },
      {
        l: t("chat2.stat.linked"),
        v: `${d.stats.linked} / ${d.stats.members}`,
        sub:
          unlinked === 0
            ? t("chat2.stat.all")
            : d.stats.misses > 0 && !fresh
              ? t(p === "slack" ? "chat2.stat.missSlack" : "chat2.stat.missTeams", {
                  count: d.stats.misses,
                })
              : t("chat2.stat.later"),
        ink: d.stats.misses > 0 && !fresh ? "var(--wait)" : "var(--ink)",
      },
      {
        l: t("chat2.stat.last"),
        v: d.last ? rel(t, d.last.at) : t("chat2.stat.lastNone"),
        sub: d.last ? shortEvent(t, p, d.last) : t("chat2.stat.lastNoneSub"),
        ink: d.last?.status === "failed" ? "var(--dang)" : "var(--ink)",
      },
    ];
    const how = [1, 2, 3].map((n) => t(`chat2.how.${p}.${n}` as MessageKey));
    return (
      <div
        key={p}
        data-testid={`chat-card-${p}`}
        data-state={d.connected ? "connected" : d.env ? "not-connected" : "unavailable"}
        onClick={() => {
          setPv(p);
          setAck(false);
        }}
        className="chat2-card"
        style={{
          background: "var(--panel)",
          border: on ? "1.5px solid var(--brand)" : "1px solid var(--line)",
          borderRadius: "var(--radius-card)",
          boxShadow: on ? "var(--shadow-card-hover)" : "var(--shadow-card)",
          padding: "16px 18px",
          display: "flex",
          flexDirection: "column",
          gap: 12,
          cursor: "pointer",
          transition: "box-shadow .15s",
          minWidth: 0,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <span
            style={{
              width: 42,
              height: 42,
              borderRadius: 12,
              background: "var(--topbar-dark)",
              color: "#fff",
              display: "grid",
              placeItems: "center",
              fontSize: 14,
              fontWeight: 700,
              letterSpacing: "-.02em",
              flex: "none",
            }}
          >
            {p === "slack" ? "Sl" : "Te"}
          </span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div
              style={{ display: "flex", alignItems: "center", gap: "4px 8px", flexWrap: "wrap" }}
            >
              <span style={{ fontSize: 15.5, fontWeight: 600, whiteSpace: "nowrap" }}>{name}</span>
              <span
                data-testid={`chat-status-${p}`}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 5,
                  fontSize: 11,
                  fontWeight: 600,
                  borderRadius: 999,
                  padding: "2px 9px",
                  background: okTone ? "var(--ok-t)" : "var(--sunk)",
                  color: okTone ? "var(--ok)" : "var(--ink-3)",
                  whiteSpace: "nowrap",
                }}
              >
                <span
                  style={{
                    width: 6,
                    height: 6,
                    borderRadius: "50%",
                    background: okTone ? "var(--ok)" : "var(--ink-3)",
                  }}
                />
                {status}
              </span>
            </div>
            <div
              title={where}
              style={{
                fontSize: 12,
                color: "var(--ink-3)",
                marginTop: 1,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {where}
            </div>
          </div>
          {on && d.connected && (
            <span
              style={{
                fontSize: 11,
                fontWeight: 700,
                letterSpacing: ".06em",
                color: "var(--brand)",
                background: "var(--brand-t)",
                borderRadius: 6,
                padding: "3px 8px",
                whiteSpace: "nowrap",
              }}
            >
              {t("chat2.editing")}
            </span>
          )}
        </div>
        {d.connected ? (
          <>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(3,minmax(0,1fr))",
                gap: 1,
                background: "var(--line-2)",
                border: "1px solid var(--line-2)",
                borderRadius: 11,
                overflow: "hidden",
              }}
            >
              {stats.map((s) => (
                <div
                  key={s.l}
                  style={{ background: "var(--panel)", padding: "9px 12px", minWidth: 0 }}
                >
                  <div
                    style={{
                      fontSize: 10,
                      fontWeight: 700,
                      letterSpacing: ".08em",
                      textTransform: "uppercase",
                      color: "var(--ink-3)",
                      whiteSpace: "nowrap",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                    }}
                  >
                    {s.l}
                  </div>
                  <div
                    style={{
                      fontSize: 15,
                      fontWeight: 600,
                      marginTop: 2,
                      color: s.ink,
                      whiteSpace: "nowrap",
                    }}
                  >
                    {s.v}
                  </div>
                  <div
                    title={s.sub}
                    style={{
                      fontSize: 11,
                      color: "var(--ink-3)",
                      whiteSpace: "nowrap",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                    }}
                  >
                    {s.sub}
                  </div>
                </div>
              ))}
            </div>
            {d.open.length > 0 && (
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                {d.open.map((o) => (
                  <span
                    key={o.label}
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 6,
                      height: 24,
                      padding: "0 9px",
                      borderRadius: 7,
                      background: "var(--sunk)",
                      fontFamily: "var(--mono)",
                      fontSize: 11.5,
                      fontWeight: 600,
                      color: "var(--ink-2)",
                    }}
                  >
                    <span
                      style={{
                        width: 6,
                        height: 6,
                        borderRadius: "50%",
                        background: TONE[o.tone].ink,
                      }}
                    />
                    {o.label}
                  </span>
                ))}
              </div>
            )}
          </>
        ) : d.env ? (
          <>
            <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
              {how.map((h, i) => (
                <div
                  key={h}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 9,
                    fontSize: 12.5,
                    color: "var(--ink-2)",
                  }}
                >
                  <span
                    style={{
                      width: 20,
                      height: 20,
                      borderRadius: "50%",
                      background: "var(--sunk)",
                      color: "var(--ink-2)",
                      display: "grid",
                      placeItems: "center",
                      fontSize: 10.5,
                      fontWeight: 700,
                      flex: "none",
                    }}
                  >
                    {i + 1}
                  </span>
                  {h}
                </div>
              ))}
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
              {manage && (
                <ConnectButton
                  provider={p}
                  label={t(p === "slack" ? "chat2.connect.slack" : "chat2.connect.teams")}
                  testId={`chat-connect-${p}`}
                />
              )}
              <span style={{ fontSize: 12, color: "var(--ink-3)" }}>
                {manage ? t("chat2.connect.hint") : t("chat2.connect.hintMember")}
              </span>
            </div>
          </>
        ) : (
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <span style={{ fontSize: 12.5, color: "var(--ink-2)", lineHeight: 1.5 }}>
              {t(p === "slack" ? "chat2.unav.slack" : "chat2.unav.teams")}
            </span>
            {p === "slack" && manage && (
              <a
                href="/api/slack/manifest"
                onClick={(e) => e.stopPropagation()}
                style={{
                  fontSize: 12.5,
                  fontWeight: 600,
                  color: "var(--brand)",
                  textDecoration: "none",
                }}
              >
                {t("chat2.manifest")}
              </a>
            )}
          </div>
        )}
      </div>
    );
  };

  /* ----- Sections ----- */
  const people = P.people;
  const unlinkedCount = people.filter((m) => !m.linked).length;
  const pagesUnreachable = P.pages.filter((m) => !m.reachable).length;
  const allStep1 = P.pages.length > 0 && P.pages.every((m) => m.step === 1);
  const annLabel = c.announceName
    ? sl
      ? `#${c.announceName}`
      : c.announceName
    : t("chat2.ann.none");
  const annOptions = useMemo(() => {
    const opts = P.channelOptions.map((o) => ({
      value: `${o.id}|${o.name}`,
      label: sl ? `#${o.name}` : o.name,
      id: o.id,
    }));
    if (c.announceId && !opts.some((o) => o.id === c.announceId))
      opts.unshift({
        value: `${c.announceId}|${c.announceName ?? ""}`,
        label: annLabel,
        id: c.announceId,
      });
    return opts;
  }, [P.channelOptions, c.announceId, c.announceName, annLabel, sl]);
  const kindWord = (k: string) => t(`chat2.kind.${k}` as MessageKey);
  const palette: Array<[string, string]> = [
    ["var(--wait-t)", "var(--wait)"],
    ["var(--ok-t)", "var(--ok)"],
    ["var(--open-t)", "var(--open)"],
    ["var(--viol-t)", "var(--viol)"],
  ];
  const cmd = (w: string) => (sl ? `/incident ${w}` : `@Open Incident ${w}`);
  const failed = P.health.failedLastHour;

  type Section = {
    id: SecId;
    t: string;
    sum: string;
    warn?: string;
    body: ReactNode;
  };
  const sections: Section[] = [
    {
      id: "channels",
      t: t("chat2.sec.channels"),
      sum: `${c.mode === "auto" ? t("chat2.sec.channels.auto") : t("chat2.sec.channels.none")} · ${chan}`,
      body: (
        <>
          <Row label={t("chat2.row.when")}>
            <Seg
              testId="chat-mode"
              value={c.mode}
              disabled={!manage}
              onChange={setMode}
              options={[
                ["auto", t("chat2.seg.every")],
                ["none", t("chat2.seg.asked")],
              ]}
            />
          </Row>
          <Row label={t("chat2.row.name")} help={t("chat2.row.nameHelp")}>
            <input
              data-testid="chat-prefix"
              value={prefixDraft[pv]}
              disabled={!manage}
              aria-label={t("chat2.row.name")}
              onChange={(e) => {
                const v = e.target.value
                  .toLowerCase()
                  .replace(/[^a-z0-9_-]/g, "")
                  .slice(0, 20);
                setPrefixDraft((s) => ({ ...s, [pv]: v }));
              }}
              onBlur={commitPrefix}
              onKeyDown={(e) => {
                if (e.key === "Enter") (e.target as HTMLInputElement).blur();
              }}
              className="oi-field"
              style={{
                width: 140,
                height: 32,
                border: "1px solid var(--line)",
                borderRadius: 9,
                padding: "0 10px",
                fontFamily: "var(--mono)",
                fontSize: 12.5,
                background: "var(--panel)",
                outline: "none",
                color: "var(--ink)",
              }}
            />
            <span
              style={{
                fontFamily: "var(--mono)",
                fontSize: 12,
                color: "var(--ink-3)",
                whiteSpace: "nowrap",
              }}
            >
              → {chan}
            </span>
          </Row>
          <Row label={t("chat2.row.invite")} help={t("chat2.row.inviteHelp", { name: N })}>
            <Toggle
              testId="chat-toggle-autoInvite"
              on={c.autoInvite}
              disabled={!manage}
              onClick={() => setBool("autoInvite")}
            />
          </Row>
          <Row label={t("chat2.row.oncall")}>
            <Toggle
              testId="chat-toggle-inviteOnCall"
              on={c.inviteOnCall}
              disabled={!manage}
              onClick={() => setBool("inviteOnCall")}
            />
          </Row>
          <Row label={t("chat2.row.header")}>
            <span
              style={{ fontSize: 12, color: "var(--ink-2)", textAlign: "right", lineHeight: 1.45 }}
            >
              {t("chat2.row.headerText")}
            </span>
          </Row>
          {!sl && <Note>{t("chat2.channels.teamsNote", { team: P.team ?? "" })}</Note>}
        </>
      ),
    },
    {
      id: "ann",
      t: t("chat2.sec.ann"),
      sum: t("chat2.sec.ann.sum", { channel: annLabel }),
      body: (
        <>
          <Row label={t("chat2.row.annIn")} help={t("chat2.row.annInHelp")}>
            <select
              data-testid="chat-announce"
              value={c.announceId ? `${c.announceId}|${c.announceName ?? ""}` : ""}
              disabled={!manage}
              onChange={(e) => setAnnounce(e.target.value)}
              className="oi-field"
              style={{
                width: "100%",
                maxWidth: 240,
                height: 32,
                border: "1px solid var(--line)",
                borderRadius: 9,
                padding: "0 9px",
                fontFamily: "var(--mono)",
                fontSize: 12.5,
                background: "var(--panel)",
                outline: "none",
                color: "var(--ink)",
              }}
            >
              {annOptions.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
              <option value="">{t("chat2.ann.none")}</option>
            </select>
          </Row>
          <Row label={t("chat2.row.annWho")} help={t("chat2.row.annWhoHelp")}>
            <Link
              href="/app/settings/announcements"
              style={{
                fontSize: 12.5,
                fontWeight: 600,
                color: "var(--brand)",
                cursor: "pointer",
                whiteSpace: "nowrap",
                textDecoration: "none",
              }}
            >
              {t("chat2.row.annWhoLink")} →
            </Link>
          </Row>
        </>
      ),
    },
    {
      id: "page",
      t: t("chat2.sec.page"),
      sum:
        P.pages.length === 0
          ? t("chat2.sec.page.sumNone")
          : allStep1
            ? t("chat2.sec.page.sum", { count: P.pages.length })
            : t("chat2.sec.page.sumMixed", { count: P.pages.length }),
      warn:
        pagesUnreachable > 0 ? t("chat2.sec.page.warn", { count: pagesUnreachable }) : undefined,
      body: (
        <>
          <Row label={t("chat2.row.offer", { name: N })} help={t("chat2.row.offerHelp")}>
            <Toggle
              testId="chat-toggle-dmPages"
              on={c.dmPages}
              disabled={!manage}
              onClick={() => setBool("dmPages")}
            />
          </Row>
          <Row label={t("chat2.row.urgency")}>
            <span
              style={{ fontSize: 12, color: "var(--ink-2)", textAlign: "right", lineHeight: 1.45 }}
            >
              {t("chat2.row.urgencyText")}
            </span>
          </Row>
          {!c.dmPages && <Note tone="wait">{t("chat2.page.off", { name: N })}</Note>}
          {P.pages.length > 0 ? (
            <List
              items={P.pages.map((m, i) => ({
                key: m.memberId,
                testId: "chat-page-row",
                av: initials(m.name),
                avBg: m.reachable ? palette[i % palette.length]![0] : undefined,
                avInk: m.reachable ? palette[i % palette.length]![1] : undefined,
                t: m.name,
                sub: !m.reachable
                  ? sl
                    ? t("chat2.people.noSlack", {
                        email: people.find((x) => x.memberId === m.memberId)?.email ?? "",
                      })
                    : t("chat2.people.noTeams", { team: P.team ?? "" })
                  : m.next
                    ? m.next.delay > 0
                      ? t("chat2.page.stepThen", {
                          n: m.step,
                          next: kindWord(m.next.kind),
                          delay: m.next.delay,
                        })
                      : t("chat2.page.stepThenNow", { n: m.step, next: kindWord(m.next.kind) })
                    : t("chat2.page.step", { n: m.step }),
                chip: m.reachable ? t("chat2.chip.reachable") : t("chat2.chip.unreachable"),
                chipTone: m.reachable ? "ok" : "wait",
                btn: !m.reachable && manage ? t("chat2.btn.linkByHand") : undefined,
                onBtn: () =>
                  void link(
                    m.memberId,
                    m.name,
                    people.find((x) => x.memberId === m.memberId)?.email ?? "",
                    true,
                  ),
              }))}
            />
          ) : (
            <Note>{t("chat2.page.empty", { name: N })}</Note>
          )}
        </>
      ),
    },
    {
      id: "alerts",
      t: t("chat2.sec.alerts"),
      sum: P.rules.length
        ? t("chat2.sec.alerts.sum", { count: P.rules.length })
        : t("chat2.sec.alerts.none"),
      body: (
        <>
          <Row label={t("chat2.row.rules")} help={t("chat2.row.rulesHelp")}>
            <Link
              href="/app/settings/alert-routes"
              style={{
                fontSize: 12.5,
                fontWeight: 600,
                color: "var(--brand)",
                whiteSpace: "nowrap",
                textDecoration: "none",
              }}
            >
              {t("chat2.row.rulesLink")} →
            </Link>
          </Row>
          {P.rules.length > 0 ? (
            <List
              items={P.rules.map((r) => ({
                key: r.id,
                code: r.channel,
                t: r.when,
                sub: `${t("chat2.alerts.count", { count: r.alerts7d })}${r.muted ? ` · ${t("chat2.alerts.muted")}` : ""}`,
              }))}
            />
          ) : (
            <Note>{sl ? t("chat2.alerts.empty") : t("chat2.alerts.teams")}</Note>
          )}
        </>
      ),
    },
    {
      id: "atlas",
      t: t("chat2.sec.atlas"),
      sum: t("chat2.sec.atlas.sum"),
      body: (
        <>
          <Row label={t("chat2.row.rca")} help={t("chat2.row.rcaHelp")}>
            <Toggle
              testId="chat-toggle-postRca"
              on={c.postRca}
              disabled={!manage}
              onClick={() => setBool("postRca")}
            />
          </Row>
          <Row label={t("chat2.row.drafts")} help={t("chat2.row.draftsHelp")}>
            <Toggle
              testId="chat-toggle-atlasDrafts"
              on={c.atlasDrafts}
              disabled={!manage}
              onClick={() => setBool("atlasDrafts")}
            />
          </Row>
        </>
      ),
    },
    {
      id: "cmd",
      t: t("chat2.sec.cmd"),
      sum: t(sl ? "chat2.sec.cmd.slack" : "chat2.sec.cmd.teams"),
      body: (
        <>
          <List
            items={[
              ["declare", t("chat2.cmd.declare")],
              ["update", t("chat2.cmd.update")],
              ["escalate", t("chat2.cmd.escalate")],
              ["atlas stop", t("chat2.cmd.atlasStop")],
              ["atlas approve", t("chat2.cmd.atlasApprove")],
              ["lead", t("chat2.cmd.lead")],
              ["pin", t("chat2.cmd.pin")],
            ].map(([w, d]) => ({
              key: w!,
              code: w === "pin" ? t(sl ? "chat2.cmd.pinSlack" : "chat2.cmd.pinTeams") : cmd(w!),
              t: d!,
            }))}
          />
          <Note>{t("chat2.cmd.note")}</Note>
        </>
      ),
    },
    {
      id: "people",
      t: t("chat2.sec.people"),
      sum: t(sl ? "chat2.sec.people.slack" : "chat2.sec.people.teams", {
        n: P.stats.linked,
        total: P.stats.members,
      }),
      warn: unlinkedCount > 0 ? t("chat2.sec.people.warn", { count: unlinkedCount }) : undefined,
      body: (
        <>
          <List
            items={people.map((m) => ({
              key: m.memberId,
              testId: "chat-person",
              av: initials(m.name),
              t: m.name,
              sub: m.linked
                ? m.byHandAt
                  ? t("chat2.people.byHand", { when: rel(t, m.byHandAt) })
                  : m.email
                : m.miss
                  ? sl
                    ? t("chat2.people.noSlack", { email: m.email })
                    : t("chat2.people.noTeams", { team: P.team ?? "" })
                  : m.email,
              chip: m.linked ? t("chat2.chip.linked") : t("chat2.chip.notLinked"),
              chipTone: m.linked ? "ok" : "wait",
              btn: !m.linked && manage ? t("chat2.btn.link") : undefined,
              onBtn: () => void link(m.memberId, m.name, m.email, false),
            }))}
          />
          <Note>{t("chat2.people.note", { name: N })}</Note>
        </>
      ),
    },
    {
      id: "health",
      t: t("chat2.sec.health"),
      sum:
        P.health.sentLastHour === 0
          ? t("chat2.sec.health.quiet")
          : failed > 0
            ? t("chat2.sec.health.failed", { count: failed })
            : t("chat2.sec.health.ok"),
      warn: failed > 0 ? t("chat2.sec.health.failed", { count: failed }) : undefined,
      body: (
        <>
          {P.health.events.length > 0 ? (
            <List
              items={P.health.events.map((e, i) => ({
                key: `${e.at}-${i}`,
                testId: "chat-delivery",
                code: t.fmt.time(new Date(e.at), t.timeZone),
                t: eventLine(t, e),
                chip: e.status === "delivered" ? t("chat2.chip.delivered") : (e.error ?? "failed"),
                chipTone: e.status === "delivered" ? "ok" : "wait",
              }))}
            />
          ) : (
            <Note>{t("chat2.health.empty")}</Note>
          )}
          {manage && (
            <div style={{ display: "flex", gap: 8, padding: "4px 16px 8px", flexWrap: "wrap" }}>
              <ActButton
                testId="chat-health-test"
                primary
                onClick={() => void runTest()}
                disabled={!P.env && !sl}
              >
                {t(sl ? "chat2.act.testSlack" : "chat2.act.testTeams")}
              </ActButton>
              {sl ? (
                P.env ? (
                  <a href="/api/slack/oauth/start" style={actStyle(false)} className="oi-hover">
                    {t("chat2.act.reinstall")}
                  </a>
                ) : null
              ) : P.env ? (
                <form action={startPairing} style={{ display: "contents" }}>
                  <input type="hidden" name="fresh" value="1" />
                  <button type="submit" style={actStyle(false)} className="oi-hover">
                    {t("chat2.act.newCode")}
                  </button>
                </form>
              ) : null}
              <ActButton testId="chat-disconnect" danger onClick={() => void disconnect()}>
                {confirmDisconnect ? t("chat2.act.disconnectConfirm") : t("chat2.act.disconnect")}
              </ActButton>
            </div>
          )}
        </>
      ),
    },
  ];

  /* ----- Preview ----- */
  const preview = previewFor({
    t,
    pv,
    sl,
    N,
    c: { ...c, prefix: prefixDraft[pv] },
    chan,
    data,
    ack,
    setAck,
    setMode: manage ? setMode : () => {},
    annLabel,
    sec,
  });

  return (
    <div
      data-screen-label="Settings — Slack & Teams"
      data-testid="chat-settings"
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 16,
        minWidth: 0,
        animation: "ohd-rise .16s ease backwards",
      }}
    >
      <style>{`.chat2-card:hover{box-shadow:var(--shadow-card-hover)!important}.chat2-sec:hover{background:var(--sunk)}`}</style>
      <div style={{ display: "flex", alignItems: "flex-end", gap: 14, flexWrap: "wrap" }}>
        <div style={{ flex: "1 1 360px", minWidth: 0 }}>
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
              {t("chat2.home")}
            </Link>
            <span>/</span>
            <span>{t("chat2.crumb")}</span>
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
            {t("chat2.title")}
          </h1>
          <p
            style={{
              margin: "5px 0 0",
              fontSize: 13.5,
              lineHeight: 1.55,
              color: "var(--ink-2)",
              maxWidth: 680,
              textWrap: "pretty",
            }}
          >
            {t("chat2.lead")}
          </p>
        </div>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit,minmax(320px,1fr))",
          gap: 12,
        }}
      >
        {card("slack")}
        {card("teams")}
      </div>

      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          background: "var(--sunk)",
          borderRadius: 12,
          padding: "10px 14px",
          fontSize: 12.5,
          color: "var(--ink-2)",
          flexWrap: "wrap",
        }}
      >
        <span style={{ fontWeight: 600, color: "var(--ink)" }}>{t("chat2.same.t")}</span>
        <span style={{ flex: 1, minWidth: 240 }}>{t("chat2.same.d")}</span>
      </div>

      <div style={{ display: "flex", flexWrap: "wrap", gap: 16, alignItems: "flex-start" }}>
        <div
          style={{
            flex: "10 1 460px",
            minWidth: 0,
            display: "flex",
            flexDirection: "column",
            gap: 8,
          }}
        >
          {!P.connected ? (
            <div
              data-testid="chat-not-connected"
              style={{
                background: "var(--panel)",
                border: "1.5px dashed var(--line)",
                borderRadius: "var(--radius-card)",
                padding: "28px 24px",
                display: "flex",
                flexDirection: "column",
                alignItems: "flex-start",
                gap: 10,
              }}
            >
              <div style={{ fontSize: 15, fontWeight: 600 }}>
                {P.env ? t("chat2.not.t", { name: N }) : t("chat2.unav.t", { name: N })}
              </div>
              <div style={{ fontSize: 13, color: "var(--ink-2)", lineHeight: 1.55, maxWidth: 520 }}>
                {P.env ? t("chat2.not.d") : t(sl ? "chat2.unav.slack" : "chat2.unav.teams")}
              </div>
              {P.env ? (
                manage && (
                  <ConnectButton
                    provider={pv}
                    label={t(sl ? "chat2.connect.slack" : "chat2.connect.teams")}
                  />
                )
              ) : (
                <code
                  data-testid="chat-unavailable"
                  style={{
                    fontFamily: "var(--mono)",
                    fontSize: 12,
                    background: "var(--sunk)",
                    borderRadius: 8,
                    padding: "7px 11px",
                    color: "var(--ink-2)",
                  }}
                >
                  {sl
                    ? "SLACK_CLIENT_ID · SLACK_CLIENT_SECRET · SLACK_SIGNING_SECRET"
                    : "TEAMS_APP_ID · TEAMS_APP_SECRET"}
                </code>
              )}
            </div>
          ) : (
            <>
              {!P.env && (
                <div
                  data-testid="chat-env-note"
                  role="note"
                  style={{
                    background: "var(--wait-t)",
                    color: "var(--wait)",
                    borderRadius: 12,
                    padding: "10px 14px",
                    fontSize: 12.5,
                    lineHeight: 1.55,
                  }}
                >
                  {t(sl ? "chat2.envNote.slack" : "chat2.envNote.teams")}
                </div>
              )}
              {sections.map((s) => {
                const open = s.id === sec;
                const [ic, icBg, icInk] = SEC_ICON[s.id];
                return (
                  <div
                    key={s.id}
                    data-testid={`chat-sec-${s.id}`}
                    style={{
                      background: "var(--panel)",
                      border: `1px solid ${open ? "var(--brand-b)" : "var(--line)"}`,
                      borderRadius: "var(--radius-card)",
                      boxShadow: "var(--shadow-card)",
                      overflow: "hidden",
                    }}
                  >
                    <button
                      type="button"
                      aria-expanded={open}
                      onClick={() => {
                        setSec(open ? "" : s.id);
                        setAck(false);
                      }}
                      className="chat2-sec"
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 12,
                        padding: "13px 16px",
                        cursor: "pointer",
                        width: "100%",
                        border: 0,
                        background: "transparent",
                        textAlign: "left",
                        color: "inherit",
                        fontFamily: "inherit",
                      }}
                    >
                      <span
                        style={{
                          width: 30,
                          height: 30,
                          borderRadius: 9,
                          background: icBg,
                          color: icInk,
                          display: "grid",
                          placeItems: "center",
                          fontSize: 13,
                          fontWeight: 700,
                          flex: "none",
                        }}
                      >
                        {ic}
                      </span>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 13.5, fontWeight: 600 }}>{s.t}</div>
                        <div
                          style={{
                            fontSize: 12,
                            color: "var(--ink-3)",
                            marginTop: 1,
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                          }}
                        >
                          {s.sum}
                        </div>
                      </div>
                      {s.warn && (
                        <span
                          style={{
                            fontSize: 11,
                            fontWeight: 600,
                            background: "var(--wait-t)",
                            color: "var(--wait)",
                            borderRadius: 999,
                            padding: "2px 9px",
                            whiteSpace: "nowrap",
                          }}
                        >
                          {s.warn}
                        </span>
                      )}
                      <span
                        style={{
                          color: "var(--ink-3)",
                          fontSize: 12,
                          transform: open ? "rotate(90deg)" : "none",
                          transition: "transform .15s",
                        }}
                      >
                        ›
                      </span>
                    </button>
                    {open && (
                      <div
                        style={{
                          borderTop: "1px solid var(--line-2)",
                          padding: "4px 0 6px",
                          animation: "ohd-rise .12s ease backwards",
                        }}
                      >
                        {s.body}
                      </div>
                    )}
                  </div>
                );
              })}
            </>
          )}
        </div>

        <ChatPreview
          provider={pv}
          where={preview.where}
          meta={preview.meta}
          msgs={preview.msgs}
          note={preview.note}
          title={t("chat2.pv.title")}
          appLabel={t("chat2.pv.app")}
          pinnedLabel={t("chat2.pv.pinned")}
          tabs={(["slack", "teams"] as const).map((id) => ({
            id,
            label: t(id === "slack" ? "chat2.pv.slack" : "chat2.pv.teams"),
            on: id === pv,
            onClick: () => {
              setPv(id);
              setAck(false);
            },
          }))}
        />
      </div>

      {wizard && <ChatWizard w={wizard} />}
      {pick && (
        <LinkPicker state={pick} onCancel={() => setPick(null)} onPick={(id) => void linkTo(id)} />
      )}

      {toast && (
        <div
          role="status"
          data-testid="chat-toast"
          style={{
            position: "fixed",
            left: "50%",
            bottom: 24,
            transform: "translateX(-50%)",
            zIndex: 90,
            background: "var(--topbar-dark)",
            color: "#fff",
            borderRadius: 10,
            padding: "10px 16px",
            fontSize: 13,
            fontWeight: 500,
            boxShadow: "var(--shadow-pop)",
            maxWidth: "90vw",
          }}
        >
          {toast}
        </div>
      )}
    </div>
  );
}

function actStyle(primary: boolean, danger?: boolean): CSSProperties {
  return {
    height: 32,
    padding: "0 13px",
    borderRadius: 9,
    border: `1px solid ${primary ? "var(--brand)" : "var(--line)"}`,
    background: primary ? "var(--brand)" : "var(--panel)",
    color: primary ? "#fff" : danger ? "var(--dang)" : "var(--ink)",
    display: "flex",
    alignItems: "center",
    fontSize: 12.5,
    fontWeight: 600,
    cursor: "pointer",
    whiteSpace: "nowrap",
    textDecoration: "none",
    fontFamily: "inherit",
  };
}

function ActButton({
  children,
  onClick,
  primary,
  danger,
  testId,
  disabled,
}: {
  children: ReactNode;
  onClick: () => void;
  primary?: boolean;
  danger?: boolean;
  testId?: string;
  disabled?: boolean;
}) {
  const [busy, setBusy] = useState(false);
  return (
    <button
      type="button"
      data-testid={testId}
      disabled={busy || disabled}
      onClick={async () => {
        setBusy(true);
        try {
          await onClick();
        } finally {
          setBusy(false);
        }
      }}
      className={primary ? "oi-hover-brand-2" : danger ? "oi-hover-dang" : "oi-hover"}
      style={{ ...actStyle(Boolean(primary), danger), opacity: busy || disabled ? 0.7 : 1 }}
    >
      {children}
    </button>
  );
}

/** "Connect Slack" opens the wizard; "Connect Microsoft Teams" first issues the pairing code. */
function ConnectButton({
  provider,
  label,
  testId,
}: {
  provider: P;
  label: string;
  testId?: string;
}) {
  if (provider === "slack")
    return (
      <Link
        href="/app/settings/chat?connect=slack&step=1"
        scroll={false}
        data-testid={testId}
        onClick={(e) => e.stopPropagation()}
        className="oi-hover-brand-2"
        style={ctaStyle}
      >
        {label}
      </Link>
    );
  return (
    <form
      action={startPairing}
      onClick={(e) => e.stopPropagation()}
      style={{ display: "contents" }}
    >
      <button type="submit" data-testid={testId} className="oi-hover-brand-2" style={ctaStyle}>
        {label}
      </button>
    </form>
  );
}

/* ---------- What people see, per section ---------- */

function previewFor({
  t,
  pv,
  sl,
  N,
  c,
  chan,
  data,
  ack,
  setAck,
  setMode,
  annLabel,
  sec,
}: {
  t: T;
  pv: P;
  sl: boolean;
  N: string;
  c: ProviderData["config"];
  chan: string;
  data: ChatPageData;
  ack: boolean;
  setAck: (v: boolean) => void;
  setMode: (m: "auto" | "none") => void;
  annLabel: string;
  sec: SecId | "";
}): { where: string; meta: string; msgs: PreviewMsg[]; note: string } {
  const pr = data.preview;
  const inc = pr.incident;
  const time = (iso: string) => t.fmt.time(new Date(iso), t.timeZone);
  const ref = inc?.reference ?? `INC-${pr.nextNumber}`;
  const title = inc ? `${inc.reference} — ${inc.name}` : t("chat2.pv.sample", { n: pr.nextNumber });
  const team = data.providers[pv].team ?? (sl ? "Slack" : "Teams");
  const bar = (ink: string) => (sl ? undefined : ink);
  const toneInk = (tone: Tone) => (tone === "mute" ? "var(--ink)" : `var(--${tone})`);
  const people = (names: string[], onCall: string[]): string => {
    const all = [...names, ...onCall.map((n) => t("chat2.pv.onCall", { name: n }))];
    if (all.length === 0) return t("chat2.pv.addedNobody");
    const line =
      all.length === 1
        ? all[0]!
        : `${all.slice(0, -1).join(", ")} ${t("chat2.pv.and")} ${all[all.length - 1]}`;
    return all.length === 1
      ? t("chat2.pv.addedOne", { people: line })
      : t("chat2.pv.added", { people: line });
  };

  switch (sec || "channels") {
    case "ann": {
      const none = !c.announceId;
      return {
        where: none ? t("chat2.row.annWhoLink") : annLabel,
        meta: t("chat2.pv.living"),
        msgs: none
          ? [{ sys: t("chat2.pv.annNone") }]
          : [
              {
                time: inc ? time(inc.createdAt) : "",
                edited: inc ? t("chat2.pv.edited", { time: time(inc.lastActivityAt) }) : undefined,
                label:
                  [inc?.severity, inc?.status?.toUpperCase()].filter(Boolean).join(" · ") ||
                  undefined,
                labelInk: inc ? toneInk(inc.severityTone) : undefined,
                bar: inc ? bar(toneInk(inc.severityTone)) : undefined,
                title,
                body: inc?.update?.message,
                btns: [{ l: t("chat2.pv.openIncident") }],
                foot: t("chat2.pv.annFoot"),
              },
            ],
        note: t("chat2.pv.note.ann"),
      };
    }
    case "page": {
      const target = pr.pageTarget;
      const prio = pr.alert?.priority;
      return {
        where: sl ? t("chat2.pv.dm") : t("chat2.pv.dmTeams"),
        meta: target,
        msgs: [
          {
            time: pr.alert ? time(pr.alert.at) : "",
            label: ack
              ? t("chat2.pv.acked")
              : prio
                ? t("chat2.pv.paged", { prio })
                : t("chat2.pv.pagedNoPrio"),
            labelInk: ack ? "var(--ok)" : "var(--dang)",
            bar: bar(ack ? "var(--ok)" : "var(--dang)"),
            title: pr.alert?.title ?? title,
            body: ack
              ? t("chat2.pv.ackBody", { name: target, time: t.fmt.time(new Date(), t.timeZone) })
              : pr.pathName
                ? t("chat2.pv.pageBody", { path: pr.pathName })
                : t("chat2.pv.pageBodyNoPath"),
            btns: ack
              ? [{ l: t("chat2.pv.open") }]
              : [
                  { l: t("chat2.pv.ack"), tone: "ok", onClick: () => setAck(true) },
                  { l: t("chat2.pv.open") },
                ],
            foot: ack ? t("chat2.pv.ackedFoot") : t("chat2.pv.ackFoot"),
          },
        ],
        note: t("chat2.pv.note.page"),
      };
    }
    case "alerts": {
      const al = pr.alert;
      const rule = data.providers.slack.rules[0];
      const label = al
        ? al.priority
          ? t("chat2.pv.alertLabel", { prio: al.priority, source: al.source.toUpperCase() })
          : t("chat2.pv.alertLabelNoPrio", { source: al.source.toUpperCase() })
        : undefined;
      const msgs: PreviewMsg[] = al
        ? [
            {
              time: time(al.at),
              label,
              labelInk: "var(--wait)",
              bar: bar("var(--wait)"),
              title: al.title,
              fields: al.fields.map(([k, v]) => [k, v] as [string, string]),
              btns: [
                { l: t("chat2.pv.openAlert") },
                { l: t("chat2.pv.toSource") },
                { l: t("chat2.pv.openInc") },
              ],
            },
          ]
        : [];
      if (al?.resolvedAt)
        msgs.push({
          time: time(al.resolvedAt),
          label: t("chat2.pv.resolved"),
          labelInk: "var(--ok)",
          title: al.title,
          body: t("chat2.pv.resolvedBody"),
          foot: t("chat2.pv.resolvedFoot"),
        });
      return {
        where: rule && sl ? rule.channel : sl ? "#alerts" : "Alerts",
        meta: rule ? rule.name : t("chat2.pv.ruleMeta"),
        msgs,
        note: t("chat2.pv.note.alerts"),
      };
    }
    case "atlas": {
      const a = pr.atlas;
      const msgs: PreviewMsg[] = [];
      if (a) {
        msgs.push({
          time: time(a.at),
          label: t("chat2.pv.atlasLabel", { level: a.level }),
          labelInk: "var(--viol)",
          bar: bar("var(--viol)"),
          title: a.title,
          body: a.detail ?? undefined,
          btns: [
            ...(a.reversible ? [{ l: t("chat2.pv.undo") }] : []),
            { l: t("chat2.pv.stopAtlas"), tone: "dang" as const },
            { l: t("chat2.pv.open") },
          ],
          foot: t(a.reversible ? "chat2.pv.atlasFoot" : "chat2.pv.atlasFootOnce", {
            cost: t.fmt.amount(a.costEur),
          }),
        });
        if (c.postRca && a.rca)
          msgs.push({
            time: time(a.rca.at),
            edited: t("chat2.pv.updated", { time: time(a.rca.at) }),
            label: t("chat2.pv.rcaLabel"),
            labelInk: "var(--viol)",
            bar: bar("var(--viol)"),
            title: a.rca.title,
            fields: [
              [
                t("chat2.pv.f.confidence"),
                a.rca.confidence ?? "—",
                a.rca.confidence === "strong" ? "var(--ok)" : undefined,
              ],
              [
                t("chat2.pv.f.challenger"),
                a.rca.challenged ? t("chat2.pv.challenged") : t("chat2.pv.noObjection"),
              ],
              [t("chat2.pv.f.findings"), t("chat2.pv.findingsCited", { count: a.rca.findings })],
            ],
            btns: [{ l: t("chat2.pv.openAnalysis") }, { l: t("chat2.pv.reassess") }],
            foot: t("chat2.pv.rcaFoot"),
          });
        if (c.atlasDrafts && inc?.update)
          msgs.push({
            time: time(a.at),
            label: t("chat2.pv.draftLabel"),
            labelInk: "var(--viol)",
            title: inc.update.message,
            btns: [{ l: t("chat2.pv.publish"), tone: "brand" }, { l: t("chat2.pv.edit") }],
            foot: t("chat2.pv.draftFoot"),
          });
      } else msgs.push({ sys: t("chat2.pv.noAtlas") });
      return {
        where: a ? `${sl ? "#" : ""}${c.prefix}${a.reference.replace(/^INC-/, "")}` : chan,
        meta: a ? t("chat2.pv.atlasMeta", { service: a.service ?? "—", level: a.level }) : "Atlas",
        msgs,
        note: t("chat2.pv.note.atlas"),
      };
    }
    case "cmd": {
      const me = data.meName;
      const msgs: PreviewMsg[] = [
        {
          who: me,
          app: false,
          av: initials(me),
          avBg: "var(--wait-t)",
          avInk: "var(--wait)",
          time: t.fmt.time(new Date(), t.timeZone),
          text: sl ? "/incident update" : "@Open Incident update",
          mono: true,
        },
        {
          time: t.fmt.time(new Date(), t.timeZone),
          label: sl ? t("chat2.pv.modalSlack") : t("chat2.pv.modalTeams"),
          title: t("chat2.pv.shareUpdate", { ref }),
          fields: [
            [t("chat2.pv.f.status"), `${inc?.status ?? "—"} ▾`],
            [t("chat2.pv.f.severity"), t("chat2.pv.unchanged")],
          ],
          body: inc?.update ? t("chat2.pv.message", { message: inc.update.message }) : undefined,
          btns: [{ l: t("chat2.pv.publish"), tone: "brand" }, { l: t("chat2.cancel") }],
        },
      ];
      if (pr.lastPin)
        msgs.push({
          sys: t("chat2.pv.reacted", {
            name: pr.lastPin.by,
            pin: sl ? ":pushpin:" : t("chat2.cmd.pinTeams"),
          }),
        });
      return { where: chan, meta: t("chat2.pv.cmdMeta"), msgs, note: t("chat2.pv.note.cmd") };
    }
    case "people":
      return {
        where: sl ? t("chat2.pv.dm") : t("chat2.pv.dmTeams"),
        meta: pr.unlinkedName ?? "",
        msgs: [
          {
            time: t.fmt.time(new Date(), t.timeZone),
            label: t("chat2.pv.oneTime"),
            title: t("chat2.pv.whoAreYou"),
            body: t("chat2.pv.whoBody", { name: N }),
            foot: t("chat2.pv.whoFoot"),
          },
        ],
        note: t("chat2.pv.note.people"),
      };
    case "health":
      return {
        where: c.announceId ? annLabel : data.meName,
        meta: t("chat2.pv.testMeta"),
        msgs: [
          {
            time: t("chat2.pv.now"),
            label: t("chat2.pv.testLabel"),
            title: t("chat2.pv.testTitle", { name: N }),
            body: t("chat2.pv.testBody"),
            foot: t("chat2.pv.testFoot"),
          },
        ],
        note: t("chat2.pv.note.health"),
      };
    default: {
      // Incident channels.
      if (c.mode !== "auto")
        return {
          where: chan,
          meta: team,
          msgs: [
            { sys: t("chat2.pv.noChannel") },
            {
              time: inc ? time(inc.createdAt) : "",
              label: t("chat2.pv.fromPage"),
              title: t("chat2.pv.createFor", { ref }),
              body: t("chat2.pv.createBody"),
              btns: [{ l: t("chat2.pv.createBtn"), tone: "brand", onClick: () => setMode("auto") }],
            },
          ],
          note: t("chat2.pv.note.channels"),
        };
      const msgs: PreviewMsg[] = [
        { sys: t("chat2.pv.created", { time: inc ? time(inc.createdAt) : t("chat2.pv.now") }) },
        {
          time: inc ? time(inc.createdAt) : "",
          pinned: true,
          edited: inc ? t("chat2.pv.edited", { time: time(inc.lastActivityAt) }) : undefined,
          label: t("chat2.pv.incident"),
          labelInk: "var(--dang)",
          bar: bar("var(--dang)"),
          title,
          fields: [
            [t("chat2.pv.f.status"), inc?.status ?? "—", inc ? toneInk(inc.statusTone) : undefined],
            [
              t("chat2.pv.f.severity"),
              inc?.severity ?? "—",
              inc ? toneInk(inc.severityTone) : undefined,
            ],
            [t("chat2.pv.f.lead"), inc?.lead ?? "—"],
            [t("chat2.pv.f.service"), inc?.service ?? "—"],
          ],
          btns: [
            { l: t("chat2.pv.openIn") },
            ...(inc?.bridge ? [{ l: t("chat2.pv.warRoom"), tone: "brand" as const }] : []),
            ...(sl ? [] : [{ l: t("chat2.pv.escalate") }]),
          ],
        },
        {
          sys: people(
            c.autoInvite ? (inc?.people ?? []) : [],
            c.inviteOnCall ? (inc?.onCall ?? []) : [],
          ),
        },
      ];
      if (inc?.update) {
        msgs.push({
          who: inc.update.by,
          app: false,
          av: initials(inc.update.by),
          avBg: "var(--ok-t)",
          avInk: "var(--ok)",
          time: time(inc.update.at),
          text: sl ? "/incident update" : "@Open Incident update",
          mono: true,
        });
        msgs.push({
          time: time(inc.update.at),
          label: inc.update.status
            ? t("chat2.pv.updateLabel", { status: inc.update.status.toUpperCase() })
            : undefined,
          labelInk: "var(--ok)",
          title: inc.update.message,
          foot: t("chat2.pv.updateFoot", { name: inc.update.by }),
        });
      }
      return { where: chan, meta: team, msgs, note: t("chat2.pv.note.channels") };
    }
  }
}
