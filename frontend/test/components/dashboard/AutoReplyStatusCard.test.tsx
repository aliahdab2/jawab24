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

describe('AutoReplyStatusCard', () => {
  beforeEach(() => {
    sessionStorage.clear();
    vi.clearAllMocks();
  });

  it('should not render anything when activePages is 0', () => {
    const { container } = render(
      <AutoReplyStatusCard
        activePages={0}
        commentsAutoReply={true}
        messagesAutoReply={true}
      />
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('should render GREEN active card and handle expand/dismiss', () => {
    render(
      <AutoReplyStatusCard
        activePages={3}
        commentsAutoReply={true}
        messagesAutoReply={false}
      />
    );

    // Initial state (Title visible)
    expect(screen.getByText('dashboard.activeRepliesOn 3')).toBeInTheDocument();
    
    // Click to expand
    fireEvent.click(screen.getByText('dashboard.activeRepliesOn 3'));
    expect(screen.getByText('dashboard.autoReplyNote')).toBeInTheDocument();

    // Handle Dismiss
    const dismissBtn = screen.getByLabelText('Dismiss');
    fireEvent.click(dismissBtn);

    // Should disappear
    expect(screen.queryByText('dashboard.activeRepliesOn 3')).not.toBeInTheDocument();
    expect(sessionStorage.getItem('dashboard_success_banner_dismissed')).toBe('true');
  });

  it('should handle session persistence for dismissal', () => {
    sessionStorage.setItem('dashboard_success_banner_dismissed', 'true');
    const { container } = render(
      <AutoReplyStatusCard
        activePages={3}
        commentsAutoReply={true}
        messagesAutoReply={true}
      />
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('should render AMBER warning card and require expand for details', () => {
    render(
      <AutoReplyStatusCard
        activePages={5}
        commentsAutoReply={false}
        messagesAutoReply={false}
      />
    );

    expect(screen.getByText('dashboard.autoReplyConfiguredButDisabled 5')).toBeInTheDocument();
    
    // Expand to see note and CTA
    fireEvent.click(screen.getByText('dashboard.autoReplyConfiguredButDisabled 5'));
    expect(screen.getByText('dashboard.autoReplyConfiguredNote')).toBeInTheDocument();
    
    // Use getAllByText because we have mobile/desktop CTAs
    const ctas = screen.getAllByText('dashboard.goToSettings');
    expect(ctas.length).toBeGreaterThan(0);
  });
});
