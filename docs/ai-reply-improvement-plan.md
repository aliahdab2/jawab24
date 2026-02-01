# AI Reply Improvement Plan

## Current State Analysis

### What We Have
1. **Knowledge Base** - Free-text field per page (max 10,000 chars), stored in `pages.knowledge_base`
2. **System Prompt** - Generic customer service prompt in `ai-worker/src/services/openai.ts`
3. **Safety Rules** - 7 rules preventing hallucinated prices/dates/numbers
4. **Template Matching** - Simple keyword matching via rules → templates
5. **Conversation History** - Last 10 messages for DMs (not for comments)
6. **Caching** - Redis + Postgres cache by normalized comment hash
7. **Language Detection** - Regex-based (Arabic, Swedish, English)
8. **Fallback** - Generic "Thank you" when AI fails or is disabled

### Current Weaknesses

| Problem | Impact | Example |
|---------|--------|---------|
| **Knowledge base is unstructured** | AI struggles to find relevant info | User writes one big paragraph of mixed info |
| **No post-specific context for templates** | Same reply for different products | A clothing store replies the same to shoes/bags posts |
| **Cache ignores knowledge base** | Cached reply from Page A used for Page B | Two pages get same cached reply |
| **Template matching is too simple** | Only exact keyword substring match | "price" matches but "how much" doesn't |
| **No feedback loop** | Bad replies keep repeating | User can't train the AI from mistakes |
| **No comment-thread context** | AI doesn't see other comments on same post | Repeats what was already said |
| **Fallback is too generic** | "Thank you for your comment!" adds no value | Customer asks a question, gets a thank you |
| **No intent classification** | AI treats all comments the same | Complaint handled same as compliment |

---

## Improvement Plan

### Phase 1: Structured Knowledge Base (HIGH IMPACT)

**Goal:** Help users provide better business info so AI gives accurate answers.

#### 1.1 Guided Knowledge Base Input
**Files:** `frontend/src/pages/pages.tsx`, `backend/src/utils/validation.ts`

Instead of one big textarea, guide users with structured sections:

```
Business Name: [text]
Business Type: [dropdown: restaurant, shop, clinic, school, services, other]
Working Hours: [time pickers]
Location/Address: [text]
Phone/WhatsApp: [text]

Products/Services: (repeatable section)
  - Name: [text]
  - Price: [text]
  - Description: [text]
  - Availability: [in stock / out of stock / on request]

FAQ: (repeatable section)
  - Question: [text]
  - Answer: [text]

Policies:
  - Return Policy: [text]
  - Delivery: [text]
  - Payment Methods: [text]

Important Notes: [textarea - anything else the AI should know]
```

The structured data gets converted to a formatted knowledge base string for the AI prompt. This way:
- Users don't forget important info
- AI has clearly labeled sections to reference
- Prices/availability are explicit → fewer hallucinations

#### 1.2 Knowledge Base Validation
**Files:** `backend/src/utils/validation.ts`, `ai-worker/src/services/openai.ts`

- Warn users if knowledge base is empty (AI will give generic replies)
- Warn if no prices listed but business sells products
- Show "AI readiness score" based on completeness

---

### Phase 2: Smarter Prompt Engineering (HIGH IMPACT)

**Goal:** Make the AI understand what type of comment it's responding to.

#### 2.1 Intent-Aware System Prompt
**File:** `ai-worker/src/services/openai.ts`

Update `buildSystemPrompt()` to classify and respond differently:

```
Before responding, identify the intent:
1. QUESTION (about product/service/price/hours) → Answer from BUSINESS INFORMATION
2. COMPLIMENT/POSITIVE → Thank warmly, mention appreciation
3. COMPLAINT/NEGATIVE → Apologize, acknowledge, offer resolution
4. PURCHASE INTENT ("I want to buy", "how to order") → Guide to order/contact
5. SPAM/IRRELEVANT → Do not respond (return empty)
6. GREETING ("hello", "hi") → Greet back briefly
7. REQUEST (specific action needed) → Acknowledge and redirect to human

For QUESTION intent:
- Search the BUSINESS INFORMATION section thoroughly
- If the answer exists there, provide it confidently
- If NOT found, say "I'll check with the team and get back to you"
- NEVER guess or assume information not in BUSINESS INFORMATION
```

#### 2.2 Post-Aware Replies
**File:** `backend/src/services/reply/generator.ts`

The post content is already fetched but underutilized. Enhance the user prompt:

```
Post Content: "New collection! Check out our leather bags starting from $50"
Comment: "Do you have black?"

→ AI knows this is about leather bags, can answer about colors
```

#### 2.3 Better Arabic Dialect Handling
**File:** `ai-worker/src/services/openai.ts`

Current: Simple regex detection
Improve: Add dialect hints to prompt based on page location/settings

```
- If page is Syrian business → Default to Levantine/Syrian Arabic
- Add setting: "Preferred reply dialect" (Syrian, Egyptian, Gulf, Formal)
- Include dialect examples in system prompt
```

---

### Phase 3: Smarter Template Matching (MEDIUM IMPACT)

**Goal:** Catch more comments with templates before using AI (cheaper + predictable).

#### 3.1 Fuzzy/Semantic Keyword Matching
**File:** `backend/src/services/rules.ts`

Current `findMatchingRule()` uses exact substring match. Improve:

```typescript
// Current (weak)
lowerComment.includes(keyword.toLowerCase())

// Improved options:
// A) Synonym groups: "price" also matches "cost", "how much", "كم السعر"
// B) Word boundary matching: "price" won't match "surprise"
// C) Arabic normalization: remove tashkeel, normalize hamza/alef
```

#### 3.2 Auto-Suggest Templates from AI Replies
**File:** New feature

When AI generates a reply that gets positive feedback:
- Suggest saving it as a template
- Extract keywords automatically
- User confirms and saves

---

### Phase 4: Feedback Loop (MEDIUM IMPACT)

**Goal:** Let users train the AI by marking good/bad replies.

#### 4.1 Reply Quality Tracking
**Files:** `backend/src/db/schema.ts`, `backend/src/services/comments.ts`

The frontend already has feedback UI (`submitFeedback`). Use it to:
- Track positive/negative per knowledge base configuration
- When a reply gets negative feedback → exclude from cache
- Show "AI accuracy rate" in dashboard

#### 4.2 Bad Reply → Knowledge Base Gap Detection
When a reply is marked negative:
- Log the question + bad reply
- Show user: "Your customer asked about X but your knowledge base doesn't cover it"
- Prompt user to add the missing info

---

### Phase 5: Enhanced Safety (HIGH IMPACT)

**Goal:** Prevent harmful or incorrect AI replies from reaching customers.

#### 5.1 Extended Safety Rules
**File:** `ai-worker/src/services/openai.ts`

Add to CRITICAL SAFETY RULES:

```
- NEVER promise refunds, exchanges, or returns unless policy is in BUSINESS INFORMATION
- NEVER provide medical, legal, or financial advice
- NEVER share personal data (phone numbers, emails) unless in BUSINESS INFORMATION
- NEVER commit to specific delivery times unless in BUSINESS INFORMATION
- NEVER make promises the business can't keep ("guaranteed", "always available")
- If a customer seems angry or threatens: only apologize and offer human contact
- For complaints about product defects: acknowledge concern + redirect to support
```

#### 5.2 Confidence-Based Human Handoff
**File:** `ai-worker/src/services/openai.ts`

Ask AI to self-rate confidence:

```
After generating your reply, rate your confidence:
- HIGH: Answer is clearly supported by BUSINESS INFORMATION
- MEDIUM: Answer is partially supported, some inference needed
- LOW: Answer requires information not in BUSINESS INFORMATION

If LOW confidence: Reply with "Thank you for your question!
Let me check with the team and get back to you shortly."
```

#### 5.3 Flagging System
**Files:** `backend/src/db/schema.ts`, `backend/src/services/reply/index.ts`

- Flag replies that contain money amounts not in knowledge base
- Flag replies to angry/complaint comments for human review
- Dashboard notification: "3 replies flagged for review"

---

### Phase 6: Cache Improvements (LOW IMPACT)

#### 6.1 Context-Aware Caching
**File:** `backend/src/services/ai.ts`

Current cache key: `hash(normalized_comment + language)`
Problem: Same question gets same cached reply regardless of page/business

Fix: Include page ID or knowledge base hash in cache key:
```typescript
const key = `${normalized}:${language}:${pageId}`;
```

---

## Implementation Priority

| Phase | Impact | Effort | Priority |
|-------|--------|--------|----------|
| Phase 1: Structured Knowledge Base | HIGH | Medium | 1st |
| Phase 2: Smarter Prompts | HIGH | Low | 2nd |
| Phase 5: Enhanced Safety | HIGH | Low | 3rd |
| Phase 3: Better Templates | MEDIUM | Medium | 4th |
| Phase 4: Feedback Loop | MEDIUM | High | 5th |
| Phase 6: Cache Fix | LOW | Low | 6th |

## Quick Wins (can do now)

1. **Update safety rules** in `openai.ts` → 30 min
2. **Add intent classification** to system prompt → 30 min
3. **Fix cache key** to include pageId → 15 min
4. **Better fallback messages** per language → 15 min
5. **Add confidence self-rating** to prompt → 30 min
