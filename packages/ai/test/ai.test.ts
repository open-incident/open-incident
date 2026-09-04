import { describe, expect, it } from "vitest";
import { redact } from "../src/redact";
import { cosine } from "../src/similarity";
import { parseJson } from "../src/provider";

describe("ai package", () => {
  it("redacts emails, phones, ips, internal hosts and secrets", () => {
    const out = redact(
      "Contact amelie@skylark.dev or +33 6 12 34 56 78, host db-primary.prod.internal at 10.0.4.12, key sk-ABCDEFGHIJKLMNOP, password=hunter2 token: eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.abcdefghijk",
    );
    expect(out).not.toContain("amelie@");
    expect(out).toContain("[email]");
    expect(out).toContain("[phone]");
    expect(out).toContain("[ip]");
    expect(out).toContain("[host]");
    expect(out).toContain("[secret]");
    expect(out).toContain("password=[redacted]");
    expect(out).not.toContain("hunter2");
    // ordinary words and incident references survive
    expect(redact("INC-217 latency p99 2.4 s in eu-west-1")).toBe(
      "INC-217 latency p99 2.4 s in eu-west-1",
    );
  });

  it("computes cosine similarity and parses fenced JSON", () => {
    expect(cosine([1, 0], [1, 0])).toBe(1);
    expect(cosine([1, 0], [0, 1])).toBe(0);
    expect(cosine([], [1])).toBe(0);
    expect(parseJson<{ a: number }>('Here you go:\n```json\n{"a": 1}\n```')).toEqual({ a: 1 });
    expect(parseJson("not json")).toBeNull();
  });
});
