"use client";

import { useT } from "@/i18n/client";
import { atlasPause, atlasStop } from "@/components/atlas/actions";
import { useAtlasCommand } from "@/components/atlas/toast";

/**
 * The Atlas tab's dark bar: what the run is doing, the service's level, what
 * it cost — and Pause and Stop, always within reach while you scroll. Pause
 * keeps Atlas reading but stops it acting; Stop also withdraws every proposal
 * still waiting for a person.
 */
export function AtlasRunBar({
  incidentId,
  state,
  running,
  levelLine,
  noService,
  cost,
  paused,
  stopped,
  canAct,
}: {
  incidentId: string;
  state: string;
  running: boolean;
  levelLine: { before: string; name: string; after: string } | null;
  noService: string;
  cost: string;
  paused: boolean;
  stopped: boolean;
  canAct: boolean;
}) {
  const t = useT();
  const { run, pending, toast } = useAtlasCommand();
  return (
    <div
      data-testid="atlas-bar"
      style={{
        position: "sticky",
        top: 0,
        zIndex: 5,
        display: "flex",
        alignItems: "center",
        gap: 12,
        flexWrap: "wrap",
        background: "var(--topbar-dark)",
        color: "#fff",
        borderRadius: 12,
        padding: "9px 10px 9px 14px",
        boxShadow: "var(--shadow-pop)",
      }}
    >
      <span style={{ color: "#C4B5FD", fontSize: 15 }}>✦</span>
      <div style={{ display: "flex", flexDirection: "column", minWidth: 0, flex: "1 1 260px" }}>
        <span
          style={{
            fontSize: 13,
            fontWeight: 600,
            display: "flex",
            alignItems: "center",
            gap: 7,
          }}
        >
          {running && (
            <span
              aria-hidden
              style={{
                width: 7,
                height: 7,
                borderRadius: "50%",
                background: "#C4B5FD",
              }}
            />
          )}
          {t("atlas.ui.run.title", { state })}
        </span>
        <span style={{ fontSize: 11.5, color: "rgba(255,255,255,.65)" }}>
          {levelLine ? (
            <>
              {levelLine.before}
              <strong style={{ color: "#fff" }}>{levelLine.name}</strong>
              {levelLine.after}
            </>
          ) : (
            noService
          )}
        </span>
      </div>
      <span
        style={{
          fontFamily: "var(--mono)",
          fontSize: 11.5,
          color: "rgba(255,255,255,.75)",
          whiteSpace: "nowrap",
        }}
      >
        {cost}
      </span>
      {canAct && (
        <>
          <button
            type="button"
            data-testid="atlas-pause"
            disabled={pending}
            onClick={() => run(() => atlasPause(incidentId, !paused))}
            style={{
              height: 30,
              padding: "0 12px",
              borderRadius: 8,
              border: "1px solid rgba(255,255,255,.25)",
              background: "transparent",
              color: "#fff",
              display: "flex",
              alignItems: "center",
              fontSize: 12,
              fontWeight: 600,
              cursor: "pointer",
              whiteSpace: "nowrap",
              fontFamily: "inherit",
            }}
          >
            {paused ? t("atlas.ui.resume") : t("atlas.ui.pause")}
          </button>
          <button
            type="button"
            data-testid="atlas-stop"
            disabled={pending || stopped}
            onClick={() => run(() => atlasStop(incidentId))}
            style={{
              height: 30,
              padding: "0 12px",
              borderRadius: 8,
              border: 0,
              background: stopped ? "var(--ink-3)" : "var(--dang)",
              color: "#fff",
              display: "flex",
              alignItems: "center",
              gap: 6,
              fontSize: 12,
              fontWeight: 700,
              cursor: stopped ? "default" : "pointer",
              whiteSpace: "nowrap",
              fontFamily: "inherit",
            }}
          >
            <span style={{ width: 9, height: 9, borderRadius: 2, background: "#fff" }} />
            {stopped ? t("atlas.ui.stopped") : t("atlas.ui.stop")}
          </button>
        </>
      )}
      {toast}
    </div>
  );
}
