#!/usr/bin/env bash
#
# `next dev`, over TLS when the instance has a certificate.
#
# Next takes the certificate on the command line and nowhere else, so the
# choice cannot live in .env on its own. This wrapper reads it from there:
# with DEV_TLS_CERT and DEV_TLS_KEY set, the app serves https; without them it
# falls back to plain http, which is what a fresh clone and the CI runner get.
set -euo pipefail

if [ -n "${DEV_TLS_CERT:-}" ] && [ -n "${DEV_TLS_KEY:-}" ]; then
  exec pnpm exec next dev \
    --experimental-https \
    --experimental-https-cert "$DEV_TLS_CERT" \
    --experimental-https-key "$DEV_TLS_KEY" \
    "$@"
fi

exec pnpm exec next dev "$@"
