/**
 * Shared inbox filter logic used by both the Messages and Comments pages.
 * Keeps filter resolution and API param mapping in one place.
 */

export type InboxFilterType = 'needs_action' | 'all' | 'auto_replied' | 'handled';

export const INBOX_VALID_FILTERS: InboxFilterType[] = ['needs_action', 'all', 'auto_replied', 'handled'];

/** Map legacy/dashboard filter query values to canonical filter types. */
const FILTER_ALIASES: Record<string, InboxFilterType> = {
  pending: 'needs_action',
  flagged: 'needs_action',
  replied_today: 'auto_replied',
};

/** Resolve a raw query-string value to a valid InboxFilterType (defaults to 'needs_action'). */
export function resolveInboxFilter(value: string | undefined): InboxFilterType {
  if (!value) return 'needs_action';
  if (INBOX_VALID_FILTERS.includes(value as InboxFilterType)) return value as InboxFilterType;
  return FILTER_ALIASES[value] ?? 'needs_action';
}

/** Map an InboxFilterType to the backend query params shared by both messages and comments APIs. */
export function inboxFilterToApiParams(filter: InboxFilterType): {
  actionRequired?: boolean;
  replied?: boolean;
  resolved?: boolean;
} {
  switch (filter) {
    case 'needs_action': return { actionRequired: true };
    case 'auto_replied':  return { replied: true };
    case 'handled':       return { resolved: true };
    case 'all':
    default:              return {};
  }
}
