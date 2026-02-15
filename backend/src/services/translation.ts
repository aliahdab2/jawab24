import axios from 'axios';
import { config } from '../config';

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
export async function translateText(request: TranslateRequest): Promise<TranslateResponse> {
  const { text, sourceLanguage, targetLanguage } = request;

  try {
    const response = await axios.post<TranslateResponse>(
      `${config.ai.serviceUrl}/translate`,
      {
        text,
        sourceLanguage: sourceLanguage || 'auto',
        targetLanguage
      },
      { timeout: 30000 } // 30 second timeout
    );

    return response.data;
  } catch (error) {
    if (axios.isAxiosError(error)) {
      throw new Error(`Translation failed: ${error.response?.data?.error || error.message}`);
    }
    throw new Error(`Translation failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}
