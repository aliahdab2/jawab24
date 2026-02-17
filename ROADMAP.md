# Jawab24 — Product Roadmap

> **Last updated**: 2026-02-17
> **Purpose**: Strategic feature roadmap based on competitive analysis and product study.

---

## Current Position

**Jawab24** is an Arabic-first AI auto-reply platform for Facebook & Instagram, targeting individual merchants and small teams in the MENA region.

### Competitive Strengths (Already Built)
- 3-layer reply system (Rules → AI with RAG → Human)
- Knowledge Base with pgvector semantic search
- Gap Detector (notifies merchant when KB doesn't cover a question)
- Price hallucination detection + offensive content guard
- Arabic normalization (diacritics, alef variants, digit conversion)
- Auto-translation Arabic↔English (greeting, away, KB)
- 3 reply modes (public / private / dual)
- Semantic caching (70-80% cache hit rate)
- Shopify product-aware AI replies
- Capacitor mobile app (iOS/Android)
- Escalation SLA system
- Conversation pause/resume (handoff)

### Competitive Gaps
- No WhatsApp channel
- No team/multi-agent features
- No chatbot flow builder
- Limited analytics (basic overview only)
- No customer profiles/CRM
- No AI suggested replies in inbox
- Frontend doesn't fully reflect backend capabilities

---

## Completed Work

### Comments Page Redesign (2026-02-17) ✅
- Replaced 6 stat cards with 3 filter chips (Needs Action / All / Auto-replied)
- Default filter: "Needs Action" (pending + flagged, excluding resolved)
- Added resolve/unresolve mechanism
- Added post context on cards and modal
- Moved CSV export to overflow menu
- Removed one-shot lock on Smart Reply (regenerate allowed)
- Removed unnecessary elements (language badge, flag reason on card, result counter)
- Added low-confidence skip to auto-reply (backend)
- RTL fixes, accessibility improvements, toast feedback

---

## Phase 1: Messages Page Redesign (Next)

Apply the same design philosophy as Comments redesign.

### 1.1 Replace 6 stat cards with 3 filter chips
**Current**: 6 stat cards (Total, Pending, Replied, Smart Replies, Template Replies, Needs Attention)
**Target**: 3 filter chips — `Needs Action` | `All` | `Auto-replied`

### 1.2 Default to "Needs Action"
Same as Comments — merchants open the page and see what needs their attention.

### 1.3 Add resolve/unresolve for conversations
Conversations like "شكراً 👍" that don't need a reply sit in pending forever.
- Add `resolved` field to messages or conversation-level tracking
- Add resolve/unresolve buttons in card and modal

### 1.4 Add AI regenerate button in modal
CommentDetailModal has it, Messages modal doesn't. Parity needed.

### 1.5 Wire toast notifications
Translation keys exist but are unused:
- `messages.pauseSuccess` → toast on pause
- `messages.resumeSuccess` → toast on resume
- `messages.replySent` → toast on reply

### 1.6 Remove dead code
- `repliedToday` stat is hardcoded to 0 — remove it
- Clean up unused translation keys

### 1.7 Landscape optimization
- Add `landscape:px-6` for side padding
- Modal: `max-h-[85vh] landscape:max-h-[90vh]`

### 1.8 Consistent design language
- Same card style as Comments (chat bubble pattern)
- Same modal structure (header, scrollable body, fixed footer)
- Same badge/chip styling

---

## Phase 2: AI Suggested Replies

**Impact**: High | **Effort**: Low | **Backend readiness**: High

When a merchant opens a conversation, show 2-3 AI-suggested replies they can click to send.

### 2.1 Backend: New AI endpoint
- `POST /ai/suggest` — returns 2-3 reply suggestions instead of 1
- Modify AI Worker prompt to return array of suggestions with different tones/approaches
- Use existing KB + semantic search + conversation history
- Cache suggestions per conversation

### 2.2 Frontend: Suggestion chips in modal
- Show 2-3 clickable suggestion chips above the reply textarea
- Click to populate textarea (editable before sending)
- "Regenerate" button to get new suggestions
- Loading state while generating

### 2.3 Bilingual suggestions
- Detect customer language → suggest replies in same language
- Leverage existing Arabic normalization + language detection

---

## Phase 3: Customer Profiles

**Impact**: High | **Effort**: Low-Medium | **Backend readiness**: Data exists

Every `senderId` already has message history, language, intent data in the database. Surface it.

### 3.1 Backend: Customer profile endpoint
- `GET /customers/:senderId/profile`
- Aggregate from messages + comments tables:
  - Total interactions count
  - First/last interaction dates
  - Detected language
  - Most common intents
  - Channels used (Facebook/Instagram)
  - Pages interacted with

### 3.2 Frontend: Profile sidebar/section in modal
- Show customer summary when viewing a conversation
- Interaction history timeline
- Language preference
- Intent distribution (what do they usually ask about?)

### 3.3 Future: Tags & notes
- Allow merchant to tag customers (VIP, wholesale, complaint)
- Internal notes per customer

---

## Phase 4: Smart Analytics Dashboard

**Impact**: High | **Effort**: Medium | **Backend readiness**: Data exists

All the data is already being collected — it just needs dashboards.

### 4.1 Top Unanswered Questions
- Source: `kbGaps` table (Gap Detector)
- Show: Top 5-10 questions the KB doesn't cover
- Action: "Add to Knowledge Base" button
- **This is unique** — no competitor has this

### 4.2 AI Performance Metrics
- Confidence distribution (high/medium/low from `aiCache.metadata`)
- Reply method breakdown over time (AI vs Template vs Manual)
- Cache hit rate trends

### 4.3 Response Time Analytics
- Average response time (from `createdAt` to `repliedAt`)
- Response time by channel (comments vs messages)
- SLA compliance rate

### 4.4 Intent Distribution
- What customers are asking about (from `aiIntent` field)
- QUESTION vs COMPLAINT vs PURCHASE_INTENT trends
- Language distribution

### 4.5 Actionable Insights
- "Your AI answered 85% of questions this week"
- "3 new questions your KB doesn't cover"
- "Average response time improved by 20%"

---

## Phase 5: WhatsApp Integration

**Impact**: Massive | **Effort**: High | **Backend readiness**: Architecture supports it

Biggest channel in MENA. The reply pipeline is channel-agnostic.

### 5.1 WhatsApp Business API setup
- Register with Meta WhatsApp Business Platform
- Webhook receiver for incoming messages
- Message sending via API

### 5.2 Backend: WhatsApp message processor
- New `whatsapp_message` job type in reply queue
- Reuse existing pipeline: debounce → pause check → rate limit → KB retrieval → AI reply
- WhatsApp-specific: template messages for first contact (Meta requirement)

### 5.3 Frontend: WhatsApp in Pages
- Link WhatsApp number to page
- Toggle auto-reply for WhatsApp
- WhatsApp conversations in Messages page

### 5.4 Considerations
- WhatsApp Business API approval process
- 24-hour messaging window (Meta policy)
- Template message requirements for outbound
- Pricing (WhatsApp API has per-message costs)

---

## Phase 6: Basic Team Features

**Impact**: Medium-High | **Effort**: High | **Backend readiness**: Needs new tables

Unlock small teams (2-5 people).

### 6.1 Team members table
- `team_members`: userId, teamId, role (admin/agent), invitedBy, status
- Roles: admin (full access), agent (reply only, no settings/billing)

### 6.2 Conversation assignment
- Assign conversations to specific agents
- "Unassigned" as default (needs attention queue)
- Auto-assignment rules (optional, round-robin)

### 6.3 Activity tracking
- Who replied to what
- Agent performance metrics (response time, volume)

### 6.4 Invitation flow
- Admin invites agent by email
- Agent creates account, joins team
- No separate billing (covered by admin's subscription)

---

## Competitive Analysis Summary

### Direct Competitors (Same niche)

| | CommentGuard | Simple auto-reply tools | **Jawab24** |
|---|---|---|---|
| Keyword rules | ✅ | ✅ | ✅ |
| AI replies | ❌ | ❌ | ✅ RAG + KB |
| Arabic-first | ❌ | ❌ | ✅ |
| Knowledge Base | ❌ | ❌ | ✅ + semantic search |
| Gap detection | ❌ | ❌ | ✅ |
| Mobile app | ❌ | ❌ | ✅ |

### Larger Competitors (Different tier)

| | ManyChat | Intercom | Crisp | **Jawab24** |
|---|---|---|---|---|
| Arabic AI | Weak | No | No | **Strong** |
| Chatbot flows | ✅ | ✅ | ✅ | ❌ |
| WhatsApp | ✅ | ✅ | ✅ | ❌ (Phase 5) |
| Team features | ✅ | ✅ | ✅ | ❌ (Phase 6) |
| AI suggested replies | ✅ | ✅ (Fin) | ✅ (MagicReply) | ❌ (Phase 2) |
| Customer profiles | ✅ | ✅ | ✅ | ❌ (Phase 3) |
| Analytics | ✅ | ✅ | ✅ | Basic (Phase 4) |
| Price hallucination guard | ❌ | ❌ | ❌ | **✅** |
| KB gap detection | ❌ | ❌ | ❌ | **✅** |
| Semantic caching | ❌ | ❌ | ❌ | **✅** |

### Jawab24's Unique Differentiator
**Arabic-first AI + RAG + bilingual auto-translation** — no competitor serves the MENA market with this depth. ManyChat has scale, Intercom has enterprise features, but neither does Arabic well.

---

## Prioritization Principles

1. **Leverage existing backend** — The backend is ahead of the frontend. Surface what's already built before building new backend features.
2. **Frontend first** — Messages redesign, AI suggestions UI, customer profiles sidebar, analytics dashboards. All use existing data/APIs.
3. **WhatsApp when ready** — Biggest market impact but biggest build. Do it when the core UX is polished.
4. **Team features last** — Current users are solo merchants. Build team features when there's demand.
5. **Don't build chatbot flows** — Rules + AI covers 90% of use cases. A flow builder is a product in itself (ManyChat has 100+ engineers on it).

---

## Timeline Estimate

| Phase | Description | Dependency |
|-------|-------------|------------|
| **Phase 1** | Messages page redesign | Comments redesign (done ✅) |
| **Phase 2** | AI Suggested Replies | Phase 1 (modal redesign) |
| **Phase 3** | Customer Profiles | Phase 1 (sidebar/modal work) |
| **Phase 4** | Smart Analytics | Independent (can parallel with 2-3) |
| **Phase 5** | WhatsApp | Independent (backend-heavy) |
| **Phase 6** | Team Features | After Phase 5 (needs stable multi-channel) |
