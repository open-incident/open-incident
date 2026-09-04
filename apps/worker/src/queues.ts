/**
 * BullMQ queues:
 * - mail-send        : outbound email with retries (app.mail_deliveries is the log)
 * - update-reminders : nudges the lead when an incident's next update is overdue
 * - webhook-dispatch : outbound webhooks, signed POST with retries
 * - housekeeping     : purges (mail log 90 d)
 *
 * - escalation-tick  : the escalation engine's delayed ticks (one per transition)
 * - notify-send      : notifications to responders (email, SMS, voice, web push)
 * - oncall-sweep     : reconciler — due ticks, lost deliveries, shift reminders
 * - status-sweep     : maintenance windows on the clock, status page snapshots
 */
export const QUEUE_NAMES = [
  "mail-send",
  "update-reminders",
  "webhook-dispatch",
  "housekeeping",
  "escalation-tick",
  "notify-send",
  "oncall-sweep",
  "status-sweep",
  "tracker-sync",
  "heartbeat-sweep",
  "coverage-sweep",
  "runbook-sync",
] as const;

export type QueueName = (typeof QUEUE_NAMES)[number];
