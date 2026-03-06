import { render, screen } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { OfflineBanner } from './OfflineBanner';

// Mock capacitor
const mockIsNativePlatform = vi.fn(() => false);
vi.mock('@/lib/capacitor', () => ({
  isNativePlatform: () => mockIsNativePlatform(),
}));

// Mock translation
vi.mock('@/i18n', () => ({
  useTranslation: () => ({
    t: (key: string) => {
      const map: Record<string, string> = {
        'common.offline': "You're offline",
      };
      return map[key] || key;
    },
    language: 'en',
  }),
}));

// Mock store
const mockIsOffline = vi.fn(() => false);
vi.mock('@/lib/store', () => ({
  useUIStore: (selector: (s: { isOffline: boolean }) => boolean) =>
    selector({ isOffline: mockIsOffline() }),
}));

describe('OfflineBanner', () => {
  beforeEach(() => {
    mockIsNativePlatform.mockReturnValue(false);
    mockIsOffline.mockReturnValue(false);
  });

  it('renders nothing on web even when offline', () => {
    mockIsOffline.mockReturnValue(true);
    mockIsNativePlatform.mockReturnValue(false);
    const { container } = render(<OfflineBanner />);
    expect(container.firstChild).toBeNull();
  });

  it('renders nothing on native when online', () => {
    mockIsOffline.mockReturnValue(false);
    mockIsNativePlatform.mockReturnValue(true);
    const { container } = render(<OfflineBanner />);
    expect(container.firstChild).toBeNull();
  });

  it('renders banner on native when offline', () => {
    mockIsOffline.mockReturnValue(true);
    mockIsNativePlatform.mockReturnValue(true);
    render(<OfflineBanner />);
    expect(screen.getByText("You're offline")).toBeInTheDocument();
  });
});
