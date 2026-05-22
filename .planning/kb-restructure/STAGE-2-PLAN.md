# Stage 2 — Catalog Editor (Working Implementation Plan)

> **Strategy plan:** `~/.claude/plans/brief-for-the-expert-encapsulated-hearth.md` — the WHY and HIGH-LEVEL DESIGN live there. This file is the HOW.
>
> **State tracker:** `.planning/kb-restructure/STATE.md` — current task pointer, eval baselines, branch state.
>
> **Branch:** `kb-restructure/stage-2-catalog` (based on `kb-restructure/stage-1-valid-until`; will rebase onto main once Stage 1 PR #189 merges).

## Goal

Ship a merchant-facing catalog editor that lets non-platform merchants (training institutes, services, retail, restaurants) maintain structured catalog items, replacing the freshness-broken pattern of stuffing pricing/scheduling data into the free-text KB. Catalog items feed RAG-replacing tool calls so the AI can query live, freshness-filtered, source-authoritative data instead of stale chunks.

## Sub-stage breakdown (atomic, reviewable units)

### Stage 2.1 — Schema + migration (this commit)
- New table `catalog_items` (generic, type-driven, JSONB metadata)
- Optional FK table `catalog_item_schedules` for time-bound variants (later — only build when a course needs multiple cohorts)
- Migration via `drizzle-kit generate:pg`
- Integration tests: CRUD + freshness filter
- **No backend API, no frontend, no AI tools yet.** Pure data layer.

### Stage 2.2 — Backend API endpoints
- `GET /catalog-items?pageId=...&type=...&status=...`
- `POST /catalog-items` (create)
- `PATCH /catalog-items/:id` (update)
- `DELETE /catalog-items/:id` (soft-delete via `archivedAt`)
- Zod validation: prices ≥ 0, date ordering (`enrollmentClosesAt ≤ startsAt`, `endsAt ≥ startsAt`)
- Auto-set `source_tier = 2` on insert
- Bump `pages.kbVersion` on every write (triggers semantic cache invalidation)

### Stage 2.3 — AI tools
- Add `search_entities`, `get_entity_details`, `list_active_entities` to the ai-worker tool whitelist (extends `packages/shared/src/ecommerce-tools.ts`)
- Tool implementations live backend-side, called via the existing `ecommerceToolLoop` pattern
- `list_active_entities` bakes in `endsAt > now()` filter automatically
- Update ai-worker prompt assembly to surface tool descriptions when merchant has catalog items

### Stage 2.4 — Frontend route + list view
- New route `frontend/src/pages/pages/[pageId]/catalog.tsx`
- Components: `CatalogList`, `CatalogItemCard`, `CatalogStatusBadge`, `PlatformProductsTab` (read-only for Salla/Shopify)
- Entry point: "Catalog" button on each page card in `/pages.tsx`
- Empty state shows the vertical template picker (Stage 2.6)

### Stage 2.5 — Add/edit SidePanel form
- `CatalogItemForm` opens in `SidePanel` (already exists)
- Fields surface by type (course shows dates; service hides them; product shows stock)
- Native `<input type="date">` for dates — no custom picker
- Currency `Select` + numeric `Input` for price
- Client-side validation mirrored from backend Zod schema

### Stage 2.6 — Vertical templates + smart pre-selection
- Backend: add `category_list` to FB Graph API request in `backend/src/services/facebook.ts:21`
- One-off re-sync script to populate `category_list[].id` on existing pages
- New backend function: `mapFacebookCategoryToTemplate(categoryList: {id: string, name: string}[]): TemplateId | null`
- Frontend: smart pre-selection on first catalog visit; fallback question if unmapped
- 6 starter templates: Training Institute, Salon/Clinic, Online Store, Restaurant, Event Organizer, Service Bundles

### Stage 2.7 — Eval re-baseline
- Add catalog-specific test cases to `scripts/playground-eval.ts`
- Confirm no regression on the existing 304 tests
- Expect improvement on new catalog tests (queries that depend on freshness or current price)

### Stage 2.5 (sub-stage, ships after main Stage 2) — Calendar view
- View toggle in catalog page: `[List] [Calendar]`
- Month/week grid with date-bound items as chips
- Red "today" line + bulk-archive expired CTA

## Schema design (Stage 2.1)

```typescript
// catalog_items: generic catalog with type-driven fields in metadata
export const catalogItems = pgTable('catalog_items', {
    id: uuid('id').defaultRandom().primaryKey(),
    pageId: uuid('page_id').references(() => pages.id, { onDelete: 'cascade' }).notNull(),
    type: varchar('type', { length: 20 }).notNull(), // 'course' | 'product' | 'service' | 'event' | 'branch' | 'package'
    name: varchar('name', { length: 200 }).notNull(),
    description: text('description'),
    priceMinor: integer('price_minor'), // price * 100, currency-agnostic
    currency: varchar('currency', { length: 8 }), // 'SAR', 'USD', 'AED', ...
    startsAt: timestamp('starts_at'), // course/event start date
    endsAt: timestamp('ends_at'),     // course/event end date — drives "expiring soon" / "expired" status
    enrollmentClosesAt: timestamp('enrollment_closes_at'), // courses only
    metadata: jsonb('metadata').default({}), // vertical-specific extensions (bedrooms, duration, stock, category, etc.)
    archivedAt: timestamp('archived_at'), // soft-delete; archived items hidden from default list but kept for history
    sourceTier: integer('source_tier').notNull().default(2), // tier 2 = manually entered structured catalog
    createdAt: timestamp('created_at').defaultNow(),
    updatedAt: timestamp('updated_at').defaultNow(),
}, (table) => ({
    pageIdIdx: index('idx_catalog_items_page_id').on(table.pageId),
    typeIdx: index('idx_catalog_items_type').on(table.pageId, table.type),
    activeIdx: index('idx_catalog_items_active').on(table.pageId, table.archivedAt, table.endsAt),
}));
```

**Design notes:**
- `priceMinor` (integer cents) instead of `numeric` — avoids floating-point precision issues, matches existing `plans.price` pattern.
- `metadata` JSONB is the escape hatch for vertical-specific fields (bedrooms for real estate, duration for services, stock for products). Promote to columns only when 2+ merchants need to query by that field.
- `archivedAt` as soft-delete preserves history for admin; `list_active_entities()` filters `archivedAt IS NULL AND (endsAt IS NULL OR endsAt > NOW())`.
- `sourceTier` defaults to 2 (manually entered structured catalog), aligning with Stage 1.2's tier system.
- No `catalog_item_schedules` FK table yet. Recurring/multi-cohort schedules are deferred until 3+ merchants need them.

## Tool surface (Stage 2.3 preview)

```typescript
// packages/shared/src/ecommerce-tools.ts — extending VALID_TOOL_NAMES
export const CATALOG_TOOLS = ['search_entities', 'get_entity_details', 'list_active_entities'] as const;

// search_entities(query: string, type?: string, filters?: object)
// → fuzzy match name + description, returns top-5 catalog items
// → filters: { priceMin, priceMax, currency }

// get_entity_details(id: string)
// → full record + computed status (active/expiring/expired)

// list_active_entities(type?: string, filters?: object)
// → all items where archivedAt IS NULL AND (endsAt IS NULL OR endsAt > NOW())
// → for "what courses are open?" questions
```

## Verification checklist

- [ ] Migration applies cleanly on a fresh DB
- [ ] `catalog_items` table created with all columns + indexes
- [ ] Integration test: create a course → query via SQL → confirm shape
- [ ] Integration test: insert items with past/future/null `endsAt` → "active" filter returns only future/null
- [ ] Integration test: insert archived item → "active" filter excludes it
- [ ] Lint + tsc clean on all changed files
- [ ] Eval suite unchanged (Stage 2.1 doesn't touch retrieval or replies)

## Open questions for later sub-stages

- Should `priceMinor` allow null (for "contact us for price" services)? Probably yes; clarify in 2.2.
- How does the AI describe items it returns from `list_active_entities` — full description text or just name+price? Tune in 2.3.
- How do Salla/Shopify-connected merchants see THIS catalog vs the platform catalog? Two tabs in the UI (Stage 2.4) — both feed the same tools, with `source_tier` distinguishing platform (1) vs manual (2) for retrieval ranking.
- Currency selector default — page-level or workspace-level? Decide in 2.2 when wiring the API.

## Stage 2.1 commit plan

Files to change:
- `backend/src/db/schema.ts` — add `catalogItems` table definition (after `kbChunks`)
- `backend/migrations/0108_*.sql` — generated migration
- `backend/migrations/meta/0108_snapshot.json` — generated snapshot
- `backend/migrations/meta/_journal.json` — updated journal
- `backend/test/integration/catalog.test.ts` — new integration test file

Commit message:
```
feat(kb): catalog_items schema for structured catalog (Stage 2.1)

Add catalog_items table to support merchant-maintained structured items
(courses, services, products, events, branches, packages). Each row has
type-driven shape via JSONB metadata; freshness via startsAt/endsAt;
source_tier defaults to 2 (manually entered structured catalog).

No backend API, frontend, or AI tools yet — pure data layer. Subsequent
sub-stages add the API (2.2), AI tools (2.3), and UI (2.4-2.6).

Eval unchanged (no retrieval path touched).
```
