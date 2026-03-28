import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks — must be declared before importing the route module
// ---------------------------------------------------------------------------
vi.mock('../../src/services/translation', () => ({
    translateText: vi.fn(),
}));

vi.mock('../../src/middleware/auth', () => ({
    authenticate: vi.fn((_req: any, _reply: any, done: any) => done?.()),
}));

vi.mock('../../src/utils/validation', () => ({
    validateSchema: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------
import { translationRoutes } from '../../src/routes/translation';
import { translateText } from '../../src/services/translation';
import { validateSchema } from '../../src/utils/validation';

// ---------------------------------------------------------------------------
// Helper — build a minimal mock Fastify instance that records registrations
// ---------------------------------------------------------------------------
function buildMockFastify() {
    const registeredRoutes: string[] = [];

    const mockFastify: any = {
        get: vi.fn((path: string) => registeredRoutes.push(`GET ${path}`)),
        post: vi.fn((path: string, _opts: any, handler: any) => {
            registeredRoutes.push(`POST ${path}`);
            // Stash the handler so tests can invoke it directly
            mockFastify._handlers = mockFastify._handlers ?? {};
            mockFastify._handlers[`POST ${path}`] = handler;
        }),
        delete: vi.fn((path: string) => registeredRoutes.push(`DELETE ${path}`)),
        patch: vi.fn((path: string) => registeredRoutes.push(`PATCH ${path}`)),
        put: vi.fn((path: string) => registeredRoutes.push(`PUT ${path}`)),
        addHook: vi.fn(),
        register: vi.fn((fn: any) => fn(mockFastify)),
        _routes: registeredRoutes,
        _handlers: {} as Record<string, Function>,
    };

    return mockFastify;
}

// ---------------------------------------------------------------------------
// Helper — minimal mock request / reply
// ---------------------------------------------------------------------------
function buildMockRequestReply(body: unknown = {}) {
    const reply: any = {
        status: vi.fn().mockReturnThis(),
        send: vi.fn().mockReturnThis(),
        code: vi.fn().mockReturnThis(),
    };
    const request: any = {
        body,
        log: { error: vi.fn() },
    };
    return { request, reply };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe('Translation Routes', () => {
    let mockFastify: ReturnType<typeof buildMockFastify>;

    beforeEach(async () => {
        vi.clearAllMocks();
        mockFastify = buildMockFastify();
        await translationRoutes(mockFastify, {});
    });

    // -------------------------------------------------------------------------
    // Route registration
    // -------------------------------------------------------------------------
    describe('route registration', () => {
        it('registers POST /translate', () => {
            expect(mockFastify._routes).toContain('POST /translate');
        });
    });

    // -------------------------------------------------------------------------
    // POST /translate handler logic
    // -------------------------------------------------------------------------
    describe('POST /translate handler', () => {
        const handler = () => mockFastify._handlers['POST /translate'];

        it('calls translateText and returns the result on valid input', async () => {
            const translationResult = { translatedText: 'مرحبا', detectedLanguage: 'en' };
            vi.mocked(validateSchema).mockReturnValue({
                success: true,
                data: { text: 'Hello', sourceLanguage: 'en', targetLanguage: 'ar' },
            } as any);
            vi.mocked(translateText).mockResolvedValue(translationResult as any);

            const { request, reply } = buildMockRequestReply({
                text: 'Hello',
                sourceLanguage: 'en',
                targetLanguage: 'ar',
            });

            await handler()(request, reply);

            expect(translateText).toHaveBeenCalledWith({
                text: 'Hello',
                sourceLanguage: 'en',
                targetLanguage: 'ar',
            });
            expect(reply.send).toHaveBeenCalledWith(translationResult);
        });

        it('defaults sourceLanguage to "auto" when not supplied', async () => {
            const translationResult = { translatedText: 'مرحبا' };
            vi.mocked(validateSchema).mockReturnValue({
                success: true,
                data: { text: 'Hello', targetLanguage: 'ar' },
            } as any);
            vi.mocked(translateText).mockResolvedValue(translationResult as any);

            const { request, reply } = buildMockRequestReply({ text: 'Hello', targetLanguage: 'ar' });
            await handler()(request, reply);

            expect(translateText).toHaveBeenCalledWith(
                expect.objectContaining({ sourceLanguage: 'auto' })
            );
        });

        it('returns 400 when schema validation fails', async () => {
            vi.mocked(validateSchema).mockReturnValue({
                success: false,
                errors: [{ field: 'text', message: 'Required' }],
            } as any);

            const { request, reply } = buildMockRequestReply({});
            await handler()(request, reply);

            expect(reply.status).toHaveBeenCalledWith(400);
            expect(reply.send).toHaveBeenCalledWith(
                expect.objectContaining({ error: 'Invalid request' })
            );
            expect(translateText).not.toHaveBeenCalled();
        });

        it('returns 500 when translateText throws an error', async () => {
            vi.mocked(validateSchema).mockReturnValue({
                success: true,
                data: { text: 'Hello', targetLanguage: 'ar' },
            } as any);
            vi.mocked(translateText).mockRejectedValue(new Error('OpenAI timeout'));

            const { request, reply } = buildMockRequestReply({ text: 'Hello', targetLanguage: 'ar' });
            await handler()(request, reply);

            expect(reply.code).toHaveBeenCalledWith(500);
            expect(reply.send).toHaveBeenCalledWith(
                expect.objectContaining({ error: 'Translation failed' })
            );
        });
    });
});
