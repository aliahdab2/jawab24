/**
 * Reaction dispatcher — encapsulates the "react instead of reply" short-circuit.
 *
 * Given an incoming message, decides whether it's a pure acknowledgment
 * ("thanks", "ok"), and if so sends a Messenger emoji reaction on the
 * customer's message rather than running the AI generator. Saves an OpenAI
 * call and produces a more human-feeling interaction.
 *
 * Runs only on platforms whose adapter exposes `sendReaction` (Messenger
 * today; Instagram's DM API has no reactions endpoint).
 */
import { messagesService } from '../messages';
import { pipelineMetrics, type Pipeline } from '../../lib/pipelineMetrics';
import type { MessagePlatformAdapter, MessageResult, PlatformPage } from '../../interfaces';
import type { Logger } from '../../types';
import { detectAck, type AckKind } from './ackDetector';

interface DispatchInput {
    adapter: MessagePlatformAdapter;
    page: PlatformPage;
    senderId: string;
    platformMessageId: string;
    messageText: string;
    storedMessageId: string;
    pipeline: Pipeline;
    logger: Logger;
    startedAt: number;
}

interface DispatchOutcome {
    handled: boolean;
    result?: MessageResult;
}

const REACTION_FOR: Record<AckKind, 'love' | 'like'> = {
    thanks: 'love',
    ok: 'like',
};

const REACTION_LABEL: Record<AckKind, '❤️' | '👍'> = {
    thanks: '❤️',
    ok: '👍',
};

/**
 * Returns `{ handled: true, result }` when a reaction was sent (caller must
 * return `result` from its processing function and skip the AI path).
 * Returns `{ handled: false }` when the message wasn't an ack, the adapter
 * doesn't support reactions, or the reaction send failed and the AI fallback
 * should run instead.
 */
/**
 * Kill switch — set `ENABLE_REACTION_REPLIES=false` in the environment to
 * disable the ack→reaction short-circuit globally. Lets ops disable this
 * heuristic in production without a code rollback if it ever misfires.
 * Defaults to enabled.
 */
function reactionsEnabled(): boolean {
    return process.env.ENABLE_REACTION_REPLIES !== 'false';
}

export async function maybeDispatchReaction(input: DispatchInput): Promise<DispatchOutcome> {
    const { adapter, page, senderId, platformMessageId, messageText, storedMessageId, pipeline, logger, startedAt } = input;

    if (!reactionsEnabled()) return { handled: false };
    if (!adapter.sendReaction) return { handled: false };

    const ack = detectAck(messageText);
    if (!ack) return { handled: false };

    const reaction = REACTION_FOR[ack.kind];
    const label = REACTION_LABEL[ack.kind];

    try {
        await adapter.sendReaction(page, senderId, platformMessageId, reaction);
        await messagesService.markAsReplied(storedMessageId, label, 'reaction');
        pipelineMetrics.record(pipeline, 'reaction_sent');
        logger.info(`[${adapter.platform}] reaction_sent`, {
            event: 'reaction_sent',
            pipeline,
            platform: adapter.platform,
            pageId: page.id,
            senderId,
            ack: ack.kind,
            reaction,
            durationMs: Date.now() - startedAt,
        });
        return {
            handled: true,
            result: {
                success: true,
                messageId: platformMessageId,
                replyText: label,
                replyMethod: 'reaction',
            },
        };
    } catch (error) {
        // Reaction send failed — let the normal AI reply path take over.
        logger.warn(`[${adapter.platform}] sendReaction failed — falling back to AI reply`, {
            error: String(error),
            ack: ack.kind,
        });
        return { handled: false };
    }
}
