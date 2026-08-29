# Jawab24 System Overview

> Last updated: 2026-04-03

## 1. Core Principles

These four rules are inviolable. Every feature, pipeline step, and safety check traces back to one of them.

1. **No Guessing Ever** -- The system never hallucinates prices, availability, or facts. If data is not in the KB or templates, it falls back to a safe response or flags for human review.
2. **Safety Over Flashy AI** -- Reliability and account safety are prioritized over creative AI responses. Spam triggers, offensive content, and policy violations are caught before any reply is sent.
3. **No Silent Ignoring** -- Every inbound interaction produces a result: a reply, a flag, or a notification. Messages are never silently dropped.
4. **User Owns Content** -- All replies are bounded by user-defined templates, knowledge base, and settings. The AI operates within these constraints.

## 2. System Architecture

| Component | Technology |
|-----------|-----------|
| Event source | Facebook/Instagram webhooks (comments + DMs) |
| Backend | Fastify 5 + Drizzle ORM + PostgreSQL |
| AI (primary) | OpenAI gpt-4.1-mini via ai-worker service (port 3002) |
| AI (fallback) | Claude Haiku 4.5 (when primary is unreachable, via circuit breaker) |
| Caching | Redis (exact-match + semantic) + PostgreSQL (ai_cache table) |
| Search/RAG | pgvector HNSW index + pg_trgm trigram matching |
| Transcription | gpt-4o-mini-transcribe (voice messages + KB voice input) |
| Vision/OCR | gpt-4o-mini (KB file upload: scanned PDFs, images) |
| E-commerce | Shopify, Salla, Zid integrations (product catalog, order tools) |

## 3. DM Pipeline

Implemented in `messageProcessor.ts`. Platform-agnostic -- all platform-specific behavior is injected via adapter.

| Step | Description | Exit condition |
|------|-------------|----------------|
| 1 | **Validate page** -- look up page by platform ID, verify userId and workspaceId exist | Page not found / no user / no workspace |
| 2 | **Fetch sender name** (best-effort) -- cached in Redis for 24h | Never exits (non-critical) |
| 3 | **Store incoming message** -- persisted before any processing so dashboard always has it | -- |
| -- | **SSE: message:received** -- notify merchant in real-time | -- |
| 4 | **Auto-reply enabled check** -- page OFF = Jawab24 is invisible, no reply, no flag | Auto-reply disabled |
| 4a | **Subscription gate** -- all automation stops when subscription is inactive | Subscription inactive |
| 4b | **Acquire distributed lock** -- Redis SET NX EX 60s, prevents double-replies | Lock held by another worker |
| 5 | **Debounce check** (fast-path) -- skip if newer unreplied message exists from same sender. Skipped when replyDelay > 0 (delay acts as consolidation window) | Newer message pending |
| 6-8 | **Guard checks** (parallel) -- handoff pause, rate limit (10/min), messages auto-reply setting + away message | Handoff active / rate limited / settings disabled |
| 9 | **Already replied/flagged** -- skip duplicate processing | Already replied |
| 9b | **Greeting gate** -- first message in conversation sends greeting message, then returns | Greeting sent (early return) |
| 10 | **Reply delay** -- configurable delay (seconds), doubles as consolidation window | -- |
| 10b | **Post-delay debounce re-check** -- after waiting, a newer message may have arrived | Newer message pending (post-delay) |
| 11 | **Consolidate unreplied messages** -- gather all unreplied from sender. Latest used for template matching, full set for AI context | -- |
| 11b | **Typing indicator** -- send platform typing indicator before AI generation | -- |
| 12 | **Generate reply** -- template match -> AI with RAG -> fallback (see Section 5). Enriches KB with e-commerce data, business profile, brand voice notes | -- |
| 12b | **Price fallback** -- if AI hallucinated a price (`price_not_in_kb`), replace with safe canned response | -- |
| 12c | **Skip offensive** -- `offensive_or_abusive` flag or `OFFENSIVE`/`SPAM_OR_IRRELEVANT` intent: flag and notify, no reply sent | Skipped (risky) |
| 12c-bis | **Withhold exhausted self-ID strip** (always on) -- Check 6 stripped the ENTIRE reply, so the worker returns an empty reply + `self_identification_exhausted`: flag as `held_self_identification`, notify, capture the lead, send nothing. Runs before 12d (a low-confidence exhausted reply would be held with an empty draft) and before the `!replyText` guard (whose `success:false` re-bills the same doomed generation) | Held for review |
| 12d | **Hold low-confidence** -- when `holdLowConfidence` setting enabled and confidence is low: store original AI reply, flag as `held_low_confidence`, notify merchant | Held for review |
| 12e | **Max length enforcement** -- truncate at sentence boundary: Facebook 2000 chars, Instagram 1000 chars | -- |
| 13 | **Send reply** -- via platform adapter. On failure: mark as `delivery_failed`, SSE notify, return | Send failed |
| 14-16 | **Post-reply transaction** -- mark as replied, store outgoing message, mark older debounced messages (all in one DB transaction) | -- |
| 17 | **Notify if flagged** -- push notification with enriched reason (order number extraction for urgent flags) | -- |
| 18 | **Structured log** -- single `reply_sent` event with method, intent, confidence, flags, duration, consolidated count | -- |

Lock is released in `finally` block (or auto-expires after 60s TTL).

## 4. Comment Pipeline

Implemented in `commentProcessor.ts`. Same adapter pattern as DMs.

| Step | Description | Exit condition |
|------|-------------|----------------|
| 1 | **Validate page** -- page exists, auto-reply on, userId/workspaceId present | Page not found / disabled / no user |
| 2 | **Load workspace settings** -- cached in Redis (5 min TTL) | -- |
| 3 | **Find or create content** (post/media) -- check per-content auto-reply flag | Content auto-reply disabled |
| 4 | **Store comment** -- persist + check already replied/flagged | Already replied |
| 4a | **Subscription gate** | Subscription inactive |
| 4b | **Acquire per-comment lock** -- key: `comment:{pageId}:{commentId}` | Lock held |
| 5-6 | **Guard checks** (parallel) -- handoff pause + rate limit (5/min) | Handoff / rate limited |
| 7 | **Reply delay** | -- |
| 8 | **Generate reply** -- same priority stack as DMs, with comment reply mode awareness | -- |
| 8b | **Price fallback** | -- |
| 8c | **Skip offensive** | Skipped (risky) |
| 8c-bis | **Withhold exhausted self-ID strip** (always on) -- mirror of DM 12c-bis; also runs before step 9, whose adapter fallback would re-inject canned text | Held for review |
| 8d | **Hold low-confidence** | Held for review |
| 9 | **Handle no-reply** -- use adapter fallback or notify merchant | No reply generated |
| 9b | **Max length** -- public mode: 500 chars (truncated at sentence). Private/dual modes: no truncation (sent as DM) | -- |
| 10 | **Send reply** -- via adapter (handles public/private/dual routing) | Send failed |
| 11 | **Mark as replied** -- includes detected language, template ID, AI original reply | -- |
| 12 | **Notify if flagged** | -- |

## 5. Reply Generation

Implemented in `generator.ts`. Priority stack (same for DMs and comments):

### Priority 1: Template Match

- Keyword rules matched against the latest message text (not consolidated text)
- DM-only dedup: if the same template was already sent to this sender in conversation history, skip to AI
- Returns immediately with `replyMethod: 'template'`

### Priority 2: AI with RAG

Requires `aiEnabled = true` and subscription allows AI replies.

1. **Pre-AI offensive filter** -- regex-based profanity detection catches content GPT might misclassify
2. **Subscription limit check** -- `canUseAiReplies()` verifies quota
3. **Conversation context** (DMs only) -- fetches last 12 messages + customer summary (name, returning status)
4. **RAG retrieval** -- `resolveKnowledge()` (see Section 6)
5. **E-commerce enrichment** -- store policies + product catalog injected as separate context fields (survive RAG mode which drops static KB)
6. **Business profile** -- hours, location, phone appended to KB context
7. **Brand voice notes** -- language-appropriate voice notes selected from multi-language config
8. **AI generation** -- standard `aiService.generateReply()` or `generateReplyWithTools()` (when e-commerce store linked, enables tool loop for order lookup/tracking/inventory)
9. **Post-processing** -- intent normalization, flag computation, hallucination guard, gap detection, usage tracking

### Priority 3: Fallback

- Comments: hardcoded "Thank you for your comment!"
- DMs: returns null (pipeline handles "no reply generated")

### Comment Reply Modes

When `commentReplyMode` is `dual` or `private`, AI generates a DM-style reply (detailed, with prices/specs) because the reply will be sent as a private message, not a public comment.

## 6. RAG & Knowledge Base

### RAG Modes (`RAG_MODE` env var)

| Mode | Behavior |
|------|----------|
| `off` | Static KB only, no retrieval |
| `shadow` | Runs retrieval + logs results, but still sends static KB to GPT |
| `on` | Full RAG -- sends retrieved chunks to GPT, omits static KB |

### Hybrid Retrieval (`retrieval.ts`)

1. Normalize + embed the query (OpenAI embeddings)
2. Vector search: top-20 candidates via pgvector HNSW index
3. Trigram re-rank: pg_trgm similarity on title + content (candidates only)
4. Score fusion: `0.7 * vectorScore + 0.3 * textScore + languageBoost(0.02)`
5. Filter by threshold (0.3 minimum) + return top-5

### Small KB Optimization

When static KB is under 5,000 chars, skip RAG and send full KB text to GPT. Avoids semantic gaps where customer uses different terminology than KB. Exception: e-commerce pages always use RAG (product chunks have detailed specs not in static KB).

### Query Enrichment

For vague follow-ups (6 words or fewer), enrich the RAG query with:
- Last user message (up to 100 chars) -- ground truth of what customer asked
- Last assistant reply tail (last 80 chars) -- captures topics AI introduced
- Combined query capped at 400 chars

The 80-char assistant tail limit mitigates hallucination poisoning -- hallucinated facts tend to appear mid-reply, while new topics appear at the end.

### KB File Upload (`file-extractor.ts`)

| Format | Method | Limits |
|--------|--------|--------|
| PDF | `pdfjs-dist` text layer (up to 20 pages; never replaced by OCR — D-112) | 5 MB max, 16K chars output |
| Word (.docx) | mammoth | 5 MB max, 16K chars output |
| Excel (.xlsx) | exceljs (merged cells expanded, tab-separated rows) | 5 MB max, 16K chars output |
| Images (JPEG, PNG, WebP) | gpt-4.1-mini Vision (Business+, daily quota) | 5 MB max, 16K chars output |
| Scanned PDFs | no usable text layer anywhere (< 50 chars) → gpt-4.1-mini Vision on every page (max 10) | Same limits |
| Text-layer PDF pages Vision revisits | per page: an Arabic layer holding a scrambled table (`looksTabular`) or a page with no usable layer of its own → Vision on THOSE pages only, anchored on the layer, spliced back (`method: pdfjs+gpt-vision`); Vision denied or failed → the layer is returned, never an error | Same limits |

### Voice Input

gpt-4o-mini-transcribe for both:
- **Pipeline voice messages** -- incoming audio DMs transcribed and fed into AI reply pipeline
- **KB voice input** -- longer recordings (up to 60s) for knowledge base dictation

### Gap Detection

When RAG returns 0 chunks or AI returns low-confidence with `info_not_in_kb`, the question is recorded as a KB gap. Merchants see unanswered questions in the dashboard for KB improvement insights.

## 7. AI Caching

Implemented in `ai.ts`.

### Exact-Match Cache

- **Key construction**: SHA256 hash of normalized comment + language + pageId + kbActiveVersion + postMessage + storePolicies(MD5) + replyStyle + customerContext(MD5) + promptVersion
- **Storage**: Redis (`cache:ai_reply:{hash}`, 30-day TTL) + PostgreSQL (`ai_cache` table)
- **Lookup**: Redis first (fast path), Postgres fallback
- **Stored data**: reply text + intent + confidence + flags (full metadata)

### Semantic Cache

- Embedding similarity lookup (separate service)
- **Skipped when `customerContext` is present** -- personalized replies need fresh generation
- Scoped by channel + replyStyle (metadata filtering)

### Cache Context Fields

All of these affect the cache key (different value = different cache entry):

| Field | Purpose |
|-------|---------|
| `language` | Detected message language |
| `pageId` | Per-page isolation |
| `kbActiveVersion` | Invalidates when KB is updated |
| `postMessage` | Comment context (different posts get different replies) |
| `storePolicies` | E-commerce policy changes invalidate cache |
| `replyStyle` | professional/casual/enthusiastic |
| `customerContext` | Customer name + returning status |
| `PROMPT_VERSION` | Prompt changes invalidate all cached replies |

## 8. Safety & Protection

### Rate Limiting

| Type | Limit | Window | Redis key |
|------|-------|--------|-----------|
| Messages | 10 per sender per page | 60s | `rate:message:{pageId}:{userId}` |
| Comments | 5 per sender per page | 60s | `rate:comment:{pageId}:{userId}` |

Fail-open: if Redis is unavailable, requests are allowed.

### Distributed Lock

- Key: `reply_lock:{pageId}:{senderId}` (DMs) or `reply_lock:comment:{pageId}:{commentId}` (comments)
- TTL: 60 seconds
- Mechanism: Redis SET NX EX (atomic acquire), Lua CAS script (safe release)
- Prevents: double-replies from concurrent webhook deliveries, greeting message race conditions

### Hallucination Guard

When RAG was attempted (`ragAttempted=true`) and returned 0 chunks and no static KB fallback was available:
- Force `info_not_in_kb` + `low_confidence` flags regardless of what GPT claimed
- Exception: "safe" intents (COMPLIMENT, COMPLAINT, GREETING, OFFENSIVE, SPAM_OR_IRRELEVANT) are not overridden

### Price Verification

AI flags `price_not_in_kb` when it detects a price not grounded in KB data. The pipeline replaces the entire reply with a safe canned response:
- Arabic: "شكراً لاهتمامك! خليني أتأكد من تفاصيل الأسعار وبرجعلك بأقرب وقت."
- English: "Thank you for your interest! Let me confirm the pricing details and get back to you shortly."

### Offensive Content

Two-layer detection:
1. **Pre-AI regex filter** (`offensive-filter.ts`) -- catches profanity before GPT call. Arabic substring matching + English word-boundary matching.
2. **AI intent detection** -- GPT returns `OFFENSIVE` intent or `offensive_or_abusive` flag.

Both trigger: flag the message, notify merchant, **skip reply entirely** (no response sent).

### Angry Customer Detection

- Regex patterns in `fallbackClassifier.ts` for Arabic and English anger indicators
- AI also detects via structured `angry_customer` flag
- Flagged as **urgent** -- triggers priority notification with order number extraction

### Reply Length Limits

| Context | Max chars | Method |
|---------|-----------|--------|
| Facebook DM | 2000 | `truncateAtSentence()` |
| Instagram DM | 1000 | `truncateAtSentence()` |
| Public comment | 500 | `truncateAtSentence()` |
| Private/dual comment | No truncation | Sent as DM |

### Held Low-Confidence

When `holdLowConfidence` workspace setting is enabled:
- AI replies with `confidence: 'low'` are **not sent** to the customer
- Original AI reply is stored in `aiOriginalReply` for merchant to review/edit/approve
- Merchant is notified via push notification
- Flagged as `held_low_confidence`

### Circuit Breaker

AI worker calls are wrapped in a circuit breaker (`circuitBreaker.ts`). When the primary AI (OpenAI) is unreachable:
- Circuit opens after repeated failures
- Fallback to Claude Haiku 4.5
- Merchant notified once per hour (dedup via `failover:notified:{userId}` Redis key, 1h TTL)
- Fallback classifier (`fallbackClassifier.ts`) provides basic intent/confidence/flags when AI worker is completely down

## 9. Flags & Needs Attention

### Flag Taxonomy

All flags are comma-separated in the `flagReason` field.

| Flag | Source | Description |
|------|--------|-------------|
| `info_not_in_kb` | AI + hallucination guard | Question about something not covered in the knowledge base |
| `low_confidence` | AI + hallucination guard | AI is not confident in its reply |
| `price_not_in_kb` | AI | Price mentioned that is not grounded in KB data (triggers safe fallback) |
| `angry_customer` | AI + regex | Customer shows frustration/anger indicators |
| `complaint` | Intent normalization | Derived from COMPLAINT intent when no explicit flag |
| `offensive_or_abusive` | Pre-AI regex + AI | Profanity or abusive content detected (reply skipped) |
| `offensive` | Intent normalization | Derived from OFFENSIVE intent when no explicit flag |
| `cancellation_request` | AI | Customer wants to cancel an order |
| `refund_request` | AI | Customer wants a refund |
| `exchange_request` | AI | Customer wants to exchange a product |
| `delivery_failed` | Pipeline | Platform API rejected the reply (not an AI flag) |
| `held_low_confidence` | Pipeline | Reply held for merchant review (holdLowConfidence setting) |
| `self_identification_stripped` | Validator (Check 6) | Automated-identity wording was removed from the reply. Also blocks the reply caches |
| `self_identification_exhausted` | Validator (Check 6) | Check 6 stripped EVERY sentence — the worker returns an empty reply carrying this flag. Cross-service hold signal; never a generation failure |
| `held_self_identification` | Pipeline | Stored reason for a row withheld by 12c-bis / 8c-bis. Always on — no merchant setting |

### Urgent Flags

These trigger priority push notifications with order number extraction from the message text:

- `cancellation_request`
- `refund_request`
- `exchange_request`
- `angry_customer`

### computeNeedsAttention Logic

```
needsAttention = true when:
  - For question-like intents (QUESTION, BUSINESS_INQUIRY, PURCHASE_INTENT):
      any flag present (including low_confidence alone)
  - For non-question intents (GREETING, COMPLIMENT, SPAM_OR_IRRELEVANT):
      any flag OTHER than low_confidence (low_confidence alone is normal for these)
  - Intent is COMPLAINT or OFFENSIVE (regardless of flags)
```

### Skip Reply Logic

Reply is **not sent** when:
- `flagReason` contains `offensive_or_abusive` or `offensive`
- `aiIntent` is `OFFENSIVE` or `SPAM_OR_IRRELEVANT`

## 10. Redis Keys

| Key pattern | TTL | Purpose |
|-------------|-----|---------|
| `rate:{type}:{pageId}:{userId}` | 60s | Rate limit counter (INCR + EXPIRE) |
| `cache:ai_reply:{sha256hash}` | 30 days | Exact-match AI reply cache |
| `reply_lock:{pageId}:{senderId}` | 60s | DM distributed lock |
| `reply_lock:comment:{pageId}:{commentId}` | 60s | Comment distributed lock |
| `sender_name:{senderId}` | 24h | Facebook sender name cache |
| `vision_extract:{userId}:{date}` | 24h | Daily GPT Vision extraction quota counter |
| `workspace_settings:v1:{workspaceId}` | 5 min | Workspace settings cache |
| `settings:v1:{userId}` | 5 min | User settings cache |
| `sub:active:{userId}` | 60s | Subscription active status cache |
| `stats:workspace:{workspaceId}` | 5 min | Dashboard stats cache |
| `stats:throttle:{workspaceId}` | 30s | Stats invalidation throttle |
| `nontext_nudge:{pageId}:{senderId}` | 1h | Non-text message nudge cooldown |
| `failover:notified:{userId}` | 1h | AI failover notification dedup |
| `ecom:tool:{storeId}:{toolName}:{argsHash}` | 5 min | E-commerce tool call result cache |
| `ecom:pending:{storeId}:{toolType}:{orderNumber}` | 10 min | Pending order verification data |
| `metrics:pipeline:{name}` | -- | Pipeline outcome counters (INCR, no TTL) |
| `metrics:pipeline:circuit.{name}.opened` | -- | Circuit breaker open event counter |

## 11. Comment Reply Modes

Configured per workspace via `commentReplyMode` setting.

| Mode | Public reply | Private DM | AI behavior |
|------|-------------|------------|-------------|
| `public` | Full reply (max 500 chars, truncated at sentence) | -- | Comment-style (brief, no prices/specs) |
| `private` | -- | Full detailed reply | DM-style (detailed, with prices/specs) |
| `dual` | Short nudge ("sent you a DM") | Full detailed reply | DM-style for the private message |
