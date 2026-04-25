import clsx from 'clsx';

/**
 * Generic two-or-more option range selector for analytics views.
 * Uses radiogroup semantics so screen readers announce the active range.
 */
export interface RangeOption<T extends string> {
    value: T;
    label: string;
}

export interface RangeToggleProps<T extends string> {
    options: ReadonlyArray<RangeOption<T>>;
    value: T;
    onChange: (next: T) => void;
    ariaLabel: string;
}

export function RangeToggle<T extends string>({ options, value, onChange, ariaLabel }: RangeToggleProps<T>) {
    return (
        <div role="radiogroup" aria-label={ariaLabel} className="inline-flex rounded-xl bg-muted p-1">
            {options.map((opt) => {
                const active = opt.value === value;
                return (
                    <button
                        key={opt.value}
                        type="button"
                        role="radio"
                        aria-checked={active}
                        onClick={() => onChange(opt.value)}
                        className={clsx(
                            'px-3 py-1.5 text-sm rounded-lg transition-colors',
                            active
                                ? 'bg-card text-foreground shadow-sm font-semibold'
                                : 'text-muted-foreground hover:text-foreground',
                        )}
                    >
                        {opt.label}
                    </button>
                );
            })}
        </div>
    );
}
