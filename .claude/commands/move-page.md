Move a connected Facebook/Instagram page from one Jawab24 account to another, in production, without stranding its inbox. Use when a merchant says "I connected my page but I only see one page" and the missing page turns out to be held by a different Jawab24 account.

Arguments: $ARGUMENTS
- The page (name in Arabic or English, `facebook_page_id`, or page UUID) and the destination merchant (email or user UUID).
- Optional `dry-run` → do every check and print the transaction, but don't execute it.

**This skill writes to production.** `./scripts/prod-db-query.sh` is SELECT-only and cannot perform the move; the writes go through the `docker exec psql` pattern below. Never run the transaction until Steps 1–4 are all green and the founder has approved. A page move is visible to two customers at once — get it right the first time.

## The core question

**Is this a transfer, or a conflict?** They look identical in the data and need opposite responses.

- **Transfer** — the business genuinely changed hands, or one person set the page up under the wrong account. The right fix is this skill.
- **Conflict** — two admins of the same FB page each signed up separately, and both still want it. The right fix is *not* a silent move: it's the holder disconnecting, or inviting the other to their workspace (`workspace_invites`). Moving the page out from under an active user is a support incident waiting to happen.

Establish which one you're in **before touching anything**, by asking the founder. The DB cannot tell you.

## Step 1 — Find the page and both sides

```bash
./scripts/prod-db-query.sh "
SELECT p.id AS page_id, p.name, p.facebook_page_id, p.workspace_id,
       p.user_id, u.email AS held_by, w.name AS workspace_name,
       p.auto_reply_enabled, p.auto_reply_disabled_reason,
       (p.access_token = '') AS disconnected, p.disconnect_reason,
       p.instagram_account_id, p.instagram_username,
       p.whatsapp_phone_number_id, p.ecommerce_store_id,
       p.lead_stages IS NOT NULL AS has_lead_overrides,
       p.created_at, p.updated_at
FROM pages p
JOIN users u ON u.id = p.user_id
JOIN workspaces w ON w.id = p.workspace_id
WHERE p.facebook_page_id = '<FB_PAGE_ID>';"
```

Then the destination: run `/merchant-settings <destination email>` if you haven't already. You need their `user_id`, `workspace_id`, plan `max_pages`, and current page count.

**If the page is `disconnected = t`, stop — you probably don't need this skill.** A disconnected page is claimable: the destination merchant simply syncs and the reclaim path in `services/pages.ts` moves it for them, correctly and with their own token. Only reach for a manual move when the page is *actively connected* to the wrong account.

## Step 2 — Check the destination can actually hold it

```bash
./scripts/prod-db-query.sh "
SELECT u.email, pl.slug AS plan, pl.max_pages, s.status,
       (SELECT COUNT(*) FROM pages WHERE workspace_id = w.id) AS pages_now,
       (SELECT COUNT(*) FROM pages WHERE workspace_id = w.id AND auto_reply_enabled) AS enabled_now
FROM users u
JOIN workspaces w ON w.owner_id = u.id
LEFT JOIN subscriptions s ON s.user_id = u.id
LEFT JOIN plans pl ON pl.id = s.plan_id
WHERE u.email = '<DEST_EMAIL>';"
```

- `pages_now >= max_pages` → the move puts them over their plan. Don't silently over-provision: either they upgrade, or they disconnect another page first. Say so before moving.
- `status <> 'active'` and not `trialing` → moving a page to a dead subscription gives them a page that can't reply. Fix billing first.

Also check who claimed the page's **free trial**, because it does not move with the page:

```bash
./scripts/prod-db-query.sh "
SELECT ct.channel_type, ct.channel_id, ct.first_trialed_at, u.email AS claimed_by
FROM channel_trials ct LEFT JOIN users u ON u.id = ct.first_user_id
WHERE ct.channel_id IN ('<FB_PAGE_ID>', '<INSTAGRAM_ACCOUNT_ID>');"
```

The claim stays with the original account by design (`onConflictDoNothing`, first writer wins). That's **harmless if the destination pays** — `channelTrial.evaluate()` exempts accounts with a paid subscription. It **blocks auto-reply** if the destination is on a free trial: they'd get the page connected but switched off with `auto_reply_disabled_reason = 'trial_block'`. Warn the founder when that's the case; the answer is usually "they need to subscribe", not a DB edit.

## Step 3 — Size the data that travels with it

```bash
./scripts/prod-db-query.sh "
SELECT (SELECT count(*) FROM conversations WHERE page_id='<PAGE_ID>') AS conversations,
       (SELECT count(*) FROM messages WHERE page_id='<PAGE_ID>') AS messages,
       (SELECT count(*) FROM posts WHERE page_id='<PAGE_ID>') AS posts,
       (SELECT count(*) FROM comments c JOIN posts p ON p.id=c.post_id WHERE p.page_id='<PAGE_ID>') AS comments,
       (SELECT count(*) FROM instagram_media WHERE page_id='<PAGE_ID>') AS ig_media,
       (SELECT count(*) FROM instagram_comments ic JOIN instagram_media im ON im.id=ic.media_id WHERE im.page_id='<PAGE_ID>') AS ig_comments,
       (SELECT count(*) FROM leads WHERE page_id='<PAGE_ID>') AS leads,
       (SELECT count(*) FROM kb_chunks WHERE page_id='<PAGE_ID>') AS kb_chunks;"
```

The page keeps its UUID, so **everything scoped by `page_id` follows automatically** — conversations, posts, leads, kb_chunks, catalog_items, semantic_cache, kb_gaps, instagram_media.

Report these numbers to the founder before moving. The destination merchant will see the previous owner's customer conversations, leads and Business Info. That is usually correct for a genuine transfer and completely wrong for a conflict — it is the strongest reason to have settled Step 0 honestly.

## Step 4 — The three columns that do NOT follow

This is the whole reason the skill exists. `comments`, `instagram_comments` and `messages` each carry a **denormalized copy of `pages.workspace_id`** (added for the workspace-scoped inbox indexes — see `schema.ts`). Move the page row alone and its entire inbox stays behind: still visible to the previous owner, invisible to the new one.

- `comments` → no `page_id`; reach it through `posts.post_id`
- `instagram_comments` → no `page_id`; reach it through `instagram_media.media_id`
- `messages` → has `page_id` directly

**Do NOT move** `ai_usage_log`, `logs`, or `usage`. Those record who incurred a cost or performed an action at the time; they stay attributed to the previous owner. Moving them would misreport spend on the admin cost panel.

## Step 5 — Execute

Run as ONE transaction with the verification inside it, so a surprise count aborts before commit. Guard every `WHERE` on the *source* workspace so a re-run is a no-op.

```bash
cat <<'SQL' | ssh -i ~/.ssh/id_jawab24_deploy root@91.99.95.196 \
  'docker exec -i jawab24-postgres sh -c "psql -U \"\$POSTGRES_USER\" -d \"\$POSTGRES_DB\" -v ON_ERROR_STOP=1 -x"'
\set PAGE    '''<PAGE_ID>'''
\set FROM_WS '''<SOURCE_WORKSPACE_ID>'''
\set TO_WS   '''<DEST_WORKSPACE_ID>'''
\set TO_USER '''<DEST_USER_ID>'''

\echo '=== ROLLBACK SNAPSHOT ==='
SELECT id, name, workspace_id, user_id, auto_reply_enabled FROM pages WHERE id = :PAGE;

BEGIN;

UPDATE pages
SET workspace_id = :TO_WS, user_id = :TO_USER,
    lead_stages = NULL, lead_fields = NULL,   -- per-page lead config must not cross workspaces
    updated_at = NOW()
WHERE id = :PAGE AND workspace_id = :FROM_WS;

UPDATE comments c SET workspace_id = :TO_WS
FROM posts p
WHERE p.id = c.post_id AND p.page_id = :PAGE AND c.workspace_id = :FROM_WS;

UPDATE instagram_comments ic SET workspace_id = :TO_WS
FROM instagram_media im
WHERE im.id = ic.media_id AND im.page_id = :PAGE AND ic.workspace_id = :FROM_WS;

UPDATE messages SET workspace_id = :TO_WS
WHERE page_id = :PAGE AND workspace_id = :FROM_WS;

\echo '=== VERIFY BEFORE COMMIT ==='
SELECT (SELECT count(*) FROM pages WHERE id=:PAGE AND workspace_id=:TO_WS AND user_id=:TO_USER) AS page_moved,
       (SELECT count(*) FROM comments c JOIN posts p ON p.id=c.post_id WHERE p.page_id=:PAGE AND c.workspace_id=:FROM_WS) AS comments_left,
       (SELECT count(*) FROM instagram_comments ic JOIN instagram_media im ON im.id=ic.media_id WHERE im.page_id=:PAGE AND ic.workspace_id=:FROM_WS) AS ig_left,
       (SELECT count(*) FROM messages WHERE page_id=:PAGE AND workspace_id=:FROM_WS) AS messages_left,
       (SELECT count(*) FROM pages WHERE workspace_id=:TO_WS AND auto_reply_enabled) AS dest_enabled;

COMMIT;
SQL
```

`page_moved` must be `1` and every `*_left` must be `0`. If not, you are inside a transaction that has not committed — `ROLLBACK` and diagnose.

**Never blank `access_token` to "force a clean reconnect".** `isPageDisconnected()` is exactly `accessToken === ''`, and the reclaim path lets *any* Facebook admin of that page claim a disconnected page on their next sync — including the person you just moved it away from. Leave the token in place: their sync then hits the "already connected in another workspace — skipping" branch instead. The destination's next sync self-heals the token anyway, because `isOriginalConnector` (`existingPage.userId === userId`) is now true, so it writes their own page token and re-subscribes webhooks.

Webhooks need no action — they resolve by `facebook_page_id` → page row → workspace, so traffic follows the move immediately.

## Step 6 — Verify and hand back

```bash
./scripts/prod-db-query.sh "
SELECT count(*) AS drifted_messages FROM messages m JOIN pages p ON p.id=m.page_id WHERE p.workspace_id<>m.workspace_id;
SELECT count(*) AS drifted_comments FROM comments c JOIN posts po ON po.id=c.post_id JOIN pages p ON p.id=po.page_id WHERE p.workspace_id<>c.workspace_id;"
```

Both must be `0`. A non-zero count that isn't your page is pre-existing drift from the old reclaim bug — repair it with:

```bash
docker exec jawab24-backend-green npx tsx src/scripts/backfill-page-workspace-drift.ts          # dry-run
docker exec jawab24-backend-green npx tsx src/scripts/backfill-page-workspace-drift.ts --apply
```

Then tell the destination merchant, in Arabic **فصحى**, 2nd person:
1. The page is now on their account and will reply immediately.
2. **Open Manage Pages and sync once** — this refreshes the page token to theirs and attaches any linked Instagram account the previous owner's record never captured.
3. Instagram auto-reply is a **separate toggle** (`instagram_auto_reply_enabled` defaults to `false`) — connecting the account does not switch it on.

And tell the **source** merchant something too, unless the founder says otherwise. A page vanishing from someone's dashboard with no explanation is how you turn a support win into a churn event — check whether it was their only enabled page (`SELECT count(*) FROM pages WHERE workspace_id='<FROM_WS>' AND auto_reply_enabled`) before deciding how to phrase it.

## Traps

| Trap | What happens |
|---|---|
| Moving only `pages.workspace_id` | Inbox strands in the old workspace. The reason this skill exists — 145 production messages were lost this way. |
| Blanking `access_token` | The previous owner reclaims the page on their next sync. Ping-pong. |
| Forgetting `lead_stages` / `lead_fields` | Previous owner's per-page lead config leaks into the new workspace. |
| Moving `ai_usage_log` / `logs` | Spend gets misattributed on `/admin/ai-cost`. |
| Destination on a free trial, page trial claimed elsewhere | Page connects but auto-reply is force-disabled (`trial_block`). Looks like a broken move; it is the anti-abuse ledger working. |
| Destination already at `max_pages` | Move succeeds, plan is over-provisioned, nobody notices until billing. |
| Page has Instagram | `instagram_comments` is a *third* denormalized table. Skipping it strands the IG inbox. |

---

Prereqs: `~/.ssh/id_jawab24_deploy`, run from the repo root. Companions: `/merchant-settings` (audit both accounts first), `/reply-quality` (confirm the page was healthy before the move).
