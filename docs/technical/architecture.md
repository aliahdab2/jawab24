# Best Practices Implementation

> **NOTE: This is not the main architecture document.** This file describes specific best-practice improvements. For system architecture, see `.planning/codebase/ARCHITECTURE.md`.

This document describes the best practices improvements added to the Jawab24 backend.

## 📊 What Was Added

### 1. Custom Error Classes (`src/utils/errors.ts`)
Professional error handling with custom error types:

```typescript
- AppError (base class)
- ValidationError (400)
- AuthenticationError (401)
- AuthorizationError (403)
- NotFoundError (404)
- ConflictError (409)
- RateLimitError (429)
- InternalServerError (500)
- DatabaseError (500)
- ExternalServiceError (503)
```

### 2. Environment Variable Validation (`src/utils/env.ts`)
**Validates all environment variables on startup using Zod:**

- Database URL validation
- JWT secret minimum length (32 characters)
- Required API keys
- URL format validation
- Clear error messages on failure

**Result:** App fails fast with clear error if misconfigured

### 3. Input Validation Schemas (`src/utils/validation.ts`)
**Zod schemas for all API endpoints:**

- AI generation requests
- Template create/update
- Rule create/update
- Page updates
- Settings updates
- Payment checkout
- Webhook verification
- Pagination

### 4. Validation Middleware (`src/middleware/validation.ts`)
**Three middleware functions:**

- `validateBody()` - Validate request body
- `validateParams()` - Validate URL parameters
- `validateQuery()` - Validate query strings

**Usage:**
```typescript
fastify.post(
    '/api/resource',
    { preHandler: [validateBody(CreateResourceSchema)] },
    controller.create
);
```

### 5. Global Error Handler (`src/middleware/errorHandler.ts`)
**Consistent error responses:**

- Handles custom AppError instances
- Handles Fastify validation errors
- Handles unknown errors safely
- Hides internals in production
- Logs all errors with request context

### 6. Request ID Middleware (`src/middleware/requestId.ts`)
**Unique ID for each request:**

- Accepts `x-request-id` header or generates UUID
- Adds to response headers
- Enables request tracing across services
- Helpful for debugging

### 7. Rate Limiting
**Prevents abuse:**

- 100 requests per 15 minutes per IP
- Custom error response
- Can be configured per-route
- Uses `@fastify/rate-limit`

### 8. Improved Health Check (`src/routes/health.ts`)
**Three endpoints:**

1. `GET /health` - Full health status
   - Database connection
   - Stripe configuration
   - AI service status
   - Uptime, version, environment

2. `GET /health/live` - Liveness probe (Kubernetes)
   - Simple alive check

3. `GET /health/ready` - Readiness probe (Kubernetes)
   - Checks database connectivity

### 9. Graceful Shutdown
**Proper cleanup on termination:**

- Handles SIGTERM, SIGINT
- Closes server connections
- Logs shutdown process
- Prevents data loss

### 10. Enhanced Logging
**Structured logging:**

- Request method, URL, headers
- Remote IP and port
- Request ID in all logs
- Configurable log level

---

## 🚀 How to Use

### Environment Variable Validation

The app now validates environment variables on startup. If any required variables are missing or invalid, it will fail immediately with a clear error message.

**Example error:**
```
❌ Environment variable validation failed:

  - JWT_SECRET: String must contain at least 32 character(s)
  - DATABASE_URL: Invalid url
  - FACEBOOK_APP_ID: Required

Please check your env/backend.env file and ensure all required variables are set.
```

### Using Validation in Routes

```typescript
import { validateBody } from '../middleware/validation';
import { CreateTemplateSchema } from '../utils/validation';

fastify.post(
    '/templates',
    { preHandler: [validateBody(CreateTemplateSchema)] },
    templatesController.create
);
```

### Using Custom Errors

```typescript
import { NotFoundError, ValidationError } from '../utils/errors';

// In controller:
if (!user) {
    throw new NotFoundError('User not found');
}

if (invalid) {
    throw new ValidationError('Invalid input', { field: 'email' });
}
```

### Health Check Example

```bash
# Full health check
curl http://localhost:3000/health

# Response:
{
  "status": "healthy",
  "timestamp": "2025-01-02T17:00:00.000Z",
  "uptime": 3600,
  "version": "1.0.0",
  "environment": "production",
  "services": {
    "database": { "status": "up", "responseTime": 5 },
    "stripe": { "status": "up", "message": "Configured" },
    "ai": { "status": "up", "message": "Enabled" }
  }
}
```

---

## 📈 Impact

### Before:
- ❌ No environment validation → Runtime errors in production
- ❌ Manual input validation → Inconsistent error messages
- ❌ Generic error handling → Hard to debug
- ❌ No rate limiting → Vulnerable to abuse
- ❌ Basic health check → Can't monitor service health
- ❌ Abrupt shutdowns → Potential data loss

### After:
- ✅ Environment validated on startup → Fail fast with clear errors
- ✅ Zod validation → Type-safe, consistent, self-documenting
- ✅ Custom error classes → Easy to handle different error types
- ✅ Rate limiting → Protected against abuse
- ✅ Comprehensive health checks → Full observability
- ✅ Graceful shutdown → Clean termination

---

## 🧪 Testing

### Validation Tests
Tests should be added for:
- Environment variable validation
- Input validation schemas
- Error handler behavior
- Request ID middleware

### Example Test:
```typescript
describe('Environment Validation', () => {
    it('should fail with missing JWT_SECRET', () => {
        delete process.env.JWT_SECRET;
        expect(() => validateEnv()).toThrow('JWT_SECRET');
    });
});
```

---

## 🔜 Next Steps

### To Apply Validation to Endpoints:

1. **Add validation to templates routes:**
```typescript
import { validateBody } from '../middleware/validation';
import { CreateTemplateSchema, UpdateTemplateSchema } from '../utils/validation';

fastify.post(
    '/templates',
    { preHandler: [validateBody(CreateTemplateSchema)] },
    templatesController.create
);

fastify.put(
    '/templates/:id',
    { preHandler: [validateBody(UpdateTemplateSchema)] },
    templatesController.update
);
```

2. **Add validation to rules routes:**
```typescript
fastify.post(
    '/rules',
    { preHandler: [validateBody(CreateRuleSchema)] },
    rulesController.create
);
```

3. **Add validation to pages routes:**
```typescript
fastify.patch(
    '/pages/:id',
    { preHandler: [validateBody(UpdatePageSchema)] },
    pagesController.update
);
```

4. **Add validation to settings routes:**
```typescript
fastify.put(
    '/settings',
    { preHandler: [validateBody(UpdateSettingsSchema)] },
    settingsController.update
);
```

### To Add Tests:

Create `backend/test/utils/validation.test.ts`:
```typescript
import { describe, it, expect } from 'vitest';
import { AiGenerateSchema, CreateTemplateSchema } from '../../src/utils/validation';

describe('Validation Schemas', () => {
    describe('AiGenerateSchema', () => {
        it('should validate correct input', () => {
            const valid = AiGenerateSchema.parse({
                comment: 'Test comment',
                language: 'en',
            });
            expect(valid.comment).toBe('Test comment');
        });

        it('should reject empty comment', () => {
            expect(() =>
                AiGenerateSchema.parse({ comment: '' })
            ).toThrow();
        });
    });
});
```

---

## 📚 Resources

- [Zod Documentation](https://zod.dev/)
- [Fastify Best Practices](https://fastify.dev/docs/latest/Guides/Getting-Started/)
- [Error Handling Patterns](https://fastify.dev/docs/latest/Reference/Errors/)
- [Rate Limiting](https://github.com/fastify/fastify-rate-limit)

---

## ✅ Summary

This update adds **production-grade** error handling, validation, and observability to the Jawab24 backend:

- ✅ Environment variables validated on startup
- ✅ Type-safe input validation with Zod
- ✅ Professional error handling
- ✅ Request tracing with unique IDs
- ✅ Rate limiting for security
- ✅ Comprehensive health checks
- ✅ Graceful shutdown handling

**Your backend is now following industry best practices!** 🎉

