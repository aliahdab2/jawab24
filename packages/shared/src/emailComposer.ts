/**
 * Admin merchant-email composer — the single source of the limits and the
 * attachment wire shape, shared by the backend validator
 * (backend/src/utils/validation.ts → SendMerchantEmailSchema), the route body
 * schema (backend/src/routes/admin.ts), and the frontend pre-submit checks
 * (MessageMerchantModal), so their notions of "valid" can't drift.
 *
 * Sizing rationale: the caps must fit INSIDE the server's global 10MB
 * bodyLimit rather than raise it — base64 inflates bytes by 4/3, so 6MB of
 * files ≈ 8MB on the wire, leaving headroom for subject/body/recipients.
 * Resend's own ceiling is 40MB per email after base64 encoding, so the vendor
 * is not the binding constraint at these numbers.
 */
export const MAX_EMAIL_ATTACHMENTS = 3;
export const MAX_EMAIL_ATTACHMENT_BYTES = 4 * 1024 * 1024;
export const MAX_EMAIL_ATTACHMENTS_TOTAL_BYTES = 6 * 1024 * 1024;
export const MAX_EMAIL_CC = 5;

/** Extensions we are willing to put in front of a merchant. */
export const ALLOWED_ATTACHMENT_EXTENSIONS = ['pdf', 'png', 'jpg', 'jpeg'] as const;
export type AllowedAttachmentExtension = (typeof ALLOWED_ATTACHMENT_EXTENSIONS)[number];

/** `accept` attribute for the file input, derived — never hand-written. */
export const ATTACHMENT_ACCEPT = ALLOWED_ATTACHMENT_EXTENSIONS.map((e) => `.${e}`).join(',');

/**
 * One file attached to an outgoing email — the wire shape shared by the
 * frontend request, the backend Zod schema, and the transport payload.
 *
 * `content` is base64 WITHOUT a data: URI prefix — Resend rejects the prefixed
 * form, and the caller that strips it is the one that knows where the bytes
 * came from (a browser FileReader yields `data:application/pdf;base64,…`).
 *
 * `contentType` is server-derived from the verified magic bytes — clients must
 * NOT send it (the backend schema strips unknown keys; see the strip-pinning
 * test in emailCcAttachments.test.ts). The transport translates it to Resend's
 * snake_case `content_type` at the boundary.
 */
export interface EmailAttachment {
    filename: string;
    /** Base64-encoded file bytes, no `data:` prefix. */
    content: string;
    /** MIME type derived from verified magic bytes; set server-side only. */
    contentType?: string;
}

/**
 * Magic-number verification: the decoded bytes must actually BE the type the
 * filename claims. Defense-in-depth (OWASP file-upload) — a malicious-but-valid
 * PDF still passes; what this stops is arbitrary renamed payloads riding the
 * platform's domain reputation into a merchant's inbox.
 *
 * Returns the canonical MIME type on match, or null on mismatch/unknown
 * extension. `head` must hold at least the first 12 decoded bytes.
 */
export function sniffAttachmentMime(extension: string, head: Uint8Array): string | null {
    const ext = extension.toLowerCase();
    const startsWith = (sig: number[], offset = 0): boolean =>
        sig.every((b, i) => head[offset + i] === b);
    switch (ext) {
        case 'pdf':
            // "%PDF-"
            return startsWith([0x25, 0x50, 0x44, 0x46, 0x2d]) ? 'application/pdf' : null;
        case 'png':
            return startsWith([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]) ? 'image/png' : null;
        case 'jpg':
        case 'jpeg':
            return startsWith([0xff, 0xd8, 0xff]) ? 'image/jpeg' : null;
        default:
            return null;
    }
}

/**
 * Stable machine-readable rejection codes for the composer endpoint, shared so
 * the modal can map a server rejection to its already-translated message
 * instead of a generic "try again" (which is wrong advice for a deterministic
 * 400 — an oversize attachment can never succeed on retry).
 */
export const EMAIL_COMPOSER_ERROR_CODES = [
    'EMAIL_RECIPIENT_INVALID',
    'EMAIL_RECIPIENTS_TOO_MANY',
    'EMAIL_ATTACHMENTS_TOO_MANY',
    'EMAIL_ATTACHMENT_TOO_LARGE',
    'EMAIL_ATTACHMENTS_TOTAL_TOO_LARGE',
    'EMAIL_ATTACHMENT_BAD_TYPE',
    'EMAIL_ATTACHMENT_BAD_CONTENT',
    'EMAIL_FIELDS_INVALID',
] as const;
export type EmailComposerErrorCode = (typeof EMAIL_COMPOSER_ERROR_CODES)[number];
