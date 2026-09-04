/**
 * Adaptive Cards — the words Teams shows. Same discipline as the Slack
 * blocks: builders receive what to say and shape it; nothing is decided here.
 */
import type { IncidentCard } from "../slack/blocks";

const SCHEMA = "http://adaptivecards.io/schemas/adaptive-card.json";
const card = (body: unknown[], actions: unknown[] = []) => ({
  $schema: SCHEMA,
  type: "AdaptiveCard",
  version: "1.4",
  body,
  ...(actions.length ? { actions } : {}),
});
const text = (t: string, extra: Record<string, unknown> = {}) => ({
  type: "TextBlock",
  text: t,
  wrap: true,
  ...extra,
});
const facts = (pairs: Array<[string, string | null | undefined]>) => ({
  type: "FactSet",
  facts: pairs.filter(([, v]) => v).map(([title, value]) => ({ title, value: String(value) })),
});
const openUrl = (title: string, url: string, extra: Record<string, unknown> = {}) => ({
  type: "Action.OpenUrl",
  title,
  url,
  ...extra,
});
const submit = (
  title: string,
  data: Record<string, unknown>,
  extra: Record<string, unknown> = {},
) => ({ type: "Action.Submit", title, data, ...extra });

export function incidentHeaderCard(inc: IncidentCard): unknown {
  const actions: unknown[] = [openUrl("Open in Open Incident", inc.url)];
  if (inc.bridgeUrl)
    actions.push(openUrl("Join the war room", inc.bridgeUrl, { style: "positive" }));
  actions.push(submit("Post an update", { action: "oi_update_open", reference: inc.reference }));
  actions.push(submit("Escalate", { action: "oi_escalate_open", reference: inc.reference }));
  const body: unknown[] = [
    text(`**${inc.reference} — ${inc.name}**`, { size: "Large", weight: "Bolder" }),
    facts([
      ["Severity", inc.severity],
      ["Status", inc.status ?? inc.phase],
      ["Service", inc.service],
      ["Lead", inc.lead ?? "—"],
    ]),
  ];
  if (inc.summary) body.push(text(inc.summary.slice(0, 2800), { isSubtle: true }));
  return card(body, actions);
}

export function incidentUpdateCard(u: {
  reference: string;
  by: string;
  status: string | null;
  severity: string | null;
  message: string;
  url: string;
  resolved?: boolean;
}): unknown {
  return card(
    [
      text(u.resolved ? `**${u.reference} — resolved**` : `**${u.reference} — update**`, {
        weight: "Bolder",
      }),
      text(u.message.slice(0, 3000)),
      text([u.severity, u.status, `by ${u.by}`].filter(Boolean).join(" · "), {
        isSubtle: true,
        size: "Small",
      }),
    ],
    [openUrl("Open the incident", u.url)],
  );
}

export function announcementCard(a: {
  body: string;
  reference: string;
  url: string;
  closed: boolean;
}): unknown {
  return card(
    [
      text(a.body.slice(0, 3000)),
      text(a.closed ? `${a.reference} · closed` : `${a.reference} · live`, {
        isSubtle: true,
        size: "Small",
      }),
    ],
    [openUrl("Open the incident", a.url)],
  );
}

export function escalationDmCard(e: {
  subject: string;
  text: string;
  url: string;
  ackToken: string | null;
  ackUrl: string | null;
}): unknown {
  const actions: unknown[] = [];
  if (e.ackToken)
    actions.push(
      submit("Acknowledge", { action: "oi_ack", token: e.ackToken }, { style: "positive" }),
    );
  actions.push(openUrl("Open", e.url));
  return card(
    [text(`**${e.subject}**`, { weight: "Bolder", size: "Medium" }), text(e.text.slice(0, 3000))],
    actions,
  );
}

export function acknowledgedCard(e: { subject: string; by: string }): unknown {
  return card([
    text(`**${e.subject}**`, { weight: "Bolder" }),
    text(`✅ Acknowledged by ${e.by}`, { color: "Good" }),
  ]);
}

export type ChoiceOption = { title: string; value: string };

/** The declaration form as a card: title, type, severity, service, summary. */
export function declareCard(opts: {
  types: ChoiceOption[];
  severities: ChoiceOption[];
  services: ChoiceOption[];
  defaultTypeId: string | null;
}): unknown {
  return card(
    [
      text("**Declare an incident**", { weight: "Bolder", size: "Medium" }),
      {
        type: "Input.Text",
        id: "name",
        label: "Title",
        placeholder: "What is broken, for whom",
        isRequired: true,
        errorMessage: "A title is required",
      },
      {
        type: "Input.ChoiceSet",
        id: "typeId",
        label: "Type",
        choices: opts.types,
        value: opts.defaultTypeId ?? opts.types[0]?.value,
      },
      {
        type: "Input.ChoiceSet",
        id: "severityId",
        label: "Severity",
        choices: [{ title: "— not set", value: "" }, ...opts.severities],
        value: "",
      },
      {
        type: "Input.ChoiceSet",
        id: "serviceEntryId",
        label: "Affected service",
        choices: [{ title: "— none", value: "" }, ...opts.services],
        value: "",
      },
      { type: "Input.Text", id: "summary", label: "Summary (optional)", isMultiline: true },
    ],
    [submit("Declare", { action: "oi_declare" }, { style: "positive" })],
  );
}

export function updateCard(opts: {
  reference: string;
  statuses: ChoiceOption[];
  currentStatusId: string | null;
}): unknown {
  return card(
    [
      text(`**Update ${opts.reference}**`, { weight: "Bolder", size: "Medium" }),
      {
        type: "Input.ChoiceSet",
        id: "statusId",
        label: "Status",
        choices: [...opts.statuses, { title: "Resolve the incident", value: "resolve" }],
        value: opts.currentStatusId ?? opts.statuses[0]?.value,
      },
      {
        type: "Input.Text",
        id: "message",
        label: "Message",
        isMultiline: true,
        isRequired: true,
        errorMessage: "A message is required",
      },
    ],
    [
      submit(
        "Post the update",
        { action: "oi_update", reference: opts.reference },
        { style: "positive" },
      ),
    ],
  );
}

export function escalateCard(opts: { reference: string; paths: ChoiceOption[] }): unknown {
  return card(
    [
      text(`**Escalate ${opts.reference}**`, { weight: "Bolder", size: "Medium" }),
      {
        type: "Input.ChoiceSet",
        id: "pathId",
        label: "Escalation path",
        choices: opts.paths,
        value: opts.paths[0]?.value,
      },
    ],
    [
      submit(
        "Page them",
        { action: "oi_escalate", reference: opts.reference },
        { style: "destructive" },
      ),
    ],
  );
}

export const TEAMS_HELP_TEXT = [
  "**Open Incident** — commands (mention the bot, or write in a personal chat):",
  "• `declare <title>` — opens the declaration form",
  "• `update` — post an update on this incident's channel",
  "• `escalate` — page a path on this incident",
  "• `lead @Name` — name the incident lead",
  "• `status` — this incident's card",
  "• `pair <code>` — link this team to an Open Incident workspace (admins)",
  "• `link <code>` — link your Teams account for pages (from the notifications page)",
].join("\n\n");
