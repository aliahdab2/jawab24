import '@testing-library/jest-dom';
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { BusinessInfoNudgeBanner } from './BusinessInfoNudgeBanner';

describe('BusinessInfoNudgeBanner', () => {
  it('renders the nudge text and an accessible CTA', () => {
    render(<BusinessInfoNudgeBanner onAdd={vi.fn()} />);
    expect(screen.getByText('Add your Business Info so replies get more accurate')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add now' })).toBeInTheDocument();
  });

  it('calls onAdd when the CTA is clicked', () => {
    const onAdd = vi.fn();
    render(<BusinessInfoNudgeBanner onAdd={onAdd} />);
    fireEvent.click(screen.getByRole('button', { name: 'Add now' }));
    expect(onAdd).toHaveBeenCalledTimes(1);
  });

  it('renders the honest "can only greet" copy when strong (admin canary)', () => {
    render(<BusinessInfoNudgeBanner onAdd={vi.fn()} strong />);
    expect(screen.getByText('Jawab can only greet until you add your Business Info — it needs it to actually answer your customers.')).toBeInTheDocument();
    expect(screen.queryByText('Add your Business Info so replies get more accurate')).not.toBeInTheDocument();
  });
});
