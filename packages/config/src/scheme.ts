/**
 * http or https — decided once, instead of nine times.
 *
 * Nine places in this codebase guessed the scheme from the host, each with its
 * own regular expression: `localhost` meant http, anything else meant https.
 * The guess is right often enough to have survived, and wrong in two cases
 * that matter. It puts `http://` in an invitation link when a developer serves
 * localhost over TLS — which is the only honest way to exercise a secure
 * cookie, a cross-subdomain session or an OAuth callback before production.
 * And it does the reverse for a self-hoster whose internal hostname happens to
 * contain "localhost" behind a terminating proxy.
 *
 * So the scheme becomes something the operator states, with two fallbacks in a
 * fixed order:
 *
 *  1. **`x-forwarded-proto`** wins whenever the request carries it. A proxy
 *     knows what the browser actually spoke, and nothing here can know better.
 *  2. **`PUBLIC_SCHEME`** — `http` or `https` — is the answer for everything
 *     built outside a request: the links in a page sent by the worker, the
 *     origin of a voice callback, the address printed by the workspace CLI.
 *  3. Without either, the old heuristic still applies, so an instance that
 *     sets nothing keeps the behaviour it has today.
 */

export type Scheme = "http" | "https";

function configured(env: Record<string, string | undefined>): Scheme | null {
  const v = env.PUBLIC_SCHEME?.trim().toLowerCase();
  return v === "http" || v === "https" ? v : null;
}

/** The scheme for a host we serve, outside of any request. */
export function schemeFor(host: string, env = process.env): Scheme {
  return configured(env) ?? (/(^|\.)(localhost|127\.0\.0\.1)(:|$)/.test(host) ? "http" : "https");
}

/** The scheme of an incoming request: what the proxy says, else what we serve. */
export function schemeOf(
  host: string,
  forwardedProto: string | null | undefined,
  env = process.env,
): Scheme {
  // A proxy chain sends "https, http"; the browser's is the first.
  const fwd = forwardedProto?.split(",")[0]?.trim().toLowerCase();
  if (fwd === "http" || fwd === "https") return fwd;
  return schemeFor(host, env);
}

/** `scheme://host`, the form almost every caller actually wants. */
export function originFor(host: string, env = process.env): string {
  return `${schemeFor(host, env)}://${host}`;
}
