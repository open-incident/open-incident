# @openincident/mcp

A [Model Context Protocol](https://modelcontextprotocol.io) server for an Open
Incident workspace. Point Claude, or any MCP client, at one and it can say who
is on call, read what is firing, pull up a service's health, find the runbook,
and — when you ask it to — declare an incident or publish an update.

## It speaks to the REST API, never to the database

That is the whole design. The assistant inherits the API key's scopes, its rate
limit and its workspace isolation, and it cannot reach round the escalation
rules. Anything it can do, a person could have done with `curl` and the same
key. The same server works against the hosted product and a self-hosted
instance, with nothing but a URL and a key.

## Running it

```bash
OI_BASE_URL=https://skylark.open-incident.com \
OI_API_KEY=oi_live_… \
  pnpm --filter @openincident/mcp run start
```

In a client config:

```json
{
  "mcpServers": {
    "open-incident": {
      "command": "pnpm",
      "args": ["--filter", "@openincident/mcp", "run", "start"],
      "cwd": "/path/to/open-incident",
      "env": {
        "OI_BASE_URL": "https://skylark.open-incident.com",
        "OI_API_KEY": "oi_live_…"
      }
    }
  }
}
```

Give it a **read-only key** unless you actually want an assistant declaring
incidents. Scope is chosen when you mint the key, and a read key turns every
mistake into a `403`.

## The twelve tools

Chosen for what somebody does during an incident rather than one per endpoint:
a faithful mirror of twenty-eight routes would be twenty-eight choices an
assistant makes badly. The two most useful — `who_is_on_call` and
`get_service_health` — do not correspond to a single route at all.

### Reading

| Tool                 | What it does                                                                                        |
| -------------------- | --------------------------------------------------------------------------------------------------- |
| `who_is_on_call`     | Who would be woken right now, per schedule, with when the shift ends and whether they are covering. |
| `search_incidents`   | Incidents by phase, newest activity first.                                                          |
| `get_incident`       | One incident, its whole timeline and every published update.                                        |
| `search_alerts`      | The raw alerts — not incidents — with how many times each repeated.                                 |
| `get_alert`          | One alert with the payload its sender actually sent.                                                |
| `get_service_health` | One service from every angle at once: monitors, heartbeats, SLOs, recent alerts, open incidents.    |
| `search_runbooks`    | What somebody wrote down, with the text.                                                            |
| `list_workspace`     | Services, teams, members, schedules or escalation policies.                                         |

### Writing

| Tool                   | What it reaches                                                                                                                                        |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `declare_incident`     | **Real people.** Rules run, the escalation path fires, whoever is on call is contacted. `mode: "test"` exercises the machinery without waking anybody. |
| `post_incident_update` | **Possibly customers.** If the incident is on a status page, the message is published and subscribers are emailed.                                     |
| `add_follow_up`        | Nobody. The right home for "we should probably…".                                                                                                      |
| `record_change_event`  | Nobody. Worth doing generously — "what changed" is the first question of every incident.                                                               |

## What it will not do

- **It cannot change who gets woken up.** The API can create a schedule
  override; this deliberately does not expose it. Rearranging who is called at
  3 a.m. is a decision with a person on the other end of it, and it should be
  taken by someone who will still be awake to answer for it.
- **It cannot configure the workspace.** Escalation policies, schedules and
  monitors are readable so an assistant can reason about them, and are changed
  by a human who can see the consequences.
- **It cannot delete anything.** No tool maps to `DELETE`.
- **It cannot see another workspace.** The key carries one, and only one.

## Using it well

The pattern that works:

> Something is wrong with checkout. Get its health, find any runbook we have,
> and tell me who is on call — then draft what you would put in an update, but
> do not post it.

The assistant gathers, drafts, and you send it or you do not. Asking it to
declare straight away skips the one step where a mistake is still cheap.
