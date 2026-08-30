import {
  type KnowledgeSection,
  type PresetSectionId,
  type CustomSectionId,
  SECTION_CONFIGS,
  EMOJI_TO_SECTION,
  SECTION_LABELS,
  CUSTOM_SECTION_MARKER,
  isCustomSection,
} from './types';

// --- Detection result types ---

type DetectResult =
  | { type: 'preset'; sectionId: PresetSectionId; remainingContent: string }
  | { type: 'custom'; title: string; remainingContent: string }
  | null;

/**
 * Parse a knowledge base text string into structured sections.
 * Detects emoji markers and ✦ custom markers at the start of lines.
 * Text before any marker (or with no markers at all) goes into "notes".
 */
export function parseKnowledgeBase(text: string): KnowledgeSection[] {
  // Start with empty preset sections
  const presetMap: Record<PresetSectionId, string[]> = {
    products: [],
    notes: [],
  };

  const customSections: Array<{ title: string; lines: string[] }> = [];

  if (!text || !text.trim()) {
    return toSectionsArray(presetMap, []);
  }

  const lines = text.split('\n');
  let currentTarget: { type: 'preset'; id: PresetSectionId } | { type: 'custom'; index: number } =
    { type: 'preset', id: 'notes' };

  for (const line of lines) {
    const detected = detectSectionFromLine(line);

    if (detected) {
      if (detected.type === 'preset') {
        currentTarget = { type: 'preset', id: detected.sectionId };
        if (detected.remainingContent.trim()) {
          presetMap[detected.sectionId].push(detected.remainingContent);
        }
      } else {
        // Custom section detected
        customSections.push({ title: detected.title, lines: [] });
        currentTarget = { type: 'custom', index: customSections.length - 1 };
        if (detected.remainingContent.trim()) {
          customSections[customSections.length - 1].lines.push(detected.remainingContent);
        }
      }
    } else {
      // Append line to current target
      if (currentTarget.type === 'preset') {
        presetMap[currentTarget.id].push(line);
      } else {
        customSections[currentTarget.index].lines.push(line);
      }
    }
  }

  return toSectionsArray(presetMap, customSections);
}

/**
 * Serialize structured sections back into a formatted text string.
 * Only includes non-empty sections.
 */
export function serializeSections(sections: KnowledgeSection[]): string {
  return sections
    .filter((s) => s.content.trim().length > 0)
    .map((s) => {
      if (isCustomSection(s.id)) {
        const title = s.title?.trim() || 'Section';
        return `${CUSTOM_SECTION_MARKER} ${title}:\n${s.content.trim()}`;
      }
      // Preset section
      const config = SECTION_CONFIGS.find((c) => c.id === s.id);
      const emoji = config?.emoji || '📝';
      const presetId = s.id as PresetSectionId;
      const label = SECTION_LABELS[presetId]?.ar || SECTION_LABELS[presetId]?.en || s.id;
      return `${emoji} ${label}:\n${s.content.trim()}`;
    })
    .join('\n\n');
}

/**
 * Get the total character count across all sections.
 */
export function getTotalCharCount(sections: KnowledgeSection[]): number {
  return serializeSections(sections).length;
}

// --- Internal helpers ---

function toSectionsArray(
  presetMap: Record<PresetSectionId, string[]>,
  customSections: Array<{ title: string; lines: string[] }>
): KnowledgeSection[] {
  // Preset sections in defined order
  const presets: KnowledgeSection[] = SECTION_CONFIGS.map((config) => ({
    id: config.id,
    content: presetMap[config.id].join('\n').trim(),
  }));

  // Custom sections in order they appeared
  const customs: KnowledgeSection[] = customSections.map((cs, i) => ({
    id: `custom:${Date.now()}_${i}` as CustomSectionId,
    content: cs.lines.join('\n').trim(),
    title: cs.title,
  }));

  return [...presets, ...customs];
}

/**
 * Check if a line starts with a known emoji marker or the custom ✦ marker.
 */
function detectSectionFromLine(line: string): DetectResult {
  const trimmed = line.trimStart();
  if (!trimmed) return null;

  // Check for custom section marker (✦)
  if (trimmed.startsWith(CUSTOM_SECTION_MARKER)) {
    let rest = trimmed.slice(CUSTOM_SECTION_MARKER.length).trimStart();
    const colonIdx = rest.indexOf(':');
    if (colonIdx !== -1 && colonIdx < 60) {
      const title = rest.slice(0, colonIdx).trim();
      rest = rest.slice(colonIdx + 1).trimStart();
      if (title) {
        return { type: 'custom', title, remainingContent: rest };
      }
    }
    // No colon or no title -- treat as content, not a section marker
    return null;
  }

  // Check each known preset emoji (some are multi-codepoint like 🏷️)
  for (const [emoji, sectionId] of Object.entries(EMOJI_TO_SECTION)) {
    if (trimmed.startsWith(emoji)) {
      let rest = trimmed.slice(emoji.length).trimStart();

      // Remove optional label text followed by colon
      const colonIdx = rest.indexOf(':');
      if (colonIdx !== -1 && colonIdx < 40) {
        rest = rest.slice(colonIdx + 1).trimStart();
      }

      return { type: 'preset', sectionId, remainingContent: rest };
    }
  }

  return null;
}
