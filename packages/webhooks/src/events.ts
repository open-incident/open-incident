/**
 * The events an endpoint can subscribe to. Only those the product emits today
 * are offered; the ones that arrive with a later milestone are listed so the
 * settings screen can say so — labelled, never selectable.
 */
export const WEBHOOK_EVENTS = [
  "incident.created",
  "incident.updated",
  "incident.update_published",
  "incident.resolved",
  "follow_up.created",
  "alert.created",
  "alert.resolved",
  "escalation.triggered",
  "escalation.acknowledged",
  "status_page.incident_published",
] as const;

export type WebhookEvent = (typeof WEBHOOK_EVENTS)[number];

/** Events a later milestone will add — none left: every listed event is emitted today. */
export const FUTURE_WEBHOOK_EVENTS: Array<{ event: string; milestone: "oncall" | "statusPages" }> =
  [];

export function isWebhookEvent(value: string): value is WebhookEvent {
  return (WEBHOOK_EVENTS as readonly string[]).includes(value);
}
