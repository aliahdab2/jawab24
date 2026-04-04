# WhatsApp Integration Plan

> **Last updated:** 2026-04-04
> **Status:** Phase 1 backend complete, frontend not started

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

### Phase 1.5: Schema prep for WhatsApp-only merchants
Make `facebookPageId` nullable so merchants can connect WhatsApp without a Facebook Page.

- [ ] `backend/src/db/schema.ts` — change `facebookPageId` from NOT NULL to nullable
- [ ] `backend/src/services/pages.ts` — update `syncFromFacebook` and page creation to handle null `facebookPageId`
- [ ] `backend/src/services/tokenRefresh.ts` — skip pages with null `facebookPageId`
- [ ] `backend/src/controllers/pages.ts` — handle WhatsApp-only page creation from Embedded Signup callback
- [ ] `packages/shared/src/index.ts` — make `facebookPageId` optional in `Page` interface
- [ ] Generate migration, run tests

**Why:** A WhatsApp-only merchant (phone login, no Facebook) has no Facebook Page. Without this change, we can't create a `pages` row for them because `facebookPageId` is NOT NULL. Making it nullable lets:
- Facebook merchant: `facebookPageId = '123'`, `whatsappPhoneNumberId = null`
- WhatsApp-only merchant: `facebookPageId = null`, `whatsappPhoneNumberId = '789'`
- Both: `facebookPageId = '123'`, `whatsappPhoneNumberId = '789'`

### Phase D: Dedicated WhatsApp tests
- [ ] `backend/test/services/whatsappAdapter.test.ts` — adapter unit tests
- [ ] `backend/test/controllers/webhook-whatsapp.test.ts` — webhook routing, non-text skip, status skip

### Phase 2: Meta Setup (Tech Provider)
Jawab24 is a Tech Provider — merchants connect their own WhatsApp Business Account via Embedded Signup.

**Meta submission steps:**
1. Add WhatsApp product to Facebook App (App Dashboard → Add Product → WhatsApp) — instant
2. Verify Meta Business Account (may already be done since app is Live) — check in Business Settings
3. Request Embedded Signup access (WhatsApp → API Setup) — 3-5 business days
4. Receive Solution ID for Embedded Signup integration

**No App Review needed for WhatsApp** — unlike Facebook permissions, WhatsApp Business Platform only requires business verification + Standard Access.

### Phase 3: Frontend — WhatsApp Connection UI
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
- [ ] "Connect WhatsApp" button on pages.tsx (opens Embedded Signup popup)
- [ ] Embedded Signup callback handler — receives `phone_number_id`, `waba_id`, access token
- [ ] Backend endpoint: `POST /pages/connect-whatsapp` — stores WhatsApp fields on page (creates page row if WhatsApp-only)
- [ ] WhatsApp row on page card: phone number display + auto-reply toggle
- [ ] `handleWhatsAppToggle` function (same pattern as `handleInstagramToggle`)
- [ ] Translation keys (en + ar) for WhatsApp UI strings
- [ ] Handle WhatsApp-only page card (no Facebook/Instagram rows)

### Phase 4: Template Messages (24h window)
- [ ] Detect when 24h window expires (check `lastMessageAt` from sender)
- [ ] Create/manage WhatsApp message templates in Meta Business Suite
- [ ] Fallback to template when free-form reply fails with error 131047
- [ ] UI for template selection (or auto-select based on context)

### Phase 5: Media Messages
- [ ] Handle incoming images, voice notes, videos, documents
- [ ] Extend `nonTextHandler.ts` to support `'whatsapp'` platform
- [ ] Voice transcription via Whisper (same as FB/IG)
- [ ] Image/document acknowledgment nudge

### Phase 6: Status Callbacks
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
| Typing indicator | Supported | Supported | Skipped (needs wamid, not senderId) |
| 24h window | No limit | No limit | 24h from last customer message |
| Comments | Yes | Yes | No (DMs only) |
| Per-message cost | Free | Free | Merchant pays Meta |
| Connection method | Facebook OAuth | Auto-discovered from FB Page | Embedded Signup |
| Requires Facebook Page | Yes | Yes (linked to FB Page) | No |

### File Map
```
backend/src/services/whatsapp.ts                    — Cloud API client
backend/src/services/whatsappReply.ts                — Reply service
backend/src/services/reply/adapters/whatsappAdapter.ts — Platform adapter
backend/src/services/reply/adapters/shared.ts        — Shared adapter helpers
backend/src/controllers/webhook.ts                   — Webhook handler (WhatsApp branch)
backend/src/workers/replyWorker.ts                   — Job routing (shared processMessageJob)
backend/src/services/metaWebhooks.ts                 — Webhook subscription
backend/src/services/pages.ts                        — getPageByWhatsAppPhoneNumberId()
backend/src/db/schema.ts                             — WhatsApp columns on pages
packages/shared/src/index.ts                         — Page, Message, ReplyJobData types
```
