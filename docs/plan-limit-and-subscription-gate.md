# Plan Limit UX + Subscription Gate

> Shipped: 2026-04-23
> Owners: billing / reply pipeline

What the merchant sees when they approach, hit, or fall past their plan — and how the webhook pipeline decides whether to send a reply at all.

---

## Problem

Before this change, two things were broken:

1. **AI quota exhaustion was silent.** A merchant on Starter (500 Smart Replies/mo) could go viral on day 20, hit their limit mid-month, and have no idea. Auto-reply kept firing but with a hardcoded English fallback string. They only found out from angry customers. No in-app warning, no email, no banner — nothing until a complaint.

2. **Subscription cancellation didn't actually stop service.** The AI path had a subscription check, but Post Replies (per-post keyword → DM) fired **before** that check in `commentProcessor`. So a merchant could subscribe, configure their keyword-trigger funnel, cancel, and keep receiving the most commercially valuable part of the product indefinitely. Free tier by accident.

The goal: match industry-standard SaaS billing UX — progressive warnings as quota fills, and a hard stop (with a short grace window) when the plan goes inactive.

---

## What ships

### 1. Proactive AI-usage notifications at 80% and 100%

When `aiRepliesCount` crosses a threshold inside a single increment, dispatch one bilingual (EN/AR) notification per period.

- **80%** warning: "You're approaching your monthly reply limit"
- **100%** limit reached: "Smart Reply limit reached — Post Replies and away messages still work"

Once per threshold per period — enforced with Redis `SET NX` keyed on `userId + periodStart + threshold` (40-day TTL so dedup survives any billing period).

### 2. Dashboard banner at ≥80%

New component `AiUsageWarningBanner` rendered above `CommandCenter`.

- Amber at 80–99% — dismissible 24h via `useTimedDismiss` (same pattern as `SmartStatusBanner`)
- Red at ≥100% — not dismissible
- Shows `{used} of {limit} Smart Replies used · resets on {date}`
- Reuses `UpgradeCTA` (native + web aware)
- If the user dismissed the 80% warning and later crosses 100%, the red banner **still** shows (different dismiss key per severity)

### 3. Structured API error on limit-reached

`POST /ai/generate-async` returns `403` with:

```json
{
  "error": "Monthly AI reply limit reached",
  "code": "ai_limit_reached",
  "limit": 500,
  "used": 500,
  "resetsAt": "2026-05-15T00:00:00Z"
}
```

Clients switch on `code`, not parsed English strings. `resetsAt` lets the UI show the reset date without another round-trip.

### 4. Subscription gate — blocks ALL auto-reply paths when plan is inactive

New helpers in `subscriptions.ts`:

- **`canAutoReply(userId)`** — pure gate. Returns `{allowed, reason}`. Allows `active`, `trialing` (in-window), `past_due` inside 3-day grace, and users with no subscription row (onboarding). Blocks everything else.
- **`enforceAutoReplyGate(userId)`** — same result + dispatches a one-per-24h `auto_reply_paused_billing` notification (Redis `SET NX` dedup).

Both `commentProcessor.processComment` and `messageProcessor.processMessage` call `enforceAutoReplyGate` **before any reply path** — so Post Replies (keyword → DM), Smart Replies (AI), and away/greeting messages all stop together when the plan is inactive.

In `commentProcessor` the gate runs before the trigger-keyword block, fixing the prior bug where Post Replies fired for canceled merchants.

---

## Behavior matrix

### When plan is active, AI quota exhausted

| Reply type                          | Still fires? |
| ----------------------------------- | ------------ |
| Smart Reply (AI)                    | Degraded to hardcoded English fallback (pre-existing — see Known gaps) |
| Post Reply (keyword → DM)           | Yes          |
| Away / greeting message             | Yes          |

### When plan is inactive

| Subscription status                  | Auto-reply fires? |
| ------------------------------------ | ----------------- |
| `active`                             | Yes               |
| `trialing` (trial end in future)     | Yes               |
| `trialing` (trial expired)           | No                |
| `past_due` within 3-day grace        | Yes               |
| `past_due` beyond 3-day grace        | No                |
| `canceled`                           | No                |
| `paused`                             | No                |
| No subscription row (pre-signup)     | Yes (onboarding)  |

---

## Grace period choice: 3 days

Industry range is 0–14. We picked 3 because:

- Stripe's default payment retry schedule makes the first retry within 3 days — enough to cover declined cards, expired cards, bank fraud flags
- Matches Shopify (3 days), which is the closest product analogue
- Cutting at 7 days (original value) gave abusers a full week of free service every month — unacceptable for a product whose highest-value path is keyword-trigger DM funnels
- If Stripe succeeds on day 5, the merchant fixes their card and service resumes; they lost 2 days, not a month

Defined in `subscriptions.ts` inside `checkSubscriptionStatus`:

```ts
const GRACE_PERIOD_DAYS = 3;
```

Single source of truth. `canAutoReply`, `canUseAiReplies`, `canAddPage`, and `canEnablePage` all reuse it.

---

## Architecture

### Backend

```
Webhook (comment / DM)
  → commentProcessor / messageProcessor
  → enforceAutoReplyGate(userId)               ← NEW, first reply-path gate
      → canAutoReply()
          → getUserSubscription() + checkSubscriptionStatus()  (3-day grace)
      → [if blocked] dispatch auto_reply_paused_billing (1/24h Redis dedup)
  → [if blocked] return early, skip ALL reply paths

  → Post Reply trigger match? ──→ sendAndFinalize (template)
  → generateForComment / generateForMessage
      → canUseAiReplies()                      (AI-quota check, same status helper)
      → aiService.generateReply
      → processAiResponse
          → incrementAiReplies()               ← atomic UPDATE…RETURNING
              → maybeNotifyAiUsageThreshold()  ← NEW, 80/100 notifications
          → logAiUsage()                       (token cost, skipped for cached replies)
```

### Frontend

```
Dashboard
  → useQuery(['dashboard-usage'])              (existing — hits GET /subscription/usage)
  → AiUsageWarningBanner                       ← NEW
      ├─ hides below 80% or if limit is null (unlimited plan)
      ├─ amber 80–99% (dismissible 24h)
      └─ red ≥100% (not dismissible)
  → CommandCenter (existing)
  → UsageProgress bars (existing)
```

Notifications arrive via the existing in-app `NotificationBell` + FCM push. No new delivery infrastructure.

---

## Key design decisions

- **Threshold detection is a pure function.** `computeCrossedAiThresholds(oldUsed, newUsed, limit): [80|100][]` in `subscriptions.ts`. No DB, no Redis, no clocks. Tested in isolation with 13 boundary cases. Called inside `incrementAiReplies` after the atomic UPDATE…RETURNING gives us the new count.
- **Atomic increment.** `UPDATE usage SET aiRepliesCount = COALESCE + N RETURNING aiRepliesCount` — no read-modify-write race, threshold detection sees the exact post-increment count.
- **Notification dispatch is best-effort.** Wrapped in `try/catch` with `captureError`. A Redis outage or FCM failure never breaks usage tracking or the reply pipeline.
- **Idempotent notifications.** Redis `SET NX` with TTL keyed by `userId + period + threshold` (AI usage) or `userId` with 24h TTL (billing-paused). A webhook storm with hundreds of blocked replies sends **one** notification.
- **Stable error codes.** `{code: 'ai_limit_reached'}` in the 403 body — clients branch on the code, never the reason string. The reason is translated English for logs/fallback; the UI already has its own i18n copy.
- **Single i18n namespace.** Keys added to the existing `subscription` namespace. No new namespace means no `getMessages.ts` / `namespaces.ts` registration dance.

---

## Files touched

### Backend (source)
- `backend/src/services/subscriptions.ts` — `AI_USAGE_THRESHOLDS`, `computeCrossedAiThresholds`, `canAutoReply`, `enforceAutoReplyGate`, `maybeNotifyAiUsageThreshold`, `GRACE_PERIOD_DAYS = 3`, `canUseAiReplies` returns `code + resetsAt`
- `backend/src/services/notifications.ts` — 3 new types: `ai_usage_warning_80`, `ai_usage_limit_reached`, `auto_reply_paused_billing` (bilingual)
- `backend/src/controllers/ai.ts` — 403 body enriched with `code` + `resetsAt`
- `backend/src/services/reply/commentProcessor.ts` — `enforceAutoReplyGate` moved to run before Post Reply trigger; old `isSubscriptionActive` call removed
- `backend/src/services/reply/messageProcessor.ts` — switched from `isSubscriptionActive` to `enforceAutoReplyGate`

### Shared
- `packages/shared/src/index.ts` — `LimitCheckResult` gains `code` + `resetsAt`

### Frontend
- `frontend/src/components/dashboard/AiUsageWarningBanner.tsx` — new
- `frontend/src/components/dashboard/index.ts` — export
- `frontend/src/pages/dashboard.tsx` — banner wired in
- `frontend/src/i18n/en/subscription.json` + `ar/subscription.json` — `limitBanner.*` keys; stale `presetRepliesUsed` removed

### Tests (added/updated)
- `backend/test/services/subscriptions_usage_thresholds.test.ts` — 13 cases for `computeCrossedAiThresholds`
- `backend/test/services/subscriptions_auto_reply_gate.test.ts` — 12 cases for `canAutoReply` + `enforceAutoReplyGate` (all statuses, grace boundary, Redis dedup, Redis failure resilience)
- `backend/test/services/subscriptions.test.ts` — grace-boundary tests updated from 7 to 3 days
- `backend/test/services/{commentProcessor,messageProcessor,reply,instagramReply}.test.ts` + 2 integration files — mocks swapped from `isSubscriptionActive` to `enforceAutoReplyGate`
- `frontend/src/components/dashboard/AiUsageWarningBanner.test.tsx` — 12 cases for banner severity, reset-date, dismiss behavior, stale-dismissal edge case

---

## Known gaps (not fixed here)

1. **Email notification.** We send in-app + FCM push; industry-standard billing notifications also go by email. Push is easily missed; email is the billing channel. Low effort, ~1 hour. Reuses existing Resend infrastructure at `backend/src/services/email.ts`.

2. **AI-path fallback is still hardcoded English.** When `canUseAiReplies` returns `allowed: false`, `generator.ts` returns `'Thank you for your comment!'` / `'Thank you for your message! We will get back to you soon.'`. Violates bilingual contract (AI_INSTRUCTIONS §13b). Should use the merchant's configured away message + customer language detection. 1–2 hour fix.

3. **No dashboard state for blocked subscriptions.** A canceled merchant still sees a normal dashboard. We dispatch a billing-paused notification once per 24h, but the dashboard itself should show a prominent inactive-subscription banner. Parallel to `AiUsageWarningBanner` but keyed on `subscription.status`.

4. **`isSubscriptionActive` is now dead code on the hot path** — kept as a public utility to avoid a 6-test refactor. Future reader may be confused about which is canonical. Delete or internally delegate to `canAutoReply` when convenient.

5. **Top-up / PAYG purchase.** Tabled separately. The better-UX work here makes it clear when merchants need to upgrade; it doesn't offer them a one-click top-up for the current period.

---

## Rollback

Zero-risk rollback:

1. Remove the `enforceAutoReplyGate` call in `commentProcessor` and `messageProcessor` — old `isSubscriptionActive` check can be restored in place
2. Set `percentUsed < 80` threshold check in `AiUsageWarningBanner` to always return `null`
3. Remove the 403 `code`/`resetsAt` fields — clients ignore unknown fields

All additions are additive. The only semantically-changing move is the subscription gate position in `commentProcessor` (now before Post Reply) — reverting that restores prior "keyword replies keep working after cancellation" behavior.

---

## Metrics to watch post-deploy

- Count of `auto_reply_paused_billing` notifications dispatched per day — spike means canceled merchants are actively losing service (billing pressure working, but also a support-risk signal)
- Count of 403 `ai_limit_reached` responses — tells you how many merchants hit their cap
- Count of `ai_usage_warning_80` notifications — leading indicator for upgrade conversations
- Churn correlation — do merchants who hit 80% upgrade more than baseline?
