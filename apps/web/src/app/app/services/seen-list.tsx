"use client";

/**
 * "Seen in traffic" — each service the signals named and nobody claimed, one
 * click from an owner.
 *
 * The row stays where it was once the click is made, turned into the receipt
 * ("payments-worker → Payments. Its policy now pages for this service.") with
 * an Undo beside it: the list the reader was working through must not reflow
 * under the pointer, and a misclick has to be one more click to take back.
 * The receipt is kept here, in the page, while the server has already moved
 * the service to "Confirmed" — the counts in the tabs say so at once.
 */

import { useRef, useState, useTransition } from "react";
import { useT } from "@/i18n/client";
import { assignOwner, clearOwner } from "./actions";
import { MENU, MENU_ITEM, useOutsideClose } from "./dialog";

export type SeenRow = {
  id: string;
  key: string;
  name: string | null;
  /** "Datadog ×12 · Grafana ×3 · 1 monitor" — already worded. */
  from: string;
  /** The suggestion, already worded; null when there is no evidence for one. */
  hint: string | null;
  suggestedTeamId: string | null;
};

type Team = { id: string; name: string; policyName: string | null };

export function SeenList({
  rows,
  teams,
  myTeamIds,
  mayAssign,
}: {
  rows: SeenRow[];
  teams: Team[];
  myTeamIds: string[];
  mayAssign: boolean;
}) {
  const t = useT();
  const [, start] = useTransition();
  // A row the server no longer lists, because it was just assigned, is still
  // drawn — as its receipt — from the copy kept here.
  const [done, setDone] = useState<Record<string, { row: SeenRow; team: Team }>>({});
  const [busy, setBusy] = useState<string | null>(null);

  const assign = (row: SeenRow, team: Team) => {
    setBusy(row.id);
    const fd = new FormData();
    fd.set("serviceId", row.id);
    fd.set("teamId", team.id);
    start(async () => {
      await assignOwner(fd);
      setDone((d) => ({ ...d, [row.id]: { row, team } }));
      setBusy(null);
    });
  };
  const undo = (row: SeenRow) => {
    setBusy(row.id);
    const fd = new FormData();
    fd.set("serviceId", row.id);
    start(async () => {
      await clearOwner(fd);
      setDone((d) => {
        const next = { ...d };
        delete next[row.id];
        return next;
      });
      setBusy(null);
    });
  };

  const shown = [...rows.filter((r) => !done[r.id]), ...Object.values(done).map((d) => d.row)].sort(
    (a, b) => a.key.localeCompare(b.key),
  );
  const allDone = rows.filter((r) => !done[r.id]).length === 0;

  return (
    <div
      data-testid="services-seen"
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 10,
        animation: "oi-rise .16s ease backwards",
      }}
    >
      <style>{`.si-opt:hover{border-color:var(--brand)!important}`}</style>
      {shown.map((r) => {
        const owner = done[r.id]?.team;
        const suggested = r.suggestedTeamId ? teams.find((x) => x.id === r.suggestedTeamId) : null;
        const mine = teams.filter((x) => myTeamIds.includes(x.id) && x.id !== suggested?.id);
        const options = [...(suggested ? [suggested] : []), ...mine.slice(0, 1)];
        return (
          <div
            key={r.id}
            data-testid="seen-row"
            style={{
              background: "var(--panel)",
              border: "1px solid var(--line)",
              borderRadius: "var(--radius-card)",
              boxShadow: "var(--shadow-card)",
              padding: "14px 16px",
              display: "flex",
              alignItems: "center",
              gap: 14,
              flexWrap: "wrap",
            }}
          >
            <div
              style={{ flex: 1, minWidth: 220, display: "flex", flexDirection: "column", gap: 3 }}
            >
              <a
                href={`/app/services/${r.id}`}
                style={{
                  fontFamily: "var(--mono)",
                  fontSize: 14,
                  fontWeight: 600,
                  color: "inherit",
                  textDecoration: "none",
                  width: "fit-content",
                }}
              >
                {r.key}
              </a>
              <span style={{ fontSize: 12, color: "var(--ink-3)" }}>
                {t("services.seenAs")}{" "}
                <span style={{ fontFamily: "var(--mono)" }}>service:{r.key}</span>
                {r.from ? ` · ${r.from}` : ""}
              </span>
            </div>
            <div
              style={{
                flex: 1,
                minWidth: 220,
                display: "flex",
                alignItems: "center",
                gap: 8,
                fontSize: 12.5,
                color: "var(--ink-2)",
              }}
            >
              {r.hint ? (
                <>
                  <span style={{ color: "var(--viol)" }}>✦</span>
                  <span>{r.hint}</span>
                </>
              ) : (
                <span style={{ color: "var(--ink-3)" }}>{t("services.noSuggestion")}</span>
              )}
            </div>
            {!owner && mayAssign && teams.length > 0 && (
              <div
                style={{
                  display: "flex",
                  gap: 6,
                  flexWrap: "wrap",
                  opacity: busy === r.id ? 0.6 : 1,
                }}
              >
                {options.map((o, i) => {
                  const lead = i === 0 && !!suggested;
                  return (
                    <button
                      key={o.id}
                      type="button"
                      data-testid="seen-assign"
                      disabled={busy === r.id}
                      onClick={() => assign(r, o)}
                      className="si-opt"
                      style={{
                        height: 32,
                        padding: "0 12px",
                        border: lead ? "1.5px solid var(--brand)" : "1px solid var(--line)",
                        borderRadius: 9,
                        background: lead ? "var(--brand-t)" : "var(--panel)",
                        color: lead ? "var(--brand)" : "var(--ink-2)",
                        display: "flex",
                        alignItems: "center",
                        fontSize: 12.5,
                        fontWeight: 600,
                        cursor: "pointer",
                      }}
                    >
                      {o.name}
                    </button>
                  );
                })}
                <OtherTeam
                  teams={teams}
                  disabled={busy === r.id}
                  onPick={(team) => assign(r, team)}
                />
              </div>
            )}
            {!owner && mayAssign && teams.length === 0 && (
              <span style={{ fontSize: 12, color: "var(--ink-3)" }}>{t("services.noTeams")}</span>
            )}
            {owner && (
              <div
                data-testid="seen-done"
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  background: owner.policyName ? "var(--ok-t)" : "var(--wait-t)",
                  borderRadius: 10,
                  padding: "8px 12px",
                  fontSize: 12.5,
                  animation: "oi-rise .15s ease backwards",
                }}
              >
                <span
                  style={{
                    width: 7,
                    height: 7,
                    borderRadius: "50%",
                    background: owner.policyName ? "var(--ok)" : "var(--wait)",
                  }}
                />
                <span>
                  <strong>
                    {r.key} → {owner.name}.
                  </strong>{" "}
                  {owner.policyName ? t("services.donePaged") : t("services.doneNoPolicy")}
                </span>
                <button
                  type="button"
                  data-testid="seen-undo"
                  disabled={busy === r.id}
                  onClick={() => undo(r)}
                  style={{
                    fontWeight: 600,
                    color: "var(--brand)",
                    cursor: "pointer",
                    border: 0,
                    background: "none",
                    padding: 0,
                    fontSize: 12.5,
                  }}
                >
                  {t("services.undo")}
                </button>
              </div>
            )}
          </div>
        );
      })}
      {allDone && (
        <div
          style={{
            border: "1px dashed var(--line)",
            borderRadius: "var(--radius-card)",
            padding: 26,
            textAlign: "center",
            fontSize: 13,
            color: "var(--ink-2)",
          }}
        >
          {t("services.emptySeen")}
        </div>
      )}
    </div>
  );
}

function OtherTeam({
  teams,
  disabled,
  onPick,
}: {
  teams: Team[];
  disabled: boolean;
  onPick: (team: Team) => void;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useOutsideClose(open, () => setOpen(false), ref);
  return (
    <div ref={ref} style={{ position: "relative" }}>
      <button
        type="button"
        data-testid="seen-other"
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
        className="si-opt"
        style={{
          height: 32,
          padding: "0 12px",
          border: "1px solid var(--line)",
          borderRadius: 9,
          background: "var(--panel)",
          color: "var(--ink-2)",
          display: "flex",
          alignItems: "center",
          fontSize: 12.5,
          fontWeight: 600,
          cursor: "pointer",
        }}
      >
        {t("services.otherTeam")} ▾
      </button>
      {open && (
        <div role="menu" style={MENU}>
          {teams.map((x) => (
            <button
              key={x.id}
              type="button"
              role="menuitem"
              className="oi-hover"
              onClick={() => {
                setOpen(false);
                onPick(x);
              }}
              style={MENU_ITEM}
            >
              <span style={{ flex: 1 }}>{x.name}</span>
              {x.policyName && (
                <span style={{ fontSize: 11.5, color: "var(--ink-3)" }}>{x.policyName}</span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
