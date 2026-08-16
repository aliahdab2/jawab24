import { sendMetaImageAttachment } from '../metaMessaging';
import { captureError } from '../../utils/sentryHelpers';

/**
 * Deliver a Post Reply image as its own native-image message to a PSID — BEST-EFFORT,
 * shared by the FB and IG comment→DM paths so both behave identically.
 *
 * The reply TEXT is always sent first (the reliable, primary delivery: on FB the one-shot
 * private reply, on IG the direct message), so an image failure here must NOT throw —
 * throwing would retry the whole job and re-fire the one-shot private reply, which Meta
 * rejects. The failure is logged (grouped by fingerprint so an at-scale rejection shows as
 * one issue) and swallowed. Returns whether the image was actually delivered, which drives
 * the honest `flagMeta.reply_image` badge (never claim an image the customer didn't get).
 */
export async function deliverReplyImageBestEffort(
    pageAccessToken: string,
    recipientId: string,
    imageUrl: string,
    ctx: {
        platform: 'facebook' | 'instagram';
        component: string;
        extra?: Record<string, unknown>;
        /** Messages endpoint override — Instagram Login pages only (their own host+path). */
        endpoint?: string;
    },
): Promise<boolean> {
    try {
        await sendMetaImageAttachment(pageAccessToken, recipientId, imageUrl, undefined, ctx.endpoint);
        return true;
    } catch (error) {
        captureError(error, 'Post Reply image attachment failed (text delivered)', {
            fingerprint: ['post-reply-image-attachment-failed'],
            tags: { component: ctx.component, platform: ctx.platform },
            extra: ctx.extra,
        });
        return false;
    }
}
