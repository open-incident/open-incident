import { describe, expect, it } from "vitest";
import {
  ScimError,
  assignments,
  paging,
  parseEqFilter,
  parsePatch,
  readJsonBody,
  serviceProviderConfig,
} from "../src/scim/protocol";
import { readUser } from "../src/scim/users";
import { SCIM_TOKEN_PATTERN, hashScimToken } from "../src/scim/store";

describe("SCIM filters and paging", () => {
  it("parses the equality filters providers send", () => {
    expect(parseEqFilter('userName eq "Ana@Acme.com"')).toEqual({
      attribute: "username",
      value: "Ana@Acme.com",
    });
    expect(parseEqFilter('emails[type eq "work"].value eq "x@y.z"')?.attribute).toMatch(/^emails/);
    expect(parseEqFilter(null)).toBeNull();
    expect(() => parseEqFilter('userName co "an"')).toThrow(ScimError);
  });
  it("defaults and caps paging", () => {
    expect(paging(new URL("http://x/Users"))).toEqual({ startIndex: 1, count: 100 });
    expect(paging(new URL("http://x/Users?startIndex=0&count=9999"))).toEqual({
      startIndex: 1,
      count: 200,
    });
  });
});

describe("SCIM PATCH", () => {
  it("accepts the Okta path form and the Entra object form", () => {
    const okta = parsePatch({ Operations: [{ op: "Replace", path: "active", value: false }] });
    expect(assignments(okta)).toEqual([{ path: "active", value: false, op: "replace" }]);
    const entra = parsePatch({
      Operations: [{ op: "add", value: { "name.givenName": "Ana", active: true } }],
    });
    expect(assignments(entra).map((a) => a.path)).toEqual(["name.givenName", "active"]);
  });
  it("refuses unknown operations and empty patches", () => {
    expect(() => parsePatch({ Operations: [] })).toThrow(ScimError);
    expect(() => parsePatch({ Operations: [{ op: "move", path: "x" }] })).toThrow(ScimError);
    expect(() => readJsonBody("{nope")).toThrow(ScimError);
  });
});

describe("SCIM users", () => {
  it("reads a User resource into member fields", () => {
    const u = readUser({
      userName: "Ana@Acme.com",
      externalId: "00u1",
      name: { givenName: "Ana", familyName: "Lee" },
      emails: [{ value: "other@acme.com" }, { value: "ana@acme.com", primary: true }],
      roles: [{ value: "admin", primary: true }],
      active: false,
    });
    expect(u).toEqual({
      email: "ana@acme.com",
      externalId: "00u1",
      givenName: "Ana",
      familyName: "Lee",
      displayName: undefined,
      active: false,
      role: "admin",
    });
    expect(readUser({ roles: [{ value: "god" }] }).role).toBeUndefined();
  });
  it("advertises PATCH and filtering, no bulk", () => {
    const spc = serviceProviderConfig("https://acme.example/scim/v2");
    expect(spc.patch.supported).toBe(true);
    expect(spc.bulk.supported).toBe(false);
    expect(spc.filter.maxResults).toBe(200);
  });
  it("hashes tokens and recognises their shape", () => {
    const token = `oi_scim_${"a".repeat(48)}`;
    expect(SCIM_TOKEN_PATTERN.test(token)).toBe(true);
    expect(SCIM_TOKEN_PATTERN.test("oi_live_" + "a".repeat(32))).toBe(false);
    expect(hashScimToken(token)).toMatch(/^[a-f0-9]{64}$/);
    expect(hashScimToken(token)).not.toBe(hashScimToken(token.replace(/a$/, "b")));
  });
});
