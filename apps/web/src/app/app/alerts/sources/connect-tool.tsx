"use client";

import Link from "next/link";
import { useActionState, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useT } from "@/i18n/client";
import { SOURCE_KINDS } from "@/lib/alert-sources";
import { SourceGlyph } from "@/components/alerting/source-glyph";
import { createSource } from "../../settings/alert-sources/actions";
import { AutoChips, IncidentChips, PageChips, type PageKind } from "./choice-rows";
import { pageNote, urgentLevel, type Level } from "./describe";
import { SecretDialog } from "./secret-dialog";
import type { IncidentChoice } from "./choices";

type Named = { id: string; name: string };

const field: React.CSSProperties = {
  height: 38,
  border: "1px solid var(--line)",
  borderRadius: 10,
  padding: "0 12px",
  fontSize: 14,
  outline: "none",
  background: "var(--panel)",
};
const footBtn: React.CSSProperties = {
  height: 34,
  padding: "0 13px",
  border: "1px solid var(--line)",
  borderRadius: 9,
  background: "var(--panel)",
  display: "flex",
  alignItems: "center",
  fontSize: 12.5,
  cursor: "pointer",
  color: "inherit",
};
const tile: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  gap: 7,
  padding: "14px 8px",
  border: "1px solid var(--line)",
  borderRadius: 12,
  background: "var(--panel)",
  cursor: "pointer",
  color: "inherit",
  textDecoration: "none",
};

/**
 * Connecting a tool, in two steps: which tool, then its name and its three
 * choices. The secret comes back once, inside the URL the tool is given, and
 * the dialog stays open until the person says they have pasted it — watching,
 * meanwhile, for the tool's first alert.
 */
export function ConnectTool(props: {
  initialOpen?: boolean;
  initialKind?: string | null;
  teams: Named[];
  schedules: Named[];
  levels: Level[];
}) {
  const t = useT();
  const [open, setOpen] = useState(props.initialOpen ?? false);
  // A new round for every opening: the form, its answers and the secret of the
  // last source created all start again from nothing.
  const [round, setRound] = useState(0);
  return (
    <>
      <button
        type="button"
        data-testid="source-open"
        onClick={() => {
          setRound((r) => r + 1);
          setOpen(true);
        }}
        className="oi-hover-brand-2"
        style={{
          height: 32,
          padding: "0 13px",
          borderRadius: 9,
          border: 0,
          background: "var(--brand)",
          color: "var(--on-brand)",
          display: "flex",
          alignItems: "center",
          fontSize: 12.5,
          fontWeight: 600,
          cursor: "pointer",
        }}
      >
        {t("alt2.list.connect")}
      </button>
      {open && (
        <ConnectDialog
          key={round}
          {...props}
          initialKind={round === 0 ? props.initialKind : null}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}

function ConnectDialog({
  initialKind = null,
  teams,
  schedules,
  levels,
  onClose,
}: {
  initialKind?: string | null;
  teams: Named[];
  schedules: Named[];
  levels: Level[];
  onClose: () => void;
}) {
  const t = useT();
  const router = useRouter();
  const known = SOURCE_KINDS.find((k) => k.kind === initialKind) ?? null;
  const [kind, setKind] = useState<string | null>(known?.kind ?? null);
  const [name, setName] = useState(known?.short ?? "");
  const [page, setPage] = useState<PageKind>("owner");
  const [teamId, setTeamId] = useState<string | null>(null);
  const [scheduleId, setScheduleId] = useState<string | null>(null);
  // "From P2" by default — the severity the workspace already calls urgent.
  const urgent = urgentLevel(levels);
  const [incident, setIncident] = useState<string>(urgent ? `from:${urgent.rank}` : "urgent");
  const [autoResolve, setAutoResolve] = useState(true);
  const [state, action, pending] = useActionState(createSource, {});
  const chosen = SOURCE_KINDS.find((k) => k.kind === kind) ?? null;
  const done = Boolean(state.secret && state.endpoint && state.id);

  // The page behind the dialog is a list of sources: the new one belongs on it.
  useEffect(() => {
    if (done) router.refresh();
  }, [done, router]);

  const close = onClose;

  const incidentState: { choice: IncidentChoice; fromRank: number | null } =
    incident === "triage" || incident === "never"
      ? { choice: incident, fromRank: null }
      : {
          choice: "urgent",
          fromRank: incident.startsWith("from:") ? Number(incident.slice(5)) : null,
        };

  const choiceBlock = (title: string, note: string, chips: React.ReactNode) => (
    <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
        <span style={{ fontSize: 13, fontWeight: 600 }}>{title}</span>
        <span style={{ fontSize: 11.5, color: "var(--ink-3)" }}>{note}</span>
      </div>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>{chips}</div>
    </div>
  );

  return (
    <>
      {!done && (
        <div
          onClick={close}
          style={{
            position: "fixed",
            inset: 0,
            background: "var(--scrim)",
            display: "flex",
            alignItems: "flex-start",
            justifyContent: "center",
            paddingTop: "8vh",
            zIndex: 50,
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            data-testid="source-form"
            style={{
              width: 600,
              maxWidth: "calc(100vw - 32px)",
              background: "var(--panel)",
              borderRadius: "var(--radius-modal)",
              boxShadow: "var(--shadow-modal)",
              overflow: "hidden",
              textAlign: "left",
              animation: "oi-rise .16s ease backwards",
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                padding: "16px 22px",
                borderBottom: "1px solid var(--line)",
              }}
            >
              <span style={{ fontFamily: "var(--title)", fontSize: 17, fontWeight: 600 }}>
                {chosen
                  ? t("alt2.connect.titleStep2", { tool: chosen.short })
                  : t("alt2.connect.titleStep1")}
              </span>
              <span style={{ flex: 1 }} />
              <span style={{ fontSize: 11.5, color: "var(--ink-3)" }}>
                {t("alt2.connect.step", { step: chosen ? 2 : 1 })}
              </span>
              <button
                type="button"
                onClick={close}
                aria-label={t("common.close")}
                className="oi-hover"
                style={{
                  marginLeft: 14,
                  width: 28,
                  height: 28,
                  borderRadius: 8,
                  border: 0,
                  background: "none",
                  display: "grid",
                  placeItems: "center",
                  color: "var(--ink-3)",
                  cursor: "pointer",
                }}
              >
                ✕
              </button>
            </div>

            {!chosen ? (
              <div
                data-testid="source-kinds"
                style={{
                  padding: "18px 22px",
                  display: "grid",
                  gridTemplateColumns: "repeat(4,1fr)",
                  gap: 8,
                }}
              >
                {SOURCE_KINDS.map((k) => (
                  <button
                    key={k.kind}
                    type="button"
                    data-testid={`source-kind-${k.kind}`}
                    onClick={() => {
                      setKind(k.kind);
                      setName(k.short);
                    }}
                    className="oi-hover-edge-fill"
                    style={tile}
                  >
                    <span
                      style={{
                        width: 26,
                        height: 26,
                        display: "grid",
                        placeItems: "center",
                        color: "var(--ink)",
                      }}
                    >
                      <SourceGlyph kind={k.kind} />
                    </span>
                    <span style={{ fontSize: 12.5, fontWeight: 600 }}>{k.short}</span>
                    <span
                      style={{
                        fontSize: 10.5,
                        color: "var(--ink-3)",
                        textAlign: "center",
                        lineHeight: 1.35,
                      }}
                    >
                      {t(`alt2.tool.${k.kind}`)}
                    </span>
                  </button>
                ))}
                {/* Coming from another tool is a migration, not a source. */}
                <Link
                  href="/app/settings/migrate"
                  data-testid="source-kind-migrate"
                  className="oi-hover-edge-fill"
                  style={tile}
                >
                  <span
                    style={{
                      width: 26,
                      height: 26,
                      display: "grid",
                      placeItems: "center",
                      color: "var(--ink)",
                    }}
                  >
                    <SourceGlyph kind="migrate" />
                  </span>
                  <span style={{ fontSize: 12.5, fontWeight: 600 }}>{t("alst.tool.migrate")}</span>
                  <span
                    style={{
                      fontSize: 10.5,
                      color: "var(--ink-3)",
                      textAlign: "center",
                      lineHeight: 1.35,
                    }}
                  >
                    {t("alst.tool.migrateHint")}
                  </span>
                </Link>
              </div>
            ) : (
              <form action={action}>
                <input type="hidden" name="kind" value={chosen.kind} />
                <input type="hidden" name="page" value={page} />
                <input type="hidden" name="teamId" value={page === "team" ? (teamId ?? "") : ""} />
                <input
                  type="hidden"
                  name="scheduleId"
                  value={page === "schedule" ? (scheduleId ?? "") : ""}
                />
                <input type="hidden" name="incident" value={incident} />
                <input type="hidden" name="autoResolve" value={autoResolve ? "on" : "off"} />
                <div
                  style={{
                    padding: "18px 22px",
                    display: "flex",
                    flexDirection: "column",
                    gap: 16,
                  }}
                >
                  <label style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                    <span
                      style={{
                        fontSize: 11,
                        fontWeight: 600,
                        letterSpacing: ".08em",
                        textTransform: "uppercase",
                        color: "var(--ink-3)",
                      }}
                    >
                      {t("alt2.connect.name")}
                    </span>
                    <input
                      name="name"
                      required
                      minLength={2}
                      maxLength={80}
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      className="oi-field"
                      style={field}
                    />
                  </label>

                  {choiceBlock(
                    t("alt2.choice.pageTitle"),
                    pageNote(t, levels),
                    <PageChips
                      kind={page}
                      teamId={teamId}
                      scheduleId={scheduleId}
                      teams={teams}
                      schedules={schedules}
                      onPick={(k, extra) => {
                        setPage(k);
                        if (extra?.teamId) setTeamId(extra.teamId);
                        if (extra?.scheduleId) setScheduleId(extra.scheduleId);
                      }}
                    />,
                  )}
                  {choiceBlock(
                    t("alt2.choice.incidentTitle"),
                    t("alt2.choice.incidentNote"),
                    <IncidentChips
                      incident={incidentState.choice}
                      fromRank={incidentState.fromRank}
                      levels={levels}
                      onPick={setIncident}
                    />,
                  )}
                  {choiceBlock(
                    t("alt2.choice.autoTitle"),
                    t("alt2.choice.autoNote"),
                    <AutoChips on={autoResolve} onPick={setAutoResolve} />,
                  )}

                  <div
                    style={{
                      fontSize: 12.5,
                      color: "var(--ink-2)",
                      background: "var(--sunk)",
                      borderRadius: 10,
                      padding: "10px 13px",
                      lineHeight: 1.5,
                    }}
                  >
                    {(() => {
                      const [before, after] = t.parts("alst.connect.note", "advanced");
                      return (
                        <>
                          {before}
                          <strong>{t("alt2.source.advanced")}</strong>
                          {after}
                        </>
                      );
                    })()}
                  </div>
                  {state.error && (
                    <p role="alert" style={{ margin: 0, fontSize: 12.5, color: "var(--dang)" }}>
                      {state.error === "duplicate"
                        ? t("alt2.connect.errorDuplicate")
                        : t("alt2.connect.errorInvalid")}
                    </p>
                  )}
                </div>
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    padding: "14px 22px",
                    borderTop: "1px solid var(--line)",
                    background: "var(--sunk)",
                  }}
                >
                  <button
                    type="button"
                    onClick={() => setKind(null)}
                    style={{
                      background: "none",
                      border: 0,
                      padding: 0,
                      fontSize: 12.5,
                      color: "var(--ink-3)",
                      cursor: "pointer",
                    }}
                  >
                    {t("alt2.connect.another")}
                  </button>
                  <span style={{ flex: 1 }} />
                  <button type="button" onClick={close} style={footBtn}>
                    {t("common.cancel")}
                  </button>
                  <button
                    type="submit"
                    disabled={pending}
                    data-testid="source-create"
                    className="oi-hover-brand-2"
                    style={{
                      ...footBtn,
                      padding: "0 16px",
                      border: 0,
                      background: "var(--brand)",
                      color: "var(--on-brand)",
                      fontWeight: 600,
                    }}
                  >
                    {t("alt2.connect.create")}
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}

      {done && (
        <SecretDialog
          name={name}
          kind={chosen?.kind ?? "http"}
          endpoint={state.endpoint!}
          secret={state.secret!}
          watchSourceId={state.id!}
          doneLabel={t("alt2.secret.added", { name })}
          onDone={() => {
            onClose();
            router.push("/app/alerts/sources");
          }}
        />
      )}
    </>
  );
}
