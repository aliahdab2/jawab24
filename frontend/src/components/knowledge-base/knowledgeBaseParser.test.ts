import { describe, it, expect } from 'vitest';
import { parseKnowledgeBase, serializeSections } from './knowledgeBaseParser';
import { SECTION_CONFIGS, EMOJI_TO_SECTION, CUSTOM_SECTION_MARKER } from './types';

/**
 * The serialized KB is a FILE FORMAT, not a view. Every merchant's
 * `pages.knowledge_base` carries these exact header bytes, the backend chunker
 * splits on them (`backend/src/services/kb/chunker.ts`), and the model reads
 * them verbatim inside `<business_knowledge>`. The card in the UI may show any
 * icon it likes (`SectionConfig.icon`); the marker written to disk must not
 * move. Mutation check: change `SECTION_CONFIGS[0].emoji` to any other
 * character and the first two tests fail.
 */
describe('knowledgeBaseParser — stored header bytes', () => {
  it('serializes the preset sections under the exact 💰 / 📝 headers', () => {
    const text = serializeSections([
      { id: 'products', content: 'معهد تدريب منذ 2015.' },
      { id: 'notes', content: 'الدفع عند الاستلام.' },
    ]);

    expect(text).toBe(
      '💰 المنتجات والخدمات:\nمعهد تدريب منذ 2015.\n\n📝 ملاحظات أخرى:\nالدفع عند الاستلام.',
    );
  });

  it('writes the same marker it reads — SECTION_CONFIGS.emoji and EMOJI_TO_SECTION agree', () => {
    for (const config of SECTION_CONFIGS) {
      expect(EMOJI_TO_SECTION[config.emoji]).toBe(config.id);
    }
    expect(Object.keys(EMOJI_TO_SECTION).sort()).toEqual(
      SECTION_CONFIGS.map((c) => c.emoji).sort(),
    );
  });

  it('round-trips a KB with preset, custom and un-marked preamble content', () => {
    const stored = [
      'نص قبل أي عنوان يذهب إلى الملاحظات.',
      '',
      '💰 المنتجات والخدمات:',
      'دورة اللغة الإنجليزية.',
      '',
      `${CUSTOM_SECTION_MARKER} الفروع:`,
      'دمشق — البرامكة',
      '',
      '📝 ملاحظات أخرى:',
      'Q: هل يوجد شهادات؟',
      'A: نعم، برسوم إضافية.',
    ].join('\n');

    const once = parseKnowledgeBase(stored);
    const twice = parseKnowledgeBase(serializeSections(once));

    expect(twice).toEqual(once);
    expect(once.find((s) => s.id === 'products')?.content).toBe('دورة اللغة الإنجليزية.');
    expect(once.find((s) => s.title === 'الفروع')?.content).toBe('دمشق — البرامكة');
    // The preamble is filed under notes, ahead of the notes section's own lines.
    expect(once.find((s) => s.id === 'notes')?.content).toContain('نص قبل أي عنوان');
    expect(once.find((s) => s.id === 'notes')?.content).toContain('A: نعم، برسوم إضافية.');
  });

  it('drops empty sections on serialize and re-creates them on parse', () => {
    const text = serializeSections([
      { id: 'products', content: '   ' },
      { id: 'notes', content: 'فقط ملاحظة.' },
    ]);

    expect(text).toBe('📝 ملاحظات أخرى:\nفقط ملاحظة.');
    expect(parseKnowledgeBase(text).map((s) => s.id)).toEqual(['products', 'notes']);
  });
});
