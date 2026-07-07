const REDACTED = "[REDACTED]";

const SENSITIVE_HEADER_NAMES = new Set([
  "authorization",
  "proxy-authorization",
  "cookie",
  "set-cookie",
  "x-api-key",
  "api-key",
  "x-auth-token",
  "x-csrf-token",
  "x-shopify-hmac-sha256",
  "x-hub-signature",
  "x-hub-signature-256",
  "x-signature",
  "stripe-signature",
]);

// Substring markers shared by header AND body redaction — single source of truth so
// the two can never disagree on what "sensitive" means.
const SENSITIVE_KEY_SUBSTRINGS = ["token", "secret", "password"];

// Body keys that are sensitive but contain no marker substring. Exact-match (lowercased)
// so we don't over-redact lookalikes (e.g. "zipcode"/"barcode" would match "code").
const SENSITIVE_BODY_KEYS = new Set(["otp", "code", "pin", "signed_request"]);

function hasSensitiveSubstring(lowerName: string): boolean {
  return SENSITIVE_KEY_SUBSTRINGS.some((s) => lowerName.includes(s));
}

export function sanitizeRequestHeaders(
  headers: Record<string, string | string[] | undefined>,
): Record<string, string | string[] | undefined> {
  const sanitized: Record<string, string | string[] | undefined> = {};

  for (const [headerName, headerValue] of Object.entries(headers)) {
    const lowerHeader = headerName.toLowerCase();
    const shouldRedact =
      SENSITIVE_HEADER_NAMES.has(lowerHeader) || hasSensitiveSubstring(lowerHeader);

    sanitized[headerName] = shouldRedact ? REDACTED : headerValue;
  }

  return sanitized;
}

/**
 * Redact credential-bearing keys from a request body before it is attached to a log
 * line or a Sentry event. The header sanitizer above does not cover the body, so a
 * 500 on an auth/OTP/token-exchange route used to ship the plaintext password / OTP /
 * access token. Shallow by design (the sensitive routes have flat bodies) and shares
 * the substring predicate with the header sanitizer so the two never drift.
 */
export function sanitizeBody(body: unknown): unknown {
  if (!body || typeof body !== "object" || Array.isArray(body)) return body;

  const sanitized: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(body as Record<string, unknown>)) {
    const lower = key.toLowerCase();
    const shouldRedact = hasSensitiveSubstring(lower) || SENSITIVE_BODY_KEYS.has(lower);
    sanitized[key] = shouldRedact ? REDACTED : value;
  }
  return sanitized;
}
