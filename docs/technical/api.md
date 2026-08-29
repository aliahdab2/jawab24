# API Specification — Jawab24

The authoritative API surface lives in code. This file is an index, not a spec — route handlers and their Fastify schemas are the single source of truth.

- **Interactive docs (dev):** `http://localhost:3000/docs` — OpenAPI 3.0 / Swagger UI, generated from Fastify schemas ([`backend/src/plugins/swagger.ts`](../../backend/src/plugins/swagger.ts))
- **Route files:** [`backend/src/routes/`](../../backend/src/routes/) — one file per resource group
- **Base URLs:** Production `https://jawab24.com/api` · Development `http://localhost:3000`

## Authentication

All endpoints require `Authorization: Bearer <jwt>` except: `/auth/*`, `/webhook`, `/health`, `/version`, `/waitlist` (public submit), `/plans` (public list), and public Stripe/Shopify/Salla/Meta webhook callbacks. JWTs are issued by `/auth/facebook` or `/auth/demo`.

## Route groups

Prefixes match [`backend/src/index.ts`](../../backend/src/index.ts) `server.register(...)` calls.

| File | Prefix | Scope |
|------|--------|-------|
| `health.ts` | — | Liveness checks |
| `version.ts` | — | Deploy metadata |
| `auth.ts` | — | Facebook OAuth, phone OTP, refresh tokens, demo login |
| `webhook.ts` | — | Meta webhook receiver (messages, comments, mentions) |
| `ai.ts` | — | Playground, reply generation, intent classification |
| `pages.ts` | — | Facebook/Instagram pages, connect/disconnect, auto-reply toggle |
| `posts.ts` | — | Post list, per-post preset replies, keyword triggers |
| `comments.ts` | — | Comment inbox, resolve, flag, manual reply |
| `settings.ts` | — | Workspace AI settings, brand voice, away/greeting messages |
| `messages.ts` | — | DM inbox, resolve, pause, manual reply |
| `leads.ts` | — | Lead capture from conversations |
| `instagram.ts` | — | Instagram-specific media + comments |
| `workspace.ts` | — | Workspace CRUD, members, invites |
| `plans.ts` | `/plans` | Subscription tier list (public) |
| `subscriptions.ts` | `/subscription` | User subscription state, entitlements |
| `payment.ts` | `/payment` | Stripe checkout, billing portal |
| `geo.ts` | `/geo` | Sanctioned-country check for Stripe gating (see [AI_INSTRUCTIONS.md §4](../../AI_INSTRUCTIONS.md)) |
| `notifications.ts` | `/notifications` | Push + in-app notifications |
| `admin.ts` | `/admin` | Admin panel (workspace/user management) |
| `voice.ts` | `/voice` | Voice message transcription |
| `kb-upload.ts` | `/kb` | Knowledge-base upload (PDF, Excel, images w/ Vision fallback) |
| `analytics.ts` | `/analytics` | Dashboard stats, Smart Replies counter, usage metrics |
| `translation.ts` | `/api/translation` | Auto-translation of away/greeting messages |
| `integrations.ts` | `/api/integrations` | Cross-integration status aggregation |
| `waitlist.ts` | `/waitlist` | Public waitlist signup, admin management |
| `customerNotifications.ts` | `/api` | Customer-facing notifications |
| `sse.ts` | `/sse` | Server-sent events for live inbox updates |
| `ecommerceRoutes.ts`, `shopify.ts`, `salla.ts`, `zid.ts` | via `integrations.ts` | E-commerce OAuth, product sync, store management |

## Response shape

```jsonc
// success
{ "data": ... }

// error
{ "error": { "message": "...", "code": "..." } }
```

## Inbox row fields

Comments and messages carry: `needsAttention`, `flagReason`, `aiIntent`, `aiConfidence`, `resolved`, `replyMethod` (`ai` | `template` | `manual` | `post_reply`, plus `app_auto` on outgoing WhatsApp rows only — the merchant's WhatsApp Business app greeting/away echoed on a Coexistence number, D-109), `workspaceId`. Manual replies are excluded from the Smart Replies stat — see commit `72d57736`; `app_auto` is excluded from every reply stat.

## Discovering endpoints

Run `npm run dev` from `backend/` and open `http://localhost:3000/docs` for the live, schema-accurate list. Tags align with the groups registered in [`plugins/swagger.ts`](../../backend/src/plugins/swagger.ts).
