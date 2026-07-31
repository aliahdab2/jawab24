# Salla — End-to-End Test Plan & Closed-Loop Results

> Companion to `SALLA_SUBMISSION_RUNBOOK.md`. This is the **test** surface: every
> automated suite, static check, and manual/live gate that must be green before PR #456
> (`feat/salla-easy-mode-claim-binding`, D-031 Easy-Mode claim binding) merges and Salla
> goes to submission. Run against the PR branch, not `main`.
>
> Last full run: **2026-07-19** (branch `feat/salla-easy-mode-claim-binding` @ `dc61723b`).

## Scope

Everything that touches the Salla integration, in three rings:

1. **Salla proper** — controller, service, integration adapter, routes, the Easy-Mode
   claim/pending-install flow (D-031).
2. **E-commerce machinery Salla rides on** — token crypto/health/refresh, catalog sync,
   webhook product path, order actions, RAG over the catalog, comment-processor hooks.
3. **Shared infra the branch touched** — CSRF/auth middleware (the branch carries the
   Bearer-skip change; shared-infra ⇒ Critical review gate per the PR-review rules).

## Tier 1 — Automated (must be green to merge)

| # | Suite | What it proves | Command |
|---|-------|----------------|---------|
| 1 | `test/services/salla.test.ts` | Salla service: token exchange, store info, scope handling | `npx vitest run test/services/salla.test.ts` |
| 2 | `test/controllers/salla.test.ts` | Controller: authorize/callback, webhooks, pending-install staging, claim | `npx vitest run test/controllers/salla.test.ts` |
| 3 | `test/controllers/auth.salla-claim.test.ts` | Owner-email match binding (D-012 NO ⇒ email path) | `…auth.salla-claim.test.ts` |
| 4 | `test/routes/salla.test.ts` | Route wiring / flag-gated 404s | `…routes/salla.test.ts` |
| 5 | `test/integrations/salla.test.ts` | Salla REST adapter field mapping | `…integrations/salla.test.ts` |
| 6 | `test/services/ecommercePendingInstallTokens.test.ts` | Pending-install token encrypt/stage/expire | `…ecommercePendingInstallTokens.test.ts` |
| 7 | E-commerce machinery (10 suites) | crypto, token health/refresh, actions, tool-loop, RAG, webhooks, analytics, routes, comment-processor | `npx vitest run test/services/ecommerce*.test.ts test/controllers/ecommerce*.test.ts test/routes/ecommerceRoutes.test.ts test/services/commentProcessor.ecommerce.test.ts` |
| 8 | `test/middleware/auth.test.ts` | CSRF Bearer-skip / cookie-priority split (shared infra) | `…middleware/auth.test.ts` |
| 9 | Integration: `test/integration/ecommerce-sync.test.ts` | **Live-DB**: token encryption at rest, claim pending install, double-claim, cross-account rejection, full catalog sync, webhook upsert/delete, safety cap | `npm run test:integration:local -- test/integration/ecommerce-sync.test.ts` |
| 10 | Backend typecheck | Branch compiles | `npx tsc --noEmit` |
| 11 | Lint Salla + auth files | Zero errors/warnings | `npx eslint src/{controllers,services,integrations,routes}/salla.ts src/middleware/auth.ts` |
| 12 | Frontend Salla i18n parity | en/ar `salla.json` key parity | (script, see results) |

## Tier 2 — Live browser QA (closed loop, both locales)

Driven in real Chrome via the chrome-devtools MCP (`/qa` loop): console + network watched
after every action, `/en` and `/ar` each.

| Page | Precondition | Checks |
|------|--------------|--------|
| `/salla/onboarding` | logged in; a Salla store connected to the workspace (dogfood demo store) | store fetch → product sync → page-link steps render; no console errors; API calls 2xx; RTL correct in `/ar`; no raw i18n keys |
| `/salla/connected?merchant=<id>` | logged in; `SALLA_EASY_MODE_CLAIM_ENABLED` on backend | phase machine: `missing` (no merchant) / `needLogin` / `checking` → `found`/`notFound`; claim binds; error states render |

## Tier 3 — Manual / live gates (not runnable in CI)

| Gate | Owner | Status |
|------|-------|--------|
| Easy-Mode dry-run on Jawab24-Dev (settles D-012) | founder + eng | ✅ DONE 2026-07-18 → D-012 = NO (authorize 404s) → owner-email match |
| Live prod smoke: connect dogfood store against `jawab24.com`, products sync, webhook 200s, test-reply real prices | founder + eng | ⛔ submission-day (Phase 1 runbook) |
| `order.created` → customer SMS (dedup: exactly one) | eng | ⛔ on approval (Phase 3) |
| `app.uninstalled` → store deactivates | eng | ⛔ on approval (Phase 3) |

---

## Results — 2026-07-19 run

### Tier 1 — automated: **ALL GREEN**

| Suite | Result |
|-------|--------|
| Salla unit (service 56, controller 74, auth-claim 8, routes 1, integration-adapter 17, pending-install-tokens 14) | ✅ 170/170 |
| E-commerce machinery (crypto, token health/refresh, actions, tool-loop, RAG, webhooks, analytics, routes, comment-processor) | ✅ 148/148 |
| Auth/CSRF middleware (shared infra) | ✅ 24/24 |
| Integration `ecommerce-sync` (live DB 5433): token-at-rest, claim/double-claim/expired/cross-account, catalog sync, webhook upsert/delete, safety cap | ✅ 19/19 |
| Backend `tsc --noEmit` | ✅ 0 errors |
| Lint (salla + auth) | ✅ 0/0 |
| Salla i18n en/ar parity | ✅ 71/71 |
| Frontend page tests (salla + pages/settings/scale) | ✅ 60/60 |

### Tier 2 — live browser QA (Chrome DevTools MCP, both locales): **PASS, 2 defects found & fixed**

- **`/en/salla/onboarding` happy path** — welcome → `GET /salla/store` 200 (store "متجر تجريبي") → `POST /salla/store/sync` 200 → **"20 products synced"**. Clean.
- **`/en/salla/connected`** — `missing` (no merchant), `error` (merchant + dormant flag → `GET /salla/store/pending` 404) both render correctly; no crash/blank.
- **`/ar/salla/connected`** — `dir=rtl`, real Arabic, no raw i18n keys.

**Defect 1 — auth hydration race (both Salla pages).** The pages decided auth off raw
`isAuthenticated`, which is `false` on first paint until the persisted store rehydrates.
On a cold load (exactly how Salla loads the Easy-Mode App URL) `/salla/onboarding` bounced
a logged-in merchant to `/login`→`/dashboard`, and `/salla/connected` flashed the "log in"
screen. **Fixed** by gating on `_hasHydrated` (matches DashboardLayout / AI_INSTRUCTIONS §12).
Regression test: `src/pages/salla/connected.test.tsx` (4 cases). Re-verified in-browser:
onboarding now shows the welcome step and completes the sync.

**Defect 2 — Arabic brand rendering.** `ar/salla.json` mixed Latin "Salla" (7×, in the
claim/onboarding block) with "سلة" (15×) — the AR corpus convention is "سلة" (135 vs 9).
**Fixed** → all "سلة"; `translation:validate` PASS; re-verified in-browser (`/ar/salla/connected`
now reads "اربط متجر سلة…", "Jawab24" correctly stays Latin).

### Tier 3 — manual/live gates: unchanged (see runbook). Dry-run done; prod smoke + on-approval checks remain submission/approval-day.

### Not fixed here (out of Salla scope, logged for follow-up)
- Dashboard `GET /analytics/ai-usage?days=30` → **500** (fires 3×) and `GET /subscription/usage` → **404** on local dev. Seen while the onboarding redirect passed through `/dashboard`; unrelated to Salla, not investigated.
- Local-dev `/sse/events` **CORS** errors from `:3001` — dev-env config, not Salla.
