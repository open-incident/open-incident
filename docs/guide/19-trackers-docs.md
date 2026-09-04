---
title: Trackers, documentation tools, war room
section: integrations
order: 19
summary: Follow-ups exported to GitHub, GitLab, Jira or Linear with their status synced back; post-mortems exported to Confluence or Notion; the video-call link template.
---

## Issue trackers

Connected per workspace in **Settings → Integrations**, one card per tracker. Credentials are **tested before being saved** (a wrong token saves nothing), encrypted at rest and never shown again.

| Tracker           | Fields                                                                               | Token                                                             |
| ----------------- | ------------------------------------------------------------------------------------ | ----------------------------------------------------------------- |
| **GitHub Issues** | Repository `owner/name`                                                              | A fine-grained token scoped to that repository with issues write. |
| **GitLab Issues** | Project (path or id)                                                                 | A project access token with the `api` scope.                      |
| **Jira Cloud**    | Site (`acme.atlassian.net`), project key, account email, issue type (default _Task_) | An API token of an account that can create issues in the project. |
| **Linear**        | Team key                                                                             | A personal API key.                                               |

### Exporting a follow-up

On a follow-up's row — in the incident's **Follow-ups** tab or the **Follow-ups** view — **Export** offers the connected trackers. The issue is created with the follow-up's title, the incident's reference and a link back; the row keeps the issue's link. A follow-up already exported is not exported twice.

### Status sync

Every five minutes, and on **Sync now** from the card, the issue's state comes back: a closed GitHub or GitLab issue, a Jira issue moved to a done status, a completed or cancelled Linear issue marks the follow-up **Done** here, with a line in the incident's timeline.

## Documentation tools

| Tool                 | Fields                                   | Token                                                                               |
| -------------------- | ---------------------------------------- | ----------------------------------------------------------------------------------- |
| **Confluence Cloud** | Site, space key, optional parent page id | An API token of an account that can write in the space.                             |
| **Notion**           | Parent page id (32 characters)           | An internal integration token; the parent page must be shared with the integration. |

From the incident's **Post-incident** tab, **Export to Confluence** / **Export to Notion** turns the written sections into a page (Confluence storage format, or Notion blocks) with a link back. The page's address stays on the post-mortem and in the timeline. Exporting again creates a new page; nothing there is overwritten. The post-mortem here stays the source.

## War room

The **Bridge** card holds a **link template** for the video call attached to every new incident: `https://meet.google.com/lookup/inc-{number}` or a fixed Zoom room. `{number}` is replaced by the incident number. The link is shown on the incident, in the chat channel header and in the paging messages. Drill (test) incidents get none.
