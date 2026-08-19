import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';

// ── Mocks ────────────────────────────────────────────────────────────────────

// Track what Capacitor.isNativePlatform() returns
let mockIsNative = false;

vi.mock('@capacitor/core', () => ({
    Capacitor: {
        isNativePlatform: () => mockIsNative,
        getPlatform: () => (mockIsNative ? 'android' : 'web'),
    },
}));

const mockRequestPermissions = vi.fn();
const mockRegister = vi.fn();
const mockAddListener = vi.fn();

vi.mock('@capacitor/push-notifications', () => ({
    PushNotifications: {
        requestPermissions: () => mockRequestPermissions(),
        register: () => mockRegister(),
        addListener: (...args: unknown[]) => mockAddListener(...args),
    },
}));

// In-memory native preferences store (simulates SharedPreferences/UserDefaults)
const nativeStore = new Map<string, string>();

vi.mock('@capacitor/preferences', () => ({
    Preferences: {
        get: async ({ key }: { key: string }) => ({ value: nativeStore.get(key) ?? null }),
        set: async ({ key, value }: { key: string; value: string }) => { nativeStore.set(key, value); },
        remove: async ({ key }: { key: string }) => { nativeStore.delete(key); },
    },
}));

vi.mock('@/lib/sentryHelpers', () => ({
    captureError: vi.fn(),
    addErrorBreadcrumb: vi.fn(),
}));

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
const mockApiGet = vi.fn();
vi.mock('./api', () => ({ api: { get: (...args: unknown[]) => mockApiGet(...args) } }));
vi.mock('axios', () => ({ default: { post: vi.fn() } }));

// ── Helpers ──────────────────────────────────────────────────────────────────

const PERM_DISMISSED_KEY = 'push_prompt_dismissed_at';
const PERM_GRANTED_KEY = 'push_permission_granted';
const DISMISS_COOLDOWN_DAYS = 7;

function daysAgoMs(days: number): string {
    return String(Date.now() - days * 24 * 60 * 60 * 1000);
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('Notification pre-prompt — web (non-native)', () => {
    beforeEach(() => {
        mockIsNative = false;
        localStorage.clear();
        nativeStore.clear();
    });

    it('shouldShow returns false on web', async () => {
        const { shouldShowNotificationPrePrompt } = await import('./notifications');
        expect(await shouldShowNotificationPrePrompt()).toBe(false);
    });
});

describe('Notification pre-prompt — native', () => {
    beforeEach(() => {
        mockIsNative = true;
        localStorage.clear();
        nativeStore.clear();
        vi.clearAllMocks();
    });

    afterEach(() => {
        mockIsNative = false;
    });

    it('shouldShow returns true when no prior interaction', async () => {
        const { shouldShowNotificationPrePrompt } = await import('./notifications');
        expect(await shouldShowNotificationPrePrompt()).toBe(true);
    });

    it('shouldShow returns false when permission was granted', async () => {
        nativeStore.set(PERM_GRANTED_KEY, 'true');
        const { shouldShowNotificationPrePrompt } = await import('./notifications');
        expect(await shouldShowNotificationPrePrompt()).toBe(false);
    });

    it('shouldShow returns false when dismissed within cooldown', async () => {
        nativeStore.set(PERM_DISMISSED_KEY, daysAgoMs(3)); // 3 days ago
        const { shouldShowNotificationPrePrompt } = await import('./notifications');
        expect(await shouldShowNotificationPrePrompt()).toBe(false);
    });

    it('shouldShow returns true when dismissed beyond cooldown', async () => {
        nativeStore.set(PERM_DISMISSED_KEY, daysAgoMs(DISMISS_COOLDOWN_DAYS + 1));
        const { shouldShowNotificationPrePrompt } = await import('./notifications');
        expect(await shouldShowNotificationPrePrompt()).toBe(true);
    });

    it('dismiss saves timestamp to native preferences', async () => {
        const { dismissNotificationPrePrompt } = await import('./notifications');
        await dismissNotificationPrePrompt();
        const stored = nativeStore.get(PERM_DISMISSED_KEY);
        expect(stored).toBeDefined();
        expect(Number(stored)).toBeGreaterThan(Date.now() - 5000);
    });
});

describe('Notification pre-prompt — migration', () => {
    beforeEach(() => {
        mockIsNative = true;
        localStorage.clear();
        nativeStore.clear();
        vi.clearAllMocks();
    });

    afterEach(() => {
        mockIsNative = false;
    });

    it('migrates granted flag from localStorage to native preferences', async () => {
        localStorage.setItem(PERM_GRANTED_KEY, 'true');
        const { shouldShowNotificationPrePrompt } = await import('./notifications');
        const result = await shouldShowNotificationPrePrompt();

        expect(result).toBe(false); // granted → don't show
        expect(nativeStore.get(PERM_GRANTED_KEY)).toBe('true');
        expect(localStorage.getItem(PERM_GRANTED_KEY)).toBeNull(); // cleaned up
    });

    it('migrates dismissed timestamp from localStorage to native preferences', async () => {
        const ts = daysAgoMs(2);
        localStorage.setItem(PERM_DISMISSED_KEY, ts);
        const { shouldShowNotificationPrePrompt } = await import('./notifications');
        const result = await shouldShowNotificationPrePrompt();

        expect(result).toBe(false); // within cooldown
        expect(nativeStore.get(PERM_DISMISSED_KEY)).toBe(ts);
        expect(localStorage.getItem(PERM_DISMISSED_KEY)).toBeNull();
    });

    it('skips migration if native preferences already has data', async () => {
        nativeStore.set(PERM_GRANTED_KEY, 'true');
        localStorage.setItem(PERM_DISMISSED_KEY, daysAgoMs(1)); // stale localStorage
        const { shouldShowNotificationPrePrompt } = await import('./notifications');
        await shouldShowNotificationPrePrompt();

        // localStorage value should NOT be migrated (native already has data)
        expect(nativeStore.has(PERM_DISMISSED_KEY)).toBe(false);
    });
});

describe('requestAndRegisterPush', () => {
    beforeEach(() => {
        mockIsNative = true;
        localStorage.clear();
        nativeStore.clear();
        vi.clearAllMocks();
        mockRegister.mockResolvedValue(undefined);
        mockAddListener.mockReturnValue({ remove: vi.fn() });
    });

    afterEach(() => {
        mockIsNative = false;
    });

    it('saves granted flag when permission is granted', async () => {
        mockRequestPermissions.mockResolvedValue({ receive: 'granted' });
        const { requestAndRegisterPush } = await import('./notifications');

        const result = await requestAndRegisterPush('test-token');

        expect(result).toBe(true);
        expect(nativeStore.get(PERM_GRANTED_KEY)).toBe('true');
    });

    it('saves dismissed timestamp when permission is denied', async () => {
        mockRequestPermissions.mockResolvedValue({ receive: 'denied' });
        const { requestAndRegisterPush } = await import('./notifications');

        const result = await requestAndRegisterPush('test-token');

        expect(result).toBe(false);
        expect(nativeStore.has(PERM_DISMISSED_KEY)).toBe(true);
        expect(nativeStore.has(PERM_GRANTED_KEY)).toBe(false);
    });

    it('saves dismissed timestamp when plugin throws error', async () => {
        mockRequestPermissions.mockRejectedValue(new Error('Samsung WebView quirk'));
        const { requestAndRegisterPush } = await import('./notifications');

        const result = await requestAndRegisterPush('test-token');

        expect(result).toBe(false);
        expect(nativeStore.has(PERM_DISMISSED_KEY)).toBe(true);
    });

    it('returns false on web', async () => {
        mockIsNative = false;
        const { requestAndRegisterPush } = await import('./notifications');

        const result = await requestAndRegisterPush('test-token');

        expect(result).toBe(false);
        expect(mockRequestPermissions).not.toHaveBeenCalled();
    });

    it('prompt does not reappear after granting', async () => {
        mockRequestPermissions.mockResolvedValue({ receive: 'granted' });
        const { requestAndRegisterPush, shouldShowNotificationPrePrompt } = await import('./notifications');

        await requestAndRegisterPush('test-token');
        const shouldShow = await shouldShowNotificationPrePrompt();

        expect(shouldShow).toBe(false);
    });

    it('prompt does not reappear immediately after denying', async () => {
        mockRequestPermissions.mockResolvedValue({ receive: 'denied' });
        const { requestAndRegisterPush, shouldShowNotificationPrePrompt } = await import('./notifications');

        await requestAndRegisterPush('test-token');
        const shouldShow = await shouldShowNotificationPrePrompt();

        expect(shouldShow).toBe(false);
    });

    it('prompt does not reappear immediately after plugin error', async () => {
        mockRequestPermissions.mockRejectedValue(new Error('fail'));
        const { requestAndRegisterPush, shouldShowNotificationPrePrompt } = await import('./notifications');

        await requestAndRegisterPush('test-token');
        const shouldShow = await shouldShowNotificationPrePrompt();

        expect(shouldShow).toBe(false);
    });
});

describe('registerPushListeners — listener order (prevents FCM token loss)', () => {
    beforeEach(() => {
        mockIsNative = true;
        localStorage.clear();
        nativeStore.clear();
        vi.clearAllMocks();
        vi.resetModules();
        mockRegister.mockResolvedValue(undefined);
        mockAddListener.mockReturnValue({ remove: vi.fn() });
    });

    afterEach(() => {
        mockIsNative = false;
    });

    it('attaches the registration listener before calling register()', async () => {
        mockRequestPermissions.mockResolvedValue({ receive: 'granted' });
        const { requestAndRegisterPush } = await import('./notifications');
        await requestAndRegisterPush('test-token');

        // register() emits the FCM token event with no replay — every
        // addListener call must happen first, or the token is lost and
        // the backend never records a device token.
        const [firstRegisterOrder] = mockRegister.mock.invocationCallOrder;
        expect(firstRegisterOrder).toBeDefined();
        for (const order of mockAddListener.mock.invocationCallOrder) {
            expect(order).toBeLessThan(firstRegisterOrder);
        }

        const events = mockAddListener.mock.calls.map(args => args[0]);
        expect(events).toContain('registration');
        expect(events).toContain('registrationError');
        expect(events).toContain('pushNotificationReceived');
    });

    it('is idempotent — a second call does not re-register listeners or re-call register()', async () => {
        mockRequestPermissions.mockResolvedValue({ receive: 'granted' });
        const { requestAndRegisterPush } = await import('./notifications');

        await requestAndRegisterPush('test-token');
        const addCalls = mockAddListener.mock.calls.length;
        const registerCalls = mockRegister.mock.calls.length;

        await requestAndRegisterPush('test-token');
        expect(mockAddListener.mock.calls.length).toBe(addCalls);
        expect(mockRegister.mock.calls.length).toBe(registerCalls);
    });

    it('initPushNotifications attaches listeners for returning users (permission already granted)', async () => {
        nativeStore.set(PERM_GRANTED_KEY, 'true');
        const { initPushNotifications } = await import('./notifications');

        await initPushNotifications('test-token');

        expect(mockRequestPermissions).not.toHaveBeenCalled(); // no system dialog
        expect(mockRegister).toHaveBeenCalledTimes(1);
        const events = mockAddListener.mock.calls.map(args => args[0]);
        expect(events).toContain('registration');
    });
});

describe('Notification locale resolution', () => {
    beforeEach(async () => {
        mockApiGet.mockReset();
        mockApiGet.mockResolvedValue({ data: { notifications: [], unreadCount: 0 } });
        const { useUIStore } = await import('./store');
        useUIStore.setState({ language: 'ar' });
        window.history.pushState({}, '', '/');
    });

    async function requestedLang(): Promise<string | undefined> {
        const { getNotifications } = await import('./notifications');
        await getNotifications();
        const params = mockApiGet.mock.calls[0]?.[1] as { params?: { lang?: string } } | undefined;
        return params?.params?.lang;
    }

    // The native app is a static export with `i18n: undefined`, so no locale
    // prefix ever reaches the path — the store is the ONLY signal. Reading the
    // URL alone served Arabic notifications inside an English app.
    it('uses the store language when the path carries no locale prefix', async () => {
        const { useUIStore } = await import('./store');
        useUIStore.getState().setLanguage('en');
        expect(await requestedLang()).toBe('en');
    });

    it('prefers the URL prefix over the store (web has i18n routing)', async () => {
        const { useUIStore } = await import('./store');
        useUIStore.getState().setLanguage('en');
        window.history.pushState({}, '', '/ar/dashboard');
        expect(await requestedLang()).toBe('ar');
    });

    it('falls back to Arabic when neither the path nor the store says English', async () => {
        expect(await requestedLang()).toBe('ar');
    });
});
