import { describe, expect, it } from "vitest";
import { signSlackRequest, verifySlackRequest } from "../src/slack/verify";
import { makeInstallState, readInstallState } from "../src/install";
import { declareModal, incidentHeaderBlocks, readViewValues } from "../src/slack/blocks";

describe("slack adapter", () => {
  it("verifies its own signature and refuses a stale or forged one", () => {
    const body = "token=x&command=%2Fincident&text=status";
    const headers = signSlackRequest("secret", body);
    const h = (o: Record<string, string>) => ({ get: (k: string) => o[k] ?? null });
    expect(verifySlackRequest("secret", h(headers), body)).toBe(true);
    expect(verifySlackRequest("other", h(headers), body)).toBe(false);
    expect(verifySlackRequest("secret", h(headers), body + "&x=1")).toBe(false);
    const old = signSlackRequest("secret", body, Math.floor(Date.now() / 1000) - 600);
    expect(verifySlackRequest("secret", h(old), body)).toBe(false);
  });

  it("round-trips the install state and rejects a tampered one", () => {
    const state = makeInstallState(
      "11111111-1111-1111-1111-111111111111",
      "22222222-2222-2222-2222-222222222222",
    );
    expect(readInstallState(state)).toEqual({
      tenantId: "11111111-1111-1111-1111-111111111111",
      memberId: "22222222-2222-2222-2222-222222222222",
    });
    const tampered = Buffer.from(
      Buffer.from(state, "base64url").toString().replace("1111", "9999"),
    ).toString("base64url");
    expect(readInstallState(tampered)).toBeNull();
    expect(readInstallState("nope")).toBeNull();
  });

  it("builds a header with the war room button and reads modal values", () => {
    const blocks = incidentHeaderBlocks({
      reference: "INC-1",
      name: "Test",
      status: "Investigation",
      severity: "SEV2",
      phase: "active",
      lead: null,
      service: "checkout-api",
      url: "https://x/app/incidents/1",
      bridgeUrl: "https://meet.google.com/new",
    }) as Array<{ type: string; elements?: Array<{ action_id: string }> }>;
    expect(blocks[0]!.type).toBe("header");
    expect(blocks.find((b) => b.type === "actions")!.elements!.map((e) => e.action_id)).toEqual([
      "oi_open",
      "oi_bridge",
    ]);
    const modal = declareModal({
      title: "Boom",
      severities: [{ id: "s1", name: "SEV1" }],
      services: [],
      requireService: false,
    }) as { blocks: unknown[] };
    expect(modal.blocks).toHaveLength(3);
    expect(
      readViewValues({
        values: {
          title: { title: { value: "Boom" } },
          severity: { severity: { selected_option: { value: "s1" } } },
        },
      }),
    ).toEqual({ title: "Boom", severity: "s1" });
  });
});
