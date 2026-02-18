import { describe, it, expect } from "vitest";
import { sanitizeRequestHeaders } from "../../src/utils/logSanitizer";

describe("sanitizeRequestHeaders", () => {
  it("redacts known sensitive headers", () => {
    const result = sanitizeRequestHeaders({
      authorization: "Bearer secret-token",
      cookie: "session=abc",
      "x-api-key": "key-123",
      "stripe-signature": "sig_123",
    });

    expect(result.authorization).toBe("[REDACTED]");
    expect(result.cookie).toBe("[REDACTED]");
    expect(result["x-api-key"]).toBe("[REDACTED]");
    expect(result["stripe-signature"]).toBe("[REDACTED]");
  });

  it("redacts headers containing token/secret/password keywords", () => {
    const result = sanitizeRequestHeaders({
      "x-refresh-token": "refresh-123",
      "x-client-secret": "secret-123",
      "x-db-password": "password-123",
    });

    expect(result["x-refresh-token"]).toBe("[REDACTED]");
    expect(result["x-client-secret"]).toBe("[REDACTED]");
    expect(result["x-db-password"]).toBe("[REDACTED]");
  });

  it("keeps non-sensitive headers unchanged", () => {
    const result = sanitizeRequestHeaders({
      "content-type": "application/json",
      "user-agent": "Mozilla/5.0",
      "x-request-id": "req-123",
    });

    expect(result["content-type"]).toBe("application/json");
    expect(result["user-agent"]).toBe("Mozilla/5.0");
    expect(result["x-request-id"]).toBe("req-123");
  });
});

