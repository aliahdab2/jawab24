import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { BusinessFactSheet, type EditableFactKey } from '@/components/business/BusinessFactSheet';

// The real VoiceRecordButton renders `null` when MediaRecorder is unsupported —
// which is jsdom's default. Stub it so "no mic" assertions are meaningful
// instead of passing vacuously.
vi.mock('@/components/knowledge-base/VoiceRecordButton', () => ({
  VoiceRecordButton: () => <button data-testid="voice-btn">mic</button>,
}));

vi.mock('@/components/ui', () => ({
  WhatsAppIcon: () => <svg data-testid="wa-icon" />,
  DetailSheet: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Button: ({ children, onClick, disabled }: {
    children: React.ReactNode;
    onClick?: () => void;
    disabled?: boolean;
  }) => <button onClick={onClick} disabled={disabled}>{children}</button>,
}));

function renderSheet(factKey: EditableFactKey, initialValue = '', onSave = vi.fn(), initialWhatsapp?: string) {
  render(
    <BusinessFactSheet
      factKey={factKey}
      label={factKey}
      initialValue={initialValue}
      initialWhatsapp={initialWhatsapp}
      saving={false}
      onSave={onSave}
      onClose={vi.fn()}
    />,
  );
  return onSave;
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

  it.each<EditableFactKey>(['address', 'website', 'phone'])(
    'does not offer voice on the structured fact %s',
    (factKey) => {
      renderSheet(factKey);
      expect(screen.queryByTestId('voice-btn')).not.toBeInTheDocument();
    },
  );

  // WhatsApp is a MARK on a number the merchant already listed, not a second
  // field: in this market it is nearly always the same SIM, and a separate row
  // meant typing the same digits twice with two copies to keep in sync.
  it('saves the marked number as the WhatsApp contact alongside the phones', () => {
    const onSave = renderSheet('phone', '0988888888, 0935924400');
    fireEvent.click(screen.getAllByRole('button', { name: /Also on WhatsApp/ })[1]);
    fireEvent.click(screen.getByText('Save'));
    expect(onSave).toHaveBeenCalledWith('0988888888, 0935924400', '0935924400');
  });

  it('pre-marks the number already stored as WhatsApp', () => {
    renderSheet('phone', '0988888888, 0935924400', vi.fn(), '0935924400');
    const marks = screen.getAllByRole('button', { name: /Also on WhatsApp/ });
    expect(marks[0]).toHaveAttribute('aria-pressed', 'false');
    expect(marks[1]).toHaveAttribute('aria-pressed', 'true');
  });

  it('clears the WhatsApp contact when the mark is toggled off', () => {
    const onSave = renderSheet('phone', '0988888888', vi.fn(), '0988888888');
    fireEvent.click(screen.getByRole('button', { name: /Also on WhatsApp/ }));
    fireEvent.click(screen.getByText('Save'));
    expect(onSave).toHaveBeenCalledWith('0988888888', undefined);
  });

  // The flag must follow the NUMBER, not the row position.
  it('keeps the mark on the right number when an earlier one is deleted', () => {
    const onSave = renderSheet('phone', '0988888888, 0935924400', vi.fn(), '0935924400');
    fireEvent.click(screen.getByRole('button', { name: /delete phone 1/i }));
    fireEvent.click(screen.getByText('Save'));
    expect(onSave).toHaveBeenCalledWith('0935924400', '0935924400');
  });

  // Not every fact applies to every merchant — an online-only store has no
  // branch, a walk-in shop may not deliver. Hiding the row would leave the AI
  // reading [NOT_PROVIDED] = "unknown"; recording the negative makes it an
  // answer the AI can actually give.
  it('offers a not-applicable answer on address and delivery', () => {
    renderSheet('address');
    expect(screen.getByText('Online store — no physical branch')).toBeInTheDocument();
  });

  it('fills the field with the preset, editable not locked', () => {
    const onSave = renderSheet('delivery');
    fireEvent.click(screen.getByText('We do not deliver — pickup only'));
    fireEvent.click(screen.getByText('Save'));
    expect(onSave).toHaveBeenCalledWith('We do not deliver — pickup only');
  });

  it('hides the preset once the merchant has written something', () => {
    renderSheet('delivery', 'We deliver to Damascus for 5,000');
    expect(screen.queryByText('We do not deliver — pickup only')).not.toBeInTheDocument();
  });

  it('offers no preset where a negative is not a real answer', () => {
    renderSheet('website');
    expect(screen.queryByText(/Online store|do not deliver/)).not.toBeInTheDocument();
  });

  it('still renders an editable input for a structured fact', () => {
    renderSheet('address', 'Damascus, Al-Baramkeh');
    expect(screen.getByDisplayValue('Damascus, Al-Baramkeh')).toBeInTheDocument();
  });
});
