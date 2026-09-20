/**
 * The rail's glyphs, drawn rather than fetched — a third-party logo loaded from
 * a CDN leaks the reader to it and breaks when the CDN does.
 *
 * Each one is the design's path, at its stroke width: they are read at 16 px in
 * the sidebar and at 14 px in the command palette, so `size` is a prop rather
 * than a viewBox change.
 */
export type NavIconId =
  | "home"
  | "incidents"
  | "alerts"
  | "monitors"
  | "onCall"
  | "statusPages"
  | "services"
  | "insights"
  | "telemetry"
  | "dashboards"
  | "guide"
  | "settings"
  | "search"
  | "bell";

const PATHS: Record<NavIconId, React.ReactNode> = {
  home: <path d="M3 11l9-8 9 8v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z" />,
  incidents: <path d="M13 2L3 14h9l-1 8 10-12h-9z" />,
  alerts: (
    <>
      <circle cx="12" cy="12" r="2" />
      <path d="M5 19a10 10 0 0 1 0-14M8 16a6 6 0 0 1 0-8M19 5a10 10 0 0 1 0 14M16 8a6 6 0 0 1 0 8" />
    </>
  ),
  monitors: <path d="M3 12h4l3-8 4 16 3-8h4" />,
  onCall: (
    <path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1 1 .4 1.9.7 2.8a2 2 0 0 1-.5 2.1L8.1 9.9a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.9.6 2.8.7a2 2 0 0 1 1.7 2z" />
  ),
  statusPages: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18" />
    </>
  ),
  services: (
    <>
      <rect x="3" y="4" width="18" height="6" rx="1.5" />
      <rect x="3" y="14" width="18" height="6" rx="1.5" />
    </>
  ),
  insights: <path d="M6 20v-5M12 20V9M18 20V4" />,
  telemetry: <circle cx="12" cy="12" r="8" />,
  dashboards: (
    <>
      <rect x="3" y="3" width="7" height="9" rx="1" />
      <rect x="14" y="3" width="7" height="5" rx="1" />
      <rect x="3" y="16" width="7" height="5" rx="1" />
      <rect x="14" y="12" width="7" height="9" rx="1" />
    </>
  ),
  guide: (
    <>
      <path d="M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2z" />
      <path d="M4 19V5" />
    </>
  ),
  settings: <path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M2 14h4M10 8h4M18 16h4" />,
  search: (
    <>
      <circle cx="11" cy="11" r="7" />
      <path d="M20 20l-3.5-3.5" />
    </>
  ),
  bell: (
    <>
      <path d="M6 8a6 6 0 0 1 12 0c0 7 3 8 3 8H3s3-1 3-8" />
      <path d="M10.3 21a1.9 1.9 0 0 0 3.4 0" />
    </>
  ),
};

/** Per-icon stroke settings, kept where the design put them. */
const STROKE: Partial<Record<NavIconId, { width?: number; dash?: string; cap?: "round" }>> = {
  telemetry: { dash: "3 3" },
  search: { width: 2 },
};

export function NavIcon({ id, size = 16 }: { id: NavIconId; size?: number }) {
  const s = STROKE[id];
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={s?.width ?? 1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeDasharray={s?.dash}
      aria-hidden="true"
    >
      {PATHS[id]}
    </svg>
  );
}
