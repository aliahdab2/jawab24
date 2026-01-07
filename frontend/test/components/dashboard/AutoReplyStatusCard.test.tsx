import { render, screen } from '@testing-library/react';
import { AutoReplyStatusCard } from '@/components/dashboard/AutoReplyStatusCard';
import { vi } from 'vitest';

// Mock translation hook
vi.mock('@/i18n', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

// Mock Link component since it's used in the component
vi.mock('next/link', () => ({
  default: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

describe('AutoReplyStatusCard', () => {
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

  it('should render GREEN active card when comments auto-reply is ON', () => {
    render(
      <AutoReplyStatusCard
        activePages={3}
        commentsAutoReply={true}
        messagesAutoReply={false}
      />
    );

    // Should show active replies text
    expect(screen.getByText('dashboard.activeRepliesOn')).toBeInTheDocument();
    // Should show general note
    expect(screen.getByText('dashboard.autoReplyNote')).toBeInTheDocument();
    // Should NOT show warning text
    expect(screen.queryByText('dashboard.autoReplyConfiguredButDisabled')).not.toBeInTheDocument();
  });

  it('should render GREEN active card when messages auto-reply is ON', () => {
    render(
      <AutoReplyStatusCard
        activePages={3}
        commentsAutoReply={false}
        messagesAutoReply={true}
      />
    );

    expect(screen.getByText('dashboard.activeRepliesOn')).toBeInTheDocument();
  });

  it('should render AMBER warning card when both comments and messages are OFF', () => {
    render(
      <AutoReplyStatusCard
        activePages={5}
        commentsAutoReply={false}
        messagesAutoReply={false}
      />
    );

    // Should show configured but disabled text
    expect(screen.getByText('dashboard.autoReplyConfiguredButDisabled')).toBeInTheDocument();
    // Should show explanation note
    expect(screen.getByText('dashboard.autoReplyConfiguredNote')).toBeInTheDocument();
    // Should show settings button text
    expect(screen.getByText('dashboard.goToSettings')).toBeInTheDocument();
    // Should NOT show active text
    expect(screen.queryByText('dashboard.activeRepliesOn')).not.toBeInTheDocument();
  });
});
