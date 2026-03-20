import axios from 'axios';
import { config } from '../config';
import { tracedExternalCall } from '../utils/tracing';

export interface TranslateRequest {
  text: string;
  sourceLanguage?: 'ar' | 'en' | 'auto';
  targetLanguage: 'ar' | 'en';
}

export interface TranslateResponse {
  translatedText: string;
  detectedLanguage?: 'ar' | 'en';
  tokensUsed: number;
}

/**
 * Translate text using AI Worker service
 *
 * Follows industry-standard microservices pattern where all OpenAI operations
 * are centralized in the AI worker service, not scattered across backend.
 *
 * @param request - Translation request with text, source language, and target language
 * @returns Translation response with translated text, detected language, and token usage
 *
 * @example
 * const result = await translateText({
 *   text: 'مرحباً بك!',
 *   targetLanguage: 'en'
 * });
 * // Returns: { translatedText: 'Welcome!', detectedLanguage: 'ar', tokensUsed: 15 }
 */
/**
 * Generate variations of a nudge message via AI Worker.
 * Used to avoid Facebook spam detection from identical repeated comments.
 */
export async function generateNudgeVariations(
  text: string,
  language: string,
  count = 10,
): Promise<string[]> {
  try {
    const response = await tracedExternalCall('translation', 'generateVariations', () =>
      axios.post<{ variations: string[]; tokensUsed: number }>(
        `${config.ai.serviceUrl}/generate-variations`,
        { text, language, count },
        { timeout: 30000 },
      ),
    );
    return response.data.variations;
  } catch (error) {
    if (axios.isAxiosError(error)) {
      throw new Error(`Variation generation failed: ${error.response?.data?.error || error.message}`);
    }
    throw new Error(`Variation generation failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

export async function translateText(request: TranslateRequest): Promise<TranslateResponse> {
  const { text, sourceLanguage, targetLanguage } = request;

  try {
    const response = await tracedExternalCall('translation', 'translate', () =>
      axios.post<TranslateResponse>(
        `${config.ai.serviceUrl}/translate`,
        {
          text,
          sourceLanguage: sourceLanguage || 'auto',
          targetLanguage
        },
        { timeout: 30000 },
      ),
    );

    return response.data;
  } catch (error) {
    if (axios.isAxiosError(error)) {
      throw new Error(`Translation failed: ${error.response?.data?.error || error.message}`);
    }
    throw new Error(`Translation failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}
