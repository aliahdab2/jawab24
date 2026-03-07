import OpenAI from 'openai';
import { config } from '../config';
import * as Sentry from '@sentry/node';

export interface TranslateRequest {
  text: string;
  sourceLanguage?: string;
  targetLanguage: string;
}

export interface TranslateResponse {
  translatedText: string;
  detectedLanguage?: string;
  tokensUsed: number;
}

export class TranslationService {
  private client: OpenAI | null = null;

  constructor() {
    if (config.openai.apiKey) {
      this.client = new OpenAI({ apiKey: config.openai.apiKey });
    }
  }

  isConfigured(): boolean {
    return this.client !== null;
  }

  getClient(): OpenAI {
    if (!this.client) throw new Error('OPENAI_API_KEY is not configured');
    return this.client;
  }

  // Simple language detection (check for Arabic characters)
  private detectLanguage(text: string): string {
    const arabicPattern = /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/;
    return arabicPattern.test(text) ? 'ar' : 'en';
  }

  async translate(request: TranslateRequest): Promise<TranslateResponse> {
    if (!this.client) {
      throw new Error('OPENAI_API_KEY is not configured — cannot perform translation');
    }

    const { text, sourceLanguage, targetLanguage } = request;

    // Auto-detect source language if needed
    let sourceLang = sourceLanguage;
    let detectedLanguage: string | undefined;

    if (sourceLang === 'auto' || !sourceLang) {
      sourceLang = this.detectLanguage(text);
      detectedLanguage = sourceLang;
    }

    // Skip translation if already in target language
    if (sourceLang === targetLanguage) {
      return {
        translatedText: text,
        detectedLanguage,
        tokensUsed: 0
      };
    }

    // Build prompt
    const langNames: Record<string, string> = { ar: 'Arabic', en: 'English' };
    const sourceName = langNames[sourceLang] ?? sourceLang;
    const targetName = langNames[targetLanguage] ?? targetLanguage;
    const systemPrompt = `You are a professional translator. Translate the following text from ${sourceName} to ${targetName}. Maintain the tone, style, and any emojis. Return ONLY the translated text without any explanations.`;

    try {
      const completion = await this.client.chat.completions.create({
        model: config.openai.model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: text }
        ],
        temperature: 0.3,
        max_tokens: 300
      });

      const translatedText = completion.choices[0]?.message?.content?.trim() || '';
      const tokensUsed = completion.usage?.total_tokens || 0;

      return {
        translatedText,
        detectedLanguage,
        tokensUsed
      };
    } catch (error) {
      Sentry.captureException(error, {
        extra: { text: text.substring(0, 100), sourceLang, targetLanguage }
      });
      throw new Error(`Translation failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }
}

/**
 * Generate natural variations of a short message (for anti-spam rotation).
 * Returns an array of ~10 variations in the same language.
 */
export async function generateNudgeVariations(
  text: string,
  language: string,
  count = 10,
): Promise<{ variations: string[]; tokensUsed: number }> {
  const client = translationService.getClient();

  const langLabel = language === 'ar' ? 'Arabic' : 'English';
  const systemPrompt = [
    `You generate ${count} natural variations of a short social-media comment.`,
    `Language: ${langLabel}. Keep the same meaning and tone.`,
    'Each variation must be under 80 characters.',
    'Keep any emojis or swap them for similar ones.',
    `Return ONLY a JSON array of ${count} strings — no markdown, no explanation.`,
  ].join(' ');

  const completion = await client.chat.completions.create({
    model: config.openai.model,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: text },
    ],
    temperature: 0.9,
    max_tokens: 800,
  });

  const raw = completion.choices[0]?.message?.content?.trim() || '[]';
  const tokensUsed = completion.usage?.total_tokens || 0;

  // Parse JSON array — strip markdown fences if present
  const cleaned = raw.replace(/^```(?:json)?\s*/, '').replace(/\s*```$/, '');
  let variations: string[];
  try {
    variations = JSON.parse(cleaned);
    if (!Array.isArray(variations)) throw new Error('Not an array');
    variations = variations
      .filter((v): v is string => typeof v === 'string' && v.trim().length > 0)
      .map(v => v.slice(0, 80));
  } catch {
    // Fallback: return original text as sole variation
    variations = [text];
  }

  return { variations, tokensUsed };
}

export const translationService = new TranslationService();
