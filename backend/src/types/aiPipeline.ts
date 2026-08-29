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
    | 'image_understanding'  // Customer-sent DM image → text description (vision, gpt-4.1-mini)
    | 'operational_facts_extraction' // KB free-text → structured hours/address/phones (one-time backfill; on-save re-extraction is a deferred follow-up, not yet wired)
    | 'catalog_extraction'   // Pasted/uploaded free text → proposed catalog items (merchant-reviewed via /catalog import; never auto-saved)
    | 'grounding_verify'      // Post-send audit of a sent reply against Business Info; flags unsupported assertions into Needs Attention (pinned gpt-4.1-mini, fire-and-forget, never alters a reply)
    | 'business_info_audit'  // Merchant-pressed «تقييم» / admin audit: classifies Business Info instructions against the capability manifest (pinned gpt-4.1-mini, on-demand, cached on KB hash)
    | 'ecommerce_tools'      // Per-iteration call inside the e-commerce tool loop
    | 'cache_warm'           // Post-deploy re-warm: replays recent AI-replied comments through the playground path to repopulate the reply caches (scripts/warm-reply-cache.ts). Excluded from REPLY_PIPELINES so it can't distort prod hit-rate.
    | 'gender_name_backfill' // One-off name→gender classification seeding the v53 gender map (scripts/backfill-gender-map.ts)
    | 'gender_variant_transform' // Save-time addressee-gender rewrite for the dual-variant DM cache (services/genderVariantTransform.ts)
    | 'post_generation'      // «بوست اليوم» suggested-post TEXT (pinned gpt-4.1-mini, JSON mode; pilot gated by config.postSuggestions)
    | 'post_image_generation' // «بوست اليوم» suggested-post IMAGE (pinned gpt-image-2 via images.generate; ~100× the text cost — kept separate so per-pipeline cost stays readable)
    | 'post_cta_classification' // Once-per-post caption classification: does the post invite a symbol comment (dot/digits/word/heart/any)? Pinned gpt-4.1-mini, lazy on the first symbol comment, persisted on content_cta_classifications. NOT a reply — never counts toward the merchant's reply quota (D-111)
    | 'failover'             // Fallback model after circuit breaker opened
    | 'unknown';             // Caller forgot to tag — surfaces in dashboard so we can fix it

/** Sources accepted by the playground HTTP endpoint; mapped 1:1 to a pipeline tag. */
export type PlaygroundSource = Extract<AiPipeline, 'playground' | 'eval'>;

/**
 * Production reply pipelines — the only traffic that flows through the internal
 * reply cache (exact + semantic). A cache-hit rate is only meaningful measured
 * over these: every other pipeline (embeddings, translation, transcription,
 * lead extraction, …) can never produce a `cached=true` row, so blending them
 * into the denominator dilutes the rate into an uninterpretable number
 * (prod 2026-07: 54% on comment_reply read as "12%" blended).
 * 'playground' also passes through the cache but is admin test traffic, not
 * production replies, so it is deliberately excluded.
 */
export const REPLY_PIPELINES: readonly AiPipeline[] = ['comment_reply', 'dm_reply'];

/** True for rows whose pipeline participates in the internal reply cache. */
export function isReplyPipeline(pipeline: string | null): boolean {
    return (REPLY_PIPELINES as readonly string[]).includes(pipeline ?? '');
}
