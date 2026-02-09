# Skip Reply for Offensive Comments + Translate Flag Reasons

> **Status:** In Progress
> **Created:** 2026-02-09
> **Last updated:** 2026-02-09

## Context

When a comment is flagged as offensive, the system currently sends the AI reply **immediately** to Facebook/Instagram, then notifies the user afterward. By the time the user sees "رد يحتاج انتباهك", the AI has already responded publicly to a troll. Additionally, flag reasons like "offensive" and "invalid_json" appear in English even when the UI is Arabic.

## Two Problems to Fix

1. **Offensive comments get auto-replied** — Skip replying entirely to `offensive_or_abusive` / `OFFENSIVE` content. Just flag and notify. The user can manually reply from the dashboard if needed.
2. **Flag reasons shown in English** — Translate flag reason strings to Arabic in notification bodies.

## What Changes and What Doesn't

| Flag | Before | After |
|------|--------|-------|
| `offensive_or_abusive` / `OFFENSIVE` | Auto-reply + notify | **Skip reply** + notify |
| `price_not_in_kb` | Auto-reply (with possibly wrong price) + notify | **Safe fallback reply** + notify owner to follow up |
| `angry_customer` / `COMPLAINT` | Auto-reply + notify | No change (keep auto-reply) |
| `low_confidence`, `redirect_to_human`, etc. | Auto-reply + notify | No change |
| All flag reasons in notifications | English text | **Translated to Arabic** when UI is Arabic |

### Why keep auto-reply for angry customers?
Angry customers need fast responses — silence makes them angrier. The AI reply acknowledges their concern while the owner gets notified to follow up personally.

### Why safe fallback for price questions (not skip)?
Jawab24 serves clinics, restaurants, real estate, institutes, etc. Price questions are hot leads. Silence = lost sale. The fallback reply ("Let me check pricing and get back to you") keeps the conversation alive and buys the owner time to respond with accurate info.

## Speed Impact: Zero

- One extra `if` check on a string already computed — the normal (non-offensive) path is completely unchanged.
- No extra DB queries, no extra API calls, no new awaits on the happy path.

## No New Endpoints, No Schema Migration

- No draft system, no approve/discard endpoints, no new frontend UI needed.
- The user reviews offensive comments via the existing "Needs Attention" filter and can manually reply using the existing reply feature.
- DB columns `needsAttention`, `flagReason`, `aiIntent` already exist in all 3 tables.

## Decision Log

| Date | Decision | Reasoning |
|------|----------|-----------|
| 2026-02-09 | Skip reply for offensive, not hold as draft | Simpler, no new endpoints, zero speed impact. Don't feed trolls. |
| 2026-02-09 | Keep auto-reply for angry customers | They need fast responses; silence makes them angrier. |
| 2026-02-09 | Safe fallback for `price_not_in_kb` instead of skip | Jawab24 serves diverse businesses — price questions are hot leads, silence = lost sale. |
| 2026-02-09 | No schema migration needed | `needsAttention`, `flagReason`, `aiIntent` columns already exist. |
| 2026-02-09 | Add duplicate webhook guard with `needsAttention` | Prevents re-processing flagged comments on webhook retries. |
| 2026-02-09 | Translate flag reasons to Arabic | English reasons in Arabic UI is a UX inconsistency. |

## Files Modified

| File | Change |
|------|--------|
| `backend/src/services/reply/generator.ts` | `shouldSkipReply()`, `shouldUseFallback()`, `PRICE_FALLBACK` |
| `backend/src/types/index.ts` | Extend `UpdateCommentDTO` with flag fields |
| `backend/src/interfaces/comment-adapter.ts` | `flagComment()` interface + `needsAttention` on `StoredComment` |
| `backend/src/services/reply/adapters/facebookCommentAdapter.ts` | Implement `flagComment()`, return `needsAttention` |
| `backend/src/services/reply/adapters/instagramCommentAdapter.ts` | Same |
| `backend/src/services/reply/commentProcessor.ts` | Duplicate guard + offensive skip + price fallback |
| `backend/src/services/reply/messageProcessor.ts` | Same for messages |
| `backend/src/services/notifications.ts` | `skipped_reply` template + `FLAG_REASON_AR` map |
| `frontend/src/i18n/ar.json` | Flag reason Arabic translations |
| `frontend/src/i18n/en.json` | Flag reason English labels |
| `frontend/src/components/comments/CommentCard.tsx` | Translated flag reasons display |

> See full implementation details in `.claude/plans/shiny-brewing-horizon.md`
