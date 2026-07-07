import { describe, it, expect } from "vitest";
import { sanitizeRequestHeaders, sanitizeBody } from "../../src/utils/logSanitizer";

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

describe("sanitizeBody", () => {
  it("redacts credential-bearing keys (substring + exact) and keeps the rest", () => {
    const result = sanitizeBody({
      email: "user@example.com",
      password: "hunter2",
      accessToken: "ya29.secret", // substring "token"
      refreshSecret: "s3cr3t",    // substring "secret"
      otp: "123456",
      code: "oauth-code",
      pin: "0000",
      signed_request: "abc.def",
      name: "Ada",
    }) as Record<string, unknown>;

    expect(result.password).toBe("[REDACTED]");
    expect(result.accessToken).toBe("[REDACTED]");
    expect(result.refreshSecret).toBe("[REDACTED]");
    expect(result.otp).toBe("[REDACTED]");
    expect(result.code).toBe("[REDACTED]");
    expect(result.pin).toBe("[REDACTED]");
    expect(result.signed_request).toBe("[REDACTED]");
    expect(result.email).toBe("user@example.com");
    expect(result.name).toBe("Ada");
  });

  it("does not over-redact lookalikes of exact-match keys", () => {
    const result = sanitizeBody({ zipcode: "12345", barcode: "999" }) as Record<string, unknown>;
    expect(result.zipcode).toBe("12345");
    expect(result.barcode).toBe("999");
  });

  it("passes through non-object bodies unchanged", () => {
    expect(sanitizeBody(undefined)).toBeUndefined();
    expect(sanitizeBody("a string")).toBe("a string");
    expect(sanitizeBody(["arr"])).toEqual(["arr"]);
  });
});

