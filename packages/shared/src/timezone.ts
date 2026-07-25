/**
 * IANA timezone helpers, shared so the "is this a usable timeZone?" check has a
 * single definition. Used by the settings schema (input validation) and the
 * ai-worker prompt builder (today's-date computation).
 */

import { PLACEHOLDER_TIMEZONE } from './constants';

/** True when `tz` is a valid IANA timezone name that Intl can format with. */
export function isValidTimezone(tz: string | undefined | null): boolean {
    if (!tz) return false;
    try {
        // Throws RangeError for invalid IANA names — probe before trusting.
        new Intl.DateTimeFormat('en-US', { timeZone: tz });
        return true;
    } catch {
        return false;
    }
}

/** Return `tz` if it is a valid IANA timezone, otherwise fall back to UTC. */
export function safeTimezone(tz?: string | null): string {
    return isValidTimezone(tz) ? (tz as string) : 'UTC';
}

/**
 * Current wall-clock time in `timeZone` as "HH:MM" (24h).
 *
 * Falls back to the caller's local clock when the zone is unusable, matching the
 * pipeline's long-standing behaviour: a merchant with a corrupt timezone should
 * still get replies on roughly the right schedule rather than none at all.
 */
export function formatTimeInZone(timeZone: string, now: Date = new Date()): string {
    try {
        const parts = new Intl.DateTimeFormat('en-US', {
            timeZone, hour: '2-digit', minute: '2-digit', hour12: false,
        }).formatToParts(now);
        const hour = parts.find(p => p.type === 'hour')?.value || '00';
        const minute = parts.find(p => p.type === 'minute')?.value || '00';
        return `${hour}:${minute}`;
    } catch {
        const pad = (n: number) => n.toString().padStart(2, '0');
        return `${pad(now.getHours())}:${pad(now.getMinutes())}`;
    }
}

/** `Africa/Tripoli` → `UTC+02:00`. Empty string when the zone can't be formatted. */
export function formatUtcOffset(timeZone: string, now: Date = new Date()): string {
    try {
        const parts = new Intl.DateTimeFormat('en-US', { timeZone, timeZoneName: 'longOffset' })
            .formatToParts(now);
        // `longOffset` renders as "GMT+02:00" (and bare "GMT" at zero offset).
        const raw = parts.find(p => p.type === 'timeZoneName')?.value ?? '';
        if (!raw) return '';
        return raw === 'GMT' ? 'UTC+00:00' : raw.replace('GMT', 'UTC');
    } catch {
        return '';
    }
}

/**
 * Minutes `timeZone` is ahead of UTC (negative when behind); 0 if unresolvable.
 *
 * Exists because the picker must sort by real offset, not by the offset LABEL:
 * "UTC-04:00" sorts after "UTC+04:00" as a string ('+' < '-'), which quietly
 * exiled every western zone to the bottom of the list.
 */
export function utcOffsetMinutes(timeZone: string, now: Date = new Date()): number {
    return parseOffsetMinutes(formatUtcOffset(timeZone, now));
}

/** `UTC+02:00` → 120. Pure string math — no Intl, safe to call in a hot loop. */
function parseOffsetMinutes(offset: string): number {
    const match = /^UTC([+-])(\d{2}):(\d{2})$/.exec(offset);
    if (!match) return 0;
    const [, sign, hours, minutes] = match;
    const total = Number(hours) * 60 + Number(minutes);
    return sign === '-' ? -total : total;
}

/** The runtime's own IANA zone, or `undefined` if it won't report one. */
export function detectTimezone(): string | undefined {
    try {
        return Intl.DateTimeFormat().resolvedOptions().timeZone || undefined;
    } catch {
        return undefined;
    }
}

/**
 * The zone to show a merchant, given whatever is stored for them.
 *
 * `PLACEHOLDER_TIMEZONE` is a DB default nobody ever chose — every merchant who
 * never touched the setting inherited it, so a Libyan shop evaluated its
 * schedule on Riyadh time and lost an hour a day. Treat it exactly like an
 * empty value and fall back to this device.
 *
 * A zone the merchant DID choose is never overridden: the device is frequently
 * not where the business is (an agency, a reseller, or an owner travelling),
 * and silently tracking it would shift a Damascus shop's hours every time
 * someone abroad opened Settings.
 */
export function resolveStoredTimezone(
    stored: string | null | undefined,
    // REQUIRED, not defaulted: a default would make `f(x, undefined)` fall back
    // to the real device, so "the device reports nothing" could not be
    // expressed or tested. Callers pass `detectTimezone()`.
    detected: string | undefined,
): string | undefined {
    const chosen = stored?.trim();
    if (chosen && chosen !== PLACEHOLDER_TIMEZONE) return chosen;
    return detected ?? chosen ?? undefined;
}

/**
 * Fallback zone list — used ONLY when the runtime cannot enumerate the IANA
 * database itself (`Intl.supportedValuesOf`, ES2022: Chrome 99+/Safari 15.4+).
 *
 * Never the primary source. A hand-typed list of the world's timezones is data
 * that silently rots — zones are added, renamed and re-offset by governments
 * every year, and no one will remember this array exists. The platform ships a
 * maintained copy of the IANA database; this is only so an ancient WebView gets
 * a usable picker instead of an empty one.
 */
const FALLBACK_ZONES = [
    // North Africa
    'Africa/Casablanca', 'Africa/Algiers', 'Africa/Tunis', 'Africa/Tripoli',
    'Africa/Cairo', 'Africa/Khartoum',
    // Levant + Iraq
    'Asia/Damascus', 'Asia/Beirut', 'Asia/Amman', 'Asia/Jerusalem', 'Asia/Baghdad',
    // Gulf + Arabia
    'Asia/Riyadh', 'Asia/Kuwait', 'Asia/Bahrain', 'Asia/Qatar', 'Asia/Dubai',
    'Asia/Muscat', 'Asia/Aden',
    // Wider region + common diaspora
    'Europe/Istanbul', 'Africa/Nairobi', 'Africa/Mogadishu',
    'Europe/London', 'Europe/Paris', 'Europe/Berlin', 'Europe/Stockholm',
    'America/New_York', 'America/Toronto', 'UTC',
];

/**
 * Picker options labelled with their current UTC offset, sorted by offset then
 * name. `ensure` values (the merchant's stored zone, the detected zone) are added
 * when missing, so a stored zone can never render as a blank select — which would
 * silently rewrite it on the next save.
 *
 * Returns the FULL IANA list (~400 entries), which is only usable because the
 * picker that renders it is type-ahead searchable. Don't feed this to a plain
 * dropdown.
 */
export function getTimezoneOptions(ensure: (string | undefined)[] = [], now: Date = new Date()) {
    // `Intl.supportedValuesOf` is ES2022 while this package targets ES2020, so it
    // isn't in the ambient lib types. Declaring the one method we feature-detect
    // is narrower (and safer) than raising the target for every consumer — the
    // runtime check below is what actually decides, on both Node and the WebView.
    const intl = Intl as typeof Intl & {
        supportedValuesOf?: (key: 'timeZone') => string[];
    };
    const supported = typeof intl.supportedValuesOf === 'function'
        ? intl.supportedValuesOf('timeZone')
        : FALLBACK_ZONES;

    const zones = new Set<string>(supported);
    for (const tz of ensure) {
        if (tz) zones.add(tz);
    }

    // Format each zone's offset EXACTLY once. Calling utcOffsetMinutes() inside the
    // sort comparator instead would construct an Intl.DateTimeFormat on every
    // comparison — ~7,600 extra constructions for the ~420-zone IANA list, i.e.
    // hundreds of milliseconds of blocked main thread on the settings page (worst
    // on a mid-range Android in the Capacitor WebView). Parse the minutes from the
    // string we already have instead.
    return [...zones]
        .map(value => {
            const offset = formatUtcOffset(value, now);
            return { value, offset, minutes: parseOffsetMinutes(offset) };
        })
        .sort((a, b) => a.minutes - b.minutes || a.value.localeCompare(b.value))
        .map(({ value, offset }) => ({
            value,
            label: offset ? `${value.replace(/_/g, ' ')} (${offset})` : value.replace(/_/g, ' '),
        }));
}
