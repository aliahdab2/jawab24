/**
 * User input sanitization for Jawab24
 *
 * Applied to customer messages/comments before prompt assembly.
 * Strips known prompt injection patterns while preserving legitimate content.
 */

const MAX_INPUT_LENGTH = 2000;

// Known prompt injection patterns (case-insensitive)
const INJECTION_PATTERNS = [
  /ignore\s+(all\s+)?previous\s+instructions/gi,
  /ignore\s+(all\s+)?above/gi,
  /you\s+are\s+now\s+/gi,
  /act\s+as\s+(a\s+)?/gi,
  /pretend\s+(you\s+are|to\s+be)\s+/gi,
  /new\s+instructions?\s*:/gi,
  /system\s*:\s*/gi,
  /assistant\s*:\s*/gi,
  /developer\s+message\s*:/gi,
  /<\|endoftext\|>/gi,
  /<\|im_start\|>/gi,
  /<\|im_end\|>/gi,
  /\[INST\]/gi,
  /\[\/INST\]/gi,
  /<<SYS>>/gi,
  /<\/SYS>/gi,
];

// HTML tag pattern
const HTML_TAGS_RE = /<[^>]+>/g;

/**
 * Sanitize user input (customer messages/comments) before AI processing.
 *
 * - Strips known prompt injection patterns
 * - Removes HTML tags
 * - Caps length at 2000 chars
 * - Normalizes whitespace
 */
export function sanitizeUserInput(text: string): string {
  if (!text) return text;

  let result = text;

  // Strip HTML tags
  result = result.replace(HTML_TAGS_RE, '');

  // Strip injection patterns
  for (const pattern of INJECTION_PATTERNS) {
    result = result.replace(pattern, '');
  }

  // Normalize whitespace
  result = result.replace(/\s+/g, ' ').trim();

  // Cap length
  if (result.length > MAX_INPUT_LENGTH) {
    result = result.slice(0, MAX_INPUT_LENGTH);
  }

  return result;
}
