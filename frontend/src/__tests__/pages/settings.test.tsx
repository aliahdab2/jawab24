import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, act, fireEvent } from '@testing-library/react';
import SettingsPage from '@/pages/settings';
import { settingsApi } from '@/lib/api';

// Settings page shows toast.error when a save is attempted in a degraded state
// (e.g. after a failed initial fetch). Mock sonner so those calls don't blow up
// the JSDOM environment.
vi.mock('sonner', () => ({
    toast: { success: vi.fn(), error: vi.fn() },
}));

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

vi.mock('@/components/ui', () => ({
    Card: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
    Button: ({ children, onClick }: { children: React.ReactNode; onClick?: () => void }) => (
        <button onClick={onClick}>{children}</button>
    ),
    Input: (props: React.InputHTMLAttributes<HTMLInputElement>) => <input {...props} />,
    Toggle: ({ enabled, onChange }: { enabled: boolean; onChange: (val: boolean) => void }) => (
        <button onClick={() => onChange(!enabled)}>{enabled ? 'ON' : 'OFF'}</button>
    ),
    PageHeader: ({ title }: { title: string }) => <h1>{title}</h1>,
    PageSkeleton: () => <div data-testid="page-skeleton">Loading...</div>,
    Modal: ({ children, isOpen }: { children: React.ReactNode; isOpen: boolean }) => (
        isOpen ? <div data-testid="modal">{children}</div> : null
    ),
    Select: ({ value, onChange, options }: { value: string; onChange: (val: string) => void; options: { value: string; label: string }[] }) => (
        <select value={value} onChange={(e) => onChange(e.target.value)}>
            {options.map((o: { value: string; label: string }) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
    ),
    InputFieldWrapper: ({ children, trailing }: { children: React.ReactNode; trailing?: React.ReactNode }) => (
        <div>{children}{trailing}</div>
    ),
    CharCounter: ({ value, max }: { value: string | number; max: number }) => {
        const len = typeof value === 'string' ? value.length : value;
        return <span>{len}/{max}</span>;
    },
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

    it('save preserves field values loaded from fetch — never sends INITIAL_SETTINGS defaults', async () => {
        // The exact regression: a successful fetch returns commentReplyMode='dual'.
        // The user then edits an unrelated field (brand voice notes) and saves.
        // The save payload MUST include commentReplyMode='dual' from the loaded
        // settings, not 'public' from INITIAL_SETTINGS. If this assertion fires,
        // it means the loaded settings are not being persisted into the save
        // payload — which is exactly what happened during the offline-reload
        // incident that motivated the loadError guard.
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
        const brandVoiceTextarea = screen.getByLabelText('Brand Voice Notes');
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

        // Critical assertions: unchanged fields from the fetched settings must
        // round-trip through the save payload unchanged. If any of these flip
        // to INITIAL_SETTINGS defaults, the overwrite-with-defaults bug is back.
        expect(payload.commentReplyMode).toBe('dual');
        expect(payload.replyStyle).toBe('casual');
        expect(payload.holdLowConfidence).toBe(true);
        expect(payload.timezone).toBe('Asia/Damascus');

        // The edited field is also in the payload (sanity check).
        expect(payload.brandVoiceNotesMulti).toMatchObject({ en: 'New voice text' });
    });

    it('keeps user edits and loaded values intact after a failed save (no state corruption)', async () => {
        // Scenario: user is mid-edit, presses Save, network drops, save fails.
        // The UI must keep the user's in-progress edits AND the originally
        // loaded settings exactly as they were — nothing reverts to defaults,
        // nothing is silently lost. A retry must therefore send the same full
        // payload, including unchanged fields from the original fetch.
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
        const brandVoiceTextarea = screen.getByLabelText('Brand Voice Notes') as HTMLTextAreaElement;
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

        // The retry payload must carry BOTH the user's edit AND every
        // originally-loaded field — no defaults leaked in after the failure.
        const retryPayload = mockedSettingsApi.update.mock.calls[1][0] as Record<string, unknown>;
        expect(retryPayload.brandVoiceNotesMulti).toMatchObject({ en: 'Edited voice' });
        expect(retryPayload.commentReplyMode).toBe('dual');
        expect(retryPayload.replyStyle).toBe('casual');
        expect(retryPayload.holdLowConfidence).toBe(true);
        expect(retryPayload.timezone).toBe('Asia/Damascus');
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
