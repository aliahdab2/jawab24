import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, act, fireEvent } from '@testing-library/react';
import enSettings from '@/i18n/en/settings.json';
import SettingsPage from '@/pages/settings';
import { settingsApi } from '@/lib/api';

// Settings page shows toast.error when a save is attempted in a degraded state
// (e.g. after a failed initial fetch). Mock sonner so those calls don't blow up
// the JSDOM environment.
vi.mock('sonner', () => ({
    toast: { success: vi.fn(), error: vi.fn() },
}));

// The settings page invalidates the shared ['comment-reply-config'] query on save so
// the Post Reply modal reflects a mode change immediately. Provide a QueryClient stub
// (these tests don't wrap in a QueryClientProvider) without touching the rest of the lib.
vi.mock('@tanstack/react-query', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@tanstack/react-query')>();
    return { ...actual, useQueryClient: () => ({ invalidateQueries: vi.fn() }) };
});

// Create mock functions
const mockSetLanguage = vi.fn();

// Mock the dependencies
vi.mock('@/i18n/hooks', () => ({
    useLanguage: () => ({
        language: 'en',
        setLanguage: mockSetLanguage,
        dateLocale: {},
        intlLocale: 'en-US',
    }),
}));

vi.mock('@/lib/store', () => ({
    useAuthStore: () => ({
        isAuthenticated: true,
    }),
    useUIStore: Object.assign(
        (selector: (s: Record<string, unknown>) => unknown) => selector({ theme: 'system', language: 'en', setTheme: vi.fn(), setLanguage: vi.fn(), _hasHydrated: true }),
        { getState: () => ({ theme: 'system', language: 'en', setTheme: vi.fn(), setLanguage: vi.fn(), _hasHydrated: true }) }
    ),
}));

// Mock @/lib/api to use axios mock adapter
vi.mock('@/lib/api', () => ({
    settingsApi: {
        get: vi.fn(),
        update: vi.fn(),
    },
    pagesApi: {
        // ReplyStyleCard fetches the first connected page on mount to display
        // "Testing on: <name>" — return an empty list so this test stays focused
        // on the infinite-loop / fetch-once contract for settingsApi.
        getAll: vi.fn().mockResolvedValue({ data: [] }),
    },
    api: {
        delete: vi.fn(),
    },
}));

vi.mock('@/components/layout/DashboardLayout', () => ({
    DashboardLayout: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock('@/components/ui', async () => ({
    ...(await import('../testUtils/uiMocks')),
    // Page-level components the shared card mocks don't cover.
    Button: ({ children, onClick }: { children: React.ReactNode; onClick?: () => void }) => (
        <button onClick={onClick}>{children}</button>
    ),
    PageHeader: ({ title }: { title: string }) => <h1>{title}</h1>,
    PageSkeleton: () => <div data-testid="page-skeleton">Loading...</div>,
    Modal: ({ children, isOpen }: { children: React.ReactNode; isOpen: boolean }) => (
        isOpen ? <div data-testid="modal">{children}</div> : null
    ),
}));

const mockedSettingsApi = vi.mocked(settingsApi);

describe('SettingsPage - Infinite Loop Prevention', () => {
    let fetchCallCount = 0;

    beforeEach(() => {
        fetchCallCount = 0;
        mockSetLanguage.mockClear();

        // Track fetch calls with mocked settingsApi
        mockedSettingsApi.get.mockImplementation(async () => {
            fetchCallCount++;
            return {
                data: {
                    dashboardLanguage: 'en',
                    defaultReplyLanguage: 'ar',
                    autoDetectLanguage: true,
                    aiEnabled: true,
                    commentsAutoReply: true,
                    messagesAutoReply: true,
                },
            } as unknown as Awaited<ReturnType<typeof mockedSettingsApi.get>>;
        });
    });

    afterEach(() => {
        vi.clearAllMocks();
    });

    it('should fetch settings only once on mount', async () => {
        render(<SettingsPage />);

        await waitFor(() => {
            expect(screen.queryByText('Loading...')).not.toBeInTheDocument();
        });

        // Should only fetch once on mount
        expect(fetchCallCount).toBe(1);
    });

    it('should NOT refetch when component rerenders', async () => {
        const { rerender } = render(<SettingsPage />);

        await waitFor(() => {
            expect(screen.queryByText('Loading...')).not.toBeInTheDocument();
        });

        const initialFetchCount = fetchCallCount;

        // Rerender multiple times
        rerender(<SettingsPage />);
        rerender(<SettingsPage />);
        rerender(<SettingsPage />);

        // Wait a bit to ensure no additional fetches
        await act(async () => {
            await new Promise((resolve) => setTimeout(resolve, 100));
        });

        // Should NOT fetch again
        expect(fetchCallCount).toBe(initialFetchCount);
    });

    it('should sync language only when settings.dashboardLanguage changes', async () => {
        render(<SettingsPage />);

        await waitFor(() => {
            expect(screen.queryByText('Loading...')).not.toBeInTheDocument();
        });

        // Should NOT call setLanguage if dashboardLanguage matches current language
        expect(mockSetLanguage).not.toHaveBeenCalled();
    });

    it('should NOT call setLanguage on fetch even when dashboardLanguage differs from current language', async () => {
        // The stored dashboardLanguage populates the dropdown but does not auto-redirect.
        // setLanguage is only called when the user explicitly saves.
        mockedSettingsApi.get.mockImplementationOnce(async () => ({
            data: {
                dashboardLanguage: 'ar', // Different from current 'en'
                defaultReplyLanguage: 'ar',
                autoDetectLanguage: true,
                aiEnabled: true,
                commentsAutoReply: true,
                messagesAutoReply: true,
            },
        } as unknown as Awaited<ReturnType<typeof mockedSettingsApi.get>>));

        render(<SettingsPage />);

        await waitFor(() => {
            expect(screen.queryByText('Loading...')).not.toBeInTheDocument();
        });

        // Should NOT call setLanguage on load — only on explicit save
        expect(mockSetLanguage).not.toHaveBeenCalled();
    });

    it('should NOT cause infinite loop when settings change', async () => {
        render(<SettingsPage />);

        await waitFor(() => {
            expect(screen.queryByText('Loading...')).not.toBeInTheDocument();
        });

        const initialFetchCount = fetchCallCount;
        const initialSetLanguageCount = mockSetLanguage.mock.calls.length;

        // Wait to ensure no additional calls
        await act(async () => {
            await new Promise((resolve) => setTimeout(resolve, 200));
        });

        // Verify no infinite loop occurred
        expect(fetchCallCount).toBe(initialFetchCount);
        expect(mockSetLanguage.mock.calls.length).toBe(initialSetLanguageCount);
    });

    it('should handle multiple rerenders without multiple fetches', async () => {
        const { rerender } = render(<SettingsPage />);

        await waitFor(() => {
            expect(screen.queryByText('Loading...')).not.toBeInTheDocument();
        });

        const initialFetchCount = fetchCallCount;

        // Simulate multiple rerenders
        for (let i = 0; i < 5; i++) {
            rerender(<SettingsPage />);
        }

        await act(async () => {
            await new Promise((resolve) => setTimeout(resolve, 100));
        });

        // Should still only have the initial fetch
        expect(fetchCallCount).toBe(initialFetchCount);
    });

    it('should not refetch after 500ms (stability test)', async () => {
        render(<SettingsPage />);

        await waitFor(() => {
            expect(screen.queryByText('Loading...')).not.toBeInTheDocument();
        });

        const initialFetchCount = fetchCallCount;

        // Wait 500ms to ensure stability
        await act(async () => {
            await new Promise((resolve) => setTimeout(resolve, 500));
        });

        // Should still only have the initial fetch
        expect(fetchCallCount).toBe(initialFetchCount);
    });
});

/**
 * Regression suite for: "saved settings overwritten by INITIAL_SETTINGS defaults
 * after an offline reload."
 *
 * Root cause: when the initial GET /settings call failed (offline, 5xx), the
 * page silently rendered INITIAL_SETTINGS defaults as if they were the user's
 * saved values. A subsequent save sent those defaults to the backend,
 * overwriting real DB data (e.g. flipping commentReplyMode from 'dual' back
 * to 'public').
 *
 * Fix: track `loadError`, render a dedicated error screen (with no Save button,
 * no editable form), and hard-guard handleSave with the same flag.
 *
 * These tests guard the contract: a failed fetch MUST NOT expose any editable
 * settings UI to the user.
 */
describe('SettingsPage - Fetch failure guards (overwrite prevention)', () => {
    beforeEach(() => {
        mockSetLanguage.mockClear();
    });

    afterEach(() => {
        vi.clearAllMocks();
    });

    it('renders the error screen (not the settings form) when the initial fetch fails', async () => {
        // Simulate offline / 5xx on the initial settings fetch.
        mockedSettingsApi.get.mockRejectedValue(new Error('Network Error'));

        render(<SettingsPage />);

        // Skeleton clears once the catch block runs.
        await waitFor(() => {
            expect(screen.queryByText('Loading...')).not.toBeInTheDocument();
        });

        // Error screen visible.
        expect(screen.getByText("Couldn't load your settings")).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();

        // Critical: none of the editable settings sections are mounted. If any of
        // these appeared, the user could change them and trigger a save that
        // would overwrite real DB values with INITIAL_SETTINGS defaults.
        expect(screen.queryByText('Save')).not.toBeInTheDocument();
        expect(screen.queryByText(/Auto-Reply/i)).not.toBeInTheDocument();
    });

    it('never calls settingsApi.update when the initial fetch fails', async () => {
        mockedSettingsApi.get.mockRejectedValue(new Error('Network Error'));

        render(<SettingsPage />);

        await waitFor(() => {
            expect(screen.queryByText('Loading...')).not.toBeInTheDocument();
        });

        // Wait for any stray async state updates to settle.
        await act(async () => {
            await new Promise((resolve) => setTimeout(resolve, 100));
        });

        // The error screen has no Save button, so update must never run.
        // This is the contract that prevents the overwrite-with-defaults bug.
        expect(mockedSettingsApi.update).not.toHaveBeenCalled();
    });

    it('save sends only changed fields — untouched loaded values are never overwritten', async () => {
        // The overwrite-with-defaults bug (loaded values flipping back to
        // INITIAL_SETTINGS in the save payload) is now structurally impossible:
        // Save sends ONLY the fields the user changed (a partial PUT). The user
        // edits one unrelated field (brand voice notes); the payload must carry
        // that edit and must NOT carry untouched fields like commentReplyMode —
        // an omitted field can't be clobbered by the backend's partial update.
        mockedSettingsApi.get.mockResolvedValue({
            data: {
                dashboardLanguage: 'en',
                defaultReplyLanguage: 'ar',
                autoDetectLanguage: true,
                aiEnabled: true,
                aiModel: 'gpt-4o-mini',
                commentReplyMode: 'dual',
                commentsAutoReply: true,
                messagesAutoReply: true,
                businessHoursOnly: false,
                businessHoursStart: '09:00',
                businessHoursEnd: '18:00',
                timezone: 'Asia/Damascus',
                replyStyle: 'casual',
                holdLowConfidence: true,
                replyDelay: 0,
                commentEscalationMinutes: 60,
                messageEscalationMinutes: 30,
                handoffPauseDurationMinutes: 60,
                notificationsEnabled: true,
                brandVoiceNotesMulti: { en: 'Existing voice' },
                awayMessageMulti: {},
                greetingMessageMulti: {},
                dualReplyNudgeMulti: {},
                limitFallbackEnabled: false,
                limitFallbackMessageMulti: {},
            },
        } as unknown as Awaited<ReturnType<typeof mockedSettingsApi.get>>);
        mockedSettingsApi.update.mockResolvedValue({ data: {} } as unknown as Awaited<ReturnType<typeof mockedSettingsApi.update>>);

        render(<SettingsPage />);

        await waitFor(() => {
            expect(screen.queryByText('Loading...')).not.toBeInTheDocument();
        });

        // Edit the brand voice textarea — a field unrelated to commentReplyMode.
        // This flips hasChanges=true so the Save button becomes clickable.
        const brandVoiceTextarea = screen.getByLabelText(enSettings.replyStyle.brandVoice);
        await act(async () => {
            fireEvent.change(brandVoiceTextarea, { target: { value: 'New voice text' } });
        });

        // Click Save.
        const saveButton = screen.getByRole('button', { name: 'Save' });
        await act(async () => {
            fireEvent.click(saveButton);
        });

        await waitFor(() => {
            expect(mockedSettingsApi.update).toHaveBeenCalledTimes(1);
        });

        const payload = mockedSettingsApi.update.mock.calls[0][0] as Record<string, unknown>;

        // The edited field is sent...
        expect(payload.brandVoiceNotesMulti).toMatchObject({ en: 'New voice text' });
        // ...and untouched fields are NOT — so they can't be overwritten with
        // INITIAL_SETTINGS defaults (the overwrite-with-defaults bug can't recur
        // when omitted fields are left to the backend's partial update).
        expect(payload).not.toHaveProperty('commentReplyMode');
        expect(payload).not.toHaveProperty('replyStyle');
        expect(payload).not.toHaveProperty('holdLowConfidence');
        expect(payload).not.toHaveProperty('timezone');
    });

    it('keeps user edits intact after a failed save (no state corruption)', async () => {
        // Scenario: user is mid-edit, presses Save, network drops, save fails.
        // The UI must keep the user's in-progress edits — nothing reverts to
        // defaults, nothing is silently lost. A retry sends the same diff (the
        // edited field), and never the untouched loaded fields.
        mockedSettingsApi.get.mockResolvedValue({
            data: {
                dashboardLanguage: 'en',
                defaultReplyLanguage: 'ar',
                autoDetectLanguage: true,
                aiEnabled: true,
                aiModel: 'gpt-4o-mini',
                commentReplyMode: 'dual',
                commentsAutoReply: true,
                messagesAutoReply: true,
                businessHoursOnly: false,
                businessHoursStart: '09:00',
                businessHoursEnd: '18:00',
                timezone: 'Asia/Damascus',
                replyStyle: 'casual',
                holdLowConfidence: true,
                replyDelay: 0,
                commentEscalationMinutes: 60,
                messageEscalationMinutes: 30,
                handoffPauseDurationMinutes: 60,
                notificationsEnabled: true,
                brandVoiceNotesMulti: { en: 'Original voice' },
                awayMessageMulti: {},
                greetingMessageMulti: {},
                dualReplyNudgeMulti: {},
                limitFallbackEnabled: false,
                limitFallbackMessageMulti: {},
            },
        } as unknown as Awaited<ReturnType<typeof mockedSettingsApi.get>>);

        // First save fails (offline), second save succeeds (network back).
        mockedSettingsApi.update
            .mockRejectedValueOnce(new Error('Network Error'))
            .mockResolvedValueOnce({ data: {} } as unknown as Awaited<ReturnType<typeof mockedSettingsApi.update>>);

        render(<SettingsPage />);

        await waitFor(() => {
            expect(screen.queryByText('Loading...')).not.toBeInTheDocument();
        });

        // User edits brand voice.
        const brandVoiceTextarea = screen.getByLabelText(enSettings.replyStyle.brandVoice) as HTMLTextAreaElement;
        await act(async () => {
            fireEvent.change(brandVoiceTextarea, { target: { value: 'Edited voice' } });
        });

        // First save attempt — fails.
        const saveButton = screen.getByRole('button', { name: 'Save' });
        await act(async () => {
            fireEvent.click(saveButton);
        });
        await waitFor(() => {
            expect(mockedSettingsApi.update).toHaveBeenCalledTimes(1);
        });

        // After the failure, the edit must still be in the textarea AND the
        // Save button must still be present (hasChanges remains true so the
        // user can retry without losing work).
        expect(brandVoiceTextarea.value).toBe('Edited voice');
        expect(screen.getByRole('button', { name: 'Save' })).toBeInTheDocument();

        // Retry — second save call.
        await act(async () => {
            fireEvent.click(screen.getByRole('button', { name: 'Save' }));
        });
        await waitFor(() => {
            expect(mockedSettingsApi.update).toHaveBeenCalledTimes(2);
        });

        // The retry payload carries the user's edit, and only that — untouched
        // loaded fields are omitted (partial PUT), so the failure + retry can't
        // leak defaults over real data.
        const retryPayload = mockedSettingsApi.update.mock.calls[1][0] as Record<string, unknown>;
        expect(retryPayload.brandVoiceNotesMulti).toMatchObject({ en: 'Edited voice' });
        expect(retryPayload).not.toHaveProperty('commentReplyMode');
        expect(retryPayload).not.toHaveProperty('replyStyle');
        expect(retryPayload).not.toHaveProperty('holdLowConfidence');
        expect(retryPayload).not.toHaveProperty('timezone');
    });

    it('recovers and renders the settings form when Try again succeeds', async () => {
        // First fetch fails, second succeeds — simulates the user clicking Try
        // again after their connection comes back.
        mockedSettingsApi.get
            .mockRejectedValueOnce(new Error('Network Error'))
            .mockResolvedValueOnce({
                data: {
                    dashboardLanguage: 'en',
                    defaultReplyLanguage: 'ar',
                    autoDetectLanguage: true,
                    aiEnabled: true,
                    commentReplyMode: 'dual',
                    commentsAutoReply: true,
                    messagesAutoReply: true,
                },
            } as unknown as Awaited<ReturnType<typeof mockedSettingsApi.get>>);

        render(<SettingsPage />);

        // Error screen first.
        const retryButton = await screen.findByRole('button', { name: 'Try again' });
        expect(screen.getByText("Couldn't load your settings")).toBeInTheDocument();

        // Click Try again.
        await act(async () => {
            fireEvent.click(retryButton);
        });

        // Error screen replaced with the real settings form.
        await waitFor(() => {
            expect(screen.queryByText("Couldn't load your settings")).not.toBeInTheDocument();
        });

        // Two fetches: the failed initial one + the successful retry.
        expect(mockedSettingsApi.get).toHaveBeenCalledTimes(2);
    });
});

// The dashboard AI-limit banner links to `/settings#limit-fallback-message`.
// That anchor lives inside the Advanced section, which is collapsed by default,
// so without special handling the hash jump finds nothing and the user lands at
// the top with the fallback option hidden. These tests lock in the deep-link
// behavior: expand Advanced + scroll the card into view, but only when the hash
// is actually present.
describe('SettingsPage - deep link to limit-fallback card', () => {
    beforeEach(() => {
        mockedSettingsApi.get.mockResolvedValue({
            data: {
                dashboardLanguage: 'en',
                defaultReplyLanguage: 'ar',
                aiEnabled: true,
                commentsAutoReply: true,
                messagesAutoReply: true,
            },
        } as unknown as Awaited<ReturnType<typeof mockedSettingsApi.get>>);
        // jsdom doesn't implement scrollIntoView — stub it so the effect can run.
        Element.prototype.scrollIntoView = vi.fn();
        window.localStorage.clear();
        window.location.hash = '';
    });

    afterEach(() => {
        window.location.hash = '';
        vi.clearAllMocks();
    });

    it('expands Advanced and scrolls to the fallback card when arriving with the hash', async () => {
        window.location.hash = '#limit-fallback-message';
        const { container } = render(<SettingsPage />);

        await waitFor(() => {
            expect(screen.queryByText('Loading...')).not.toBeInTheDocument();
        });

        // The anchor only exists in the DOM once Advanced is expanded.
        await waitFor(() => {
            expect(container.querySelector('#limit-fallback-message')).toBeInTheDocument();
        });
        await waitFor(() => {
            expect(Element.prototype.scrollIntoView).toHaveBeenCalled();
        });
    });

    it('leaves Advanced collapsed (no scroll) without the hash', async () => {
        const { container } = render(<SettingsPage />);

        await waitFor(() => {
            expect(screen.queryByText('Loading...')).not.toBeInTheDocument();
        });

        expect(container.querySelector('#limit-fallback-message')).not.toBeInTheDocument();
        expect(Element.prototype.scrollIntoView).not.toHaveBeenCalled();
    });
});
