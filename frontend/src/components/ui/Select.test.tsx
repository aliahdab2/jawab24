import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Select } from '@/components/ui/Select';

// Regression: long option labels (e.g. "رد على التعليق + رسالة خاصة") were
// clipped next to their badge on narrow screens. Default selects must let the
// label WRAP so the full text is always readable; compact filter pills keep
// single-line truncation.
const LONG_LABEL = 'رد على التعليق + رسالة خاصة';

describe('Select — label wrapping', () => {
  it('default (non-compact) select wraps the label instead of truncating', () => {
    render(
      <Select
        value="dual"
        onChange={() => {}}
        aria-label="mode"
        options={[{ value: 'dual', label: LONG_LABEL, badge: 'موصى به' }]}
      />,
    );
    const label = screen.getByText(LONG_LABEL);
    expect(label.className).not.toContain('truncate');
    expect(label.className).toContain('break-words');
  });

  it('compact select truncates the label (single-line filter pill)', () => {
    render(
      <Select
        compact
        value="a"
        onChange={() => {}}
        aria-label="filter"
        options={[{ value: 'a', label: LONG_LABEL }]}
      />,
    );
    expect(screen.getByText(LONG_LABEL).className).toContain('truncate');
  });
});
