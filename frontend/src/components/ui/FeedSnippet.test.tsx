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
});
