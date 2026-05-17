import axios from 'axios';
import { DEFAULT_AI_MODEL } from '@jawab24/shared';
import { config } from '../config';
import { tracedExternalCall } from '../utils/tracing';
import { logAiUsage } from './aiUsageLog';
import { recordAiAttempt, recordAiReturn, recordAiFailedBeforeLog } from '../lib/aiMetrics';

export interface TranslateRequest {
  text: string;
  sourceLanguage?: 'ar' | 'en' | 'auto';
  targetLanguage: 'ar' | 'en';
  /** Required when known so the AI cost lands in `ai_usage_log` against this user. */
  userId?: string;
  pageId?: string;
}

export interface TranslateResponse {
  translatedText: string;
  detectedLanguage?: 'ar' | 'en';
  tokensUsed: number;
  tokensIn?: number;
  tokensInCached?: number;
  tokensOut?: number;
  model?: string;
}

/**
 * Translate text via the AI Worker. Logs OpenAI usage to `ai_usage_log` with
 * `pipeline: 'translation'` when `userId` is provided.
 *
 * Follows the same pattern as the main reply path: ai-worker returns token
 * counts in the response; the backend (the only owner of the DB) writes the
 * cost row. Skipping the log when `userId` is missing keeps system-level
 * translation calls (if any are added) from polluting attribution.
 */
export async function translateText(request: TranslateRequest): Promise<TranslateResponse> {
  const { text, sourceLanguage, targetLanguage, userId, pageId } = request;

  try {
    recordAiAttempt('translation', DEFAULT_AI_MODEL);
    const response = await tracedExternalCall('translation', 'translate', () =>
      axios.post<TranslateResponse>(
        `${config.ai.serviceUrl}/translate`,
        {
          text,
          sourceLanguage: sourceLanguage || 'auto',
          targetLanguage,
          context: { pipeline: 'translation' },
        },
        { timeout: 30000 },
      ),
    );
    const data = response.data;
    recordAiReturn('translation', data.model || DEFAULT_AI_MODEL);

    if (userId) {
      logAiUsage({
        userId,
        pageId,
        model: data.model || DEFAULT_AI_MODEL,
        tokensIn: data.tokensIn ?? 0,
        cachedInputTokens: data.tokensInCached ?? 0,
        tokensOut: data.tokensOut ?? 0,
        cached: false,
        pipeline: 'translation',
      }).catch(() => { /* logged via Sentry breadcrumb inside logAiUsage */ });
    } else {
      recordAiFailedBeforeLog('translation', data.model || DEFAULT_AI_MODEL, 'MissingUserId');
    }

    return response.data;
  } catch (error) {
    if (axios.isAxiosError(error)) {
      throw new Error(`Translation failed: ${error.response?.data?.error || error.message}`);
    }
    throw new Error(`Translation failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

/**
 * Generate variations of a nudge message via AI Worker. Used to avoid
 * Facebook spam detection from identical repeated comments. Same logging
 * contract as `translateText` — pass `userId` to attribute cost.
 */
export async function generateNudgeVariations(
  text: string,
  language: string,
  count = 10,
  ctx?: { userId?: string; pageId?: string },
): Promise<string[]> {
  try {
    recordAiAttempt('translation', DEFAULT_AI_MODEL);
    const response = await tracedExternalCall('translation', 'generateVariations', () =>
      axios.post<{
        variations: string[];
        tokensUsed: number;
        tokensIn?: number;
        tokensInCached?: number;
        tokensOut?: number;
        model?: string;
      }>(
        `${config.ai.serviceUrl}/generate-variations`,
        { text, language, count, context: { pipeline: 'translation' } },
        { timeout: 30000 },
      ),
    );
    const data = response.data;
    recordAiReturn('translation', data.model || DEFAULT_AI_MODEL);

    if (ctx?.userId) {
      logAiUsage({
        userId: ctx.userId,
        pageId: ctx.pageId,
        model: data.model || DEFAULT_AI_MODEL,
        tokensIn: data.tokensIn ?? 0,
        cachedInputTokens: data.tokensInCached ?? 0,
        tokensOut: data.tokensOut ?? 0,
        cached: false,
        pipeline: 'translation',
      }).catch(() => { /* logged via Sentry breadcrumb inside logAiUsage */ });
    } else {
      recordAiFailedBeforeLog('translation', data.model || DEFAULT_AI_MODEL, 'MissingUserId');
    }

    return response.data.variations;
  } catch (error) {
    if (axios.isAxiosError(error)) {
      throw new Error(`Variation generation failed: ${error.response?.data?.error || error.message}`);
    }
    throw new Error(`Variation generation failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}
