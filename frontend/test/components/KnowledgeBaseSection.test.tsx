import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Store } from 'lucide-react';
import { KnowledgeBaseSection } from '@/components/knowledge-base/KnowledgeBaseSection';
import type { KnowledgeSection, SectionConfig } from '@/components/knowledge-base/types';

// A hand-built config, not SECTION_CONFIGS[0]: the char-count behaviour under
// test must not depend on which marker/icon the real preset carries.
const config: SectionConfig = {
  id: 'products',
  emoji: '🛍️',
  icon: Store,
  titleKey: 'section.productsLabel',
  descKey: 'section.productsDesc',
  placeholderKey: 'section.productsPlaceholder',
};

describe('KnowledgeBaseSection — per-section char count', () => {
  it('shows char count when collapsed with content', () => {
    const section: KnowledgeSection = { id: 'products', content: 'Some product info here', title: 'Products' };

    render(
      <KnowledgeBaseSection
        section={section}
        config={config}
        isExpanded={false}
        onToggle={vi.fn()}
        onChange={vi.fn()}
      />,
    );

    // Should show char count (22 chars)
    expect(screen.getByText('22')).toBeInTheDocument();
  });

  it('hides char count when collapsed with no content', () => {
    const section: KnowledgeSection = { id: 'products', content: '', title: 'Products' };

    render(
      <KnowledgeBaseSection
        section={section}
        config={config}
        isExpanded={false}
        onToggle={vi.fn()}
        onChange={vi.fn()}
      />,
    );

    // No char count should appear
    expect(screen.queryByText('0')).not.toBeInTheDocument();
  });

  it('hides char count when expanded', () => {
    const section: KnowledgeSection = { id: 'products', content: 'Some content', title: 'Products' };

    render(
      <KnowledgeBaseSection
        section={section}
        config={config}
        isExpanded={true}
        onToggle={vi.fn()}
        onChange={vi.fn()}
      />,
    );

    // Char count should not show when expanded (editor is visible)
    expect(screen.queryByText('12')).not.toBeInTheDocument();
  });
});
