/**
 * Download a media file (voice note, image, …) into a Buffer with a hard
 * timeout and a max-size guard.
 *
 * Single home for the fetch-with-abort + content-length/size-check plumbing
 * that the media pre-processing services (transcription, image understanding)
 * both need — so it lives in exactly one place instead of being copy-pasted.
 *
 * Throws a typed {@link MediaDownloadError} so each caller maps failure reasons
 * to its OWN logging policy (e.g. transcription pages Sentry on a bad download,
 * image understanding treats an expired CDN URL as benign and only warns).
 */

export type MediaDownloadReason = 'not_ok' | 'too_large' | 'timeout' | 'network';

export class MediaDownloadError extends Error {
    constructor(
        readonly reason: MediaDownloadReason,
        message: string,
        readonly status?: number,
        /**
         * Standard ES2022 `Error.cause`, set whenever this error WRAPS a lower-level
         * throw. Sentry's `linkedErrors` integration is on by default and keyed on
         * `cause`, so anything passed here is rendered as a chained exception on the
         * event; anything dropped here is unrecoverable at triage time.
         */
        options?: ErrorOptions,
    ) {
        super(message, options);
        this.name = 'MediaDownloadError';
    }
}

export interface MediaDownloadResult {
    buffer: Buffer;
    /** Lowercased Content-Type header, or '' when absent. */
    contentType: string;
}

/**
 * Fetch `url` into a Buffer, aborting after `timeoutMs` and rejecting anything
 * larger than `maxBytes` (checked against both the Content-Length header and
 * the actual downloaded length). No auth header is attached — Facebook/Instagram
 * CDN attachment URLs are pre-authorized.
 */
export async function fetchMediaBuffer(
    url: string,
    opts: { maxBytes: number; timeoutMs: number },
): Promise<MediaDownloadResult> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), opts.timeoutMs);
    try {
        const response = await fetch(url, { signal: controller.signal });

        if (!response.ok) {
            throw new MediaDownloadError('not_ok', `download failed: HTTP ${response.status}`, response.status);
        }

        const declaredLength = parseInt(response.headers.get('content-length') || '0', 10);
        if (declaredLength > opts.maxBytes) {
            throw new MediaDownloadError('too_large', `content-length ${declaredLength} exceeds ${opts.maxBytes}`);
        }

        const contentType = (response.headers.get('content-type') || '').toLowerCase();
        // arrayBuffer() is inside the try so an abort DURING the body read (a slow
        // download that blows the timeout) is mapped to `timeout`, not leaked raw.
        const buffer = Buffer.from(await response.arrayBuffer());
        if (buffer.length > opts.maxBytes) {
            throw new MediaDownloadError('too_large', `downloaded ${buffer.length} exceeds ${opts.maxBytes}`);
        }

        return { buffer, contentType };
    } catch (err) {
        if (err instanceof MediaDownloadError) throw err; // pass our own reasons through unchanged
        if (err instanceof Error && err.name === 'AbortError') {
            throw new MediaDownloadError('timeout', `download timed out after ${opts.timeoutMs}ms`, undefined, { cause: err });
        }
        // The message alone is NOT diagnosable here: undici collapses every DNS / TCP /
        // TLS failure into the literal string "fetch failed" and carries the real code
        // (ECONNRESET, ENOTFOUND, UND_ERR_CONNECT_TIMEOUT) on `err.cause`. Passing the
        // original through as our own `cause` is the only thing that puts it on the
        // Sentry event. Prod 2026-09-04 (JAWAB24-BACKEND-2R) arrived as a bare
        // "fetch failed" with no underlying error precisely because this line
        // discarded it, leaving the failure mode unknowable after the fact.
        throw new MediaDownloadError('network', err instanceof Error ? err.message : String(err), undefined, { cause: err });
    } finally {
        clearTimeout(timer);
    }
}
