import { describe, expect, it } from "vitest";
import { inviteToken, verifyInviteToken } from "./invite-token";

const TENANT = "11111111-1111-1111-1111-111111111111";
const MEMBER = "22222222-2222-2222-2222-222222222222";

describe("invitation token", () => {
  it("verifies what it signed", () => {
    expect(verifyInviteToken(TENANT, inviteToken(TENANT, MEMBER))).toBe(MEMBER);
  });

  it("is bound to the workspace", () => {
    const other = "33333333-3333-3333-3333-333333333333";
    expect(verifyInviteToken(other, inviteToken(TENANT, MEMBER))).toBeNull();
  });

  it("expires after seven days", () => {
    const issued = Date.parse("2026-09-01T00:00:00Z");
    const token = inviteToken(TENANT, MEMBER, issued);
    expect(verifyInviteToken(TENANT, token, issued + 6 * 86_400_000)).toBe(MEMBER);
    expect(verifyInviteToken(TENANT, token, issued + 8 * 86_400_000)).toBeNull();
  });

  it("rejects a tampered signature or member", () => {
    const token = inviteToken(TENANT, MEMBER);
    const [id, exp, sig] = token.split(".");
    expect(verifyInviteToken(TENANT, `${id}.${exp}.${sig!.slice(0, -1)}0`)).toBeNull();
    expect(verifyInviteToken(TENANT, `${id!.replace("2", "9")}.${exp}.${sig}`)).toBeNull();
    expect(verifyInviteToken(TENANT, "garbage")).toBeNull();
  });
});
