/**
 * The marks of the alert sources — monochrome glyphs drawn in `currentColor`,
 * never a vendor's logo: the screens show which kind of tool sends, and a row
 * of brand colours would shout louder than the alerts themselves.
 */

const stroke = {
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.8,
} as const;

function Mark({ id, size }: { id: string; size: number }) {
  const box = { width: size, height: size };
  switch (id) {
    case "datadog":
      return (
        <svg viewBox="0 0 24 24" {...box} fill="currentColor" aria-hidden>
          <path d="M12 2l8 5v10l-8 5-8-5V7z" opacity=".15" />
          <path d="M8 9h8v2H8zm0 4h5v2H8z" />
        </svg>
      );
    case "prometheus":
      return (
        <svg {...stroke} {...box} aria-hidden>
          <circle cx="12" cy="12" r="9" />
          <path d="M8 13c0-3 4-4 4-8 1 3 4 4 4 8z" fill="currentColor" />
          <path d="M8 16h8" />
        </svg>
      );
    case "grafana":
      return (
        <svg {...stroke} {...box} strokeLinecap="round" aria-hidden>
          <path d="M4 19l4-6 4 3 4-8 4 4" />
        </svg>
      );
    case "sentry":
      return (
        <svg {...stroke} {...box} strokeLinejoin="round" aria-hidden>
          <path d="M12 3l9 16H3z" />
          <path d="M12 9v4" />
        </svg>
      );
    case "cloudwatch":
      return (
        <svg {...stroke} {...box} strokeLinecap="round" aria-hidden>
          <path d="M7 18a4 4 0 0 1-.5-8A6 6 0 0 1 18 9a3.5 3.5 0 0 1 0 9z" />
        </svg>
      );
    case "uptime_kuma":
      return (
        <svg {...stroke} {...box} strokeLinecap="round" aria-hidden>
          <path d="M3 12h3l2-5 3 10 3-7 2 2h5" />
        </svg>
      );
    case "migrate":
      return (
        <svg {...stroke} {...box} strokeLinecap="round" aria-hidden>
          <path d="M12 3v13M6 9l6-6 6 6" />
          <path d="M5 21h14" />
        </svg>
      );
    default:
      return (
        <svg {...stroke} {...box} strokeLinecap="round" aria-hidden>
          <path d="M7 8l-4 4 4 4M17 8l4 4-4 4M14 5l-4 14" />
        </svg>
      );
  }
}

/** The glyph of one kind of source (`datadog`, `prometheus`… `http`, or `migrate`). */
export function SourceGlyph({ kind, size = 20 }: { kind: string; size?: number }) {
  return <Mark id={kind} size={size} />;
}
