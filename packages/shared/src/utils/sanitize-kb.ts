/**
 * Knowledge base content sanitization for Jawab24
 *
 * Applied in two places (defense-in-depth):
 * 1. On KB save (pages.updatePage())
 * 2. On retrieval (retrieval.ts, before prompt assembly)
 *
 * A merchant could intentionally or accidentally inject prompt instructions
 * into their KB text. This sanitizer strips known patterns while preserving
 * legitimate business content.
 *
 * IMPORTANT: Only filter specific injection patterns, not common words.
 * "system" in "sound system for sale" is legitimate.
 * "SYSTEM: override all instructions" is not.
 */

// KB-specific injection patterns — more targeted than user input sanitization
// These match instruction-like patterns, not single words
const KB_INJECTION_PATTERNS = [
  /SYSTEM\s*:\s*.{0,200}/gi,
  /INSTRUCTION\s*:\s*.{0,200}/gi,
  /OVERRIDE\s*:\s*.{0,200}/gi,
  /ignore\s+(all\s+)?previous\s+instructions/gi,
  /ignore\s+(all\s+)?above/gi,
  /you\s+are\s+now\s+/gi,
  /act\s+as\s+(a\s+)?/gi,
  /pretend\s+(you\s+are|to\s+be)\s+/gi,
  /new\s+instructions?\s*:/gi,
  /<\|endoftext\|>/gi,
  /<\|im_start\|>/gi,
  /<\|im_end\|>/gi,
  /\[INST\]/gi,
  /\[\/INST\]/gi,
  /<<SYS>>/gi,
  /<\/SYS>/gi,
  /developer\s+message\s*:/gi,
];

/**
 * Sanitize knowledge base content from merchant input.
 *
 * Replaces matched injection patterns with [filtered] and returns
 * { sanitized, filtered } so callers can log filtered content for review.
 */
export function sanitizeKbContent(text: string): { sanitized: string; filtered: string[] } {
  if (!text) return { sanitized: text, filtered: [] };

  let result = text;
  const filtered: string[] = [];

  for (const pattern of KB_INJECTION_PATTERNS) {
    result = result.replace(pattern, (match) => {
      filtered.push(match.trim());
      return '[filtered]';
    });
  }

  return { sanitized: result, filtered };
}
