---
title: Reading what Atlas did
section: daily-use
order: 12.5
summary: The Atlas tab of an incident, the review queue of what Atlas resolved itself, and where else its work shows — the timeline, the post-mortem, alerts, services, policies, Insights.
---

Atlas acts with the autonomy each service has earned (levels 0 to 4 — see [The assistant](ai)). Whatever it does, it writes down: one journal per incident, every step with its time, what it did, how, who decided and how to take it back. Every screen below reads that one journal; none of them guesses.

## The Atlas tab of an incident

**Incidents → an incident → Atlas ✦** (`?tab=atlas`).

### The bar

A dark bar stays at the top while you scroll. It says what the run is doing (_running_, _run finished at 15:20_, _paused_, _stopped by Amélie_), the service's level and what it means (_checkout-api is at level 2 · **Propose** — Atlas prepares system actions, a person approves_), and what the run cost (euros and tokens). Two buttons are always there for responders:

- **Pause** — Atlas keeps reading, but takes no action. **Resume** gives it its hands back.
- **Stop** — Atlas takes no further action on this incident, and every proposal still waiting for a person is withdrawn. The journal records who stopped it.

### Where things stand

Four lines, updated in place at every assessment: **What's going on**, **What caused it**, **What Atlas did**, **What's next** — each with the sources it rests on.

### What Atlas did

The journal, in order. Each line has its time and a letter: **R** Atlas read something, **O** it wrote in Open Incident (a severity suggestion, a draft, a follow-up), **S** it acted on one of your systems, **✎** a person did something (approved, rejected, stopped, told Atlas something). Chips say who decided: _autonomous_, _waiting for approval 42 min_, _level 2 · Propose_, _reversible_, _verified 15:12_, _undone by Karim_.

- **Undo** / **Redo** sit on every reversible step. Undoing writes its own line in the timeline; undoing something Atlas did _alone_ costs the service a level.
- A proposal still waiting has **Approve** and **Reject** on its line.
- The filters show **All**, **By Atlas alone**, or **On your systems**.

Under the journal, when the run allows the measure, a violet line says what the next level would have changed _on this very run_ — for instance that at level 3 Atlas would have run the rollback itself the moment it proposed it, 42 minutes before it was approved — and what the service still needs to get there. When the run gives no such measure, nothing is said.

### Hypotheses, grade, notes, cost

- **Hypotheses** — H1, H2…, each with a five-step confidence bar; contradicted ones stay visible, struck through. The challenger's verdict closes the list; **Full analysis →** opens the Root cause analysis tab.
- **Grade after closure** — once the incident is resolved: **Bullseye**, **On target**, **Miss**, **Nowhere near**. The grade counts toward the service's level, or costs it one; the card says which.
- **Tell Atlas something** — what you know, in a sentence. Atlas re-assesses with it and credits you; your note appears in the journal.
- **Cost of this run** — step by step, with the provider and the cap per run when one is set.

Atlas only acts through the **allowed actions** in Settings → Atlas.

## Root cause analysis and Context

The **Root cause analysis ✦** tab opens with the hypothesis that guided the run and what it led Atlas to do (_H1 guided the run. It drove the rollback, proposed at 14:10 and approved by Amélie. The verification at 15:12 confirmed it._), linking to the Atlas tab. Below it: the hypothesis in full, its findings and their citations, the challenger's pass, and three buttons — **Accept — write to post-mortem**, **Reject — give a reason** (your reason becomes cited evidence and the analysis runs again), **Ask for another pass**.

The **Context ✦** tab lists everything Atlas knows about the incident, one card per source, every line saying where it comes from: the services and their owners, who is on call, the dependencies and their state, the changes of the last day, the runbooks, similar incidents, the root cause, the pinned notes.

## The review queue

**Incidents → ✦ Resolved by Atlas** (`/app/incidents?tab=atlas`) lists the incidents Atlas resolved itself — at level 4 with nobody paged, at level 3 with a person told while it acted — that nobody has reviewed yet, then those reviewed in the last three days.

Each card says the incident, its severity and service, the level Atlas ran at (`LEVEL 4 · RESOLVE`), when, what happened, who was told (_Resolved by Atlas · nobody paged_, _Resolved by Atlas · Thomas told at 15:55_), how long it took, what it cost, every step with **Undo** while the 24 hours last, and the sources it cited. Three verdicts:

- **Looks right** — grades the run _On target_; it counts toward the service's level.
- **Not quite** — grades it _Miss_.
- **Reopen** — undoes what can be undone, reopens the incident, pages the owner and lowers the service's level.

## Everywhere else

- **Home** — after a night of work, a violet line: _Atlas resolved 2 incidents on its own since yesterday_, with **Review 2 →**. Absent when there is nothing.
- **Timeline** — Atlas's steps are lines marked **✦ Atlas**, with **Undo** / **Redo** inline; the **✦ By Atlas** filter keeps only them.
- **Post-mortem** — a **What Atlas did** section written from the journal: when it started and at which level, what it did and who approved it, the grade, the cost, what was undone, and what the next level would have gained.
- **Alerts** — **✦ Atlas on it**, **✦ by Atlas alone** or **✦ by Atlas · Thomas told** on the alert; in the alert, what Atlas is doing and, when it waits for a person, why (_the fix it found has never been used on this service, so Platform is asked first_) with **Approve the fix**.
- **Services** — **✦ Atlas on this service**: the level, a five-segment bar filling toward the next one, the criteria still missing (✓ / …), the last graded runs, and **Atlas settings →**.
- **On-call → Policies** — every policy starts with **✦ Atlas tries first**, with the level of each service it pages for. **My notifications** has **When Atlas resolves on its own**: a silent push right away, a summary at 09:00 (the default), or nothing.
- **Insights → ✦ Atlas** — the share resolved by Atlas alone, its time to resolve against people's, how often it was right, how often a person undid it and the cost per incident; who resolved each week; each service with its level; the grades of the period. All computed from the workspace's own rows.

A viewer reads all of this; only responders get the buttons.
