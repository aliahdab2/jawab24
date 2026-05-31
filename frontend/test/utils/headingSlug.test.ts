import { describe, it, expect } from 'vitest';
import { slugify } from '@/utils/headingSlug';

describe('slugify (blog heading anchors)', () => {
  it('slugifies English headings (backward compatible)', () => {
    expect(slugify('How It Works')).toBe('how-it-works');
    expect(slugify('Top 5 Auto-Reply Tips')).toBe('top-5-auto-reply-tips');
    expect(slugify('**Bold Heading**')).toBe('bold-heading');
    expect(slugify('snake_case_kept')).toBe('snake_case_kept');
  });

  it('preserves Arabic letters instead of collapsing to "-" (the bug)', () => {
    const slug = slugify('كيف يعمل جواب24');
    expect(slug).toBe('كيف-يعمل-جواب24');
    expect(slug).not.toBe('-');
    expect(slug).not.toBe('');
  });

  it('gives distinct Arabic headings distinct anchors', () => {
    const a = slugify('ما هو جواب24');
    const b = slugify('كيف يعمل');
    expect(a).not.toBe(b);
    // Regression guard: neither collapses to the empty/"-" slug.
    expect([a, b].every((s) => s.length > 1 && s !== '-')).toBe(true);
  });

  it('strips punctuation and tashkeel but keeps the Arabic letters', () => {
    expect(slugify('ما هي المميزات؟')).toBe('ما-هي-المميزات');
    // Combining marks (shadda/harakat) are dropped for diacritic-insensitive,
    // stable anchors — the same word slugs identically with or without tashkeel.
    expect(slugify('الأسعار: كم تكلّف؟')).toBe('الأسعار-كم-تكلف');
  });

  it('falls back to a stable hash for symbol/emoji-only headings', () => {
    const a = slugify('🚀🚀🚀');
    const b = slugify('🚀🚀🚀');
    expect(a).toMatch(/^section-[a-z0-9]+$/);
    expect(a).toBe(b); // deterministic
    expect(slugify('★')).not.toBe(a); // different input → different id
  });

  it('is idempotent / stable for the same input', () => {
    const h = 'إعداد الردود التلقائية على فيسبوك';
    expect(slugify(h)).toBe(slugify(h));
  });
});
