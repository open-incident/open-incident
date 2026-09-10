---
title: Post-incident
section: daily-use
order: 6
summary: The flow that follows a resolution — tasks in two phases, the debrief, the post-mortem with its AI draft, exports to Confluence or Notion.
---

## When the flow starts

The **Post-incident** tab of an incident becomes active when the incident is resolved and its severity asks for the flow. Each severity says, in **Settings → Types & lifecycle → Severities**, whether it starts the flow: _always_, _yes_, _opt-in at closure_, or _no_. The timeline records _The post-incident flow starts (SEV2 rule)_.

![The post-incident tab](img/incident-post-incident.png "Two phases with their tasks, the debrief, the post-mortem and its sections.")

## Two phases, their tasks

The flow is two phases — **Document**, then **Review** — each with the tasks configured in **Settings → Post-incident flow**: write the timeline of events, identify contributing factors, schedule the debrief, review the follow-ups, publish the post-mortem…

Each task has a default assignee (the incident lead, the communication lead, or nobody) and a deadline counted in days after entering the phase. A task is **done** with a click, or **skipped with a reason** — the skip is traced in the timeline. The incident leaves the post-incident phase and **closes** when every task is done or skipped.

> Tasks are copied into the incident when it enters the flow. Changing the flow's definition later affects the next incidents, never the ones already in it.

## The debrief

Scheduling a debrief from the tab sets a date and a slot and sends an invitation to the guests — the role holders and the active participants. The timeline says _debrief scheduled on …_.

## The post-mortem

The workspace calls it what it likes — the term is configured in **Settings → Post-incident flow** and used everywhere. It is a document, edited where the incident lives, with everything a reader needs woven in.

### The document

The tab shows three columns. On the left, the **contents** (one dot per section: grey while empty, green once written, amber or red when the assistant's check found a gap or a contradiction), the two phases' **checklists** and the **debrief**. In the centre, the document: its **title** (click to rename), the incident's metadata — severity, date, service, lead, owner, the people who contributed and who edited last — four **metrics** (detection, time to acknowledge, time to resolve, follow-ups), then the **sections**, and the **follow-ups** as a table. On the right, the **activity** — every change, by whom, when — and the **open comments**.

A new document starts from the workspace's **template** (**Settings → Post-incident flow → Post-mortem template**): by default six sections — **Summary**, **Impact**, **Timeline**, **Root cause analysis (RCA)**, **What went well**, **What to improve** — each with a hint of what it should hold. A manager renames, reorders, removes or adds sections and edits the hints; the assistant reads them when it drafts. Documents already written keep their sections.

### Writing

Every section is edited in place, in **Markdown**, with a toolbar — bold, italic, heading, lists, quote, code, link — and a **preview**. Three blocks insert what the incident already knows, at the cursor: the **timeline** (the key events with their times), the **follow-ups** (as a table) and the **impact metrics**. `⌘↵` saves. Sections can be renamed, moved up or down; a section a person added can be removed (the template's own stay, empty them instead). **Add a section** at the bottom adds one of the document's own.

### Comments and history

**Comment** under a section opens a thread — a question, a correction, a fact to add. Comments are resolved (and reopened) in place; the open ones are listed on the right and counted in the contents. Every change — an edit, a draft, a section moved, a title — is a **revision** in the activity rail; **Restore** brings an earlier version back, itself recorded, so nothing is ever lost.

### The AI draft, section by section

With an inference provider configured and the capability allowed in **Settings → AI governance**, the assistant works on the document — always one section at a time when you ask for one, so you pay for what you asked:

- **Draft with AI** fills every empty section from the incident's timeline. Each section carries the **AI DRAFT** label until a person edits it.
- The **✦ Assistant** menu of a section: **Generate / Regenerate** this section from the timeline; **Tighten** (half the length, every fact kept); **Enrich with facts from the timeline** (times, actors, numbers the section lacks — nothing the material does not say); **Rewrite for a reader who was not there**.
- **Check against the facts** reads the whole document once and compares each section with the timeline, the alerts and the changes. It leaves a badge per section — **Gap** (a fact the section should state), **Contradicts the facts** (with what the material says instead), or nothing when supported — and a summary line. It changes no text: the badges say where to look.
- When the incident's [root cause analysis](ai#root-cause-analysis-rca) has a surviving hypothesis, its RCA tab can write it into the **Root cause analysis (RCA)** section while that section is still empty.

The prompt is redacted before it leaves (emails, phone numbers, IPs, hostnames, secrets). Read every section before sharing.

### Status

Its status moves by hand: **In progress** → **Send to review** → **In review** → **Mark completed**. Publication is an event in the timeline.

### Every post-mortem in one place

**Post-mortems** in the rail lists every incident that reached the post-incident phase: the document's status, owner, last update, open follow-ups and open comments, filtered by status — including the incidents whose document has **not started**.

## Exporting the post-mortem

The **Export** menu of the document offers, always: **Download as Markdown** (a `.md` file), **Copy as Markdown** (to the clipboard) and **Open as a page** — the document alone, printable from the browser. `GET /api/v1/incidents/{ref}/post-mortem` returns the same document as sections and as markdown, for a knowledge base or a tool of your own.

When Confluence or Notion is connected in **Settings → Integrations**, the tab shows **Export to Confluence** / **Export to Notion**. The written sections become a page — Confluence storage format in the configured space, or Notion blocks under the configured parent page — with a link back to the incident. The page's address stays on the post-mortem (**Exported page**) and in the timeline. Exporting again creates a new page; nothing there is overwritten. The post-mortem here stays the source.

At least one section must be written before exporting; an empty post-mortem is refused with a message, not exported blank.

## Follow-ups after the incident

The **Follow-ups** tab and the **Follow-ups** view of the incidents list carry the actions the post-mortem calls for. The closure policy (P1 follow-ups closed within _n_ days) is shown above the list, and the **Reports → Follow-ups** tab measures closure by team against it. Exporting to a tracker keeps the status in sync: a closed issue marks the follow-up done here.
