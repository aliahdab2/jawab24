import { replyGenerator } from './reply/generator';
import { rateLimiter } from './protection/rate-limiter';
import { messageProcessor } from './reply/messageProcessor';
import { whatsappMessageAdapter } from './reply/adapters';
import type { Logger } from '../types';
import type { MessageResult } from '../interfaces';

export class WhatsAppReplyService {
    setLogger(logger: Logger): void {
        replyGenerator.setLogger(logger);
        rateLimiter.setLogger(logger);
        messageProcessor.setLogger(logger);
    }

    /**
     * Process an incoming WhatsApp DM.
     * Delegates to the shared platform-agnostic pipeline via the WhatsApp adapter.
     */
    async processMessage(
        whatsappPhoneNumberId: string,
        senderId: string,
        messageText: string,
        messageId: string,
        sharedPostUrl?: string,
        sharedPostId?: string,
        wasHandoffPaused?: boolean,
        attachmentRetries?: number,
        // Webhook `contacts[].profile.name` — WhatsApp's only name source
        // (no profile API), threaded through to the shared pipeline.
        senderName?: string,
    ): Promise<MessageResult> {
        return messageProcessor.processMessage(
            whatsappMessageAdapter, whatsappPhoneNumberId, senderId, messageText, messageId, sharedPostUrl, sharedPostId, wasHandoffPaused, attachmentRetries, senderName,
        );
    }
}

export const whatsappReplyService = new WhatsAppReplyService();
