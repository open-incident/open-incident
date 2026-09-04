/**
 * Block Kit builders — the words Slack shows. No business logic here: every
 * builder receives what to say and shapes it.
 */

export type IncidentCard = {
  reference: string;
  name: string;
  status: string | null;
  severity: string | null;
  phase: string;
  lead: string | null;
  service: string | null;
  url: string;
  bridgeUrl?: string | null;
  summary?: string | null;
};

const md = (text: string) => ({ type: "section", text: { type: "mrkdwn", text } });
const ctx = (text: string) => ({ type: "context", elements: [{ type: "mrkdwn", text }] });

export function incidentHeaderBlocks(inc: IncidentCard): unknown[] {
  const facts = [
    inc.severity ? `*${inc.severity}*` : null,
    inc.status ? inc.status : inc.phase,
    inc.service ? `\`${inc.service}\`` : null,
    inc.lead ? `lead: ${inc.lead}` : "lead: —",
  ]
    .filter(Boolean)
    .join(" · ");
  const blocks: unknown[] = [
    {
      type: "header",
      text: {
        type: "plain_text",
        text: `${inc.reference} — ${inc.name}`.slice(0, 150),
        emoji: false,
      },
    },
    md(facts),
  ];
  if (inc.summary) blocks.push(md(inc.summary.slice(0, 2800)));
  const actions: unknown[] = [
    {
      type: "button",
      text: { type: "plain_text", text: "Open in Open Incident" },
      url: inc.url,
      action_id: "oi_open",
    },
  ];
  if (inc.bridgeUrl)
    actions.push({
      type: "button",
      text: { type: "plain_text", text: "Join the war room" },
      url: inc.bridgeUrl,
      action_id: "oi_bridge",
      style: "primary",
    });
  blocks.push({ type: "actions", elements: actions });
  blocks.push(
    ctx(
      "`/incident update`, `/incident escalate`, `/incident status` — pin a message with :pushpin: to add it to the timeline.",
    ),
  );
  return blocks;
}

export function incidentUpdateBlocks(u: {
  reference: string;
  by: string;
  status: string | null;
  severity: string | null;
  message: string;
  url: string;
  resolved?: boolean;
}): unknown[] {
  const head = u.resolved
    ? `:white_check_mark: *${u.reference} resolved* — ${u.by}`
    : `:memo: *Update — ${u.status ?? ""}*${u.severity ? ` · ${u.severity}` : ""} — ${u.by}`;
  return [
    md(head),
    md(`> ${u.message.replace(/\n/g, "\n> ").slice(0, 2800)}`),
    ctx(`<${u.url}|${u.reference}>`),
  ];
}

export function announcementBlocks(a: {
  body: string;
  reference: string;
  url: string;
  closed?: boolean;
}): unknown[] {
  return [
    md(a.closed ? `:white_check_mark: ~${a.body}~ — resolved` : `:rotating_light: ${a.body}`),
    ctx(`<${a.url}|${a.reference}>`),
  ];
}

export function escalationDmBlocks(e: {
  subject: string;
  text: string;
  url: string;
  ackToken: string | null;
  ackUrl: string | null;
}): unknown[] {
  const blocks: unknown[] = [md(`:rotating_light: *${e.subject}*\n${e.text}`)];
  const elements: unknown[] = [];
  if (e.ackToken)
    elements.push({
      type: "button",
      text: { type: "plain_text", text: "Acknowledge" },
      style: "primary",
      action_id: "oi_ack",
      value: e.ackToken,
    });
  elements.push({
    type: "button",
    text: { type: "plain_text", text: "Open" },
    url: e.url,
    action_id: "oi_open",
  });
  blocks.push({ type: "actions", elements });
  if (e.ackUrl) blocks.push(ctx(`Or acknowledge from any device: <${e.ackUrl}|one-tap link>`));
  return blocks;
}

export function acknowledgedBlocks(e: { subject: string; by: string }): unknown[] {
  return [md(`:white_check_mark: *${e.subject}*\nAcknowledged by ${e.by}.`)];
}

/** The declare modal: title, severity, service, summary. Option values are ids. */
export function declareModal(opts: {
  title?: string;
  severities: Array<{ id: string; name: string }>;
  services: Array<{ id: string; name: string }>;
  requireService: boolean;
  channelId?: string;
  privateMetadata?: string;
}): unknown {
  const select = (
    id: string,
    placeholder: string,
    options: Array<{ id: string; name: string }>,
    initial?: string,
  ) => ({
    type: "static_select",
    action_id: id,
    placeholder: { type: "plain_text", text: placeholder },
    options: options
      .slice(0, 100)
      .map((o) => ({ text: { type: "plain_text", text: o.name.slice(0, 75) }, value: o.id })),
    ...(initial
      ? {
          initial_option: {
            text: {
              type: "plain_text",
              text: options.find((o) => o.id === initial)?.name.slice(0, 75) ?? initial,
            },
            value: initial,
          },
        }
      : {}),
  });
  return {
    type: "modal",
    callback_id: "oi_declare",
    private_metadata: opts.privateMetadata ?? "",
    title: { type: "plain_text", text: "Declare an incident" },
    submit: { type: "plain_text", text: "Declare" },
    close: { type: "plain_text", text: "Cancel" },
    blocks: [
      {
        type: "input",
        block_id: "title",
        label: { type: "plain_text", text: "Title" },
        element: {
          type: "plain_text_input",
          action_id: "title",
          initial_value: (opts.title ?? "").slice(0, 200),
          placeholder: { type: "plain_text", text: "What is happening?" },
        },
      },
      {
        type: "input",
        block_id: "severity",
        optional: true,
        label: { type: "plain_text", text: "Severity" },
        element: select("severity", "Pick a severity", opts.severities),
      },
      ...(opts.services.length
        ? [
            {
              type: "input",
              block_id: "service",
              optional: !opts.requireService,
              label: { type: "plain_text", text: "Affected service" },
              element: select("service", "Pick a service", opts.services),
            },
          ]
        : []),
      {
        type: "input",
        block_id: "summary",
        optional: true,
        label: { type: "plain_text", text: "Summary" },
        element: { type: "plain_text_input", action_id: "summary", multiline: true },
      },
    ],
  };
}

export function updateModal(opts: {
  reference: string;
  statuses: Array<{ id: string; name: string }>;
  currentStatusId: string | null;
  severities: Array<{ id: string; name: string }>;
  privateMetadata: string;
}): unknown {
  const statusOptions = [
    ...opts.statuses.map((s) => ({ text: { type: "plain_text", text: s.name }, value: s.id })),
    { text: { type: "plain_text", text: "Resolved" }, value: "resolve" },
  ];
  const current = statusOptions.find((o) => o.value === opts.currentStatusId);
  return {
    type: "modal",
    callback_id: "oi_update",
    private_metadata: opts.privateMetadata,
    title: { type: "plain_text", text: `Update ${opts.reference}`.slice(0, 24) },
    submit: { type: "plain_text", text: "Publish" },
    close: { type: "plain_text", text: "Cancel" },
    blocks: [
      {
        type: "input",
        block_id: "status",
        label: { type: "plain_text", text: "Status" },
        element: {
          type: "static_select",
          action_id: "status",
          options: statusOptions,
          ...(current ? { initial_option: current } : {}),
        },
      },
      {
        type: "input",
        block_id: "message",
        label: { type: "plain_text", text: "Message" },
        element: {
          type: "plain_text_input",
          action_id: "message",
          multiline: true,
          placeholder: { type: "plain_text", text: "What changed, what is next" },
        },
      },
      {
        type: "input",
        block_id: "severity",
        optional: true,
        label: { type: "plain_text", text: "Severity" },
        element: {
          type: "static_select",
          action_id: "severity",
          placeholder: { type: "plain_text", text: "Unchanged" },
          options: opts.severities.map((s) => ({
            text: { type: "plain_text", text: s.name },
            value: s.id,
          })),
        },
      },
    ],
  };
}

export function escalateModal(opts: {
  reference: string;
  paths: Array<{ id: string; name: string }>;
  privateMetadata: string;
}): unknown {
  return {
    type: "modal",
    callback_id: "oi_escalate",
    private_metadata: opts.privateMetadata,
    title: { type: "plain_text", text: `Escalate ${opts.reference}`.slice(0, 24) },
    submit: { type: "plain_text", text: "Page them" },
    close: { type: "plain_text", text: "Cancel" },
    blocks: [
      {
        type: "input",
        block_id: "path",
        label: { type: "plain_text", text: "Escalation path" },
        element: {
          type: "static_select",
          action_id: "path",
          options: opts.paths.map((p) => ({
            text: { type: "plain_text", text: p.name.slice(0, 75) },
            value: p.id,
          })),
        },
      },
      ctx(
        "Confirming pages the people on the path right now, following their own notification rules.",
      ),
    ],
  };
}

/** Reads a view_submission's values into a flat map { block_id: value }. */
export function readViewValues(
  state:
    | {
        values?: Record<
          string,
          Record<string, { value?: string | null; selected_option?: { value: string } | null }>
        >;
      }
    | undefined,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [block, actions] of Object.entries(state?.values ?? {})) {
    for (const a of Object.values(actions)) {
      const v = a.selected_option?.value ?? a.value ?? "";
      if (v) out[block] = v;
    }
  }
  return out;
}

export const HELP_TEXT = [
  "*Open Incident* — commands:",
  "`/incident declare [title]` — declare an incident (opens a form)",
  "`/incident update [message]` — publish a status update on this incident's channel",
  "`/incident escalate` — page the on-call through an escalation path",
  "`/incident lead @user` — assign the incident lead",
  "`/incident status` — where the incident stands",
  "React with :pushpin: to add a message to the timeline, :white_check_mark: to turn it into a follow-up.",
].join("\n");
