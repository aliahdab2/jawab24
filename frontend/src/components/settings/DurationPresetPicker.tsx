import clsx from 'clsx';
import { Clock, Check } from 'lucide-react';

export interface DurationOption {
  value: number;
  label: string;
}

interface DurationPresetPickerProps {
  options: DurationOption[];
  value: number;
  onChange: (value: number) => void;
  /** Optional uppercase micro-label rendered above the button row. */
  label?: string;
  disabled?: boolean;
  /** Button scale: 'sm' for dense cards (reply reminders), 'md' for standalone (handoff pause). */
  size?: 'sm' | 'md';
  /** Accessible group label when no visible `label` is provided. */
  ariaLabel?: string;
}

/**
 * A row of selectable duration presets (15min, 1hr, …). Shared by the reply
 * reminder pickers (comments + messages) and the handoff-pause picker, which
 * previously each hand-rolled the same button group. Selected = brand-filled.
 */
export function DurationPresetPicker({
  options,
  value,
  onChange,
  label,
  disabled = false,
  size = 'sm',
  ariaLabel,
}: DurationPresetPickerProps) {
  return (
    <div>
      {label && (
        <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest mb-2">{label}</p>
      )}
      <div className="flex flex-wrap gap-2" role="group" aria-label={ariaLabel ?? label}>
        {options.map((opt) => {
          const selected = value === opt.value;
          return (
            <button
              key={opt.value}
              type="button"
              onClick={() => onChange(opt.value)}
              disabled={disabled}
              aria-pressed={selected}
              className={clsx(
                'rounded-xl font-bold transition-all border flex items-center gap-1.5 active:scale-[0.98]',
                size === 'md' ? 'px-4 py-3 text-sm min-h-[44px]' : 'px-3 py-2.5 text-xs min-h-[40px]',
                selected
                  ? 'bg-brand-500 text-white border-brand-600 shadow-md'
                  : 'bg-background text-muted-foreground border-theme-border hover:bg-muted',
              )}
            >
              {selected
                ? <Check className="w-3.5 h-3.5" aria-hidden="true" />
                : <Clock className="w-3.5 h-3.5 text-muted-foreground" aria-hidden="true" />}
              {opt.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
