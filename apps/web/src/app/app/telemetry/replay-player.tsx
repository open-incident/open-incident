"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Playing back a session recording.
 *
 * Nothing is fetched until somebody presses play, and that is the whole design
 * of this component. A recording is megabytes; the sessions list is a screen
 * people browse. Loading one because a row happened to be selected would make
 * browsing the list cost a download per click.
 *
 * rrweb's `Replayer` is imported dynamically for the same reason on our side:
 * the console's bundle should not carry a DOM player on every screen that is
 * not this one.
 */
export function ReplayPlayer({
  sessionId,
  labels,
}: {
  sessionId: string;
  labels: {
    play: string;
    loading: string;
    failed: string;
    empty: string;
    events: string;
    isolated: string;
  };
}) {
  const host = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<"idle" | "loading" | "playing" | "empty" | "failed">("idle");
  const [count, setCount] = useState(0);

  // A new session means a new recording: the player is torn down rather than
  // fed different events, because rrweb keeps the DOM it built and replaying
  // another session into it shows the last one's page underneath.
  useEffect(() => {
    setState("idle");
    setCount(0);
    if (host.current) host.current.innerHTML = "";
  }, [sessionId]);

  async function play() {
    setState("loading");
    try {
      const [res, rrweb] = await Promise.all([
        fetch(`/api/telemetry/replay/${encodeURIComponent(sessionId)}`),
        import("rrweb"),
      ]);
      if (res.status === 404) return setState("empty");
      if (!res.ok) return setState("failed");
      const data: { events: unknown[] } = await res.json();
      // rrweb needs two events to have a timeline at all; one is a snapshot
      // with nothing after it, which it renders as a frozen frame and then
      // throws on seek.
      if (!Array.isArray(data.events) || data.events.length < 2) return setState("empty");
      if (!host.current) return setState("failed");
      host.current.innerHTML = "";
      new rrweb.Replayer(data.events as ConstructorParameters<typeof rrweb.Replayer>[0], {
        root: host.current,
        // The recorded page is rebuilt inside an iframe with no permissions:
        // it is somebody else's markup and it is not going to run scripts,
        // submit forms or navigate the console it is being watched in.
        UNSAFE_replayCanvas: false,
        mouseTail: false,
      }).play();
      setCount(data.events.length);
      setState("playing");
    } catch {
      setState("failed");
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {state !== "playing" && (
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 14px" }}>
          <button
            type="button"
            onClick={play}
            disabled={state === "loading"}
            data-testid="replay-play"
            style={{
              border: "1px solid var(--line)",
              background: "var(--panel)",
              borderRadius: 8,
              padding: "5px 12px",
              fontSize: 12,
              fontWeight: 600,
              cursor: state === "loading" ? "progress" : "pointer",
            }}
          >
            {state === "loading" ? labels.loading : labels.play}
          </button>
          {state === "empty" && (
            <span style={{ fontSize: 11.5, color: "var(--ink-3)" }}>{labels.empty}</span>
          )}
          {state === "failed" && (
            <span style={{ fontSize: 11.5, color: "var(--dang)" }}>{labels.failed}</span>
          )}
        </div>
      )}
      <div
        ref={host}
        data-testid="replay-stage"
        style={{
          display: state === "playing" ? "block" : "none",
          overflow: "auto",
          resize: "vertical",
          height: 420,
          background: "var(--sunk)",
          borderTop: "1px solid var(--line-2)",
        }}
      />
      {state === "playing" && (
        <div
          style={{
            display: "flex",
            gap: 10,
            padding: "6px 14px",
            fontSize: 11,
            color: "var(--ink-3)",
          }}
        >
          <span>{labels.events.replace("{count}", String(count))}</span>
          <span>·</span>
          <span>{labels.isolated}</span>
        </div>
      )}
    </div>
  );
}
