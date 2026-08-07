# Merchant Settings Reference

> The single place that explains every merchant-facing setting: where it is stored, which
> pipeline gate reads it, and what the customer actually receives in each state. Update this
> file **in the same commit** as any change to a settings field or to the gates/auto-messages
> below (AI_INSTRUCTIONS.md Rule 15).

## Storage model

- **`settings` table — keyed by `user_id`, one row per merchant.** Settings are per-user,
  NOT per-page: a merchant with three pages has one settings row governing all of them.
  This legacy row is the **UI write target**; on every save the pipeline-relevant fields
  are synced into the workspace JSONB (`syncPipelineFieldsToWorkspace`).
- **`workspaces.settings` JSONB — the pipeline read target (D-026).** Every reply-path
  gate reads `workspaceSettingsService.getSettings(page.workspaceId)` (JSONB merged over
  read-time defaults, with drift-heal from the owner's legacy row for *missing* keys).
  ⚠️ The two stores drift **by design**: `NEW_SIGNUP_SETTINGS_SEED` (D-025) writes
  auto-reply OFF into the JSONB only, so a new signup's legacy row shows the column
  defaults (everything ON) while the pipeline is silent. Therefore **no display surface
  may show the raw legacy row**: the merchant settings API and the admin support console
  (`getUserDetail` → `overlayPipelineSettings`) both overlay `WORKSPACE_OVERLAY_FIELDS`
  (`services/pipelineFields.ts`) from the workspace store before display/diagnostics.
  Sole exception: `aiModel` — the admin override writes the legacy table and
  `aiModelResolver` reads it back, so legacy is authoritative for that one field.
  The shared overlay loop is `overlayWorkspaceFields` (`services/pipelineFields.ts`) —
  both surfaces call it; never re-implement the loop at a call site.
  - The console resolves **which** workspace to overlay from the displayed pages'
    own `pages.workspaceId` (what the pipeline keys on), falling back to
    memberships only when there are no pages (`resolvePipelineWorkspaceId`).
  - The console payload carries `settings.source`: `'effective'` (overlaid) or
    `'legacy-fallback'` (overlay unavailable — the UI shows a warning banner,
    because raw legacy values are exactly the state that hid the 30 silent
    post-D-025 signups).
  - The console's "changed from default" markers compare against the **legacy
    column defaults** — so every post-D-025 signup shows `commentsAutoReply`,
    `messagesAutoReply`, `commentReplyMode` as changed. That is the signup seed,
    not merchant action.
- **`pages.auto_reply_enabled` — the page master switch** lives on the page row, not in
  settings. `pages.auto_reply_disabled_reason` records who/what turned it off (`user`, …).
- **Multilingual fields** (`*_multi` JSONB) hold `{ ar, en, sourceLang }`. `sourceLang`
  (`'ar' | 'en' | 'manual' | 'default'`) is **bookkeeping for the auto-translate flow, not
  copy**. Anything reading these records must go through
  `workspaceSettings.pickMultilingualText()`, which excludes it — a naive
  `Object.values(multi).find(...)` sent the literal string `"manual"` as a customer message
  (fixed 2026-08-02; `getLimitFallbackMessage` had the same guard inline since earlier).
- Legacy single-language columns (`away_message`, `greeting_message`, `brand_voice_notes`)
  still exist; the pipeline reads the `*_multi` variants via `workspaceSettingsService`.

## The gate chain (what runs before any reply)

A DM passes these in order (`messageProcessor.processMessage`); a comment passes the
equivalents in `commentProcessor`:

| # | Gate | Setting read | Customer sees when it blocks |
|---|------|--------------|------------------------------|
| 1 | **Page master switch** | `pages.auto_reply_enabled` | **Nothing, ever.** Page OFF = Jawab24 invisible: no reply, no flag, no notification. Kills Smart Reply, Post Reply, away AND greeting. Messages are still stored; comments are NOT. |
| 2 | **Subscription gate** | subscription status. The 3-day grace applies only to **externally-billed** `past_due` (Stripe/Shopify card-retry); a trial-origin subscription (`payment_method IS NULL`) hard-stops at `trial_ends_at` — the lazy `trialing → past_due` flip no longer inherits the grace (2026-08-04: it used to hand every expiring trial ~4 free days; one merchant sent 760 replies through it). | Nothing. Merchant gets a one-per-24h "replies frozen" notification; an expiring trial additionally gets the one-time proactive `trial_ended` notice (in-app + email, daily cron). |
| 3 | **Handoff pause** | `handoffPauseDurationMinutes` | Nothing while a human is handling the thread; stale backlog is dropped on resume. |
| 4 | **Rate limit** | per (page, sender) | Nothing beyond the limit. |
| 5 | **Channel enabled check** | `messagesAutoReply` / `commentsAutoReply` **folded with** `businessHoursOnly` + hours + `timezone` (`isAutoReplyEnabledFromSettings`) | See the away-message matrix below — this one branch serves two very different states. |
| 6 | **Low-confidence hold** | `holdLowConfidence` | Nothing (reply generated but parked for merchant review). ⚠️ Known defect: the hold early-returns before `maybeCaptureLead`, so held messages never produce a lead. |

**D-027:** Post Reply is exempt from the **workspace** `commentsAutoReply` toggle only —
the page master switch (gate 1) still kills it.

### Gate 5 is TWO states in one boolean — never conflate them

`isAutoReplyEnabledFromSettings(settings, 'messages')` returns false for **either**:

| State | Meaning | Duration | Away default allowed? |
|-------|---------|----------|----------------------|
| `messagesAutoReply = false` | Merchant switched DM auto-reply **off** | **Permanent** — there is no "later" | **No** — authored text only (`allowDefault: false`). Off means off; we never invent copy for a channel the merchant disabled. |
| `messagesAutoReply = true` + `businessHoursOnly = true` + outside hours | Temporarily closed | Until opening time | **Yes** — the shipped default («خارج أوقات العمل») is *true* here. |

History (2026-08-01): a pharmacy with DMs off, **no** business hours, and **no** authored
away message sent 37 customers our default «نحن حالياً خارج أوقات العمل» — at 09:05, in
copy the merchant never saw. The send site distinguishes the two states via `allowDefault`
since 2026-08-02.

## Auto-message matrix

| Message | Trigger | Text source (in order) | Throttle |
|---------|---------|------------------------|----------|
| **Greeting** | First incoming message from a customer, `greetingMessageEnabled = true` | `greetingMessageMulti` (authored only — **no shipped default**) | Once per customer (`isFirstIncomingMessage` + no prior outgoing) |
| **Away** | Gate 5 blocks | `awayMessageMulti` → shipped `defaultAway` **only on the business-hours branch** | Once per (page, sender) per **24h** — Redis `SET NX EX`, key `away_msg:*`. **Fail-open**: Redis error ⇒ send (a duplicate beats silence). |
| **Quota fallback** | Monthly Smart Reply limit exhausted, `limitFallbackEnabled = true` | `limitFallbackMessageMulti` → i18n `messageFallback` / `commentFallback` | — |
| **Non-text nudge** | Unsupported media (failed transcription etc.) | i18n `nonTextNudge` | — |
| **Dual-reply nudge** | Public comment answered + DM sent (`commentReplyMode = 'dual'`) | `dualReplyNudgeVariations` / `dualReplyNudgeMulti` → i18n `dualNudgeDefault` | — |

"Get Started" / «بدء الاستخدام» openers are system phrases: they fire the greeting when
enabled and are silently suppressed otherwise — they never reach the AI.

## Test reply («اختبار الرد الذكي») — settings it applies

`POST /pages/:id/test-reply` (`controllers/pages.ts` → `buildPlaygroundContext` →
`replyGenerator.generateForPlayground`) exists to show the merchant the reply their
customers would get. Anything the production pipeline applies that it omits is a lie to
the merchant, so the settings below are resolved from the **workspace store** — the same
`workspaceSettingsService.getSettings(page.workspaceId)` object `messageProcessor` /
`commentProcessor` read:

| Setting | How the test reply resolves it |
|---------|-------------------------------|
| `brandVoiceNotes` / `brandVoiceNotesMulti` | `resolveBrandVoiceNotes(workspaceSettings, question)` — the same choke point `enrichPageContext` uses for production replies |
| `replyStyle` | `workspaceSettings.replyStyle` (defaults to `professional`) |
| `defaultReplyLanguage`, `timezone` | `workspaceSettings` |
| `commentReplyMode` + `dualReplyNudgeVariations` | owner's `settingsService.getSettings(page.userId)` (workspace-overlaid). ⚠️ Not the page's workspace: `resolveWorkspaceId` picks an arbitrary membership, so a user in several workspaces can be shown another workspace's mode |

**Admin overrides still win.** The admin playground (`services/admin/kb.ts`) and the eval
harness may pass an explicit `brandVoiceNotes` / `replyStyle`; a supplied value is used
verbatim and only an *absent* one falls back to the stored setting. A settings read that
fails degrades to no persona — it never fails the test reply.

> **Why this is called out:** until 2026-08-07 those two options were labelled "admin-only
> overrides" and had no fallback, so the merchant test answered «تمام يهمني، نبي نجرب»
> with a self-serve link while production — carrying the stored persona's "ask for the
> customer's name and WhatsApp number" instruction — answered «تمام، ابعث لي اسمك ورقم
> واتساب…». Pinned by `backend/test/services/reply/playgroundPersona.test.ts`.

**Known remaining drift** (production applies, the test reply does not): the narrative
`--- Business Info ---` block that `enrichPageContext` appends to the KB from
`formatBusinessProfile(page.businessProfile)` (business type / about / website). Fixing it
moves every eval baseline, so it is tracked separately rather than folded in here.

## Field reference (`UserSettings`, `backend/src/types/settings.ts`)

| Field | Used by | Semantics |
|-------|---------|-----------|
| `aiEnabled` | reply pipeline | Master AI toggle. |
| `aiModel` | ai-worker | Per-merchant model override (default set in admin settings table). |
| `messagesAutoReply` / `commentsAutoReply` | gate 5 | Per-channel workspace toggles. See the two-states table above. |
| `commentReplyMode` | commentProcessor | `public` / `private` (DM) / `dual` (both + nudge). |
| `businessHoursOnly` + `businessHoursStart`/`End` + `timezone` | gate 5 | Schedule gate. ⚠️ Default `timezone` is `Asia/Riyadh` — wrong-country merchants run hours offset. |
| `awayMessage` / `awayMessageMulti` | away branch | Merchant-authored away text. ⚠️ UI gap: the edit field (`BusinessHoursCard`) is disabled unless `businessHoursOnly` is on, yet the message can also fire on the toggle-off branch. |
| `greetingMessage` / `greetingMessageMulti` + `greetingMessageEnabled` | greeting | First-contact welcome. Toggle read-back once regressed to always-off — keep it in the settings GET. |
| `limitFallbackEnabled` + `limitFallbackMessageMulti` | quota exhaustion | Master switch + custom text; when off, silence at the limit. |
| `dualReplyNudge` / `dualReplyNudgeMulti` / `dualReplyNudgeVariations` | dual mode | The "check your DMs" comment; variations rotate. |
| `replyDelay` | both processors | 0–300s humanized delay (`computeHumanDelayMs`). Also disables the debounce fast-path when > 0. |
| `commentEscalationMinutes` / `messageEscalationMinutes` | `escalation.ts` cron | Unanswered-thread thresholds (defaults 60 / 30) before Needs Attention escalation. |
| `handoffPauseDurationMinutes` | gate 3 | How long a manual reply pauses the AI on that thread. |
| `holdLowConfidence` | gate 6 | Park low-confidence replies for review. See lead-capture defect above. |
| `brandVoiceNotes` / `brandVoiceNotesMulti` | prompt builder | The persona — injected verbatim into the system prompt. Ships as a `[...]` placeholder template; unedited = generic replies. Always resolved through `resolveBrandVoiceNotes(settings, message)` (`services/reply/contextEnricher.ts`) — it is also a reply-cache key segment (`bv:`), so a second copy of the language-pick rule strands warmed entries. |
| `replyStyle` | prompt builder + `ai.ts` context + reply-cache key | `professional` / `casual` / `enthusiastic`. Selects the tone directive in the ai-worker's `styleMap` (`promptBuilder.ts`) and is part of the semantic cache key. (The `[future]` markers next to it in `pages.ts` are about wiring its writer into prompt-cache invalidation, NOT about whether the prompt reads it — it does, today.) |
| `dashboardLanguage` | frontend | UI locale only — never reply language. |
| `defaultReplyLanguage` + `supportedLanguages` + `autoDetectLanguage` | language resolution | Template/reply language pick (`resolveLanguage`). |
| `notificationsEnabled` / `newLeadAlertsEnabled` | push/email | Notification toggles. |
| `onboardingCompletedAt` | frontend | Onboarding flow marker. |

## Traps (each cost a real investigation)

1. **One boolean, two off-states** — always check `messagesAutoReply` separately before
   reasoning about "why did/didn't the away message send" (gate 5 table).
2. **`sourceLang` is not a language entry** — go through `pickMultilingualText`.
3. **The away field's UI gating ≠ its firing conditions** — a merchant can be sending an
   away message they cannot see or edit (field gated behind Business Hours).
4. **Page-off comments are not stored** — absence of rows IS the evidence, not a gap.
5. **Settings are per-user** — for multi-page merchants resolve settings once, then reason
   per page (only `pages.auto_reply_enabled` varies per page).
6. **`timezone` default is `Asia/Riyadh`** — a Libyan/Egyptian merchant who never touched
   it runs business hours 1–2h off.
