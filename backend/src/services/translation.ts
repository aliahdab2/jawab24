import OpenAI from 'openai';
import { config } from '../config';
import { detectLanguage } from '../utils/language';

const openai = new OpenAI({ apiKey: config.openai.apiKey });

interface TranslateRequest {
  text: string;
  sourceLanguage?: 'ar' | 'en' | 'auto';
  targetLanguage: 'ar' | 'en';
}

interface TranslateResponse {
  translatedText: string;
  detectedLanguage?: 'ar' | 'en';
  tokensUsed: number;
}

/**
 * Translates text between Arabic and English using OpenAI GPT-4o-mini
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
  const { text, sourceLanguage = 'auto', targetLanguage } = request;

  // Detect source language if auto
  let detectedLang: 'ar' | 'en' = sourceLanguage === 'ar' ? 'ar' : 'en';
  if (sourceLanguage === 'auto') {
    const detection = detectLanguage(text);
    detectedLang = detection.language === 'ar' ? 'ar' : 'en';
  }

  // Skip if already in target language
  if (detectedLang === targetLanguage) {
    return {
      translatedText: text,
      detectedLanguage: detectedLang,
      tokensUsed: 0
    };
  }

  // Call OpenAI for translation
  const systemPrompt = `You are a professional translator. Translate the following text from ${detectedLang === 'ar' ? 'Arabic' : 'English'} to ${targetLanguage === 'ar' ? 'Arabic' : 'English'}. Maintain the tone, style, and any emojis. Return ONLY the translated text without any explanations.`;

  const response = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: text }
    ],
    temperature: 0.3, // Lower temperature for consistent translation
    max_tokens: 500
  });

  return {
    translatedText: response.choices[0].message.content || text,
    detectedLanguage: detectedLang,
    tokensUsed: response.usage?.total_tokens || 0
  };
}
