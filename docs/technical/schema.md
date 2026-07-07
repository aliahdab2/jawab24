# Database Schema — Jawab24

The authoritative schema lives in code, not in this doc. Drizzle ORM definitions are the single source of truth:

- **Schema:** [`backend/src/db/schema.ts`](../../backend/src/db/schema.ts) — all tables, columns, enums, indexes, and relations
- **Migrations:** [`backend/src/db/migrations/`](../../backend/src/db/migrations/) — generated SQL (see `meta/_journal.json` for order)
- **Generate new migration:** `cd backend && npm run db:generate` (never hand-write migration SQL — see [AI_INSTRUCTIONS.md §Drizzle Migrations](../../AI_INSTRUCTIONS.md))

## High-level groupings

| Domain | Key tables |
|--------|-----------|
| Identity & workspaces | `users`, `workspaces`, `workspace_members`, `workspace_invites`, `otp_codes`, `refresh_tokens` |
| Facebook / Instagram | `pages`, `posts`, `comments`, `messages`, `instagram_media`, `instagram_comments`, `conversation_pauses` |
| AI & knowledge base | `knowledge_base_entries`, `kb_chunks`, `reply_templates`, `reply_rules`, `ai_usage_log`, `ai_reply_cache` |
| Billing | `plans`, `subscriptions`, `payment_events` |
| E-commerce | `ecommerce_stores`, `ecommerce_products`, `pending_ecommerce_installs`, `catalog_items` |
| Leads & notifications | `leads`, `customer_notification_templates`, `customer_notifications_log`, `waitlist_subscribers` |

## Conventions

- All inbox tables (`messages`, `comments`, `posts`, `conversation_pauses`, etc.) carry a denormalized `workspace_id` for fast tenant-scoped queries — see commits `0e867e8e`, `8f5c93bb`.
- UUID primary keys (`gen_random_uuid()`), `created_at` / `updated_at` on every row.
- Soft-state columns on inbox rows: `needs_attention`, `flag_reason`, `ai_intent`, `resolved`, `reply_method`.
- Bilingual text fields use `*_ar` / `*_en` pairs (see [§13 Multi-Language Translation Service](../../AI_INSTRUCTIONS.md)).

## Inspecting the live schema

```bash
cd backend
npx drizzle-kit studio     # browse locally
# or
psql "$DATABASE_URL" -c "\dt"
```
