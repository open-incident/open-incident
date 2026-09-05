/**
 * The integration marks.
 *
 * Drawn here rather than fetched: an integration tile that waits on a remote
 * logo is a settings screen that leaks its visitors to a dozen third parties,
 * and a broken image the day one of them moves. These are our own monochrome
 * glyphs — the shape says which product without pretending to be its logo —
 * except the three identity providers, whose real marks people look for on a
 * sign-in button and which we already draw on the marketing site.
 *
 * Every glyph is a 24×24 viewBox and inherits `currentColor`, so a tile can
 * dim it when the integration is not available on the instance.
 */
import type { ReactNode } from "react";

function Glyph({ children }: { children: ReactNode }) {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" fill="none">
      {children}
    </svg>
  );
}

const S = { stroke: "currentColor", strokeWidth: 1.7, strokeLinecap: "round" as const };

/** Observability: a signal that spikes. */
const Monitor = (
  <Glyph>
    <path d="M2.5 15h3.2l2.4-8 3 12 2.6-9 1.8 5h6" {...S} strokeLinejoin="round" />
  </Glyph>
);

const ICONS: Record<string, ReactNode> = {
  // ---------- Alert sources ----------
  datadog: (
    <Glyph>
      <path d="M20 5.5 12.5 9 9 6.5 4 9.5" {...S} strokeLinejoin="round" />
      <circle cx="9" cy="15" r="3.2" {...S} />
      <path d="M20 5.5v7.8l-4.5 4.2" {...S} />
    </Glyph>
  ),
  prometheus: (
    <Glyph>
      <path d="M12 2.5c2.6 3 1 5.2 0 6.4-1.1 1.3-1.6 2.6-.6 4" {...S} strokeLinejoin="round" />
      <path d="M4.5 15a7.5 7.5 0 0 1 15 0" {...S} />
      <rect x="5.5" y="15" width="13" height="6" rx="2" {...S} />
    </Glyph>
  ),
  grafana: (
    <Glyph>
      <path d="M3 20v-5.5a5 5 0 0 1 5-5h1.5" {...S} />
      <path d="M9.5 9.5a4 4 0 0 1 6.5-3.2M9.5 9.5A4 4 0 0 0 13 16h5" {...S} />
      <circle cx="19.5" cy="5" r="2" {...S} />
    </Glyph>
  ),
  sentry: (
    <Glyph>
      <path d="M12 3.5 20.5 19h-4.2" {...S} strokeLinejoin="round" />
      <path d="M12 9.5 16 17h-3.4" {...S} strokeLinejoin="round" />
      <path d="M9.6 13.5 12.2 18H3.5L7 12" {...S} strokeLinejoin="round" />
    </Glyph>
  ),
  cloudwatch: (
    <Glyph>
      <path
        d="M7 18a4 4 0 0 1-.6-8A5.5 5.5 0 0 1 17 9.6 3.7 3.7 0 0 1 17.4 18H7z"
        {...S}
        strokeLinejoin="round"
      />
      <path d="M8.5 14h2l1.2-3 1.6 5 1.2-2.6h1.5" {...S} strokeLinejoin="round" />
    </Glyph>
  ),
  uptime_kuma: (
    <Glyph>
      <circle cx="12" cy="12" r="8.5" {...S} />
      <path d="M8 12.5l2.4 2.6L16 9" {...S} strokeLinejoin="round" />
    </Glyph>
  ),
  http: (
    <Glyph>
      <path d="M9.5 5.5 6 12l3.5 6.5M14.5 5.5 18 12l-3.5 6.5" {...S} strokeLinejoin="round" />
    </Glyph>
  ),
  email: (
    <Glyph>
      <rect x="3" y="5.5" width="18" height="13" rx="2.5" {...S} />
      <path d="m4.5 8 6.6 4.6a1.6 1.6 0 0 0 1.8 0L19.5 8" {...S} strokeLinejoin="round" />
    </Glyph>
  ),
  newrelic: (
    <Glyph>
      <path d="M12 2.8 20 7.4v9.2L12 21.2 4 16.6V7.4z" {...S} strokeLinejoin="round" />
      <path d="M12 12v9.2M12 12 4 7.4M12 12l8-4.6" {...S} />
    </Glyph>
  ),
  elastic: (
    <Glyph>
      <path d="M4 6.5h16M6.5 12h13M9 17.5h9" {...S} />
      <circle cx="5" cy="17.5" r="1.6" {...S} />
    </Glyph>
  ),

  // ---------- Chat and video ----------
  slack: (
    <Glyph>
      <rect x="3.4" y="9.6" width="7.2" height="2.8" rx="1.4" {...S} />
      <rect x="13.4" y="11.6" width="7.2" height="2.8" rx="1.4" {...S} />
      <rect x="9.6" y="13.4" width="2.8" height="7.2" rx="1.4" {...S} />
      <rect x="11.6" y="3.4" width="2.8" height="7.2" rx="1.4" {...S} />
    </Glyph>
  ),
  teams: (
    <Glyph>
      <rect x="3" y="6" width="10.5" height="12" rx="2.5" {...S} />
      <path d="M5.8 9.4h4.9M8.25 9.4v5.2" {...S} />
      <circle cx="17.6" cy="8.2" r="2.4" {...S} />
      <path
        d="M15 18v-3.2a2.6 2.6 0 0 1 2.6-2.6h1a2.4 2.4 0 0 1 2.4 2.4V18"
        {...S}
        strokeLinejoin="round"
      />
    </Glyph>
  ),
  meet: (
    <Glyph>
      <rect x="2.8" y="6.5" width="12.4" height="11" rx="2.5" {...S} />
      <path d="M15.2 10.5 21 7.5v9l-5.8-3z" {...S} strokeLinejoin="round" />
    </Glyph>
  ),
  zoom: (
    <Glyph>
      <rect x="2.8" y="6.5" width="12.4" height="11" rx="3.5" {...S} />
      <path d="M15.2 10.8 21 7.8v8.4l-5.8-3z" {...S} strokeLinejoin="round" />
    </Glyph>
  ),

  // ---------- Trackers ----------
  github: (
    <Glyph>
      <path
        d="M9.2 20c-3.6 1-3.6-2-5-2.5m10 4.5v-3.2c0-.9-.2-1.5-.7-2 2.6-.3 5.2-1.3 5.2-5.8 0-1.2-.4-2.2-1.2-3 .1-.4.5-1.5-.1-3 0 0-1-.3-3.3 1.2a11 11 0 0 0-5.8 0C5.9 4.7 5 5 5 5c-.7 1.5-.3 2.6-.1 3-.8.8-1.2 1.8-1.2 3 0 4.5 2.6 5.5 5.2 5.8-.4.4-.6.9-.7 1.6V22"
        {...S}
        strokeLinejoin="round"
      />
    </Glyph>
  ),
  gitlab: (
    <Glyph>
      <path d="m12 20.5-3.4-10.4h6.8L12 20.5z" {...S} strokeLinejoin="round" />
      <path
        d="M8.6 10.1 6.4 3.5 3.2 13.2 12 20.5 3.2 13.2M15.4 10.1l2.2-6.6 3.2 9.7L12 20.5l8.8-7.3"
        {...S}
        strokeLinejoin="round"
      />
    </Glyph>
  ),
  jira: (
    <Glyph>
      <path d="M12 2.5 20 10.5l-3.4 3.4L12 9.3 7.4 13.9 4 10.5z" {...S} strokeLinejoin="round" />
      <path d="M12 14.7 16.6 19 12 23l-4.6-4z" {...S} strokeLinejoin="round" />
    </Glyph>
  ),
  linear: (
    <Glyph>
      <path d="M3.2 13.5 10.5 20.8M3.4 9.4l11.2 11.2M4.8 5.8l13.4 13.4M8.2 3.6l12.2 12.2" {...S} />
    </Glyph>
  ),

  // ---------- Documentation ----------
  confluence: (
    <Glyph>
      <path d="M3 16.5c3.2-5.5 6-6.6 9-4.6 3 2 5.7 1.2 9-3.4" {...S} strokeLinejoin="round" />
      <path d="M3 8.8c3.2 5.5 6 6.6 9 4.6" {...S} opacity="0.45" />
    </Glyph>
  ),
  notion: (
    <Glyph>
      <rect x="3.5" y="3.5" width="17" height="17" rx="3" {...S} />
      <path d="M8.5 16.5V8l7 8.5V8" {...S} strokeLinejoin="round" />
    </Glyph>
  ),

  // ---------- Identity ----------
  saml: (
    <Glyph>
      <path
        d="M12 2.8 19.5 6v6c0 4.2-3 7.4-7.5 9.2C7.5 19.4 4.5 16.2 4.5 12V6z"
        {...S}
        strokeLinejoin="round"
      />
      <path d="M9 12.2l2.2 2.3L15.5 10" {...S} strokeLinejoin="round" />
    </Glyph>
  ),
  scim: (
    <Glyph>
      <circle cx="9" cy="8.5" r="3" {...S} />
      <path
        d="M3.5 19v-.8A4.2 4.2 0 0 1 7.7 14h2.6a4.2 4.2 0 0 1 3.5 1.9"
        {...S}
        strokeLinejoin="round"
      />
      <path d="M16 8.5h5M18.5 6v5M16.5 18.5h5" {...S} />
    </Glyph>
  ),

  // ---------- Catalog and infrastructure as code ----------
  backstage: (
    <Glyph>
      <rect x="3" y="5" width="18" height="14" rx="2.5" {...S} />
      <path d="M3 9.5h18M8 9.5V19" {...S} />
    </Glyph>
  ),
  cli: (
    <Glyph>
      <rect x="2.8" y="4.5" width="18.4" height="15" rx="2.5" {...S} />
      <path d="m6.5 10 2.4 2.2-2.4 2.2M11.5 14.6h5" {...S} strokeLinejoin="round" />
    </Glyph>
  ),
  terraform: (
    <Glyph>
      <path d="M9.2 4.6 14 7.2v5.2L9.2 9.8z" {...S} strokeLinejoin="round" />
      <path d="M14.8 7.6 19.6 10.2v5.2l-4.8-2.6z" {...S} strokeLinejoin="round" />
      <path d="M9.2 11.2 14 13.8V19l-4.8-2.6z" {...S} strokeLinejoin="round" />
    </Glyph>
  ),

  // ---------- Migration and business ----------
  pagerduty: (
    <Glyph>
      <path d="M6.5 3.5h6a5 5 0 0 1 0 10h-6z" {...S} strokeLinejoin="round" />
      <path d="M6.5 16.5v4" {...S} />
    </Glyph>
  ),
  opsgenie: (
    <Glyph>
      <path
        d="M12 3.5 20 8.2c0 6-3.4 10.2-8 12.3-4.6-2.1-8-6.3-8-12.3z"
        {...S}
        strokeLinejoin="round"
      />
      <circle cx="12" cy="10.5" r="2.4" {...S} />
    </Glyph>
  ),
  statuspage: (
    <Glyph>
      <rect x="3" y="5" width="18" height="14" rx="2.5" {...S} />
      <path d="M6.5 9.5h11M6.5 13h7" {...S} />
      <circle cx="17.5" cy="13" r="1.4" fill="currentColor" stroke="none" />
    </Glyph>
  ),
  hris: (
    <Glyph>
      <circle cx="12" cy="7.5" r="3.2" {...S} />
      <path
        d="M5 20v-1a4.5 4.5 0 0 1 4.5-4.5h5A4.5 4.5 0 0 1 19 19v1"
        {...S}
        strokeLinejoin="round"
      />
      <path d="M16.5 4.5h4M18.5 2.5v4" {...S} />
    </Glyph>
  ),
  siem: (
    <Glyph>
      <ellipse cx="12" cy="6" rx="7.5" ry="3" {...S} />
      <path d="M4.5 6v12c0 1.7 3.4 3 7.5 3s7.5-1.3 7.5-3V6" {...S} />
      <path d="M4.5 12c0 1.7 3.4 3 7.5 3s7.5-1.3 7.5-3" {...S} />
    </Glyph>
  ),

  // The catch-all, so a new card is never iconless.
  generic: Monitor,
};

/** The mark of an integration; a shape nobody drew yet falls back to a signal. */
export function IntegrationIcon({ id }: { id: string }) {
  return <>{ICONS[id] ?? ICONS.generic}</>;
}
