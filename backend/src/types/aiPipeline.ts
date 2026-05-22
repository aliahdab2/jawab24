/**
 * Identifies the source of an OpenAI call when written to ai_usage_log.
 *
 * Every row in ai_usage_log MUST set this so per-source cost is queryable:
 *   SELECT pipeline, SUM(cost_usd) FROM ai_usage_log GROUP BY pipeline;
 *
 * Adding a new pipeline: extend this union, then update every call site that
 * writes to ai_usage_log so the new tag is set explicitly (no NULLs).
 */
export type AiPipeline =
    | 'comment_reply'        // Webhook-driven comment reply (Facebook/Instagram)
    | 'dm_reply'             // Webhook-driven DM reply (Facebook Messenger/Instagram)
    | 'playground'           // Admin playground interactive testing
    | 'eval'                 // scripts/playground-eval.ts batch testing
    | 'embedding_rag'        // Embedding for KB retrieval (per-reply, hot path)
    | 'embedding_cache'      // Embedding for semantic cache lookup (per-reply, hot path)
    | 'embedding_ingestion'  // Embedding for KB ingestion (one-off batch on KB upload)
    | 'translation'          // Away/greeting auto-translate or DM language mismatch
    | 'transcription'        // Voice DM transcription (whisper / gpt-4o-mini-transcribe)
    | 'lead_extraction'      // Lead extraction from conversations
    | 'kb_file_extraction'   // PDF/image OCR for KB ingestion
    | 'ecommerce_tools'      // Per-iteration call inside the e-commerce tool loop
    | 'catalog_tools'        // Per-iteration call inside the catalog tool loop (no e-commerce store linked)
    | 'failover'             // Fallback model after circuit breaker opened
    | 'unknown';             // Caller forgot to tag — surfaces in dashboard so we can fix it

/** Sources accepted by the playground HTTP endpoint; mapped 1:1 to a pipeline tag. */
export type PlaygroundSource = Extract<AiPipeline, 'playground' | 'eval'>;
