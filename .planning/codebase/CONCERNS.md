# Concerns & Technical Debt

## Known Issues

### 1. Stripe Webhook Event Deduplication (Payment Processing)
**Status**: Known limitation documented in tests
**Severity**: Medium
**Files**: `backend/test/integration/payment.lifecycle.test.ts` (lines 826-828, 920)
**Description**: No idempotency deduplication for duplicate Stripe webhook events. If Stripe delivers the same event twice (e.g., `payment_succeeded`), notifications fire multiple times. Tests explicitly note this gap.
**Impact**: Users may receive duplicate notification emails/push notifications for the same payment event.
**Workaround**: Currently working as designed; idempotency implementation deferred.

### 2. Timestamp Microsecond Precision (Message Ordering)
**Status**: Known regression
**Severity**: Low
**File**: `backend/test/services/messages.test.ts` (line 409)
**Description**: PostgreSQL stores timestamps with microsecond precision, which can cause subtle ordering issues in tests and edge cases with rapid message creation.
**Impact**: Tests mock timestamps to work around this; production queries should account for microsecond variance.
**Mitigation**: Use database-level ordering with `ORDER BY created_at, id` in queries requiring strict ordering.

### 3. No Visual Regression Testing (Mobile & RTL)
**Status**: Feature gap - no mitigation
**Severity**: Medium
**Description**: Codebase has visual regression snapshots in `frontend/e2e/visual.spec.ts` but they only have macOS baselines. CI runs on Linux, so visual comparisons can't validate correctly. RTL/landscape/safe area layout issues can slip through.
**Impact**: Mobile app (Capacitor) with RTL and landscape mode is high-risk for visual regressions—safe area positioning, keyboard overlays, RTL text direction can break without detection.
**Recommendation**: Generate Linux snapshot baselines or switch to centralized screenshot hosting (Percy, Chromatic).

### 4. Plural Strings — ICU Migration Complete
**Status**: Resolved (as of 2026-03-09 i18n migration)
**Files**: `frontend/src/i18n/en/` and `ar/` namespace directories
**Description**: All plural strings have been migrated to ICU Message Format. No `(s)` workaround patterns remain. English uses `{count, plural, one {…} other {…}}`. Arabic uses all 6 CLDR forms (zero/one/two/few/many/other).
**Verification**: `grep -r "(s)" frontend/src/i18n/` returns no matches.

### 5. OnboardingWizard Translation Refactoring Needed
**Status**: Documented TODO
**Severity**: Low (code quality, not functional)
**File**: `frontend/src/components/onboarding/OnboardingWizard.tsx` (line 388)
**Description**: Component uses legacy translation wrapper function (`t()`) that maps full dotted keys (`'namespace.key'`) instead of passing namespace translators directly to sub-components (`PickPageStep`, `ReviewInfoStep`). After i18n migration to `next-intl`, this pattern should be refactored.
**Impact**: No runtime issue; slight complexity in translation function management.
**Refactoring**: Pass `useTranslations()` hooks directly to sub-components and remove the wrapper.

## Technical Debt

| Area | Description | Severity | File(s) |
|------|-------------|----------|---------|
| **Fastify Plugin Versions** | @fastify/* plugins are all on Fastify 5 compatible versions (verified in package.json), but older projects might have stale dependencies in lock files. | Low | `backend/package.json` |
| **IP-Based Geolocation** | Primary: Cloudflare `CF-IPCountry` header. Fallback: geoip-lite (npm, offline). MaxMind/IP-API are not implemented. | Low | `backend/src/middleware/geo.ts` (line 25) |
| **E-commerce Integrations** | Code explicitly notes "future WooCommerce, etc." Current platforms: Shopify + Salla + Zid. | Low | `backend/src/integrations/` |
| **Product Image URL Field** | Schema has `imageUrl` column (line 699 in `schema.ts`) marked "future use", not yet integrated into product sync or AI context. | Low | `backend/src/db/schema.ts` (line 699) |
| **Backwards Compatibility Shims** | `comments.ts` has unpaginated `getCommentsForUser()` wrapper for backwards compatibility. Safe but adds small API surface. | Low | `backend/src/services/comments.ts` (lines 180-221) |
| **Type Casting for Dynamic i18n Keys** | Smart status banner and theme selector use `as any` casts for dynamic translation key lookups (e.g., `t(labelKey as any)`). Should use type-safe lookup builder. | Low-Medium | `frontend/src/components/dashboard/SmartStatusBanner.tsx`, `frontend/src/components/settings/ThemeSelector.tsx` |
| **Database Schema Versioning** | Schema uses `kbVersion` and `kbActiveVersion` pattern for knowledge base ingestion. This works but could be abstracted into generic versioning utility if more resources need versioning later. | Low | `backend/src/db/schema.ts` (lines 115-118) |
| **Semantic Cache Skip Logic** | Cache skips certain intents (`PRICE`, `PURCHASE_INTENT`) and when `customerContext` is provided. This is intentional but adds hidden complexity to cache invalidation. | Medium | `backend/src/services/kb/semantic-cache.ts` (lines 27-80) |

## Security Considerations

### 1. Sanctioned Country Checks (CRITICAL)
**Status**: Implemented and enforced
**Files**: `backend/src/utils/sanctions.ts`, `backend/test/utils/sanctions.test.ts`, middleware usage in payment flows
**Implementation**:
- Sanctioned countries (Cuba, Iran, North Korea, Syria) and regions (Crimea, Luhansk, Donetsk) are checked BEFORE any Stripe API call
- Check happens at geolocation detection level (middleware) and payment controller level (redundancy)
- Checks are properly scoped: `isSanctioned(country, region)` and `isSanctionedGeo(geo)`
- Tests verify correct behavior for sanctioned/non-sanctioned cases

**Compliance**: ✅ Meets AI_INSTRUCTIONS.md requirement: "Block Stripe API calls for users from sanctioned countries BEFORE making any request."

### 2. Refresh Token Security
**Status**: Implemented
**Files**: `backend/src/db/schema.ts` (lines 78-93)
**Details**:
- Tokens stored as hashes (not plaintext)
- Token rotation tracking via `replacedByTokenHash`
- Revocation support via `revokedAt` timestamp
- Indexes on `user_id` and `tokenHash` for efficient lookups

### 3. Workspace Invite Token Security
**Status**: Implemented
**Files**: `backend/src/db/schema.ts` (lines 57-76)
**Details**:
- Invite tokens stored as `tokenHash` (not plaintext)
- Expiration enforcement via `expiresAt`
- Status tracking: `pending`, `accepted`, `expired`, `revoked`
- Unique constraints prevent duplicate invites
- Audit trail: `createdBy`, `usedBy` tracking

### 4. Facebook Access Token Storage
**Status**: Implemented with field-level encryption
**Files**: `backend/src/db/schema.ts` (line 12 - users table, line 102 - pages table), `backend/src/services/facebook.ts`
**Details**:
- Page access tokens are encrypted AES-256-GCM before storage via `maybeEncryptPageToken()` / `maybeDecryptPageToken()`
- Encryption key configured via `FACEBOOK_TOKEN_ENCRYPTION_KEY` environment variable (see INTEGRATIONS.md)
- IV stored alongside ciphertext in the `pages.accessToken` column
- User-level `facebookAccessToken` in users table (short-lived, used for OAuth) follows same protection
- Database is also encrypted at rest (Postgres instance-level or hosting provider) — defense in depth

### 5. Stripe Webhook Signature Verification
**Status**: Implemented
**Files**: `backend/src/services/stripe.ts` (used in payment routes)
**Details**: `verifyWebhookSignature()` called on all incoming Stripe webhooks before processing
**Risk**: Low—standard Stripe SDK practice

### 6. Log Sanitization
**Status**: Implemented
**Files**: `backend/src/utils/logSanitizer.ts`, `backend/test/utils/logSanitizer.test.ts`
**Details**: Tokens, API keys, email addresses, and PII are sanitized before logging to prevent accidental leakage in error messages
**Scope**: All server-side logging uses this utility

## Performance Concerns

### 1. Semantic Cache Exclusions
**Status**: Intentional optimization
**Severity**: Low
**File**: `backend/src/services/kb/semantic-cache.ts`
**Details**: Semantic cache is skipped for `PRICE` and `PURCHASE_INTENT` intents to ensure fresh KB lookup for price-sensitive replies. Also skipped when `customerContext` (personalization) is present.
**Impact**: Positive (avoids stale price data), but reduces cache hit rate for these intent types.
**Risk**: If SKU/price catalog updates frequently, skipping semantic cache is correct. If rare, consider caching with TTL.

### 2. Parallel Comment/Post Lookups
**Status**: Optimized
**Severity**: N/A (good practice documented)
**File**: `backend/src/services/comments.ts` (line 54)
**Details**: Two lookups for comment metadata run in parallel to avoid sequential N+1 queries.
**Positive**: Already follows best practices.

### 3. Facebook API Field Selection
**Status**: Optimized
**File**: `backend/src/services/facebook.ts` (line 80)
**Details**: Explicitly requests only needed fields (`id,name,email,picture.type(large)`) to reduce payload size.

### 4. Knowledge Base Ingestion (No Pagination)
**Status**: Potential bottleneck for large KBs
**Severity**: Low-Medium
**Files**: `backend/src/services/kb/`
**Details**: When ingesting product catalog or FAQ, all items are loaded into memory before embedding. For stores with thousands of products, this could cause memory spikes.
**Risk**: Medium if store has >5000 products. Salla API has `per_page` param (max 250); chunking is applied per request.
**Mitigation**: Chunking is implemented; streaming large batches would be next optimization.

### 5. Redis SSE Subscriber Error Handling
**Status**: Logging only
**File**: `backend/src/lib/eventBus.ts` (line 33)
**Details**: `console.error('Redis SSE Subscriber Error:', err)` logs but doesn't retry or escalate. If Redis connection drops, real-time subscribers silently disconnect.
**Risk**: Low in production (Redis is managed); higher in local dev if Redis crashes.
**Recommendation**: Add exponential backoff reconnection and Sentry capture for infrastructure errors.

### 6. Bundle Size / Next.js Performance
**Status**: Lighthouse CI gates in place
**Details**: Hard gates on accessibility (>90) and CLS (<0.1); soft gates on performance (>70). Currently passing all gates.
**Risk**: Low—automated monitoring prevents regressions.

## Fragile Areas

### 1. Geolocation Fallback Chain
**Severity**: Low
**File**: `backend/src/middleware/geo.ts`
**Details**: Two-tier implementation: (1) Cloudflare `CF-IPCountry` header; (2) geoip-lite (npm, offline local DB). If both sources are unavailable or ambiguous, sanctions checks may fail silently.
**Risk**: Low for current Cloudflare-based production deployment. Higher if deployed behind a non-Cloudflare proxy that drops CDN headers (geoip-lite covers this).
**Remaining gap**: MaxMind/IP-API (cloud-based accuracy upgrade) not implemented — not needed for current use.

### 2. Workspace Member Roles
**Status**: Simple string enum
**Files**: `backend/src/db/schema.ts` (line 46)
**Details**: Role stored as varchar enum (`'owner' | 'admin' | 'member'`). No database-level check constraint. Adding new roles requires migrations and schema updates.
**Risk**: Low if roles rarely change. High if multi-tenancy grows and fine-grained permissions needed.

### 3. Page/Post Unique Constraints Rely on External IDs
**Status**: By design
**Files**: `backend/src/db/schema.ts` (lines 100, 138)
**Details**: Pages and posts use Facebook's IDs as unique constraints. If Facebook ID scheme changes or collides, duplicates could be inserted.
**Risk**: Very low—Facebook IDs are stable and collision-proof.

### 4. Business Profile JSONB (Unversioned)
**Status**: Schema has no validation
**Files**: `backend/src/db/schema.ts` (line 120)
**Details**: `businessProfile` and `suggestedKnowledgeBase` are free-form JSONB. No JSON schema validation on insert. Corrupted data could break AI context builders.
**Risk**: Medium—bad data silently breaks AI replies.
**Mitigation**: Validation happens in services (`businessProfile.ts`), not database. Consider Postgres CHECK constraints or runtime schema validation.

### 5. Payment Webhook Order Sensitivity
**Status**: Documented race condition (Scenario 7)
**Files**: `backend/test/integration/payment.lifecycle.test.ts` (lines 849-856)
**Details**: Stripe can deliver `payment_succeeded` before `checkout.session.completed`. Test documents graceful handling, but events are processed sequentially without full idempotency.
**Risk**: Subscription state could be inconsistent in rare race conditions.
**Workaround**: Test scenarios verify key transitions work; event deduplication is noted as future work.

### 6. AI Prompt Version Management
**Status**: Manual version bumping
**Files**: `backend/src/config/aiPricing.ts`, `ai-worker/src/`
**Details**: `PROMPT_VERSION` is hardcoded in code (currently v21). Changing prompts requires code deploy + AI worker restart.
**Risk**: Medium—prompt bugs are discovered post-deploy; rollback requires code push.
**Improvement**: Move prompt versions to database/Redis so they can be hot-swapped without redeployment.

### 7. Mobile Safe Area Hardcoding Risk
**Severity**: High (visual/usability)
**Files**: All CSS in `frontend/src/styles/globals.css` define `--sai-*` variables with fallback values
**Details**: If safe area CSS is accidentally removed or overridden inline, mobile app layout breaks on notched/folded devices.
**Risk**: High—instructions strictly forbid hardcoding safe areas, but CSS class names are easily misused.
**Mitigation**: ESLint rule to catch `env(safe-area-inset-*)` usage outside globals.css would help; currently relies on code review.

### 8. Translation Key Nesting Depth
**Status**: Validator enforces 2-level max
**Files**: All `frontend/src/i18n/en/` and `ar/` namespace files
**Details**: Validator forbids keys deeper than `{ namespace: { nestedKey: value } }`. No further nesting allowed.
**Risk**: Low—validator catches violations. Violation would block deployment.

## TODOs in Codebase

### 1. OnboardingWizard Refactoring
**File**: `frontend/src/components/onboarding/OnboardingWizard.tsx:388`
**Task**: "Refactor PickPageStep/ReviewInfoStep to accept namespace translators directly"
**Impact**: Low (code quality, not functional)
**Status**: Deferred post-i18n migration

### 2. IP-Based Geolocation — MaxMind/IP-API Upgrade
**File**: `backend/src/middleware/geo.ts:25`
**Task**: "Note: IP-based geolocation fallback (MaxMind, IP-API) can be added later"
**Impact**: Low — geoip-lite already covers the non-CDN case
**Status**: Not needed unless higher geolocation accuracy is required

### 3. Product Image Integration
**File**: `backend/src/db/schema.ts:699`
**Task**: "Main product image URL (future use)"
**Impact**: Low (product context enrichment)
**Status**: Deferred to v2 (not yet integrated into sync or AI)

### 4. E-commerce Integrations (WooCommerce)
**Files**: `backend/src/integrations/`
**Task**: "Future WooCommerce, etc."
**Impact**: Medium (integration coverage)
**Status**: Deferred; Shopify + Salla + Zid currently supported

## Planned Features

### E-Commerce Customer Notifications
**Plan**: `.planning/ECOMMERCE_NOTIFICATIONS_PLAN.md`
**Scope**: Abandoned cart recovery, order status notifications (confirmed/shipped/delivered), review requests, digital product delivery — for Salla, Shopify, and Zid.
**Channel**: SMS via Vonage (current) → WhatsApp Cloud API (when Meta approves).
**Status**: Fully planned, not yet implemented. Estimated 3–4 weeks.

---

## Deferred Work

### Tier 1 — Known Gaps (Medium Priority)

1. **Stripe Webhook Idempotency**
   - Duplicate events can cause duplicate notifications
   - Idempotency key tracking deferred
   - Workaround: Current behavior documented in tests

2. **Visual Regression Testing (Linux Baselines)**
   - Mobile and RTL layout regressions can slip through
   - Current snapshots only have macOS baselines
   - Deferred pending CI infrastructure change

3. **Plural Translation Migration (ICU Format)**
   - ✅ Completed — all `(s)` patterns replaced with ICU format
   - Arabic uses all 6 CLDR plural forms

### Tier 2 — Future Features (Low Priority)

1. **Field-Level Encryption for Tokens**
   - ✅ Facebook page tokens are AES-256-GCM encrypted at rest (shipped)
   - See Security section #4 and INTEGRATIONS.md for details
   - No further action needed unless scope expands to other token types

2. **Prompt Version Hot-Swapping**
   - AI prompt version hardcoded in code (currently v21)
   - Changing requires deploy + restart
   - Database/Redis version management deferred

3. **OnboardingWizard Translation Refactoring**
   - Minor code quality improvement post-i18n migration
   - No functional impact

4. **Knowledge Base Pagination for Large Catalogs**
   - Large product syncs load all items in memory
   - Streaming/pagination deferred
   - Affects stores with >5000 products

5. **IP-based Geolocation — MaxMind/IP-API Upgrade**
   - Cloudflare + geoip-lite (offline) already implemented
   - MaxMind/IP-API cloud accuracy upgrade deferred — low priority

## Recommendations

### Priority 1 — Address Before Production Release

1. **Linux Visual Regression Baselines** (Medium effort, High impact)
   - Generate and commit visual snapshots on Linux CI environment
   - Prevents RTL, landscape, safe area regressions from silently breaking mobile app
   - File: `frontend/e2e/visual.spec.ts`
   - Recommendation: Run `npm run test:e2e -- visual.spec.ts --update-snapshots` on CI Linux machine before merging

2. **Webhook Idempotency Keys** (Medium effort, Medium impact)
   - Implement Stripe `idempotency_key` tracking in `webhook_events` table
   - Skip re-processing duplicate events
   - Files: `backend/src/db/schema.ts`, `backend/src/controllers/payment.ts`
   - Current state: Test documents gap; users may receive duplicate notifications

3. **Database Validation for businessProfile JSON** (Low-medium effort, Medium impact)
   - Add Postgres CHECK constraint or runtime schema validation on `businessProfile` JSONB
   - Prevents corrupt data from breaking AI context builders
   - File: `backend/src/db/schema.ts`, `backend/src/utils/businessProfile.ts`

### Priority 2 — Address in Next Cycle

4. **Geolocation — MaxMind/IP-API Upgrade** (Low effort, Low impact)
   - Cloudflare + geoip-lite already provide two-tier fallback
   - MaxMind/IP-API cloud upgrade only needed for higher geolocation accuracy
   - File: `backend/src/middleware/geo.ts`

5. **Complete ICU Plural Migration** (Low effort, Low impact)
   - Audit all translation keys for `(s)` patterns
   - Migrate to full ICU format with all Arabic forms
   - Files: `frontend/src/i18n/en/`, `frontend/src/i18n/ar/`
   - Run: `npm run translation:validate` to check for remaining gaps

6. **ESLint Rule for Safe Area Hardcoding** (Low effort, High impact)
   - Add lint rule to forbid `env(safe-area-inset-*)` outside `globals.css`
   - Catch accidental safe area hardcoding at code review time
   - File: `.eslintrc.js`

### Priority 3 — Consider for Future Releases

7. **Refactor OnboardingWizard Translation** (Low effort, Low impact)
   - Pass namespace translators directly to sub-components
   - File: `frontend/src/components/onboarding/OnboardingWizard.tsx`

8. **Field-Level Encryption for Tokens** — ✅ Shipped
   - Facebook page tokens are now AES-256-GCM encrypted (FACEBOOK_TOKEN_ENCRYPTION_KEY)
   - No further action needed unless other token types require the same treatment

9. **Prompt Version Hot-Swapping** (Medium effort, Medium impact)
   - Move `PROMPT_VERSION` to Redis/database
   - Allow prompt changes without code deploy
   - Useful when experimenting with eval iterations
   - Files: `ai-worker/src/`, `backend/src/config/`

10. **Knowledge Base Streaming/Pagination** (Medium-high effort, Low impact)
    - Refactor product sync to stream batches instead of loading all in memory
    - Affects stores with >5000 products
    - Files: `backend/src/services/shopify.ts`, `backend/src/services/salla.ts`

## Testing Gaps & CI Coverage

### What's Covered (Tier 1 — Automatic)
- ✅ Unit tests (backend, frontend, AI worker)
- ✅ Integration tests (real DB, Stripe API mocked)
- ✅ E2E tests (17 spec files covering all major flows)
- ✅ SEO regression tests (39 tests for meta, hreflang, JSON-LD, robots.txt)
- ✅ Lighthouse CI (accessibility >90, CLS <0.1)
- ✅ Docker smoke tests (image builds, container startup)
- ✅ Post-deploy health checks (6-point verification)

### What's NOT Covered (Gaps)
- ❌ Visual regression tests are defined but **Linux baselines don't exist** — can't validate in CI
- ❌ **Stripe payment webhook timing/race conditions** — partially tested in isolated scenarios, not full integration
- ❌ **Mobile app Capacitor-specific scenarios** — keyboard events, app lifecycle, native module integration
- ❌ **RTL/Arabic layout testing** — tested in E2E but no visual baseline
- ❌ **Landscape mode on actual devices** — CSS exists, but no real device testing

### How to Close Gaps
1. Generate Linux visual baselines (highest priority for mobile safety)
2. Add mobile Capacitor test suite for app lifecycle
3. Expand payment webhook tests to include timing variations
4. Add device farm tests for real mobile devices (future)

---

## Summary

**Critical Issues**: Visual regression gap for mobile (RTL/landscape), webhook idempotency gap for payments, JSON validation gap for business profile.

**Medium Issues**: Geolocation fallback missing, type casting for i18n keys.

**Low Issues**: Backwards compatibility shims, future feature placeholders, refactoring TODOs.

**Overall Assessment**: Codebase is well-structured with good test coverage and security practices. Main risks are **visual/layout regressions in mobile app** and **payment webhook edge cases**. Both have clear remediation paths documented above.
