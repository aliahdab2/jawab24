/**
 * WhatsApp delivery for customer order notifications.
 *
 * Owns two things the notification service must not know about: which of the
 * merchant's WhatsApp numbers sends for a store, and whether the canonical
 * template Meta must approve is actually approved yet.
 *
 * DESIGN — always a template, never free-form text: a notification reaches a
 * customer who may never have messaged the merchant, so there is no open 24h
 * customer-service window to send text into. A pre-approved UTILITY template is
 * the only correct shape (and Meta bills it cheaply, free inside a window).
 */
import { and, asc, eq, isNotNull, ne } from 'drizzle-orm';
import { db } from '../db';
import { pages, whatsappNotificationTemplates } from '../db/schema';
import { safeDecryptToken } from './facebookCrypto';
import { whatsappService } from './whatsapp';
import { captureError } from '../utils/sentryHelpers';
import { normalizeCustomerPhoneForWhatsApp, type OrderNotificationType, type WhatsAppTemplateStatus } from '@jawab24/shared';
import {
    allCanonicalTemplates,
    buildTemplateParams,
    canonicalTemplateFor,
    isWhatsAppNotificationType,
    WHATSAPP_NOTIFICATION_TYPES,
    type TemplateLanguage,
} from './whatsappNotificationTemplates';

/**
 * Why a WhatsApp notification could not be sent. These strings land in
 * `customer_notifications_log.error_message` and drive the merchant-facing
 * explanation, so they are stable identifiers — not free prose.
 */
export const WA_SEND_ERRORS = {
    /** The store has no linked page carrying WhatsApp credentials. */
    noSender: 'no_whatsapp_sender',
    /** Meta has not approved the canonical template for this type+language yet. */
    templatePending: 'whatsapp_template_pending',
    /** Meta rejected the template — a human must look; retrying cannot help. */
    templateRejected: 'whatsapp_template_rejected',
    /** The customer phone is not a dialable international number. */
    badPhone: 'invalid_customer_phone',
    /** This notification type has no canonical WhatsApp template. */
    unsupportedType: 'whatsapp_type_unsupported',
    /**
     * The log row asks for a channel that no longer exists (the retired SMS
     * rail, D-123). Only reachable from a row written before that retirement, or
     * edited by hand — a retry cannot fix it, so a human must look.
     */
    channelUnsupported: 'channel_unsupported',
} as const;

export class WhatsAppNotificationError extends Error {
    constructor(public readonly reason: string, message?: string) {
        super(message ?? reason);
        this.name = 'WhatsAppNotificationError';
    }
    /** True when a BullMQ retry could plausibly succeed later. */
    get retryable(): boolean {
        return this.reason === WA_SEND_ERRORS.templatePending;
    }
}

export interface WhatsAppSender {
    pageId: string;
    phoneNumberId: string;
    wabaId: string | null;
    accessToken: string;
}

/**
 * Find the WhatsApp number that sends for a store: a page LINKED to that store
 * that carries live WhatsApp credentials.
 *
 * Store-linked only — deliberately no workspace-wide fallback. Picking "some
 * other number in the same workspace" would message the merchant's customers
 * from a number they never associated with that store. If several linked pages
 * qualify, the oldest wins (deterministic, and it is the number the merchant
 * connected first for this store).
 */
export async function resolveWhatsAppSender(storeId: string): Promise<WhatsAppSender | null> {
    const [page] = await db
        .select({
            id: pages.id,
            phoneNumberId: pages.whatsappPhoneNumberId,
            wabaId: pages.whatsappBusinessAccountId,
            token: pages.whatsappAccessToken,
        })
        .from(pages)
        .where(and(
            eq(pages.ecommerceStoreId, storeId),
            isNotNull(pages.whatsappPhoneNumberId),
            isNotNull(pages.whatsappAccessToken),
            ne(pages.whatsappAccessToken, ''),
        ))
        .orderBy(asc(pages.createdAt))
        .limit(1);

    if (!page?.phoneNumberId) return null;

    // safeDecryptToken returns '' on a decrypt failure — treat that as "no
    // usable sender" rather than calling Meta with an empty bearer.
    const accessToken = safeDecryptToken(page.token, { entity: 'page', id: page.id });
    if (!accessToken) return null;

    return { pageId: page.id, phoneNumberId: page.phoneNumberId, wabaId: page.wabaId ?? null, accessToken };
}

/** How long an `approved` row is trusted before re-checking Meta. */
const APPROVED_TRUST_MS = 24 * 60 * 60 * 1000;
/** How long to wait between refreshes of a still-`pending` row. */
const PENDING_RECHECK_MS = 10 * 60 * 1000;

function mapMetaStatus(status: string | null): 'pending' | 'approved' | 'rejected' | 'unknown' {
    switch ((status ?? '').toUpperCase()) {
        case 'APPROVED': return 'approved';
        case 'PENDING':
        case 'IN_APPEAL':
        case 'PENDING_DELETION': return 'pending';
        case 'REJECTED':
        case 'DISABLED':
        case 'PAUSED': return 'rejected';
        default: return 'unknown';
    }
}

/**
 * How long a template stuck at `unknown` — submitted, but never confirmed to have
 * reached Meta — waits before we try submitting it again.
 *
 * `unknown` is written when a submission failed for a reason that is NOT "already
 * exists": a network blip, a 5xx, a 429, or a 4xx from a token that has since been
 * refreshed. All of those can succeed on a later attempt, so the row must not be a
 * permanent tombstone — see `needsResubmission`.
 */
const UNKNOWN_RESUBMIT_BACKOFF_MS = 30 * 60 * 1000;

/**
 * In-flight provisioning runs, keyed by page.
 *
 * Saving several types at once issues one PUT per type in parallel, and each one
 * asks for provisioning. Without this they would all read "nothing exists yet"
 * before any of them wrote a row, and each would submit all 8 canonical templates
 * — 32 POSTs to Meta's rate-limited template endpoint, 24 of them duplicates.
 * Collapsing them into one shared promise makes the burst impossible rather than
 * merely survivable (AI_INSTRUCTIONS Rule 14, prevention over detection).
 *
 * Process-local. A second backend replica could still race, which is why the
 * duplicate-name branch below still treats "already exists" as success.
 */
const inFlightProvisioning = new Map<string, Promise<void>>();

/**
 * A row that never made it to Meta is retried after a backoff.
 *
 * Without this, ONE transient failure wedged the store's WhatsApp channel forever:
 * the row existed, so provisioning skipped it on every later call; Meta had no such
 * template, so the status poll returned null → `unknown` → `whatsapp_template_pending`
 * → a BullMQ retry that re-entered the same skip. And because `templatePending` is
 * deliberately not Sentry-reported, it failed silently. Only a manual DELETE recovered.
 *
 * Measured on `lastSubmittedAt`, NOT `lastCheckedAt`. The status poll re-stamps
 * `lastCheckedAt` every few minutes while a template is stuck, so keying the
 * backoff off it would push the resubmit window out on every poll and the retry
 * would never fire — the same wedge in a slower disguise.
 */
function needsResubmission(row: { status: string; lastSubmittedAt: Date | null }): boolean {
    if (row.status !== 'unknown') return false;
    const age = row.lastSubmittedAt ? Date.now() - row.lastSubmittedAt.getTime() : Infinity;
    return age > UNKNOWN_RESUBMIT_BACKOFF_MS;
}

/**
 * Submit every canonical template that this page has not successfully been
 * submitted for. Idempotent: an already-existing template at Meta is recorded, not
 * retried forever, while a submission that never landed is retried after a backoff.
 * Never throws — provisioning is best-effort; the send path reports the resulting
 * status to the merchant.
 *
 * Concurrent calls for the same page share one run (see `inFlightProvisioning`).
 */
export async function ensureTemplatesProvisioned(sender: WhatsAppSender): Promise<void> {
    const existingRun = inFlightProvisioning.get(sender.pageId);
    if (existingRun) return existingRun;

    const run = provisionTemplates(sender).finally(() => {
        inFlightProvisioning.delete(sender.pageId);
    });
    inFlightProvisioning.set(sender.pageId, run);
    return run;
}

async function provisionTemplates(sender: WhatsAppSender): Promise<void> {
    if (!sender.wabaId) {
        // Every Embedded Signup connection stores a WABA id; its absence means an
        // older/partial connection. Visible, because without it the merchant's
        // notifications can never be provisioned.
        captureError(
            new Error('WhatsApp page has no business account id — cannot provision notification templates'),
            'WhatsApp template provisioning skipped: no WABA id',
            { tags: { service: 'whatsapp-notifications' }, extra: { pageId: sender.pageId } },
        );
        return;
    }

    const existing = await db
        .select({
            templateName: whatsappNotificationTemplates.templateName,
            language: whatsappNotificationTemplates.language,
            status: whatsappNotificationTemplates.status,
            lastSubmittedAt: whatsappNotificationTemplates.lastSubmittedAt,
        })
        .from(whatsappNotificationTemplates)
        .where(eq(whatsappNotificationTemplates.pageId, sender.pageId));
    // Keyed on status too, not just existence: a row is only a reason to SKIP when
    // it records a submission that actually reached Meta.
    const known = new Map(existing.map(r => [`${r.templateName}:${r.language}`, r]));

    for (const template of allCanonicalTemplates()) {
        const row = known.get(`${template.name}:${template.language}`);
        if (row && !needsResubmission(row)) continue;
        try {
            const providerTemplateId = await whatsappService.createMessageTemplate(sender.wabaId, sender.accessToken, {
                name: template.name,
                language: template.language,
                body: template.body,
                bodyExamples: template.slots.map(s => s.example),
            });
            await upsertTemplateRow(sender.pageId, template.name, template.language, {
                status: 'pending',
                // A submission that just succeeded supersedes whatever the previous
                // attempt failed with — this is the one place clearing it is right.
                errorMessage: null,
                providerTemplateId: providerTemplateId || null,
            }, true);
        } catch (error) {
            // A duplicate name is success in disguise — the template already
            // exists on this WABA (e.g. provisioned for another store). Record it
            // as pending; the first status refresh will resolve the real state.
            const message = error instanceof Error ? error.message : String(error);
            const alreadyExists = /already exists|2388023/i.test(message);
            await upsertTemplateRow(sender.pageId, template.name, template.language, {
                status: alreadyExists ? 'pending' : 'unknown',
                providerTemplateId: null,
                errorMessage: alreadyExists ? null : message.slice(0, 500),
            }, true);
            if (!alreadyExists) {
                captureError(error, 'WhatsApp template submission failed', {
                    tags: { service: 'whatsapp-notifications' },
                    extra: { pageId: sender.pageId, template: template.name, language: template.language },
                });
            }
        }
    }
}

/**
 * @param submitted true when this write records a SUBMISSION attempt (success or
 *        failure), false when it records a status POLL. The two stamp different
 *        clocks — see `whatsappNotificationTemplates.lastSubmittedAt`.
 */
async function upsertTemplateRow(
    pageId: string,
    templateName: string,
    language: string,
    values: { status: string; providerTemplateId: string | null; errorMessage: string | null },
    submitted = false,
): Promise<void> {
    const now = new Date();
    const clocks = submitted ? { lastCheckedAt: now, lastSubmittedAt: now } : { lastCheckedAt: now };
    await db
        .insert(whatsappNotificationTemplates)
        .values({ pageId, templateName, language, ...values, ...clocks })
        .onConflictDoUpdate({
            target: [
                whatsappNotificationTemplates.pageId,
                whatsappNotificationTemplates.templateName,
                whatsappNotificationTemplates.language,
            ],
            set: { ...values, ...clocks, updatedAt: now },
        });
}

/**
 * Resolve a template's approval state, refreshing from Meta when our record is
 * stale. Returns the effective status — never assumes approval.
 */
async function resolveTemplateStatus(
    sender: WhatsAppSender,
    templateName: string,
    language: string,
): Promise<'pending' | 'approved' | 'rejected' | 'unknown'> {
    const [row] = await db
        .select()
        .from(whatsappNotificationTemplates)
        .where(and(
            eq(whatsappNotificationTemplates.pageId, sender.pageId),
            eq(whatsappNotificationTemplates.templateName, templateName),
            eq(whatsappNotificationTemplates.language, language),
        ))
        .limit(1);

    const current = (row?.status ?? 'unknown') as 'pending' | 'approved' | 'rejected' | 'unknown';
    const age = row?.lastCheckedAt ? Date.now() - row.lastCheckedAt.getTime() : Infinity;
    const stale = current === 'approved' ? age > APPROVED_TRUST_MS : age > PENDING_RECHECK_MS;
    if (row && !stale) return current;
    if (!sender.wabaId) return current;

    try {
        const metaStatus = mapMetaStatus(
            await whatsappService.getMessageTemplateStatus(sender.wabaId, sender.accessToken, templateName, language),
        );
        await upsertTemplateRow(sender.pageId, templateName, language, {
            status: metaStatus,
            providerTemplateId: row?.providerTemplateId ?? null,
            // Only an approval clears the recorded reason. This column is where a
            // failed SUBMISSION leaves its explanation, and it is the only readable
            // account of why a template is stuck — a poll that succeeds while the
            // template is still absent or pending must not erase it
            // (AI_INSTRUCTIONS Rule 10.11c: don't destroy the evidence you'll need).
            errorMessage: metaStatus === 'approved' ? null : (row?.errorMessage ?? null),
        });
        return metaStatus;
    } catch (error) {
        // A refresh failure must not flip a known-good template to unusable —
        // keep the last known status and let the send decide on that.
        captureError(error, 'WhatsApp template status refresh failed', {
            tags: { service: 'whatsapp-notifications' },
            extra: { pageId: sender.pageId, template: templateName, language },
        });
        return current;
    }
}

/**
 * Meta's review state per notification TYPE, collapsed across both languages —
 * the shape the settings card renders (`WhatsAppTemplateStatus`).
 *
 * A type is `approved` only when the Arabic AND English variants are: the
 * language is picked from the customer's phone at send time, so a half-approved
 * pair is not ready.
 *
 * ⛔ Goes through `resolveTemplateStatus`, exactly like the send path, and that
 * is the whole point. The card's status chip used to be served by a raw SELECT
 * in the controller, so it reported whatever was last written and nothing ever
 * refreshed it: `resolveTemplateStatus` is the ONLY code that re-polls Meta, and
 * it was reachable only from a send — which cannot happen while a template is
 * unapproved. Measured 2026-09-03: all 8 production template rows sat `pending`
 * with `last_checked_at == last_submitted_at`, untouched for five days, while
 * the card cheerfully displayed «waiting for approval». Reading through the same
 * function means the card cannot drift from what a send would actually find.
 *
 * One SELECT per template (8 today) rather than one for the page: staleness is
 * per row, and duplicating the decision here to save round-trips is how the two
 * paths diverged in the first place (Rule 10.8). This serves a settings card,
 * not the reply path — the latency budget in Rule 17 does not apply.
 */
export async function resolveTemplateStatusesByType(
    sender: WhatsAppSender,
): Promise<Partial<Record<OrderNotificationType, WhatsAppTemplateStatus>>> {
    const entries = await Promise.all(
        WHATSAPP_NOTIFICATION_TYPES.map(async type => {
            const perLanguage = await Promise.all(
                (['ar', 'en'] as const).map(async lang => {
                    const template = canonicalTemplateFor(type, lang);
                    return resolveTemplateStatus(sender, template.name, template.language);
                }),
            );
            return [type, collapseLanguageStatuses(perLanguage)] as const;
        }),
    );
    // Keys come from WHATSAPP_NOTIFICATION_TYPES, so they ARE OrderNotificationType
    // — `Object.fromEntries` just cannot say so.
    return Object.fromEntries(entries) as Partial<Record<OrderNotificationType, WhatsAppTemplateStatus>>;
}

/**
 * Collapse the two language variants into the card's contract.
 *
 * `unknown` folds into `missing` on purpose: to a merchant both mean "Meta has
 * no such template for you yet", and it is the only honest mapping — the public
 * type is `approved | pending | rejected | missing`, so surfacing the raw
 * `unknown` rendered the untranslated key `templateStatus.unknown` in the card.
 */
function collapseLanguageStatuses(
    statuses: Array<'pending' | 'approved' | 'rejected' | 'unknown'>,
): WhatsAppTemplateStatus {
    if (statuses.includes('rejected')) return 'rejected';
    if (statuses.every(s => s === 'approved')) return 'approved';
    if (statuses.includes('unknown')) return 'missing';
    return 'pending';
}

/**
 * Send one customer notification over WhatsApp.
 *
 * Throws `WhatsAppNotificationError` with a stable reason when the send is not
 * possible; the caller records it on the log row (a VISIBLE skip — never a
 * silent drop, and never a fallback to the dead SMS rail).
 *
 * @returns the wamid, stored as the log row's provider message id.
 */
export async function sendWhatsAppNotification(params: {
    storeId: string;
    notificationType: string;
    customerPhone: string;
    customerName?: string | null;
    language: TemplateLanguage;
    variables: Record<string, string>;
}): Promise<string> {
    const { storeId, notificationType, customerPhone, customerName, language, variables } = params;

    if (!isWhatsAppNotificationType(notificationType)) {
        throw new WhatsAppNotificationError(
            WA_SEND_ERRORS.unsupportedType,
            `No canonical WhatsApp template for notification type ${notificationType}`,
        );
    }

    const recipient = normalizeCustomerPhoneForWhatsApp(customerPhone);
    if (!recipient) {
        throw new WhatsAppNotificationError(
            WA_SEND_ERRORS.badPhone,
            'Customer phone is not a dialable international number',
        );
    }

    const sender = await resolveWhatsAppSender(storeId);
    if (!sender) {
        throw new WhatsAppNotificationError(
            WA_SEND_ERRORS.noSender,
            'No WhatsApp-connected page is linked to this store',
        );
    }

    const template = canonicalTemplateFor(notificationType, language);
    const status = await resolveTemplateStatus(sender, template.name, template.language);
    if (status === 'rejected') {
        throw new WhatsAppNotificationError(WA_SEND_ERRORS.templateRejected, `Meta rejected template ${template.name}`);
    }
    if (status !== 'approved') {
        // Not approved YET — provisioning may not have run for this page at all.
        // Kick it off (idempotent) so the retry has something to approve.
        await ensureTemplatesProvisioned(sender);
        throw new WhatsAppNotificationError(
            WA_SEND_ERRORS.templatePending,
            `Template ${template.name} is not approved yet (${status})`,
        );
    }

    // `variables` is the authoritative source — `schedule()` writes `customer_name`
    // into it alongside the rest, so the spread deliberately WINS over the argument.
    // The argument is the fallback for rows written before the `variables` column
    // existed, where `entry.variables` is null and the caller passes `{}`.
    const bodyParams = buildTemplateParams(template, { customer_name: customerName ?? undefined, ...variables });
    return whatsappService.sendTemplateMessage(
        sender.phoneNumberId,
        recipient,
        template.name,
        template.language,
        bodyParams,
        sender.accessToken,
    );
}
