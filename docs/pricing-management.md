# Pricing Management Guide

## How Pricing Works

Jawab24 uses a **database-driven pricing system**. The `plans` table in PostgreSQL is the single source of truth for all pricing data, limits, and features.

### Data Flow

```
PostgreSQL (plans table)
    │
    ├── Backend API: GET /api/plans (public)
    │       │
    │       ├── Pricing page (ISR — auto-refreshes hourly)
    │       └── Checkout page (always live)
    │
    └── Backend enforcement (subscriptions service)
            │
            ├── canUseAiReplies()  → checks maxAiRepliesPerMonth
            ├── canAddPage()       → checks maxPages
            ├── canAddTemplate()   → checks maxTemplates
            └── canAddRule()       → checks maxRules
```

### Architecture

- **Pricing page** uses Next.js ISR (`getStaticProps` with `revalidate: 3600`). Plans are pre-rendered server-side and auto-refresh every hour.
- **On-demand revalidation** pushes a plan change to the page immediately instead of waiting out that hour. Every writer of the `plans` table (admin create/update/delete, `seed-plans.ts`, `create-monthly-prices.ts`, `create-yearly-prices.ts`) calls `revalidatePlanPages()`, which POSTs to the frontend's `/api/revalidate`. It requires `FRONTEND_REVALIDATE_URL` + `REVALIDATE_SECRET` in `env/backend.env` and the **same** `REVALIDATE_SECRET` in `env/frontend.env`. **If either is unset the call is skipped** (logged as a `revalidation-not-configured` Sentry warning) and the page falls back to the hourly window — which is exactly what happened when the Basic plan's yearly price went live and the Arabic pricing page kept serving the old value for another hour.
- **The default-locale page has no prefix.** `/pricing` *is* the Arabic page and shares one ISR entry with `/ar/pricing`; `/en/pricing` is a separate entry. `PLAN_DEPENDENT_PATHS` revalidates `/pricing` and `/en/pricing`, which covers both. When verifying a change by hand, check `/pricing`, not only `/en/pricing` — and note the response carries `cache-control: max-age=3600`, so your own browser may hold the old page until a hard reload.
- **Fallback file** (`frontend/src/data/fallbackPlans.ts`) is only used if the API is unreachable during build. It does not need manual updates — ISR handles freshness.
- **Limit enforcement** happens in `backend/src/services/subscriptions.ts` at runtime, always reading from the database.
- **Stripe** handles payment processing. Each plan has a `stripePriceId` linking to a Stripe Price object.

## How to Update Prices

### 1. Update the database via Admin API

```bash
# Get your auth token (login first)
TOKEN="your-jwt-token"

# Update a plan (prices in cents: 900 = $9.00)
curl -X PUT https://jawab24.com/api/plans/admin/<PLAN_ID> \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"price": 900, "maxAiRepliesPerMonth": 300}'
```

### 2. Get plan IDs

```bash
curl -s https://jawab24.com/api/plans | python3 -m json.tool
```

### 3. That's it

- The pricing page auto-refreshes within 1 hour (ISR revalidation)
- Backend enforcement uses the new limits immediately
- No code changes or deploys needed

## Plan Fields Reference

| Field | Type | Description |
|-------|------|-------------|
| `price` | integer | Price in cents (900 = $9.00) |
| `currency` | string | Always `USD` |
| `interval` | string | `month` or `year` |
| `maxPages` | integer | Max connected FB/IG pages |
| `maxAiRepliesPerMonth` | integer\|null | AI reply limit (null = unlimited) |
| `maxTemplates` | integer\|null | Template limit (null = unlimited) |
| `maxRules` | integer\|null | Rule limit (null = unlimited) |
| `trialDays` | integer | Free trial duration (0 = no trial) |
| `stripePriceId` | string | Stripe Price ID for billing |
| `isActive` | boolean | Show on pricing page |
| `isDefault` | boolean | Assigned to new users |
| `sortOrder` | integer | Display order (0 = first) |

## Important: Stripe Sync

When changing **prices**, you also need to update the corresponding Stripe Price object. Options:

1. Create a new Price in Stripe Dashboard and update `stripePriceId` in the database
2. Or archive the old Price and create a new one (Stripe prices are immutable)

Existing subscribers keep their current Stripe price until their subscription renews or they change plans.

## Admin API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/plans` | List active plans (public) |
| `GET` | `/api/plans/admin/all` | List all plans including inactive |
| `POST` | `/api/plans/admin` | Create a new plan |
| `PUT` | `/api/plans/admin/:id` | Update a plan |
| `DELETE` | `/api/plans/admin/:id` | Soft-delete a plan |
| `POST` | `/api/plans/admin/:id/set-default` | Set as default plan |

All admin endpoints require authentication + admin role.

## Key Files

| File | Purpose |
|------|---------|
| `frontend/src/pages/pricing.tsx` | Pricing page with ISR |
| `frontend/src/data/fallbackPlans.ts` | Build-time fallback (safety net) |
| `backend/src/services/plans.ts` | Plans CRUD service |
| `backend/src/services/subscriptions.ts` | Limit enforcement |
| `backend/src/routes/plans.ts` | API routes (public + admin) |
| `backend/src/db/schema.ts` | Database schema (plans table) |
