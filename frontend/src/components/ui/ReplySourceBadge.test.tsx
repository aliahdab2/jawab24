import '@testing-library/jest-dom';
import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { ReplySourceBadge } from './ReplySourceBadge';

describe('ReplySourceBadge', () => {
  describe('null/undefined method', () => {
    it('renders nothing when method is null', () => {
      const { container } = render(<ReplySourceBadge method={null} variant="compact" />);
      expect(container.firstChild).toBeNull();
    });

    it('renders nothing when method is undefined', () => {
      const { container } = render(<ReplySourceBadge method={undefined} variant="compact" />);
      expect(container.firstChild).toBeNull();
    });
  });

  describe('variant="compact"', () => {
    it('renders AI badge with Smart Reply label', () => {
      render(<ReplySourceBadge method="ai" variant="compact" />);
      expect(screen.getByText('Smart Reply')).toBeInTheDocument();
    });

    it('renders manual badge with Manual label (regression: was showing "Post Reply")', () => {
      render(<ReplySourceBadge method="manual" variant="compact" />);
      expect(screen.getByText('Manual')).toBeInTheDocument();
      expect(screen.queryByText('Post Reply')).not.toBeInTheDocument();
    });

    it('renders post_reply badge with Post Reply label', () => {
      render(<ReplySourceBadge method="post_reply" variant="compact" />);
      expect(screen.getByText('Post Reply')).toBeInTheDocument();
    });

    it('renders template badge with Auto reply label (canned/fallback, not Post Reply)', () => {
      render(<ReplySourceBadge method="template" variant="compact" />);
      expect(screen.getByText('Auto reply')).toBeInTheDocument();
      expect(screen.queryByText('Post Reply')).not.toBeInTheDocument();
    });

    // A WhatsApp Coexistence echo of the merchant's APP greeting/away message.
    // It must not read as "Manual" — the merchant did not type it, and it does
    // not pause Jawab24 (D-109).
    it('renders app_auto badge with the WhatsApp-app label, not Manual', () => {
      const { container } = render(<ReplySourceBadge method="app_auto" variant="compact" />);
      expect(screen.getByText('Your WhatsApp app')).toBeInTheDocument();
      expect(screen.queryByText('Manual')).not.toBeInTheDocument();
      expect(container.firstChild).toHaveClass('reply-source-app-auto');
    });

    it('applies the matching color class per method', () => {
      const { container: aiC } = render(<ReplySourceBadge method="ai" variant="compact" />);
      const { container: manualC } = render(<ReplySourceBadge method="manual" variant="compact" />);
      const { container: postReplyC } = render(<ReplySourceBadge method="post_reply" variant="compact" />);
      const { container: templateC } = render(<ReplySourceBadge method="template" variant="compact" />);
      expect(aiC.firstChild).toHaveClass('reply-source-ai');
      expect(manualC.firstChild).toHaveClass('reply-source-manual');
      // Post Reply has its own indigo identity, distinct from the fallback-template emerald.
      expect(postReplyC.firstChild).toHaveClass('reply-source-post-reply');
      expect(templateC.firstChild).toHaveClass('reply-source-template');
    });
  });

  describe('variant="detail"', () => {
    it('renders AI badge with Smart Reply label', () => {
      render(<ReplySourceBadge method="ai" variant="detail" />);
      expect(screen.getByText('Smart Reply')).toBeInTheDocument();
    });

    it('renders manual badge with Manual label (regression: was showing "Post Reply")', () => {
      render(<ReplySourceBadge method="manual" variant="detail" />);
      expect(screen.getByText('Manual')).toBeInTheDocument();
      expect(screen.queryByText('Post Reply')).not.toBeInTheDocument();
    });

    it('renders post_reply badge with Post Reply label', () => {
      render(<ReplySourceBadge method="post_reply" variant="detail" />);
      expect(screen.getByText('Post Reply')).toBeInTheDocument();
    });

    it('renders template badge with Auto reply label (canned/fallback)', () => {
      render(<ReplySourceBadge method="template" variant="detail" />);
      expect(screen.getByText('Auto reply')).toBeInTheDocument();
      expect(screen.queryByText('Post Reply')).not.toBeInTheDocument();
    });

    it('uses muted styling (not the colored reply-source-* classes)', () => {
      const { container } = render(<ReplySourceBadge method="manual" variant="detail" />);
      expect(container.firstChild).toHaveClass('bg-muted');
      expect(container.firstChild).not.toHaveClass('reply-source-manual');
    });
  });

  describe('variant="avatar"', () => {
    it('renders AI avatar with accessible label', () => {
      render(<ReplySourceBadge method="ai" variant="avatar" />);
      expect(screen.getByLabelText('Smart Reply')).toBeInTheDocument();
    });

    it('renders manual avatar with accessible label (regression: icon was indistinguishable from template)', () => {
      render(<ReplySourceBadge method="manual" variant="avatar" />);
      expect(screen.getByLabelText('Manual')).toBeInTheDocument();
      expect(screen.queryByLabelText('Post Reply')).not.toBeInTheDocument();
    });

    it('renders post_reply avatar with Post Reply accessible label', () => {
      render(<ReplySourceBadge method="post_reply" variant="avatar" />);
      expect(screen.getByLabelText('Post Reply')).toBeInTheDocument();
    });

    it('renders template avatar with Auto reply accessible label', () => {
      render(<ReplySourceBadge method="template" variant="avatar" />);
      expect(screen.getByLabelText('Auto reply')).toBeInTheDocument();
      expect(screen.queryByLabelText('Post Reply')).not.toBeInTheDocument();
    });

    it('renders app_auto avatar with the WhatsApp-app accessible label', () => {
      render(<ReplySourceBadge method="app_auto" variant="avatar" />);
      expect(screen.getByLabelText('Your WhatsApp app')).toBeInTheDocument();
      expect(screen.queryByLabelText('Manual')).not.toBeInTheDocument();
    });

    it('applies avatar layout classes and the matching color class', () => {
      const { container } = render(<ReplySourceBadge method="manual" variant="avatar" />);
      expect(container.firstChild).toHaveClass('rounded-full', 'reply-source-manual');
    });

    it('does not render any label text (icon-only)', () => {
      render(<ReplySourceBadge method="ai" variant="avatar" />);
      expect(screen.queryByText('Smart Reply')).not.toBeInTheDocument();
    });
  });

  describe('custom className', () => {
    it('merges caller-supplied className', () => {
      const { container } = render(
        <ReplySourceBadge method="ai" variant="compact" className="custom-x" />,
      );
      expect(container.firstChild).toHaveClass('custom-x');
    });
  });
});
