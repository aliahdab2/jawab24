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

export function sanitizeRequestHeaders(
  headers: Record<string, string | string[] | undefined>,
): Record<string, string | string[] | undefined> {
  const sanitized: Record<string, string | string[] | undefined> = {};

  for (const [headerName, headerValue] of Object.entries(headers)) {
    const lowerHeader = headerName.toLowerCase();
    const shouldRedact =
      SENSITIVE_HEADER_NAMES.has(lowerHeader) ||
      lowerHeader.includes("token") ||
      lowerHeader.includes("secret") ||
      lowerHeader.includes("password");

    sanitized[headerName] = shouldRedact ? REDACTED : headerValue;
  }

  return sanitized;
}

