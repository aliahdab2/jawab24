import OpenAI from 'openai';
import { db } from '../db';
import { leads, pages } from '../db/schema';
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
import { extractPhones, extractCustomerPhones, DEFAULT_AI_MODEL } from '@jawab24/shared';
import type { LeadExtractedData, LeadStatus } from '@jawab24/shared';
import type { Logger } from '../types/logger';
import { workspaceSettingsService } from './workspaceSettings';
import { countryFromTimezone } from '../utils/phoneRegion';

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
- The conversation is labelled "Customer:" (the lead) and "Agent:" (the business's own replies). Extract the phone and EVERY field ONLY from what the Customer said. The Agent turns are the merchant's own messages — their catalogue, prices, schedules, and the business's OWN contact number — they are context to understand the Customer, NEVER a source of lead data.
- If the Customer merely quotes, forwards, or pastes the Agent's message back (e.g. asking to translate or confirm it), that quoted text is NOT the Customer's own data — do not extract a phone or fields from it. Set "phone" to empty string when the only number present is the business's own (a number the Agent already wrote).
- Include ONLY fields you can confidently extract from the Customer's own words
- Examples by business type:
  - School/institute: course_of_interest, preferred_start_date, level
  - Clinic: specialty_needed, preferred_doctor, appointment_date
  - Store/service: product_interest, budget, location
- Never invent data not explicitly stated by the Customer
- If the phone number does not belong to the sender (e.g. they are sharing someone else's number, or it is the business's own line), set "phone" to empty string
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
    /** Workspace-defined sub-stage id (see settings.leadStages), or null. */
    subStage: string | null;
    /** Merchant-entered values for settings.leadFields, keyed by field id. */
    customFields: Record<string, string> | null;
    extractionStatus: string;
    extractionAttempts: number;
    /** Re-engagement: true when an existing lead came back (re-shared a number or
     *  showed new purchase intent). Non-destructive — independent of `status`. */
    needsFollowUp: boolean;
    /** Why the lead is flagged for follow-up, or null. */
    followUpReason: string | null;
    /** When the lead was last flagged for follow-up, or null. */
    followUpAt: Date | null;
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

        // Derive the merchant's region from their timezone so bare national
        // numbers (e.g. "0501234567") validate against the right numbering plan.
        // An explicit +CC the customer types always overrides this hint. Settings
        // are Redis-cached; if the lookup fails we degrade to region-less
        // extraction (+CC + permissive fallback) rather than dropping the lead.
        let defaultCountry: string | undefined;
        try {
            const settings = await workspaceSettingsService.getSettings(workspaceId);
            defaultCountry = countryFromTimezone(settings.timezone);
        } catch (err) {
            this.logger.debug('lead phone region lookup failed; using region-less extraction', { err, workspaceId });
        }

        const phoneOpts = defaultCountry ? { defaultCountry } : undefined;

        // Cheap pre-gate: skip the common no-phone message before any DB work.
        if (extractPhones(messageText, phoneOpts).length === 0) return;

        try {
            // The business's OWN published numbers — a customer who shares the merchant's
            // ad post, pastes the number, or quotes our reply drags one of these into
            // their message. Excluding them is what keeps a lead built only from the
            // customer's input, never from our answers. (June 2026 prod: a customer pasted
            // our ICDL reply to translate it; others forwarded the merchant's ad post —
            // both spawned leads whose call/WhatsApp buttons dialled the merchant's own
            // line.) Sourced page-wide from Business Info (KB), where the merchant lists
            // their contact lines, PLUS the merchant-authored turns of THIS conversation.
            const businessPhones = await this.getBusinessPhones(pageId, phoneOpts);

            let conversationText: string;
            let businessTexts: string[];
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
                // The post and our reply are merchant-authored — any number there is ours.
                businessTexts = [postMessage, replyText, ...businessPhones].filter((t): t is string => !!t);
            } else {
                const history = await messagesService.getConversationHistory(pageId, senderId, 20);
                conversationText = history
                    .map(m => `${m.role === 'user' ? 'Customer' : 'Agent'}: ${m.content}`)
                    .join('\n');
                // Our outgoing replies publish the business's own contact number(s).
                businessTexts = [...history.filter(m => m.role === 'assistant').map(m => m.content), ...businessPhones];
            }

            // Real gate: the customer must share a phone that is THEIRS, not the
            // business's own number echoed from our replies. Empty → no lead.
            const rawPhone = extractCustomerPhones(messageText, businessTexts, phoneOpts)[0]?.raw ?? null;
            if (!rawPhone) return;

            // Gate: daily extraction limit per workspace
            const withinLimit = await this.checkAndIncrementDailyLimit(workspaceId);

            let extractedData: LeadExtractedData = { fields: [] };
            let extractionStatus: 'completed' | 'pending' = 'pending';

            let extractedPhone = rawPhone;

            if (withinLimit) {
                try {
                    const aiResult = await this.callExtractionAI(conversationText, { userId, pageId });
                    // Trust the AI's phone ONLY when it re-validates as a real phone AND
                    // isn't the business's own number — the model can lift our published
                    // line out of an "Agent:" turn, and it occasionally drops a non-phone
                    // figure (e.g. a course fee like "2500000") into the field. Otherwise
                    // keep the validated customer gate phone, which is guaranteed to be the
                    // customer's own and never a price or our own number. An empty AI phone
                    // (the model's "not the sender's number" signal) also keeps the gate phone.
                    const aiPhone = aiResult.phone
                        ? extractCustomerPhones(aiResult.phone, businessTexts, phoneOpts)[0]?.raw ?? null
                        : null;
                    extractedPhone = aiPhone ?? rawPhone;
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

            if (isNew) {
                // SSE: real-time badge + toast for a brand-new lead.
                publishSSEEvent(userId, 'lead:captured', {
                    leadId: upserted.id,
                    pageId,
                    senderName: senderName ?? null,
                    phone: upserted.phone,
                });
                // Persistent push + in-app bell entry. Gated per-user by the
                // `newLeadAlertsEnabled` setting (bell row still stored when muted).
                notificationService.sendTemplateNotificationToWorkspace(
                    workspaceId,
                    'new_lead',
                    { senderName: senderName || 'Unknown', phone: upserted.phone ?? '' },
                    // Deep-link to the exact lead so the bell opens that customer's
                    // card directly (the leads page reads ?leadId via useUrlSelectedResource),
                    // rather than dropping the merchant on the unfiltered list.
                    { leadId: upserted.id, pageId, deepLink: `/leads?leadId=${upserted.id}` },
                    { gatePushBySetting: 'newLeadAlertsEnabled' },
                ).catch(err => this.logger.error('New lead notification failed', { err }));
            } else if (upserted.status !== 'new') {
                // Re-engagement: a lead the merchant ALREADY handled (contacted/
                // converted) shared a phone again — a genuine "came back". upsertLead
                // flagged needsFollowUp non-destructively; surface it (deduped).
                // A lead still in 'new' is mid-initial-capture (e.g. several phone
                // messages in one conversation), NOT returning — so we don't notify.
                await this.notifyReengaged({
                    userId, workspaceId, leadId: upserted.id, pageId,
                    senderName, phone: upserted.phone, reason: 'reshared_contact',
                });
            }
        } catch (error) {
            captureError(error, 'Lead capture failed', {
                tags: { service: 'leadExtractor', pageId },
                extra: { senderId },
            });
        }
    }

    /**
     * Surface a re-engaged lead: SSE badge/toast + a `lead_reengaged` push, deduped
     * to at most once per lead per 24h so a burst of messages never spams. Shared by
     * the phone-reshare and intent paths. Fire-and-forget contract.
     */
    private async notifyReengaged(p: {
        userId: string;
        workspaceId: string;
        leadId: string;
        pageId: string;
        senderName?: string;
        phone?: string | null;
        reason: 'reshared_contact' | 'returned_intent';
    }): Promise<void> {
        // Dedup window — Redis down → allow (never silently lose the signal).
        let fresh: string | null = 'OK';
        try {
            fresh = await redis.set(`lead:reengaged:${p.leadId}`, '1', 'EX', 86400, 'NX');
        } catch {
            fresh = 'OK';
        }
        if (fresh !== 'OK') return;

        publishSSEEvent(p.userId, 'lead:re_engaged', {
            leadId: p.leadId,
            pageId: p.pageId,
            senderName: p.senderName ?? null,
            phone: p.phone ?? null,
            reason: p.reason,
        });

        notificationService.sendTemplateNotificationToWorkspace(
            p.workspaceId,
            'lead_reengaged',
            { senderName: p.senderName || 'Unknown' },
            { leadId: p.leadId, pageId: p.pageId, deepLink: `/leads?leadId=${p.leadId}`, urgent: true },
            { gatePushBySetting: 'newLeadAlertsEnabled' },
        ).catch(err => this.logger.error('Lead re-engaged notification failed', { err }));
    }

    /**
     * The business's own published phone numbers for a page, so lead capture never
     * mistakes one for a customer contact. Read from `pages.knowledge_base` — the
     * merchant's Business Info, the same source the reply pipeline uses, where they
     * list their contact lines. Cached in Redis for an hour (the KB changes rarely
     * and this runs on every phone-bearing message). Degrades to [] on any DB/Redis
     * error: the conversation-scoped exclusion still applies and we never drop a lead.
     */
    private async getBusinessPhones(
        pageId: string,
        phoneOpts?: { defaultCountry?: string },
    ): Promise<string[]> {
        const cacheKey = `lead:bizphones:${pageId}`;
        try {
            const cached = await redis.get(cacheKey);
            if (cached) return JSON.parse(cached) as string[];
        } catch {
            // Redis miss/down — fall through to the DB read.
        }

        let phones: string[];
        try {
            const [page] = await db
                .select({ kb: pages.knowledgeBase })
                .from(pages)
                .where(eq(pages.id, pageId))
                .limit(1);
            // A KB-less page has no business numbers — cache the empty result too,
            // so it doesn't re-query on every phone-bearing message. (extractPhones
            // already de-duplicates within a single text.)
            phones = page?.kb ? extractPhones(page.kb, phoneOpts).map(p => p.raw) : [];
        } catch (err) {
            // Transient DB error — return WITHOUT caching so the next call retries.
            this.logger.warn('business-phone KB lookup failed; conversation-scoped exclusion only', { err, pageId });
            return [];
        }

        try {
            await redis.set(cacheKey, JSON.stringify(phones), 'EX', 3600);
        } catch {
            // Best-effort cache; correctness doesn't depend on it.
        }
        return phones;
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
            // Raw AI phone (empty when the model omits it or judges it isn't the
            // sender's). Coerced to a string in case the model emits a bare number.
            // The caller re-validates this before trusting it over the gate phone.
            phone: String(parsed.phone ?? ''),
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
                    // Re-engagement (non-destructive): flag for follow-up ONLY when the
                    // merchant already moved this lead past 'new' (contacted/converted)
                    // — i.e. they handled it and the customer came BACK. A lead still in
                    // 'new' is mid-initial-capture (several phone messages in one
                    // conversation), not "returning". Status is never touched; the flag
                    // clears when the merchant next changes status.
                    needsFollowUp: sql`CASE WHEN ${leads.status} <> 'new' THEN true ELSE ${leads.needsFollowUp} END`,
                    followUpReason: sql`CASE WHEN ${leads.status} <> 'new' THEN 'reshared_contact' ELSE ${leads.followUpReason} END`,
                    followUpAt: sql`CASE WHEN ${leads.status} <> 'new' THEN now() ELSE ${leads.followUpAt} END`,
                    updatedAt: new Date(),
                },
            })
            .returning();

        return { upserted: upserted as LeadRecord, isNew };
    }

    // ─── Read operations for controller ───────────────────────────────────────

    async getLeadsByPage(
        pageId: string,
        options: { status?: LeadStatus; needsFollowUp?: boolean; limit?: number; offset?: number },
    ): Promise<LeadsPage> {
        const { status, needsFollowUp, limit = 50, offset = 0 } = options;

        const conditions = [eq(leads.pageId, pageId)];
        if (status) conditions.push(eq(leads.status, status));
        if (needsFollowUp !== undefined) conditions.push(eq(leads.needsFollowUp, needsFollowUp));
        const whereClause = and(...conditions);

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

    /** Fetch a single lead by id. The controller verifies the lead's page belongs to the caller's workspace. */
    async getLeadById(leadId: string): Promise<LeadRecord | null> {
        const [row] = await db
            .select()
            .from(leads)
            .where(eq(leads.id, leadId))
            .limit(1);
        return (row as LeadRecord) ?? null;
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
        // Always written: changing the main status without picking a sub-stage
        // must clear any previous sub-stage (it belonged to the old status).
        subStage: string | null = null,
    ): Promise<LeadRecord | null> {
        const [updated] = await db
            .update(leads)
            // Changing status = the merchant acted on the lead, so clear the
            // re-engagement follow-up flag (it resurfaces again on the next return).
            .set({ status, subStage, needsFollowUp: false, followUpReason: null, updatedAt: new Date() })
            .where(and(eq(leads.id, leadId), eq(leads.pageId, pageId)))
            .returning();
        // Reset the notify dedup window too: now that the merchant handled it, a
        // genuine new return should ping again (even within the original 24h).
        redis.del(`lead:reengaged:${leadId}`).catch(() => { /* best-effort */ });
        return (updated as LeadRecord) ?? null;
    }

    async updateLeadCustomFields(
        leadId: string,
        pageId: string,
        // Full replacement, not a merge — the detail panel always sends every
        // field it shows, so a cleared input genuinely deletes the value.
        customFields: Record<string, string> | null,
    ): Promise<LeadRecord | null> {
        const [updated] = await db
            .update(leads)
            .set({ customFields, updatedAt: new Date() })
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
