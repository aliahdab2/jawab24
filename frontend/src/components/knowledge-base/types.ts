export type PresetSectionId =
  | 'products'
  | 'notes';

export type CustomSectionId = `custom:${string}`;
export type SectionId = PresetSectionId | CustomSectionId;

export function isCustomSection(id: SectionId): id is CustomSectionId {
  return id.startsWith('custom:');
}

export function isPresetSection(id: SectionId): id is PresetSectionId {
  return !id.startsWith('custom:');
}

export const CUSTOM_SECTION_MARKER = '✦';
export const MAX_CUSTOM_SECTIONS = 8;

export interface KbGap {
  id: string;
  queryText: string;
  occurrenceCount: number;
  sourceType?: 'comment' | 'dm' | null;
  sourceContext?: string | null;
}

export interface KnowledgeSection {
  id: SectionId;
  content: string;
  title?: string; // User-provided title for custom sections
}

export type KbTitleKey = 'section.productsLabel' | 'section.notesLabel';
export type KbDescKey = 'section.productsDesc' | 'section.notesDesc';
export type KbPlaceholderKey = 'section.productsPlaceholder' | 'section.notesPlaceholder';

export interface SectionConfig {
  id: PresetSectionId;
  emoji: string;
  titleKey: KbTitleKey;
  descKey: KbDescKey;
  placeholderKey: KbPlaceholderKey;
}

/** Ordered list of preset section configs (2 core sections) */
export const SECTION_CONFIGS: SectionConfig[] = [
  { id: 'products', emoji: '💰', titleKey: 'section.productsLabel', descKey: 'section.productsDesc', placeholderKey: 'section.productsPlaceholder' },
  { id: 'notes',    emoji: '📝', titleKey: 'section.notesLabel',    descKey: 'section.notesDesc',    placeholderKey: 'section.notesPlaceholder' },
];

/** Map emoji → presetSectionId */
export const EMOJI_TO_SECTION: Record<string, PresetSectionId> = {
  '💰': 'products',
  '📝': 'notes',
};

/** Map presetSectionId → label used in stored text */
export const SECTION_LABELS: Record<PresetSectionId, { en: string; ar: string }> = {
  products: { en: 'Products & Services',  ar: 'المنتجات والخدمات' },
  notes:    { en: 'Other Notes',         ar: 'ملاحظات أخرى' },
};
