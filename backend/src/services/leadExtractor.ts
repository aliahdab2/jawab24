import OpenAI from 'openai';
import { db } from '../db';
import { leads } from '../db/schema';
import { eq, and, desc, count, sql } from 'drizzle-orm';
import { captureError } from '../utils/sentryHelpers';
import { config } from '../config';
import { redis } from '../lib/redis';
import { publishSSEEvent } from '../lib/eventBus';
import { messagesService } from './messages';
import { notificationService } from './notifications';
import { logAiUsage } from './aiUsageLog';
import { getModelForUser } from './aiModelResolver';
import { recordAiAttempt, recordAiReturn, recordAiFailedBeforeLog } from '../lib/aiMetrics';
import { noopLogger } from '../types/logger';
import { extractPhoneFromText, DEFAULT_AI_MODEL } from '@jawab24/shared';
import type { LeadExtractedData, LeadStatus } from '@jawab24/shared';
import type { Logger } from '../types/logger';

// Daily AI extraction limit per workspace (prevents runaway costs on high-traffic pages)
const DAILY_EXTRACTION_LIMIT = 50;

export const EXTRACTION_PROMPT = `You are a lead-capture assistant. Analyze the conversation below and extract structured contact information.

Return ONLY valid JSON in this exact shape — no markdown, no explanation:
{
  "phone": "<compact digits with optional leading +, or empty string if unclear>",
  "summary": "<1-sentence summary of the customer's intent in the conversation language>",
  "fields": [
    { "key": "snake_case_key", "label_en": "English Label", "label_ar": "التسمية بالعربية", "value": "..." }
  ]
}

Rules:
- Include ONLY fields you can confidently extract from the conversation
- Examples by business type:
  - School/institute: course_of_interest, preferred_start_date, level
  - Clinic: specialty_needed, preferred_doctor, appointment_date
  - Store/service: product_interest, budget, location
- Never invent data not explicitly stated in the conversation
- If the phone number does not belong to the sender (e.g. they are sharing someone else's number), set "phone" to empty string
- Always include a "name" field if the customer mentioned their name
- Write the "summary" in the same language as the customer's text (Arabic if they wrote Arabic, English if English). NEVER write a meta-summary like "no conversation provided" or "not enough context" — if intent is unclear, write a short factual statement in the customer's language such as "العميل أرسل رقم هاتفه للتواصل" or "Customer shared their phone number for contact".

Conversation (last 20 messages):
<CONVERSATION>`;

export interface LeadRecord {
    id: string;
    pageId: string;
    sourceType: string;
    sourceId: string | null;
    senderId: string;
    senderName: string | null;
    phone: string;
    extractedData: LeadExtractedData;
    status: LeadStatus;
    extractionStatus: string;
    extractionAttempts: number;
    createdAt: Date;
    updatedAt: Date;
}

export interface MaybeCaptureLeadParams {
    pageId: string;
    userId: string;
    workspaceId: string;
    sourceId: string;
    sourceType: 'message' | 'comment';
    senderId: string;
    senderName?: string;
    messageText: string;
    /** Comment-only: the originating post text, gives the AI intent context
     *  when the comment itself is just a phone number with no other words. */
    postMessage?: string;
    /** Comment-only: the reply we just sent, so the AI sees a 2-turn exchange. */
    replyText?: string;
}

export interface LeadsPage {
    data: LeadRecord[];
    total: number;
}

class LeadExtractorService {
    private logger: Logger = noopLogger;
    private client: OpenAI | null = null;

    setLogger(logger: Logger): void {
        this.logger = logger;
    }

    private getClient(): OpenAI {
        if (!this.client) {
            if (!config.openai?.apiKey) {
                throw new Error('OPENAI_API_KEY not configured — lead extraction unavailable');
            }
            this.client = new OpenAI({ apiKey: config.openai.apiKey });
        }
        return this.client;
    }

    /**
     * Main entry point — called from messageProcessor and commentProcessor after reply.
     * Fire-and-forget: callers MUST NOT await this.
     */
    async maybeCaptureLead(params: MaybeCaptureLeadParams): Promise<void> {
        const { pageId, userId, workspaceId, sourceId, sourceType, senderId, senderName, messageText, postMessage, replyText } = params;

        // Gate: must contain a phone number
        const rawPhone = extractPhoneFromText(messageText);
        if (!rawPhone) return;

        try {
            // Gate: daily extraction limit per workspace
            const withinLimit = await this.checkAndIncrementDailyLimit(workspaceId);

            let extractedData: LeadExtractedData = { fields: [] };
            let extractionStatus: 'completed' | 'pending' = 'pending';

            let extractedPhone = rawPhone;

        if (withinLimit) {
                try {
                    let conversationText: string;
                    if (sourceType === 'comment') {
                        // Comments aren't in the messages table — fetching DM history by senderId
                        // returns nothing for a commenter who never DM'd the page, which made the AI
                        // emit a placeholder summary like "No conversation provided…". Build a
                        // single-turn exchange from the post + comment + reply instead, so the AI
                        // has real intent context even when the comment is just a phone number.
                        const lines: string[] = [];
                        if (postMessage) lines.push(`Post: ${postMessage}`);
                        lines.push(`Customer comment: ${messageText}`);
                        if (replyText) lines.push(`Agent reply: ${replyText}`);
                        conversationText = lines.join('\n');
                    } else {
                        const history = await messagesService.getConversationHistory(pageId, senderId, 20);
                        conversationText = history
                            .map(m => `${m.role === 'user' ? 'Customer' : 'Agent'}: ${m.content}`)
                            .join('\n');
                    }

                    const aiResult = await this.callExtractionAI(conversationText, rawPhone, { userId, pageId });
                    extractedPhone = aiResult.phone || rawPhone;
                    extractedData = { summary: aiResult.summary, fields: aiResult.fields };
                    extractionStatus = 'completed';
                } catch (aiError) {
                    // AI call failed — save lead with phone only, mark for retry
                    captureError(aiError, 'Lead AI extraction failed', {
                        tags: { service: 'leadExtractor', pageId },
                        extra: { senderId },
                    });
                    extractionStatus = 'pending';
                }
            } else {
                this.logger.warn('[leadExtractor] Daily extraction limit reached', { workspaceId });
                // Save lead with phone but skip AI — leave as pending for later
                extractionStatus = 'pending';
            }

            const { upserted, isNew } = await this.upsertLead({
                pageId,
                sourceId,
                sourceType,
                senderId,
                senderName,
                phone: extractedPhone || rawPhone,
                extractedData,
                extractionStatus,
            });

            this.logger.info('[leadExtractor] Lead captured', {
                leadId: upserted.id,
                pageId,
                senderId,
                isNew,
                extractionStatus,
            });

            // Notify workspace via SSE — real-time badge + toast in frontend
            publishSSEEvent(userId, 'lead:captured', {
                leadId: upserted.id,
                pageId,
                senderName: senderName ?? null,
                phone: upserted.phone,
            });

            // Persistent push + in-app bell entry — only for genuinely new leads,
            // so repeat messages from the same sender never re-notify. The push is
            // gated per-user by the `newLeadAlertsEnabled` setting (bell row still
            // stored when muted). Fire-and-forget, matching maybeCaptureLead's contract.
            if (isNew) {
                notificationService.sendTemplateNotificationToWorkspace(
                    workspaceId,
                    'new_lead',
                    { senderName: senderName || 'Unknown', phone: upserted.phone ?? '' },
                    { leadId: upserted.id, pageId, deepLink: '/leads' },
                    { gatePushBySetting: 'newLeadAlertsEnabled' },
                ).catch(err => this.logger.error('New lead notification failed', { err }));
            }
        } catch (error) {
            captureError(error, 'Lead capture failed', {
                tags: { service: 'leadExtractor', pageId },
                extra: { senderId },
            });
        }
    }

    private async checkAndIncrementDailyLimit(workspaceId: string): Promise<boolean> {
        try {
            const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
            const key = `leads:extraction:${workspaceId}:${today}`;
            const current = await redis.incr(key);
            if (current === 1) {
                await redis.expire(key, 86400); // TTL 24h
            }
            return current <= DAILY_EXTRACTION_LIMIT;
        } catch {
            // Redis unavailable — allow extraction rather than silently losing leads
            return true;
        }
    }

    private async callExtractionAI(
        conversation: string,
        rawPhone: string,
        logCtx: { userId: string; pageId: string },
    ): Promise<{ phone: string; summary?: string; fields: LeadExtractedData['fields'] }> {
        const prompt = EXTRACTION_PROMPT.replace('<CONVERSATION>', conversation);
        const client = this.getClient();

        // Per-customer model override: lead extraction speaks the OpenAI SDK
        // directly (no provider abstraction here — there's no tool use, just a
        // JSON-mode completion). The current allowlist is OpenAI-only, but the
        // `startsWith('gpt-')` guard is defense-in-depth in case the allowlist
        // ever grows to include non-OpenAI models — Claude IDs would 404 here,
        // and lead extraction must keep working even for a customer routed to
        // a non-OpenAI model on the reply pipeline.
        const resolved = await getModelForUser(logCtx.userId);
        const model = resolved.startsWith('gpt-') ? resolved : DEFAULT_AI_MODEL;
        recordAiAttempt('lead_extraction', model);
        let response;
        try {
            response = await client.chat.completions.create({
                model,
                messages: [{ role: 'user', content: prompt }],
                temperature: 0,
                max_tokens: 500,
                response_format: { type: 'json_object' },
            });
        } catch (err) {
            recordAiFailedBeforeLog('lead_extraction', model, 'OpenAIApiError');
            throw err;
        }
        recordAiReturn('lead_extraction', model);

        // Fire-and-forget cost log — same pattern as ai.ts:398
        const usage = response.usage;
        if (usage) {
            logAiUsage({
                userId: logCtx.userId,
                pageId: logCtx.pageId,
                model,
                tokensIn: usage.prompt_tokens ?? 0,
                cachedInputTokens: usage.prompt_tokens_details?.cached_tokens ?? 0,
                tokensOut: usage.completion_tokens ?? 0,
                cached: false,
                pipeline: 'lead_extraction',
            }).catch(() => { /* logged via Sentry breadcrumb inside logAiUsage */ });
        }

        const content = response.choices[0]?.message?.content;
        if (!content) throw new Error('Empty response from extraction AI');

        const parsed = JSON.parse(content) as {
            phone?: string;
            summary?: string;
            fields?: LeadExtractedData['fields'];
        };

        return {
            phone: parsed.phone || rawPhone,
            summary: parsed.summary,
            fields: Array.isArray(parsed.fields) ? parsed.fields : [],
        };
    }

    private async upsertLead(data: {
        pageId: string;
        sourceId: string;
        sourceType: 'message' | 'comment';
        senderId: string;
        senderName?: string;
        phone: string;
        extractedData: LeadExtractedData;
        extractionStatus: 'completed' | 'pending';
    }): Promise<{ upserted: LeadRecord; isNew: boolean }> {
        // Check if lead already exists for this sender+page
        const existing = await db
            .select({ id: leads.id })
            .from(leads)
            .where(and(eq(leads.senderId, data.senderId), eq(leads.pageId, data.pageId)))
            .limit(1);

        const isNew = existing.length === 0;

        const [upserted] = await db
            .insert(leads)
            .values({
                pageId: data.pageId,
                sourceId: data.sourceId,
                sourceType: data.sourceType,
                senderId: data.senderId,
                senderName: data.senderName ?? null,
                phone: data.phone,
                extractedData: data.extractedData,
                status: 'new',
                extractionStatus: data.extractionStatus,
                extractionAttempts: data.extractionStatus === 'pending' ? 1 : 0,
            })
            .onConflictDoUpdate({
                target: [leads.senderId, leads.pageId],
                set: {
                    phone: data.phone,
                    senderName: data.senderName ?? null,
                    sourceId: data.sourceId,
                    sourceType: data.sourceType,
                    extractedData: data.extractedData,
                    extractionStatus: data.extractionStatus,
                    extractionAttempts: sql`${leads.extractionAttempts} + 1`,
                    updatedAt: new Date(),
                },
            })
            .returning();

        return { upserted: upserted as LeadRecord, isNew };
    }

    // ─── Read operations for controller ───────────────────────────────────────

    async getLeadsByPage(
        pageId: string,
        options: { status?: LeadStatus; limit?: number; offset?: number },
    ): Promise<LeadsPage> {
        const { status, limit = 50, offset = 0 } = options;

        const whereClause = status
            ? and(eq(leads.pageId, pageId), eq(leads.status, status))
            : eq(leads.pageId, pageId);

        const [rows, [{ value: total }]] = await Promise.all([
            db
                .select()
                .from(leads)
                .where(whereClause)
                .orderBy(desc(leads.createdAt))
                .limit(limit)
                .offset(offset),
            db
                .select({ value: count() })
                .from(leads)
                .where(whereClause),
        ]);

        return { data: rows as LeadRecord[], total };
    }

    /**
     * Fetch every lead for a page (optionally filtered) in one call — used by CSV
     * export so the download isn't capped by the paginated list endpoint.
     * Iterates the existing paginated query in 500-row chunks to avoid loading
     * an unbounded result set into memory in a single SQL round-trip.
     */
    async getAllLeadsForExport(
        pageId: string,
        options: { status?: LeadStatus } = {},
    ): Promise<LeadRecord[]> {
        const CHUNK = 500;
        const all: LeadRecord[] = [];
        let offset = 0;
        for (;;) {
            const { data } = await this.getLeadsByPage(pageId, {
                status: options.status,
                limit: CHUNK,
                offset,
            });
            all.push(...data);
            if (data.length < CHUNK) break;
            offset += CHUNK;
        }
        return all;
    }

    async getNewLeadsCount(pageId: string): Promise<number> {
        const [{ value }] = await db
            .select({ value: count() })
            .from(leads)
            .where(and(eq(leads.pageId, pageId), eq(leads.status, 'new')));
        return value;
    }

    async updateLeadStatus(
        leadId: string,
        pageId: string,
        status: LeadStatus,
    ): Promise<LeadRecord | null> {
        const [updated] = await db
            .update(leads)
            .set({ status, updatedAt: new Date() })
            .where(and(eq(leads.id, leadId), eq(leads.pageId, pageId)))
            .returning();
        return (updated as LeadRecord) ?? null;
    }

    async deleteLead(leadId: string, pageId: string): Promise<boolean> {
        const result = await db
            .delete(leads)
            .where(and(eq(leads.id, leadId), eq(leads.pageId, pageId)))
            .returning({ id: leads.id });
        return result.length > 0;
    }

    async deleteLeadsBySender(senderId: string, pageId: string): Promise<void> {
        await db
            .delete(leads)
            .where(and(eq(leads.senderId, senderId), eq(leads.pageId, pageId)));
    }
}

export const leadExtractorService = new LeadExtractorService();
