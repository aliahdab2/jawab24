import { describe, it, expect } from 'vitest';
import type { PostSuggestionResponse } from '@/lib/api';
import { mergePostSuggestionResponse } from './mergeResponse';

const POST = {
  id: 's1',
  status: 'ready' as const,
  text: 'منشور',
  imageUrl: null,
  variants: [{ text: 'منشور', headline: null, imageUrl: null }],
  selectedVariant: 0,
  postType: 'general' as const,
  source: 'manual' as const,
  suggestedFor: '2026-08-13',
  createdAt: '2026-08-13T08:00:00Z',
};
const EARLIER = [{
  id: 'old1', text: 'منشور سابق', imageUrl: null, postType: 'general' as const, createdAt: '2026-08-11T08:00:00Z',
}];

const READ: PostSuggestionResponse = { suggestion: POST, remainingToday: 2, history: EARLIER };

describe('mergePostSuggestionResponse — absent history is not empty history', () => {
  it('⭐ keeps the cached earlier posts when the incoming response carries none', () => {
    // The generate route answers with a row that is still pending, so it never
    // sends `history`. Replacing the cache entry wholesale erased the strip.
    const generated: PostSuggestionResponse = {
      suggestion: POST,
      inFlight: { id: 's2', status: 'pending' },
      remainingToday: 1,
    };
    expect(mergePostSuggestionResponse(READ, generated).history).toEqual(EARLIER);
  });

  it('an EMPTY list overwrites — that is the read route saying "there are none"', () => {
    const emptied: PostSuggestionResponse = { suggestion: POST, remainingToday: 1, history: [] };
    expect(mergePostSuggestionResponse(READ, emptied).history).toEqual([]);
  });

  it('every other field comes from the incoming response, never the cached one', () => {
    const generated: PostSuggestionResponse = {
      suggestion: null,
      inFlight: { id: 's2', status: 'pending' },
      remainingToday: 0,
    };
    const merged = mergePostSuggestionResponse(READ, generated);
    expect(merged.suggestion).toBeNull();
    expect(merged.inFlight).toEqual({ id: 's2', status: 'pending' });
    expect(merged.remainingToday).toBe(0);
  });

  it('nothing cached yet is not an error — the response stands on its own', () => {
    expect(mergePostSuggestionResponse(undefined, { suggestion: null, remainingToday: 3 }))
      .toEqual({ suggestion: null, remainingToday: 3, history: undefined });
  });
});
