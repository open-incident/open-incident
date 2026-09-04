## What does this change?

<!-- One topic per PR. Describe the user-visible behaviour it changes. -->

## Checklist

- [ ] `pnpm typecheck`, `pnpm lint` and `pnpm build` pass
- [ ] User-visible strings live in `apps/web/src/i18n/dictionaries/` (English first)
- [ ] Every query on the `app` schema runs inside `withTenant()`
- [ ] The screen's actions act — no control the back end ignores
- [ ] For user-facing changes: smoke suite run (`pnpm --filter @openincident/smoke smoke`)
- [ ] Commits are signed off (DCO, `git commit -s`)
