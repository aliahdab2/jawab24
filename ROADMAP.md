# Jawab24 — Product Roadmap

> **Last updated**: 2026-07-09 (status refresh — WhatsApp channel SHIPPED behind founder canary; Team UI shipped; ~245 commits reconciled. The execution spine below is kept for history; see the 2026-07-09 status note inside it.)
> **Purpose**: Strategic feature roadmap based on competitive analysis and product study.
>
> **Active near-term focus (2026-05-30):** Ship the **Salla App Store** listing first (Arabic-first / "AI sales rep" wedge); file Meta WhatsApp Embedded Signup in parallel. Shopify + Zid submissions and WhatsApp frontend/templates follow. See `.planning/SALLA_LISTING_BRIEF.md`, `.planning/SALLA_LAUNCH_VALIDATION.md`, and the consolidated launch plan.

---

## 🧭 Execution Spine — next 6–8 weeks (from 2026-05-31)

> **Status 2026-07-09:** the WhatsApp track of this spine is DONE ahead of the keystone — full channel shipped in #392 (Embedded Signup connect UI, multi-number, voice notes/media) + follow-ups #418/#420/#423 (read receipts, typing indicators)/#424 (sender names, channel badges), currently behind a founder canary (`WHATSAPP_ALLOWLIST`); **Meta App Review for templates submitted 2026-07-08, in review**. Salla submission still pending (assets/marketing sign-off). **The keystone (1d customer-identity map + 1e proactive sender) has NOT started.** ⚠️ Superseded on the channel question: cart-recovery/order notifications were SMS-only when this was written; the SMS rail was removed on 2026-09-03 (D-123) and they now go out over **WhatsApp templates** — the keystone's remaining job is the DM channel, not replacing SMS. That keystone is now the whole remaining path to LetsBot parity on proactive commerce.

The phases below are a *menu*; this spine is the *order*. Several tracks run in parallel; the **critical path is the keystone** — it unlocks the largest competitive gap (proactive WhatsApp/DM commerce). Week bands are **relative sequencing, not date commitments** — assign real dates to team capacity.

### Critical path (the one thread)
```
Salla code-ready ✅ ──► Salla submit ──► Shopify / Zid submit

WhatsApp backend ✅ ──► Meta Embedded Signup req ──► WA Phase 3 connect UI ──► WA Phase 4 templates ─┐
                        (file NOW, 3–5d TTL)        (build in parallel, no approval needed)          │
                                                                                                     ▼
KEYSTONE: 1d customer-identity map ─► 1e proactive sender ─► DM cart-recovery + DM order notif ─► WhatsApp cart-recovery + notif
          (no external dep — just build)                     (notif infra shipped; WhatsApp rail)      = LetsBot parity on outbound
```

### Sequenced work

**Now / W1–2 — unblock distribution + start the clock**
- **Salla submission:** resolve the live-validation OAuth blocker (Cloudflare on dev-store login — see `.planning/SALLA_LAUNCH_VALIDATION.md` dogfood), run S1b/S2/S3, produce listing assets, upload. *Code is done; this is validation + assets + portal.*
- **WhatsApp Phase 2:** file the Meta Embedded Signup request **immediately** — it gates Phase 4 and has a 3–5 business-day TTL. Pure paperwork.
- **WhatsApp Phase 3 (connect UI):** start the build in parallel — it does **not** need Meta approval to write, only to test. Reuses the **shared KB** (one business KB across FB/IG/WhatsApp — no per-channel KB).

**W2–3 — land the channel UI, start the keystone**
- WhatsApp Phase 3 ships (connect card + `whatsappAutoReplyEnabled` toggle, shared KB).
- **Keystone 1d — customer-identity mapping** begins: an `ecommerce_customer_map` (social/WhatsApp sender ↔ e-commerce customer), populated from `ecommerceActions`. *(Spec: `.planning/ECOMMERCE_POWER_FEATURES_PLAN.md` Phase 1d.)*

**W3–5 — the unlock**
- **Keystone 1e — proactive sender** (`proactiveMessaging.ts`, rate-limited): the missing "system-initiated outbound" primitive. *(Spec: Power Features Phase 1e.)*
- Once 1d+1e land → **DM cart-recovery** (Power Features Ph2) + **DM order notifications** (Power Features Ph3) ship in parallel — the notification engine (templates, queue, scheduler, worker) already exists and runs on the WhatsApp rail since D-123; this adds the DM channel branch.

**W5–6 — parity moment + more distribution**
- WhatsApp Phase 4 (templates) once Meta-approved → route cart-recovery + notifications over **WhatsApp**. *This is the point Jawab24 reaches LetsBot parity on proactive commerce.*
- Shopify + Zid app-store submissions (after Salla proves the listing pattern).

**W6–8 / deferred**
- URL click-tracking (Power Features Ph6) for conversion telemetry — after recovery/notifications ship.
- Inbox-polish phases (2 AI suggestions · 3 customer profiles · 4 analytics · 6 team UI · 7 posts) — **interleave as capacity allows; none block the outbound story.**

### Calendar blockers (these gate the path — track them)
- **Meta Embedded Signup approval** — 3–5 business days after request; gates WA Phase 4.
- **Salla App Store review** — historically 5–10 days after submit.
- **Salla live-validation OAuth blocker** — Cloudflare blocks automated dev-store login; needs a manual / real-merchant workaround before S1b can complete.

### Deferred / not planned (explicit, so it isn't silently missing)
- **Bulk broadcast / promotional campaigns** — the one real LetsBot capability with *no plan today*. Deferred; revisit Q3 if competitive demand is proven (needs segment builder, scheduler, rate-limit, opt-out/compliance).
- **Web-chat widget, chatbot flow builder** — intentionally not planned (flow builder conflicts with the "Rules + AI" principle).

### Non-engineering, owner = marketing (parallel, off the eng critical path)
- **GTM / positioning:** the "AI sales rep / مندوب مبيعات" repositioning is decided but not operationalized (messaging, pricing tiers, launch sequence, target persona). Needs a GTM narrative doc — today only an SEO checklist (`Jawab24_Growth_Playbook.md`) exists. **Flagged, not solved here.**

### Success signals per milestone
- **Salla live** → first non-seed merchant install + one real AI reply referencing their catalog.
- **Keystone live** → a cart-recovery DM delivered to a mapped customer (not a WhatsApp template).
- **WhatsApp parity** → an order-confirmation template delivered over WhatsApp end-to-end.

---

## Current Position

**Jawab24** is an Arabic-first AI auto-reply platform for Facebook, Instagram, WhatsApp (backend), and e-commerce stores (Shopify, Salla, Zid), targeting individual merchants and small teams in the MENA region.

### Competitive Strengths (Already Built)
- 3-layer reply system (Rules → AI with RAG → Human)
- Knowledge Base with pgvector semantic search
- Gap Detector (notifies merchant when KB doesn't cover a question)
- Price hallucination detection + offensive content guard
- Arabic normalization (diacritics, alef variants, digit conversion)
- Auto-translation Arabic↔English (greeting, away, KB)
- 3 reply modes (public / private / dual)
- Semantic caching (70-80% cache hit rate)
- Shopify product-aware AI replies
- Capacitor mobile app (iOS/Android)
- Escalation SLA system
- Conversation pause/resume (handoff)
- Multi-tenant workspace infrastructure (invisible to users, ready for team features)

### Competitive Gaps (updated 2026-07-09)
- ~~No WhatsApp channel~~ — **Full channel SHIPPED** (#392 + #418/#420/#423/#424): Embedded Signup connect UI, multi-number, voice notes/media, read receipts, typing indicators, inbox with customer numbers. Behind founder canary until Meta App Review clears (**templates submitted 2026-07-08, in review**). Proactive template messages (Phase 4 of `WHATSAPP_PLAN.md`) still not implemented.
- No chatbot flow builder
- ~~Limited analytics (basic overview only)~~ — **E-commerce analytics dashboard shipped** (`ecommerce-analytics.tsx`); inbox-level smart analytics (Phase 4) still pending
- No customer profiles/CRM (inbox now shows WhatsApp customer phone numbers — a label, not a profile)
- No AI suggested replies in inbox
- ~~Team features: backend ready, UI not yet exposed~~ — **`/team` page + email invites shipped** (#224, polish #252/#253/#278)
- **Proactive DM cart-recovery & order notifications NOT built** — the **WhatsApp template** channel is live (D-123 made it the only one; SMS was removed), the DM channel is not. Unblocked by the **keystone** (customer-identity mapping + proactive sender) in the Execution Spine above; the notification engine itself is shipped, it just lacks a DM/WhatsApp channel branch.

### Completed Since Last Update (2026-05-31 → 2026-07-09)
- **WhatsApp channel (full)** — Embedded Signup connect, WhatsApp-only cards, multi-number, voice notes (#392); launch env wiring + runbook (#418), pre-launch security fixes (#420), read receipts + typing indicators (#423), webhook sender names + inbox channel badges (#424); inbox shows WhatsApp customer phone number w/ tap-to-copy. Meta Embedded Signup submission package (#406); **App Review submitted 2026-07-08**.
- **Post Reply expansion** — any-comment trigger mode (#389, D-021), post picker to arm any post + dashboard discovery nudge (#405), setup-modal redesign (outcome card, tooltips, Settings deep-link), comment-modes clarity (#417)
- **E-commerce correctness sweep** — order-notification + webhook fixes across Salla/Shopify (+ Zid docs reconcile) (#411); integrations audit P0/P1 (#421) + P2 compliance/hygiene (#422); store reconnect prompts (#320); **native catalog for store-less merchants** (founder canary, #407)
- **Image understanding in DMs** — customers can send product screenshots/photos, AI answers from them (#396)
- **Team UI** — dedicated `/team` page + email invites (#224)
- **Security hardening** — ai-worker shared-secret auth, admin gating, prompt-injection sanitization, CSRF/IDOR fixes (#409, #419)
- **Billing** — self-service Stripe top-ups, hidden Scale 20K/30K plans, trial-abuse guard tied to connected channel
- **Bilingual Help Center** (#388); Business Info section limit 8→18 (#415); KB→"Business Info" terminology unified
- Prompt iterated v37→v52 (gender-aware Arabic, dialect mirroring, price-guard, offer-closing fix); gpt-5.1+ reasoning_effort fix (#412)
- Android v1.3.14 promoted to production 100%

### Completed Since Last Update (2026-04-15 → 2026-05-30)
- E-commerce **customer notifications** live over **WhatsApp** (D-123 — SMS removed 2026-09-03): order confirmed/shipped/delivered, abandoned-cart recovery — bilingual, dedup'd, merchant-configurable (`services/customerNotifications.ts`). ⚠️ `review_request` has no WhatsApp template and `digital_delivery` has no firing code path at all, so neither is deliverable (SYSTEM_ANALYSIS gap 15)
- **E-commerce analytics dashboard** shipped (`services/ecommerceAnalytics.ts` + `pages/ecommerce-analytics.tsx`)
- **Platform-agnostic webhook hardening** lifted across Shopify/Salla/Zid (retry queue, persist-on-throw, reregister endpoint + recovery UI) — PR #27/#28
- **Salla App Store launch prep**: privacy policy now covers Shopify/Salla/Zid (#176), pending-install refresh-token persistence fixed (#211), listing brief + validation docs drafted
- **Android local-first Play release pipeline** (`scripts/release-android.sh` + Gradle Play Publisher) — PR #212
- Prompt iterated toward v37 ("feel human" pass — on branch, not yet deployed)

### Completed Since Last Update (2026-02-22 → 2026-04-15)
- WhatsApp Cloud API backend integration
- Salla e-commerce integration (OAuth, product sync, webhooks)
- Zid e-commerce integration (OAuth, product sync, webhooks)
- Resend email service (transactional emails)
- Leads module (AI-powered extraction from conversations)
- Waitlist feature with email notifications + unsubscribe
- Blog (13+ bilingual posts)
- Admin panel (playground, waitlist management, customer management, observability)
- All Facebook + Instagram permissions approved (2026-04-07)
- Prompt upgraded from v22 to v30

---

## Completed Work

### Workspace / Multi-Tenant Infrastructure (2026-02-22) ✅
- Full workspace-scoped data model: pages, templates, rules, settings all scoped by `workspaceId`
- RBAC middleware: owner > admin > member roles with `resolveWorkspace` + `requireRole`
- Workspace auto-created on signup (invisible to users)
- Reply pipeline fully workspace-aware (settings, rules, templates resolved by workspace)
- Invite system backend-ready (hashed tokens, expiry, single-use)
- Frontend silently manages workspace state (`X-Workspace-Id` header on every request)
- Comprehensive backend tests: integration, isolation, pipeline, middleware
- **UI intentionally hidden** — no team page, no invite UI, no workspace switcher
- Activating team UI estimated at ~5-7 days when customers request it
- Full plan: `docs/workspace-implementation-plan.md`

### Comments Page Redesign (2026-02-17) ✅
- Replaced 6 stat cards with 3 filter chips (Needs Action / All / Auto-replied)
- Default filter: "Needs Action" (pending + flagged, excluding resolved)
- Added resolve/unresolve mechanism
- Added post context on cards and modal
- Moved CSV export to overflow menu
- Removed one-shot lock on Smart Reply (regenerate allowed)
- Removed unnecessary elements (language badge, flag reason on card, result counter)
- Added low-confidence skip to auto-reply (backend)
- RTL fixes, accessibility improvements, toast feedback

---

## ~~Phase 1: Messages Page Redesign~~ ✅ Complete

Completed alongside Comments redesign. Same design philosophy applied.

- ✅ 3 filter chips (Needs Action | All | Auto-replied) replacing 6 stat cards
- ✅ Default to "Needs Action"
- ✅ Resolve/unresolve for conversations
- ✅ Toast notifications wired (pause, resume, reply)
- ✅ Dead code removed (repliedToday stat)
- ✅ Consistent design language (chat bubbles, modal structure, badges)
- ✅ Landscape modal optimization
- ~~AI regenerate button~~ — Not needed: auto-reply already tried; if message needs attention, AI couldn't answer (low confidence / no KB match), regenerating gives same result

---

## Phase 2: AI Suggested Replies

**Impact**: High | **Effort**: Low | **Backend readiness**: High

When a merchant opens a conversation, show 2-3 AI-suggested replies they can click to send.

### 2.1 Backend: New AI endpoint
- `POST /ai/suggest` — returns 2-3 reply suggestions instead of 1
- Modify AI Worker prompt to return array of suggestions with different tones/approaches
- Use existing KB + semantic search + conversation history
- Cache suggestions per conversation

### 2.2 Frontend: Suggestion chips in modal
- Show 2-3 clickable suggestion chips above the reply textarea
- Click to populate textarea (editable before sending)
- "Regenerate" button to get new suggestions
- Loading state while generating

### 2.3 Bilingual suggestions
- Detect customer language → suggest replies in same language
- Leverage existing Arabic normalization + language detection

---

## Phase 3: Customer Profiles

**Impact**: High | **Effort**: Low-Medium | **Backend readiness**: Data exists

Every `senderId` already has message history, language, intent data in the database. Surface it.

### 3.1 Backend: Customer profile endpoint
- `GET /customers/:senderId/profile`
- Aggregate from messages + comments tables:
  - Total interactions count
  - First/last interaction dates
  - Detected language
  - Most common intents
  - Channels used (Facebook/Instagram)
  - Pages interacted with

### 3.2 Frontend: Profile sidebar/section in modal
- Show customer summary when viewing a conversation
- Interaction history timeline
- Language preference
- Intent distribution (what do they usually ask about?)

### 3.3 Future: Tags & notes
- Allow merchant to tag customers (VIP, wholesale, complaint)
- Internal notes per customer

---

## Phase 4: Smart Analytics Dashboard

**Impact**: High | **Effort**: Medium | **Backend readiness**: Data exists

All the data is already being collected — it just needs dashboards.

### 4.1 Top Unanswered Questions
- Source: `kbGaps` table (Gap Detector)
- Show: Top 5-10 questions the KB doesn't cover
- Action: "Add to Knowledge Base" button
- **This is unique** — no competitor has this

### 4.2 AI Performance Metrics
- Confidence distribution (high/medium/low from `aiCache.metadata`)
- Reply method breakdown over time (AI vs Template vs Manual)
- Cache hit rate trends

### 4.3 Response Time Analytics
- Average response time (from `createdAt` to `repliedAt`)
- Response time by channel (comments vs messages)
- SLA compliance rate

### 4.4 Intent Distribution
- What customers are asking about (from `aiIntent` field)
- QUESTION vs COMPLAINT vs PURCHASE_INTENT trends
- Language distribution

### 4.5 Actionable Insights
- "Your AI answered 85% of questions this week"
- "3 new questions your KB doesn't cover"
- "Average response time improved by 20%"

---

## ~~Phase 5: WhatsApp Integration~~ ✅ SHIPPED (2026-07-04, #392)

> Shipped as a full channel: Embedded Signup connect UI, multi-number, voice notes/media, read receipts + typing indicators (#423), sender names + channel badges (#424), inbox customer phone numbers. Behind founder canary until Meta App Review clears (submitted 2026-07-08). **Remaining:** template messages (proactive sends) + status-callback consumption — tracked in `.planning/WHATSAPP_PLAN.md` Phases 4/6.

**Impact**: Massive | **Effort**: High | **Backend readiness**: Architecture supports it

Biggest channel in MENA. The reply pipeline is channel-agnostic.

### 5.1 WhatsApp Business API setup
- Register with Meta WhatsApp Business Platform
- Webhook receiver for incoming messages
- Message sending via API

### 5.2 Backend: WhatsApp message processor
- New `whatsapp_message` job type in reply queue
- Reuse existing pipeline: debounce → pause check → rate limit → KB retrieval → AI reply
- WhatsApp-specific: template messages for first contact (Meta requirement)

### 5.3 Frontend: WhatsApp in Pages
- Link WhatsApp number to page
- Toggle auto-reply for WhatsApp
- WhatsApp conversations in Messages page

### 5.4 Considerations
- WhatsApp Business API approval process
- 24-hour messaging window (Meta policy)
- Template message requirements for outbound
- Pricing (WhatsApp API has per-message costs)

---

## Phase 6: Team Features UI

**Impact**: Medium-High | **Effort**: Low (backend done) | **Backend readiness**: Complete

Backend infrastructure is fully built and running in production (see Completed Work above). Only frontend UI work remains.

### 6.1 ~~Team members table~~ DONE
- `workspace_members` table with RBAC (owner/admin/member) — already in production
- All business data scoped by `workspaceId` — already working

### ~~6.2 Remaining: Team Management UI~~ ✅ SHIPPED (#224 + #252/#253/#278)
- ~~Team management page (list members, roles, remove)~~ `/team` page renders `TeamPanel`
- ~~Invite generation UI (currently API-only)~~ email invites shipped
- ~~Invite accept page~~ `/invites/accept`
- Workspace switcher (for users with >1 workspace) — still open

### 6.3 Remaining: Conversation Assignment (~2 days)
- Assign conversations to specific agents
- "Unassigned" as default (needs attention queue)
- Auto-assignment rules (optional, round-robin)

### 6.4 Remaining: Activity Tracking (~1-2 days)
- Who replied to what
- Agent performance metrics (response time, volume)

### 6.5 ~~Invitation flow~~ Backend DONE
- Hashed token invite system — already built
- Accept/revoke/expiry — already working
- Only needs: frontend invite accept page + invite generation UI

### 6.6 Page-conflict request notification (~3 days)

**Problem:** A Facebook page can have multiple admins on Facebook itself. When two of those admins each sign up for separate Jawab24 workspaces and try to connect the same FB page, only the first connector wins. Today (post commit `e8291a70`) we silently skip the conflict — the second admin sees the friendly "no pages found" empty state with no signal that they actually have a page that's just locked elsewhere. This is *softer than the chat-bot SaaS industry standard* (ManyChat / Chatfuel / Buffer / HubSpot all show a static "page is taken, ask the admin" error). Real conversion loss for new users who can't connect their page and bounce.

**Approach:** When the silent-skip fires, surface the conflict to the *holder* as an in-app + FCM push notification with two CTAs: "Disconnect this page" or "Invite to team". Surface a quiet inline confirmation to the requestor on their empty state ("Request sent to current admin of {pageName}"). Both holder CTAs deeplink to existing endpoints — no new transfer logic, no schema migration. Reuses `sendTemplateNotification`, `useNotificationPoller`, and the workspace_invites flow already in production.

**Why this position:** sits one tier above the chat-bot SaaS industry standard. Stops short of the full Meta-style request → approve → 7-day cooldown → transfer flow, which is overkill until the simpler version proves demand.

**Sizing:** ~100-150 LOC across backend + frontend. New `page_access_request` notification type + template, ~25 LOC change in `pages.ts` silent-skip branch, frontend empty-state copy + notification CTA buttons. Rate-limited 1 per (page, requestor, holder) per 7 days via Redis TTL.

**Full implementation plan:** `~/.claude/plans/what-do-you-think-silly-cook.md` — file-by-file breakdown with industry research backing the design choice.

---

## Phase 7: Posts-first Surface (Post Reply pre-emptive config)

> **2026-07-09 status: the GOAL of this phase shipped via a different route.** Instead of a dedicated `/posts` sidebar surface, a **post picker inside the comments page** lets merchants arm Post Reply on any recent post *before* the first comment arrives (PR #405: `PostPickerSheet` + `usePostReplySetup` + dashboard discovery nudge; backend `/posts` list API built in #405 and consumed by the picker). Any-comment trigger mode also shipped (#389, D-021) and the setup modal was redesigned. The dedicated Posts page + nav entry specced below was **deliberately not built** — revisit only if the picker proves insufficient. Sections 7.1–7.4 below are kept for the original analysis.

**Impact**: High | **Effort**: Medium | **Backend readiness**: Partial (Instagram `getMedia` exists, Facebook list missing)

**Problem:** Today the only entry point to configure a Post Reply (trigger keyword + reply) is a button on a comment card. Jawab24 only learns a Facebook/Instagram post exists when its first comment arrives (`postsService.findOrCreateFromWebhook`). So the very first commenter on an engagement post — the customer the merchant *designed the campaign for* — always misses Post Reply and gets an AI fallback instead. Confirmed in production 2026-05-17: Najem Al Deen commented "تفاصيل" exactly matching the merchant's intended keyword, but the post row was created at `20:43:38.784` (same instant as his comment) and the merchant configured the trigger 7 minutes later. Industry pattern (ManyChat, Chatfuel) is posts-first: merchants browse their pages' recent posts and configure automations *before* publishing or before any comment arrives.

**Approach:** New top-level **Posts** surface in the sidebar. On open, backend syncs recent posts from FB/IG Graph API per connected page (15-min Redis cache, on-demand only — no cron). Reuses existing `usePageFilter` hook for multi-page workspaces and existing `PostTriggerModal` for configuration. Comment-level button stays as discovery shortcut. After save, modal shows forward-only notice: *"Applies to new comments. N already-received comments won't get this reply."*

### 7.1 Backend: Graph API list + sync service
- `facebookService.listPagePosts(token, limit=25)` — `GET /me/posts?fields=id,message,created_time,permalink_url,full_picture` (page-scoped token)
- `instagramService.getMedia()` already exists
- `postsService.syncRecentPostsForPage(pageId)` — upserts via existing `findOrCreateFromWebhook` shape, 15-min Redis cache key `posts:sync:{pageId}`
- Drizzle migration adds `thumbnailUrl`, `permalinkUrl`, `lastSyncedAt` to `posts` and `instagramMedia` tables

### 7.2 Backend: list endpoint sync hook
- `GET /posts` and `GET /pages/:pageId/posts` accept `?sync=1` query — awaits `syncRecentPostsForPage` before DB read
- No new endpoints; no route changes

### 7.3 Frontend: Posts page + nav entry
- New `/posts` route with `DashboardLayout`, horizontal scrollable page chips (reuses `usePageFilter`), grid of `PostCard` components
- `PostCard` shows thumbnail + text preview + page badge + Post Reply status pill, tap opens `PostTriggerModal`
- New `posts` i18n namespace (full 4-step registration per AI_INSTRUCTIONS.md §5)
- Sidebar nav entry added between Pages and Integrations

### 7.4 Forward-only notice + comment-level shortcut
- `PATCH /posts/:id/trigger` response includes `commentsWithoutReplyCount`
- `PostTriggerModal` shows ICU-pluralized notice after save
- Comment-card Post Reply button kept as discovery shortcut (opens same modal)

### 7.5 Out of scope (deliberately deferred)
- Retroactive "send to N existing comments" action — fast-follow after v1 proves out
- Workspace/page-level default Post Reply ("apply to every new post")
- Background cron sync (on-demand + Redis is sufficient for v1)
- Posts page analytics, bulk operations

**Full implementation plan:** `.planning/POSTS_SURFACE_PLAN.md` — file-by-file breakdown including line-level references and end-to-end verification steps.

**Tracking issue:** [#165](https://github.com/aliahdab2/jawab24/issues/165)

---

## Competitive Analysis Summary

### Supported Platforms

| Channel | ManyChat | Intercom | Crisp | **Jawab24** |
|---|---|---|---|---|
| Facebook Comments | ✅ | ❌ | ❌ | **✅** |
| Facebook Messenger | ✅ | ✅ | ✅ | **✅** |
| Instagram Comments | ✅ | ❌ | ❌ | **✅** |
| Instagram DM | ✅ | ❌ | ✅ | **✅** |
| WhatsApp | ✅ | ✅ | ✅ | **✅** (shipped #392; founder canary until Meta review clears; templates pending) |
| Web Chat | ✅ | ✅ | ✅ | ❌ |
| Email | ✅ | ✅ | ✅ | ✅ (Transactional via Resend) |
| SMS | ✅ | ❌ | ❌ | ❌ (rail removed 2026-09-03, D-123 — deliberate: WhatsApp templates cost ~$0.011 against €0.172 for KSA SMS, and KSA denies foreign A2P SMS outright) |

### Direct Competitors (Same niche)

| | CommentGuard | Simple auto-reply tools | **Jawab24** |
|---|---|---|---|
| Keyword rules | ✅ | ✅ | ✅ |
| AI replies | ❌ | ❌ | **✅** RAG + KB |
| Arabic-first | ❌ | ❌ | **✅** |
| Knowledge Base | ❌ | ❌ | **✅** + semantic search |
| Gap detection | ❌ | ❌ | **✅** |
| Mobile app | ❌ | ❌ | **✅** |
| Multi-channel | ❌ | ❌ | **✅** (FB + IG + WhatsApp + Shopify + Salla + Zid) |

### Larger Competitors (Feature comparison)

| Feature | ManyChat | Intercom | Crisp | **Jawab24** |
|---|---|---|---|---|
| Arabic AI | Weak | No | No | **Strong** |
| Chatbot flows | ✅ | ✅ | ✅ | ❌ |
| WhatsApp | ✅ | ✅ | ✅ | **✅** (canary; templates pending Meta review) |
| Team features | ✅ | ✅ | ✅ | **✅** (`/team` page + invites, #224) |
| AI suggested replies | ✅ | ✅ (Fin) | ✅ (MagicReply) | Partial (Smart Reply button, Phase 2 for multi-suggestion chips) |
| Customer profiles / CRM | ✅ | ✅ | ✅ | ❌ (Phase 3) |
| Advanced analytics | ✅ | ✅ | ✅ | Basic + e-commerce dashboard (inbox analytics = Phase 4) |
| Price hallucination guard | ❌ | ❌ | ❌ | **✅ Unique** |
| KB gap detection | ❌ | ❌ | ❌ | **✅ Unique** |
| Semantic caching | ❌ | ❌ | ❌ | **✅ Unique** |
| Bilingual auto-translation | ❌ | ❌ | ❌ | **✅ Unique** |
| E-commerce AI (Shopify/Salla/Zid) | ✅ | ❌ | ❌ | **✅** (3 platforms) |

### Jawab24 Strengths (what no competitor has)

| Strength | Description | Competitive edge |
|----------|-------------|-----------------|
| Arabic-first AI | RAG + Knowledge Base with Arabic normalization (diacritics, alef variants, digit conversion) | No competitor does Arabic AI at this depth |
| KB Gap Detection | Automatically detects questions the Knowledge Base doesn't cover, notifies merchant | No competitor has this |
| Price Hallucination Guard | Prevents AI from inventing incorrect prices from product data | No competitor has this |
| Semantic Caching | pgvector cosine similarity, 70-80% cache hit rate, reduces AI costs significantly | No competitor has this |
| Bilingual Auto-Translation | User writes in one language, system auto-translates to Arabic + English | No competitor does this transparently |
| 3 Reply Modes | Public comment, private message, or both (dual reply) — user configurable per-workspace | Unique flexibility |
| E-commerce-Aware AI | AI reads product catalog (name, price, stock) from Shopify, Salla, and Zid to answer customer questions accurately | Only ManyChat has e-commerce, but not with RAG |

### Jawab24 Weaknesses (gaps to close)

| Weakness | Impact | Fix | Priority |
|----------|--------|-----|----------|
| ~~Only 2 channels~~ | ~~Competitors have 4-6 channels~~ | ~~WhatsApp backend done, UI in Phase 5~~ WhatsApp SHIPPED (#392, canary; templates pending Meta review) | ~~**High**~~ ✅ Resolved |
| No web chat widget | Industry standard for websites. Missing = lost leads from website visitors | Future phase | Medium |
| No chatbot flow builder | ManyChat's core product. Complex to build, but Rules + AI covers 90% of use cases | Not planned (intentional) | Low |
| Limited analytics | Only basic overview dashboard. Competitors have deep insights | Phase 4: Smart Analytics | Medium |
| No customer profiles / CRM | No customer history view, tags, or notes. Competitors surface this | Phase 3: Customer Profiles | Medium |
| No AI suggested replies in inbox | Smart Reply button exists (comments), but competitors show 2-3 AI suggestion chips for agents to pick from | Phase 2: AI Suggestions | **High** |
| ~~No email channel~~ | ~~Standard for support platforms~~ | Resend transactional email implemented | ~~Low~~ ✅ Resolved |
| ~~Team UI not exposed~~ | ~~Backend ready but no team management page, invite UI, or role indicators~~ | `/team` page + email invites shipped (#224; conversation assignment/activity tracking still open — Phase 6.3/6.4) | ~~Low~~ ✅ Mostly resolved |
| No bulk broadcast / campaigns | LetsBot (WhatsApp-first competitor) sends promotional broadcasts to customer lists; Jawab24 has no broadcast feature at all | Deferred — needs segment builder + scheduler + opt-out/compliance | Low (revisit Q3) |

### Jawab24's Unique Differentiator
**Arabic-first AI + RAG + bilingual auto-translation** — no competitor serves the MENA market with this depth. ManyChat has scale, Intercom has enterprise features, but neither does Arabic well. The 4 unique features (gap detection, price guard, semantic caching, auto-translation) have no equivalent in any competitor.

---

## Prioritization Principles

1. **Leverage existing backend** — The backend is ahead of the frontend. Surface what's already built before building new backend features.
2. **Frontend first** — Messages redesign, AI suggestions UI, customer profiles sidebar, analytics dashboards. All use existing data/APIs.
3. **WhatsApp when ready** — Biggest market impact but biggest build. Do it when the core UX is polished.
4. **Team features last** — Current users are solo merchants. Build team features when there's demand.
5. **Don't build chatbot flows** — Rules + AI covers 90% of use cases. A flow builder is a product in itself (ManyChat has 100+ engineers on it).

---

## Timeline Estimate

| Phase | Description | Dependency |
|-------|-------------|------------|
| **Phase 1** | ~~Messages page redesign~~ | Done ✅ |
| **Phase 2** | AI Suggested Replies (Next) | Phase 1 done ✅ |
| **Phase 3** | Customer Profiles | Phase 1 done ✅ |
| **Phase 4** | Smart Analytics | Independent (can parallel with 2-3) |
| **Phase 5** | WhatsApp | Independent (backend-heavy) |
| **Phase 6** | Team Features UI | Backend done ✅ — only UI needed, can start anytime |
