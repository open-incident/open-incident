/**
 * An Opsgenie account that lives in memory — Skylark's, the one the demo
 * workspace migrates from. It answers the REST API v2 the way Opsgenie does:
 * EU and US regions, `GenieKey` authentication, a key without Configuration
 * Access refused with 403, a team key that only sees its own team, 429s now
 * and then, offset pagination by 100 and the 20 000-alert search ceiling.
 *
 * Three callers: the demo seed (through `fetch`, in process), the smoke
 * suite's mock server (packages/smoke/src/opsgenie-mock.ts) and the unit
 * tests. Everything is computed from `now`, so the schedules always have a
 * future and the history always ends today.
 */
import { computeTimeline, serialiseTimeline } from "./og-timeline";
import type {
  OgAlert,
  OgEscalation,
  OgHeartbeat,
  OgIntegration,
  OgNotificationRule,
  OgOverride,
  OgPolicy,
  OgRoutingRule,
  OgSchedule,
  OgTeam,
  OgUser,
  Region,
} from "./types";
import { partsOf, plusLocalDays, wallClock } from "./zone";

/** The keys the account knows. */
export const DEMO_KEYS = {
  /** Account-level, Read + Configuration Access: the one to use. */
  global: "5f0c2a8e-4d1b-4c3a-9e7f-2b6d8a1c0e94",
  /** Account-level, Read only: users, schedules and policies answer 403. */
  readOnly: "9b7e3c21-0f4a-4e8d-b6c5-1a2d3e4f5a6b",
  /** The API integration key of the Platform team: sees one team. */
  team: "c4d5e6f7-8a9b-4c0d-9e1f-2a3b4c5d6e7f",
} as const;

export const DEMO_REGION: Region = "eu";
export const DEMO_ACCOUNT_NAME = "skylark";
const TZ = "Europe/Paris";
const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

/** A UUID-shaped id that is the same at every run. */
export function stableId(seed: string): string {
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < seed.length; i++) {
    h1 = Math.imul(h1 ^ seed.charCodeAt(i), 0x01000193) >>> 0;
    h2 = Math.imul(h2 ^ seed.charCodeAt(i), 0x5bd1e995) >>> 0;
  }
  const hex = (n: number) => n.toString(16).padStart(8, "0");
  const a = hex(h1);
  const b = hex(h2);
  const c = hex(Math.imul(h1 ^ h2, 0x27d4eb2d) >>> 0);
  const d = hex(Math.imul(h2 + 0x9e3779b9, h1 | 1) >>> 0);
  return `${a}-${b.slice(0, 4)}-4${b.slice(5, 8)}-a${c.slice(1, 4)}-${c.slice(4)}${d}`;
}

/** A deterministic number in [0, 1) for an integer. */
function unit(i: number, salt = 0): number {
  let x = (i + 1) * 2654435761 + salt * 40503;
  x = Math.imul(x ^ (x >>> 16), 0x45d9f3b);
  x = Math.imul(x ^ (x >>> 16), 0x45d9f3b);
  x = x ^ (x >>> 16);
  return (x >>> 0) / 4294967296;
}

type Person = { key: string; fullName: string; username: string; role: string; blocked?: boolean };

const PEOPLE: Person[] = [
  { key: "amelie", fullName: "Amélie Laurent", username: "amelie@skylark.dev", role: "Owner" },
  { key: "karim", fullName: "Karim Haddad", username: "karim@skylark.dev", role: "Admin" },
  { key: "nadia", fullName: "Nadia Benali", username: "nadia@skylark.dev", role: "User" },
  { key: "lucas", fullName: "Lucas Girard", username: "lucas.girard@skylark.dev", role: "User" },
  { key: "thomas", fullName: "Thomas Moreau", username: "thomas@skylark.dev", role: "User" },
  { key: "claire", fullName: "Claire Dubois", username: "claire@skylark.dev", role: "User" },
  { key: "ana", fullName: "Ana Costa", username: "ana@skylark.dev", role: "User", blocked: true },
  { key: "sam", fullName: "Sam Okafor", username: "sam@partner.eu", role: "User" },
];

const TEAMS: Array<{ key: string; name: string; members: string[]; admin: string }> = [
  {
    key: "platform",
    name: "Platform",
    members: ["amelie", "karim", "thomas", "lucas", "claire"],
    admin: "amelie",
  },
  {
    key: "payments",
    name: "Payments",
    members: ["nadia", "lucas", "ana", "karim"],
    admin: "nadia",
  },
  {
    key: "storefront",
    name: "Storefront",
    members: ["thomas", "amelie", "claire"],
    admin: "thomas",
  },
  { key: "security", name: "Security", members: ["karim", "nadia"], admin: "karim" },
];

type IntegrationSpec = {
  key: string;
  name: string;
  type: string;
  team: string;
  /** How long ago its last alert came; null: never. */
  lastAgoMs: number | null;
  weight: number;
  titles: string[];
  tags: string[];
};

const INTEGRATIONS: IntegrationSpec[] = [
  {
    key: "datadog",
    name: "Datadog — production",
    type: "Datadog",
    team: "platform",
    lastAgoMs: 2 * MIN,
    weight: 30,
    titles: ["api-gateway p99 > 800 ms", "CPU > 90% on k8s node", "5xx rate > 2% on edge"],
    tags: ["service:api-gateway", "env:production"],
  },
  {
    key: "alertmanager",
    name: "Alertmanager — k8s-eu",
    type: "Prometheus",
    team: "platform",
    lastAgoMs: 14 * MIN,
    weight: 25,
    titles: ["KubePodCrashLooping", "NodeDiskPressure", "etcd leader changes"],
    tags: ["service:k8s-eu", "env:production", "batch"],
  },
  {
    key: "grafana",
    name: "Grafana — payments",
    type: "Grafana",
    team: "payments",
    lastAgoMs: HOUR,
    weight: 12,
    titles: ["payments-worker queue depth > 10k", "settlement lag > 5 min"],
    tags: ["service:payments-worker", "env:production"],
  },
  {
    key: "sentry",
    name: "Sentry — checkout",
    type: "Sentry",
    team: "storefront",
    lastAgoMs: 3 * HOUR,
    weight: 12,
    titles: ["checkout p99 > 2 s", "TypeError in CartSummary", "Deprecated API call from checkout"],
    tags: ["service:checkout", "checkout", "env:production"],
  },
  {
    key: "cloudwatch",
    name: "CloudWatch — billing",
    type: "AmazonCloudWatch",
    team: "payments",
    lastAgoMs: 26 * HOUR,
    weight: 8,
    titles: ["billing-db CPUUtilization > 80", "billing Lambda errors"],
    tags: ["service:billing", "env:production"],
  },
  {
    key: "api",
    name: "API — deploy-bot",
    type: "API",
    team: "platform",
    lastAgoMs: 2 * DAY,
    weight: 5,
    titles: ["Deploy failed on main", "Rollback triggered"],
    tags: ["service:deploy-bot"],
  },
  {
    key: "email",
    name: "Email — nightly-backup@",
    type: "Email",
    team: "platform",
    lastAgoMs: 47 * DAY,
    weight: 2,
    titles: ["Nightly backup failed"],
    tags: ["service:backup"],
  },
  {
    key: "uptime",
    name: "Uptime Kuma — status",
    type: "Webhook",
    team: "platform",
    lastAgoMs: 12 * DAY,
    weight: 3,
    titles: ["status.skylark.dev is down"],
    tags: ["service:status-page"],
  },
  {
    key: "newrelic",
    name: "New Relic — legacy",
    type: "NewRelic",
    team: "storefront",
    lastAgoMs: 214 * DAY,
    weight: 3,
    titles: ["Apdex < 0.7 on legacy-shop"],
    tags: ["service:legacy-shop"],
  },
  {
    key: "zabbix",
    name: "Zabbix — dc-paris",
    type: "Zabbix",
    team: "platform",
    lastAgoMs: null,
    weight: 0,
    titles: ["Host unreachable"],
    tags: [],
  },
];

const PRIORITIES: Array<[OgAlert["priority"], number]> = [
  ["P1", 0.015],
  ["P2", 0.08],
  ["P3", 0.4],
  ["P4", 0.38],
  ["P5", 0.125],
];

export type DemoAccountOptions = {
  now?: Date;
  /** Alerts in the history (default 41 238). */
  alerts?: number;
  /** Answer 429 to one request in this many (0: never). */
  throttleEvery?: number;
  /** Seconds announced in Retry-After on a 429. */
  retryAfter?: number;
};

export type DemoCall = {
  method: string;
  region: string;
  path: string;
  key: string;
  status: number;
};

type Reply = { status: number; headers?: Record<string, string>; body: unknown };

export type DemoAccount = ReturnType<typeof createDemoAccount>;

export function createDemoAccount(options: DemoAccountOptions = {}) {
  const now = options.now ?? new Date();
  const nAlerts = options.alerts ?? 41_238;
  const throttleEvery = options.throttleEvery ?? 0;
  const calls: DemoCall[] = [];
  let served = 0;

  const id = (kind: string, key: string) => stableId(`${kind}:${key}`);
  const users: OgUser[] = PEOPLE.map((p) => ({
    id: id("user", p.key),
    username: p.username,
    fullName: p.fullName,
    role: { name: p.role },
    blocked: Boolean(p.blocked),
    verified: true,
    timeZone: TZ,
    locale: "en_GB",
    createdAt: "2023-03-01T09:00:00Z",
  }));
  const userId = (k: string) => id("user", k);
  const usersById = new Map(users.map((u) => [u.id, u]));
  const teamId = (k: string) => id("team", k);
  const teams: OgTeam[] = TEAMS.map((t) => ({
    id: teamId(t.key),
    name: t.name,
    description: `${t.name} engineering`,
    members: t.members.map((m) => ({
      user: { id: userId(m), username: PEOPLE.find((p) => p.key === m)!.username },
      role: m === t.admin ? "admin" : "user",
    })),
  }));

  // Rotations hand over on Mondays at 09:00, Paris time, for twelve weeks already.
  const p = partsOf(now, TZ);
  const thisMonday = plusLocalDays(
    wallClock(p.year, p.month, p.day, 9, 0, TZ),
    -(p.weekday - 1),
    TZ,
  );
  const anchor = plusLocalDays(thisMonday, -84, TZ);
  const anchorSaturday = plusLocalDays(wallClock(...ymd(anchor), 10, 0, TZ), 5, TZ);
  const iso = (d: Date) => d.toISOString();
  const user = (k: string) => ({
    type: "user" as const,
    id: userId(k),
    username: PEOPLE.find((x) => x.key === k)!.username,
  });
  const schedId = (k: string) => id("schedule", k);
  const rotId = (k: string) => id("rotation", k);
  const weekdays = ["monday", "tuesday", "wednesday", "thursday", "friday"] as const;

  const schedules: OgSchedule[] = [
    {
      id: schedId("platform"),
      name: "Platform primary",
      timezone: TZ,
      enabled: true,
      ownerTeam: { id: teamId("platform"), name: "Platform" },
      rotations: [
        {
          id: rotId("platform-day"),
          name: "Day",
          startDate: iso(anchor),
          type: "weekly",
          length: 1,
          participants: [user("amelie"), user("karim"), user("thomas")],
          timeRestriction: {
            type: "time-of-day",
            restriction: { startHour: 8, startMin: 0, endHour: 20, endMin: 0 },
          },
        },
        {
          id: rotId("platform-night"),
          name: "Night",
          startDate: iso(anchor),
          type: "weekly",
          length: 1,
          participants: [user("lucas"), user("karim")],
          timeRestriction: {
            type: "time-of-day",
            restriction: { startHour: 20, startMin: 0, endHour: 8, endMin: 0 },
          },
        },
      ],
    },
    {
      id: schedId("payments"),
      name: "Payments primary",
      timezone: TZ,
      enabled: true,
      ownerTeam: { id: teamId("payments"), name: "Payments" },
      rotations: [
        {
          id: rotId("payments-base"),
          name: "Base",
          startDate: iso(anchor),
          type: "weekly",
          length: 1,
          participants: [user("nadia"), user("lucas"), user("ana"), user("karim")],
        },
        {
          id: rotId("payments-weekend"),
          name: "Weekend",
          startDate: iso(anchor),
          type: "weekly",
          length: 1,
          participants: [user("karim"), user("nadia")],
          timeRestriction: {
            type: "weekday-and-time-of-day",
            restrictions: [
              {
                startDay: "saturday",
                startHour: 0,
                startMin: 0,
                endDay: "monday",
                endHour: 0,
                endMin: 0,
              },
            ],
          },
        },
      ],
    },
    {
      id: schedId("storefront"),
      name: "Storefront",
      timezone: TZ,
      enabled: true,
      ownerTeam: { id: teamId("storefront"), name: "Storefront" },
      rotations: [
        {
          id: rotId("storefront-weekly"),
          name: "Weekly",
          startDate: iso(anchor),
          type: "weekly",
          length: 1,
          participants: [user("thomas"), user("amelie")],
        },
      ],
    },
    {
      id: schedId("weekend"),
      name: "Weekend support",
      timezone: TZ,
      enabled: true,
      ownerTeam: { id: teamId("platform"), name: "Platform" },
      rotations: [
        {
          id: rotId("weekend-support"),
          name: "Weekend",
          startDate: iso(anchorSaturday),
          type: "weekly",
          length: 1,
          participants: [user("karim"), user("sam"), user("thomas")],
          timeRestriction: {
            type: "weekday-and-time-of-day",
            restrictions: (["saturday", "sunday"] as const).map((d) => ({
              startDay: d,
              startHour: 10,
              startMin: 0,
              endDay: d,
              endHour: 16,
              endMin: 0,
            })),
          },
        },
      ],
    },
    {
      id: schedId("security"),
      name: "Security",
      timezone: TZ,
      enabled: true,
      ownerTeam: { id: teamId("security"), name: "Security" },
      rotations: [
        {
          id: rotId("security-hours"),
          name: "Business hours",
          startDate: iso(anchor),
          type: "weekly",
          length: 1,
          participants: [user("karim"), user("nadia")],
          timeRestriction: {
            type: "weekday-and-time-of-day",
            restrictions: weekdays.map((d) => ({
              startDay: d,
              startHour: 9,
              startMin: 0,
              endDay: d,
              endHour: 18,
              endMin: 0,
            })),
          },
        },
      ],
    },
  ];

  // One override already in place: Lucas takes a Saturday of the Weekend layer.
  const nextSaturday = plusLocalDays(thisMonday, 5 + 7, TZ);
  const overrides = new Map<string, OgOverride[]>([
    [
      schedId("payments"),
      [
        {
          alias: "lucas-saturday",
          user: user("lucas"),
          startDate: iso(wallClock(...ymd(nextSaturday), 9, 0, TZ)),
          endDate: iso(wallClock(...ymd(nextSaturday), 21, 0, TZ)),
          rotations: [{ id: rotId("payments-weekend"), name: "Weekend" }],
        },
      ],
    ],
  ]);

  const escId = (k: string) => id("escalation", k);
  const sched = (k: string) => ({
    type: "schedule" as const,
    id: schedId(k),
    name: schedules.find((s) => s.id === schedId(k))!.name,
  });
  const team = (k: string) => ({
    type: "team" as const,
    id: teamId(k),
    name: TEAMS.find((t) => t.key === k)!.name,
  });
  const rule = (
    delay: number,
    recipient: OgEscalation["rules"][number]["recipient"],
    notifyType: OgEscalation["rules"][number]["notifyType"] = "default",
  ): OgEscalation["rules"][number] => ({
    condition: "if-not-acked",
    notifyType,
    delay: { timeAmount: delay, timeUnit: "minutes" },
    recipient,
  });
  const escalations: OgEscalation[] = [
    {
      id: escId("platform"),
      name: "Platform primary",
      ownerTeam: { id: teamId("platform"), name: "Platform" },
      rules: [
        rule(0, sched("platform")),
        rule(10, sched("platform"), "next"),
        rule(25, team("platform"), "all"),
      ],
    },
    {
      id: escId("platform-weekend"),
      name: "Platform weekend",
      ownerTeam: { id: teamId("platform"), name: "Platform" },
      rules: [rule(0, sched("weekend")), rule(15, sched("platform"))],
    },
    {
      id: escId("payments"),
      name: "Payments escalation",
      ownerTeam: { id: teamId("payments"), name: "Payments" },
      rules: [rule(0, sched("payments")), rule(10, user("nadia"))],
      repeat: { waitInterval: 10, count: 2, resetRecipientStates: true, closeAlertAfterAll: false },
    },
    {
      id: escId("payments-p1"),
      name: "Payments P1",
      ownerTeam: { id: teamId("payments"), name: "Payments" },
      rules: [rule(0, sched("payments")), rule(0, user("karim")), rule(5, team("payments"), "all")],
    },
    {
      id: escId("storefront"),
      name: "Storefront escalation",
      ownerTeam: { id: teamId("storefront"), name: "Storefront" },
      rules: [rule(0, sched("storefront")), rule(20, team("storefront"), "all")],
    },
    {
      id: escId("security"),
      name: "Security escalation",
      ownerTeam: { id: teamId("security"), name: "Security" },
      rules: [rule(0, sched("security")), rule(30, user("karim"))],
    },
  ];

  const esc = (k: string) => ({
    type: "escalation" as const,
    id: escId(k),
    name: escalations.find((e) => e.id === escId(k))!.name,
  });
  const routing = new Map<string, OgRoutingRule[]>([
    [
      teamId("platform"),
      [
        {
          id: id("rule", "platform-staging"),
          name: "Staging noise",
          order: 0,
          criteria: {
            type: "match-all-conditions",
            conditions: [{ field: "tags", operation: "contains", expectedValue: "env:staging" }],
          },
          notify: { type: "none" },
        },
        {
          id: id("rule", "platform-batch"),
          name: "Weekend batch",
          order: 1,
          criteria: {
            type: "match-all-conditions",
            conditions: [{ field: "tags", operation: "contains", expectedValue: "batch" }],
          },
          notify: esc("platform-weekend"),
        },
        {
          id: id("rule", "platform-default"),
          name: "Default",
          isDefault: true,
          order: 2,
          criteria: { type: "match-all" },
          notify: esc("platform"),
        },
      ],
    ],
    [
      teamId("payments"),
      [
        {
          id: id("rule", "payments-p1"),
          name: "P1 payments",
          order: 0,
          criteria: {
            type: "match-all-conditions",
            conditions: [{ field: "priority", operation: "equals", expectedValue: "P1" }],
          },
          notify: esc("payments-p1"),
        },
        {
          id: id("rule", "payments-cron"),
          name: "Billing cron",
          order: 1,
          criteria: {
            type: "match-all-conditions",
            conditions: [{ field: "source", operation: "equals", expectedValue: "Heartbeat" }],
          },
          notify: esc("payments"),
        },
        {
          id: id("rule", "payments-default"),
          name: "Default",
          isDefault: true,
          order: 2,
          criteria: { type: "match-all" },
          notify: esc("payments"),
        },
      ],
    ],
    [
      teamId("storefront"),
      [
        {
          id: id("rule", "storefront-checkout-night"),
          name: "Checkout P3 at night",
          order: 0,
          criteria: {
            type: "match-all-conditions",
            conditions: [
              { field: "tags", operation: "contains", expectedValue: "checkout" },
              { field: "priority", operation: "equals", expectedValue: "P3" },
            ],
          },
          timezone: TZ,
          timeRestriction: {
            type: "time-of-day",
            restriction: { startHour: 20, startMin: 0, endHour: 8, endMin: 0 },
          },
          notify: { type: "none" },
        },
        {
          id: id("rule", "storefront-deprecation"),
          name: "Deprecation warnings",
          order: 1,
          criteria: {
            type: "match-all-conditions",
            conditions: [{ field: "message", operation: "contains", expectedValue: "Deprecated" }],
          },
          notify: { type: "none" },
        },
        {
          id: id("rule", "storefront-default"),
          name: "Default",
          isDefault: true,
          order: 2,
          criteria: { type: "match-all" },
          notify: esc("storefront"),
        },
      ],
    ],
    [
      teamId("security"),
      [
        {
          id: id("rule", "security-p1"),
          name: "Security P1",
          order: 0,
          criteria: {
            type: "match-all-conditions",
            conditions: [{ field: "priority", operation: "equals", expectedValue: "P1" }],
          },
          notify: { type: "schedule", id: schedId("security"), name: "Security" },
        },
        {
          id: id("rule", "security-default"),
          name: "Default",
          isDefault: true,
          order: 1,
          criteria: { type: "match-all" },
          notify: esc("security"),
        },
      ],
    ],
  ]);

  const integrations: OgIntegration[] = INTEGRATIONS.map((x) => ({
    id: id("integration", x.key),
    name: x.name,
    enabled: true,
    type: x.type,
    teamId: teamId(x.team),
  }));

  const heartbeats: OgHeartbeat[] = [
    {
      name: "billing-cron",
      description: "Billing run, every 15 minutes",
      interval: 15,
      intervalUnit: "minutes",
      enabled: true,
      expired: false,
      ownerTeam: { id: teamId("payments"), name: "Payments" },
      alertMessage: "billing-cron stopped pinging",
      alertPriority: "P2",
    },
    {
      name: "nightly-backup",
      description: "Nightly database backup",
      interval: 1,
      intervalUnit: "days",
      enabled: true,
      expired: false,
      ownerTeam: { id: teamId("platform"), name: "Platform" },
      alertMessage: "nightly-backup did not report",
      alertPriority: "P3",
    },
  ];

  const policies: OgPolicy[] = [
    {
      id: id("policy", "tag-prod"),
      name: "Tag production",
      type: "alert",
      enabled: true,
      order: 0,
    },
    {
      id: id("policy", "staging"),
      name: "Suppress staging",
      type: "notification",
      enabled: true,
      order: 0,
      teamId: teamId("platform"),
    },
  ];

  const notificationRules: OgNotificationRule[] = [
    { id: "", name: "New alert", actionType: "create-alert", enabled: true, order: 0 },
    { id: "", name: "Schedule start", actionType: "schedule-start", enabled: true, order: 1 },
  ];

  /* ---------- The alert history, computed from the index ---------- */

  const historyStart = new Date(Date.UTC(2025, 0, 6, 7, 0, 0));
  const span = now.getTime() - historyStart.getTime();
  type Slim = { t: number; i: number; integ: number };
  const slim: Slim[] = [];
  const alive = INTEGRATIONS.map((x) =>
    x.lastAgoMs === null ? -Infinity : now.getTime() - x.lastAgoMs,
  );
  const tails = INTEGRATIONS.map((x, k) => ({ x, k })).filter(({ x }) => x.lastAgoMs !== null);
  const base = Math.max(0, nAlerts - tails.length);
  for (let i = 0; i < base; i++) {
    const t = historyStart.getTime() + ((i + unit(i, 1)) / Math.max(1, base)) * (span - DAY);
    const candidates = INTEGRATIONS.map((x, k) => ({ x, k })).filter(
      ({ x, k }) => x.weight > 0 && alive[k]! >= t,
    );
    const total = candidates.reduce((n, c) => n + c.x.weight, 0);
    let pick = unit(i, 2) * total;
    let chosen = candidates[0]!.k;
    for (const c of candidates) {
      pick -= c.x.weight;
      if (pick <= 0) {
        chosen = c.k;
        break;
      }
    }
    slim.push({ t: Math.floor(t), i, integ: chosen });
  }
  tails.forEach(({ k }, n) => slim.push({ t: alive[k]!, i: base + n, integ: k }));
  slim.sort((a, b) => a.t - b.t);

  const priorityOf = (i: number): OgAlert["priority"] => {
    let u = unit(i, 3);
    for (const [prio, share] of PRIORITIES) {
      if (u < share) return prio;
      u -= share;
    }
    return "P4";
  };

  function alertOf(s: Slim, detailed: boolean): OgAlert {
    const spec = INTEGRATIONS[s.integ]!;
    const t = TEAMS.find((x) => x.key === spec.team)!;
    const message = spec.titles[Math.floor(unit(s.i, 4) * spec.titles.length)]!;
    const ackMs = (1 + Math.floor(unit(s.i, 5) * 20)) * MIN;
    const closeMs = ackMs + (5 + Math.floor(unit(s.i, 6) * 180)) * MIN;
    const open = now.getTime() - s.t < closeMs;
    const responders = t.members.filter((m) => !PEOPLE.find((x) => x.key === m)?.blocked);
    const acker = PEOPLE.find((x) => x.key === responders[s.i % responders.length])!;
    const priority = priorityOf(s.i);
    const createdAt = new Date(s.t).toISOString();
    const a: OgAlert = {
      id: stableId(`alert:${s.i}`),
      tinyId: String(s.i + 1),
      alias: `${spec.key}-${s.i}`,
      message,
      status: open ? "open" : "closed",
      acknowledged: !open || now.getTime() - s.t > ackMs,
      tags: spec.tags,
      count: 1 + Math.floor(unit(s.i, 7) * 3),
      createdAt,
      updatedAt: new Date(s.t + (open ? 0 : closeMs)).toISOString(),
      lastOccurredAt: createdAt,
      source: spec.name,
      owner: acker.username,
      priority,
      teams: [{ id: teamId(t.key) }],
      responders: [{ type: "team", id: teamId(t.key) }],
      integration: { id: id("integration", spec.key), name: spec.name, type: spec.type },
      report: open
        ? {}
        : {
            ackTime: ackMs,
            closeTime: closeMs,
            acknowledgedBy: acker.username,
            closedBy: acker.username,
          },
    };
    if (detailed) {
      const service = spec.tags.find((x) => x.startsWith("service:"))?.slice(8);
      a.entity = service;
      a.description = `${message} — raised by ${spec.name}.`;
      a.details = { ...(service ? { service } : {}), environment: "production" };
    }
    return a;
  }

  /** The alerts matching an Opsgenie search, oldest first. */
  function search(query: string): Slim[] {
    let from = -Infinity;
    let to = Infinity;
    let prio: string | null = null;
    let integ: string | null = null;
    let teamFilter: string | null = null;
    for (const raw of query.split(/\s+AND\s+/i)) {
      const term = raw.trim();
      let m = term.match(/^createdAt\s*>=\s*(\d+)$/);
      if (m) from = Math.max(from, Number(m[1]));
      m = term.match(/^createdAt\s*>\s*(\d+)$/);
      if (m) from = Math.max(from, Number(m[1]) + 1);
      m = term.match(/^createdAt\s*<\s*(\d+)$/);
      if (m) to = Math.min(to, Number(m[1]));
      m = term.match(/^priority\s*:\s*(P[1-5])$/i);
      if (m) prio = m[1]!.toUpperCase();
      m = term.match(/^integration\.id\s*:\s*"?([\w-]+)"?$/);
      if (m) integ = m[1]!;
      m = term.match(/^teams\s*:\s*"?([\w-]+)"?$/);
      if (m) teamFilter = m[1]!;
    }
    return slim.filter((s) => {
      if (s.t < from || s.t >= to) return false;
      const spec = INTEGRATIONS[s.integ]!;
      if (integ && id("integration", spec.key) !== integ) return false;
      if (teamFilter && teamId(spec.team) !== teamFilter) return false;
      if (prio && priorityOf(s.i) !== prio) return false;
      return true;
    });
  }

  /* ---------- Keys and scope ---------- */

  type Scope = { level: "account" | "team"; config: boolean; team?: string };
  const SCOPES: Record<string, Scope> = {
    [DEMO_KEYS.global]: { level: "account", config: true },
    [DEMO_KEYS.readOnly]: { level: "account", config: false },
    [DEMO_KEYS.team]: { level: "team", config: true, team: teamId("platform") },
  };

  const forbiddenConfig = {
    status: 403,
    body: {
      message:
        "You do not have the permission to perform this action. The API key needs Configuration Access.",
    },
  };

  function handle(method: string, url: URL, authorization: string | null): Reply {
    const region =
      url.hostname === "api.opsgenie.com"
        ? "us"
        : url.hostname === "api.eu.opsgenie.com"
          ? "eu"
          : (url.pathname.split("/")[1] ?? "");
    const path = url.hostname.endsWith("opsgenie.com")
      ? url.pathname
      : url.pathname.replace(/^\/(eu|us)/, "");
    const key = (authorization ?? "").replace(/^GenieKey\s+/i, "").trim();
    const reply = (r: Reply): Reply => {
      calls.push({ method, region, path, key: key.slice(0, 8), status: r.status });
      return r;
    };
    served += 1;
    if (method !== "GET")
      return reply({ status: 405, body: { message: "The migration only reads." } });
    if (throttleEvery > 0 && served % throttleEvery === 0)
      return reply({
        status: 429,
        headers: {
          "retry-after": String(options.retryAfter ?? 1),
          "x-ratelimit-state": "THROTTLED",
          "x-ratelimit-reason": "ACCOUNT",
          "x-ratelimit-period-in-sec": "60",
        },
        body: {
          message: "You are making too many requests! To avoid errors, throttle your requests.",
        },
      });
    if (!key) return reply({ status: 401, body: { message: "Could not authenticate" } });
    const scope = SCOPES[key];
    // The account lives in the EU: its keys mean nothing to the US region.
    if (!scope || region !== DEMO_REGION)
      return reply({ status: 401, body: { message: "Could not authenticate" } });
    const out = route(path, url.searchParams, scope);
    return reply(out);
  }

  const ok = (data: unknown, extra: Record<string, unknown> = {}): Reply => ({
    status: 200,
    body: { data, took: 0.01, requestId: stableId(`req:${served}`), ...extra },
  });
  const page = <T>(all: T[], q: URLSearchParams): Reply => {
    const limit = Math.min(100, Number(q.get("limit") ?? 20) || 20);
    const offset = Number(q.get("offset") ?? 0) || 0;
    const items = all.slice(offset, offset + limit);
    return ok(items, {
      totalCount: all.length,
      paging: {
        first: `?offset=0&limit=${limit}`,
        ...(offset + limit < all.length
          ? { next: `?offset=${offset + limit}&limit=${limit}` }
          : {}),
      },
    });
  };

  function route(path: string, q: URLSearchParams, scope: Scope): Reply {
    const inScope = (team?: string | null) => scope.level === "account" || team === scope.team;
    if (path === "/v2/account") {
      if (scope.level !== "account")
        return {
          status: 403,
          body: { message: "Account information needs an account-level API key." },
        };
      return ok({ name: DEMO_ACCOUNT_NAME, userCount: users.length, plan: { name: "Enterprise" } });
    }
    if (path === "/v2/alerts/count")
      return ok({ count: visibleAlerts(q.get("query") ?? "", scope).length });
    if (path === "/v2/alerts") {
      const limit = Math.min(100, Number(q.get("limit") ?? 20) || 20);
      const offset = Number(q.get("offset") ?? 0) || 0;
      if (offset + limit > 20_000)
        return { status: 422, body: { message: "offset + limit can not be bigger than 20000" } };
      let hits = visibleAlerts(q.get("query") ?? "", scope);
      if ((q.get("order") ?? "desc") === "desc") hits = hits.slice().reverse();
      return ok(
        hits.slice(offset, offset + limit).map((s) => alertOf(s, false)),
        {
          paging: offset + limit < hits.length ? { next: `?offset=${offset + limit}` } : {},
        },
      );
    }
    let m = path.match(/^\/v2\/alerts\/([^/]+)$/);
    if (m) {
      const hit = slim.find((s) => stableId(`alert:${s.i}`) === m![1]);
      if (!hit || !inScope(teamId(INTEGRATIONS[hit.integ]!.team)))
        return { status: 404, body: { message: "Alert does not exist" } };
      return ok(alertOf(hit, true));
    }
    // Everything below is configuration.
    if (!scope.config) return forbiddenConfig;
    if (path === "/v2/users") {
      const visible =
        scope.level === "account"
          ? users
          : users.filter((u) =>
              teams.find((t) => t.id === scope.team)?.members?.some((x) => x.user.id === u.id),
            );
      return page(visible, q);
    }
    m = path.match(/^\/v2\/users\/([^/]+)\/notification-rules$/);
    if (m) {
      if (!usersById.has(m[1]!)) return { status: 404, body: { message: "User not found" } };
      return ok(notificationRules.map((r, i) => ({ ...r, id: stableId(`nr:${m![1]}:${i}`) })));
    }
    if (path === "/v2/teams")
      return ok(
        teams
          .filter((t) => inScope(t.id))
          .map(({ id, name, description }) => ({ id, name, description })),
      );
    m = path.match(/^\/v2\/teams\/([^/]+)$/);
    if (m) {
      const t = teams.find((x) => x.id === m![1] || x.name === m![1]);
      if (!t || !inScope(t.id)) return { status: 404, body: { message: "No team exists with id" } };
      return ok(t);
    }
    m = path.match(/^\/v2\/teams\/([^/]+)\/routing-rules$/);
    if (m) {
      if (!inScope(m[1])) return { status: 404, body: { message: "No team exists with id" } };
      return ok(routing.get(m[1]!) ?? []);
    }
    if (path === "/v2/schedules") {
      const expand = (q.get("expand") ?? "").includes("rotation");
      return ok(
        schedules
          .filter((s) => inScope(s.ownerTeam?.id))
          .map((s) => (expand ? s : { ...s, rotations: undefined })),
      );
    }
    m = path.match(/^\/v2\/schedules\/([^/]+)\/(overrides|timeline|on-calls)$/);
    if (m) {
      const s = schedules.find((x) => x.id === m![1]);
      if (!s || !inScope(s.ownerTeam?.id))
        return { status: 404, body: { message: "Schedule with identifier does not exist" } };
      const ovs = overrides.get(s.id) ?? [];
      if (m[2] === "overrides") return ok(ovs);
      if (m[2] === "timeline") {
        const from = new Date(q.get("date") ?? now.toISOString());
        const n = Number(q.get("interval") ?? 1) || 1;
        const unitMs =
          { days: DAY, weeks: 7 * DAY, months: 30 * DAY }[q.get("intervalUnit") ?? "weeks"] ??
          7 * DAY;
        const to = new Date(from.getTime() + n * unitMs);
        const t = computeTimeline(s.rotations ?? [], ovs, s.timezone, from, to, usersById);
        return ok({
          _parent: { id: s.id, name: s.name, enabled: true },
          ...serialiseTimeline(t, from, to),
        });
      }
      const at = new Date(q.get("date") ?? now.toISOString());
      const t = computeTimeline(
        s.rotations ?? [],
        ovs,
        s.timezone,
        new Date(at.getTime() - DAY),
        new Date(at.getTime() + DAY),
        usersById,
      );
      const names = new Set<string>();
      for (const r of t.final)
        for (const p of r.periods)
          if (
            p.start <= at.getTime() &&
            p.end > at.getTime() &&
            p.recipient.type === "user" &&
            p.recipient.name
          )
            names.add(p.recipient.name);
      return ok({
        _parent: { id: s.id, name: s.name, enabled: true },
        onCallRecipients: [...names],
      });
    }
    if (path === "/v2/escalations") return ok(escalations.filter((e) => inScope(e.ownerTeam?.id)));
    if (path === "/v2/policies/alert")
      return ok(policies.filter((x) => !x.teamId && scope.level === "account"));
    if (path === "/v2/policies") {
      const team = q.get("teamId");
      if (!inScope(team)) return { status: 404, body: { message: "Team not found" } };
      return ok(policies.filter((x) => x.teamId === team));
    }
    if (path === "/v2/integrations") return ok(integrations.filter((x) => inScope(x.teamId)));
    if (path === "/v2/heartbeats")
      return ok({ heartbeats: heartbeats.filter((h) => inScope(h.ownerTeam?.id)) });
    return { status: 404, body: { message: `No such endpoint: ${path}` } };
  }

  function visibleAlerts(query: string, scope: Scope): Slim[] {
    const hits = search(query);
    return scope.level === "account"
      ? hits
      : hits.filter((s) => teamId(INTEGRATIONS[s.integ]!.team) === scope.team);
  }

  /** `fetch` for an in-process client. */
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = new URL(
      typeof input === "string" ? input : input instanceof URL ? input.href : input.url,
    );
    const headers = new Headers(init?.headers);
    const r = handle(init?.method ?? "GET", url, headers.get("authorization"));
    return new Response(JSON.stringify(r.body), {
      status: r.status,
      headers: { "content-type": "application/json", ...(r.headers ?? {}) },
    });
  };

  return {
    now,
    handle,
    fetch: fetchImpl,
    calls,
    /** Ids the tests and the seed refer to. */
    ids: {
      user: userId,
      team: teamId,
      schedule: schedId,
      rotation: rotId,
      escalation: escId,
      integration: (k: string) => id("integration", k),
      alert: (i: number) => stableId(`alert:${i}`),
    },
    alertCount: () => slim.length,
    /** An override made in Opsgenie — after the last read, for instance. */
    addOverride(
      scheduleKey: string,
      rotationKey: string | null,
      personKey: string,
      start: Date,
      end: Date,
    ) {
      const list = overrides.get(schedId(scheduleKey)) ?? [];
      list.push({
        alias: `override-${list.length + 1}`,
        user: user(personKey),
        startDate: start.toISOString(),
        endDate: end.toISOString(),
        rotations: rotationKey ? [{ id: rotId(rotationKey) }] : [],
      });
      overrides.set(schedId(scheduleKey), list);
    },
    /** What the webhook integration would post for a new alert of this integration. */
    webhookFor(
      integrationKey: string,
      at: Date,
      opts: { priority?: OgAlert["priority"]; message?: string; tags?: string[] } = {},
    ) {
      const spec = INTEGRATIONS.find((x) => x.key === integrationKey)!;
      const t = TEAMS.find((x) => x.key === spec.team)!;
      const alertId = stableId(`live:${integrationKey}:${at.getTime()}:${opts.message ?? ""}`);
      return {
        action: "Create",
        integrationId: stableId("integration:shadow-webhook"),
        integrationName: "Open Incident shadow",
        source: { name: spec.name, type: spec.type },
        alert: {
          alertId,
          message: opts.message ?? spec.titles[0]!,
          tags: opts.tags ?? spec.tags,
          tinyId: String(Math.floor(at.getTime() / 1000) % 100000),
          alias: `${spec.key}-${at.getTime()}`,
          createdAt: at.getTime(),
          updatedAt: at.getTime(),
          username: "System",
          teams: [teamId(t.key)],
          responders: [{ id: teamId(t.key), type: "team", name: t.name }],
          priority: opts.priority ?? "P3",
          // Opsgenie names the alert's source after the integration that raised it.
          source: spec.name,
          details: Object.fromEntries(
            spec.tags
              .filter((x) => x.includes(":"))
              .map((x) => [x.split(":")[0]!, x.split(":").slice(1).join(":")]),
          ),
        },
      };
    },
  };
}

function ymd(d: Date): [number, number, number] {
  const p = partsOf(d, TZ);
  return [p.year, p.month, p.day];
}
