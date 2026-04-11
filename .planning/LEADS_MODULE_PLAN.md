# Leads Module — Implementation Plan (v3)

> v2: Review feedback (intent gate removal, delete, CSV server-side, etc.)
> v3: Added critical considerations (privacy, rate limiting, retry, feature toggle, pricing, onboarding)
> Changes from v1 marked with **[CHANGED]** or **[NEW]**.

## Context

Jawab24 clients (institutes, clinics, service providers) use the AI to collect phone numbers from interested customers. Currently those phone numbers are lost inside `messages.text`. This module captures them as structured leads: detects the phone, calls AI to extract dynamic context-specific fields, and presents them in a dedicated Leads page per Facebook/Instagram page.

## Architecture

```
Incoming message (with phone)
    ↓
messageProcessor.ts — after reply_sent (fire-and-forget)
    ↓
leadExtractor.ts — phone regex first → then AI extraction → upsert leads table
    ↓
GET /leads?pageId= → leads.tsx frontend page (dynamic columns + CSV export)
```

**[CHANGED]** Phone detection runs on ALL messages (no intent gate). AI extraction only runs when a phone is found.

---

## Critical Considerations

### A. Privacy & Data Protection (LEGAL — must ship with Phase 1)

Collecting phone numbers and personal data automatically triggers compliance obligations under GDPR, Saudi PDPL, and UAE data protection laws.

**Required actions:**

1. **Privacy Policy update** — Add a "Lead Collection" section to the existing privacy policy explaining:
   - What data is collected (phone, name, conversation-derived fields)
   - How it's collected (automated extraction from messaging conversations)
   - Purpose (business follow-up by the page owner)
   - Retention period (see archiving below)
   - Right to deletion

2. **Data deletion endpoint** — `DELETE /leads/by-sender?senderId=&pageId=`
   - Allows compliance with "right to be forgotten" requests
   - Update `data-deletion.tsx` to include leads in the data deletion flow
   - When a sender requests deletion via Facebook/Instagram's data deletion callback, leads must be purged too

3. **Workspace-level consent notice** — First time the workspace owner opens `/leads`, show a one-time notice:
   - "Leads are extracted automatically from conversations. You are responsible for handling this data in compliance with local privacy laws."
   - Must acknowledge before using the feature

4. **Auto-purge** — Leads older than 12 months are automatically deleted (configurable per workspace). Add `retentionMonths` column to workspace settings.

**Implementation:** Add `DELETE /leads/by-sender` to Step 5 routes. Add consent acknowledgment flag to workspace settings. Update `data-deletion.tsx` in Step 9.

---

### B. Rate Limiting & Cost Control

Every phone-containing message triggers an OpenAI call. High-traffic pages could generate unexpected costs.

**Required actions:**

1. **Daily extraction limit per workspace** — Default: 50 extractions/day (configurable by plan tier)
   - Track in Redis: `leads:extraction:{workspaceId}:{YYYY-MM-DD}` with TTL 86400
   - When limit reached: still save the lead with phone number, but skip AI extraction (leave `extractedData` as `{ fields: [] }`)
   - Log warning: `[leadExtractor] Daily limit reached for workspace ${id}`

2. **Global rate limit** — Max 10 concurrent OpenAI extraction calls across all workspaces
   - Use a semaphore pattern (existing pattern in ai-worker if available, otherwise simple counter)

3. **Cost tracking** — Log token usage per extraction to workspace usage stats (same pattern as existing AI reply usage tracking)

**Implementation:** Add rate limiting logic inside `maybeCaptureLead` in Step 3 before the OpenAI call.

---

### C. Retry Strategy for Failed Extractions

Fire-and-forget means failed OpenAI calls lose the AI-extracted context forever. The phone number is still saved, but the valuable dynamic fields are lost.

**Required actions:**

1. **Pending extractions table** — When phone is detected but AI extraction fails (timeout, rate limit, API error):
   - Save lead with phone + `extractionStatus: 'pending'`
   - Add `extractionStatus` column: `'completed' | 'pending' | 'failed'`
   - A periodic job (every 15 minutes) retries pending extractions (max 3 attempts)

2. **Manual re-extract button** — In the leads UI, if `extractionStatus` is `'pending'` or `'failed'`, show a "Re-extract" button that triggers extraction on demand

**Implementation:** Add `extractionStatus` and `extractionAttempts` columns in Step 2. Add retry logic in Step 3. Add re-extract button in Step 9.

---

### D. Feature Toggle (Per-Page On/Off)

Not all pages want lead extraction. Some pages handle support only — extracting phones from support conversations creates noise.

**Required actions:**

1. **Per-page setting** — Add `leadsEnabled` boolean column to `pages` table (default: `true` for new pages, `false` for existing pages on migration)
   - Existing pages default to `false` so current users aren't surprised by a new feature collecting data
   - New pages default to `true`

2. **Settings UI** — Add toggle in page settings (existing settings page, not a new page):
   - "جمع العملاء المحتملين تلقائياً" / "Collect leads automatically"
   - Short description explaining what it does

3. **Gate check** — `maybeCaptureLead` checks `page.leadsEnabled` before doing anything

**Implementation:** Add column in Step 2 migration. Add gate check as first line of `maybeCaptureLead` in Step 3. Add toggle to existing page settings UI.

---

### E. Plan Tier & Feature Gating

**Decision: Paid plans only (starter and above).** Free/beginner plan does not have access to leads.

**Implementation:**

1. **Backend gate** — `maybeCaptureLead` checks workspace plan tier first. If free/beginner plan → skip entirely (no phone detection, no AI call, no DB write)
2. **Frontend gate** — Sidebar hides "Leads" nav item for free plan. If user navigates to `/leads` directly → show upgrade page with explanation of the feature and upgrade CTA
3. **Upgrade page strings** — Add to `leads.json`: `upgradeTitle`, `upgradeDescription`, `upgradeCta`

This keeps the feature as a clear incentive for paid plans without complicating the codebase with partial access logic.

---

### F. Onboarding & Empty States

Users need to understand what the Leads page is and how it works without documentation.

**Required actions:**

1. **Empty state (no leads yet)** — Show illustration + explanation:
   - AR: "العملاء المحتملون يظهرون هنا تلقائياً عندما يشارك أحدهم رقم هاتفه في المحادثة"
   - EN: "Potential leads appear here automatically when someone shares their phone number in a conversation"
   - Include a "Learn more" link to a help article (can be added later)

2. **Empty state (leads disabled)** — If `leadsEnabled` is false for all pages:
   - Show message explaining how to enable it from page settings
   - Direct link to settings

3. **First lead celebration** — When the first lead appears, show a subtle confetti/highlight to reinforce the value

4. **Sidebar tooltip** — On first appearance of the Leads nav item, show a tooltip: "New! AI automatically collects leads from your conversations"

**Implementation:** Add to Step 6 (i18n strings) and Step 9 (UI components).

---

## Phase 1 — Core (this implementation)

### Step 1: Shared — Phone-in-text utilities

**File:** `packages/shared/src/utils/validation.ts`

Add below existing exports:

```ts
// Normalize Arabic-Indic digits (٠١٢...) to ASCII before matching
export function normalizeArabicIndic(text: string): string {
  return text.replace(/[٠١٢٣٤٥٦٧٨٩]/g, d =>
    String('٠١٢٣٤٥٦٧٨٩'.indexOf(d))
  );
}

// Extract first phone-like string from free text. Returns null if none.
export function extractPhoneFromText(text: string): string | null {
  const normalized = normalizeArabicIndic(text);
  const match = normalized.match(/(?:\+|00)?\d[\d\s\-().]{7,18}\d/);
  if (!match) return null;
  return match[0].replace(/[\s\-().]/g, '');
}
```

Export from `packages/shared/src/index.ts`.

Also add the `LeadExtractedData` shared type:

```ts
export interface LeadExtractedData {
  summary?: string;
  fields: Array<{
    key: string;
    label_en: string;
    label_ar: string;
    value: string;
  }>;
}
```

**[NEW]** Add `LeadStatus` type:

```ts
export type LeadStatus = 'new' | 'contacted' | 'converted';
```

Rebuild shared: `cd packages/shared && npm run build`

---

### Step 2: DB Schema

**File:** `backend/src/db/schema.ts`

Add after the `kbGaps` table:

```ts
export const leads = pgTable('leads', {
  id: uuid('id').defaultRandom().primaryKey(),
  pageId: uuid('page_id').references(() => pages.id, { onDelete: 'cascade' }).notNull(),
  sourceType: varchar('source_type', { length: 20 }).notNull().default('message'), // 'message' | 'comment'
  sourceId: uuid('source_id'),   // FK to messages.id or comments.id — no hard FK (different tables)
  senderId: varchar('sender_id', { length: 255 }).notNull(),
  senderName: varchar('sender_name', { length: 255 }),
  phone: varchar('phone', { length: 50 }).notNull(),
  extractedData: jsonb('extracted_data').$type<LeadExtractedData>().default({ fields: [] }),  // [CHANGED] default includes fields array
  status: varchar('status', { length: 20 }).notNull().default('new'),
  extractionStatus: varchar('extraction_status', { length: 20 }).notNull().default('completed'),  // [NEW] 'completed' | 'pending' | 'failed'
  extractionAttempts: integer('extraction_attempts').notNull().default(0),                         // [NEW] retry counter
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => ({
  pageIdIdx: index('idx_leads_page_id').on(table.pageId),
  senderPageUnique: uniqueIndex('idx_leads_sender_page').on(table.senderId, table.pageId),
  statusIdx: index('idx_leads_status').on(table.pageId, table.status),
  createdAtIdx: index('idx_leads_created_at').on(table.pageId, table.createdAt),
}));
```

**[NEW]** Add CHECK constraints and page column in migration:

```sql
ALTER TABLE leads ADD CONSTRAINT chk_leads_status
  CHECK (status IN ('new', 'contacted', 'converted'));

ALTER TABLE leads ADD CONSTRAINT chk_leads_extraction_status
  CHECK (extraction_status IN ('completed', 'pending', 'failed'));

-- Per-page feature toggle (Section D)
ALTER TABLE pages ADD COLUMN leads_enabled BOOLEAN NOT NULL DEFAULT false;
-- New pages created after this migration should default to true (handle in app code)
```

Run: `cd backend && npm run db:generate`

---

### Step 3: Lead Extractor Service

**New file:** `backend/src/services/leadExtractor.ts`

Key responsibilities:

- `maybeCaptureLead(params)` — **[CHANGED]** runs phone detection on ALL messages (no intent gate). If phone found → call AI extraction
- Fetch conversation history via `messagesService.getConversationHistory()` (exists at `messages.ts:371`)
- **[NEW]** Limit conversation context to last 20 messages to control cost
- Call OpenAI (`gpt-4.1-mini`, `response_format: json_object`) with extraction prompt:

```
You are a lead-capture assistant. Analyze the conversation and extract contact info.
Return ONLY valid JSON:
{
  "phone": "<compact digits, with optional leading +>",
  "summary": "<1-sentence intent summary in the conversation language>",
  "fields": [{ "key": "snake_case", "label_en": "English", "label_ar": "عربي", "value": "..." }]
}
Rules:
- Include ONLY fields confidently present in the conversation
- School → course_of_interest, preferred_start_date
- Clinic → specialty, appointment_date
- General → budget, timeline, location
- Never invent data not explicitly stated in the conversation
- If the phone number in the message doesn't belong to the sender (e.g. they're sharing someone else's number), set "phone" to null

Conversation (last 20 messages):
<CONVERSATION>
```

- Upsert via `ON CONFLICT (senderId, pageId) DO UPDATE` — merges `extractedData.fields` (new fields added, existing updated)
- After successful upsert, fire SSE event:

```ts
import { publishSSEEvent } from '../lib/eventBus';

// After upsertLead() completes:
publishSSEEvent(userId, 'lead:captured', {
  leadId: upserted.id,
  pageId,
  senderName,
  phone: extracted.phone || rawPhone,
  isNew,   // true = new lead, false = existing lead updated
});
```

- `maybeCaptureLead` is fire-and-forget, errors go to `captureError()` only

```ts
// No intent gate — phone presence is the trigger
export const LEAD_STATUSES = ['new', 'contacted', 'converted'] as const;
```

---

### Step 4a: Hook into messageProcessor (DMs)

**File:** `backend/src/services/reply/messageProcessor.ts`

Add import at top:

```ts
import { leadExtractorService } from '../leadExtractor';
```

After line ~505 (`publishSSEEvent(userId, 'usage:updated', ...)` block — end of success path):

```ts
// Fire-and-forget lead extraction (non-critical — never blocks reply pipeline)
leadExtractorService.maybeCaptureLead({
  pageId: page.id,
  sourceId: storedMessage.id,
  sourceType: 'message',
  senderId,
  senderName,
  messageText: consolidatedText,
}).catch(() => { /* captured inside maybeCaptureLead */ });
```

**[CHANGED]** No `aiIntent` parameter — phone detection is the only gate.

---

### Step 4b: Hook into commentProcessor (Comments)

**File:** `backend/src/services/reply/commentProcessor.ts`

Add import at top:

```ts
import { leadExtractorService } from '../leadExtractor';
```

After line ~472 (`publishSSEEvent(userId, 'usage:updated', ...)` block — end of success path, before `pipelineMetrics.record`):

```ts
// Fire-and-forget lead extraction — same as DM pipeline
leadExtractorService.maybeCaptureLead({
  pageId,
  sourceId: comment.id,
  sourceType: 'comment',
  senderId: comment.fromId ?? senderId,
  senderName: comment.fromName ?? senderName,
  messageText: commentMessage,
}).catch(() => { /* captured inside maybeCaptureLead */ });
```

**Note:** `sourceType: 'comment' | 'message'` allows the leads table and UI to show where the lead came from. Add `sourceType varchar(20)` and `sourceId uuid` to the schema in Step 2 (replaces `messageId`).

---

### Step 5: Backend Controller + Routes

**New file:** `backend/src/controllers/leads.ts`

- `getLeads(req, reply)` — `GET /leads?pageId=&status=&limit=&offset=` — verify page belongs to workspace, return paginated leads
- `updateStatus(req, reply)` — `PATCH /leads/:id/status` — validate status with Zod, verify page ownership
- **[NEW]** `deleteLead(req, reply)` — `DELETE /leads/:id?pageId=` — verify ownership, hard delete
- **[NEW]** `exportLeadsCsv(req, reply)` — `GET /leads/export?pageId=&status=` — server-side CSV generation, streams response with `Content-Type: text/csv`. Unions all `fields[].key` across results to build consistent column headers

**New file:** `backend/src/routes/leads.ts`

- Wrap all in `authenticate` + `resolveWorkspace` hooks

**File:** `backend/src/index.ts`

- Import and register `leadsRoutes`

---

### Step 6: i18n — All 4 Steps

**New:** `frontend/src/i18n/en/leads.json` + `ar/leads.json`

Key strings:

```
title, description, empty, emptySub, phone, name, status, intent, createdAt,
statusNew, statusContacted, statusConverted,
markContacted, markConverted, markNew,
statusUpdated, statusUpdateFailed,
exportCsv, loadFailed, deleteLead, deleteConfirm, deleteSuccess,    // [NEW]
sourceMessage, sourceComment,    // [NEW] "من رسالة" / "من تعليق"
filterAll, filterNew, filterContacted, filterConverted,
leadCount (ICU plural — all 6 Arabic forms), selectPage,
newLeadsBadge (ICU plural)    // [NEW] for sidebar badge
```

**Modify:** `frontend/src/i18n/getMessages.ts` — add EN + AR import + 2 NS entries

**Modify:** `frontend/src/i18n/namespaces.ts` — add `leads: [...DASHBOARD_LAYOUT, 'leads']`

---

### Step 7: Frontend API Layer

**File:** `frontend/src/lib/api.ts`

Add types and API methods:

```ts
export const leadsApi = {
  getByPage: (pageId: string, params?: { status?: LeadStatus; limit?: number; offset?: number }) =>
    api.get<LeadsPaginatedResponse>('/leads', { params: { pageId, ...params } }),

  updateStatus: (leadId: string, pageId: string, status: LeadStatus) =>
    api.patch<Lead>(`/leads/${leadId}/status`, { pageId, status }),

  deleteLead: (leadId: string, pageId: string) =>           // [NEW]
    api.delete(`/leads/${leadId}`, { params: { pageId } }),

  exportCsv: (pageId: string, status?: LeadStatus) =>       // [NEW]
    api.get('/leads/export', { params: { pageId, status }, responseType: 'blob' }),
};
```

---

### Step 8: Sidebar Navigation

**File:** `frontend/src/components/layout/Sidebar.tsx`

Add to inbox group: `{ key: 'nav.leads', href: '/leads', icon: Users }`

Import `Users` from `lucide-react`.

**[NEW]** Add badge showing count of `new` leads (fetched via lightweight `GET /leads?pageId=&status=new&limit=0` that returns only `totalCount`).

**Files:** `frontend/src/i18n/en/nav.json` + `ar/nav.json` — add `"leads"` key

---

### Step 9: Leads Page

**New file:** `frontend/src/pages/leads.tsx`

Structure:

- Page selector `<select>` → loads leads for chosen page
- Status filter tabs: All / New / Contacted / Converted
- `<table>` with static columns (name, phone, status, summary, date) + dynamic columns from `extractedData.fields`
- `LeadRow` component:
  - Phone cell uses `dir="ltr"` (only on the `<td>`, not container)
  - Status badge uses `status-info/warning/success` semantic classes
  - **[NEW]** "Edit" inline capability — click field to correct AI extraction errors
  - **[NEW]** Delete button with confirmation dialog
- "Advance status" button: new → contacted → converted
- **[CHANGED]** Export CSV triggers server-side endpoint (not client-side assembly)
- React Query: key strategy `['leads', pageId, { status, offset }]`
- `useMutation` for status updates + delete
- **SSE integration** — subscribe to `lead:captured` event via `useSSE()` hook:
  - When event fires → `queryClient.invalidateQueries(['leads', pageId])` to refresh list
  - Show toast: "عميل محتمل جديد: {senderName}" / "New lead: {senderName}"
  - Sidebar badge count increments in real-time (invalidate `['leads:count']` query)
- `DashboardLayout` wrapper + `makeGetStaticProps([...PAGE_NAMESPACES.leads])`
- Empty state with illustration and description

---

### Step 10: Doc Updates (same commit)

- `SYSTEM_ANALYSIS.md` — add Leads feature
- `.planning/codebase/ARCHITECTURE.md` — document `leadExtractor.ts` and its position in the pipeline

---

## Phase 2 — Future Enhancements (not in this implementation)

| Feature | Description |
|---------|-------------|
| **Real-time Notifications** | SSE event + toast when new lead captured. Email digest (daily/weekly) |
| **Archiving** | Auto-archive leads older than configurable period. "Archived" tab |
| **CRM Pipeline** | Kanban view with customizable stages per workspace |
| **Lead Scoring** | AI-based scoring (hot/warm/cold) based on conversation sentiment and intent |
| **Webhook Export** | Push new leads to external CRM (HubSpot, Zoho) via webhook |
| **Duplicate Merging** | Detect same phone across different pages, offer merge |
| **Custom Fields** | Workspace owner defines expected fields (e.g. "budget", "timeline") to improve extraction accuracy |
| **WhatsApp Support** | Extend lead extraction to WhatsApp conversations (when WhatsApp integration ships) |

---

## Verification

### Manual E2E

1. Send DM with phone: "أنا مهتم بالتسجيل، رقمي ٠٥٠١٢٣٤٥٦٧" (Arabic-Indic digits)
2. Watch backend logs: `[leadExtractor] Lead captured`
3. Open `/leads`, select page → lead appears with dynamic fields
4. Click field to edit → correct a value → saves
5. Click "Mark as Contacted" → badge updates
6. Delete a lead → confirm → removed from list
7. Export CSV → dynamic columns appear correctly with consistent headers

### Tests to Add

- `packages/shared/src/__tests__/validation.test.ts`:
  - `extractPhoneFromText`: Arabic-Indic digits, `00966`, `+966`, `05xx`, no-phone cases, mixed digits
  - Edge cases: phone-like strings that are too short, strings with only digits

- `backend/src/__tests__/leadExtractor.test.ts`:
  - Mock OpenAI + DB
  - ✅ Captures lead when phone found (any intent)
  - ✅ No-op when no phone in message
  - ✅ Upsert merges fields on duplicate sender+page
  - ✅ Conversation limited to 20 messages
  - ✅ `captureError()` called on failure, never throws

- `backend/src/__tests__/leads.controller.test.ts`:
  - ✅ Pagination works correctly
  - ✅ Status filter works
  - ✅ Ownership check prevents cross-workspace access
  - ✅ Delete removes lead
  - ✅ CSV export has consistent columns

### Lint

```bash
cd backend && npm run lint
cd frontend && npm run lint
npm run translation:validate   # from frontend/
```

---

## Summary of Changes from v1

| # | Change | Reason |
|---|--------|--------|
| 1 | Removed intent gate — phone presence is the only trigger | Intent misclassification would lose leads |
| 2 | `extractedData` default changed to `{ fields: [] }` | Matches TypeScript type, prevents runtime errors |
| 3 | Conversation context limited to 20 messages | Controls AI cost on long conversations |
| 4 | Added AI prompt rule for "not sender's phone" | Prevents capturing wrong numbers |
| 5 | Added CHECK constraint on `status` column | Defense in depth at DB level |
| 6 | Added delete lead endpoint + UI | Users need to remove spam/wrong entries |
| 7 | CSV export moved to server-side streaming | Handles large datasets without browser memory issues |
| 8 | Added inline edit for extracted fields | Users can correct AI extraction errors |
| 9 | Added sidebar badge for new leads count | Users need to know about new leads without opening the page |
| 10 | Added React Query key strategy | Ensures proper cache invalidation on filter/pagination changes |
| 11 | Phase 2 roadmap documented | Clear scope boundary — prevents scope creep |

### v2 → v3 Additions

| # | Addition | Section |
|---|----------|---------|
| 12 | Privacy policy update + data deletion endpoint + consent notice | Section A |
| 13 | Daily extraction rate limit per workspace + global concurrency limit | Section B |
| 14 | Retry strategy with `extractionStatus` column + manual re-extract button | Section C |
| 15 | Per-page `leadsEnabled` toggle with settings UI | Section D |
| 16 | Plan tier feature gating — paid plans only (starter+), free plan blocked entirely | Section E |
| 17 | Onboarding empty states + first-lead celebration + sidebar tooltip | Section F |
| 18 | Comments pipeline hook (`commentProcessor.ts`) + `sourceType` column | Step 4b |
| 19 | SSE `lead:captured` event — real-time toast + badge + list refresh | Step 3, 9 |
