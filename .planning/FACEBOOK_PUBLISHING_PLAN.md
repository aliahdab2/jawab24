# Facebook Publishing for «بوست اليوم» — Implementation Plan

> Arabic reading copy: https://claude.ai/code/artifact/6c4b7fb8-09ff-4585-b1c1-c1aff3af8413
> Originated: 2026-08-10, immediately after the post-suggestions pilot was enabled in production.
> Goal: Jawab24 publishes the generated post to the merchant's Facebook Page, eventually unattended.

## Context

The «بوست اليوم» pilot went live in production on 2026-08-10 (`POST_SUGGESTIONS_ENABLED=true`,
founder workspace, 2 connected pages). Generation is complete — text, designed card image,
object storage, the 3/day cap. What does not exist is publishing: the merchant copies the
text, downloads the image, and posts it by hand.

**Publishing is blocked at the token level.** `FB_SCOPES`
(`frontend/src/lib/facebookOAuth.ts`) requests ten permissions and `pages_manage_posts` is
not among them, so no page token we hold can post. This is deliberate and already recorded
in `SYSTEM_ANALYSIS.md`, `backend/src/db/schema.ts`, and `backend/src/services/postSuggestions.ts`.

## The constraint that fixes the order

**You cannot apply for the permission first and build afterwards.** Meta reviews a working
integration: the submission needs a screencast of `pages_manage_posts` genuinely in use.
Applying before the publish path exists reproduces our only rejection:

| Date | Permissions | Result |
|------|-------------|--------|
| 2026-03-12 | pages_messaging, pages_manage_metadata, pages_show_list | ❌ **"Screencast Not Aligned with Use Case Details"** — did not show asset selection, the live send action, or the delivered result in Meta's own client |
| 2026-03-21 | same | ✅ Approved after re-recording with those three beats |
| 2026-04-07 | 6 new permissions + renewals | ✅ Approved |

**The unlock:** Standard Access covers app admins and testers acting on pages they hold a
role on. Stages 1–2 can therefore be built and dogfooded on our own pages with no review at
all — and that working flow is exactly what the screencast is made from. The build is not
blocked on Meta; only Stage 3 sits in Meta's queue.

> ⚠️ The Standard Access route is carried from the April 2026 App Review notes (124 days old
> at time of writing). Confirm it in the App Dashboard against Meta's current documentation
> before scheduling Stage 1 — it is the single load-bearing assumption in this plan.

## Stages

Each stage gates the next.

### Stage 1 — The publish path, our pages only (no review needed)

- Publish the generated card through the Graph API; keep the returned post id.
- **Idempotency is the load-bearing requirement.** A published post is public and permanent,
  so one suggestion maps to at most one post id, *forever*. Enforce it in the database, not
  in application flow — retries and blue/green deploys both make a double-post plausible.
- A publish failure is reported to the **merchant**, not only to Sentry — the posture D-060
  already set for scheduled-post triggers.
- Behind a flag, default off, like the pilot itself.

**Gate:** a post created from inside Jawab24 appears on the real Page.

### Stage 2 — Approve, then publish (no review needed)

- One action in `PostSuggestionSheet`, alongside Copy text and Save image. The card then
  shows the post as published, with a link to it.
- **The real prize:** holding the post id lets a Post Reply trigger be armed on the post we
  just published. The generate → post → auto-reply chain that works manually today collapses
  into one tap.
- Approval stays the default. Automatic publishing is a later toggle, not the starting
  behaviour.

**Gate:** daily use for a week without reaching for the manual path.

### Stage 3 — App Review submission (Meta's timeline)

- Screencast built from the working flow, hitting the three beats that turned the 03-12
  rejection around: **select the page → publish from Jawab24 → the post visible on the Page
  in Facebook's own client.**
- Use-case text: merchant-authored content published on the merchant's instruction — not
  bulk or automated broadcast.
- Reviewer assets (both have cleared review twice):
  - App ID `774211662298446`
  - Test page **Jawab24 Test** — `1074356795756273`
  - Tester account from the April 2026 notes (rotate its password before sharing again)
- Submit as early as a working demo allows; everything after this waits on it.

**Gate:** Advanced Access granted for `pages_manage_posts`.

### Stage 4 — Fleet rollout, then automatic (needs approval first)

- **Approval alone changes nothing for existing merchants.** Scopes are granted at connect
  time, so every already-connected page needs a reconnect before it can publish. Plan it as
  a prompt, not a silent capability.
- Login and reconnect must keep requesting the same list. The single `FB_SCOPES` array
  exists precisely because those two drifting apart caused a silent capability loss before.
- Per-page opt-in first. Only then the automatic toggle, where the daily cron publishes what
  it generates.
- Ship the kill switch with it, not after it.

**Gate:** automatic publishing runs unattended on opted-in pages.

## Risks

| Risk | Why it bites | Mitigation |
|------|--------------|------------|
| **Double posting** | A duplicate on a merchant's public Page is visible, permanent, embarrassing. Retries and blue/green deploys both make it plausible. | One suggestion → at most one post id, enforced in the DB. |
| **Screencast rejected again** | Costs a full review cycle — the exact failure of 2026-03-12. | Record the three beats, ending in Facebook's own client. |
| **A bad post goes out unattended** | Public and permanent; far higher trust cost than a poor DM reply, which only one customer sees. | Approval by default; automatic is per-page opt-in; kill switch from day one. |
| **Merchants never reconnect** | Publishing silently does nothing and looks broken. | Disable per page with a stated reason and a reconnect prompt — never a silent no-op. |
| **Scope drift between entry points** | Reconnect asking for less than login is a capability loss nobody notices until a merchant breaks. | One scope list; the exact-string tests already guard it. |

## Open decisions

1. **How is the scope requested before approval lands?** Adding it to the shared list today
   makes every merchant's consent dialog ask for a permission Meta will not grant them yet.
   Gating it avoids that but must not let login and reconnect drift apart.
2. **Does "automatic" mean no approval, or approved-then-scheduled?** Both are reachable
   from the same foundation but they are different products: one removes the merchant from
   the loop, the other only removes the timing chore. Decides whether Stage 4 needs a
   scheduler at all.
3. **Publish immediately, or at a chosen time?** Scheduling means Facebook owns the eventual
   post id — the uncertainty D-060 already documents — and it complicates arming a Post
   Reply on the result.

## Verification trail

Facts checked against the codebase on 2026-08-10: `FB_SCOPES` in
`frontend/src/lib/facebookOAuth.ts`; the no-publishing note in `SYSTEM_ANALYSIS.md`,
`backend/src/db/schema.ts` and `backend/src/services/postSuggestions.ts`; App ID default in
`frontend/next.config.js`. Review history and reviewer assets come from the April 2026 App
Review notes and should be re-checked in the App Dashboard before submitting.
