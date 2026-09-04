import { describe, expect, it } from "vitest";
import { decryptSecret, decryptSecrets, encryptSecret, encryptSecrets, secretHint } from "./index";

describe("secrets at rest", () => {
  it("round-trips a string", () => {
    const payload = encryptSecret("hunter2");
    expect(payload.startsWith("v1.")).toBe(true);
    expect(decryptSecret(payload)).toBe("hunter2");
  });

  it("never produces the same ciphertext twice (random IV)", () => {
    expect(encryptSecret("same")).not.toBe(encryptSecret("same"));
  });

  it("returns null on a tampered payload instead of throwing", () => {
    const payload = encryptSecret("hunter2");
    const parts = payload.split(".");
    parts[3] = parts[3]!.slice(0, -2) + "AA";
    expect(decryptSecret(parts.join("."))).toBeNull();
    expect(decryptSecret("garbage")).toBeNull();
    expect(decryptSecret(null)).toBeNull();
  });

  it("round-trips an object of secrets", () => {
    const payload = encryptSecrets({ apiKey: "k", apiSecret: "s" });
    expect(decryptSecrets(payload)).toEqual({ apiKey: "k", apiSecret: "s" });
    expect(decryptSecrets(null)).toEqual({});
  });

  it("only ever shows the tail of a secret", () => {
    expect(secretHint("oi_live_0123456789abcdef")).toMatch(/^•+cdef$/);
  });
});
