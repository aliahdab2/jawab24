import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { FeedSnippet } from './FeedSnippet';

const NO_PREVIEW = 'لا توجد معاينة';

describe('FeedSnippet', () => {
  it('shows a real comment as-is', () => {
    render(<FeedSnippet text="ما هو السعر؟" noPreviewLabel={NO_PREVIEW} />);
    expect(screen.getByText('ما هو السعر؟')).toBeInTheDocument();
    expect(screen.queryByText(NO_PREVIEW)).toBeNull();
  });

  // The bug this fixes: "علّق بنقطة" posts get lots of "." / emoji comments, which
  // must show the real comment — never a "no preview" placeholder.
  it('shows a dot-only comment instead of the no-preview placeholder', () => {
    render(<FeedSnippet text="." noPreviewLabel={NO_PREVIEW} />);
    expect(screen.getByText('.')).toBeInTheDocument();
    expect(screen.queryByText(NO_PREVIEW)).toBeNull();
  });

  it('shows an emoji-only comment', () => {
    render(<FeedSnippet text="❤️🔥" noPreviewLabel={NO_PREVIEW} />);
    expect(screen.getByText('❤️🔥')).toBeInTheDocument();
    expect(screen.queryByText(NO_PREVIEW)).toBeNull();
  });

  it('falls back to the AI-intent label only when the text is genuinely empty', () => {
    render(<FeedSnippet text="   " intentLabel="سؤال" noPreviewLabel={NO_PREVIEW} />);
    expect(screen.getByText('سؤال')).toBeInTheDocument();
    expect(screen.queryByText(NO_PREVIEW)).toBeNull();
  });

  it('falls back to the no-preview label when there is nothing at all', () => {
    render(<FeedSnippet text={null} noPreviewLabel={NO_PREVIEW} />);
    expect(screen.getByText(NO_PREVIEW)).toBeInTheDocument();
  });

  // The bug this fixes: the dashboard feed rendered message text bare, so in the
  // RTL page the bidi algorithm reordered a phone number's digit GROUPS
  // right-to-left and merchants saw the number backwards. Every other preview
  // surface already routed through renderMessageText; this one did not.
  describe('phone numbers (bidi)', () => {
    it('wraps a phone number in an LTR span so RTL cannot reorder its groups', () => {
      const { container } = render(
        <FeedSnippet text="رقمي +963 472 924 935 تواصل معي" noPreviewLabel={NO_PREVIEW} />
      );
      const ltr = container.querySelector('span[dir="ltr"]');
      expect(ltr).not.toBeNull();
      expect(ltr!.textContent).toBe('+963 472 924 935');
    });

    it('sets dir="auto" so the snippet direction follows the message, not the page', () => {
      const { container } = render(<FeedSnippet text="ما هو السعر؟" noPreviewLabel={NO_PREVIEW} />);
      expect(container.querySelector('p[dir="auto"]')).not.toBeNull();
    });
  });

  // The same omission leaked the internal image-message marker into the feed.
  describe('image messages', () => {
    it('strips the "[صورة: …]" marker and shows an icon in its place', () => {
      const { container } = render(
        <FeedSnippet text="[صورة: صورة شاشة دردشة واتساب]" noPreviewLabel={NO_PREVIEW} />
      );
      expect(screen.getByText('صورة شاشة دردشة واتساب')).toBeInTheDocument();
      expect(container.textContent).not.toContain('[صورة:');
      expect(container.querySelector('svg')).not.toBeNull();
    });

    it('strips the marker on the English "[Image: …]" form too', () => {
      const { container } = render(
        <FeedSnippet text="[Image: a WhatsApp chat screenshot]" noPreviewLabel={NO_PREVIEW} />
      );
      expect(screen.getByText('a WhatsApp chat screenshot')).toBeInTheDocument();
      expect(container.textContent).not.toContain('[Image:');
    });

    it('keeps the LTR wrap for a phone number inside an image description', () => {
      const { container } = render(
        <FeedSnippet text="[صورة: محادثة بين رقم +963 472 924 935 والعميل]" noPreviewLabel={NO_PREVIEW} />
      );
      expect(container.querySelector('span[dir="ltr"]')!.textContent).toBe('+963 472 924 935');
      expect(container.textContent).not.toContain('[صورة:');
    });

    it('shows the icon plus the neutral label for the bare "[صورة]" placeholder', () => {
      const { container } = render(<FeedSnippet text="[صورة]" noPreviewLabel={NO_PREVIEW} />);
      expect(screen.getByText(NO_PREVIEW)).toBeInTheDocument();
      expect(container.textContent).not.toContain('[صورة]');
      expect(container.querySelector('svg')).not.toBeNull();
    });
  });
});
