# Jawab24 — Product Roadmap

> **Last updated**: 2026-02-22
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
- Multi-tenant workspace infrastructure (invisible to users, ready for team features)

### Competitive Gaps
- No WhatsApp channel
- No chatbot flow builder
- Limited analytics (basic overview only)
- No customer profiles/CRM
- No AI suggested replies in inbox
- Frontend doesn't fully reflect backend capabilities
- Team features: backend ready, UI not yet exposed (see Phase 6)

---

## Completed Work

### Workspace / Multi-Tenant Infrastructure (2026-02-22) ✅
- Full workspace-scoped data model: pages, templates, rules, settings all scoped by `workspaceId`
- RBAC middleware: owner > admin > member roles with `resolveWorkspace` + `requireRole`
- Workspace auto-created on signup (invisible to users)
- Reply pipeline fully workspace-aware (settings, rules, templates resolved by workspace)
- Invite system backend-ready (hashed tokens, expiry, single-use)
- Frontend silently manages workspace state (`X-Workspace-Id` header on every request)
- Comprehensive backend tests: integration, isolation, pipeline, middleware
- **UI intentionally hidden** — no team page, no invite UI, no workspace switcher
- Activating team UI estimated at ~5-7 days when customers request it
- Full plan: `docs/workspace-implementation-plan.md`

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

## Phase 6: Team Features UI

**Impact**: Medium-High | **Effort**: Low (backend done) | **Backend readiness**: Complete

Backend infrastructure is fully built and running in production (see Completed Work above). Only frontend UI work remains.

### 6.1 ~~Team members table~~ DONE
- `workspace_members` table with RBAC (owner/admin/member) — already in production
- All business data scoped by `workspaceId` — already working

### 6.2 Remaining: Team Management UI (~2-3 days)
- Team management page (list members, roles, remove)
- Invite generation UI (currently API-only)
- Invite accept page (`/invite/[token]`)
- Workspace switcher (for users with >1 workspace)

### 6.3 Remaining: Conversation Assignment (~2 days)
- Assign conversations to specific agents
- "Unassigned" as default (needs attention queue)
- Auto-assignment rules (optional, round-robin)

### 6.4 Remaining: Activity Tracking (~1-2 days)
- Who replied to what
- Agent performance metrics (response time, volume)

### 6.5 ~~Invitation flow~~ Backend DONE
- Hashed token invite system — already built
- Accept/revoke/expiry — already working
- Only needs: frontend invite accept page + invite generation UI

---

## Competitive Analysis Summary

### Supported Platforms

| Channel | ManyChat | Intercom | Crisp | **Jawab24** |
|---|---|---|---|---|
| Facebook Comments | ✅ | ❌ | ❌ | **✅** |
| Facebook Messenger | ✅ | ✅ | ✅ | **✅** |
| Instagram Comments | ✅ | ❌ | ❌ | **✅** |
| Instagram DM | ✅ | ❌ | ✅ | **✅** |
| WhatsApp | ✅ | ✅ | ✅ | ❌ (Phase 5) |
| Web Chat | ✅ | ✅ | ✅ | ❌ |
| Email | ✅ | ✅ | ✅ | ❌ |
| SMS | ✅ | ❌ | ❌ | ❌ |

### Direct Competitors (Same niche)

| | CommentGuard | Simple auto-reply tools | **Jawab24** |
|---|---|---|---|
| Keyword rules | ✅ | ✅ | ✅ |
| AI replies | ❌ | ❌ | **✅** RAG + KB |
| Arabic-first | ❌ | ❌ | **✅** |
| Knowledge Base | ❌ | ❌ | **✅** + semantic search |
| Gap detection | ❌ | ❌ | **✅** |
| Mobile app | ❌ | ❌ | **✅** |
| Multi-channel | ❌ | ❌ | **✅** (FB + IG) |

### Larger Competitors (Feature comparison)

| Feature | ManyChat | Intercom | Crisp | **Jawab24** |
|---|---|---|---|---|
| Arabic AI | Weak | No | No | **Strong** |
| Chatbot flows | ✅ | ✅ | ✅ | ❌ |
| WhatsApp | ✅ | ✅ | ✅ | ❌ (Phase 5) |
| Team features | ✅ | ✅ | ✅ | Backend ✅, UI pending (Phase 6) |
| AI suggested replies | ✅ | ✅ (Fin) | ✅ (MagicReply) | Partial (Smart Reply button, Phase 2 for multi-suggestion chips) |
| Customer profiles / CRM | ✅ | ✅ | ✅ | ❌ (Phase 3) |
| Advanced analytics | ✅ | ✅ | ✅ | Basic (Phase 4) |
| Price hallucination guard | ❌ | ❌ | ❌ | **✅ Unique** |
| KB gap detection | ❌ | ❌ | ❌ | **✅ Unique** |
| Semantic caching | ❌ | ❌ | ❌ | **✅ Unique** |
| Bilingual auto-translation | ❌ | ❌ | ❌ | **✅ Unique** |
| E-commerce AI (Shopify) | ✅ | ❌ | ❌ | **✅** |

### Jawab24 Strengths (what no competitor has)

| Strength | Description | Competitive edge |
|----------|-------------|-----------------|
| Arabic-first AI | RAG + Knowledge Base with Arabic normalization (diacritics, alef variants, digit conversion) | No competitor does Arabic AI at this depth |
| KB Gap Detection | Automatically detects questions the Knowledge Base doesn't cover, notifies merchant | No competitor has this |
| Price Hallucination Guard | Prevents AI from inventing incorrect prices from product data | No competitor has this |
| Semantic Caching | pgvector cosine similarity, 70-80% cache hit rate, reduces AI costs significantly | No competitor has this |
| Bilingual Auto-Translation | User writes in one language, system auto-translates to Arabic + English | No competitor does this transparently |
| 3 Reply Modes | Public comment, private message, or both (dual reply) — user configurable per-workspace | Unique flexibility |
| Shopify-Aware AI | AI reads product catalog (name, price, stock) to answer customer questions accurately | Only ManyChat has e-commerce, but not with RAG |

### Jawab24 Weaknesses (gaps to close)

| Weakness | Impact | Fix | Priority |
|----------|--------|-----|----------|
| Only 2 channels (FB + IG) | Competitors have 4-6 channels. Missing WhatsApp = missing biggest MENA channel | Phase 5: WhatsApp | **High** |
| No web chat widget | Industry standard for websites. Missing = lost leads from website visitors | Future phase | Medium |
| No chatbot flow builder | ManyChat's core product. Complex to build, but Rules + AI covers 90% of use cases | Not planned (intentional) | Low |
| Limited analytics | Only basic overview dashboard. Competitors have deep insights | Phase 4: Smart Analytics | Medium |
| No customer profiles / CRM | No customer history view, tags, or notes. Competitors surface this | Phase 3: Customer Profiles | Medium |
| No AI suggested replies in inbox | Smart Reply button exists (comments), but competitors show 2-3 AI suggestion chips for agents to pick from | Phase 2: AI Suggestions | **High** |
| No email channel | Standard for support platforms. Not critical for social-first merchants | Future phase | Low |
| Team UI not exposed | Backend ready but no team management page, invite UI, or role indicators | Phase 6: Team UI (~5-7 days) | Low (on demand) |

### Jawab24's Unique Differentiator
**Arabic-first AI + RAG + bilingual auto-translation** — no competitor serves the MENA market with this depth. ManyChat has scale, Intercom has enterprise features, but neither does Arabic well. The 4 unique features (gap detection, price guard, semantic caching, auto-translation) have no equivalent in any competitor.

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
| **Phase 6** | Team Features UI | Backend done ✅ — only UI needed, can start anytime |
