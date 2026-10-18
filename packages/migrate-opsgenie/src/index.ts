/**
 * Moving a workspace off Opsgenie: a read-only REST client, the conversions,
 * the comparisons, and the steps of the wizard as database operations.
 * Opsgenie is only ever read.
 */
export * from "./types";
export * from "./client";
export * from "./convert";
export * from "./og-routing";
export * from "./og-timeline";
export * from "./inventory";
export * from "./compare";
export * from "./windows";
export * from "./run";
export * from "./import";
export * from "./switch";
export * from "./shadow";
export * from "./archive";
export * from "./jobs";
export { partsOf, wallClock } from "./zone";

/** Opsgenie's announced end of service. */
export const OPSGENIE_SHUTDOWN = new Date("2027-04-05T00:00:00Z");

/** Days left until Opsgenie shuts down, never below zero. */
export function daysLeft(now = new Date()): number {
  return Math.max(0, Math.ceil((OPSGENIE_SHUTDOWN.getTime() - now.getTime()) / 86_400_000));
}
