import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { StatusPicker, resolveSubStage } from './StatusControl';
import en from '@/i18n/en/leads.json';
import type { LeadStagesConfig } from '@/lib/api';

// StatusPicker takes `t` as a prop — a stub backed by the real English JSON
// keeps assertions on actual user-facing strings (project convention).
const t = ((key: string) => (en as Record<string, string>)[key] ?? key) as never;

const STAGES: LeadStagesConfig = {
  converted: [
    { id: 'id-shipped', label: 'Shipped', color: 'cyan' },
    { id: 'id-delivered', label: 'Delivered', color: 'emerald' },
  ],
};

describe('resolveSubStage', () => {
  it('resolves a defined sub-stage id to its config entry', () => {
    expect(resolveSubStage(STAGES, 'converted', 'id-shipped')).toEqual(STAGES.converted![0]);
  });

  it('returns null for a stale (deleted) id — graceful badge fallback', () => {
    expect(resolveSubStage(STAGES, 'converted', 'id-gone')).toBeNull();
  });

  it('returns null when the id belongs to a different main status', () => {
    expect(resolveSubStage(STAGES, 'contacted', 'id-shipped')).toBeNull();
  });

  it('returns null without config or without an id', () => {
    expect(resolveSubStage(undefined, 'converted', 'id-shipped')).toBeNull();
    expect(resolveSubStage(STAGES, 'converted', null)).toBeNull();
    expect(resolveSubStage(STAGES, 'converted', undefined)).toBeNull();
  });
});

describe('StatusPicker sub-stage chips', () => {
  it('renders chips (incl. None) only when the selected status has sub-stages', () => {
    const { rerender } = render(
      <StatusPicker status="converted" subStage={null} stages={STAGES} onSelect={vi.fn()} t={t} />,
    );
    expect(screen.getByText('Shipped')).toBeInTheDocument();
    expect(screen.getByText('Delivered')).toBeInTheDocument();
    expect(screen.getByText(en.noSubStage)).toBeInTheDocument();

    // "contacted" has no configured sub-stages → no chip row at all
    rerender(
      <StatusPicker status="contacted" subStage={null} stages={STAGES} onSelect={vi.fn()} t={t} />,
    );
    expect(screen.queryByText('Shipped')).not.toBeInTheDocument();
    expect(screen.queryByText(en.noSubStage)).not.toBeInTheDocument();
  });

  it('reports the sub-stage id when a chip is selected', () => {
    const onSelect = vi.fn();
    render(
      <StatusPicker status="converted" subStage={null} stages={STAGES} onSelect={onSelect} t={t} />,
    );
    fireEvent.click(screen.getByText('Delivered'));
    expect(onSelect).toHaveBeenCalledWith('converted', 'id-delivered');
  });

  it('clears the sub-stage via the None chip', () => {
    const onSelect = vi.fn();
    render(
      <StatusPicker status="converted" subStage="id-shipped" stages={STAGES} onSelect={onSelect} t={t} />,
    );
    fireEvent.click(screen.getByText(en.noSubStage));
    expect(onSelect).toHaveBeenCalledWith('converted', null);
  });

  it('selecting a main status does not pass a sub-stage (server clears the old one)', () => {
    const onSelect = vi.fn();
    render(
      <StatusPicker status="converted" subStage="id-shipped" stages={STAGES} onSelect={onSelect} t={t} />,
    );
    fireEvent.click(screen.getByText(en.statusContacted));
    expect(onSelect).toHaveBeenCalledWith('contacted');
  });
});
