# WhatsApp Integration Plan

> **Last updated:** 2026-07-09
> **Status:** Code-complete for launch — backend (B+C), connect flow (Phase 3) and voice/media (Phase 5 core) MERGED + deployed dark (PR #392, 2026-07-04). **Meta App Review SUBMITTED 2026-07-08 (submission 949305008122443, "Review in progress")** — see Phase 2. Approval-day steps: [`docs/WHATSAPP_LAUNCH_RUNBOOK.md`](../docs/WHATSAPP_LAUNCH_RUNBOOK.md). Post-launch fixes already landed: read receipts + typing indicators + outgoing-platform stamping (#423), webhook sender names + inbox channel badges (#424), inbox shows the customer's phone number with tap-to-copy (branch `feat/whatsapp-inbox-customer-number`). Phases 4 (templates) & 6 (inbound status consumption) deferred post-launch
>
> **Why this matters strategically:** WhatsApp is the channel LetsBot owns end-to-end. Phase B+C closes the inbound DM gap (text auto-replies work). Phase 4 (template messages) closes the proactive cart-recovery / order-update gap that's LetsBot's biggest revenue feature. Phase 5 (Catalog media) is the WhatsApp equivalent of Messenger/IG rich cards. Phase 6 (status callbacks) gives read receipts that feed the analytics dashboard.
>
> **Companion plan:** [`ECOMMERCE_POWER_FEATURES_PLAN.md`](./ECOMMERCE_POWER_FEATURES_PLAN.md) — covers the FB/IG side of the same story (rich cards Phase 1b ✅, analytics Phase 5 ✅, DM cart recovery Phase 2 next, URL wrapping Phase 6, A/B testing Phase 7). The two plans interlock: shipping WhatsApp Phase 4 + 6 here automatically upgrades Phase 5 analytics over there with no schema migration (channel-keyed funnel already in place since Step 2).

---

## ⚠️ WhatsApp OTP must replace SMS OTP (auth)

**Why:** Vonage **SMS** OTP can't reach our core markets — Syria is sanctions-blocked, Saudi Arabia/KSA denies foreign A2P SMS, Libya is unreliable. A mandatory phone-collect step churned Syrian trial signups with a 400 `country_blocked` (Sentry `JAWAB24-FRONTEND-1R`).

**Current state (shipped on `fix/phone-optional-onboarding`):** SMS OTP is **retired** and all phone UI is hidden behind `PHONE_AUTH_ENABLED` / `NEXT_PUBLIC_PHONE_AUTH_ENABLED` (OFF). Facebook OAuth is the sole identity. Onboarding **never** asks for a phone (decoupled at the code level — `requiresPhone` removed from OAuth callbacks). Team invites are email-only. The OTP infra (`otpService`, `otp_codes`, `/auth/phone/*`) is preserved.

**To re-enable phone OTP via WhatsApp (this is the tracked path for the `// TEMP` block in `backend/src/services/sms.ts`):**
1. Add a WhatsApp Cloud API authentication-template sender and swap it in at the single seam `otpService.sendOtp()` → `smsService.send()` (or route by region).
2. Flip `PHONE_AUTH_ENABLED=true` for deliverable regions. The login phone tab, phone-collect page, and (optionally) team phone invites re-appear automatically.
3. **Syria (`+963`) stays permanently exempt** — WhatsApp Business Platform is *also* sanctions-blocked for Syria, so it can never receive OTP. The exemption list is `SMS_BLOCKED_DIAL_PREFIXES` / `isSmsBlockedPhone` in `@jawab24/shared`; `PhoneInput` already disables submit + shows a notice for blocked prefixes.

This makes the "WhatsApp-only merchant → Phone OTP" row in the Merchant Types table below the trigger for re-enabling phone auth.

---

## Completed

### Phase A: `platformMessageId` cleanup ✅
- Replaced `facebookMessageId` (NOT NULL) + `instagramMessageId` with generic `platformMessageId`
- Dropped both legacy columns (zero customers, no migration risk)
- All adapters use shared helpers (`mapToPlatformPage`, `storeIncomingMessage`, `markAsReplied`)
- Instagram adapter delegates to `messagesService.findOrCreateFromWebhook()` (no more direct DB queries)
- Removed `ig_` prefix hack from Instagram message IDs
- **Commit:** `8911f0d0`

### Phase B+C: WhatsApp backend integration ✅
- **Schema:** WhatsApp columns on `pages` table (`whatsapp_phone_number_id`, `whatsapp_business_account_id`, `whatsapp_display_phone_number`, `whatsapp_auto_reply_enabled`)
- **WhatsApp Cloud API service:** `sendTextMessage()`, `markAsRead()`
- **WhatsApp adapter:** implements `MessagePlatformAdapter`, uses shared helpers
- **WhatsApp reply service:** delegates to `messageProcessor` (same AI pipeline as FB/IG)
- **Webhook handler:** handles `whatsapp_business_account` webhooks, text messages only
- **Worker:** shared `processMessageJob()` handles all 3 platforms (eliminated duplication)
- **Meta subscriptions:** WhatsApp messages webhook enabled
- **Commit:** `722d236f`

### Phase D: Tests (partial) ✅
- Updated `metaWebhooks.test.ts` (2 → 3 subscriptions)
- Updated `replyWorker.test.ts` (WhatsApp service mock)
- All 3,814 existing tests pass

### Documentation ✅
- `SYSTEM_ANALYSIS.md` — WhatsApp added to integrations list, `whatsapp_message` in job types and pipeline metrics
- `.planning/codebase/INTEGRATIONS.md` — full WhatsApp Cloud API section added (business model, webhook, schema, Meta submission steps)
- `.planning/codebase/ARCHITECTURE.md` — overview and diagram updated to include WhatsApp

---

## Remaining Work

### Phase 1.5: Schema prep for WhatsApp-only merchants ✅
Make `facebookPageId` nullable so merchants can connect WhatsApp without a Facebook Page.

- [x] `backend/migrations/0064_worthless_klaw.sql` — `ALTER TABLE pages ALTER COLUMN facebook_page_id DROP NOT NULL`
- [x] `packages/shared/src/index.ts` — `facebookPageId: string | null` in `Page` interface
- [x] `backend/src/types/index.ts` — `facebookPageId: string | null` in `CreatePageDTO`
- [x] `backend/src/services/tokenRefresh.ts` — already filtered with `isNotNull(pages.facebookPageId)` (no change needed)
- [x] `backend/src/controllers/pages.ts` — already guards with `if (page.facebookPageId)` (no change needed)

**Why:** A WhatsApp-only merchant (phone login, no Facebook) has no Facebook Page. Without this change, we can't create a `pages` row for them because `facebookPageId` is NOT NULL. Making it nullable lets:
- Facebook merchant: `facebookPageId = '123'`, `whatsappPhoneNumberId = null`
- WhatsApp-only merchant: `facebookPageId = null`, `whatsappPhoneNumberId = '789'`
- Both: `facebookPageId = '123'`, `whatsappPhoneNumberId = '789'`

### Phase D: Dedicated WhatsApp tests ✅
- [x] `backend/test/services/whatsappAdapter.test.ts` — getPage, fetchSenderName, sendReply, sendAwayMessage, sendTypingIndicator no-op, getInternalMessageId
- [x] `backend/test/controllers/webhook-whatsapp.test.ts` — routing, text enqueue, sender name, non-text skip, status skip, field filter

### Phase 2: Meta Setup (Tech Provider) — ⏳ ONLY REMAINING LAUNCH BLOCKER
Jawab24 is a Tech Provider — merchants connect their own WhatsApp Business Account via Embedded Signup.

> **Go-live steps now live in [`docs/WHATSAPP_LAUNCH_RUNBOOK.md`](../docs/WHATSAPP_LAUNCH_RUNBOOK.md)** — the executable approval-day → canary → GA checklist (incl. the env-var build plumbing added 2026-07-08 on `feat/whatsapp-launch-plumbing`).

**Meta submission steps (status 2026-07-08):**
1. ✅ Add WhatsApp product to Facebook App — done (test number +1 555 191-8478 claimed)
2. ✅ Verify Meta Business Account — verified Tech Provider (business 867483152446840)
3. ⏳ **App Review for Advanced Access** on `whatsapp_business_messaging` + `whatsapp_business_management` — **SUBMITTED 2026-07-08** (submission `949305008122443`, status "Review in progress"; the hidden blocker was the Renewal-tab allowed-usage certifications — the wizard only saves on Next). Expect 3–5 business days. See `docs/meta-app-review-resubmission.md` § WhatsApp.
4. On approval: create the Embedded Signup **configuration** and set its ID as `NEXT_PUBLIC_WHATSAPP_CONFIG_ID` → follow the runbook.

> ~~"No App Review needed for WhatsApp — only business verification + Standard Access."~~ **Corrected 2026-07-08:** Standard Access only covers assets *owned by* the developer's own business. Serving *other* businesses' WABAs as a Tech Provider (Embedded Signup onboarding) requires **Advanced Access** via App Review for both permissions — which is exactly the submission above.

### Phase 3: Frontend — WhatsApp Connection UI ✅ (2026-07-03, `feat/whatsapp-connect`)
Connect WhatsApp via Facebook Embedded Signup on the existing pages screen.

**UX: third row on each page card**
```
┌─────────────────────────────────┐
│  📘 Facebook Messenger    [ON]  │
│  📸 Instagram DMs         [ON]  │
│  💬 WhatsApp +966 55...   [OFF] │  ← new row
│                                 │
│  Incoming: 234  Replies: 198    │
└─────────────────────────────────┘
```

**WhatsApp-only merchant (phone login, no Facebook Page):**
```
┌─────────────────────────────────┐
│  💬 WhatsApp +966 55...   [ON]  │  ← only channel
│                                 │
│  Incoming: 45   Replies: 38     │
└─────────────────────────────────┘
```

**Tasks:**
- [x] "Connect WhatsApp" button on pages.tsx (opens Embedded Signup popup via on-demand FB JS SDK — `frontend/src/lib/whatsappSignup.ts`; button env-gated on `NEXT_PUBLIC_WHATSAPP_CONFIG_ID`)
- [x] Embedded Signup callback handler — auth `code` from FB.login + `phone_number_id`/`waba_id` from the WA_EMBEDDED_SIGNUP message event (sessionInfoVersion 3)
- [x] Backend endpoint: `POST /pages/:id/connect-whatsapp` (owner-only) — exchanges code → business token (new encrypted `pages.whatsapp_access_token`, migration 0125), subscribes app to WABA, registers phone (deterministic HMAC PIN), stores fields. Plus `DELETE /pages/:id/whatsapp` and `PATCH /pages/:id/whatsapp-auto-reply` (billing + channel-trial gates)
- [x] WhatsApp row on page card: phone number display (LTR-isolated in RTL) + auto-reply toggle + owner-only disconnect (unlink → ConfirmationModal)
- [x] `handleWhatsAppToggle` function (same pattern as `handleInstagramToggle`)
- [x] Translation keys (en + ar) for WhatsApp UI strings
- [x] Dashboard announcement nudge (env-gated, owner-only, dismissible) for post-approval discoverability
- [x] Mobile: Connect hands off to the system browser at the web dashboard (`openExternalUrl` + `buildWebUrl`) — ES popup can't run in the Capacitor WebView
- [x] WhatsApp-only page card ✅ (2026-07-03): `POST /pages/connect-whatsapp` creates a `facebookPageId=null` page row (named after the WABA verified name, own Business Info + stats); "Add WhatsApp number" card + empty-state CTA on /pages; removal = page delete; enabled card consumes a page slot. **Doubles as multi-number support** — one card per number. Manual inbox replies route per-platform (whatsapp branch in messages controller). UI renamed "Pages" → "Channels"/«قنوات التواصل» (copy only). Deferred alternative: a decoupled `channels` table (enterprise pattern, zero demand signal — revisit only if merchants outgrow cards). Tier B (no Facebook account at all → WhatsApp OTP login) stays parked until our own WABA is live

### Phase 4: Template Messages — ✅ proactive half shipped (2026-08-26), inbox half still open
- [x] **Order/cart notifications over WhatsApp** — `whatsappService.sendTemplateMessage` + canonical
      Jawab24 UTILITY templates (`services/whatsappNotificationTemplates.ts`), auto-submitted to each
      merchant's own WABA and tracked in `whatsapp_notification_templates`. Per-type channel switch on
      the notifications card; sender = the WhatsApp page linked to the store. This is the
      cart-recovery / order-update gap this plan called LetsBot's biggest revenue feature.
- [x] Create/manage message templates via the Graph API (`POST /{waba-id}/message_templates` +
      status polling) — no Business-Suite hand-work needed. First reader of
      `pages.whatsapp_business_account_id`.
- [ ] Detect when the 24h window expires for the INBOX path (`lastMessageAt` per sender) — still open
- [ ] Fallback to a template when a free-form auto-reply fails with error 131047 — still open
> ⭐ The proactive path needs **no** window tracking at all: a notification recipient may never have
> messaged the merchant, so a template is always required and always correct. The `lastMessageAt`
> idea above applies only to the inbox/auto-reply path, where free-form text is preferable in-window.
> Deliberately out of v1: per-merchant editable WhatsApp copy (a body is frozen at Meta-approval
> time, so each edit would need its own review cycle) and OTP/team-invite templates (Authentication
> category — the seams are `otpService.sendOtp()` and `workspaceInvite.ts`).

### Phase 5: Media Messages — ✅ core shipped (2026-07-03)
- [x] Handle incoming images, voice notes, videos, documents (`handleWhatsAppNonTextMessage` in `nonTextHandler.ts` — separate function: WhatsApp media is ID + authorized download, not a public URL)
- [x] Voice transcription via Whisper (`transcribeFromBuffer` after bearer-token download; codec suffix stripped)
- [x] Image/document acknowledgment nudge (1h cooldown, shared `sendNudge`); stickers stored silently; media captions / button / interactive replies routed to the AI as text
- [ ] location / contacts / reaction / order message types (currently skipped)

### Phase 6: Status Callbacks — deferred post-launch
- [ ] Handle `statuses` array in webhook (sent/delivered/read/failed)
- [ ] Track message delivery status per conversation
- [ ] Surface delivery status in frontend (blue ticks equivalent)

---

## Architecture Notes

### Business Model
ManyChat model — merchant connects their own WhatsApp Business Account via Facebook Embedded Signup. Meta bills the merchant directly for per-message costs. Jawab24 is the automation middleware (Tech Provider).

### Merchant Types
| Type | Login | Channels | `facebookPageId` | `whatsappPhoneNumberId` |
|------|-------|----------|-------------------|--------------------------|
| Facebook merchant | Facebook OAuth | FB + IG | set | null |
| WhatsApp-only merchant | Phone OTP | WhatsApp | null | set |
| Full merchant | Facebook OAuth | FB + IG + WA | set | set |

### How it works
1. Merchant connects WhatsApp via Embedded Signup → gets `phone_number_id` + access token
2. Backend creates/updates page row with WhatsApp fields
3. Meta sends webhooks to `/webhook` with `object: "whatsapp_business_account"`
4. Webhook handler extracts text message, enqueues as `whatsapp_message` job
5. Worker delegates to `whatsappReplyService` → `messageProcessor` (same AI pipeline)
6. Reply sent via WhatsApp Cloud API (`POST /{phone_number_id}/messages`)

### Key Differences from Facebook/Instagram
| | Facebook | Instagram | WhatsApp |
|--|---------|-----------|----------|
| Sender ID | Facebook user ID | Instagram user ID | Phone number |
| Max reply length | 2000 chars | 1000 chars | 4096 chars |
| Sender name API | Graph API profile | Graph API username | No API (from webhook only) |
| Typing indicator | Supported | Supported | ✅ Implemented (#423) — `markAsRead(..., {typing})` at the webhook layer using the wamid; outbound read receipts (blue ticks) sent too. The adapter-level `sendTypingIndicator` stays a no-op by design |
| 24h window | No limit | No limit | 24h from last customer message |
| Comments | Yes | Yes | No (DMs only) |
| Per-message cost | Free | Free | Merchant pays Meta |
| Connection method | Facebook OAuth | Auto-discovered from FB Page | Embedded Signup |
| Requires Facebook Page | Yes | Yes (linked to FB Page) | No |

### File Map
```
backend/src/services/whatsapp.ts                    — Cloud API client (send, markAsRead + typing, signup exchange)
backend/src/services/whatsappReply.ts                — Reply service
backend/src/services/reply/adapters/whatsappAdapter.ts — Platform adapter
backend/src/services/reply/adapters/shared.ts        — Shared adapter helpers
backend/src/services/reply/nonTextHandler.ts         — Voice-note transcription + media/non-text handling (Phase 5)
backend/src/controllers/webhook.ts                   — Webhook handler (WhatsApp branch)
backend/src/controllers/whatsapp.ts                  — Connect/disconnect/toggle endpoints (Phase 3)
backend/src/routes/whatsapp.ts                       — Route registration (Phase 3)
backend/src/workers/replyWorker.ts                   — Job routing (shared processMessageJob)
backend/src/services/metaWebhooks.ts                 — Webhook subscription
backend/src/services/pages.ts                        — getPageByWhatsAppPhoneNumberId()
backend/src/db/schema.ts                             — WhatsApp columns on pages
packages/shared/src/index.ts                         — Page, Message, ReplyJobData types
frontend/src/lib/whatsappSignup.ts                   — Embedded Signup launcher
frontend/src/lib/featureFlags.ts                     — Canary gating (allowlist / admin-only)
frontend/src/components/WhatsAppNudgeBanner.tsx      — Dashboard nudge
frontend/src/utils/phone.ts                          — resolveCustomerLabel (inbox customer number display)
```
