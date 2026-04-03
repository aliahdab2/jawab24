import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { KnowledgeBaseModal } from '@/components/knowledge-base/KnowledgeBaseModal';
import type { Page } from '@jawab24/shared';

// Mock non-essential dependencies
vi.mock('@/lib/api', () => ({
  pagesApi: { getKbGaps: vi.fn().mockResolvedValue({ data: { data: [] } }) },
}));

vi.mock('@/hooks/useEscapeKey', () => ({ useEscapeKey: vi.fn() }));
vi.mock('@/hooks/useBodyScrollLock', () => ({ useBodyScrollLock: vi.fn() }));

const makePage = (knowledgeBase: string): Page =>
  ({ id: 'p1', name: 'Test Page', knowledgeBase, suggestedKnowledgeBase: '' }) as unknown as Page;

describe('KnowledgeBaseModal — char limit enforcement', () => {
  const onClose = vi.fn();
  const onSave = vi.fn().mockResolvedValue(undefined);

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows counter in default color when well under limit', () => {
    const page = makePage('Short content');
    render(<KnowledgeBaseModal page={page} onClose={onClose} onSave={onSave} saving={false} saved={false} />);

    // Counter should be visible
    const counter = screen.getByText(/\/16,000/);
    expect(counter).toBeInTheDocument();
    // Should NOT have red or amber styling
    expect(counter.className).not.toContain('text-red-500');
    expect(counter.className).not.toContain('text-amber-500');
  });

  it('shows amber counter when near limit (>90%)', () => {
    // 14,500 chars = ~90.6% of 16,000
    const content = 'x'.repeat(14_500);
    const page = makePage(`Products & Services:\n${content}`);
    render(<KnowledgeBaseModal page={page} onClose={onClose} onSave={onSave} saving={false} saved={false} />);

    const counter = screen.getByText(/\/16,000/);
    expect(counter.className).toContain('text-amber-500');
  });

  it('shows red counter and disables save when over limit', () => {
    // Build content that exceeds 16,000 chars
    const content = 'x'.repeat(17_000);
    const page = makePage(`Products & Services:\n${content}`);
    render(<KnowledgeBaseModal page={page} onClose={onClose} onSave={onSave} saving={false} saved={false} />);

    // Counter should be red
    const counter = screen.getByText(/\/16,000/);
    expect(counter.className).toContain('text-red-500');

    // Save button should be disabled
    const saveButton = screen.getByRole('button', { name: /save/i });
    expect(saveButton).toBeDisabled();
  });

  it('shows "remove X characters" message when over limit', () => {
    const content = 'x'.repeat(17_000);
    const page = makePage(`Products & Services:\n${content}`);
    render(<KnowledgeBaseModal page={page} onClose={onClose} onSave={onSave} saving={false} saved={false} />);

    // Should show the over-limit message with the excess count
    const alert = screen.getByRole('alert');
    expect(alert).toBeInTheDocument();
    expect(alert.textContent).toMatch(/remove.*characters to save/i);
  });

  it('enables save when under limit', () => {
    const page = makePage('Products & Services:\nShort content here');
    render(<KnowledgeBaseModal page={page} onClose={onClose} onSave={onSave} saving={false} saved={false} />);

    const saveButton = screen.getByRole('button', { name: /save/i });
    expect(saveButton).not.toBeDisabled();
  });
});
