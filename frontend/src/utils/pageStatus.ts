import type { Page } from '@jawab24/shared';
import { needsBusinessInfo } from './kb';

/**
 * What a customer's message meets when it arrives at this page, worst first.
 *
 * Ordered as a ladder: the first condition that holds wins, because a
 * disconnected page's toggles and Business Info are moot, and a page with no
 * answer source cannot answer however many channels are on.
 */
export type PageStatus = 'disconnected' | 'paused' | 'greeting_only' | 'answering';

/**
 * Resolve the page's status pill.
 *
 * ⚠️ Every label this drives is a CLAIM, and the card may only claim what this
 * payload proves. It proves configuration — the credential's liveness
 * (`isConnected`), which channels are on, whether an answer source exists. It
 * proves NOTHING about delivery: the reply gate that stops a `past_due`
 * subscription lives in billing and never reaches `GET /pages`. That is why
 * `answering` is a habitual claim («يجيب عملاءك», "answers your customers") and
 * never a live one — a page whose subscription is blocked is silently not
 * replying, and this function cannot know (the silent-suspension incident).
 *
 * `isConnected !== false` (not `=== true`) follows the convention used across
 * the app — an absent flag means "not told otherwise", never "disconnected".
 */
export function resolvePageStatus(page: Page): PageStatus {
  if (page.isConnected === false) return 'disconnected';
  if (!isAnyChannelEnabled(page)) return 'paused';
  if (needsBusinessInfo(page)) return 'greeting_only';
  return 'answering';
}

/**
 * True when at least one channel would answer. Deliberately includes WhatsApp,
 * which `isPageAutoReplyEnabled` omits: that helper answers a different question
 * (the Facebook/Instagram pair the dashboard counts), and a WhatsApp-only page
 * with its toggle on is emphatically not "paused".
 */
function isAnyChannelEnabled(page: Page): boolean {
  return !!(page.autoReplyEnabled || page.instagramAutoReplyEnabled || page.whatsappAutoReplyEnabled);
}

/** i18n key under the `pages` namespace for each status. */
export const PAGE_STATUS_LABEL: Record<PageStatus, string> = {
  disconnected: 'statusNeedsReconnect',
  paused: 'statusPaused',
  greeting_only: 'statusGreetingOnly',
  answering: 'statusAnswering',
};

/**
 * Semantic classes for the pill. `paused` is deliberately NEUTRAL, not a
 * warning: the merchant switched it off on purpose, and painting a deliberate
 * choice amber trains people to ignore amber.
 */
export const PAGE_STATUS_TONE: Record<PageStatus, { pill: string; dot: string }> = {
  disconnected: { pill: 'status-error border', dot: 'bg-red-500' },
  paused: { pill: 'bg-muted text-muted-foreground border border-theme-border', dot: 'bg-surface-300' },
  greeting_only: { pill: 'status-warning border', dot: 'bg-amber-500' },
  answering: { pill: 'status-success border', dot: 'bg-emerald-500' },
};
