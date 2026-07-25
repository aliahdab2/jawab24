import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { BusinessFactSheet, type EditableFactKey } from '@/components/business/BusinessFactSheet';

// The real VoiceRecordButton renders `null` when MediaRecorder is unsupported —
// which is jsdom's default. Stub it so "no mic" assertions are meaningful
// instead of passing vacuously.
vi.mock('@/components/knowledge-base/VoiceRecordButton', () => ({
  VoiceRecordButton: () => <button data-testid="voice-btn">mic</button>,
}));

vi.mock('@/components/ui', () => ({
  DetailSheet: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Button: ({ children, onClick, disabled }: {
    children: React.ReactNode;
    onClick?: () => void;
    disabled?: boolean;
  }) => <button onClick={onClick} disabled={disabled}>{children}</button>,
}));

function renderSheet(factKey: EditableFactKey, initialValue = '') {
  return render(
    <BusinessFactSheet
      factKey={factKey}
      label={factKey}
      initialValue={initialValue}
      saving={false}
      onSave={vi.fn()}
      onClose={vi.fn()}
    />,
  );
}

describe('BusinessFactSheet — voice input scope', () => {
  // Voice appends to whatever the field already holds. That is correct while
  // composing a paragraph, and wrong while correcting a structured value:
  // dictating a new address over a pre-filled one would concatenate both.
  it.each<EditableFactKey>(['delivery', 'payment'])(
    'offers voice on the free-text fact %s',
    (factKey) => {
      renderSheet(factKey);
      expect(screen.getByTestId('voice-btn')).toBeInTheDocument();
    },
  );

  it.each<EditableFactKey>(['address', 'website', 'phone', 'whatsapp'])(
    'does not offer voice on the structured fact %s',
    (factKey) => {
      renderSheet(factKey);
      expect(screen.queryByTestId('voice-btn')).not.toBeInTheDocument();
    },
  );

  it('still renders an editable input for a structured fact', () => {
    renderSheet('address', 'Damascus, Al-Baramkeh');
    expect(screen.getByDisplayValue('Damascus, Al-Baramkeh')).toBeInTheDocument();
  });
});
