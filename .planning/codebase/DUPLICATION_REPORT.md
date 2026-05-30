# Code Duplication & Clean Code Report

**Analysis Date:** 2026-03-30
**Scope:** backend/src/services/, backend/src/controllers/, frontend/src/components/, frontend/src/hooks/, frontend/src/pages/

> **Status update 2026-05-30 (backend e-commerce items):**
> - ✅ **M7 RESOLVED** — `authCallback` (and `authRedirect`) extracted into `createEcommerceControllers`; Salla + Zid now share one implementation (Shopify deliberately untouched — domain-input flow). salla.ts 269→149, zid.ts 244→137; 3744 backend tests green.
> - ✅ **M3 RESOLVED** — `utils/hmacVerify.ts` (`verifyHexHmac`/`verifyBase64Hmac`); Salla/Zid/Shopify delegate.
> - ✅ **M2 RESOLVED** — `utils/httpRetry.ts` exists.
> - 🟡 **H2 MOSTLY RESOLVED** — shared `services/ecommerceTokenRefresh.ts` core; thin per-platform `refreshAccessToken` wrappers remain.
> - ✅ **M1 RESOLVED (Salla↔Zid)** — `resolveStoreAccessToken(storeId, cfg)` added to `ecommerceTokenRefresh.ts`; Salla + Zid `resolveStoreCredentials` now delegate. Shopify NOT folded in — it has no token refresh + a different return shape (kept separate, same rationale as M7/Shopify).
> - ✅ **H3 RESOLVED** — dead `ShopifySection.tsx` already deleted.
> - Still open (backend): **M4** webhook-HMAC controller boilerplate, **M6** isProductEvent, **L4** Shopify protected-handler dup. Frontend: **H1** onboarding wizard now triplicated (shopify/salla/zid — got worse), H4/H5, M5/M8.

---

## Summary

| Severity | Count |
|----------|-------|
| High     | 5     |
| Medium   | 8     |
| Low      | 4     |

---

## HIGH Severity

---

### H1 — Onboarding pages `shopify/onboarding.tsx` and `salla/onboarding.tsx` are near-identical

**Files:**
- `frontend/src/pages/shopify/onboarding.tsx` (lines 1–421)
- `frontend/src/pages/salla/onboarding.tsx` (lines 1–415)

**What is duplicated:**
Both files are 400+ line identical 4-step onboarding wizards. The only differences are:
- The API client (`shopifyApi` vs `sallaApi`)
- The translation namespace (`'shopify'` vs `'salla'`)
- The brand color (`emerald` vs `teal`)
- The post-link redirect path (`/shopify/onboarding` vs `/salla/onboarding`)

Every piece of logic — state machine (`step`, `syncStatus`, `storeLoading`, `linking`), `fetchStore`, `handleRetrySync`, `fetchPages`, `handleLinkPage`, and the entire JSX tree — is copy-pasted verbatim. A third Zid onboarding page does not exist yet, meaning the pattern would be copied a third time when Zid onboarding is added.

**Suggested fix:**
Extract a single `EcommerceOnboarding` component accepting a `platform` prop:
```tsx
// frontend/src/pages/[platform]/onboarding.tsx  — or a shared component
interface OnboardingConfig {
  platform: 'shopify' | 'salla' | 'zid';
  translationNs: string;
  brandColor: string; // e.g. 'emerald' | 'teal'
  platformApi: typeof shopifyApi;
}
```
The config controls translation namespace and branding. All state, effects, and JSX are in one place.

---

### H2 — `refreshAccessToken` / `ensureValidToken` / `getStoresNeedingTokenRefresh` / `refreshExpiringTokens` fully duplicated across `salla.ts` and `zid.ts`

**Files:**
- `backend/src/services/salla.ts` (lines 91–179, 457–474)
- `backend/src/services/zid.ts` (lines 92–168, 427–444)

**What is duplicated:**
The token lifecycle (refresh with Redis distributed lock, validity check, find expiring stores, periodic refresh loop) is structurally and logically identical between Salla and Zid. The only differences are the Redis lock key prefix (`salla:` vs `zid:`), the token endpoint URL, and the `config.salla.*` vs `config.zid.*` references. Even the error messages follow the same template.

Specific identical blocks:
- Redis NX lock acquire/release pattern: `salla.ts:92–99` ≡ `zid.ts:93–99`
- `oneDayFromNow` token expiry check: `salla.ts:107,161` ≡ `zid.ts:105,154`
- `twoDaysFromNow` for `getStoresNeedingTokenRefresh`: `salla.ts:171` ≡ `zid.ts:161`
- `refreshExpiringTokens` loop body: `salla.ts:457–474` ≡ `zid.ts:427–444`

**Suggested fix:**
Extract a `createTokenRefreshManager(platform, config)` factory in a shared file (e.g., `backend/src/services/platformTokenManager.ts`). Both `salla.ts` and `zid.ts` call it with their platform-specific config. The manager returns `{ refreshAccessToken, ensureValidToken, getStoresNeedingTokenRefresh, refreshExpiringTokens }`.

---

### H3 — `ShopifySection` component is a fully deprecated copy of `EcommerceSection`

**Files:**
- `frontend/src/components/settings/ShopifySection.tsx` (lines 1–152, marked `@deprecated`)
- `frontend/src/components/settings/EcommerceSection.tsx` (lines 1–175)

**What is duplicated:**
`ShopifySection` is ~130 lines of JSX that duplicates `EcommerceSection` line-for-line. It was not removed when `EcommerceSection` was created and the deprecation comment has been there since. It has identical state shape, identical hooks (`isMounted`, `fetchStore`, `fetchPages`, `handleSync`, `handleDisconnect`, `handleLinkPage`), and identical JSX.

**Suggested fix:**
Delete `frontend/src/components/settings/ShopifySection.tsx` entirely. Verify no remaining imports:
```bash
grep -r "ShopifySection" frontend/src --include="*.tsx"
```

---

### H4 — Inline SVG platform icons (`Instagram`, `Facebook`) copy-pasted across 3 components

**Files:**
- `frontend/src/components/comments/CommentCard.tsx` (lines 118–131)
- `frontend/src/components/comments/CommentDetailModal.tsx` (lines 239–256)
- `frontend/src/components/messages/MessageDetailModal.tsx` (lines 313–330)

**What is duplicated:**
The same `<svg viewBox="0 0 24 24">` blocks for Instagram (194-char path string) and Facebook (193-char path string) appear verbatim in all three files, wrapped in the same `clsx` container with the same pink/blue conditional styling (`bg-pink-50 text-pink-600 dark:bg-pink-900/20 dark:text-pink-400` for Instagram, `bg-blue-50 text-blue-600 dark:bg-blue-900/20 dark:text-blue-400` for Facebook). If the icon path or brand color changes, it must be updated in 3 places.

**Suggested fix:**
Create `frontend/src/components/ui/PlatformIcon.tsx`:
```tsx
export function PlatformIcon({ platform }: { platform: 'instagram' | 'facebook' }) {
  // single implementation of the icon + container
}
```
All three call sites replace ~15 lines each with `<PlatformIcon platform={isInstagram ? 'instagram' : 'facebook'} />`.

---

### H5 — `checkNeedsAttention` function defined twice (exported from `CommentCard`, re-defined inline in `CommentDetailModal`)

**Files:**
- `frontend/src/components/comments/CommentCard.tsx` (lines 54–63) — exported
- `frontend/src/components/comments/CommentDetailModal.tsx` (lines 138–143) — private, identical body

**What is duplicated:**
`CommentDetailModal` defines a private `checkNeedsAttention(c: Comment): boolean` at line 138 that is identical to the exported one in `CommentCard.tsx`. The same keyword list (`helpKeywords`) and the same `.some(kw => messageText.includes(kw))` logic appear in both. `CommentDetailModal` already imports from `CommentCard` (via `ReplyFeedback` and `Comment` type) but does not import the exported function.

**Suggested fix:**
In `CommentDetailModal`, replace the private function definition with an import:
```tsx
import { checkNeedsAttention } from './CommentCard';
```
Remove lines 138–143 from `CommentDetailModal.tsx`.

---

## MEDIUM Severity

---

### M1 — `resolveStoreCredentials` function duplicated in `salla.ts`, `shopify.ts`, and `zid.ts`

**Files:**
- `backend/src/services/salla.ts` (lines 484–490)
- `backend/src/services/shopify.ts` (lines 574–579)
- `backend/src/services/zid.ts` (lines 450–456)

**What is duplicated:**
All three files define a private `resolveStoreCredentials` that calls `ensureValidToken`, `getStoreById`, checks `isActive`, and decrypts the token. The Salla and Zid versions return `string | null`; the Shopify version returns `{ storeDomain; accessToken } | null`. The logic is the same.

**Suggested fix:**
Move to `backend/src/services/ecommerce.ts` as an exported utility. The Shopify variant can be a thin wrapper that also returns `storeDomain`.

---

### M2 — Retry-with-backoff HTTP pattern triplicated in `salla.ts`, `shopify.ts`, `zid.ts`

**Files:**
- `backend/src/services/salla.ts` (lines 253–287, `sallaApiGet`)
- `backend/src/services/shopify.ts` (lines 231–274, `shopifyGraphQL`)
- `backend/src/services/zid.ts` (lines 238–274, `zidApiGet`)

**What is duplicated:**
All three implement the same retry loop: `for attempt in 0..MAX_RETRIES`, check `status === 429 || status >= 500`, read `retry-after` header, fall back to `RETRY_BASE_DELAY_MS * Math.pow(2, attempt)`, sleep, continue. The loop structure and error path are identical. Constants are defined identically in each file (`MAX_RETRIES = 3`, `RETRY_BASE_DELAY_MS = 1000`).

**Suggested fix:**
Extract `backend/src/utils/httpRetry.ts`:
```ts
export async function fetchWithRetry(url: string, options: RequestInit, tracedFn: ..., maxRetries = 3): Promise<Response>
```
Each service calls `fetchWithRetry` instead of implementing its own loop.

---

### M3 — `verifyWebhookHmac` implemented identically in `salla.ts` and `zid.ts` (hex HMAC)

**Files:**
- `backend/src/services/salla.ts` (lines 183–193)
- `backend/src/services/zid.ts` (lines 173–183)

**What is duplicated:**
Both implement `verifyWebhookHmac(body, signature)` using hex digest + `timingSafeEqual`. The bodies are line-for-line identical except for the config reference (`config.salla.webhookSecret` vs `config.zid.webhookSecret`). Shopify uses base64 so differs legitimately.

**Suggested fix:**
Extract `backend/src/utils/hmacVerify.ts`:
```ts
export function verifyHexHmac(body: string, signature: string, secret: string): boolean
export function verifyBase64Hmac(body: string, signature: string, secret: string): boolean
```
Both `salla.ts` and `zid.ts` call `verifyHexHmac`. `shopify.ts` calls `verifyBase64Hmac`.

---

### M4 — Webhook HMAC verification boilerplate duplicated across controllers

**Files:**
- `backend/src/controllers/shopify.ts` (lines 155–161, 172–181, 202–215) — 3 separate functions + extracted helper
- `backend/src/controllers/salla.ts` (lines 124–137) — local helper `verifySallaWebhookHmac`
- `backend/src/controllers/zid.ts` (lines 118–131) — local helper `verifyZidWebhookHmac`

**What is duplicated:**
Each controller defines a local function that reads `rawBody`, checks for its presence, calls `verifyWebhookHmac`, and sends 401 on failure. The body of each is identical except for the header name and the service call. The Shopify controller partially extracted this into `verifyShopifyWebhookHmac` but still has two earlier handlers that do it inline.

**Suggested fix:**
A shared middleware factory `createWebhookHmacMiddleware(headerName, verifyFn)` or a utility function in `backend/src/utils/webhookVerify.ts` that handles the 401 boilerplate.

---

### M5 — `formatFullTime` and `formatMessageTime` defined identically in both detail modals

**Files:**
- `frontend/src/components/messages/MessageDetailModal.tsx` (lines 236–256)
- `frontend/src/components/comments/CommentDetailModal.tsx` (lines 146–166)

**What is duplicated:**
Both define the exact same two date formatting helpers with identical signatures, identical try/catch fallbacks, and identical logic (24-hour threshold for `formatDistanceToNow` vs `format(d, 'PPp')`). The only difference is that `MessageDetailModal` receives `dateLocale` as a prop while `CommentDetailModal` gets it from `useLanguage()`.

**Suggested fix:**
Extract to `frontend/src/utils/dateFormat.ts`:
```ts
export function formatFullTime(date, locale?): string
export function formatMessageTime(date, locale?): string
```
Both modals import from there.

---

### M6 — `isProductEvent` function defined separately in `salla.ts` and `zid.ts`

**Files:**
- `backend/src/services/salla.ts` (lines 208–210)
- `backend/src/services/zid.ts` (lines 196–198)

**What is duplicated:**
Both export:
```ts
export function isProductEvent(event: string): boolean {
    return event.startsWith('product.');
}
```
Identical bodies. Used in their respective controllers.

**Suggested fix:**
Move to `backend/src/services/ecommerce.ts` or a `backend/src/utils/ecommerceEvents.ts` and import in both.

---

### M7 — `authCallback` in `salla.ts` and `zid.ts` controllers share 80% identical logic

**Files:**
- `backend/src/controllers/salla.ts` (lines 32–120)
- `backend/src/controllers/zid.ts` (lines 32–114)

**What is duplicated:**
Both controllers implement an `authCallback` with near-identical structure:
1. Extract `code` and `state` from query
2. Read and unsign nonce cookie
3. Validate `state !== storedNonce`
4. Clear nonce cookie
5. Exchange code for tokens, fetch store info
6. Branch: logged-in → create store + webhooks + enqueue sync + redirect; not-logged-in → check existing + pending install + cookie + redirect

The branch logic, error handling, and redirect targets follow the same pattern. Differences are platform name, cookie names, and token shape.

**Suggested fix:**
Extract a shared `handleOAuthCallback` utility in `backend/src/controllers/ecommerceControllers.ts` (or a new `backend/src/controllers/oauthCallbackHandler.ts`) that accepts platform-specific config:
```ts
interface OAuthCallbackConfig {
  platform: EcommercePlatform;
  nonceCookieName: string;
  exchangeCodeForToken: (code: string) => Promise<TokenResponse>;
  fetchStoreInfo: (token: string) => Promise<StoreInfo>;
  registerWebhooks: (token: string) => Promise<void>;
  pendingCookieName: string;
  pendingCookieOptions: CookieOptions;
}
```
Both `salla.ts` and `zid.ts` controllers call `handleOAuthCallback(request, reply, config)`.

---

### M8 — `isMounted` ref pattern copy-pasted in `EcommerceSection` and `ShopifySection` (and broadly in pages)

**Files:**
- `frontend/src/components/settings/EcommerceSection.tsx` (lines 22–25)
- `frontend/src/components/settings/ShopifySection.tsx` (lines 23–26)

**What is duplicated:**
```tsx
const isMounted = useRef(true);
useEffect(() => {
  return () => { isMounted.current = false; };
}, []);
```
This is not in `frontend/src/hooks/` yet. It appears in both components. With `ShopifySection` deleted (see H3), this becomes moot in these two files, but the pattern appears elsewhere in pages.

**Suggested fix:**
Add a `useIsMounted` hook to `frontend/src/hooks/`:
```ts
export function useIsMounted(): React.MutableRefObject<boolean>
```

---

## LOW Severity

---

### L1 — `getStoreByUserId` deprecated wrapper not yet removed from `shopify.ts`

**Files:**
- `backend/src/services/shopify.ts` (lines 177–180)
- `backend/src/services/ecommerce.ts` (line 91, `@deprecated` comment)

**What is the issue:**
`getStoreByUserId` is marked `@deprecated` in `ecommerce.ts` at line 90 and in `shopify.ts` at line 177. No code in the current codebase calls it (confirmed via grep — no callers except the re-export chain). It is dead code.

**Suggested fix:**
Remove `getStoreByUserId` from `shopify.ts` and the `@deprecated` export from `ecommerce.ts`. Run `npm run lint` to confirm no callsites break.

---

### L2 — `mapToShopifyStore` alias is dead code

**Files:**
- `backend/src/services/ecommerce.ts` (line 654)
- `backend/src/services/shopify.ts` (line 28) — re-exports it
- `backend/src/controllers/shopify.ts` (line 249) — only callsite

**What is the issue:**
`mapToShopifyStore` is an alias for `mapToEcommerceStore`. It only exists for backward compat and has exactly one callsite in `shopify.ts` controller line 249. Salla and Zid controllers use `mapToEcommerceStore` directly (via `createEcommerceControllers`). The Shopify controller is the outlier.

**Suggested fix:**
Change `shopify.ts` controller line 249 to `mapToEcommerceStore(store)`, remove the `mapToShopifyStore` export from both files.

---

### L3 — `shopifySyncQueue.ts` and `shopifySyncWorker.ts` deprecated shim files

**Files:**
- `backend/src/lib/shopifySyncQueue.ts`
- `backend/src/workers/shopifySyncWorker.ts`

**What is the issue:**
Both files are 2–5 line shims that re-export from their `ecommerce*` counterparts. They exist only for backward compatibility. No external code should be using the old names, but they add noise and confuse future readers.

**Suggested fix:**
Search for any remaining imports of `shopifySyncQueue` or `shopifySyncWorker` in the codebase, migrate them to `ecommerceSyncQueue`/`ecommerceSyncWorker`, and delete the shim files.

---

### L4 — Shopify controller duplicates `getStore` / `disconnectStoreHandler` / `syncStore` / `getStoreProducts` / `linkPage` / `unlinkPage` logic already in `createEcommerceControllers`

**Files:**
- `backend/src/controllers/shopify.ts` (lines 241–343)
- `backend/src/controllers/ecommerceControllers.ts` (lines 38–122)

**What is the issue:**
`salla.ts` and `zid.ts` controllers use `createEcommerceControllers` to get all 7 protected handlers. `shopify.ts` controller implements all 7 by hand (pre-dating the factory). The logic is identical — only the platform string and service calls differ. Every future change to these handlers must be made in both places.

**Suggested fix:**
Refactor `shopify.ts` controller to use `createEcommerceControllers` the same way Salla and Zid do. The Shopify OAuth flow (which uses domain input) stays as-is in the controller; only the protected API section (lines 241–343) is replaced with the factory call.

---

## Patterns Not Yet Extracted (Cross-Cutting)

These patterns repeat across many files but have no shared utility yet:

| Pattern | Count | Suggested location |
|---------|-------|--------------------|
| `axios.isAxiosError(error) ? error.response?.data?.error?.message \|\| error.message : ...` | 24 occurrences | `backend/src/utils/axiosError.ts → extractAxiosErrorMessage(error)` |
| `const req = request as WorkspaceRequest; if (!req.workspaceId) return reply.status(401)...` | 12 guards, 62 casts | Already partially extracted via `createEcommerceControllers`; remaining controllers could use a shared `requireWorkspace(request, reply)` helper |
| `oneDayFromNow = new Date(Date.now() + 24 * 60 * 60 * 1000)` | 4 occurrences in salla+zid | `backend/src/utils/timeHelpers.ts → daysFromNow(n: number): Date` |

---

*Report generated: 2026-03-30*
