import '@testing-library/jest-dom';
import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { KnowledgeBaseSections } from './KnowledgeBaseSections';
import type { KnowledgeSection } from './types';

const noop = vi.fn();

const renderSections = (sections: KnowledgeSection[]) =>
  render(
    <KnowledgeBaseSections
      sections={sections}
      expandedId={null}
      onExpandedChange={noop}
      onSectionChange={noop}
      onAddCustomSection={noop}
      onDeleteCustomSection={noop}
      onCustomTitleChange={noop}
      remainingChars={1000}
    />
  );

describe('KnowledgeBaseSections', () => {
  it('renders one card per preset section, titled by its label', () => {
    renderSections([
      { id: 'products', content: 'Abayas from 30k SYP.' },
      { id: 'notes', content: '' },
    ]);

    expect(screen.getByText('About your business')).toBeInTheDocument();
    expect(screen.getByText('Other Notes')).toBeInTheDocument();
  });

  // The «N of M filled» bar was a second scoreboard under the readiness ring
  // (Business Info clarity, 2026-08-29). It is gone for good: neither the
  // interpolated label nor the raw key it once leaked (the original regression
  // this file pinned) may come back, whether sections are half or fully filled.
  it.each([
    ['half filled', [
      { id: 'products', content: 'Abayas from 30k SYP.' },
      { id: 'notes', content: '' },
    ] as KnowledgeSection[]],
    ['fully filled', [
      { id: 'products', content: 'Abayas from 30k SYP.' },
      { id: 'notes', content: 'We ship across Syria.' },
    ] as KnowledgeSection[]],
  ])('shows no section-progress label (%s)', (_label, sections) => {
    renderSections(sections);

    expect(screen.queryByText(/filled/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/kb\.progress/)).not.toBeInTheDocument();
  });
});
