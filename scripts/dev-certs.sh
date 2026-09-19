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
# Why the base domain is oi.localhost and not plain localhost: a wildcard is
# only honoured when at least two labels follow it. `*.localhost` has one, so
# curl, OpenSSL and the browsers all refuse it for acme.localhost — the
# certificate looks right and every workspace host fails. `*.oi.localhost` has
# two and is accepted, and everything under .localhost resolves to 127.0.0.1
# at any depth, so nothing has to be added to /etc/hosts.
#
# The certificate therefore covers the apex, every workspace subdomain, and the
# status subdomains beneath it. Extra hostnames can be passed as arguments.
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
  localhost \
  oi.localhost '*.oi.localhost' '*.status.oi.localhost' \
  127.0.0.1 ::1 "$@"

chmod 600 "$out/dev-key.pem"
echo
echo "Certificate written to certs/. Point the instance at it:"
echo "  DEV_TLS_CERT=$out/dev.pem"
echo "  DEV_TLS_KEY=$out/dev-key.pem"
echo "  PUBLIC_SCHEME=https"
