/**
 * Shared helpers for settings services.
 * Used by both SettingsService (per-user) and WorkspaceSettingsService (per-workspace).
 */

/**
 * Check if the current time (in the given timezone) falls within business hours.
 */
export function isWithinBusinessHours(start: string, end: string, timezone: string): boolean {
    let currentTime: string;
    try {
        const parts = new Intl.DateTimeFormat('en-US', {
            timeZone: timezone,
            hour: '2-digit',
            minute: '2-digit',
            hour12: false,
        }).formatToParts(new Date());
        const hour = parts.find(p => p.type === 'hour')?.value || '00';
        const minute = parts.find(p => p.type === 'minute')?.value || '00';
        currentTime = `${hour}:${minute}`;
    } catch {
        // Fallback to server time if timezone is invalid
        const now = new Date();
        currentTime = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`;
    }

    return currentTime >= start && currentTime <= end;
}

/**
 * Resolve which language version to use for a customer-facing reply.
 *
 * - If autoDetectLanguage is ON and the detected language is supported → use it
 * - Otherwise → use the default reply language (or first supported as last resort)
 */
export function resolveLanguage(
    opts: {
        autoDetectLanguage: boolean;
        supportedLanguages: string[] | null;
        defaultLanguage: string;
    },
    detectedLanguage?: string,
): string {
    const supported = opts.supportedLanguages ?? ['en', 'ar'];
    const fallback = supported.includes(opts.defaultLanguage)
        ? opts.defaultLanguage
        : (supported[0] ?? 'en');

    if (!opts.autoDetectLanguage || !detectedLanguage || detectedLanguage === 'unknown') {
        return fallback;
    }

    return supported.includes(detectedLanguage) ? detectedLanguage : fallback;
}
