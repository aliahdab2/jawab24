/**
 * `flag_reason` is stored as a COMMA-JOINED string, not an array
 * (e.g. `'info_not_in_kb,low_confidence'`), so every consumer that wants to ask
 * "is flag X present?" has to split and trim it first. That one-liner had been
 * copy-pasted across the reply pipeline (shouldSkipReply, shouldUseFallback,
 * safeFallbackText, buildNotificationReason); this is the single source of truth.
 *
 * Sibling of `parseKeywords` in ./keyword-matching — same comma-string shape,
 * same trim-and-drop-empties contract. Empty tokens are dropped because they can
 * never match a real flag name, so a trailing comma or a doubled separator
 * cannot produce a phantom entry.
 */
export function parseFlagReason(flagReason: string | null | undefined): string[] {
    if (!flagReason) return [];
    return flagReason.split(',').map(f => f.trim()).filter(Boolean);
}

/**
 * True when `flagReason` contains ANY of `wanted`. Membership is exact — a flag
 * name is never matched by prefix or substring, so `info_not_in_kb_extra` does
 * not satisfy a check for `info_not_in_kb`, and the dynamic companion flags
 * (`expected_lang:ar`, `reply_lang:en`) never collide with real flag names.
 */
export function hasAnyFlag(flagReason: string | null | undefined, wanted: readonly string[]): boolean {
    if (!flagReason) return false;
    const flags = parseFlagReason(flagReason);
    return flags.some(f => wanted.includes(f));
}
