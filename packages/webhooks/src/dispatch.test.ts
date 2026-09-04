import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { signBody } from "./dispatch";
import { WEBHOOK_EVENTS, isWebhookEvent } from "./events";

describe("webhook signature", () => {
  it("is the HMAC-SHA256 of the exact body, prefixed like GitHub's", () => {
    const body = JSON.stringify({ event: "incident.created", n: 1 });
    const expected = `sha256=${createHmac("sha256", "s3cret").update(body).digest("hex")}`;
    expect(signBody("s3cret", body)).toBe(expected);
    // One byte of difference in the body changes the signature: a receiver
    // must verify the raw bytes it received, not a re-serialisation.
    expect(signBody("s3cret", body + " ")).not.toBe(expected);
  });

  it("only offers the events the product emits", () => {
    expect(WEBHOOK_EVENTS).toContain("incident.created");
    expect(isWebhookEvent("escalation.triggered")).toBe(true);
    expect(isWebhookEvent("incident.resolved")).toBe(true);
    expect(isWebhookEvent("heartbeat.missed")).toBe(false);
  });
});
