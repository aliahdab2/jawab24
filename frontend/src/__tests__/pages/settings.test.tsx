import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import SettingsPage from '@/pages/settings';
import type { Language } from '@/i18n';
import { settingsApi } from '@/lib/api';

// Create mock functions
const mockT = vi.fn((key: string) => key);
const mockSetLanguage = vi.fn();

// Mock the dependencies
vi.mock('@/i18n', () => ({
    useTranslation: () => ({
        t: mockT,
        language: 'en' as Language,
    }),
    useLanguage: () => ({
        setLanguage: mockSetLanguage,
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
    Input: (props: any) => <input {...props} />,
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
}));

const mockedSettingsApi = vi.mocked(settingsApi);

describe('SettingsPage - Infinite Loop Prevention', () => {
    let fetchCallCount = 0;

    beforeEach(() => {
        fetchCallCount = 0;
        mockSetLanguage.mockClear();
        mockT.mockClear();

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
            } as any;
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

    it('should call setLanguage when dashboardLanguage differs from current language', async () => {
        // Mock server returning different language
        mockedSettingsApi.get.mockImplementationOnce(async () => ({
            data: {
                dashboardLanguage: 'ar', // Different from current 'en'
                defaultReplyLanguage: 'ar',
                autoDetectLanguage: true,
                aiEnabled: true,
                commentsAutoReply: true,
                messagesAutoReply: true,
            },
        } as any));

        render(<SettingsPage />);

        await waitFor(() => {
            expect(screen.queryByText('Loading...')).not.toBeInTheDocument();
        });

        // Should call setLanguage once to sync
        await waitFor(() => {
            expect(mockSetLanguage).toHaveBeenCalledWith('ar');
            expect(mockSetLanguage).toHaveBeenCalledTimes(1);
        });
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

