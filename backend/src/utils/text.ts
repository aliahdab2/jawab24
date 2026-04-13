/**
 * Truncate text at the last complete sentence within maxLength.
 * Falls back to word boundary if no sentence boundary found.
 */
export function truncateAtSentence(text: string, maxLength: number): string {
    if (text.length <= maxLength) return text;

    const truncated = text.slice(0, maxLength);
    // Find last sentence boundary (. ! ? or Arabic ؟)
    const lastSentence = truncated.search(/[.!?؟]\s*[^.!?؟]*$/);
    if (lastSentence >= maxLength * 0.3) {
        return truncated.slice(0, lastSentence + 1).trim();
    }
    // Fall back to last word boundary
    const lastSpace = truncated.lastIndexOf(' ');
    return (lastSpace > maxLength * 0.3 ? truncated.slice(0, lastSpace) : truncated).trim() + '…';
}

