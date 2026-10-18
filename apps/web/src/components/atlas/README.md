# components/atlas — Atlas's UI slots

Owner: **atlas-ui**. Every module places these where the design shows Atlas;
only atlas-ui writes inside them. Each one reads `@/lib/atlas/*` (owner:
atlas-core) and renders nothing when there is nothing true to show — and
nothing at all when Atlas is not available on the instance (no AI provider,
edition, or the capability switched off).

All of them are **server components** (several are async): place them in a
server component, never import them into a `"use client"` file.

| Slot                                  | Placed by                                    | Design                                |
| ------------------------------------- | -------------------------------------------- | ------------------------------------- |
| `AtlasHomeBanner`                     | shell-home (Home, living workspace)          | V2Home "Home — Atlas overnight"       |
| `AtlasReviewTab`                      | incidents (Incidents list, tab `?tab=atlas`) | V2AtlasReview                         |
| `AtlasTimelineMark`, `AtlasUndoLink`  | incidents (timeline rows of kind atlas\_\*)  | V2Incidents timeline                  |
| `WhatAtlasDid`                        | incidents (post-mortem section)              | V2Incidents post-mortem               |
| `AtlasAlertBadge`, `AtlasAlertBanner` | alerts-status (list rows, alert detail)      | V2Alerts                              |
| `ServiceAtlasCard`                    | services-insights (service detail)           | V2Services "Service — Atlas autonomy" |
| `AtlasInsightsTab`                    | services-insights (Insights `?tab=atlas`)    | V2Insights "Insights — Atlas"         |
| `AtlasPolicyStep`                     | oncall (first step of each policy)           | V2OnCall policies                     |
| `AtlasPolicyExplainer`                | oncall (right column of Policies)            | V2OnCall "✦ Atlas tries first." card  |
| `AtlasNotifyCard`                     | oncall (My notifications)                    | V2OnCall "My notifications — Atlas"   |

Notes for the hosts:

- `AtlasUndoLink` reads the action itself: it shows Undo or Redo as the
  action's state calls for, nothing to a viewer, nothing on what cannot be
  taken back, and nothing once the 24 h after an autonomous resolution are over.
- `WhatAtlasDid` renders the whole section, heading included; pass the
  section's "+ Comment" control as `aside` to sit at the right of the heading.
- `AtlasInsightsTab` carries its own row of four KPIs: on `?tab=atlas` the
  host draws its period selector and tabs, not its KPI row.
- `AtlasAlertBadge` translates itself; feed it `alertAtlasStates()` once per list.

The Incident › Atlas tab, the Root cause banner and the Context tab live in
`app/app/incidents/[number]/` (`atlas*.tsx`, `investigation*.tsx`, `context.tsx`).
Journal rows are shown in the reader's language from `payload.text`
(`{ key, params }`, the engine's dictionary keys) and fall back to `title`.
