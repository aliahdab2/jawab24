# Posts-first Surface — Implementation Plan (v1)

> Tracking issue: https://github.com/aliahdab2/jawab24/issues/165
> Originated: production investigation 2026-05-17 — Najem Al Deen "تفاصيل" comment received AI reply instead of configured Post Reply.

## Context

A Najem Al Deen "تفاصيل" comment on a fresh Facebook post received an AI reply instead of the merchant's intended Post Reply. Production log + DB investigation showed the root cause is **not** a matching bug:

- Post row `6c63c932-…` was created at `20:43:38.784` — the same instant Najem's comment was processed.
- The merchant configured the trigger 7 minutes later, via 7 rapid PATCHes ending `20:52:38`.
- Jawab24 only learns a post exists when its first comment arrives (`postsService.findOrCreateFromWebhook`). So the very first commenter — the customer engagement campaigns are designed for — always misses Post Reply.

Structural UX problem: the only entry point to configure Post Reply is a button on a comment card (`CommentCard.tsx:200`). Merchants can't reach the feature before any comment exists, and once they reach it, the discovery comment itself has already been answered by AI.

**Intended outcome:** a top-level **Posts** surface where merchants browse their actual Facebook/Instagram posts (pulled live from Graph API) and configure Post Reply *before* the first comment arrives. Industry pattern (ManyChat) — adapted to Jawab24's posts-first mental model.

**v1 decisions confirmed:**
- Scope: Facebook + Instagram unified
- Sync strategy: on-demand fetch when merchant opens `/posts`, 15-min Redis cache
- Retroactive apply: forward-only with explicit notice ("N already received won't get this reply"); the retroactive "send to N comments" action deferred to a fast-follow

---

## Flow (merchant's perspective)

1. Merchant publishes engagement post on Facebook ("comment تفاصيل for details")
2. Merchant opens Jawab24 → taps **Posts** in sidebar (new nav entry)
3. Posts page loads → backend syncs recent posts from Graph API for each connected page → cards appear with thumbnail, text preview, page badge, and "Post Reply: Off" pill
4. Merchant taps a post card → `PostTriggerModal` opens (existing component, no change)
5. Merchant saves keyword + reply → success toast + forward-only notice: *"Applies to new comments. N comments already on this post won't get this reply."*
6. Next commenter on the post matches the keyword → Post Reply fires (existing code at `commentProcessor.ts:248`)

The comment-card "Post Reply" button stays as a discovery shortcut — opens the same modal — but with the forward-only notice prominent.

---

## Phases

### Phase 1 — Backend: Graph API list + sync service

**Goal:** make posts/media listable proactively, not just via webhook.

**Files to add/modify:**

- `backend/src/services/facebook.ts` — add `listPagePosts(pageAccessToken: string, limit = 25)` that calls `GET /me/posts?fields=id,message,created_time,permalink_url,full_picture&limit={limit}` (page-scoped token so `me` resolves to the page). Mirror the existing `getPostContent` shape and error handling at line 403.
- `backend/src/services/instagram.ts` — `getMedia()` already exists at line 67. No change.
- `backend/src/services/posts.ts` — add `syncRecentPostsForPage(pageId: string)`:
  - Read `pages` row → get `accessToken`, platform
  - Call `facebookService.listPagePosts` (or `instagramService.getMedia` based on platform)
  - For each returned post, upsert via existing `findOrCreateFromWebhook` shape (already handles "exists with no message → fetch + update" at `posts.ts:215`). Extend to also persist `createdTime` and (new column) `thumbnailUrl` + `permalinkUrl` when returned.
  - Redis cache key `posts:sync:{pageId}` with 15-min TTL — if hit, skip the Graph call and just return current DB state.
  - Return count synced.
- `backend/src/db/schema.ts` — add to `posts` and `instagramMedia` tables: `thumbnailUrl: text('thumbnail_url')`, `permalinkUrl: text('permalink_url')`, `lastSyncedAt: timestamp('last_synced_at')`. Generate Drizzle migration via `npm run db:generate` (NEVER write manual SQL — per AI_INSTRUCTIONS.md §"Drizzle Migrations").

**Reuse:**
- `findOrCreateFromWebhook` at `backend/src/services/posts.ts:211` — extend its upsert path instead of writing a parallel bulk-insert.
- Existing Redis client + 15-min cache pattern (see `workspaceSettingsService` for the cache shape).

### Phase 2 — Backend: list endpoint sync hook

**Goal:** existing posts list endpoints trigger a sync on first request, then serve from DB.

**Files to modify:**

- `backend/src/controllers/posts.ts` — extend `GET /posts` and `GET /pages/:pageId/posts` handlers to accept `?sync=1` query. When set, await `syncRecentPostsForPage` for each relevant page before the DB read. Cache layer makes repeat calls cheap.
- `backend/src/routes/posts.ts` — no route changes; same paths.

**Reuse:**
- Existing `postsService.getPostsByWorkspace` (line 48) and `getPostsByPage` (line 36) for the read path.
- Existing workspace-scoping middleware.

### Phase 3 — Frontend: Posts page + nav entry

**Goal:** new `/posts` route that merchants can reach without a comment.

**Files to add/modify:**

- `frontend/src/pages/posts.tsx` — new page. Layout:
  - `DashboardLayout` chrome
  - Horizontal scrollable page chips at top (reuse `usePageFilter` hook — already at `frontend/src/hooks/usePageFilter.ts`, returns `pageId`, `validPages`, `updatePageId`)
  - Grid/list of `PostCard` components
  - First-load: fetch `postsApi.getByPage(pageId, { sync: true })` (extend `postsApi` to pass `sync=1`). Subsequent renders: no `sync` flag — DB-served, fast.
  - Empty state: "No posts yet. Publish a post on Facebook and pull to refresh."
- `frontend/src/components/posts/PostCard.tsx` — new component:
  - Thumbnail (from `thumbnailUrl`) + first 2 lines of message + relative date
  - Page badge chip (page name + platform icon)
  - Status pill: `postReplyActive` (`تفاصيل +4`) or `postReplyOff`
  - Tap → opens `PostTriggerModal` (existing at `frontend/src/components/comments/PostTriggerModal.tsx`, no change needed — already modal-ready)
- `frontend/src/components/layout/Sidebar.tsx:144` — add `{ name: t('posts'), href: '/posts', icon: PostIcon }` to `overviewItems` between Pages and Integrations.
- `frontend/src/lib/api.ts` — extend `postsApi.getAll`/`getByPage` to accept `{ sync?: boolean }`.
- `frontend/src/i18n/en/posts.json` + `frontend/src/i18n/ar/posts.json` — new namespace with: `title`, `empty`, `postReplyActive`, `postReplyOff`, `refresh`, `configureReply`, `forwardOnlyNotice` (ICU plural for the count).
- `frontend/src/i18n/getMessages.ts` — register `posts` namespace (EN import + AR import + entry in `NS` lookup table). **All four registration steps** — per AI_INSTRUCTIONS.md §5.
- `frontend/src/i18n/namespaces.ts` — add `'posts'` to `PAGE_NAMESPACES`.
- `frontend/src/i18n/en/sidebar.json` + `ar/sidebar.json` — add `posts` key for the nav label.

**Reuse:**
- `usePageFilter` — confirmed full multi-page support exists (`frontend/src/hooks/usePageFilter.ts`).
- `PostTriggerModal` — confirmed already takes `postId`, `source`, `triggerKeyword`, `triggerReply` and posts back to `PATCH /posts/:id/trigger`. Zero changes needed.
- `DashboardLayout` for chrome.

**RTL/i18n constraints:**
- All Tailwind classes must use logical properties (`ps-*`, `pe-*`, `text-start`) — per AI_INSTRUCTIONS.md §2.
- Status pill colors must use semantic classes (`status-success`, `status-muted`) from `globals.css` — per AI_INSTRUCTIONS.md §11.
- Page chip strip must work in both RTL and LTR — horizontal scroll, no `left/right` physical positioning.

### Phase 4 — Forward-only notice + comment-level shortcut

**Goal:** kill the surprise that started this investigation.

**Files to add/modify:**

- `backend/src/controllers/posts.ts` — extend `PATCH /posts/:id/trigger` response to include `commentsWithoutReplyCount`: count of comments on this post with `reply_method IS NULL` (no reply sent yet) — bounded query, cheap.
- `frontend/src/components/comments/PostTriggerModal.tsx` — after successful save, show a notice using the returned count:
  - *"Applies to new comments. {count, plural, one {# comment already on this post will not get this reply} other {# comments already on this post will not get this reply}}."*
- `frontend/src/components/comments/CommentCard.tsx:200` — keep existing Post Reply button. No copy change in v1, but the modal it opens now shows the same forward-only notice.

**Reuse:**
- ICU plural already required everywhere — see `frontend/docs/TRANSLATION_GUIDE.md`.

---

## Critical files (single-glance reference)

| Path | Change |
|---|---|
| `backend/src/services/facebook.ts:403` | Add `listPagePosts` |
| `backend/src/services/posts.ts:211` | Extend `findOrCreateFromWebhook` callers; add `syncRecentPostsForPage` |
| `backend/src/controllers/posts.ts` | Accept `?sync=1` on GET; return `commentsWithoutReplyCount` from PATCH /trigger |
| `backend/src/db/schema.ts:173,195` | Add `thumbnailUrl`, `permalinkUrl`, `lastSyncedAt` to posts + instagramMedia |
| `frontend/src/pages/posts.tsx` | New page |
| `frontend/src/components/posts/PostCard.tsx` | New component |
| `frontend/src/components/layout/Sidebar.tsx:144` | Add nav entry |
| `frontend/src/components/comments/PostTriggerModal.tsx` | Show forward-only notice after save |
| `frontend/src/i18n/{en,ar}/posts.json` | New namespace + 4-step registration |
| `frontend/src/hooks/usePageFilter.ts` | Reuse as-is |

---

## Verification

End-to-end test sequence after implementation:

1. **Schema migration applies cleanly**: `cd backend && npm run db:generate`, then `npm run db:migrate`. Verify new columns via `\d posts` and `\d instagram_media`.
2. **Facebook list works**: in `backend` REPL or a quick script, call `facebookService.listPagePosts(testPageToken, 5)`. Should return 5 posts with id/message/permalink/full_picture.
3. **Sync upserts via webhook path**: run `syncRecentPostsForPage` for a test page that has no posts in DB. Verify rows appear with `thumbnailUrl`, `permalinkUrl`, `lastSyncedAt` populated.
4. **Cache deduplication**: call `syncRecentPostsForPage` twice within 15 min — second call should hit Redis cache and skip Graph API (verify via Graph API quota or log line).
5. **Frontend Posts page renders**: navigate to `/posts`, see cards for each post, page chips at top, can switch pages. Test on mobile viewport (Capacitor app) — chips scroll horizontally, RTL when locale is `ar`.
6. **Configure Post Reply pre-emptively**: pick a post that has zero comments in DB, configure trigger via `PostTriggerModal`, save. Verify success notice shows "0 comments already" (or hides the notice when count is 0).
7. **Forward-only notice with non-zero count**: pick a post that already has unreplied comments, save trigger. Notice shows correct ICU pluralized count.
8. **Regression test for the original bug**: publish a fresh post on the Facebook test page → before any comment → open `/posts` → post appears → configure trigger with "تفاصيل" → comment "تفاصيل" from a tester → Post Reply fires, AI does not.
9. **Tests**: `npm run test` (unit) + `cd frontend && npm run test:e2e` (relevant specs). Add a backend unit test for `syncRecentPostsForPage` cache-hit + cache-miss paths. Add an E2E test for the Posts page navigation flow.
10. **Lint clean**: `npm run lint` — zero errors, zero warnings (per AI_INSTRUCTIONS.md §7).
11. **Translation validate**: `cd frontend && npm run translation:validate`.

## Out of scope (deliberately)

- Retroactive "send to N existing comments" action — deferred. v1 notice tells merchants the count exists; the action to send those replies is a fast-follow once forward-only is shipped and proven.
- Workspace/page-level default Post Reply ("apply to every new post") — deferred. Per-post is enough to validate the Posts surface.
- Background cron sync — on-demand + 15-min Redis cache is sufficient for v1.
- Posts page analytics (replies sent, conversion rates) — deferred.
- Bulk operations (apply same trigger to N posts at once) — deferred.
