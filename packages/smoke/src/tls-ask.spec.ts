import { expect, request, test } from "@playwright/test";
import { STATUS_BASE_URL, TENANT } from "../playwright.config";

/**
 * The gate a reverse proxy asks before issuing a certificate for a hostname it
 * has never seen (Caddy's `on_demand_tls { ask … }`). It must answer 200 for a
 * domain we really serve and refuse everything else: a yes to any hostname
 * would let anyone pointing DNS at this server mint certificates in the
 * instance's name, until the certificate authority's limits stop it.
 */
test.describe("Certificate gate", () => {
  test("only the hostnames a published page carries get a yes", async () => {
    const api = await request.newContext();
    const status = new URL(STATUS_BASE_URL);
    const ask = (domain: string) =>
      api.get(`${status.origin}/api/tls?domain=${encodeURIComponent(domain)}`);

    // A page of ours, on our own status domain.
    expect((await ask(status.hostname)).status()).toBe(200);

    // Hostnames nobody published: no certificate, whoever asks.
    for (const domain of [
      "status.evil.example",
      `${TENANT}-nope.status.localhost`,
      "open-incident.com",
    ]) {
      expect((await ask(domain)).status()).toBe(404);
    }

    // Malformed questions are refused before any lookup.
    for (const bad of ["", "not a domain", "http://x.example/path", "a".repeat(300)]) {
      expect((await ask(bad)).status()).toBe(400);
    }
  });
});
