import { render, screen } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { OfflineBanner } from './OfflineBanner';

// Mock capacitor
const mockIsNativePlatform = vi.fn(() => false);
vi.mock('@/lib/capacitor', () => ({
  isNativePlatform: () => mockIsNativePlatform(),
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

  it('keeps an empty live region mounted on native while online', () => {
    // Deliberately NOT null. Assistive tech announces changes to a region that
    // is already in the accessibility tree; a region that appears already
    // populated is routinely dropped by TalkBack and VoiceOver. The wrapper must
    // therefore outlive the message — while reserving no space.
    mockIsOffline.mockReturnValue(false);
    mockIsNativePlatform.mockReturnValue(true);
    render(<OfflineBanner />);
    const region = screen.getByRole('status');
    expect(region).toBeEmptyDOMElement();
    expect(screen.queryByText("You're offline")).not.toBeInTheDocument();
  });

  it('renders banner on native when offline', () => {
    mockIsOffline.mockReturnValue(true);
    mockIsNativePlatform.mockReturnValue(true);
    render(<OfflineBanner />);
    expect(screen.getByText("You're offline")).toBeInTheDocument();
  });

  it('announces through the same region it already had, not a new one', () => {
    // The regression to guard against is a refactor that moves role="status"
    // onto the message itself — which reads fine and silently stops announcing.
    mockIsNativePlatform.mockReturnValue(true);
    mockIsOffline.mockReturnValue(false);
    const { rerender } = render(<OfflineBanner />);
    const before = screen.getByRole('status');

    mockIsOffline.mockReturnValue(true);
    rerender(<OfflineBanner />);
    const after = screen.getByRole('status');

    expect(after).toBe(before);
    expect(after).toHaveTextContent("You're offline");
  });
});
