import OpenAI, { APIError, toFile } from 'openai';
import * as Sentry from '@sentry/node';
import { config } from '../config';
import { captureError } from '../utils/sentryHelpers';
import { recordAiAttempt, recordAiReturn, recordAiFailedBeforeLog } from '../lib/aiMetrics';
import { isTimeoutAbort } from '@jawab24/shared';
import { detectLanguage } from '../utils/language';
import { logAiUsage } from './aiUsageLog';
import { fetchMediaBuffer, MediaDownloadError } from '../utils/mediaDownload';

/** Maximum time to download audio from Facebook/Instagram CDN */
const DOWNLOAD_TIMEOUT_MS = 10_000;
/** Maximum time for Whisper API transcription (pipeline: short voice messages) */
const WHISPER_TIMEOUT_MS = 15_000;
/** Maximum time for KB voice transcription (longer recordings, up to 60s audio) */
const KB_TRANSCRIBE_TIMEOUT_MS = 60_000;
/** Maximum audio file size (10 MB) — prevents OOM from malformed responses */
export const MAX_AUDIO_BYTES = 10 * 1024 * 1024;

/**
 * OpenAI recommends gpt-4o-mini-transcribe over gpt-4o-transcribe (Jan 2026 changelog).
 * 89% fewer hallucinations vs whisper-1, 35% lower WER, half the cost.
 *
 * No `prompt` parameter — it caused the model to hallucinate the prompt text
 * instead of transcribing the actual audio. The `language` hint alone is sufficient.
 */
const MODEL_TRANSCRIBE = 'gpt-4o-mini-transcribe';

export type TranscriptionQuality = 'fast' | 'accurate';

export interface TranscriptionResult {
    text: string;
}

/**
 * Who to bill the transcription call to. Optional so internal/utility callers
 * can transcribe without attribution, but the real callers (DM voice handler,
 * KB voice route) always pass it so the OpenAI cost lands in `ai_usage_log`.
 */
export interface TranscriptionLogContext {
    userId: string;
    /** Internal pages.id (FK) — omit for workspace-level KB voice input. */
    pageId?: string;
}

/**
 * Token usage returned by gpt-4o-mini-transcribe (default `response_format: json`).
 * Typed locally because the call is billed per token, not per minute.
 */
interface TranscriptionUsage {
    input_tokens?: number;
    output_tokens?: number;
}

/**
 * Build the transcription params shared by both methods.
 * Only passes model + language hint. No prompt — let the model transcribe freely.
 */
function buildTranscribeParams(file: Awaited<ReturnType<typeof toFile>>, languageHint?: string) {
    return {
        file,
        model: MODEL_TRANSCRIBE,
        ...(languageHint ? { language: languageHint } : {}),
        temperature: 0,
    };
}

/**
 * Does the transcript's script agree with the language we asked for?
 *
 * The `language` param is a HINT to gpt-4o-mini-transcribe, not a constraint: on
 * a short or noisy Arabic voice note the model still emits Turkish, Chinese or
 * Latin gibberish («Alıştırakstanı», «好了好了好了», «Tavar ma ba harijina») —
 * 7 of 35 WhatsApp voice notes on one Yemeni page, 2026-08-29. On the DM path
 * that text is treated as the customer's words: the reply pipeline mirrored it
 * and SENT a Turkish reply to an Arabic-speaking customer.
 *
 * This is only a PREDICATE. Whether a mismatch is acted on is the caller's
 * decision — see `strictLanguage` on `acceptTranscript`: the DM voice handlers
 * enforce it (a mismatched transcript is worth less than no transcript there),
 * but KB voice input does NOT, because its hint is the merchant's UI locale, not
 * a reading of the audio — a merchant on the Arabic UI dictating English product
 * names must not have their recording silently dropped.
 *
 * Deliberately ONLY the Arabic hint is checked — this is not an en/ar assumption.
 * Jawab24 is multi-language, but Arabic is the one hint whose script (a distinct
 * Unicode block) can be validated with near-zero false-discards. Latin-script
 * languages — 'en' today, any 'fr'/'tr'/… tomorrow — can't be told apart from
 * each other or from gibberish on a short transcript (the same reason the reply
 * detector has an en@0.5 Latin floor), so a script check there would wrongly drop
 * valid recordings. Any non-'ar' hint therefore passes unchecked. An Arabic
 * transcript under a non-Arabic hint also passes: the hint is a default (from the
 * sender's PREVIOUS text), not proof of this utterance. Letter-free output (a card
 * code, «111») has no script to judge and matches.
 */
export function transcriptMatchesHint(text: string, languageHint?: string): boolean {
    if (languageHint !== 'ar') return true;
    if (!/\p{L}/u.test(text)) return true;
    return detectLanguage(text).script === 'Arabic';
}

/** Map audio MIME type to file extension for OpenAI transcription API */
function mimeToExtension(mimeType: string): string {
    if (mimeType.includes('webm')) return 'webm';
    if (mimeType.includes('ogg')) return 'ogg';
    if (mimeType.includes('mpeg') || mimeType.includes('mp3')) return 'mp3';
    if (mimeType.includes('wav')) return 'wav';
    if (mimeType.includes('aac')) return 'aac';
    if (mimeType.includes('m4a') || mimeType.includes('x-m4a')) return 'm4a';
    return 'mp4';
}

/**
 * Sniff the audio container from the buffer's magic bytes. Facebook's CDN
 * occasionally serves voice attachments with a generic or wrong Content-Type,
 * and Whisper rejects the file if extension/MIME don't match the actual bytes.
 * Returns null if the buffer is not a recognized audio container (e.g. HTML
 * error page returned by an expired CDN URL).
 */
function sniffAudioFormat(buffer: Buffer): { ext: string; mime: string } | null {
    if (buffer.length < 12) return null;

    // ISO BMFF (mp4/m4a): bytes 4..7 === 'ftyp'
    if (buffer.subarray(4, 8).toString('ascii') === 'ftyp') {
        const brand = buffer.subarray(8, 12).toString('ascii');
        if (brand.startsWith('M4A') || brand === 'mp42') return { ext: 'm4a', mime: 'audio/mp4' };
        return { ext: 'mp4', mime: 'audio/mp4' };
    }
    // OGG: 'OggS'
    if (buffer.subarray(0, 4).toString('ascii') === 'OggS') return { ext: 'ogg', mime: 'audio/ogg' };
    // EBML (WebM/Matroska): 1A 45 DF A3
    if (buffer[0] === 0x1a && buffer[1] === 0x45 && buffer[2] === 0xdf && buffer[3] === 0xa3) {
        return { ext: 'webm', mime: 'audio/webm' };
    }
    // RIFF/WAVE
    if (
        buffer.subarray(0, 4).toString('ascii') === 'RIFF' &&
        buffer.subarray(8, 12).toString('ascii') === 'WAVE'
    ) {
        return { ext: 'wav', mime: 'audio/wav' };
    }
    // MP3: 'ID3' tag or MPEG sync (0xFF 0xFB/0xF3/0xF2)
    if (buffer.subarray(0, 3).toString('ascii') === 'ID3') return { ext: 'mp3', mime: 'audio/mpeg' };
    if (buffer[0] === 0xff && (buffer[1] & 0xe0) === 0xe0) {
        // AAC ADTS shares the sync word; layer bits distinguish them
        const layer = (buffer[1] >> 1) & 0x03;
        if (layer === 0) return { ext: 'aac', mime: 'audio/aac' };
        return { ext: 'mp3', mime: 'audio/mpeg' };
    }
    return null;
}

class TranscriptionService {
    private client: OpenAI | null = null;

    private getClient(): OpenAI | null {
        if (!this.client && config.openai.apiKey) {
            this.client = new OpenAI({ apiKey: config.openai.apiKey });
        }
        return this.client;
    }

    /**
     * Record the transcription's OpenAI cost in `ai_usage_log`. Called once per
     * successful API return (the call is billed even when the transcript is empty).
     * Fire-and-forget — never blocks or fails the transcription. Until this was
     * wired up, voice transcription was the one OpenAI call site with zero cost
     * rows, so its spend was invisible to per-page cost tracking.
     */
    private logUsage(
        logCtx: TranscriptionLogContext | undefined,
        transcription: { usage?: unknown },
    ): void {
        // Hard guarantee: cost logging must NEVER disturb the transcription result.
        // This runs synchronously inside transcribe()'s try block, so any throw here
        // would be caught as a transcription failure and discard an already-successful
        // transcript. Wrap the whole body so the voice path is isolated from it.
        try {
            if (!logCtx) {
                // No attribution context — real callers always pass one; guard so a
                // new unattributed code path is visible rather than silently uncosted.
                Sentry.addBreadcrumb({
                    category: 'ai_usage_log',
                    level: 'warning',
                    message: 'transcription usage skipped: no logCtx',
                    data: { model: MODEL_TRANSCRIBE },
                });
                return;
            }
            // The SDK types `usage` as a Tokens | Duration union (whisper returns a
            // duration; the gpt-4o-*-transcribe models return tokens). Narrow to the
            // token shape — that's what gpt-4o-mini-transcribe sends and what we bill on.
            const raw = transcription.usage;
            const usage = (raw && typeof raw === 'object' && 'input_tokens' in raw)
                ? (raw as TranscriptionUsage)
                : undefined;
            if (!usage) {
                // gpt-4o-mini-transcribe returns token usage by default; absence means
                // an OpenAI/SDK change — surface it instead of silently logging $0.
                Sentry.addBreadcrumb({
                    category: 'ai_usage_log',
                    level: 'warning',
                    message: 'transcription returned no usage tokens',
                    data: { model: MODEL_TRANSCRIBE },
                });
            }
            logAiUsage({
                userId: logCtx.userId,
                pageId: logCtx.pageId,
                model: MODEL_TRANSCRIBE,
                tokensIn: usage?.input_tokens ?? 0,
                tokensOut: usage?.output_tokens ?? 0,
                cached: false,
                pipeline: 'transcription',
            }).catch(() => { /* breadcrumb emitted inside logAiUsage on failure */ });
        } catch (err) {
            captureError(err instanceof Error ? err : new Error(String(err)), 'transcription usage log failed', { tags: { service: 'transcription' } });
        }
    }

    /**
     * Turn the API's text into a result, or null when there is nothing usable.
     * Shared by both call paths so the empty check and the script check can never
     * drift apart between them (the URL path and the buffer path already shipped
     * one classification bug each — §13c).
     *
     * `strictLanguage` (DM voice handlers only) additionally discards a transcript
     * whose script contradicts an Arabic hint. It is OFF by default so KB voice
     * input — whose hint is the merchant's UI locale, not a reading of the audio —
     * keeps a successful transcript even when it is not Arabic.
     *
     * Runs AFTER `logUsage`: the call was billed whatever we decide about the text.
     */
    private acceptTranscript(
        rawText: string | undefined,
        languageHint?: string,
        strictLanguage = false,
    ): TranscriptionResult | null {
        const text = rawText?.trim();
        if (!text) return null;

        if (strictLanguage && !transcriptMatchesHint(text, languageHint)) {
            const script = detectLanguage(text).script;
            console.warn('[transcription] transcript script contradicts language hint — discarding', {
                languageHint, script, textLength: text.length,
            });
            // One fingerprinted WARNING so a rate change is visible in Sentry without
            // paging per voice note — same treatment as the 400 / timeout cases.
            captureError(
                new Error(`Transcript script ${script} contradicts hint ${languageHint}`),
                'Transcription language mismatch',
                {
                    level: 'warning',
                    fingerprint: ['transcription-language-mismatch'],
                    tags: { service: 'transcription' },
                    extra: { languageHint, script, textLength: text.length },
                },
            );
            return null;
        }

        return { text };
    }

    /**
     * Transcribe an audio file from a URL using OpenAI transcription.
     * Returns the transcription text or null on any failure.
     *
     * @param audioUrl - Direct URL to the audio file (Facebook includes access token)
     * @param languageHint - ISO 639-1 code ('ar', 'en') to improve accuracy
     */
    async transcribe(
        audioUrl: string,
        languageHint?: string,
        _quality?: TranscriptionQuality,
        logCtx?: TranscriptionLogContext,
        // DM voice handlers pass true so a transcript whose script contradicts an
        // Arabic hint is discarded (customer's words drive the reply). KB voice
        // input leaves it false — see acceptTranscript.
        strictLanguage = false,
    ): Promise<TranscriptionResult | null> {
        const client = this.getClient();
        if (!client) return null;

        // Declared out here (not next to the API call) so the outer catch can ask
        // the signal whether OUR timeout fired — the OpenAI SDK's abort error is
        // indistinguishable by name. See isTimeoutAbort for the full story.
        const transcribeController = new AbortController();

        try {
            // 1. Download audio (shared media downloader: abort timeout + size cap)
            let audioBuffer: Buffer;
            let contentType: string;
            try {
                ({ buffer: audioBuffer, contentType } = await fetchMediaBuffer(audioUrl, {
                    maxBytes: MAX_AUDIO_BYTES,
                    timeoutMs: DOWNLOAD_TIMEOUT_MS,
                }));
            } catch (error) {
                if (error instanceof MediaDownloadError && error.reason === 'not_ok') {
                    captureError(
                        new Error(`Audio download failed: ${error.status}`),
                        'Transcription audio download failed',
                        { tags: { service: 'transcription' } },
                    );
                    return null;
                }
                if (error instanceof MediaDownloadError && error.reason === 'too_large') {
                    captureError(error, 'Transcription audio too large', { tags: { service: 'transcription' } });
                    return null;
                }
                // Network / timeout: preserve the prior behavior where this path
                // recorded a failed_before_log metric before any OpenAI call (kept
                // as-is so Phase-6.5 gap analysis is unchanged).
                recordAiFailedBeforeLog('transcription', MODEL_TRANSCRIBE, 'OpenAIApiError');
                const isTimeout = error instanceof MediaDownloadError && error.reason === 'timeout';
                captureError(
                    error instanceof Error ? error : new Error(String(error)),
                    isTimeout ? 'Transcription timeout' : 'Transcription failed',
                    { tags: { service: 'transcription' } },
                );
                return null;
            }

            if (audioBuffer.length === 0) return null;

            // Validate that what we downloaded actually looks like audio. FB CDN
            // occasionally returns HTML error pages or truncated buffers with a
            // misleading Content-Type; sending those to Whisper produces a 400.
            const sniffed = sniffAudioFormat(audioBuffer);
            if (!sniffed && !contentType.startsWith('audio/') && !contentType.startsWith('video/')) {
                // Not audio at all (likely HTML/JSON error page). Skip without
                // paging Sentry, but warn so a wider CDN incident still leaves
                // a trail in app logs.
                console.warn('[transcription] skipped non-audio response', {
                    contentType,
                    byteLength: audioBuffer.length,
                    firstBytes: audioBuffer.subarray(0, 16).toString('hex'),
                });
                return null;
            }

            // Prefer magic-byte sniffing over the Content-Type header — the bytes
            // are authoritative. Fall back to the header when sniffing is
            // inconclusive (e.g. an unrecognized codec inside an audio/* type).
            const filename = sniffed ? `voice.${sniffed.ext}` : `voice.${mimeToExtension(contentType)}`;
            const fileType = sniffed ? sniffed.mime : (contentType || 'audio/mp4');

            // 2. Send to transcription API with its own timeout
            const transcribeTimer = setTimeout(() => transcribeController.abort(), WHISPER_TIMEOUT_MS);

            try {
                const file = await toFile(audioBuffer, filename, { type: fileType });
                recordAiAttempt('transcription', MODEL_TRANSCRIBE);
                const transcription = await client.audio.transcriptions.create(
                    buildTranscribeParams(file, languageHint),
                    { signal: transcribeController.signal },
                );
                recordAiReturn('transcription', MODEL_TRANSCRIBE);
                // Log the cost BEFORE the empty-text check — OpenAI billed the call
                // regardless of whether the transcript came back empty.
                this.logUsage(logCtx, transcription);

                return this.acceptTranscript(transcription.text, languageHint, strictLanguage);
            } finally {
                clearTimeout(transcribeTimer);
            }
        } catch (error) {
            const isTimeout = isTimeoutAbort(transcribeController.signal);
            recordAiFailedBeforeLog('transcription', MODEL_TRANSCRIBE, isTimeout ? 'AiTimeoutError' : 'OpenAIApiError');
            // Whisper 400 means the audio bytes themselves are bad (truncated,
            // unsupported codec, etc.). We already fall back gracefully, so
            // capture as a fingerprinted WARNING (one grouped issue, alert on
            // frequency) — a sudden spike (e.g. our own buffer handling
            // regresses) becomes visible in Sentry without paging per event.
            if (error instanceof APIError && error.status === 400) {
                console.warn('[transcription] OpenAI 400, returning null', {
                    message: error.message,
                });
                captureError(error, 'Transcription OpenAI 400', {
                    level: 'warning',
                    fingerprint: ['transcription-openai-400'],
                    tags: { service: 'transcription' },
                    extra: { message: error.message },
                });
                return null;
            }

            // Our WHISPER_TIMEOUT_MS fired: the voice note falls back to the nudge
            // path, so a single slow call is a degradation, not an incident. Same
            // treatment as the 400 above — one fingerprinted WARNING to alert on
            // frequency instead of an error-level page per event.
            if (isTimeout) {
                console.warn('[transcription] OpenAI transcription timed out', {
                    timeoutMs: WHISPER_TIMEOUT_MS,
                });
                captureError(
                    error instanceof Error ? error : new Error(String(error)),
                    'Transcription timeout',
                    {
                        level: 'warning',
                        fingerprint: ['transcription-openai-timeout'],
                        tags: { service: 'transcription' },
                        extra: { timeoutMs: WHISPER_TIMEOUT_MS },
                    },
                );
                return null;
            }

            captureError(
                error instanceof Error ? error : new Error(String(error)),
                'Transcription failed',
                { tags: { service: 'transcription' } },
            );
            return null;
        }
    }

    /**
     * Transcribe audio from a raw buffer (e.g. browser MediaRecorder blob).
     * Used for KB voice input where audio is uploaded directly.
     *
     * @param audioBuffer - Raw audio bytes (webm/ogg/mp4)
     * @param mimeType - MIME type from the browser (e.g. 'audio/webm')
     * @param languageHint - ISO 639-1 code ('ar', 'en') to improve accuracy
     */
    async transcribeFromBuffer(
        audioBuffer: Buffer,
        mimeType: string = 'audio/webm',
        languageHint?: string,
        _quality?: TranscriptionQuality,
        logCtx?: TranscriptionLogContext,
        // See transcribe(): DM voice handlers enforce the Arabic-script check;
        // KB voice input (the other caller) leaves it off.
        strictLanguage = false,
    ): Promise<TranscriptionResult | null> {
        const client = this.getClient();
        if (!client) return null;

        if (audioBuffer.length === 0 || audioBuffer.length > MAX_AUDIO_BYTES) return null;

        const ext = mimeToExtension(mimeType);

        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), KB_TRANSCRIBE_TIMEOUT_MS);

        try {
            const file = await toFile(audioBuffer, `voice.${ext}`, { type: mimeType });
            recordAiAttempt('transcription', MODEL_TRANSCRIBE);
            const transcription = await client.audio.transcriptions.create(
                buildTranscribeParams(file, languageHint),
                { signal: controller.signal },
            );
            recordAiReturn('transcription', MODEL_TRANSCRIBE);
            this.logUsage(logCtx, transcription);

            return this.acceptTranscript(transcription.text, languageHint, strictLanguage);
        } catch (error) {
            const isTimeout = isTimeoutAbort(controller.signal);
            recordAiFailedBeforeLog('transcription', MODEL_TRANSCRIBE, isTimeout ? 'AiTimeoutError' : 'OpenAIApiError');
            captureError(
                error instanceof Error ? error : new Error(String(error)),
                isTimeout ? 'Transcription buffer timeout' : 'Transcription buffer failed',
                isTimeout
                    ? {
                        level: 'warning',
                        fingerprint: ['transcription-buffer-openai-timeout'],
                        tags: { service: 'transcription' },
                        extra: { timeoutMs: KB_TRANSCRIBE_TIMEOUT_MS },
                    }
                    : { tags: { service: 'transcription' } },
            );
            return null;
        } finally {
            clearTimeout(timer);
        }
    }
}

export const transcriptionService = new TranscriptionService();
