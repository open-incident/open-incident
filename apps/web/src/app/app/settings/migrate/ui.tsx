"use client";

/**
 * The interactive pieces of the migration screen: the key form, the
 * integrations filter, the people selects, the one-click fixes and switches,
 * the copy button, the toast, and the poller that refreshes the page while a
 * read or an archive runs in the background.
 */
import {
  useActionState,
  useEffect,
  useState,
  useTransition,
  type CSSProperties,
  type ReactNode,
} from "react";
import { useRouter } from "next/navigation";
import { useT } from "@/i18n/client";
import {
  checkConnection,
  choosePerson,
  startInventory,
  toggleRepoint,
  toggleTranslation,
  type ActionResult,
  type CheckState,
} from "./actions";

/* ---------- Toast ---------- */

const EVENT = "oi-migrate-toast";
export function toast(message: string) {
  window.dispatchEvent(new CustomEvent(EVENT, { detail: message }));
}

export function Toaster({ initial }: { initial?: string | null }) {
  const [message, setMessage] = useState<string | null>(initial ?? null);
  useEffect(() => {
    const on = (e: Event) => setMessage((e as CustomEvent<string>).detail);
    window.addEventListener(EVENT, on);
    return () => window.removeEventListener(EVENT, on);
  }, []);
  useEffect(() => {
    if (!message) return;
    const id = setTimeout(() => setMessage(null), 2600);
    return () => clearTimeout(id);
  }, [message]);
  if (!message) return null;
  return (
    <div
      role="status"
      data-testid="migrate-toast"
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
      {message}
    </div>
  );
}

/** Refreshes the server-rendered page while background work runs. */
export function Poller({ every = 1500 }: { every?: number }) {
  const router = useRouter();
  useEffect(() => {
    const id = setInterval(() => router.refresh(), every);
    return () => clearInterval(id);
  }, [router, every]);
  return null;
}

/* ---------- A button that runs an action ---------- */

export function ActionButton({
  action,
  children,
  style,
  className,
  testId,
  disabled,
  title,
}: {
  action: () => Promise<ActionResult | void>;
  children: ReactNode;
  style: CSSProperties;
  className?: string;
  testId?: string;
  disabled?: boolean;
  title?: string;
}) {
  const [pending, start] = useTransition();
  return (
    <button
      type="button"
      data-testid={testId}
      title={title}
      className={className}
      disabled={disabled || pending}
      aria-disabled={disabled || pending}
      onClick={() =>
        start(async () => {
          const r = await action();
          if (r && r.message) toast(r.message);
        })
      }
      style={{
        fontFamily: "inherit",
        ...style,
        opacity: pending ? 0.7 : (style.opacity ?? 1),
        cursor: disabled ? "default" : pending ? "progress" : "pointer",
      }}
    >
      {children}
    </button>
  );
}

/* ---------- 1 · Connect ---------- */

const REGIONS = [
  { id: "eu", label: "EU", host: "api.eu.opsgenie.com" },
  { id: "us", label: "US", host: "api.opsgenie.com" },
] as const;

export function ConnectCard({
  region: initialRegion,
  saved,
  stored,
}: {
  region: "eu" | "us";
  saved: string | null;
  /** The checks as last stored with a saved key. */
  stored: CheckState | null;
}) {
  const t = useT();
  const [region, setRegion] = useState<"eu" | "us">(initialRegion);
  const [key, setKey] = useState("");
  const [state, action, pending] = useActionState(checkConnection, stored);
  const [fresh, setFresh] = useState(Boolean(stored));
  // A key that passed is saved, encrypted: the field lets go of it.
  useEffect(() => {
    if (state?.ok) setKey("");
  }, [state]);
  const shown = fresh ? state : null;
  const host = REGIONS.find((r) => r.id === region)!.host;
  const ok = Boolean(shown?.ok);
  const hint = !shown
    ? t("migrate.hint.idle")
    : shown.hint === "ok"
      ? t("migrate.hint.ok")
      : shown.hint === "config"
        ? t("migrate.hint.config")
        : shown.hint === "team"
          ? t("migrate.hint.team")
          : shown.hint === "unauthorized"
            ? t("migrate.hint.unauthorized", { region: region.toUpperCase() })
            : shown.hint === "unreachable"
              ? t("migrate.hint.unreachable", { host })
              : shown.hint === "empty"
                ? t("migrate.hint.empty")
                : t("migrate.hint.idle");
  const label = (row: CheckState["rows"][number]) =>
    row.key === "reach"
      ? t("migrate.check.reach", { host })
      : row.key === "read"
        ? t("migrate.check.read")
        : row.key === "config"
          ? t("migrate.check.config")
          : t("migrate.check.account");
  const detail = (row: CheckState["rows"][number]) =>
    row.key === "account" && row.ok
      ? t("migrate.check.accountOk", { name: row.name ?? row.detail, count: row.teams ?? 0 })
      : row.key === "account" && row.teamKey
        ? t("migrate.check.teamKey", { count: row.teams ?? 0 })
        : row.detail;
  const [read, config] = [t("migrate.connect.read"), t("migrate.connect.config")];
  // The two rights are bold inside the sentence: split it around their slots.
  const help = t("migrate.connect.help", { read: "{read}", config: "{config}" }).split(
    /(\{read\}|\{config\})/,
  );
  return (
    <form
      action={(fd) => {
        setFresh(true);
        return action(fd);
      }}
      data-testid="migrate-connect"
      style={{
        background: "var(--panel)",
        border: "1px solid var(--line)",
        borderRadius: "var(--radius-card)",
        boxShadow: "var(--shadow-card)",
        padding: "18px 20px",
        display: "flex",
        flexDirection: "column",
        gap: 14,
        animation: "ohd-rise .14s ease backwards",
      }}
    >
      <div>
        <div style={{ fontSize: 16, fontWeight: 600 }}>{t("migrate.connect.title")}</div>
        <div style={{ fontSize: 12.5, color: "var(--ink-3)", marginTop: 2 }}>
          {help.map((p, i) =>
            p === "{read}" ? (
              <strong key={i}>{read}</strong>
            ) : p === "{config}" ? (
              <strong key={i}>{config}</strong>
            ) : (
              p
            ),
          )}
        </div>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <span style={{ fontSize: 12, fontWeight: 600 }}>{t("migrate.connect.region")}</span>
        <div
          role="radiogroup"
          style={{
            display: "flex",
            gap: 2,
            background: "var(--sunk)",
            borderRadius: 9,
            padding: 3,
            alignSelf: "flex-start",
          }}
        >
          {REGIONS.map((r) => {
            const on = region === r.id;
            return (
              <button
                key={r.id}
                type="button"
                role="radio"
                aria-checked={on}
                data-testid={`migrate-region-${r.id}`}
                onClick={() => {
                  setRegion(r.id);
                  setFresh(false);
                }}
                style={{
                  height: 30,
                  padding: "0 12px",
                  borderRadius: 7,
                  border: "none",
                  background: on ? "var(--panel)" : "transparent",
                  boxShadow: on ? "0 1px 2px rgba(13,22,28,.12)" : "none",
                  display: "flex",
                  alignItems: "center",
                  gap: 7,
                  fontSize: 12.5,
                  fontWeight: on ? 600 : 500,
                  cursor: "pointer",
                  whiteSpace: "nowrap",
                  color: "var(--ink)",
                  fontFamily: "inherit",
                }}
              >
                {r.label}
                <span style={{ fontFamily: "var(--mono)", fontSize: 11, color: "var(--ink-3)" }}>
                  {r.host}
                </span>
              </button>
            );
          })}
        </div>
        <input type="hidden" name="region" value={region} />
      </div>
      <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <span style={{ fontSize: 12, fontWeight: 600 }}>{t("migrate.connect.key")}</span>
        <input
          name="key"
          value={key}
          autoComplete="off"
          spellCheck={false}
          data-testid="migrate-key"
          onChange={(e) => {
            setKey(e.target.value);
            setFresh(false);
          }}
          placeholder={
            saved
              ? t("migrate.connect.saved", { hint: saved })
              : "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
          }
          className="oi-field"
          style={{
            height: 38,
            border: "1px solid var(--line)",
            borderRadius: 10,
            padding: "0 12px",
            fontFamily: "var(--mono)",
            fontSize: 13,
            background: "var(--panel)",
            outline: "none",
            color: "var(--ink)",
          }}
        />
        <span style={{ fontSize: 11.5, color: "var(--ink-3)" }}>
          {t("migrate.connect.keyHelp")}
        </span>
      </label>
      {shown && shown.rows.length > 0 && (
        <div
          data-testid="migrate-checks"
          style={{ border: "1px solid var(--line-2)", borderRadius: 11, overflow: "hidden" }}
        >
          {shown.rows.map((row, i) => (
            <div
              key={row.key}
              data-testid={`migrate-check-${row.key}`}
              data-ok={row.ok ? "true" : "false"}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                padding: "9px 12px",
                borderTop: i ? "1px solid var(--line-2)" : "none",
                fontSize: 13,
              }}
            >
              <span
                style={{
                  width: 18,
                  height: 18,
                  borderRadius: "50%",
                  background: row.ok ? "var(--ok-t)" : "var(--dang-t)",
                  color: row.ok ? "var(--ok)" : "var(--dang)",
                  display: "grid",
                  placeItems: "center",
                  fontSize: 10,
                  fontWeight: 800,
                  flex: "none",
                }}
              >
                {row.ok ? "✓" : "!"}
              </span>
              <span style={{ flex: 1 }}>{label(row)}</span>
              <span style={{ fontFamily: "var(--mono)", fontSize: 11.5, color: "var(--ink-3)" }}>
                {detail(row)}
              </span>
            </div>
          ))}
        </div>
      )}
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        {ok ? (
          <button
            type="button"
            data-testid="migrate-start-inventory"
            className="oi-hover-brand-2"
            onClick={() => startInventory()}
            style={primary}
          >
            {t("migrate.connect.start")}
          </button>
        ) : (
          <button
            type="submit"
            data-testid="migrate-check"
            className="oi-hover-brand-2"
            disabled={pending}
            style={{ ...primary, opacity: pending ? 0.7 : 1 }}
          >
            {t("migrate.connect.check")}
          </button>
        )}
        <span data-testid="migrate-connect-hint" style={{ fontSize: 12, color: "var(--ink-3)" }}>
          {hint}
        </span>
      </div>
    </form>
  );
}

const primary: CSSProperties = {
  height: 36,
  padding: "0 16px",
  borderRadius: 10,
  background: "var(--brand)",
  color: "#fff",
  border: "none",
  display: "flex",
  alignItems: "center",
  fontSize: 13,
  fontWeight: 600,
  cursor: "pointer",
  fontFamily: "inherit",
};

/* ---------- 2 · Integrations ---------- */

export type IntegrationLine = {
  key: string;
  glyph: string;
  name: string;
  sub: string;
  status: "live" | "quiet" | "silent";
  statusLabel: string;
  last: string;
  target: string;
};

const STATUS: Record<IntegrationLine["status"], { bg: string; ink: string }> = {
  live: { bg: "var(--ok-t)", ink: "var(--ok)" },
  quiet: { bg: "var(--wait-t)", ink: "var(--wait)" },
  silent: { bg: "var(--dang-t)", ink: "var(--dang)" },
};

export function IntegrationsCard({ rows }: { rows: IntegrationLine[] }) {
  const t = useT();
  const [filter, setFilter] = useState<"all" | "live" | "quiet" | "silent">("all");
  const count = (k: IntegrationLine["status"]) => rows.filter((r) => r.status === k).length;
  const chips = [
    { id: "all" as const, l: t("migrate.int.all"), c: rows.length },
    { id: "live" as const, l: t("migrate.int.live"), c: count("live") },
    { id: "quiet" as const, l: t("migrate.int.quiet"), c: count("quiet") },
    { id: "silent" as const, l: t("migrate.int.dead"), c: count("silent") },
  ];
  const shown = rows.filter((r) => filter === "all" || r.status === filter);
  return (
    <div
      style={{
        background: "var(--panel)",
        border: "1px solid var(--line)",
        borderRadius: "var(--radius-card)",
        boxShadow: "var(--shadow-card)",
        overflow: "hidden",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          padding: "12px 18px",
          flexWrap: "wrap",
        }}
      >
        <span style={{ fontSize: 14, fontWeight: 600 }}>{t("migrate.int.title")}</span>
        <span style={{ fontSize: 12, color: "var(--ink-3)" }}>{t("migrate.int.sub")}</span>
        <span style={{ flex: 1 }} />
        <div style={{ display: "flex", gap: 4 }}>
          {chips.map((f) => {
            const on = filter === f.id;
            return (
              <button
                key={f.id}
                type="button"
                data-testid={`migrate-filter-${f.id}`}
                onClick={() => setFilter(f.id)}
                style={{
                  height: 26,
                  padding: "0 10px",
                  borderRadius: 999,
                  border: `1px solid ${on ? "var(--brand-b)" : "var(--line)"}`,
                  background: on ? "var(--brand-t)" : "var(--panel)",
                  color: on ? "var(--brand)" : "var(--ink-2)",
                  display: "flex",
                  alignItems: "center",
                  gap: 5,
                  fontSize: 11.5,
                  fontWeight: 600,
                  cursor: "pointer",
                  fontFamily: "inherit",
                }}
              >
                {f.l}
                <span style={{ fontFamily: "var(--mono)", fontSize: 10.5, opacity: 0.7 }}>
                  {f.c}
                </span>
              </button>
            );
          })}
        </div>
      </div>
      <div style={{ overflowX: "auto" }}>
        <div style={{ minWidth: 640 }} data-testid="migrate-integrations">
          {shown.length === 0 && (
            <div
              style={{
                padding: "14px 18px",
                borderTop: "1px solid var(--line-2)",
                fontSize: 12.5,
                color: "var(--ink-3)",
              }}
            >
              {t("migrate.int.empty")}
            </div>
          )}
          {shown.map((x) => (
            <div
              key={x.key}
              data-testid="migrate-integration"
              data-status={x.status}
              style={{
                display: "grid",
                gridTemplateColumns: "30px minmax(160px,1.4fr) 110px 120px minmax(120px,1fr)",
                gap: 12,
                alignItems: "center",
                padding: "9px 18px",
                borderTop: "1px solid var(--line-2)",
                fontSize: 12.5,
              }}
            >
              <span
                style={{
                  width: 28,
                  height: 28,
                  borderRadius: 8,
                  background: "var(--topbar-dark)",
                  color: "#fff",
                  display: "grid",
                  placeItems: "center",
                  fontSize: 9.5,
                  fontWeight: 700,
                }}
              >
                {x.glyph}
              </span>
              <div style={{ minWidth: 0 }}>
                <div
                  style={{
                    fontWeight: 600,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {x.name}
                </div>
                <div style={{ fontSize: 11, color: "var(--ink-3)" }}>{x.sub}</div>
              </div>
              <span>
                <span
                  style={{
                    fontSize: 11,
                    fontWeight: 600,
                    borderRadius: 999,
                    padding: "2px 9px",
                    background: STATUS[x.status].bg,
                    color: STATUS[x.status].ink,
                    whiteSpace: "nowrap",
                  }}
                >
                  {x.statusLabel}
                </span>
              </span>
              <span style={{ fontFamily: "var(--mono)", fontSize: 11.5, color: "var(--ink-2)" }}>
                {x.last}
              </span>
              <span style={{ fontSize: 11.5, color: "var(--ink-3)" }}>→ {x.target}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ---------- 3 · People ---------- */

export function PersonSelect({
  id,
  value,
  options,
}: {
  id: string;
  value: string;
  options: Array<{ value: string; label: string }>;
}) {
  const [v, setV] = useState(value);
  const [pending, start] = useTransition();
  useEffect(() => setV(value), [value]);
  return (
    <select
      value={v}
      disabled={pending}
      data-testid="migrate-person-select"
      onChange={(e) => {
        const next = e.target.value;
        setV(next);
        start(async () => {
          const r = await choosePerson(id, next);
          if (r.message) toast(r.message);
        });
      }}
      style={{
        width: "100%",
        height: 30,
        border: "1px solid var(--wait)",
        borderRadius: 8,
        padding: "0 8px",
        fontSize: 12.5,
        background: "var(--panel)",
        outline: "none",
        color: "var(--ink)",
        fontFamily: "inherit",
      }}
    >
      {options.map((o) => (
        <option key={`${o.value}:${o.label}`} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

export function ConfirmButton({ kind, confirmed }: { kind: string; confirmed: boolean }) {
  const t = useT();
  return (
    <ActionButton
      testId={`migrate-confirm-${kind}`}
      action={() => toggleTranslation(kind)}
      style={{
        height: 28,
        padding: "0 11px",
        borderRadius: 8,
        border: `1px solid ${confirmed ? "var(--ok)" : "var(--brand)"}`,
        background: confirmed ? "var(--ok-t)" : "var(--panel)",
        color: confirmed ? "var(--ok)" : "var(--brand)",
        display: "flex",
        alignItems: "center",
        fontSize: 12,
        fontWeight: 600,
        whiteSpace: "nowrap",
        alignSelf: "center",
      }}
    >
      {confirmed ? t("migrate.tr.confirmed") : t("migrate.tr.confirm")}
    </ActionButton>
  );
}

/* ---------- 5 · Shadow ---------- */

export function CopyUrl({ url }: { url: string }) {
  const t = useT();
  const [copied, setCopied] = useState(false);
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        background: "var(--topbar-dark)",
        borderRadius: 10,
        padding: "10px 14px",
      }}
    >
      <code
        data-testid="migrate-hook-url"
        style={{
          flex: 1,
          minWidth: 0,
          fontFamily: "var(--mono)",
          fontSize: 12.5,
          color: "var(--code-blue)",
          overflowX: "auto",
          whiteSpace: "nowrap",
        }}
      >
        {url}
      </code>
      <button
        type="button"
        onClick={async () => {
          await navigator.clipboard?.writeText(url).catch(() => {});
          setCopied(true);
        }}
        style={{
          fontSize: 11.5,
          fontWeight: 600,
          color: "#fff",
          opacity: 0.85,
          cursor: "pointer",
          background: "none",
          border: "none",
          fontFamily: "inherit",
        }}
      >
        {copied ? t("migrate.shadow.copied") : t("migrate.shadow.copy")}
      </button>
    </div>
  );
}

/* ---------- 6 · Switch ---------- */

export function RepointRow({
  team,
  item,
}: {
  team: string;
  item: { key: string; label: string; hint: string; done: boolean };
}) {
  const [done, setDone] = useState(item.done);
  const [, start] = useTransition();
  useEffect(() => setDone(item.done), [item.done]);
  return (
    <button
      type="button"
      data-testid="migrate-repoint"
      aria-pressed={done}
      onClick={() => {
        setDone(!done);
        start(async () => {
          await toggleRepoint(team, item.key);
        });
      }}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        fontSize: 12.5,
        cursor: "pointer",
        padding: "3px 0",
        background: "none",
        border: "none",
        textAlign: "left",
        fontFamily: "inherit",
        color: "inherit",
      }}
    >
      <span
        style={{
          width: 16,
          height: 16,
          borderRadius: 5,
          border: done ? "none" : "1.5px solid var(--line)",
          background: done ? "var(--ok)" : "var(--panel)",
          color: "#fff",
          display: "grid",
          placeItems: "center",
          fontSize: 10,
          fontWeight: 800,
          flex: "none",
        }}
      >
        {done ? "✓" : ""}
      </span>
      <span
        style={{
          flex: 1,
          textDecoration: done ? "line-through" : "none",
          color: done ? "var(--ink-3)" : "var(--ink)",
        }}
      >
        {item.label}
      </span>
      <span style={{ fontFamily: "var(--mono)", fontSize: 11, color: "var(--ink-3)" }}>
        {item.hint}
      </span>
    </button>
  );
}
