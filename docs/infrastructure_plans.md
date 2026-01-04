# Jawab24 Infrastructure Modernization Plan

This document outlines the roadmap for upgrading Jawab24's architecture to industry-standard patterns using Redis. These changes focus on scalability, performance, and reliability.

## 1. Centralized Rate Limiting (Redis)
**Status:** ✅ Partially Implemented (Backend API)

**Objective:**
Ensure strict, global rate limits across all services and instances (Blue/Green).

**Implementation:**
- **Backend**: *Completed*. Uses `ioredis` with `@fastify/rate-limit`.
- **AI Worker**:
  - **Current**: In-memory (per container).
  - **Action**: Update `ai-worker/src/index.ts` to use shared Redis instance.
  - **Benefit**: Prevents abuse even if attackers rotate across different worker instances.

## 2. Distributed Caching (Redis)
**Status:** ⚠️ Pending (Currently using Postgres `ai_cache`)

**Objective:**
Offload high-volume read operations from the primary database to an in-memory store.

**Implementation:**
- **Key Strategy**: Store AI replies in Redis instead of Postgres.
- **Key Format**: `cache:ai_reply:{hash}` (SHA256 of comment + language).
- **TTL (Time-To-Live)**: Set to 30 days to automatically prune old data.
- **Code Changes**:
  - Update `backend/src/services/ai.ts` to check Redis before Postgres.
  - Use `read-through` or `write-through` caching pattern.

## 3. Asynchronous Job Queues (BullMQ)
**Status:** ⚠️ Pending (Currently Synchronous HTTP)

**Objective:**
Decouple user requests from long-running AI tasks. Prevent timeouts and lost requests.

**Implementation:**
- **Tool**: [BullMQ](https://docs.bullmq.io/) (Robust Redis-based queue).
- **Architecture**:
  1. **Producer (Backend)**:
     ```typescript
     await aiQueue.add('generate-reply', { commentId, text });
     return reply.send({ status: 'queued' });
     ```
  2. **Consumer (AI Worker)**:
     ```typescript
     new Worker('ai-queue', async job => {
         const result = await openai.generate(job.data.text);
         await updateCommentInDb(job.data.commentId, result);
     });
     ```
- **Benefit**:
  - **Reliability**: Jobs are retried automatically if AI service fails.
  - **Speed**: User gets an instant response; UI shows a "Generating..." state.
  - **Scalability**: Can run 10+ AI workers in parallel to drain the queue during traffic spikes.

## 4. Session Management (Redis)
**Status:** ℹ️ Optional (Currently Stateless JWT)

**Objective:**
Add security controls like "Force Logout" and "Active Devices".

**Implementation:**
- Store a whitelist of active JWT `jti` (IDs) in Redis with an expiration matching the token.
- On logout, delete the ID from Redis.
- Middleware checks Redis existence before authorizing.

---

**Next Steps:**
1. Complete AI Worker Rate Limiting migration.
2. Prototype BullMQ integration for `generate-reply` flow.
