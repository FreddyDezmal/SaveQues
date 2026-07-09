# SaveQuest — Development Guide

## Local setup

```bash
pnpm install
cp .env.local.example .env.local   # fill in real values, see below
pnpm run dev                        # http://localhost:3000
```

## Environment variables

| Variable | Required | Notes |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Yes | |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Yes | RLS-scoped client key. |
| `SUPABASE_SERVICE_ROLE_KEY` | Yes | RLS-bypassing — used only server-side (cron, admin paths). Never expose to the client. |
| `NEXT_PUBLIC_POSTHOG_KEY` / `POSTHOG_KEY` | No | Leave blank to disable analytics locally. |
| `NEXT_PUBLIC_POSTHOG_HOST` / `POSTHOG_HOST` | No | |
| `CRON_SECRET` | Yes (prod) | Bearer token Vercel Cron sends to `/api/cron/*`. |
| `NEXT_PUBLIC_VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` | Yes | Web Push keys. |

Build fails fast in production if any required var is missing — see `next.config.js`'s validation block.

## Testing

Three tiers, deliberately kept separate (see `vitest.config.ts`'s `projects` array):

```bash
pnpm test                # unit tests (tests/unit/, tests/integration/) — pure logic, node environment, fast
pnpm run test:component  # component tests (tests/component/) — jsdom + React Testing Library
pnpm run test:e2e        # Playwright (e2e/) — full browser, requires a real dev server + Supabase TEST project
pnpm run test:coverage   # unit tests with a coverage report (coverage/)
```

### Running E2E tests

Requires a **dedicated Supabase test project** — never point these at production. You need:
1. A confirmed test user account: set `E2E_TEST_EMAIL` / `E2E_TEST_PASSWORD`.
2. Seed data for that account: at least one active `savings_goals` row (for deposit/goal-completion specs), ideally one goal near its target (for the goal-completion celebration spec).
3. `e2e/global-setup.ts` logs in once and saves session state to `e2e/.auth/user.json` (gitignored) for all specs using `e2e/fixtures.ts`'s authenticated `test`.

**Status as of Sprint 18**: these specs are written against the real app's routes and selectors but have not been executed against a live environment — there was no running dev server, browser, or Supabase test project available while authoring them. Treat them as a strong starting point requiring one real validation pass (fixing any selector drift) before relying on them as a regression gate. See the Sprint 18 summary's technical debt list.

### Writing new tests

- Pure logic (`lib/*.ts`) → `tests/unit/`, node environment, no DOM.
- Components → `tests/component/`, jsdom + RTL. Mock external hooks/modules at the boundary the component actually depends on (see `OfflineBanner.test.tsx` for mocking `lib/analytics`, `InstallSaveQuestCard.test.tsx` for mocking a hook entirely).
- Browser journeys spanning multiple pages/real network → `e2e/`.

## Deployment

Deploys via Vercel on push to `main`. `scripts/generate-build-info.js` runs as a `prebuild` step, writing real version/commit/build-date metadata (see `docs/ARCHITECTURE.md` — nothing here is hand-maintained).

CI (`.github/workflows/ci.yml`) runs lint, typecheck, unit tests, component tests, and a build-verification pass on every PR — this is a **required gate**, separate from Vercel's own build. E2E tests (`.github/workflows/e2e.yml`) are manually triggered only, pending a dedicated test-project's secrets being added to the repo (see that file's header comment).

## Contributing

- Read `docs/ARCHITECTURE.md` before touching notification, offline, or financial-mutation code — each has documented invariants (e.g. fire-and-forget push sends, NetworkOnly caching for financial routes) that are easy to accidentally break in a way that looks correct locally.
- Read `supabase/migrations/MIGRATION_CONFLICTS.md` before touching any migration numbered below 014.
- Match existing test conventions — see any file in `tests/unit/` for the expected level of comment detail on *why* a boundary is being tested, not just *what*.
