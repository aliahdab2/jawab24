# Category-Aware KB Setup + Smart Fallbacks

## Context

Users open the KB modal and see the same 2 generic sections (Products + Notes) regardless of business type. Meanwhile:
- Facebook provides `category` when pages connect → stored in `pages.businessProfile`
- `findCategoryDefaults()` exists with 6 business types and safe fallbacks → **never called in production**
- Frontend receives `page.businessProfile?.category` → **not used in KB modal**

This plan connects the dots: use the category data we already have to (1) show relevant KB sections and (2) give smarter fallback replies.

---

## Part 1: Category-Aware KB Sections (Frontend)

**What changes**: When KB is empty and user opens the modal for the first time, show sections relevant to their business type instead of the generic 2.

| Category (from Facebook) | Sections Shown |
|--------------------------|----------------|
| Restaurant/Cafe/Food | 🍽️ Menu & Prices, 🚚 Delivery, ⏰ Hours & Reservations, 📝 Notes |
| Clothing/Fashion | 💰 Products & Prices, 📏 Sizes & Colors, 🚚 Delivery & Returns, 📝 Notes |
| Salon/Beauty/Spa | 💇 Services & Prices, 📅 Booking, 📝 Notes |
| Training/Education/School | 📚 Courses & Fees, 🗓️ Schedule & Registration, 📝 Notes |
| Electronics/Computer/Phone | 💰 Products & Prices, 🛡️ Warranty, 🚚 Delivery, 📝 Notes |
| Flower/Florist | 💰 Products & Prices, 🚚 Delivery, 📝 Notes |
| Unknown/Other | 💰 Products & Services, 📝 Notes *(current default, no change)* |

**Rules**:
- Only applies when KB is **empty** (first-time setup)
- If KB has content → parse normally (never resets existing content)
- Sections are suggestions, not required — user can leave them empty
- User can still add custom sections (up to 5)

### Files to modify

**`frontend/src/components/knowledge-base/types.ts`**
- Expand `PresetSectionId` union with new IDs: `menu`, `delivery`, `hours`, `sizes`, `returns`, `booking`, `warranty`, `courses`, `schedule`
- Add `ALL_SECTION_CONFIGS` array (full superset of all sections with emoji/title/desc/placeholder keys)
- Keep `SECTION_CONFIGS` as-is (default for unknown category) for backward compat
- Extend `EMOJI_TO_SECTION` map with new emoji→section mappings
- Extend `SECTION_LABELS` map with AR/EN labels for new sections

**`frontend/src/components/knowledge-base/categorySections.ts`** *(new file)*
- `CATEGORY_SECTION_IDS`: maps category key → array of preset section IDs
- `resolveCategoryKey(category)`: substring matching (mirrors backend's `findCategoryDefaults()` pattern)
- `getSectionConfigsForCategory(category)`: returns `SectionConfig[]` for a given FB category

**`frontend/src/components/knowledge-base/knowledgeBaseParser.ts`**
- `parseKnowledgeBase()`: use `ALL_SECTION_CONFIGS` for emoji detection (recognizes all known emojis, not just products/notes)
- `serializeSections()`: look up config from `ALL_SECTION_CONFIGS` instead of `SECTION_CONFIGS`
- No changes to `calculateProgress()` — it already counts dynamically

**`frontend/src/components/knowledge-base/KnowledgeBaseModal.tsx`**
- In the empty-KB branch of the init `useEffect`, call `getSectionConfigsForCategory(page.businessProfile?.category)` to get relevant sections
- Pass result as initial empty sections instead of hardcoded products+notes

**`frontend/src/components/knowledge-base/KnowledgeBaseSections.tsx`**
- Look up section config from `ALL_SECTION_CONFIGS` instead of `SECTION_CONFIGS`

**`frontend/src/i18n/en.json` + `ar.json`**
- 9 new sections × 3 keys (title, desc, placeholder) = **27 new translation keys** per language

---

## Part 2: Wire Up Category Fallbacks in Reply Pipeline (Backend)

**What changes**: When AI flags a reply with `info_not_in_kb` or `price_not_in_kb`, use category-specific safe fallback from the existing `category-defaults.ts` instead of the generic "Thank you for your comment!" or the generic price fallback.

Example: Customer asks a clothing store "What sizes do you have?" and it's not in KB:
- **Before**: "شكراً لاهتمامك! خليني أتأكد من تفاصيل الأسعار وبرجعلك بأقرب وقت." *(generic price fallback)*
- **After**: "حكيلي المنتج والمقاس اللي بدك إياه (S/M/L أو قياسات)." *(category-specific)*

### Files to modify

**`backend/src/services/kb/category-defaults.ts`**
- Add `getCategoryFallback(category, flagReason, language)` function
- Logic: parse flags → match to category fallback topic → return AR/EN message or null

**`backend/src/services/reply/generator.ts`**
- Add `'info_not_in_kb'` to `SAFE_FALLBACK_FLAGS`
- Add generic `INFO_FALLBACK` messages (AR/EN) for when no category match exists

**`backend/src/services/reply/commentProcessor.ts`** (step 8b fallback)
- Import `getCategoryFallback`
- Try category fallback first → fall back to generic `PRICE_FALLBACK` / `INFO_FALLBACK`
- Category comes from `page.businessProfile?.category` (already available in context)

**`backend/src/services/reply/messageProcessor.ts`** (step 12b fallback)
- Same change as comment processor

---

## Part 3: AI Readiness Suggestions (Optional — skip if scope too big)

Show a small hint below the progress bar when important sections are empty:
> 💡 "أضف معلومات التوصيل — العملاء يسألون عنها كثيراً"

**`frontend/src/components/knowledge-base/categorySections.ts`**
- Add `getCategorySuggestions(category, sections)`: compare expected sections vs filled, return hint translation keys (max 2)

**`frontend/src/components/knowledge-base/KnowledgeBaseSections.tsx`**
- Show suggestion text below progress bar if suggestions exist

**`frontend/src/i18n/en.json` + `ar.json`**
- 10 suggestion keys per language

---

## What does NOT change

- Backend KB storage format (still plain text)
- `businessProfile.ts` / `formatBusinessProfile()` — already works
- `findCategoryDefaults()` — reused as-is
- Existing KB content for any user — parsing is backward compatible
- Raw text editor mode — still works, uses same serialize/parse
- Custom sections — still supported (up to 5)

---

## Verification

1. **Unit tests**:
   - `resolveCategoryKey()` — all FB category strings map correctly
   - `getSectionConfigsForCategory()` — each category returns expected sections, unknown returns default
   - `parseKnowledgeBase()` — new emojis parse correctly, old format still works
   - `serializeSections()` — roundtrip test with new section types
   - `getCategoryFallback()` — each category + flag combo returns correct message

2. **Lint**: `npm run lint` — zero errors and warnings

3. **Translation validation**: `npm run translation:validate`

4. **Manual testing**:
   - Open KB modal for a page with FB category "Restaurant" + empty KB → restaurant sections appear
   - Save content, reopen → content preserved correctly
   - Toggle raw mode → text has correct emoji markers
   - Test with unknown category → default 2 sections appear
   - In playground: trigger `info_not_in_kb` on a page with category → category-specific fallback appears

5. **Existing tests**: `npm run test` — all pass (no regressions)
