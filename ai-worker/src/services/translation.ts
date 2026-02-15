import OpenAI from 'openai';
import { config } from '../config';
import * as Sentry from '@sentry/node';

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

  // Simple language detection (check for Arabic characters)
  private detectLanguage(text: string): 'ar' | 'en' {
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
    let detectedLanguage: 'ar' | 'en' | undefined;

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
    const langNames = { ar: 'Arabic', en: 'English' };
    const systemPrompt = `You are a professional translator. Translate the following text from ${langNames[sourceLang]} to ${langNames[targetLanguage]}. Maintain the tone, style, and any emojis. Return ONLY the translated text without any explanations.`;

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

export const translationService = new TranslationService();
