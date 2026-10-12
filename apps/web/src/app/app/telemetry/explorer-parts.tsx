import Link from "next/link";
import type { ReactNode } from "react";

/**
 * Pieces the Logs and Traces explorers share, after Sumo Logic's search page:
 * the results panel with its tabs and count, the filter actions a field offers
 * (keep it, exclude it), and the empty window that says where the data is.
 */

/** A term the filter language accepts, or null when the value cannot be quoted. */
export function termFor(field: string, value: string): string | null {
  if (value.includes("'") || value.length > 300) return null;
  return `${field} = '${value}'`;
}

/** The filter with one more term — kept, or excluded with NOT. */
export function withTerm(filter: string | undefined, term: string, exclude = false): string {
  const next = exclude ? `NOT ${term}` : term;
  const rest = (filter ?? "").trim();
  return rest ? `${rest} AND ${next}` : next;
}

export function ResultsPanel({
  tabs,
  right,
  children,
  testId,
}: {
  tabs: Array<{ label: string; count?: string; href: string; on: boolean; testId?: string }>;
  right?: ReactNode;
  children: ReactNode;
  testId?: string;
}) {
  return (
    <section className="oi-panel" data-testid={testId} style={{ overflow: "hidden", minWidth: 0 }}>
      <div
        style={{
          display: "flex",
          alignItems: "flex-end",
          gap: 4,
          padding: "0 14px",
          borderBottom: "1px solid var(--line)",
          minHeight: 42,
        }}
      >
        {tabs.map((x) => (
          <Link
            key={x.label}
            href={x.href}
            data-testid={x.testId}
            aria-current={x.on ? "page" : undefined}
            style={{
              padding: "11px 10px 10px",
              fontSize: 12.5,
              fontWeight: x.on ? 600 : 500,
              color: x.on ? "var(--ink)" : "var(--ink-3)",
              borderBottom: `2px solid ${x.on ? "var(--brand)" : "transparent"}`,
              marginBottom: -1,
              textDecoration: "none",
              whiteSpace: "nowrap",
            }}
          >
            {x.label}
            {x.count !== undefined && (
              <span
                style={{
                  marginLeft: 6,
                  fontFamily: "var(--mono)",
                  fontSize: 11,
                  fontWeight: 600,
                  color: "var(--ink-3)",
                }}
              >
                {x.count}
              </span>
            )}
          </Link>
        ))}
        <span style={{ flex: 1 }} />
        <span
          style={{
            alignSelf: "center",
            display: "flex",
            gap: 10,
            alignItems: "center",
            fontSize: 12,
            color: "var(--ink-3)",
          }}
        >
          {right}
        </span>
      </div>
      {children}
    </section>
  );
}

/** One field of an opened row: its name, its value, and the two filter gestures. */
export function FieldRow({
  name,
  value,
  keep,
  exclude,
  keepLabel,
  excludeLabel,
  mono = true,
}: {
  name: string;
  value: string;
  keep?: string | null;
  exclude?: string | null;
  /** What the "+" does, in words: it is a link whose only text is a sign. */
  keepLabel?: string;
  excludeLabel?: string;
  mono?: boolean;
}) {
  const action: React.CSSProperties = {
    width: 22,
    height: 22,
    display: "inline-grid",
    placeItems: "center",
    borderRadius: 6,
    border: "1px solid var(--line)",
    background: "var(--panel)",
    fontSize: 13,
    fontWeight: 600,
    color: "var(--ink-2)",
    textDecoration: "none",
  };
  return (
    <div
      data-testid="field-row"
      style={{
        display: "grid",
        gridTemplateColumns: "minmax(140px, 220px) minmax(0,1fr) 52px",
        gap: 10,
        alignItems: "center",
        padding: "4px 0",
        borderTop: "1px solid var(--line-2)",
        fontSize: 12,
      }}
    >
      <span
        style={{
          fontFamily: "var(--mono)",
          color: "var(--ink-3)",
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
        title={name}
      >
        {name}
      </span>
      <span
        style={{
          fontFamily: mono ? "var(--mono)" : undefined,
          color: "var(--ink)",
          overflowWrap: "anywhere",
        }}
      >
        {value || "—"}
      </span>
      <span style={{ display: "flex", gap: 4, justifyContent: "flex-end" }}>
        {keep && (
          <Link
            href={keep}
            title={keepLabel}
            aria-label={keepLabel}
            data-testid="field-keep"
            className="oi-hover"
            style={action}
          >
            +
          </Link>
        )}
        {exclude && (
          <Link
            href={exclude}
            title={excludeLabel}
            aria-label={excludeLabel}
            data-testid="field-exclude"
            className="oi-hover"
            style={action}
          >
            −
          </Link>
        )}
      </span>
    </div>
  );
}

/**
 * An empty window, said with the way out.
 *
 * "Nothing here" is either nothing happened or the wrong time is on screen,
 * and the reader cannot tell which. When the last data is older than the
 * window, the panel says when it arrived and offers the hour that holds it.
 */
export function EmptyWindow({
  message,
  latest,
  latestLabel,
  showLatest,
  showLatestLabel,
}: {
  message: string;
  latest?: string | null;
  latestLabel?: string;
  showLatest?: string | null;
  showLatestLabel?: string;
}) {
  return (
    <div
      data-testid="explorer-empty"
      style={{
        padding: "34px 20px",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 10,
        textAlign: "center",
      }}
    >
      <span style={{ fontSize: 13, color: "var(--ink-2)", maxWidth: 520 }}>{message}</span>
      {latest && (
        <span style={{ fontSize: 12.5, color: "var(--ink-3)" }}>
          {latestLabel} <strong style={{ color: "var(--ink)" }}>{latest}</strong>
        </span>
      )}
      {showLatest && (
        <Link
          href={showLatest}
          data-testid="explorer-show-latest"
          className="oi-btn oi-btn-primary"
          style={{ marginTop: 4 }}
        >
          {showLatestLabel}
        </Link>
      )}
    </div>
  );
}
