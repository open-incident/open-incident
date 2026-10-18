/**
 * The parts of the Opsgenie REST API v2 the migration reads, as Opsgenie
 * returns them. Only what is used is typed; every field Opsgenie may leave
 * out is optional, because it does.
 */

export type Region = "eu" | "us";

export type OgPaging = { next?: string; first?: string; last?: string };

export type OgUser = {
  id: string;
  username: string;
  fullName: string;
  role?: { id?: string; name: string };
  blocked?: boolean;
  verified?: boolean;
  timeZone?: string;
  locale?: string;
  createdAt?: string;
};

export type OgTeam = {
  id: string;
  name: string;
  description?: string;
  members?: Array<{ user: { id: string; username?: string }; role?: string }>;
};

export type OgDay =
  "monday" | "tuesday" | "wednesday" | "thursday" | "friday" | "saturday" | "sunday";

export type OgTimeRestriction =
  | {
      type: "time-of-day";
      restriction: { startHour: number; startMin: number; endHour: number; endMin: number };
    }
  | {
      type: "weekday-and-time-of-day";
      restrictions: Array<{
        startDay: OgDay;
        startHour: number;
        startMin: number;
        endDay: OgDay;
        endHour: number;
        endMin: number;
      }>;
    };

export type OgParticipant =
  | { type: "user"; id: string; username?: string }
  | { type: "team"; id: string; name?: string }
  | { type: "escalation"; id: string; name?: string }
  | { type: "none" };

export type OgRotation = {
  id: string;
  name: string;
  startDate: string;
  endDate?: string;
  type: "daily" | "weekly" | "hourly";
  length?: number;
  participants: OgParticipant[];
  timeRestriction?: OgTimeRestriction | null;
};

export type OgSchedule = {
  id: string;
  name: string;
  description?: string;
  timezone: string;
  enabled?: boolean;
  ownerTeam?: { id: string; name?: string } | null;
  rotations?: OgRotation[];
};

export type OgOverride = {
  alias: string;
  user: { type: "user" | "none"; id?: string; username?: string };
  startDate: string;
  endDate: string;
  rotations?: Array<{ id: string; name?: string }>;
};

export type OgPeriod = {
  startDate: string;
  endDate: string;
  type?: "default" | "override" | "historical" | "forwarding";
  recipient?: { type: "user" | "none" | "team" | "escalation"; id?: string; name?: string };
};

export type OgTimelineRotation = {
  id: string;
  name: string;
  order?: number;
  periods?: OgPeriod[];
};

export type OgTimeline = {
  startDate: string;
  endDate: string;
  finalTimeline?: { rotations?: OgTimelineRotation[] };
  baseTimeline?: { rotations?: OgTimelineRotation[] };
};

export type OgRecipient =
  | { type: "user"; id: string; username?: string }
  | { type: "schedule"; id: string; name?: string }
  | { type: "team"; id: string; name?: string }
  | { type: "escalation"; id: string; name?: string };

export type OgEscalationRule = {
  condition: "if-not-acked" | "if-not-closed";
  notifyType: "default" | "next" | "previous" | "users" | "admins" | "all";
  delay: { timeAmount: number; timeUnit?: "minutes" | "hours" | "days" };
  recipient: OgRecipient;
};

export type OgEscalation = {
  id: string;
  name: string;
  description?: string;
  ownerTeam?: { id: string; name?: string } | null;
  rules: OgEscalationRule[];
  repeat?: {
    waitInterval: number;
    count: number;
    resetRecipientStates?: boolean;
    closeAlertAfterAll?: boolean;
  } | null;
};

export type OgConditionField =
  | "message"
  | "alias"
  | "description"
  | "source"
  | "entity"
  | "tags"
  | "actions"
  | "details"
  | "extra-properties"
  | "recipients"
  | "teams"
  | "priority";

export type OgCondition = {
  field: OgConditionField;
  key?: string;
  not?: boolean;
  operation:
    | "matches"
    | "contains"
    | "starts-with"
    | "ends-with"
    | "equals"
    | "contains-key"
    | "contains-value"
    | "greater-than"
    | "less-than"
    | "is-empty"
    | "equals-ignore-whitespace";
  expectedValue?: string;
  order?: number;
};

export type OgCriteria = {
  type: "match-all" | "match-any-condition" | "match-all-conditions";
  conditions?: OgCondition[];
};

export type OgRoutingRule = {
  id: string;
  name?: string;
  isDefault?: boolean;
  order?: number;
  criteria: OgCriteria;
  timezone?: string;
  timeRestriction?: OgTimeRestriction | null;
  notify: { type: "escalation" | "schedule" | "none"; id?: string; name?: string };
};

export type OgNotificationRule = {
  id: string;
  name: string;
  actionType: string;
  enabled?: boolean;
  order?: number;
};

export type OgPolicy = {
  id: string;
  name: string;
  type: string;
  enabled?: boolean;
  order?: number;
  teamId?: string;
};

export type OgIntegration = {
  id: string;
  name: string;
  enabled?: boolean;
  type: string;
  teamId?: string;
  ownerTeam?: { id: string; name?: string } | null;
};

export type OgHeartbeat = {
  name: string;
  description?: string;
  interval: number;
  intervalUnit: "minutes" | "hours" | "days";
  enabled: boolean;
  expired?: boolean;
  ownerTeam?: { id: string; name?: string } | null;
  alertMessage?: string;
  alertPriority?: string;
};

export type OgAlert = {
  id: string;
  tinyId?: string;
  alias?: string;
  message: string;
  status: "open" | "closed";
  acknowledged?: boolean;
  tags?: string[];
  count?: number;
  createdAt: string;
  updatedAt?: string;
  lastOccurredAt?: string;
  source?: string;
  owner?: string;
  priority: "P1" | "P2" | "P3" | "P4" | "P5";
  teams?: Array<{ id: string }>;
  responders?: Array<{ type: string; id: string }>;
  integration?: { id: string; name: string; type: string };
  report?: { ackTime?: number; closeTime?: number; acknowledgedBy?: string; closedBy?: string };
  entity?: string;
  description?: string;
  details?: Record<string, string>;
};

/** What the Opsgenie Webhook integration posts for an alert action. */
export type OgWebhookPayload = {
  action?: string;
  integrationId?: string;
  integrationName?: string;
  source?: { name?: string; type?: string };
  alert?: {
    alertId?: string;
    message?: string;
    tags?: string[];
    tinyId?: string;
    entity?: string;
    alias?: string;
    createdAt?: number;
    updatedAt?: number;
    username?: string;
    userId?: string;
    description?: string;
    team?: string;
    teams?: string[];
    responders?: Array<{ id: string; type: string; name?: string }>;
    priority?: string;
    source?: string;
    details?: Record<string, string>;
  };
};
