import axios from 'axios';
import { config } from '../config';

const WHATSAPP_API = `https://graph.facebook.com/${config.facebook.graphApiVersion}`;

/**
 * WhatsApp Cloud API Service
 *
 * Thin wrapper around the Meta WhatsApp Cloud API.
 * Uses the same Graph API version and auth as Facebook/Instagram.
 */
class WhatsAppService {
    /**
     * Send a text message to a WhatsApp user.
     * @returns The WhatsApp message ID (wamid)
     */
    async sendTextMessage(
        phoneNumberId: string,
        recipientPhone: string,
        text: string,
        accessToken: string,
    ): Promise<string> {
        const res = await axios.post(
            `${WHATSAPP_API}/${phoneNumberId}/messages`,
            {
                messaging_product: 'whatsapp',
                to: recipientPhone,
                type: 'text',
                text: { body: text },
            },
            { headers: { Authorization: `Bearer ${accessToken}` } },
        );
        return res.data?.messages?.[0]?.id ?? '';
    }

    /**
     * Mark a message as read (shows blue ticks to the sender).
     * Used as the "typing indicator" equivalent for WhatsApp.
     */
    async markAsRead(
        phoneNumberId: string,
        messageId: string,
        accessToken: string,
    ): Promise<void> {
        await axios.post(
            `${WHATSAPP_API}/${phoneNumberId}/messages`,
            {
                messaging_product: 'whatsapp',
                status: 'read',
                message_id: messageId,
            },
            { headers: { Authorization: `Bearer ${accessToken}` } },
        ).catch(() => {
            // Fire-and-forget — blue ticks are cosmetic
        });
    }
}

export const whatsappService = new WhatsAppService();
