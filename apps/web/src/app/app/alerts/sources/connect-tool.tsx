"use client";

import { useActionState, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useT } from "@/i18n/client";
import { SOURCE_KINDS } from "@/lib/alert-sources";
import { IntegrationIcon } from "../../settings/integrations/icons";
import { createSource } from "../../settings/alert-sources/actions";
import { chipStyle } from "./chip";
import { SecretDialog } from "./secret-dialog";
import type { IncidentChoice } from "./choices";

type Named = { id: string; name: string };
type PageKind = "owner" | "me" | "team" | "schedule" | "nobody";

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

/**
 * Connecting a tool, in two steps: which tool, then its name and its three
 * choices. The secret comes back once, inside the URL the tool is given, and
 * the dialog stays open until the person says they have pasted it.
 */
export function ConnectTool({
  initialOpen = false,
  initialKind = null,
  teams,
  schedules,
  urgentFrom,
}: {
  initialOpen?: boolean;
  initialKind?: string | null;
  teams: Named[];
  schedules: Named[];
  urgentFrom: string | null;
}) {
  const t = useT();
  const router = useRouter();
  const known = SOURCE_KINDS.find((k) => k.kind === initialKind) ?? null;
  const [open, setOpen] = useState(initialOpen);
  const [kind, setKind] = useState<string | null>(known?.kind ?? null);
  const [name, setName] = useState(known?.label ?? "");
  const [page, setPage] = useState<PageKind>("owner");
  const [teamId, setTeamId] = useState(teams[0]?.id ?? "");
  const [scheduleId, setScheduleId] = useState(schedules[0]?.id ?? "");
  const [incident, setIncident] = useState<IncidentChoice>("urgent");
  const [autoResolve, setAutoResolve] = useState(true);
  const [state, action, pending] = useActionState(createSource, {});
  const chosen = SOURCE_KINDS.find((k) => k.kind === kind) ?? null;
  const done = Boolean(state.secret && state.endpoint && state.id);

  // The page behind the dialog is a list of sources: the new one belongs on it.
  useEffect(() => {
    if (done) router.refresh();
  }, [done, router]);

  const close = () => {
    setOpen(false);
    setKind(null);
  };

  type PageOption = { id: PageKind; label: string; select?: "team" | "schedule" };
  const pageOptions: PageOption[] = [
    { id: "owner", label: t("alt2.choice.page.owner") },
    { id: "me", label: t("alt2.choice.page.me") },
  ];
  if (teams.length) pageOptions.push({ id: "team", label: "", select: "team" });
  if (schedules.length) pageOptions.push({ id: "schedule", label: "", select: "schedule" });
  pageOptions.push({ id: "nobody", label: t("alt2.choice.page.nobody") });
  const incidentOptions: Array<{ id: IncidentChoice; label: string }> = [
    { id: "triage", label: t("alt2.choice.incident.triage") },
    {
      id: "urgent",
      label: urgentFrom
        ? t("alt2.choice.incident.urgentFrom", { priority: urgentFrom })
        : t("alt2.choice.incident.urgent"),
    },
    { id: "never", label: t("alt2.choice.incident.never") },
  ];

  return (
    <>
      <button
        type="button"
        data-testid="source-open"
        onClick={() => setOpen(true)}
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

      {open && !done && (
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
            className="oi-rise-fast"
            data-testid="source-form"
            style={{
              width: 600,
              maxWidth: "calc(100vw - 32px)",
              background: "var(--panel)",
              borderRadius: "var(--radius-modal)",
              boxShadow: "var(--shadow-modal)",
              overflow: "hidden",
              textAlign: "left",
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
                  ? t("alt2.connect.titleStep2", { tool: chosen.label })
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
                  // Equal rows. Without it each row is as tall as its own
                  // tallest tile, so "Prometheus / Alertmanager" on two lines
                  // made the first row taller than the second and the grid
                  // read as broken rather than as two rows of the same thing.
                  gridAutoRows: "1fr",
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
                      setName(k.label);
                    }}
                    className="oi-hover-edge-fill"
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      alignItems: "center",
                      gap: 7,
                      padding: "14px 8px 12px",
                      border: "1px solid var(--line)",
                      borderRadius: 12,
                      background: "var(--panel)",
                      cursor: "pointer",
                      color: "inherit",
                    }}
                  >
                    {/* Bigger than a row's mark: a logo is what the reader
                        is scanning for here, and these are dense drawings. */}
                    <span
                      style={{
                        width: 30,
                        height: 30,
                        display: "grid",
                        placeItems: "center",
                        color: "var(--ink)",
                      }}
                    >
                      <IntegrationIcon id={k.icon} size={26} />
                    </span>
                    <span style={{ fontSize: 12.5, fontWeight: 600, textAlign: "center" }}>
                      {k.label}
                    </span>
                    {/* Pinned to the foot, so every hint sits on the same line
                        whether the name above it took one or two. */}
                    <span
                      style={{
                        marginTop: "auto",
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
              </div>
            ) : (
              <form action={action}>
                <input type="hidden" name="kind" value={chosen.kind} />
                <input type="hidden" name="page" value={page} />
                <input type="hidden" name="teamId" value={page === "team" ? teamId : ""} />
                <input
                  type="hidden"
                  name="scheduleId"
                  value={page === "schedule" ? scheduleId : ""}
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

                  <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
                    <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
                      <span style={{ fontSize: 13, fontWeight: 600 }}>
                        {t("alt2.choice.pageTitle")}
                      </span>
                      <span style={{ fontSize: 11.5, color: "var(--ink-3)" }}>
                        {t("alt2.choice.pageNote")}
                      </span>
                    </div>
                    <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                      {pageOptions.map((o) =>
                        o.select === "team" ? (
                          <select
                            key="team"
                            aria-label={t("alt2.choice.page.teamLabel")}
                            value={teamId}
                            onClick={() => setPage("team")}
                            onChange={(e) => {
                              setPage("team");
                              setTeamId(e.target.value);
                            }}
                            style={{ ...chipStyle(page === "team"), appearance: "auto" }}
                          >
                            {teams.map((x) => (
                              <option key={x.id} value={x.id}>
                                {x.name}
                              </option>
                            ))}
                          </select>
                        ) : o.select === "schedule" ? (
                          <select
                            key="schedule"
                            aria-label={t("alt2.choice.page.scheduleLabel")}
                            value={scheduleId}
                            onClick={() => setPage("schedule")}
                            onChange={(e) => {
                              setPage("schedule");
                              setScheduleId(e.target.value);
                            }}
                            style={{ ...chipStyle(page === "schedule"), appearance: "auto" }}
                          >
                            {schedules.map((x) => (
                              <option key={x.id} value={x.id}>
                                {x.name}
                              </option>
                            ))}
                          </select>
                        ) : (
                          <button
                            key={o.id}
                            type="button"
                            onClick={() => setPage(o.id)}
                            style={chipStyle(page === o.id)}
                          >
                            {o.label}
                          </button>
                        ),
                      )}
                    </div>
                  </div>

                  <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
                    <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
                      <span style={{ fontSize: 13, fontWeight: 600 }}>
                        {t("alt2.choice.incidentTitle")}
                      </span>
                      <span style={{ fontSize: 11.5, color: "var(--ink-3)" }}>
                        {t("alt2.choice.incidentNote")}
                      </span>
                    </div>
                    <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                      {incidentOptions.map((o) => (
                        <button
                          key={o.id}
                          type="button"
                          onClick={() => setIncident(o.id)}
                          style={chipStyle(incident === o.id)}
                        >
                          {o.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
                    <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
                      <span style={{ fontSize: 13, fontWeight: 600 }}>
                        {t("alt2.choice.autoTitle")}
                      </span>
                      <span style={{ fontSize: 11.5, color: "var(--ink-3)" }}>
                        {t("alt2.choice.autoNote")}
                      </span>
                    </div>
                    <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                      {[true, false].map((v) => (
                        <button
                          key={String(v)}
                          type="button"
                          onClick={() => setAutoResolve(v)}
                          style={chipStyle(autoResolve === v)}
                        >
                          {v ? t("common.on") : t("common.off")}
                        </button>
                      ))}
                    </div>
                  </div>

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
                    {t("alt2.connect.note")}
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
          endpoint={state.endpoint!}
          secret={state.secret!}
          doneLabel={t("alt2.secret.added", { name })}
          onDone={() => router.push(`/app/alerts/sources/${state.id}`)}
        />
      )}
    </>
  );
}
