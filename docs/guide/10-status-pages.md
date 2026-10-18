---
title: Status pages
section: daily-use
order: 10
summary: A public or internal page per workspace; components that track a monitor or follow the incidents; incidents and maintenances published from the product; subscribers, feeds, brand, domain.
---

## Two applications

The public pages are served by a **separate, minimal application** (`status`, port 3001 in the compose stack) that reads one projection of the product and nothing else — no Redis, no session. If the product goes down, the last snapshot keeps being served. An unknown host answers 404, never a page.

Pages answer on `{slug}.<STATUS_BASE_DOMAIN>` at once (`skylark.status.localhost:3001` on the compose stack), and on a **custom domain** once its DNS is verified — from then on, every link to the page uses the custom domain. The demo workspace's `status.skylark.dev` stays _pending DNS_ on purpose: it is a sample, not a domain the instance serves.

## Creating and shaping a page

![Status pages, admin side](img/status-pages-admin.png "The page with its overall state, its components, its public incidents and maintenances, its subscribers.")

**Status pages** shows one page at a time: its address, its overall state and **View public page →**, its components, its public incidents and maintenances, its subscribers by channel. The workspace's other pages are cards on the right — the internal one included — and open with a click. **+ New page** asks for an address (slug). The page is `noindex` until you launch it.

The page's own settings — brand and language, publication threshold, visibility, domain, message templates, subscriber import, deleting the page — are one click away, on the **Page settings** card (`?tab=settings`).

### Components

**+ Component** asks for a public name and where its **status comes from**:

- **A monitor** — automatic status, uptime % and 90-day bars, all read off the monitor's own checks. The row carries the **AUTO** badge; neither a person nor a published incident can overwrite what the monitor says.
- **Manual** — you set it from incidents. Bound to a **service**, the component is affected automatically when an incident on that service is published: the impact is derived from the incident's severity (degraded, partial outage, major outage).

Each row shows the last 30 days of bars and the 90-day uptime. Clicking a row opens the component: its name, the line the public page shows under it and its group for a manager, its state for a responder when the component is manual, and **Delete**.

### Visibility

**Public — anyone with the address**, or **Internal — members of the workspace only**. An internal page does not exist for anyone outside: 404 on the page and its feeds, no subscription form. A signed-in member opens it from the product (**View public page →**) and receives a day's access through a signed token the status app verifies without a session or a database.

### Brand and language

Accent colour, language of the public wording (English, French, German), privacy policy and legal notice URLs, reply-to for subscriber emails. The workspace logo (uploaded in **Settings → General**) is shown when object storage is configured.

### Publication threshold

**Suggest publication from SEV2 and above**: an incident at or above this severity, on a service bound to a component, shows _This incident meets the publication threshold of « page »_ on its page — and **nothing is published without you**. Below the threshold you can still publish from the update dialog.

### Domain

Enter the custom domain, point a CNAME at `status.<your domain>`, then **Save & verify DNS**. Once verified, your reverse proxy issues the certificate on first visit — it asks the status app whether the domain is one of yours before doing so (see [install](install)). **Indexing** switches from noindex to indexed when you launch.

### Templates

**Message templates** hold approved public wordings (_We are investigating elevated error rates on …_). They are suggested when publishing.

### Subscribers

Email subscribers with **double opt-in** and one-click unsubscribe; unlimited. An owner can **Import a CSV** — the import is audited.

## Publishing an incident

From the incident's **Share an update** dialog, tick **Status page — <page>** and choose the public status: **Investigating**, **Identified**, **Monitoring**, **Resolved**. The update's message is what subscribers and visitors read. Every later update offers the same tick; the components of the affected service take the impact derived from the severity; resolution clears it. The incident's details show **Published · Monitoring** with the number of public updates and notified subscribers, and the timeline says _Published on <page> — Investigating_.

![The public page](img/status-page-public.png "Overall state, components with their bars, the current incident with its updates, past incidents and maintenances.")

### The ninety bars

Each component on the public page draws one bar per day for ninety days, with its uptime and its state in columns of their own. Resting the pointer on a bar says what happened that day, in the page's language: the date, the day's **availability** (_94.79 %_), and the **real incident** that touched the component — its public title, how long it lasted and how it ended — or the maintenance under way. A quiet day says _No incident. All checks passed._ for a component a monitor checks, _No incident._ for a manual one; a day nothing measured is grey and says so, never green. Near either edge the tooltip slides to stay on screen; its arrow stays on the bar.

### Correcting an update

A public update goes out to every subscriber the moment it is published, and some of them go out wrong: the service named is the wrong one, the time is off by an hour, a sentence says the opposite of what it meant.

Clicking a public incident on the admin screen opens its **public updates**, one form per update. Edit the text and press **Correct**. The newest update can also change its public status — **Investigating**, **Identified**, **Monitoring**, **Resolved** — and doing so moves the incident's public status with it; the older ones can only be reworded, because a timeline whose middle entries change status afterwards is a timeline nobody can read.

Two things a correction deliberately does not do. **It does not notify again**: the email went out with the old words, and a second one that says almost the same thing costs more trust than the mistake did. And **it does not hide itself** — the update carries _corrected at <time>_ on the public page and in the history, because a page that silently rewrites its own past is worth less than one that admits an edit.

![Correcting a published update](img/status-page-correct.png "One form per published update: the text, the public status on the newest one, and the note that nobody is notified again.")

## Maintenances

**Schedule a maintenance** with a title (the subject of the emails), a message, a period, and the components. Subscribers are told once at scheduling; with **automatic transitions**, the maintenance moves to _in progress_ at the start and _completed_ at the end without emailing anyone again. It appears on the page under **Maintenance in progress** and stays in the history for 90 days.

### Moving one

A window that has not started can move: clicking a **scheduled** maintenance reopens the same form — title, message, dates, components — filled in, with **Cancel maintenance** beside it.

Until this existed, the only way to move a window was to cancel it and schedule another, which tells every subscriber the maintenance was cancelled and then tells them about a new one, for what is the same maintenance.

Changing the **dates** adds one line to the public timeline, because a window nobody was told had moved is a window people will be surprised by. Rewording the **message** does not: the page already shows it. Nobody is emailed again either way. A maintenance that has started or finished is not edited — its own updates are the record of what happened, and moving the start of something that already started is a statement nobody can act on.

## Feeds and API

Every public page exposes **RSS** and **Atom** feeds, and the API lists pages and their public incidents (`GET /api/v1/status-pages`, `GET /api/v1/status-pages/{slug}/incidents`). Internal pages expose neither.
