import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// --- Hoisted mocks ---

const {
    mockGetStoreById,
    mockUpdateStoreTokens,
    mockReplaceProductsAndRebuildSummary,
    mockApplySyncedStoreInfo,
    mockDecrypt,
    mockCaptureError,
    mockRedisSet,
    mockRedisDel,
    mockDbWhere,
} = vi.hoisted(() => ({
    mockGetStoreById: vi.fn(),
    mockUpdateStoreTokens: vi.fn(),
    mockReplaceProductsAndRebuildSummary: vi.fn(),
    mockApplySyncedStoreInfo: vi.fn(),
    mockDecrypt: vi.fn(),
    mockCaptureError: vi.fn(),
    mockRedisSet: vi.fn(),
    mockRedisDel: vi.fn(),
    mockDbWhere: vi.fn(),
}));

// --- vi.mock() calls ---

vi.mock('../../src/config', () => ({
    config: {
        zid: {
            clientId: 'test_zid_client_id',
            clientSecret: 'test_zid_secret',
            appId: 'zid-app-777',
            hostName: 'jawab24.com',
            webhookSecret: 'test_webhook_secret',
            scopes: 'offline_access products.read orders.read webhooks.manage',
        },
        // Read by the shared token refresher's store selector.
        salla: { skipPullRefreshForEasyMode: false },
    },
}));

vi.mock('../../src/utils/tracing', () => ({
    tracedExternalCall: vi.fn((_service, _op, fn) => fn()),
}));

// Only getStoresNeedingTokenRefresh touches the DB directly (via the shared refresher).
vi.mock('../../src/db', () => ({
    db: {
        select: vi.fn().mockReturnValue({
            from: vi.fn().mockReturnValue({
                where: (...args: unknown[]) => mockDbWhere(...args),
            }),
        }),
    },
}));

vi.mock('../../src/services/ecommerce', () => ({
    getStoreById: (...args: unknown[]) => mockGetStoreById(...args),
    updateStoreTokens: (...args: unknown[]) => mockUpdateStoreTokens(...args),
    markStoreNeedsReauth: vi.fn().mockResolvedValue(undefined),
    replaceProductsAndRebuildSummary: (...args: unknown[]) => mockReplaceProductsAndRebuildSummary(...args),
    applySyncedStoreInfo: (...args: unknown[]) => mockApplySyncedStoreInfo(...args),
    PRODUCT_SAFETY_CAP: 5000,
}));

vi.mock('../../src/services/ecommerceCrypto', () => ({
    decrypt: (...args: unknown[]) => mockDecrypt(...args),
    encryptOptional: vi.fn(() => ({})),
    decryptOptional: (...args: unknown[]) => (args[0] && args[1] ? mockDecrypt(...args) : undefined),
}));

vi.mock('../../src/utils/sentryHelpers', () => ({
    captureError: (...args: unknown[]) => mockCaptureError(...args),
}));

vi.mock('../../src/lib/redis', () => ({
    redis: {
        set: (...args: unknown[]) => mockRedisSet(...args),
        del: (...args: unknown[]) => mockRedisDel(...args),
    },
}));

// Mock global fetch
const mockFetch = vi.fn();
global.fetch = mockFetch;

// --- Import after mocks ---
import {
    buildAuthUrl,
    exchangeCodeForToken,
    verifyWebhookBasicAuth,
    ZID_WEBHOOK_BASIC_USER,
    ZID_WEBHOOK_EVENTS,
    isProductEvent,
    isOrderEvent,
    registerWebhooks,
    fetchStoreInfo,
    syncProducts,
    fullSync,
    refreshAccessToken,
    ensureValidToken,
    refreshExpiringTokens,
    getStoresNeedingTokenRefresh,
    normalizeZidPhone,
    mapZidOrderStatus,
    lookupOrder,
    getShipmentTracking,
    getProductById,
    type ZidCredentials,
} from '../../src/services/zid';

// --- Helpers ---

const CREDS: ZidCredentials = { managerToken: 'manager_token', authorizationToken: 'auth_token' };

function makeStore(overrides: Record<string, unknown> = {}) {
    return {
        id: 'store-1',
        platform: 'zid',
        isActive: true,
        accessToken: 'enc_access',
        accessTokenIv: 'iv_access',
        refreshToken: 'enc_refresh',
        refreshTokenIv: 'iv_refresh',
        authorizationToken: 'enc_auth',
        authorizationTokenIv: 'iv_auth',
        storeCurrency: 'SAR',
        storeDomain: 'demo.zid.store',
        // ~10 months out — never triggers the 24h refresh window
        tokenExpiresAt: new Date(Date.now() + 300 * 24 * 60 * 60 * 1000),
        platformData: {},
        ...overrides,
    };
}

function makeZidProduct(overrides: Record<string, unknown> = {}) {
    return {
        id: '1001',
        name: 'Test Product',
        status: 'active',
        price: 150,
        currency: 'SAR',
        quantity: 20,
        sku: 'SKU-001',
        slug: 'test-product',
        images: [{ url: 'https://cdn.zid.sa/image.jpg' }],
        categories: [{ name: 'Electronics' }],
        has_variants: false,
        options: [],
        ...overrides,
    };
}

function jsonResponse(body: unknown, status = 200) {
    return {
        ok: status >= 200 && status < 300,
        status,
        headers: new Headers(),
        json: async () => body,
        text: async () => JSON.stringify(body),
    };
}

/** Assert a fetch call carried the dual Zid credentials. */
function expectDualHeaders(call: [string, RequestInit], extra: Record<string, string> = {}) {
    const headers = call[1].headers as Record<string, string>;
    expect(headers['Authorization']).toBe('Bearer auth_token');
    expect(headers['X-Manager-Token']).toBe('manager_token');
    for (const [k, v] of Object.entries(extra)) {
        expect(headers[k]).toBe(v);
    }
}

function validBasicHeader(user = ZID_WEBHOOK_BASIC_USER, pass = 'test_webhook_secret') {
    return `Basic ${Buffer.from(`${user}:${pass}`).toString('base64')}`;
}

describe('Zid Service', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockDecrypt.mockImplementation((cipher: unknown) => ({
            enc_access: 'manager_token',
            enc_auth: 'auth_token',
            enc_refresh: 'refresh_plain',
        }[cipher as string] ?? `dec:${String(cipher)}`));
        mockGetStoreById.mockResolvedValue(makeStore());
        mockUpdateStoreTokens.mockResolvedValue(undefined);
        mockReplaceProductsAndRebuildSummary.mockResolvedValue({ productCount: 0 });
        mockApplySyncedStoreInfo.mockResolvedValue(undefined);
        mockRedisSet.mockResolvedValue('OK');
        mockRedisDel.mockResolvedValue(1);
        mockDbWhere.mockResolvedValue([]);
    });

    // ============================================================
    // OAuth — buildAuthUrl
    // ============================================================

    describe('buildAuthUrl', () => {
        it('builds a valid OAuth URL with all required parameters', () => {
            const url = buildAuthUrl('state_abc123');

            expect(url).toContain('https://oauth.zid.sa/oauth/authorize');
            expect(url).toContain('client_id=test_zid_client_id');
            expect(url).toContain(`scope=${encodeURIComponent('offline_access products.read orders.read webhooks.manage')}`);
            expect(url).toContain('response_type=code');
            expect(url).toContain('state=state_abc123');
            expect(url).toContain(encodeURIComponent('https://jawab24.com/zid/auth/callback'));
        });

        it('encodes the redirect URI', () => {
            const url = buildAuthUrl('test');
            const redirectParam = url.split('redirect_uri=')[1].split('&')[0];
            expect(redirectParam).toBe(encodeURIComponent('https://jawab24.com/zid/auth/callback'));
        });
    });

    // ============================================================
    // OAuth — exchangeCodeForToken (form-urlencoded, dual credentials)
    // ============================================================

    describe('exchangeCodeForToken', () => {
        it('posts application/x-www-form-urlencoded to the oauth token endpoint and returns all four fields', async () => {
            mockFetch.mockResolvedValueOnce(jsonResponse({
                access_token: 'zid_manager_123',
                refresh_token: 'zid_refresh_456',
                expires_in: 31536000, // ~1 year
                Authorization: 'zid_auth_jwt_789',
            }));

            const result = await exchangeCodeForToken('auth_code_abc');

            expect(result).toEqual({
                accessToken: 'zid_manager_123',
                authorizationToken: 'zid_auth_jwt_789',
                refreshToken: 'zid_refresh_456',
                expiresIn: 31536000,
            });

            const [url, opts] = mockFetch.mock.calls[0] as [string, RequestInit];
            expect(url).toBe('https://oauth.zid.sa/oauth/token');
            expect(opts.method).toBe('POST');
            expect(opts.headers).toEqual({ 'Content-Type': 'application/x-www-form-urlencoded' });

            // URLSearchParams body — NOT JSON (RFC 6749 token endpoint).
            const params = new URLSearchParams(opts.body as string);
            expect(params.get('grant_type')).toBe('authorization_code');
            expect(params.get('client_id')).toBe('test_zid_client_id');
            expect(params.get('client_secret')).toBe('test_zid_secret');
            expect(params.get('code')).toBe('auth_code_abc');
            expect(params.get('redirect_uri')).toBe('https://jawab24.com/zid/auth/callback');
        });

        it('accepts a lowercase `authorization` field (defensive casing)', async () => {
            mockFetch.mockResolvedValueOnce(jsonResponse({
                access_token: 'a',
                refresh_token: 'r',
                expires_in: 100,
                authorization: 'lowercase_auth_token',
            }));

            const result = await exchangeCodeForToken('code');
            expect(result.authorizationToken).toBe('lowercase_auth_token');
        });

        it('THROWS when the response has no Authorization token field (fail fast, not a silent 401 later)', async () => {
            mockFetch.mockResolvedValueOnce(jsonResponse({
                access_token: 'a',
                refresh_token: 'r',
                expires_in: 100,
            }));

            await expect(exchangeCodeForToken('code')).rejects.toThrow(
                'no Authorization token field',
            );
        });

        it('throws on failed token exchange with status and body', async () => {
            mockFetch.mockResolvedValueOnce({
                ok: false,
                status: 400,
                text: async () => 'invalid_grant',
            });

            await expect(exchangeCodeForToken('bad_code')).rejects.toThrow(
                'Zid token exchange failed: 400 invalid_grant',
            );
        });
    });

    // ============================================================
    // Webhook verification — HTTP Basic auth (NO HMAC)
    // ============================================================

    describe('verifyWebhookBasicAuth', () => {
        it('accepts the exact Basic header for jawab24:<webhookSecret>', () => {
            expect(verifyWebhookBasicAuth(validBasicHeader())).toBe(true);
        });

        it('rejects a wrong password', () => {
            expect(verifyWebhookBasicAuth(validBasicHeader(ZID_WEBHOOK_BASIC_USER, 'wrong_secret_00'))).toBe(false);
        });

        it('rejects a wrong username', () => {
            expect(verifyWebhookBasicAuth(validBasicHeader('intruder'))).toBe(false);
        });

        it('rejects a missing header (fails closed)', () => {
            expect(verifyWebhookBasicAuth(undefined)).toBe(false);
            expect(verifyWebhookBasicAuth('')).toBe(false);
        });
    });

    // ============================================================
    // Event constants + predicates
    // ============================================================

    describe('ZID_WEBHOOK_EVENTS', () => {
        it('contains exactly the verified subscription slugs', () => {
            expect([...ZID_WEBHOOK_EVENTS]).toEqual([
                'product.create',
                'product.update',
                'product.publish',
                'product.delete',
                'order.create',
                'order.status.update',
            ]);
        });

        it('does NOT contain app lifecycle events (Partner-Dashboard-configured, not API-registered)', () => {
            expect(ZID_WEBHOOK_EVENTS).not.toContain('app.market.application.install');
            expect(ZID_WEBHOOK_EVENTS).not.toContain('app.market.application.uninstall');
        });
    });

    describe('isProductEvent / isOrderEvent', () => {
        it.each(['product.create', 'product.update', 'product.publish', 'product.delete'])(
            'isProductEvent(%s) is true',
            (event) => {
                expect(isProductEvent(event)).toBe(true);
                expect(isOrderEvent(event)).toBe(false);
            },
        );

        it.each(['order.create', 'order.status.update'])('isOrderEvent(%s) is true', (event) => {
            expect(isOrderEvent(event)).toBe(true);
            expect(isProductEvent(event)).toBe(false);
        });

        it('both are false for unrelated events', () => {
            for (const event of ['app.market.application.uninstall', 'customer.create', '']) {
                expect(isProductEvent(event)).toBe(false);
                expect(isOrderEvent(event)).toBe(false);
            }
        });
    });

    // ============================================================
    // registerWebhooks — POST /v1/managers/webhooks, dual headers,
    // Basic-auth pair in body, routing hints in target_url
    // ============================================================

    describe('registerWebhooks', () => {
        it('registers every event with dual headers and the full subscription body', async () => {
            mockFetch.mockResolvedValue(jsonResponse({}));

            const result = await registerWebhooks(CREDS, 'store-uuid-1');

            expect(mockFetch).toHaveBeenCalledTimes(ZID_WEBHOOK_EVENTS.length);
            expect(result.registered).toEqual([...ZID_WEBHOOK_EVENTS]);
            expect(result.failed).toEqual([]);
            expect(result.lastAttempt).toEqual(expect.any(String));

            for (let i = 0; i < mockFetch.mock.calls.length; i++) {
                const call = mockFetch.mock.calls[i] as [string, RequestInit];
                expect(call[0]).toBe('https://api.zid.sa/v1/managers/webhooks');
                expect(call[1].method).toBe('POST');
                expectDualHeaders(call, { 'Content-Type': 'application/json' });

                const body = JSON.parse(call[1].body as string);
                expect(body.original_id).toBe('zid-app-777');
                expect(body.username).toBe('jawab24');
                expect(body.password).toBe('test_webhook_secret');
                expect(ZID_WEBHOOK_EVENTS).toContain(body.event);
                // target_url carries the routing hints the handler resolves from.
                expect(body.target_url).toContain('https://jawab24.com/zid/webhooks?');
                expect(body.target_url).toContain(`e=${encodeURIComponent(body.event)}`);
                expect(body.target_url).toContain('sid=store-uuid-1');
            }
        });

        it('treats 409 (already exists) as registered without logging an error', async () => {
            mockFetch.mockResolvedValue(jsonResponse({ error: 'Conflict' }, 409));

            const result = await registerWebhooks(CREDS, 'store-1');

            expect(result.registered).toEqual([...ZID_WEBHOOK_EVENTS]);
            expect(result.failed).toEqual([]);
            expect(mockCaptureError).not.toHaveBeenCalled();
        });

        it('treats 422 (duplicate/validation-style already-exists) as registered too', async () => {
            mockFetch.mockResolvedValue(jsonResponse({ error: 'already subscribed' }, 422));

            const result = await registerWebhooks(CREDS, 'store-1');

            expect(result.registered).toEqual([...ZID_WEBHOOK_EVENTS]);
            expect(result.failed).toEqual([]);
            expect(mockCaptureError).not.toHaveBeenCalled();
        });

        it('records non-2xx failures with status and captures the error', async () => {
            mockFetch.mockResolvedValue(jsonResponse({ error: 'boom' }, 500));

            const result = await registerWebhooks(CREDS, 'store-1');

            expect(result.registered).toEqual([]);
            expect(result.failed).toHaveLength(ZID_WEBHOOK_EVENTS.length);
            expect(result.failed[0]).toMatchObject({ topic: 'product.create', status: 500 });
            expect(mockCaptureError).toHaveBeenCalled();
        });

        it('continues registering remaining events after a single rejection', async () => {
            mockFetch
                .mockRejectedValueOnce(new Error('network down'))
                .mockResolvedValue(jsonResponse({}));

            const result = await registerWebhooks(CREDS, 'store-1');

            expect(mockFetch).toHaveBeenCalledTimes(ZID_WEBHOOK_EVENTS.length);
            expect(result.failed).toEqual([
                { topic: 'product.create', error: 'network down' },
            ]);
            expect(result.registered).toHaveLength(ZID_WEBHOOK_EVENTS.length - 1);
        });
    });

    // ============================================================
    // fetchStoreInfo — /v1/managers/account/profile
    // ============================================================

    describe('fetchStoreInfo [provisional — pending Zid live captures]', () => {
        it('GETs the manager profile with dual headers and maps the user.store envelope', async () => {
            mockFetch.mockResolvedValueOnce(jsonResponse({
                user: {
                    id: 7,
                    email: 'owner@zid.sa',
                    store: {
                        id: 99,
                        title: 'متجر الدمام',
                        email: 'store@zid.sa',
                        currency: 'SAR',
                        url: 'https://demo.zid.store',
                    },
                },
            }));

            const info = await fetchStoreInfo(CREDS);

            const call = mockFetch.mock.calls[0] as [string, RequestInit];
            expect(call[0]).toBe('https://api.zid.sa/v1/managers/account/profile');
            expectDualHeaders(call);

            expect(info).toEqual({
                storeName: 'متجر الدمام',
                storeEmail: 'store@zid.sa',
                storeCurrency: 'SAR',
                storeDomain: 'demo.zid.store',
                merchantId: '99',
            });
        });

        it('tolerates a root-level store envelope, name fallback, and a scheme-less domain field', async () => {
            mockFetch.mockResolvedValueOnce(jsonResponse({
                store: {
                    id: 12345,
                    name: 'My Zid Store',
                    currency: 'SAR',
                    domain: 'my-store.zid.store',
                },
            }));

            const info = await fetchStoreInfo(CREDS);

            expect(info.storeName).toBe('My Zid Store');
            expect(info.storeDomain).toBe('my-store.zid.store');
            expect(info.merchantId).toBe('12345');
            expect(typeof info.merchantId).toBe('string');
        });

        it('extracts the hostname from a URL with a path', async () => {
            mockFetch.mockResolvedValueOnce(jsonResponse({
                user: { store: { id: 1, title: 'S', url: 'https://demo.zid.store/ar/home' } },
            }));

            const info = await fetchStoreInfo(CREDS);
            expect(info.storeDomain).toBe('demo.zid.store');
        });

        it('falls back to String(store.id) as storeDomain when no url/domain is present', async () => {
            mockFetch.mockResolvedValueOnce(jsonResponse({
                user: { store: { id: 4242, title: 'No URL Store' } },
            }));

            const info = await fetchStoreInfo(CREDS);
            expect(info.storeDomain).toBe('4242');
        });

        it('falls back to the user email when the store has none', async () => {
            mockFetch.mockResolvedValueOnce(jsonResponse({
                user: {
                    email: 'owner@zid.sa',
                    store: { id: 1, title: 'S', url: 'https://s.zid.store' },
                },
            }));

            const info = await fetchStoreInfo(CREDS);
            expect(info.storeEmail).toBe('owner@zid.sa');
        });

        it('throws when the response has no store object', async () => {
            mockFetch.mockResolvedValueOnce(jsonResponse({ user: { id: 7 } }));

            await expect(fetchStoreInfo(CREDS)).rejects.toThrow('no usable store object');
        });

        // ------------------------------------------------------------------
        // Regression: the first REAL App Market install (2026-08-11)
        //
        // Every fixture above was written from docs.zid.sa, and every one of them
        // sends `currency` as a string — which is why the suite was green while
        // production could not complete a single install. Zid sends an OBJECT.
        // The object reached `store_currency varchar(10)`, Postgres raised 22001,
        // and the whole callback aborted after the merchant account had already
        // been provisioned. These cases are pinned to the payload prod received.
        // ------------------------------------------------------------------
        describe('currency envelope [live-confirmed 2026-08-11]', () => {
            /** Verbatim from the production log of store a0xxorvfi5.zid.store. */
            const LIVE_CURRENCY = {
                id: 4,
                name: 'ريال سعودي',
                code: 'SAR',
                symbol: ' ر.س ',
                country: {
                    id: 184, name: 'السعودية', priority: 1,
                    code: 'SA', country_code: 'SAU',
                    flag: 'https://media.zid.store/static/sa.svg',
                },
            };

            it('reads the ISO code from the object Zid actually sends', async () => {
                mockFetch.mockResolvedValueOnce(jsonResponse({
                    user: {
                        store: {
                            id: 130216,
                            title: 'Test',
                            email: 'appmarket@zid.sa',
                            currency: LIVE_CURRENCY,
                            url: 'https://a0xxorvfi5.zid.store',
                        },
                    },
                }));

                const info = await fetchStoreInfo(CREDS);

                expect(info).toEqual({
                    storeName: 'Test',
                    storeEmail: 'appmarket@zid.sa',
                    storeCurrency: 'SAR',
                    storeDomain: 'a0xxorvfi5.zid.store',
                    merchantId: '130216',
                });
                // The bug in one assertion: anything longer than the column is
                // what took the install down.
                expect(info.storeCurrency?.length).toBeLessThanOrEqual(10);
            });

            it('still accepts a bare string, so a docs-shaped response keeps working', async () => {
                mockFetch.mockResolvedValueOnce(jsonResponse({
                    user: { store: { id: 1, title: 'S', currency: 'SAR', url: 'https://s.zid.store' } },
                }));

                expect((await fetchStoreInfo(CREDS)).storeCurrency).toBe('SAR');
            });

            it('drops a currency shape it cannot read instead of failing the install', async () => {
                mockFetch.mockResolvedValueOnce(jsonResponse({
                    user: {
                        store: {
                            id: 1, title: 'S', url: 'https://s.zid.store',
                            currency: { id: 4, symbol: 'ر.س' }, // no `code`
                        },
                    },
                }));

                const info = await fetchStoreInfo(CREDS);

                expect(info.storeCurrency).toBeUndefined();
                // Identity survives — the merchant still gets a working store.
                expect(info.merchantId).toBe('1');
                expect(info.storeDomain).toBe('s.zid.store');
            });

            it('drops any decorative field of an unexpected shape, never the install', async () => {
                mockFetch.mockResolvedValueOnce(jsonResponse({
                    user: {
                        store: {
                            id: 77,
                            title: { ar: 'متجر', en: 'Store' }, // a shape drift we have not seen yet
                            email: ['a@b.c'],
                            currency: LIVE_CURRENCY,
                            url: 'https://s.zid.store',
                        },
                    },
                }));

                const info = await fetchStoreInfo(CREDS);

                expect(info.storeName).toBeUndefined();
                expect(info.storeEmail).toBeUndefined();
                expect(info.merchantId).toBe('77');
                expect(info.storeCurrency).toBe('SAR');
            });

            it('REPORTS a dropped field to Sentry — a silent drop is how the next drift stays invisible', async () => {
                mockFetch.mockResolvedValueOnce(jsonResponse({
                    user: {
                        store: {
                            id: 77,
                            title: { ar: 'متجر', en: 'Store' },
                            currency: LIVE_CURRENCY,
                            url: 'https://s.zid.store',
                        },
                    },
                }));

                await fetchStoreInfo(CREDS);

                expect(mockCaptureError).toHaveBeenCalledTimes(1);
                const [err, , context] = mockCaptureError.mock.calls[0] as [Error, string, Record<string, any>];
                expect(err.message).toContain("'title'");
                expect(context.level).toBe('warning');
                expect(context.fingerprint).toEqual(['zid-profile-field-drop', 'title']);
                // Shape only — profile fields carry merchant PII, the VALUE must
                // never ship to Sentry.
                expect(JSON.stringify(context.extra)).not.toContain('متجر');
                expect(context.extra.receivedType).toBe('object');
            });

            it('reports a currency object it cannot read (no `code`) the same way', async () => {
                mockFetch.mockResolvedValueOnce(jsonResponse({
                    user: {
                        store: {
                            id: 1, title: 'S', url: 'https://s.zid.store',
                            currency: { id: 4, symbol: 'ر.س' },
                        },
                    },
                }));

                await fetchStoreInfo(CREDS);

                expect(mockCaptureError).toHaveBeenCalledTimes(1);
                const [, , context] = mockCaptureError.mock.calls[0] as [Error, string, Record<string, any>];
                expect(context.fingerprint).toEqual(['zid-profile-field-drop', 'currency']);
            });

            it('does NOT report absence — null, missing, and empty-string fields are not drift', async () => {
                mockFetch.mockResolvedValueOnce(jsonResponse({
                    user: {
                        store: {
                            id: 1,
                            title: 'S',
                            name: null,          // JSON's "no value" — not drift
                            email: '',           // emptiness — not a shape change
                            currency: 'SAR',     // fine
                            url: 'https://s.zid.store',
                            // domain: absent entirely
                        },
                    },
                }));

                const info = await fetchStoreInfo(CREDS);

                expect(info.storeName).toBe('S');
                expect(mockCaptureError).not.toHaveBeenCalled();
            });

            it('treats a missing store id as a hard failure — identity is not decorative', async () => {
                mockFetch.mockResolvedValueOnce(jsonResponse({
                    user: { store: { title: 'No id', currency: LIVE_CURRENCY } },
                }));

                await expect(fetchStoreInfo(CREDS)).rejects.toThrow('no usable store object');
            });
        });
    });

    // ============================================================
    // syncProducts — field mapping (provisional envelope shapes)
    // ============================================================

    describe('syncProducts mapping [provisional — pending Zid live captures]', () => {
        it('fetches /v1/products/ with dual headers + Store-Id (from platformData.merchantId) and maps fields', async () => {
            // The store API 401s ("No such user") without Store-Id; sourced from platformData.merchantId.
            mockGetStoreById.mockResolvedValue(makeStore({ platformData: { merchantId: 'zid-store-99' } }));
            mockFetch.mockResolvedValueOnce(jsonResponse({
                results: [
                    makeZidProduct(),
                    makeZidProduct({
                        id: '1002', name: 'Product 2', has_variants: true,
                        options: [{ name: 'Size', values: [{ name: 'S' }, { name: 'M' }] }],
                    }),
                ],
            }));
            mockReplaceProductsAndRebuildSummary.mockResolvedValue({ productCount: 2 });

            const result = await syncProducts('store-1');

            const call = mockFetch.mock.calls[0] as [string, RequestInit];
            expect(call[0]).toBe('https://api.zid.sa/v1/products/?page_size=100&page=1');
            expectDualHeaders(call, { 'Store-Id': 'zid-store-99' });
            // Role: Manager was proven a no-op against the live API and removed.
            expect((call[1].headers as Record<string, string>)['Role']).toBeUndefined();

            expect(mockReplaceProductsAndRebuildSummary).toHaveBeenCalledWith(
                'store-1',
                expect.arrayContaining([
                    expect.objectContaining({
                        platformProductId: '1001',
                        title: 'Test Product',
                        handle: 'test-product',
                        status: 'active',
                        priceRange: '150 SAR',
                        currency: 'SAR',
                        totalInventory: 20,
                        hasVariants: false,
                        productType: 'Electronics',
                        imageUrl: 'https://cdn.zid.sa/image.jpg',
                    }),
                    expect.objectContaining({
                        platformProductId: '1002',
                        hasVariants: true,
                        variantSummary: 'Size: S, M',
                    }),
                ]),
            );
            expect(result).toEqual({ productCount: 2 });
        });

        it.each(['results', 'store_products', 'products'])(
            'tolerates the %s envelope key',
            async (key) => {
                mockFetch.mockResolvedValueOnce(jsonResponse({ [key]: [makeZidProduct()] }));

                await syncProducts('store-1');

                const [, products] = mockReplaceProductsAndRebuildSummary.mock.calls[0] as [string, unknown[]];
                expect(products).toHaveLength(1);
            },
        );

        // F1: Zid signals unlimited stock as `is_infinite: true` with `quantity: null`.
        // Mapping that to 0 advertised a merchant's flagship product as out of stock.
        // Live-verified on dev store 3195980 ("Sony A7S III").
        it('maps is_infinite:true to a null totalInventory — unlimited is not zero', async () => {
            mockFetch.mockResolvedValueOnce(jsonResponse({
                results: [makeZidProduct({ name: 'Sony A7S III', is_infinite: true, quantity: null })],
            }));

            await syncProducts('store-1');

            const [, products] = mockReplaceProductsAndRebuildSummary.mock.calls[0] as [string, Array<{ totalInventory: number | null }>];
            expect(products[0].totalInventory).toBeNull();
        });

        it('keeps a missing quantity at 0 when is_infinite is absent — only the flag earns null', async () => {
            mockFetch.mockResolvedValueOnce(jsonResponse({
                results: [makeZidProduct({ quantity: null })],
            }));

            await syncProducts('store-1');

            const [, products] = mockReplaceProductsAndRebuildSummary.mock.calls[0] as [string, Array<{ totalInventory: number | null }>];
            expect(products[0].totalInventory).toBe(0);
        });

        it('prefers Arabic for multilingual name/description objects', async () => {
            mockFetch.mockResolvedValueOnce(jsonResponse({
                results: [makeZidProduct({
                    name: { ar: 'حذاء رياضي', en: 'Sneaker' },
                    description: { ar: '<p>وصف عربي</p>', en: '<p>English desc</p>' },
                })],
            }));

            await syncProducts('store-1');

            const [, products] = mockReplaceProductsAndRebuildSummary.mock.calls[0] as [string, Array<{ title: string; description: string }>];
            expect(products[0].title).toBe('حذاء رياضي');
            expect(products[0].description).toBe('وصف عربي');
        });

        it('falls back to English when Arabic is absent in a multilingual field', async () => {
            mockFetch.mockResolvedValueOnce(jsonResponse({
                results: [makeZidProduct({ name: { en: 'English Only' } })],
            }));

            await syncProducts('store-1');

            const [, products] = mockReplaceProductsAndRebuildSummary.mock.calls[0] as [string, Array<{ title: string }>];
            expect(products[0].title).toBe('English Only');
        });

        it('prefers sale_price over price for the price range', async () => {
            mockFetch.mockResolvedValueOnce(jsonResponse({
                results: [makeZidProduct({ price: 150, sale_price: 99 })],
            }));

            await syncProducts('store-1');

            const [, products] = mockReplaceProductsAndRebuildSummary.mock.calls[0] as [string, Array<{ priceRange: string }>];
            expect(products[0].priceRange).toBe('99 SAR');
        });

        it('maps statuses: published→active, draft/inactive→hidden, out_of_stock kept', async () => {
            mockFetch.mockResolvedValueOnce(jsonResponse({
                results: [
                    makeZidProduct({ id: 'a', status: 'published' }),
                    makeZidProduct({ id: 'b', status: 'draft' }),
                    makeZidProduct({ id: 'c', status: 'inactive' }),
                    makeZidProduct({ id: 'd', status: 'out_of_stock' }),
                ],
            }));

            await syncProducts('store-1');

            const [, products] = mockReplaceProductsAndRebuildSummary.mock.calls[0] as [string, Array<{ status: string }>];
            expect(products.map(p => p.status)).toEqual(['active', 'hidden', 'hidden', 'out_of_stock']);
        });

        it('reads image URLs from the nested image.full_size shape too', async () => {
            mockFetch.mockResolvedValueOnce(jsonResponse({
                results: [makeZidProduct({ images: [{ image: { full_size: 'https://cdn.zid.sa/full.jpg' } }] })],
            }));

            await syncProducts('store-1');

            const [, products] = mockReplaceProductsAndRebuildSummary.mock.calls[0] as [string, Array<{ imageUrl: string }>];
            expect(products[0].imageUrl).toBe('https://cdn.zid.sa/full.jpg');
        });
    });

    // ============================================================
    // syncProducts — contract-independent behavior
    // ============================================================

    describe('syncProducts guards and pagination', () => {
        it('strips HTML from descriptions', async () => {
            mockFetch.mockResolvedValueOnce(jsonResponse({
                results: [makeZidProduct({ description: '<p>Great <strong>product</strong></p>' })],
            }));

            await syncProducts('store-1');

            const [, products] = mockReplaceProductsAndRebuildSummary.mock.calls[0] as [string, Array<{ description: string }>];
            expect(products[0].description).not.toContain('<');
            expect(products[0].description).toContain('Great');
            expect(products[0].description).toContain('product');
        });

        it('filters out deleted products', async () => {
            mockFetch.mockResolvedValueOnce(jsonResponse({
                results: [
                    makeZidProduct({ status: 'deleted' }),
                    makeZidProduct({ id: '2', name: 'Active' }),
                ],
            }));

            await syncProducts('store-1');

            const [, products] = mockReplaceProductsAndRebuildSummary.mock.calls[0] as [string, Array<{ title: string }>];
            expect(products).toHaveLength(1);
            expect(products[0].title).toBe('Active');
        });

        it('paginates while pages come back full, stopping at the first short page', async () => {
            const fullPage = Array.from({ length: 100 }, (_, i) => makeZidProduct({ id: `p${i}` }));
            mockFetch
                .mockResolvedValueOnce(jsonResponse({ results: fullPage }))
                .mockResolvedValueOnce(jsonResponse({ results: [makeZidProduct({ id: 'last' })] }));

            await syncProducts('store-1');

            expect(mockFetch).toHaveBeenCalledTimes(2);
            expect(mockFetch.mock.calls[0][0]).toContain('page=1');
            expect(mockFetch.mock.calls[1][0]).toContain('page=2');
            const [, products] = mockReplaceProductsAndRebuildSummary.mock.calls[0] as [string, unknown[]];
            expect(products).toHaveLength(101);
        });

        it('stops when the envelope says next === null even if the page is full', async () => {
            const fullPage = Array.from({ length: 100 }, (_, i) => makeZidProduct({ id: `p${i}` }));
            mockFetch.mockResolvedValueOnce(jsonResponse({ results: fullPage, next: null }));

            await syncProducts('store-1');

            expect(mockFetch).toHaveBeenCalledTimes(1);
        });

        it('throws "Store not found" when the store row is missing', async () => {
            mockGetStoreById.mockResolvedValue(null);

            await expect(syncProducts('no-such-store')).rejects.toThrow('Store not found');
        });

        it('throws "Store not found" when the store is inactive', async () => {
            mockGetStoreById.mockResolvedValue(makeStore({ isActive: false, tokenExpiresAt: null }));

            await expect(syncProducts('store-1')).rejects.toThrow('Store not found');
        });

        it('throws a diagnosable error when the store row lacks the second (Authorization) credential', async () => {
            mockGetStoreById.mockResolvedValue(makeStore({ authorizationToken: null, authorizationTokenIv: null }));

            await expect(syncProducts('store-1')).rejects.toThrow('no Authorization token');
        });
    });

    // ============================================================
    // fullSync
    // ============================================================

    describe('fullSync', () => {
        it('applies store info as a merge patch (with merchantId) and then syncs products', async () => {
            mockFetch
                // fetchStoreInfo
                .mockResolvedValueOnce(jsonResponse({
                    user: {
                        store: {
                            id: 99,
                            title: 'Updated Store Name',
                            email: 'updated@zid.sa',
                            currency: 'SAR',
                            url: 'https://demo.zid.store',
                        },
                    },
                }))
                // syncProducts page 1
                .mockResolvedValueOnce(jsonResponse({ results: [makeZidProduct()] }));

            await fullSync('store-1');

            expect(mockApplySyncedStoreInfo).toHaveBeenCalledWith(
                'store-1',
                expect.objectContaining({
                    storeName: 'Updated Store Name',
                    storeEmail: 'updated@zid.sa',
                    storeCurrency: 'SAR',
                }),
                { merchantId: '99' },
            );
            expect(mockReplaceProductsAndRebuildSummary).toHaveBeenCalled();
        });

        it('throws when store not found', async () => {
            mockGetStoreById.mockResolvedValue(null);

            await expect(fullSync('no-such-store')).rejects.toThrow('Store not found');
        });
    });

    // ============================================================
    // Token refresh (shared refresher wired with the Zid config)
    // ============================================================

    describe('refreshAccessToken', () => {
        beforeEach(() => {
            vi.useFakeTimers();
        });

        afterEach(() => {
            vi.useRealTimers();
        });

        it('skips refresh if the Redis lock is already held', async () => {
            mockRedisSet.mockResolvedValueOnce(null); // lock not acquired

            const promise = refreshAccessToken('store-1');
            await vi.advanceTimersByTimeAsync(2001);
            await promise;

            expect(mockFetch).not.toHaveBeenCalled();
            expect(mockUpdateStoreTokens).not.toHaveBeenCalled();
        });

        it('skips refresh if the token expires more than 24h from now', async () => {
            mockGetStoreById.mockResolvedValue(
                makeStore({ tokenExpiresAt: new Date(Date.now() + 48 * 60 * 60 * 1000) }),
            );

            await refreshAccessToken('store-1');

            expect(mockFetch).not.toHaveBeenCalled();
        });

        it('refreshes near expiry and passes the rotated Authorization credential through', async () => {
            mockGetStoreById.mockResolvedValue(
                makeStore({ tokenExpiresAt: new Date(Date.now() + 30 * 60 * 1000) }),
            );
            mockFetch.mockResolvedValueOnce(jsonResponse({
                access_token: 'new_manager',
                refresh_token: 'new_refresh',
                expires_in: 31536000,
                Authorization: 'new_auth_jwt',
            }));

            await refreshAccessToken('store-1');

            const [url, opts] = mockFetch.mock.calls[0] as [string, RequestInit];
            expect(url).toBe('https://oauth.zid.sa/oauth/token');
            const body = new URLSearchParams(opts.body as string);
            expect(body.get('grant_type')).toBe('refresh_token');
            expect(body.get('refresh_token')).toBe('refresh_plain');
            expect(body.get('client_id')).toBe('test_zid_client_id');

            expect(mockUpdateStoreTokens).toHaveBeenCalledWith('store-1', expect.objectContaining({
                accessToken: 'new_manager',
                refreshToken: 'new_refresh',
                authorizationToken: 'new_auth_jwt',
            }));
        });

        it('leaves authorizationToken undefined when the refresh response omits it', async () => {
            mockGetStoreById.mockResolvedValue(
                makeStore({ tokenExpiresAt: new Date(Date.now() + 30 * 60 * 1000) }),
            );
            mockFetch.mockResolvedValueOnce(jsonResponse({
                access_token: 'new_manager',
                refresh_token: 'new_refresh',
                expires_in: 31536000,
            }));

            await refreshAccessToken('store-1');

            const tokens = mockUpdateStoreTokens.mock.calls[0][1] as { authorizationToken?: string };
            expect(tokens.authorizationToken).toBeUndefined();
        });

        it('always releases the Redis lock even on error', async () => {
            mockGetStoreById.mockResolvedValue(
                makeStore({ tokenExpiresAt: new Date(Date.now() + 30 * 60 * 1000) }),
            );
            mockFetch.mockResolvedValueOnce({ ok: false, status: 503, text: async () => 'Service Unavailable' });

            await expect(refreshAccessToken('store-1')).rejects.toThrow('Zid token refresh failed');
            expect(mockRedisDel).toHaveBeenCalledWith('zid:token_refresh:store-1');
        });
    });

    describe('ensureValidToken', () => {
        it('does not refresh when the token has no expiry set (assumed non-expiring)', async () => {
            mockGetStoreById.mockResolvedValue(makeStore({ tokenExpiresAt: null }));

            await ensureValidToken('store-1');

            expect(mockFetch).not.toHaveBeenCalled();
        });

        it('does not refresh when the token expires well in the future', async () => {
            await ensureValidToken('store-1');

            expect(mockFetch).not.toHaveBeenCalled();
        });
    });

    describe('refreshExpiringTokens / getStoresNeedingTokenRefresh', () => {
        it('returns 0 when no stores need refresh', async () => {
            const count = await refreshExpiringTokens();
            expect(count).toBe(0);
        });

        it('captures errors for failed refreshes and continues', async () => {
            mockDbWhere.mockResolvedValueOnce([{ id: 'store-fail', platformData: {} }]);
            mockGetStoreById.mockResolvedValue(null); // refresh throws Store not found

            const count = await refreshExpiringTokens();

            expect(count).toBe(0);
            expect(mockCaptureError).toHaveBeenCalled();
        });

        it('getStoresNeedingTokenRefresh filters demo-seeded stores', async () => {
            mockDbWhere.mockResolvedValueOnce([
                { id: 'real-store', platformData: {} },
                { id: 'demo-store', platformData: { demo: true } },
            ]);

            const stores = await getStoresNeedingTokenRefresh();
            expect(stores).toEqual([{ id: 'real-store' }]);
        });
    });

    // ============================================================
    // normalizeZidPhone
    // ============================================================

    describe('normalizeZidPhone', () => {
        it('prepends + to a full international number without one', () => {
            expect(normalizeZidPhone('966591555966')).toBe('+966591555966');
        });

        it('handles a numeric mobile value', () => {
            expect(normalizeZidPhone(966591555966)).toBe('+966591555966');
        });

        it('passes through a +-prefixed number unchanged', () => {
            expect(normalizeZidPhone('+966591555966')).toBe('+966591555966');
        });

        it('trims surrounding whitespace', () => {
            expect(normalizeZidPhone('  966591555966  ')).toBe('+966591555966');
        });

        it('returns undefined for empty/null/undefined input', () => {
            expect(normalizeZidPhone('')).toBeUndefined();
            expect(normalizeZidPhone('   ')).toBeUndefined();
            expect(normalizeZidPhone(null)).toBeUndefined();
            expect(normalizeZidPhone(undefined)).toBeUndefined();
        });
    });

    // ============================================================
    // mapZidOrderStatus
    // ============================================================

    describe('mapZidOrderStatus', () => {
        it.each([
            ['new', 'pending'],
            ['preparing', 'processing'],
            ['ready', 'processing'],
            ['indelivery', 'shipped'],
            ['delivered', 'delivered'],
            ['canceled', 'cancelled'],
            ['cancelled', 'cancelled'],
            ['refunded', 'refunded'],
        ])('maps %s → %s', (input, expected) => {
            expect(mapZidOrderStatus(input)).toBe(expected);
        });

        it('is case-insensitive (webhook docs show camelCase inDelivery)', () => {
            expect(mapZidOrderStatus('inDelivery')).toBe('shipped');
            expect(mapZidOrderStatus('NEW')).toBe('pending');
        });

        it('passes unknown statuses through', () => {
            expect(mapZidOrderStatus('weird_status')).toBe('weird_status');
        });
    });

    // ============================================================
    // Order/inventory agent tools (client-side scan)
    // ============================================================

    describe('lookupOrder [provisional — pending Zid live captures]', () => {
        const order = {
            id: 9001,
            code: 'ORD-100',
            invoice_number: 555,
            order_status: { code: 'inDelivery', name: 'قيد التوصيل' },
            order_total: 300.5,
            order_total_string: '300.50 SAR',
            currency_code: 'SAR',
            customer: { id: 5, name: 'Ahmed Ali', mobile: '966591555966' },
            created_at: '2026-07-01T10:00:00Z',
            products: [{ name: { ar: 'منتج' }, quantity: 2, price: 150 }],
        };

        it('scans /v1/managers/store/orders with dual headers and maps a match by code', async () => {
            mockFetch.mockResolvedValueOnce(jsonResponse({ orders: [order] }));

            const result = await lookupOrder('store-1', 'ORD-100');

            const call = mockFetch.mock.calls[0] as [string, RequestInit];
            expect(call[0]).toBe('https://api.zid.sa/v1/managers/store/orders?page=1&per_page=100&payload_type=default');
            expectDualHeaders(call);

            expect(result).not.toBeNull();
            expect(result?.orderNumber).toBe('ORD-100'); // code preferred over id
            expect(result?.customerFirstName).toBe('Ahmed');
            expect(result?.customerPhone).toBe('+966591555966');
            expect(result?.status).toBe('shipped'); // inDelivery, case-insensitive
            expect(result?.totalAmount).toBe('300.50 SAR'); // order_total_string preferred
            expect(result?.currency).toBe('SAR');
            expect(result?.items).toEqual([{ name: 'منتج', quantity: 2, price: '150 SAR' }]);
        });

        it('defaults paymentStatus to "unknown" — NEVER a fabricated "paid"', async () => {
            mockFetch.mockResolvedValueOnce(jsonResponse({ orders: [order] }));

            const result = await lookupOrder('store-1', 'ORD-100');
            expect(result?.paymentStatus).toBe('unknown');
        });

        it('uses payment_status when the order carries one', async () => {
            mockFetch.mockResolvedValueOnce(jsonResponse({ orders: [{ ...order, payment_status: 'paid' }] }));

            const result = await lookupOrder('store-1', 'ORD-100');
            expect(result?.paymentStatus).toBe('paid');
        });

        it('matches by internal id and by invoice number, and strips a leading #', async () => {
            mockFetch.mockResolvedValue(jsonResponse({ orders: [order] }));

            expect((await lookupOrder('store-1', '9001'))?.orderNumber).toBe('ORD-100');
            expect((await lookupOrder('store-1', '555'))?.orderNumber).toBe('ORD-100');
            expect((await lookupOrder('store-1', '#ORD-100'))?.orderNumber).toBe('ORD-100');
        });

        it('falls back to order_total when order_total_string is absent', async () => {
            mockFetch.mockResolvedValueOnce(jsonResponse({ orders: [{ ...order, order_total_string: undefined }] }));

            const result = await lookupOrder('store-1', 'ORD-100');
            expect(result?.totalAmount).toBe('300.5');
        });

        it('scans subsequent pages when the first full page has no match', async () => {
            const fullPage = Array.from({ length: 100 }, (_, i) => ({ ...order, id: i, code: `X-${i}`, invoice_number: undefined }));
            mockFetch
                .mockResolvedValueOnce(jsonResponse({ orders: fullPage }))
                .mockResolvedValueOnce(jsonResponse({ orders: [order] }));

            const result = await lookupOrder('store-1', 'ORD-100');

            expect(mockFetch).toHaveBeenCalledTimes(2);
            expect(mockFetch.mock.calls[1][0]).toContain('page=2');
            expect(result?.orderNumber).toBe('ORD-100');
        });

        it('gives up after 3 full pages without a match', async () => {
            const fullPage = Array.from({ length: 100 }, (_, i) => ({ ...order, id: i, code: `X-${i}`, invoice_number: undefined }));
            mockFetch.mockResolvedValue(jsonResponse({ orders: fullPage }));

            const result = await lookupOrder('store-1', 'ORD-100');

            expect(result).toBeNull();
            expect(mockFetch).toHaveBeenCalledTimes(3);
        });

        it('returns null when the order is not found on a short page', async () => {
            mockFetch.mockResolvedValueOnce(jsonResponse({ orders: [] }));

            expect(await lookupOrder('store-1', '99999')).toBeNull();
            expect(mockFetch).toHaveBeenCalledTimes(1);
        });

        it('returns null when the store cannot be resolved', async () => {
            mockGetStoreById.mockResolvedValue(makeStore({ isActive: false, tokenExpiresAt: null }));

            expect(await lookupOrder('store-1', 'ORD-100')).toBeNull();
            expect(mockFetch).not.toHaveBeenCalled();
        });
    });

    describe('getShipmentTracking [provisional — pending Zid live captures]', () => {
        it('reads flat tracking fields', async () => {
            mockFetch.mockResolvedValueOnce(jsonResponse({
                orders: [{
                    id: 1, code: 'ORD-7',
                    order_status: { code: 'indelivery' },
                    customer: { name: 'Ahmed Ali', mobile: '966591555966' },
                    tracking_number: 'TRK-ZID-001',
                    courier_name: 'SMSA',
                    tracking_url: 'https://track.smsa.com.sa/TRK-ZID-001',
                }],
            }));

            const result = await getShipmentTracking('store-1', 'ORD-7');

            expect(result).toMatchObject({
                orderNumber: 'ORD-7',
                customerFirstName: 'Ahmed',
                customerPhone: '+966591555966',
                status: 'shipped',
                trackingNumber: 'TRK-ZID-001',
                courierName: 'SMSA',
                trackingUrl: 'https://track.smsa.com.sa/TRK-ZID-001',
            });
        });

        it('reads nested shipping.* tracking fields as a fallback', async () => {
            mockFetch.mockResolvedValueOnce(jsonResponse({
                orders: [{
                    id: 2, code: 'ORD-8',
                    status: 'delivered', // flat status string variant
                    customer: { name: 'Sara', mobile: '966500000000' },
                    shipping: { tracking_number: 'TRK-2', courier: 'Aramex', tracking_url: 'https://aramex/TRK-2' },
                }],
            }));

            const result = await getShipmentTracking('store-1', 'ORD-8');

            expect(result).toMatchObject({
                status: 'delivered',
                trackingNumber: 'TRK-2',
                courierName: 'Aramex',
                trackingUrl: 'https://aramex/TRK-2',
            });
        });

        it('returns null when the order is not found', async () => {
            mockFetch.mockResolvedValueOnce(jsonResponse({ orders: [] }));
            expect(await getShipmentTracking('store-1', 'nope')).toBeNull();
        });
    });

    describe('getProductById [id__in live-verified 2026-08-22] (D-092)', () => {
        it('GETs /v1/products/?id__in=<id>&page_size=1 with dual headers + Store-Id and maps through the sync mapper', async () => {
            mockGetStoreById.mockResolvedValue(makeStore({ platformData: { merchantId: 'zid-store-99' } }));
            mockFetch.mockResolvedValueOnce(jsonResponse({
                results: [makeZidProduct({
                    id: 'd2fc56d9', name: { ar: 'سوني A7S III', en: 'Sony A7S III' }, is_infinite: true, quantity: null,
                    price: 10000, html_url: 'https://demo.zid.store/products/sony-a7s-iii',
                    options: [{ name: 'Kit', values: [{ name: 'Body only' }] }],
                })],
            }));

            const result = await getProductById('store-1', 'd2fc56d9');

            const call = mockFetch.mock.calls[0] as [string, RequestInit];
            expect(call[0]).toBe('https://api.zid.sa/v1/products/?id__in=d2fc56d9&page_size=1');
            expectDualHeaders(call, { 'Store-Id': 'zid-store-99' });

            expect(result).toMatchObject({
                platformProductId: 'd2fc56d9',
                title: 'سوني A7S III',
                status: 'active',
                priceRange: '10000 SAR',
                // is_infinite → null (unlimited), never 0 — F1 must survive the by-id read too.
                totalInventory: null,
                productUrl: 'https://demo.zid.store/products/sony-a7s-iii',
                variants: [{ name: 'Kit: Body only', available: true, quantity: undefined }],
            });
        });

        it('picks the row BY ID from the envelope — never [0]', async () => {
            mockFetch.mockResolvedValueOnce(jsonResponse({
                results: [makeZidProduct({ id: 'other-1', name: 'Other' }), makeZidProduct({ id: 'want-2', name: 'Wanted', quantity: 3 })],
            }));
            const result = await getProductById('store-1', 'want-2');
            expect(result?.title).toBe('Wanted');
            expect(result?.totalInventory).toBe(3);
        });

        it('returns null when the envelope holds a different product than asked for', async () => {
            mockFetch.mockResolvedValueOnce(jsonResponse({ results: [makeZidProduct({ id: 'other-1' })] }));
            expect(await getProductById('store-1', 'want-2')).toBeNull();
        });

        it('treats HTTP 400 as "no such product" (live capture: an unknown id answers 400, not an empty list)', async () => {
            mockFetch.mockResolvedValueOnce(jsonResponse({ detail: 'invalid id' }, 400));
            expect(await getProductById('store-1', 'nope')).toBeNull();
        });

        it('still throws on other failures (a 5xx is an API error, not a missing product)', async () => {
            // ecommerceApiGet retries a 5xx three times with 1s/2s/4s backoff — real
            // timers would blow the 5s test budget, so the clock is advanced instead.
            vi.useFakeTimers();
            try {
                mockFetch.mockResolvedValue(jsonResponse({ detail: 'down' }, 503));
                const outcome = expect(getProductById('store-1', 'x')).rejects.toThrow();
                await vi.runAllTimersAsync();
                await outcome;
            } finally {
                vi.useRealTimers();
            }
        });
    });

    });
