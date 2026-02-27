import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { GapCard } from '@/components/knowledge-base/GapCard';

// Mock translation hook
vi.mock('@/i18n', () => ({
  useTranslation: () => ({
    t: (key: string) => {
      const keys: Record<string, string> = {
        'kb.gaps.times': '{count}x',
        'kb.gaps.answerPlaceholder': 'Type your answer...',
        'kb.gaps.addToKb': 'Add to KB',
        'kb.gaps.skip': 'Skip',
      };
      return keys[key] ?? key;
    },
    language: 'en',
    setLanguage: vi.fn(),
    isRTL: false,
  }),
}));

const mockGap = {
  id: 'gap-1',
  queryText: 'do you have a warranty?',
  occurrenceCount: 3,
};

describe('GapCard', () => {
  it('renders question text and occurrence count in collapsed state', () => {
    render(
      <GapCard
        gap={mockGap}
        isExpanded={false}
        onToggle={vi.fn()}
        onApprove={vi.fn()}
        onSkip={vi.fn()}
      />
    );

    expect(screen.getByText('do you have a warranty?')).toBeInTheDocument();
    // Mock t() doesn't interpolate — renders the raw template
    expect(screen.getByText('{count}x')).toBeInTheDocument();
    expect(screen.queryByPlaceholderText('Type your answer...')).not.toBeInTheDocument();
  });

  it('shows textarea and buttons when expanded', () => {
    render(
      <GapCard
        gap={mockGap}
        isExpanded={true}
        onToggle={vi.fn()}
        onApprove={vi.fn()}
        onSkip={vi.fn()}
      />
    );

    expect(screen.getByPlaceholderText('Type your answer...')).toBeInTheDocument();
    expect(screen.getByText('Add to KB')).toBeInTheDocument();
    expect(screen.getByText('Skip')).toBeInTheDocument();
  });

  it('disables Add to KB when textarea is empty', () => {
    render(
      <GapCard
        gap={mockGap}
        isExpanded={true}
        onToggle={vi.fn()}
        onApprove={vi.fn()}
        onSkip={vi.fn()}
      />
    );

    const addButton = screen.getByText('Add to KB').closest('button');
    expect(addButton).toBeDisabled();
  });

  it('calls onApprove with textarea value when Add to KB is clicked', () => {
    const onApprove = vi.fn();
    render(
      <GapCard
        gap={mockGap}
        isExpanded={true}
        onToggle={vi.fn()}
        onApprove={onApprove}
        onSkip={vi.fn()}
      />
    );

    fireEvent.change(screen.getByPlaceholderText('Type your answer...'), {
      target: { value: 'We offer 1-year warranty on all products.' },
    });

    fireEvent.click(screen.getByText('Add to KB'));
    expect(onApprove).toHaveBeenCalledWith('We offer 1-year warranty on all products.');
  });

  it('calls onSkip when Skip is clicked', () => {
    const onSkip = vi.fn();
    render(
      <GapCard
        gap={mockGap}
        isExpanded={true}
        onToggle={vi.fn()}
        onApprove={vi.fn()}
        onSkip={onSkip}
      />
    );

    fireEvent.click(screen.getByText('Skip'));
    expect(onSkip).toHaveBeenCalled();
  });

  it('calls onToggle when header is clicked', () => {
    const onToggle = vi.fn();
    render(
      <GapCard
        gap={mockGap}
        isExpanded={false}
        onToggle={onToggle}
        onApprove={vi.fn()}
        onSkip={vi.fn()}
      />
    );

    fireEvent.click(screen.getByText('do you have a warranty?'));
    expect(onToggle).toHaveBeenCalled();
  });
});
