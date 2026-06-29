import { useTranslations } from 'next-intl';

/**
 * Returns a function that maps a raw `ai_usage_log` pipeline tag (e.g.
 * `comment_reply`, `lead_extraction`, `embedding_rag`) to a human-readable,
 * localized label. Falls back to the raw tag for any pipeline added on the
 * backend before a translation key exists.
 *
 * Single source for the pipeline labels (the `customer.aiCostPipeline_*` keys in
 * the `admin` namespace) so the per-customer AiSection and the global AI Cost
 * panel never duplicate the mapping.
 */
export function useAiPipelineLabel(): (pipeline: string) => string {
    const t = useTranslations('admin');
    return (pipeline: string) => {
        const key = `customer.aiCostPipeline_${pipeline}` as Parameters<typeof t>[0];
        return t.has(key) ? t(key) : pipeline;
    };
}
