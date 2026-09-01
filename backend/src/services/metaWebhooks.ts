import axios from 'axios';
import { config } from '../config';
import type { Logger } from '../types';

const GRAPH_API = `https://graph.facebook.com/${config.facebook.graphApiVersion}`;

/** Meta platform webhook object types */
type MetaWebhookObject = 'page' | 'instagram' | 'whatsapp_business_account';

interface WebhookSubscription {
    object: MetaWebhookObject;
    fields: string;
    label: string;
}

/**
 * All Meta platform webhook subscriptions managed by Jawab24.
 * Add new platforms here when expanding (e.g. WhatsApp).
 */
const SUBSCRIPTIONS: WebhookSubscription[] = [
    { object: 'page', fields: 'feed,messages', label: 'Facebook Page' },
    { object: 'instagram', fields: 'messages,comments', label: 'Instagram' },
    // Coexistence ("API Solutions for Business App Users") requires all three of
    // history / smb_app_state_sync / smb_message_echoes on top of `messages` —
    // Meta gates the WhatsApp-Business-app onboarding flow on them. Only
    // `smb_message_echoes` is acted on today (a merchant's phone reply becomes a
    // manual row so the AI stands down); `history` and `smb_app_state_sync` are
    // accepted and discarded — see webhook.ts. Numbers onboarded the migration
    // way simply never emit the extra three, so this is inert for them.
    //
    // `account_update` is Meta's ONLY signal that a merchant severed the link
    // (PARTNER_REMOVED — e.g. a coexistence merchant unlinking from their phone).
    // Without it the failure is silent: token stays valid, webhooks just stop
    // (Z net went dark for 27h on 2026-08-31 exactly this way). Handled in
    // webhook.ts → markWhatsAppNeedsReconnect.
    { object: 'whatsapp_business_account', fields: 'messages,smb_message_echoes,history,smb_app_state_sync,account_update', label: 'WhatsApp' },
];

/**
 * Verify/refresh app-level webhook subscriptions with Meta for all platforms.
 * Subscribes to each platform object so that Meta delivers webhooks to our callback URL.
 * Should be called on server startup to guarantee webhook delivery after deploys.
 */
export async function ensureMetaWebhookSubscriptions(
    callbackUrl: string,
    logger: Logger,
): Promise<boolean> {
    const appToken = `${config.facebook.appId}|${config.facebook.appSecret}`;
    let allOk = true;

    for (const sub of SUBSCRIPTIONS) {
        try {
            logger.info(`[MetaWebhooks] Subscribing to ${sub.label} webhooks`, { callbackUrl, object: sub.object });
            await axios.post(`${GRAPH_API}/${config.facebook.appId}/subscriptions`, null, {
                params: {
                    object: sub.object,
                    callback_url: callbackUrl,
                    verify_token: config.facebook.webhookVerifyToken,
                    fields: sub.fields,
                    access_token: appToken,
                },
            });
            logger.info(`[MetaWebhooks] ${sub.label} webhook subscription verified`);
        } catch (error) {
            allOk = false;
            if (axios.isAxiosError(error)) {
                logger.error(`[MetaWebhooks] Failed to subscribe to ${sub.label} webhooks`, {
                    object: sub.object,
                    error: error.response?.data?.error?.message || error.message,
                });
            }
        }
    }

    return allOk;
}
