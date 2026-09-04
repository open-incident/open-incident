import { describe, expect, it } from "vitest";
import { signStatusAccess, verifyStatusAccess } from "../src/access";

describe("status page access tokens", () => {
  it("accepts its own token for the page it names, until it expires, and nothing else", () => {
    const now = Date.now();
    const token = signStatusAccess("page-1", 60_000, now);
    expect(verifyStatusAccess(token, "page-1", now + 1_000)).toBe(true);
    expect(verifyStatusAccess(token, "page-2", now + 1_000)).toBe(false);
    expect(verifyStatusAccess(token, "page-1", now + 120_000)).toBe(false);
    const tampered = token.slice(0, 10) + (token[10] === "A" ? "B" : "A") + token.slice(11);
    expect(verifyStatusAccess(tampered, "page-1", now)).toBe(false);
    expect(verifyStatusAccess("garbage", "page-1", now)).toBe(false);
    expect(verifyStatusAccess(null, "page-1", now)).toBe(false);
  });
});
