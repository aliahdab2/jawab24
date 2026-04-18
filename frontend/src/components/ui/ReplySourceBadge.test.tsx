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

    it('renders manual badge with Manual label (regression: was showing "Preset Reply")', () => {
      render(<ReplySourceBadge method="manual" variant="compact" />);
      expect(screen.getByText('Manual')).toBeInTheDocument();
      expect(screen.queryByText('Preset Reply')).not.toBeInTheDocument();
    });

    it('renders template badge with Preset Reply label for historical data', () => {
      render(<ReplySourceBadge method="template" variant="compact" />);
      expect(screen.getByText('Preset Reply')).toBeInTheDocument();
    });

    it('applies the matching color class per method', () => {
      const { container: aiC } = render(<ReplySourceBadge method="ai" variant="compact" />);
      const { container: manualC } = render(<ReplySourceBadge method="manual" variant="compact" />);
      const { container: templateC } = render(<ReplySourceBadge method="template" variant="compact" />);
      expect(aiC.firstChild).toHaveClass('reply-source-ai');
      expect(manualC.firstChild).toHaveClass('reply-source-manual');
      expect(templateC.firstChild).toHaveClass('reply-source-template');
    });
  });

  describe('variant="detail"', () => {
    it('renders AI badge with Smart Reply label', () => {
      render(<ReplySourceBadge method="ai" variant="detail" />);
      expect(screen.getByText('Smart Reply')).toBeInTheDocument();
    });

    it('renders manual badge with Manual label (regression: was showing "Preset Reply")', () => {
      render(<ReplySourceBadge method="manual" variant="detail" />);
      expect(screen.getByText('Manual')).toBeInTheDocument();
      expect(screen.queryByText('Preset Reply')).not.toBeInTheDocument();
    });

    it('renders template badge with Preset Reply label for historical data', () => {
      render(<ReplySourceBadge method="template" variant="detail" />);
      expect(screen.getByText('Preset Reply')).toBeInTheDocument();
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
      expect(screen.queryByLabelText('Preset Reply')).not.toBeInTheDocument();
    });

    it('renders template avatar with accessible label for historical data', () => {
      render(<ReplySourceBadge method="template" variant="avatar" />);
      expect(screen.getByLabelText('Preset Reply')).toBeInTheDocument();
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
