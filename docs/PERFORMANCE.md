# Database Performance Guide

## Overview
This guide outlines best practices for maintaining database performance in the Jawab24 backend.

## 1. Indexes
Missing indexes are the #1 cause of dashboard slowness.

### Rule of Thumb
Any column used in a `WHERE`, `ORDER BY`, or `JOIN` clause likely needs an index.
- **Filtering**: `WHERE category = 'A'` -> Index on `category`
- **Sorting**: `ORDER BY created_at DESC` -> Index on `created_at`
- **Foreign Keys**: Index columns that reference other tables (e.g., `user_id`, `post_id`).

### How to Check
Use `EXPLAIN ANALYZE` to check if your query is using an index.
```sql
EXPLAIN ANALYZE SELECT * FROM messages WHERE page_id = '...' ORDER BY created_at DESC;
```
If you see `Seq Scan`, you are missing an index. If you see `Index Scan`, you are good.

## 2. CI/CD Checks
We use `drizzle-kit check` to ensure migration files match the schema definition.
Always run `npm run db:check` before committing schema changes.

## 3. Query Logging
In development (`NODE_ENV=development`), all queries are logged to the console. Watch these logs! If a simple page load triggers 100 queries, you have an N+1 problem.

## 4. Pagination
Always use cursor-based pagination for large datasets (like messages/comments). Offset pagination (`OFFSET 1000`) gets slower as the offset increases.

## 5. Sentry
Sentry Performance Monitoring is enabled. Check the Sentry dashboard for "Slow Transactions" to identify production bottlenecks.
