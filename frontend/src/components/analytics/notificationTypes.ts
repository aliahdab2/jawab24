/**
 * Notification types known to the analytics UI.
 *
 * Single source of truth for which `byType` keys have translations available.
 * Backend may emit other types in the future (e.g., a v2 cart variant) — those
 * fall back to the raw string instead of the i18n key path.
 *
 * Keep this list aligned with `byType.*` keys in i18n/{en,ar}/ecommerceAnalytics.json.
 */
export const KNOWN_NOTIFICATION_TYPES = [
    'abandoned_cart',
    'order_confirmed',
    'order_shipped',
    'order_delivered',
    'review_request',
    'digital_delivery',
] as const;

export type KnownNotificationType = (typeof KNOWN_NOTIFICATION_TYPES)[number];

const KNOWN_SET: ReadonlySet<string> = new Set(KNOWN_NOTIFICATION_TYPES);

export function isKnownNotificationType(type: string): type is KnownNotificationType {
    return KNOWN_SET.has(type);
}
