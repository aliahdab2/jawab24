import { render, screen, fireEvent } from '@testing-library/react';
import { AutoReplyStatusCard } from '@/components/dashboard/AutoReplyStatusCard';
import { vi, beforeEach } from 'vitest';

// next-intl is mocked globally in test/setup.ts — no local @/i18n mock needed

// Mock Link component
vi.mock('next/link', () => ({
  default: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

// Mock next/router (SystemStatusBanner uses useRouter for whole-card navigation)
const mockPush = vi.fn();
vi.mock('next/router', () => ({
  useRouter: () => ({ push: mockPush }),
}));

describe('AutoReplyStatusCard', () => {
  beforeEach(() => {
    sessionStorage.clear();
    vi.clearAllMocks();
  });

  it('should not render anything when totalPages is 0 (no connected pages)', () => {
    const { container } = render(
      <AutoReplyStatusCard
        activePages={0}
        totalPages={0}
        commentsAutoReply={true}
        messagesAutoReply={true}
      />
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('should render nothing when auto-replies are active (normal operating state)', () => {
    const { container } = render(
      <AutoReplyStatusCard
        activePages={3}
        totalPages={3}
        commentsAutoReply={true}
        messagesAutoReply={false}
      />
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('should render AMBER warning when pages exist but auto-reply toggles are off', () => {
    render(
      <AutoReplyStatusCard
        activePages={5}
        totalPages={5}
        commentsAutoReply={false}
        messagesAutoReply={false}
      />
    );

    expect(screen.getByText('Auto-replies disabled')).toBeInTheDocument();

    // Rule #5: Warning is NOT dismissible (No X)
    expect(screen.queryByLabelText('Dismiss')).not.toBeInTheDocument();

    // Clicking the card navigates to settings (whole-card click)
    fireEvent.click(screen.getByText('Auto-replies disabled'));
    expect(mockPush).toHaveBeenCalledWith('/settings');

    // CTAs should be present
    const ctas = screen.getAllByText('Go to Settings');
    expect(ctas.length).toBeGreaterThan(0);
  });

  it('should show warning when pages exist but none have autoReplyEnabled (activePages=0)', () => {
    render(
      <AutoReplyStatusCard
        activePages={0}
        totalPages={3}
        commentsAutoReply={false}
        messagesAutoReply={false}
      />
    );

    // Should show warning, not be empty
    expect(screen.getByText('Auto-replies disabled')).toBeInTheDocument();
  });

  it('should show warning when toggles are on but no pages have autoReplyEnabled', () => {
    render(
      <AutoReplyStatusCard
        activePages={0}
        totalPages={3}
        commentsAutoReply={true}
        messagesAutoReply={true}
      />
    );

    // activePages=0 means no page has autoReplyEnabled, so it's not truly active
    expect(screen.getByText('Auto-replies disabled')).toBeInTheDocument();
  });
});
