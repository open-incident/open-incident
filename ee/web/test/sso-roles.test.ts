import { describe, expect, it } from "vitest";
import { domainAllowed } from "../src/sso/provision";
import { ssoUrls } from "../src/sso/store";
import { keyOf } from "../src/roles/store";

describe("SSO connections", () => {
  it("matches allowed domains case-insensitively, any when the list is empty", () => {
    expect(domainAllowed({ allowedDomains: [] }, "x@anything.example")).toBe(true);
    expect(domainAllowed({ allowedDomains: ["acme.com"] }, "Ana@ACME.com")).toBe(true);
    expect(domainAllowed({ allowedDomains: ["acme.com"] }, "ana@acme.co")).toBe(false);
  });
  it("derives the provider-facing URLs from the workspace origin", () => {
    const u = ssoUrls("https://acme.openincident.example/", "oi-1234-oidc-x");
    expect(u.redirectUri).toBe(
      "https://acme.openincident.example/api/auth/sso/callback/oi-1234-oidc-x",
    );
    expect(u.acsUrl).toBe(
      "https://acme.openincident.example/api/auth/sso/saml2/sp/acs/oi-1234-oidc-x",
    );
    expect(u.metadataUrl).toContain("/api/auth/sso/saml2/sp/metadata?providerId=oi-1234-oidc-x");
  });
});

describe("custom roles", () => {
  it("derives a stable key from a name", () => {
    expect(keyOf("Alerting admin")).toBe("alerting_admin");
    expect(keyOf("Équipe – Données")).toBe("equipe_donnees");
    expect(keyOf("2nd line")).toBe("r_2nd_line");
  });
});
