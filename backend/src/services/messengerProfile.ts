/**
 * Messenger Profile — organic-entry greeting + ice breakers for Facebook pages.
 *
 * Someone who opens a Messenger thread ORGANICALLY (m.me link, the page's
 * "Message" button) lands on an empty welcome screen: no greeting, nothing to
 * tap. Meta's Messenger Profile API fills that screen with a `greeting`
 * (locale-aware) and up to 4 `ice_breakers` (tappable suggested questions), so
 * a prospect starts the conversation instead of bouncing.
 *
 * Facebook Messenger ONLY. Instagram has a different API surface (its own
 * ice-breaker endpoint, no greeting) and is deliberately not covered here.
 *
 * Contract with the rest of the system:
 *  - An ice-breaker tap arrives as a `postback` webhook event (payload
 *    `ib:<index>`, see `@jawab24/shared` ICE_BREAKER_PAYLOAD_PREFIX), NOT as a
 *    text message. `controllers/webhook.ts#processPostback` converts it into
 *    the normal message pipeline.
 *  - `pages.messenger_profile` (jsonb) stores { config, lastSyncedAt,
 *    lastError }. The stored config is the authoritative source for the tapped
 *    question's text (payload carries only the index).
 *  - Sync failures must NEVER fail a page connect — the fire-and-forget
 *    orchestrators below capture to Sentry and record `lastError` instead.
 *
 * Verified against Meta docs (Rule 10.12):
 *  - greeting text ≤ 160 chars; personalization supports {{user_first_name}}
 *    {{user_last_name}} {{user_full_name}} only — {{page_name}} is NOT a
 *    documented template string, so the default greeting interpolates the
 *    page's real name server-side at build time instead.
 *  - ice breakers: max 4 questions; a `default` locale entry is required;
 *    payload cap 1000 chars (ours is ~5).
 */
import axios from 'axios';
import { db } from '../db';
import { pages } from '../db/schema';
import { eq } from 'drizzle-orm';
import { fbAxios, GRAPH_API_BASE } from '../lib/fbAxios';
import { tracedExternalCall } from '../utils/tracing';
import { captureError } from '../utils/sentryHelpers';
import { t } from '../utils/i18n';
import {
    type MessengerProfileConfig,
    type StoredMessengerProfile,
    MESSENGER_GREETING_MAX,
    MESSENGER_ICE_BREAKERS_MAX,
    buildIceBreakerPayload,
} from '@jawab24/shared';
import type { Logger } from '../types';
import { noopLogger } from '../types';

const traced = <T>(method: string, fn: () => Promise<T>) =>
    tracedExternalCall('facebook', method, fn);

/** The two Messenger Profile fields this feature owns. */
export const MESSENGER_PROFILE_FIELDS = ['greeting', 'ice_breakers'] as const;
export type MessengerProfileField = (typeof MESSENGER_PROFILE_FIELDS)[number];

/** Minimal page shape the service needs — structural, so callers can pass a
 *  full Drizzle row or a hand-built object in tests. */
export interface MessengerProfilePage {
    id: string;
    facebookPageId: string | null;
    name: string | null;
    messengerProfile?: StoredMessengerProfile | null;
}

export interface MessengerProfileGraphPayload {
    greeting?: Array<{ locale: string; text: string }>;
    ice_breakers?: Array<{
        locale: string;
        call_to_actions: Array<{ question: string; payload: string }>;
    }>;
}

/**
 * Defensive clamp to Meta's documented 160-char greeting cap. Merchant input is
 * rejected above the cap at the API boundary (Zod), so this only fires for
 * DEFAULT greetings whose interpolated page name pushed them over — better a
 * truncated greeting than a Graph 400 that leaves the welcome screen empty.
 */
export function clampGreeting(text: string): string {
    if (text.length <= MESSENGER_GREETING_MAX) return text;
    return `${text.slice(0, MESSENGER_GREETING_MAX - 1)}…`;
}

/**
 * The generic default applied on page connect when the merchant never
 * configured a profile. فصحى per the Arabic-register rule; the English variant
 * serves non-Arabic locales. Ice breakers are Arabic-first (default locale) —
 * the target market — and cover the three questions merchants get most.
 */
export function buildDefaultMessengerProfileConfig(pageName: string | null | undefined): MessengerProfileConfig {
    const name = pageName?.trim() || 'Jawab24';
    return {
        enabled: true,
        greeting: {
            ar: clampGreeting(t('messengerGreetingDefault', 'ar', { pageName: name })),
            en: clampGreeting(t('messengerGreetingDefault', 'en', { pageName: name })),
        },
        iceBreakers: [
            t('messengerIceBreakerPrices', 'ar'),
            t('messengerIceBreakerOrder', 'ar'),
            t('messengerIceBreakerHours', 'ar'),
        ],
    };
}

/**
 * Build the Graph API payload from a config. Pure — unit-tested directly.
 *
 * Returns the fields to POST and the fields to DELETE (a field with no content
 * must be deleted from the profile, not posted empty — Meta rejects empty
 * arrays). A disabled config deletes both fields.
 *
 * Ice-breaker payload indexes reference positions in the STORED array (empty
 * entries are skipped without re-indexing), so the webhook's tap-time lookup
 * `config.iceBreakers[index]` always lands on the question that was sent.
 */
export function buildMessengerProfilePayload(config: MessengerProfileConfig): {
    payload: MessengerProfileGraphPayload;
    fieldsToDelete: MessengerProfileField[];
} {
    if (!config.enabled) {
        return { payload: {}, fieldsToDelete: [...MESSENGER_PROFILE_FIELDS] };
    }

    const payload: MessengerProfileGraphPayload = {};
    const fieldsToDelete: MessengerProfileField[] = [];

    const ar = config.greeting?.ar?.trim();
    const en = config.greeting?.en?.trim();
    // Meta requires a `default` locale entry. Arabic is the primary market, so
    // it takes `default` (+ ar_AR) when present; otherwise English does.
    const defaultText = ar || en;
    if (defaultText) {
        const greeting = [{ locale: 'default', text: clampGreeting(defaultText) }];
        if (ar && en) {
            greeting.push({ locale: 'ar_AR', text: clampGreeting(ar) });
            greeting.push({ locale: 'en_US', text: clampGreeting(en) });
        }
        payload.greeting = greeting;
    } else {
        fieldsToDelete.push('greeting');
    }

    const questions = (config.iceBreakers ?? [])
        .map((question, index) => ({ question: question.trim(), index }))
        .filter(({ question }) => question.length > 0)
        .slice(0, MESSENGER_ICE_BREAKERS_MAX);
    if (questions.length > 0) {
        payload.ice_breakers = [{
            locale: 'default',
            call_to_actions: questions.map(({ question, index }) => ({
                question,
                payload: buildIceBreakerPayload(index),
            })),
        }];
    } else {
        fieldsToDelete.push('ice_breakers');
    }

    return { payload, fieldsToDelete };
}

/** POST the profile fields. Throws on Graph errors (fbAxios retries transient ones). */
export async function setMessengerProfile(
    facebookPageId: string,
    pageAccessToken: string,
    payload: MessengerProfileGraphPayload,
): Promise<void> {
    await traced('setMessengerProfile', () =>
        fbAxios.post(`${GRAPH_API_BASE}/${facebookPageId}/messenger_profile`, payload, {
            params: { access_token: pageAccessToken },
        }),
    );
}

/** DELETE profile fields (merchant cleared them / disabled the feature). */
export async function deleteMessengerProfile(
    facebookPageId: string,
    pageAccessToken: string,
    fields: readonly MessengerProfileField[],
): Promise<void> {
    if (fields.length === 0) return;
    await traced('deleteMessengerProfile', () =>
        fbAxios.delete(`${GRAPH_API_BASE}/${facebookPageId}/messenger_profile`, {
            params: { access_token: pageAccessToken },
            data: { fields: [...fields] },
        }),
    );
}

function graphErrorMessage(err: unknown): string {
    if (axios.isAxiosError(err)) {
        return err.response?.data?.error?.message || err.message;
    }
    return err instanceof Error ? err.message : String(err);
}

async function persistStatus(pageId: string, stored: StoredMessengerProfile): Promise<void> {
    await db
        .update(pages)
        .set({ messengerProfile: stored, updatedAt: new Date() })
        .where(eq(pages.id, pageId));
}

/**
 * Sync a config to Meta and record the outcome on the page row.
 *
 * Always persists the config (so the editor reflects what the merchant saved
 * even when Meta is down) plus lastSyncedAt/lastError. Throws after persisting
 * on failure so callers choose: fire-and-forget paths swallow via
 * captureError, the backfill script counts failures.
 */
export async function setupMessengerProfile(
    page: MessengerProfilePage,
    pageAccessToken: string,
    config: MessengerProfileConfig,
    logger: Logger = noopLogger,
): Promise<void> {
    if (!page.facebookPageId) return;
    const previous = page.messengerProfile;
    const { payload, fieldsToDelete } = buildMessengerProfilePayload(config);

    try {
        if (payload.greeting || payload.ice_breakers) {
            await setMessengerProfile(page.facebookPageId, pageAccessToken, payload);
        }
        await deleteMessengerProfile(page.facebookPageId, pageAccessToken, fieldsToDelete);
        await persistStatus(page.id, {
            config,
            lastSyncedAt: new Date().toISOString(),
            lastError: null,
        });
        logger.info('[MessengerProfile] Synced', {
            pageId: page.id,
            facebookPageId: page.facebookPageId,
            enabled: config.enabled,
            iceBreakers: payload.ice_breakers?.[0]?.call_to_actions.length ?? 0,
            deletedFields: fieldsToDelete,
        });
    } catch (err) {
        const message = graphErrorMessage(err);
        logger.warn('[MessengerProfile] Sync failed', { pageId: page.id, error: message });
        // Best-effort status write — never mask the original Graph error.
        await persistStatus(page.id, {
            config,
            lastSyncedAt: previous?.lastSyncedAt ?? null,
            lastError: message,
        }).catch(() => { /* status write is best-effort */ });
        throw err;
    }
}

/**
 * Fire-and-forget sync on page connect/reconnect (syncFromFacebook). Applies
 * the stored config, or seeds + applies the default when the page has none.
 * A stored DISABLED config is respected — reconnect never resurrects fields
 * the merchant turned off.
 *
 * Never throws and never blocks the connect flow (Rule: profile setup failure
 * must not fail page connect).
 */
export function syncMessengerProfileOnConnect(
    page: MessengerProfilePage,
    pageAccessToken: string,
    logger: Logger = noopLogger,
): void {
    if (!page.facebookPageId || !pageAccessToken) return;
    const config = page.messengerProfile?.config
        ?? buildDefaultMessengerProfileConfig(page.name);
    if (!config.enabled) return; // merchant opted out — nothing to sync
    setupMessengerProfile(page, pageAccessToken, config, logger).catch(err => {
        captureError(err, 'Messenger profile setup failed on page connect', {
            tags: { service: 'messenger-profile', action: 'connect-sync' },
            extra: { pageId: page.id, facebookPageId: page.facebookPageId },
            level: 'warning',
        });
    });
}

/**
 * Fire-and-forget sync after a merchant edit (PUT /pages/:id with a
 * messengerProfile body). The config has already been persisted by updatePage;
 * this pushes it to Meta and refreshes lastSyncedAt/lastError.
 */
export function syncMessengerProfileAfterUpdate(
    page: MessengerProfilePage,
    pageAccessToken: string,
    config: MessengerProfileConfig,
    logger: Logger = noopLogger,
): void {
    if (!page.facebookPageId || !pageAccessToken) return;
    setupMessengerProfile(page, pageAccessToken, config, logger).catch(err => {
        captureError(err, 'Messenger profile sync failed after settings update', {
            tags: { service: 'messenger-profile', action: 'update-sync' },
            extra: { pageId: page.id, facebookPageId: page.facebookPageId },
            level: 'warning',
        });
    });
}
