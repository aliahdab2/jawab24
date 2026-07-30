import '@testing-library/jest-dom';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { KnowledgeBaseRawEditor } from './KnowledgeBaseRawEditor';

// Regression (Port Said hospital, 2026-07-30): pasting a text longer than
// maxLength was silently cut by the textarea's native maxLength — the merchant
// lost the tail of their price list mid-sentence with no feedback. The native
// truncation happens BEFORE onChange fires, so the only detection point is the
// paste event itself; onPasteTruncated must report the cut.
describe('KnowledgeBaseRawEditor paste truncation warning', () => {
  const renderEditor = (value: string, onPasteTruncated: (info: { kept: number; total: number }) => void) => {
    render(
      <KnowledgeBaseRawEditor
        value={value}
        onChange={vi.fn()}
        maxLength={100}
        ariaLabel="kb"
        onPasteTruncated={onPasteTruncated}
      />
    );
    return screen.getByLabelText('kb');
  };

  const paste = (el: HTMLElement, text: string) =>
    fireEvent.paste(el, { clipboardData: { getData: () => text } });

  it('reports kept/total when the pasted text overflows the limit', () => {
    const onTruncated = vi.fn();
    const el = renderEditor('a'.repeat(40), onTruncated);
    paste(el, 'b'.repeat(80)); // 40 existing + 80 pasted = 120 > 100

    expect(onTruncated).toHaveBeenCalledWith({ kept: 100, total: 120 });
  });

  it('stays silent when the paste fits', () => {
    const onTruncated = vi.fn();
    const el = renderEditor('a'.repeat(40), onTruncated);
    paste(el, 'b'.repeat(60)); // exactly at the limit

    expect(onTruncated).not.toHaveBeenCalled();
  });

  it('accounts for replaced selection when computing the overflow', () => {
    const onTruncated = vi.fn();
    const el = renderEditor('a'.repeat(100), onTruncated) as HTMLTextAreaElement;
    el.setSelectionRange(0, 90); // pasting over 90 selected chars
    paste(el, 'b'.repeat(80)); // 100 - 90 + 80 = 90 <= 100

    expect(onTruncated).not.toHaveBeenCalled();
  });
});
