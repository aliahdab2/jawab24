/**
 * Shared mock implementations for '@/components/ui' — the superset of what the
 * settings-card tests need. Use from a test file as:
 *
 *   vi.mock('@/components/ui', () => import('../../testUtils/uiMocks'));
 *
 * Notes on fidelity kept from the per-file mocks this replaces:
 * - Select is a native <select> (implicit `combobox` role) carrying
 *   `aria-labelledby`; the real one renders a custom listbox (the OS-drawn
 *   native popup was WHITE in dark mode — why the app switched), tests only
 *   assert selection.
 * - Toggle exposes both the `data-testid` and the `aria-label` contract so
 *   tests can query either way.
 */
import type React from 'react';

export const Card = ({ children, className }: { children: React.ReactNode; className?: string }) => (
  <div className={className}>{children}</div>
);

export const Toggle = ({ enabled, onChange, 'aria-label': ariaLabel }: {
  enabled: boolean; onChange: (v: boolean) => void; 'aria-label'?: string;
}) => (
  <button data-testid="toggle" aria-label={ariaLabel} onClick={() => onChange(!enabled)}>
    {enabled ? 'ON' : 'OFF'}
  </button>
);

export const Select = ({ value, onChange, options, 'aria-labelledby': labelledBy }: {
  value: string; onChange: (v: string) => void;
  options: { value: string; label: string }[]; 'aria-labelledby'?: string;
}) => (
  <select aria-labelledby={labelledBy} value={value} onChange={(e) => onChange(e.target.value)}>
    {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
  </select>
);

export const Input = (props: React.InputHTMLAttributes<HTMLInputElement>) => <input {...props} />;

export const InputFieldWrapper = ({ children, trailing }: { children: React.ReactNode; trailing?: React.ReactNode }) => (
  <div>{children}{trailing}</div>
);

export const CharCounter = ({ value, max }: { value: string | number; max: number }) => {
  const len = typeof value === 'string' ? value.length : value;
  return <span>{len}/{max}</span>;
};

// Deliberately label-free: cards reuse one string for a control's aria-label
// AND its info trigger (e.g. businessHoursLabel), so a labeled mock here makes
// getByLabelText ambiguous for the control the test actually targets.
export const InfoPopover = ({ children }: { children: React.ReactNode }) => <span>{children}</span>;

// Minimal ConfirmationModal: render nothing while closed; expose stable
// testids so tests don't collide with same-named buttons in the card.
export const ConfirmationModal = ({ isOpen, onClose, onConfirm, title, message }: {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  variant?: string;
  loading?: boolean;
}) => (
  isOpen ? (
    <div role="dialog" aria-label={title}>
      <p>{message}</p>
      <button type="button" data-testid="confirm-modal-confirm" onClick={onConfirm}>confirm</button>
      <button type="button" data-testid="confirm-modal-cancel" onClick={onClose}>cancel</button>
    </div>
  ) : null
);
