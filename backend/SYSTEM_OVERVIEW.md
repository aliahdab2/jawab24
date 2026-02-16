# Jawab24 V1 System Overview

This document serves as the technical reference for Jawab24 V1. It outlines the core philosophy, system architecture, decision logic, and safety mechanisms implemented to ensure a stable and safe auto-reply product.

## 1. Core Product Principles (The "Iron Rules")

- **🚫 No Guessing Ever**: The system never hallucinates prices, availability, or facts. If data is not explicitly provided (via template or settings), it falls back to a safe default or requests human intervention.
- **🛡️ Safety Over Flashy AI**: Reliability and account safety are prioritized over "creative" AI responses. We avoid spam triggers at all costs.
- **📢 No Silent Ignoring**: Every inbound interaction gets a result—either a reply or a "Needs Attention" flag. We never just drop a message.
- **👤 User Owns Content**: All replies are based on user-defined bounds.

## 2. System Architecture

The system is an event-driven loop triggered by social media webhooks.

### High-Level Flow

1.  **Inbound Webhook**: Facebook/Instagram notifies us of a Comment or Private Message.
2.  **Webhook Controller**: Validates the event, filters out echoes (own messages), and enqueues/processes the event.
3.  **Decision Engine**: Determines _what_ to reply (`reply.ts`).
4.  **Protection Layer**: Determines _if_ safe to reply (`ProtectionService`).
5.  **Execution**: Sends the reply via Graph API and updates the Database.

## 3. The Decision Engine

Located in `src/services/reply/generator.ts`, orchestrated by `messageProcessor.ts` (DMs) and `commentProcessor.ts` (comments).

### 3.1 DM Pipeline (`messageProcessor.ts`)

| Step | Name | What it does |
|------|------|-------------|
| 1 | Validate page | Page exists, has user, auto-reply enabled |
| 2 | Check platform auto-reply | Page-level toggle |
| 3 | Fetch sender name | Best-effort Graph API call |
| 4 | Store incoming message | Persist to DB |
| 5 | Debounce | Skip if newer unreplied message from same sender |
| 6 | Handoff pause | Skip if human replied manually in last 30 min |
| 7 | Rate limit | Per-sender velocity check |
| 8 | User settings | Check messages auto-reply enabled; send away message if not |
| 9 | Already replied | Skip duplicates |
| 9b | Greeting message | Send greeting for new conversations |
| 10 | Reply delay | User-configured delay |
| 11 | Consolidate | Gather all unreplied messages from sender |
| 12 | Generate reply | Template match first, then AI (see 3.2) |
| 13 | Send reply | Graph API call |
| 14-16 | Post-reply | Mark replied, store outgoing, mark older messages |
| 17 | Notify | Push notification if flagged |

### 3.2 Reply Generation Priority (The "Stack")

Located in `src/services/reply/generator.ts`.

1.  **Rule Matching** (Highest Priority):
    - _Keyword Match?_ -> Use specific Template (e.g., "shipping" -> Shipping Template). Stop.
    - **Important:** Template matching uses only the _latest_ message text, not the full consolidated text. This prevents stale unreplied messages from hijacking the user's current intent.
2.  **AI Reply** (Fallback):
    - _AI Enabled?_ -> Generate reply using strict prompt (No hallucination).
    - AI receives the _full consolidated text_ for conversation context.
    - _Guardrail Failed?_ -> Fallback to Safe Default.
3.  **Default Fallback**:
    - If all above fail -> Send generic "Thanks for contacting us" message.

### 3.3 Message Consolidation

When multiple unreplied messages exist from the same sender (e.g., rapid-fire messages, or messages that arrived during a handoff pause), the pipeline consolidates them:

- **Template matching** uses the **latest message only** (reflects current intent)
- **AI context** uses **all unreplied messages joined** (gives full conversation history)
- After replying, all older unreplied messages are marked as replied (Step 16)

## 4. The Protection Layer (V1)

Located in `src/services/reply.ts` (or `src/services/protection.ts`). This layer intercepts the "Final Reply" before it is sent.

### 4.1 Anti-Duplicate Guard

- **Goal**: Prevent sending the exact same text repeatedly to the same user/post (spam trigger).
- **Mechanism**:
  - Hash the intended reply text (SHA256).
  - Check Redis key: `dup:page:{id}:post:{id}:hash:{hash}` (TTL 24h).
  - _Hit?_ -> Block original reply. Send a **Protective Short Reply** instead (e.g., "Noted ✅", "Received").

### 4.2 Rate Limiting & Jitter

- **Goal**: Mimic human behavior and avoid platform rate limits.
- **Mechanism**:
  - Check Redis Counter: `rate:page:{id}:min:{timestamp}`.
  - _Exceeds 30/min?_ -> Add random **Jitter** (delay 5-25s) or switch to short replies.
  - _Exceeds Hard Limit?_ -> Stop replying to protect page. Log "Needs Attention".

### 4.3 Public Reply Shortening

- **Goal**: keep comments clean and drive traffic to DMs.
- **Rule**:
  - Public comments are capped at ~160 chars.
  - URLs are removed (replaced with "Link in DM 📩").
  - If `Mode = Comment + DM`: Public reply is just a "Soft Redirect" (e.g., "Check your DMs 📩").

### 4.4 Messenger Safety Rule

- **Goal**: Never ignore a user DM even if automation is off.
- **Mechanism**:
  - If User disables "Message Automation":
  - System sends **ONE** mandatory acknowledgement: "Thanks! We'll get back to you soon."
  - Flags the conversation as "Needs Attention" in the dashboard.
  - Uses Redis to ensure this only happens once per 24h per user (`dm:autoack:{pageId}:{userId}`).

## 5. Data & State Management

### Redis Keys (V1)

| Key Pattern                    | TTL | Purpose                          |
| :----------------------------- | :-- | :------------------------------- |
| `dup:page:{id}:post:{id}:hash` | 24h | Anti-duplicate hashing           |
| `rate:page:{id}:min:{ts}`      | 2m  | Rate limiting counter            |
| `dm:autoack:{pageId}:{userId}` | 24h | Prevent spamming mandatory acks  |
| `cache:ai_reply:{hash}`        | 30d | Cache AI responses (performance) |

### "Needs Attention" Flags

Items requiring human review are flagged in the DB (`comments` / `messages` tables).

- **Reasons**:
  - `MESSENGER_DISABLED`: User turned off bot, but someone messaged.
  - `SEND_FAILED`: Graph API error.
  - `AI_FAILED`: AI tried to guess a price/fact (blocked by guardrail).
  - `RATE_LIMITED`: Velocity filters kicked in.
