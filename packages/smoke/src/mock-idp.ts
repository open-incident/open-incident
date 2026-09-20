#!/usr/bin/env tsx
/**
 * The mock identity provider, run as a service rather than inside a test.
 *
 * The smoke suite starts `startOidcMock` for the length of one spec and stops
 * it. A development stack needs the same provider standing all day, for a
 * reason that is visible on the sign-in screen: the seeded Skylark workspace
 * has an SSO connection called **Mock IdP**, so the login page offers a button
 * for it — and with nothing listening on 3195 that button leads to a connection
 * refused. A control the product offers and nothing serves is the one kind of
 * defect this repository refuses everywhere else.
 *
 *   pnpm --filter @openincident/smoke run mock:idp
 *
 * The person it signs in is **stable**, unlike the suite's, which mints a new
 * one per run on purpose. A development stack wants the opposite: signing in
 * twice should land on the same member, with the same incidents assigned to
 * them, rather than filling the workspace with strangers.
 */
import { startOidcMock } from "./oidc-mock";

const port = Number(process.env.OIDC_MOCK_PORT ?? 3195);
/*
 * `@smoke.example`, not the workspace's own domain.
 *
 * An SSO connection carries an allowed-domain list, and the seeded one allows
 * `smoke.example` because that is what the suite creates it with. Signing in
 * an address outside it is refused with `not-a-member` — correctly, and
 * confusingly, because the round trip to the provider succeeded and only the
 * last step failed. The mock matches what the workspace is configured to
 * accept; override the address if your connection allows a different domain.
 */
const user = {
  sub: process.env.OIDC_MOCK_SUB ?? "mock-idp-dev",
  email: process.env.OIDC_MOCK_EMAIL ?? "sam@smoke.example",
  name: process.env.OIDC_MOCK_NAME ?? "Sam Single",
};

// Wrapped rather than awaited at the top level: this package is CommonJS, and
// a top-level await here fails to transform with a message that names esbuild
// rather than the package type.
async function main() {
  const mock = await startOidcMock(port, user);
  console.log(
    `mock IdP on ${mock.issuer} — signs in ${user.email} (${user.name})\n` +
      `  discovery  ${mock.issuer}/.well-known/openid-configuration\n` +
      `  it accepts any client_id and any secret: it is a double, not a gate.`,
  );

  // The key is generated at start, so a restart invalidates whatever a client
  // cached. That is deliberate in the suite — a stale JWKS should be caught —
  // and harmless here, because the product fetches the JWKS on each sign-in.
  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.on(signal, () => {
      mock.server.close();
      process.exit(0);
    });
  }
}

void main();
