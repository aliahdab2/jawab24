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
  ConfirmationModal: ({ isOpen, onConfirm, onClose, confirmText, cancelText }: {
    isOpen: boolean;
    onConfirm: () => void;
    onClose: () => void;
    confirmText?: string;
    cancelText?: string;
  }) => (isOpen ? (
    <div data-testid="discard-confirm">
      <button onClick={onConfirm}>{confirmText}</button>
      <button onClick={onClose}>{cancelText}</button>
    </div>
  ) : null),
}));

function renderSheet(
  factKey: EditableFactKey,
  initialValue = '',
  onSave = vi.fn(),
  initialWhatsapp?: string | string[],
  storeAnswered = false,
  onClose = vi.fn(),
) {
  render(
    <BusinessFactSheet
      factKey={factKey}
      label={factKey}
      initialValue={initialValue}
      initialWhatsapp={initialWhatsapp}
      storeAnswered={storeAnswered}
      saving={false}
      onSave={onSave}
      onClose={onClose}
    />,
  );
  return onSave;
}

describe('BusinessFactSheet — voice input scope', () => {
  // Voice appends, and the auto-growing textarea shows what landed — so every
  // free-text fact offers it. Delivery/payment render their structured intake
  // while EMPTY, so the mic is asserted on the edit (non-empty) path.
  it('offers voice on the empty address', () => {
    renderSheet('address');
    expect(screen.getByTestId('voice-btn')).toBeInTheDocument();
  });

  it.each<EditableFactKey>(['delivery', 'payment'])(
    'offers voice when editing existing %s text',
    (factKey) => {
      renderSheet(factKey, 'existing details');
      expect(screen.getByTestId('voice-btn')).toBeInTheDocument();
    },
  );

  it.each<EditableFactKey>(['website', 'phone'])(
    'does not offer voice on the single-line fact %s',
    (factKey) => {
      renderSheet(factKey);
      expect(screen.queryByTestId('voice-btn')).not.toBeInTheDocument();
    },
  );
});

describe('BusinessFactSheet — WhatsApp marks', () => {
  // Each number carries its own INDEPENDENT flag: marking one must never clear
  // another (the old single-mark model behaved as a radio group).
  it('saves every marked number — marking one never clears another', () => {
    const onSave = renderSheet('phone', '0988888888, 0935924400', vi.fn(), '0988888888');
    fireEvent.click(screen.getAllByRole('checkbox', { name: /Also on WhatsApp/ })[1]);
    fireEvent.click(screen.getByText('Save'));
    expect(onSave).toHaveBeenCalledWith('0988888888, 0935924400', ['0988888888', '0935924400']);
  });

  it('pre-marks numbers from legacy single-string storage', () => {
    renderSheet('phone', '0988888888, 0935924400', vi.fn(), '0935924400');
    const marks = screen.getAllByRole('checkbox', { name: /Also on WhatsApp/ });
    expect(marks[0]).not.toBeChecked();
    expect(marks[1]).toBeChecked();
  });

  it('pre-marks numbers from array storage', () => {
    renderSheet('phone', '0988888888, 0935924400', vi.fn(), ['0988888888', '0935924400']);
    const marks = screen.getAllByRole('checkbox', { name: /Also on WhatsApp/ });
    expect(marks[0]).toBeChecked();
    expect(marks[1]).toBeChecked();
  });

  it('clears a mark independently when toggled off', () => {
    const onSave = renderSheet('phone', '0988888888', vi.fn(), '0988888888');
    fireEvent.click(screen.getByRole('checkbox', { name: /Also on WhatsApp/ }));
    fireEvent.click(screen.getByText('Save'));
    expect(onSave).toHaveBeenCalledWith('0988888888', []);
  });

  // The flag must follow the NUMBER, not the row position.
  it('keeps the mark on the right number when an earlier one is deleted', () => {
    const onSave = renderSheet('phone', '0988888888, 0935924400', vi.fn(), '0935924400');
    fireEvent.click(screen.getByRole('button', { name: /delete phone 1/i }));
    // Non-empty rows arm first — the second tap confirms.
    fireEvent.click(screen.getByText('Confirm delete'));
    fireEvent.click(screen.getByText('Save'));
    expect(onSave).toHaveBeenCalledWith('0935924400', ['0935924400']);
  });
});

describe('BusinessFactSheet — phone entry safety', () => {
  it('uses a telephone input so mobile keyboards show digits', () => {
    renderSheet('phone', '0988888888');
    const input = screen.getByRole('textbox', { name: 'phone 1' });
    expect(input).toHaveAttribute('type', 'tel');
    expect(input).toHaveAttribute('inputmode', 'tel');
  });

  it('flags a duplicate number and blocks Save', () => {
    renderSheet('phone', '0911 22 33 44, 0935924400');
    const second = screen.getByRole('textbox', { name: 'phone 2' });
    // Same SIM with different spacing — normalization must still catch it.
    fireEvent.change(second, { target: { value: '0911-223344' } });
    expect(screen.getByRole('alert')).toHaveTextContent('This number is already listed');
    expect(screen.getByText('Save')).toBeDisabled();
  });

  it('deletes an empty row without arming a confirm', () => {
    renderSheet('phone', '0988888888');
    fireEvent.click(screen.getByRole('button', { name: /add another number/i }));
    fireEvent.click(screen.getByRole('button', { name: /delete phone 2/i }));
    expect(screen.queryByText('Confirm delete')).not.toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: 'phone 2' })).not.toBeInTheDocument();
  });
});

describe('BusinessFactSheet — not-applicable presets', () => {
  // Not every fact applies to every merchant — an online-only store has no
  // branch, most local merchants have a page rather than a website. Hiding the
  // row would leave the AI reading [NOT_PROVIDED] = "unknown"; recording the
  // negative makes it an answer the AI can actually give.
  it('offers a not-applicable answer on address', () => {
    renderSheet('address');
    expect(screen.getByText('Online store — no physical branch')).toBeInTheDocument();
  });

  it('offers a not-applicable answer on website', () => {
    const onSave = renderSheet('website');
    fireEvent.click(screen.getByText('We do not have a website'));
    fireEvent.click(screen.getByText('Save'));
    expect(onSave).toHaveBeenCalledWith('We do not have a website');
  });

  it('fills the field with the negative, editable not locked', () => {
    const onSave = renderSheet('delivery');
    fireEvent.click(screen.getByText('We do not deliver'));
    // The «no» answer lands in the plain textarea, still editable.
    expect(screen.getByDisplayValue('We do not deliver')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Save'));
    expect(onSave).toHaveBeenCalledWith('We do not deliver');
  });

  // A preset goes verbatim into BUSINESS_INFO and is then told to customers as
  // fact, so it may state ONE negative and nothing more. "— pickup only" once
  // rode along and asserted a shop to collect from: false for an online-only or
  // service business, and a direct contradiction of the address preset.
  it('states only the negative, never a second unverified fact', () => {
    renderSheet('delivery');
    expect(screen.getByText(/do not deliver/i).textContent).toBe('We do not deliver');
  });

  it('hides the intake and presets once the merchant has written something', () => {
    renderSheet('delivery', 'We deliver to Damascus for 5,000');
    expect(screen.queryByText('We do not deliver')).not.toBeInTheDocument();
    expect(screen.queryByText('Do you offer delivery?')).not.toBeInTheDocument();
  });

  it('offers no preset on the repeatable phone fact', () => {
    renderSheet('phone');
    expect(screen.queryByText(/Online store|do not deliver|do not have/)).not.toBeInTheDocument();
  });
});

describe('BusinessFactSheet — structured first fill', () => {
  it('composes delivery details from the yes-path fields', () => {
    const onSave = renderSheet('delivery');
    fireEvent.click(screen.getByText('Yes, we deliver'));
    fireEvent.change(screen.getByRole('textbox', { name: 'Delivery areas' }), {
      target: { value: 'All Damascus districts' },
    });
    fireEvent.change(screen.getByRole('textbox', { name: 'Delivery cost' }), {
      target: { value: '5,000' },
    });
    fireEvent.click(screen.getByText('Save'));
    expect(onSave).toHaveBeenCalledWith(
      'We offer delivery.\nDelivery areas: All Damascus districts\nDelivery cost: 5,000',
    );
  });

  it('composes payment methods from the toggles plus the note', () => {
    const onSave = renderSheet('payment');
    fireEvent.click(screen.getByRole('button', { name: 'Cash' }));
    fireEvent.click(screen.getByRole('button', { name: 'Bank transfer' }));
    fireEvent.change(screen.getByRole('textbox', { name: /Anything else about payment/ }), {
      target: { value: 'Cash on delivery available' },
    });
    fireEvent.click(screen.getByText('Save'));
    expect(onSave).toHaveBeenCalledWith(
      'Payment methods: Cash and Bank transfer\nCash on delivery available',
    );
  });

  it('keeps Save disabled until the intake holds an answer', () => {
    renderSheet('payment');
    expect(screen.getByText('Save')).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Cash' }));
    expect(screen.getByText('Save')).not.toBeDisabled();
  });

  it('carries a drafted answer into the free-text escape hatch', () => {
    renderSheet('delivery');
    fireEvent.click(screen.getByText('Yes, we deliver'));
    fireEvent.change(screen.getByRole('textbox', { name: 'Delivery areas' }), {
      target: { value: 'Damascus' },
    });
    fireEvent.click(screen.getByText('Write it as free text instead'));
    expect(screen.getByDisplayValue(/Delivery areas: Damascus/)).toBeInTheDocument();
  });
});

describe('BusinessFactSheet — store-answered note', () => {
  // The row is still tappable on a store page — writing here is a deliberate
  // override, so the sheet says what it is rather than blocking it.
  it('explains the store already answers, only while empty', () => {
    renderSheet('delivery', '', vi.fn(), undefined, true);
    expect(screen.getByText(/Your connected store already answers this/)).toBeInTheDocument();
  });

  it('drops the store note once an override is written', () => {
    renderSheet('delivery', 'Free over 300', vi.fn(), undefined, true);
    expect(screen.queryByText(/Your connected store already answers this/)).not.toBeInTheDocument();
  });

  it('still renders an editable input for a structured fact', () => {
    renderSheet('address', 'Damascus, Al-Baramkeh');
    expect(screen.getByDisplayValue('Damascus, Al-Baramkeh')).toBeInTheDocument();
  });
});

describe('BusinessFactSheet — save failure', () => {
  // The sheet stays open on failure and toasts render UNDER the modal tier
  // (z-45 < z-50), so the sheet itself must carry the error.
  it('renders the failure inline with role=alert', () => {
    render(
      <BusinessFactSheet
        factKey="address"
        label="address"
        initialValue=""
        saving={false}
        saveError="Could not save"
        onSave={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByRole('alert')).toHaveTextContent('Could not save');
  });
});

describe('BusinessFactSheet — unsaved-changes guard', () => {
  it('closes silently when nothing changed', () => {
    const onClose = vi.fn();
    renderSheet('address', 'Damascus', vi.fn(), undefined, false, onClose);
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalled();
    expect(screen.queryByTestId('discard-confirm')).not.toBeInTheDocument();
  });

  it('asks before discarding typed-but-unsaved edits', () => {
    const onClose = vi.fn();
    renderSheet('address', 'Damascus', vi.fn(), undefined, false, onClose);
    fireEvent.change(screen.getByDisplayValue('Damascus'), { target: { value: 'Aleppo' } });
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByTestId('discard-confirm')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Discard changes'));
    expect(onClose).toHaveBeenCalled();
  });

  it('keeps editing when the confirm is declined', () => {
    const onClose = vi.fn();
    renderSheet('address', 'Damascus', vi.fn(), undefined, false, onClose);
    fireEvent.change(screen.getByDisplayValue('Damascus'), { target: { value: 'Aleppo' } });
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    fireEvent.click(screen.getByText('Keep editing'));
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByDisplayValue('Aleppo')).toBeInTheDocument();
  });
});
