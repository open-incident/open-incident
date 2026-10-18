# components/atlas — Atlas's UI slots

Owner: **atlas-ui**. Every module places these where the design shows Atlas;
only atlas-ui writes inside them. Each one reads `@/lib/atlas/*` (owner:
atlas-core) and renders nothing when there is nothing true to show.

| Slot                                  | Placed by                                    | Design                                |
| ------------------------------------- | -------------------------------------------- | ------------------------------------- |
| `AtlasHomeBanner`                     | shell-home (Home, living workspace)          | V2Home "Home — Atlas overnight"       |
| `AtlasReviewTab`                      | incidents (Incidents list, tab `?tab=atlas`) | V2AtlasReview                         |
| `AtlasTimelineMark`, `AtlasUndoLink`  | incidents (timeline rows of kind atlas_*)    | V2Incidents timeline                  |
| `WhatAtlasDid`                        | incidents (post-mortem section)              | V2Incidents post-mortem               |
| `AtlasAlertBadge`, `AtlasAlertBanner` | alerts-status (list rows, alert detail)      | V2Alerts                              |
| `ServiceAtlasCard`                    | services-insights (service detail)           | V2Services "Service — Atlas autonomy" |
| `AtlasInsightsTab`                    | services-insights (Insights `?tab=atlas`)    | V2Insights "Insights — Atlas"         |
| `AtlasPolicyStep`                     | oncall (first step of each policy)           | V2OnCall policies                     |
| `AtlasNotifyCard`                     | oncall (My notifications)                    | V2OnCall "My notifications — Atlas"   |
