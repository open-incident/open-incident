#!/usr/bin/env bash
#
# A certificate for local development, so the instance can be served over TLS.
#
# Plain http on localhost hides three things until production finds them: a
# cookie marked Secure is silently dropped, a session shared across workspace
# subdomains behaves differently under SameSite, and an OAuth or SSO provider
# refuses an http callback. Developing over TLS is the only way to exercise
# them, so this is the default here rather than a flag somebody remembers.
#
# The certificate covers the apex, every workspace subdomain, and the status
# subdomains underneath it — a wildcard matches one label, so *.localhost does
# not cover acme.status.localhost and both are listed.
#
# Requires mkcert (brew install mkcert), whose local authority the system and
# the browsers already trust after `mkcert -install`.
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
out="$root/certs"
mkdir -p "$out"

if ! command -v mkcert >/dev/null 2>&1; then
  echo "mkcert is missing: brew install mkcert && mkcert -install" >&2
  exit 1
fi

if [ ! -s "$(mkcert -CAROOT)/rootCA.pem" ]; then
  echo "mkcert has no local authority yet: run mkcert -install" >&2
  exit 1
fi

mkcert -cert-file "$out/dev.pem" -key-file "$out/dev-key.pem" \
  localhost '*.localhost' '*.status.localhost' 127.0.0.1 ::1

chmod 600 "$out/dev-key.pem"
echo
echo "Certificate written to certs/. Point the instance at it:"
echo "  DEV_TLS_CERT=$out/dev.pem"
echo "  DEV_TLS_KEY=$out/dev-key.pem"
echo "  PUBLIC_SCHEME=https"
