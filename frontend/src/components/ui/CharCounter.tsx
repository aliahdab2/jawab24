interface CharCounterProps {
  value: string;
  max: number;
  warnAt?: number;
}

export function CharCounter({ value, max, warnAt }: CharCounterProps) {
  const warn = warnAt ?? max * 0.9;
  const len = value.length;

  return (
    <span className={`text-xs font-bold ${
      len > max
        ? 'text-red-500'
        : len > warn
          ? 'text-amber-500'
          : 'text-surface-500'
    }`}>
      {len}/{max}
    </span>
  );
}
