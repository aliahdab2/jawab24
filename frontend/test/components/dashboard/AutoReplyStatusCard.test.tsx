import { render, screen, fireEvent } from '@testing-library/react';
import { AutoReplyStatusCard } from '@/components/dashboard/AutoReplyStatusCard';
import { vi, beforeEach } from 'vitest';

// Mock translation hook
vi.mock('@/i18n', () => ({
  useTranslation: () => ({
    t: (key: string, data?: any) => {
      if (data?.count !== undefined) return `${key} ${data.count}`;
      return key;
    },
  }),
}));

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

  it('should render VIOLET active card: Dismissible ONLY', () => {
    render(
      <AutoReplyStatusCard
        activePages={3}
        totalPages={3}
        commentsAutoReply={true}
        messagesAutoReply={false}
      />
    );

    // Should show title (Modified: No count suffix)
    expect(screen.getByText('dashboard.activeRepliesOn')).toBeInTheDocument();
    
    // Rule #5: Success has X (Dismissible)
    const dismissBtn = screen.getByLabelText('Dismiss');
    expect(dismissBtn).toBeInTheDocument();

    // Rule #5: Success NOT expandable (clicking it shouldn't change height/visibility)
    // There are 2 descriptions (desktop static, mobile expandable). We want the mobile one.
    const notes = screen.getAllByText('dashboard.autoReplyNote');
    const mobileNote = notes.find(n => !n.className.includes('hidden sm:block'));
    
    // It's collapsed on mobile
    expect(mobileNote?.parentElement).toHaveClass('max-h-0');

    fireEvent.click(screen.getByText('dashboard.activeRepliesOn'));
    
    // Should still be collapsed (not expandable)
    expect(mobileNote?.parentElement).toHaveClass('max-h-0');

    // Handle Dismiss
    fireEvent.click(dismissBtn);
    expect(screen.queryByText('dashboard.activeRepliesOn')).not.toBeInTheDocument();
    expect(sessionStorage.getItem('dashboard_success_banner_dismissed')).toBe('true');
  });

  it('should use violet color scheme for the active banner', () => {
    const { container } = render(
      <AutoReplyStatusCard
        activePages={3}
        totalPages={3}
        commentsAutoReply={true}
        messagesAutoReply={false}
      />
    );

    // The banner should use alert-violet class (not alert-success)
    const banner = container.querySelector('.alert-violet');
    expect(banner).toBeInTheDocument();
    expect(container.querySelector('.alert-success')).not.toBeInTheDocument();
  });

  it('should handle session persistence for dismissal', () => {
    sessionStorage.setItem('dashboard_success_banner_dismissed', 'true');
    const { container } = render(
      <AutoReplyStatusCard
        activePages={3}
        totalPages={3}
        commentsAutoReply={true}
        messagesAutoReply={true}
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

    expect(screen.getByText('dashboard.autoReplyConfiguredButDisabled')).toBeInTheDocument();

    // Rule #5: Warning is NOT dismissible (No X)
    expect(screen.queryByLabelText('Dismiss')).not.toBeInTheDocument();

    // Clicking the card navigates to settings (whole-card click)
    fireEvent.click(screen.getByText('dashboard.autoReplyConfiguredButDisabled'));
    expect(mockPush).toHaveBeenCalledWith('/settings');

    // CTAs should be present
    const ctas = screen.getAllByText('dashboard.goToSettings');
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
    expect(screen.getByText('dashboard.autoReplyConfiguredButDisabled')).toBeInTheDocument();
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
    expect(screen.getByText('dashboard.autoReplyConfiguredButDisabled')).toBeInTheDocument();
  });
});
