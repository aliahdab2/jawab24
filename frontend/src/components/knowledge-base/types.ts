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
// 18 custom + 2 fixed presets (products, notes) = 20 total sections. Content is
// still bounded by MAX_LENGTH (16000 chars) in KnowledgeBaseModal — sections only
// organise that budget, so raising this count doesn't grow the KB/prompt size.
export const MAX_CUSTOM_SECTIONS = 18;

export interface KbGap {
  id: string;
  queryText: string;
  occurrenceCount: number;
  sourceType?: 'comment' | 'dm' | null;
  sourceContext?: string | null;
}

/**
 * Catalog-detection warnings returned by the KB save endpoint when the raw
 * text contains a price list. Mirrors the shared `CatalogDetection` shape
 * (packages/shared/src/kbContentClassifier.ts).
 */
export type KbCatalogReason = 'price_list';

export interface KbWarnings {
  hasCatalog: boolean;
  reasons: KbCatalogReason[];
  priceCount: number;
}

/**
 * Result of a KB save as seen by the editor panel, discriminated on `ok`.
 * Flows that continue PAST the save (the live-notice catalog CTA persists the
 * editor text before handing off to the import sheet) must tell a failed save
 * apart from a successful one with no warnings — both used to resolve
 * `undefined`, which made "save, then proceed" impossible to gate.
 */
export type SaveKbOutcome =
  | { ok: true; kbWarnings?: KbWarnings }
  | { ok: false };

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
