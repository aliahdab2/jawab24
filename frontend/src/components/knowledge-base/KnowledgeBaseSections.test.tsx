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

describe('KnowledgeBaseSections progress label', () => {
  // Regression: tKb('progress') was called WITHOUT its ICU values and then
  // hand-interpolated with .replace('{filled}', …). next-intl fails to format
  // an ICU message with missing arguments and falls back to the raw key, so
  // merchants saw the literal text "kb.progress" above the section list.
  it('interpolates the filled/total counts (never the raw kb.progress key)', () => {
    renderSections([
      { id: 'products', content: 'Abayas from 30k SYP.' },
      { id: 'notes', content: '' },
    ]);

    expect(screen.getByText('1 of 2 filled')).toBeInTheDocument();
    expect(screen.queryByText(/kb\.progress/)).not.toBeInTheDocument();
  });

  it('shows the complete label when every section is filled', () => {
    renderSections([
      { id: 'products', content: 'Abayas from 30k SYP.' },
      { id: 'notes', content: 'We ship across Syria.' },
    ]);

    expect(screen.queryByText(/of .* filled/)).not.toBeInTheDocument();
    expect(screen.queryByText(/kb\.progress/)).not.toBeInTheDocument();
  });
});
