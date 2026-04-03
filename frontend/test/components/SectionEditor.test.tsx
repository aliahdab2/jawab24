import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { SectionEditor } from '@/components/knowledge-base/SectionEditor';

// Capture the options passed to useVoiceRecorder
const mockUseVoiceRecorder = vi.fn().mockReturnValue({
  state: 'idle',
  elapsed: 0,
  startRecording: vi.fn(),
  stopRecording: vi.fn(),
  isSupported: true,
});

vi.mock('@/hooks/useVoiceRecorder', () => ({
  useVoiceRecorder: (...args: unknown[]) => mockUseVoiceRecorder(...args),
}));

describe('SectionEditor', () => {
  it('passes current locale as languageHint to VoiceRecordButton', () => {
    // Default locale from setup.ts is 'en'
    render(
      <SectionEditor
        content=""
        onChange={vi.fn()}
        description="Test description"
        placeholder="Type here..."
        ariaLabel="Test editor"
        isExpanded={true}
      />,
    );

    // VoiceRecordButton calls useVoiceRecorder with the languageHint
    expect(mockUseVoiceRecorder).toHaveBeenCalledWith(
      expect.objectContaining({ languageHint: 'en' }),
    );
  });

  it('renders textarea with dir="auto" for mixed RTL/LTR input', () => {
    render(
      <SectionEditor
        content=""
        onChange={vi.fn()}
        description="Describe your business"
        placeholder="Type here..."
        ariaLabel="Business info"
        isExpanded={true}
      />,
    );

    const textarea = screen.getByRole('textbox');
    expect(textarea).toHaveAttribute('dir', 'auto');
  });

  it('hides char count for short content', () => {
    render(
      <SectionEditor
        content="Hello world"
        onChange={vi.fn()}
        description="Test"
        placeholder="Type..."
        ariaLabel="Editor"
        isExpanded={true}
      />,
    );

    expect(screen.queryByText(/\/ 8000/)).not.toBeInTheDocument();
  });

  it('shows char count when content exceeds 6000 chars', () => {
    const longContent = 'x'.repeat(6500);
    render(
      <SectionEditor
        content={longContent}
        onChange={vi.fn()}
        description="Test"
        placeholder="Type..."
        ariaLabel="Editor"
        isExpanded={true}
      />,
    );

    expect(screen.getByText('6500 / 8000')).toBeInTheDocument();
  });
});
