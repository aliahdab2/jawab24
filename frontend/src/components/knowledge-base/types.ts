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
export const MAX_CUSTOM_SECTIONS = 5;

export interface KnowledgeSection {
  id: SectionId;
  content: string;
  title?: string; // User-provided title for custom sections
}

export interface SectionConfig {
  id: PresetSectionId;
  emoji: string;
  titleKey: string;
  descKey: string;
  placeholderKey: string;
}

/** Ordered list of preset section configs (2 core sections) */
export const SECTION_CONFIGS: SectionConfig[] = [
  { id: 'products', emoji: '💰', titleKey: 'kb.section.products', descKey: 'kb.section.products.desc', placeholderKey: 'kb.section.products.placeholder' },
  { id: 'notes',    emoji: '📝', titleKey: 'kb.section.notes',    descKey: 'kb.section.notes.desc',    placeholderKey: 'kb.section.notes.placeholder' },
];

/** Map emoji → presetSectionId */
export const EMOJI_TO_SECTION: Record<string, PresetSectionId> = {
  '💰': 'products',
  '📝': 'notes',
  // Legacy markers (previously contact/location) → all map to notes now
  '📱': 'notes',
  '📍': 'notes',
  '⏰': 'notes',
  '🏷️': 'notes',
  '📞': 'notes',
  '🌐': 'notes',
};

/** Map presetSectionId → label used in stored text */
export const SECTION_LABELS: Record<PresetSectionId, { en: string; ar: string }> = {
  products: { en: 'Products & Services',  ar: 'المنتجات والخدمات' },
  notes:    { en: 'Other Notes',         ar: 'ملاحظات أخرى' },
};
