import { describe, it, expect } from 'vitest';
import { render, screen } from '../test-utils';
import CompareHubPage from '@/pages/compare/index';
import { getAllCompetitorSlugs, getCompetitor } from '@/data/competitors';

const competitors = getAllCompetitorSlugs()
  .map((slug) => {
    const c = getCompetitor(slug);
    return c ? { slug: c.slug, name: c.name } : null;
  })
  .filter((c): c is { slug: string; name: string } => c !== null);

describe('CompareHubPage', () => {
  it('renders the hub heading', () => {
    render(<CompareHubPage competitors={competitors} />);
    expect(screen.getByRole('heading', { level: 1, name: /Compare Jawab24/i })).toBeInTheDocument();
  });

  it('links to every comparison page', () => {
    render(<CompareHubPage competitors={competitors} />);
    expect(competitors.length).toBeGreaterThanOrEqual(5);
    for (const c of competitors) {
      const link = screen.getByRole('link', { name: new RegExp(`Jawab24 vs ${c.name}`, 'i') });
      expect(link).toHaveAttribute('href', `/compare/${c.slug}`);
    }
  });

  it('links to the best-auto-reply-tools money post (internal link equity)', () => {
    render(<CompareHubPage competitors={competitors} />);
    const link = screen.getByRole('link', { name: /Best Facebook auto-reply tools in 2026/i });
    expect(link).toHaveAttribute('href', '/blog/best-auto-reply-tools-2026');
  });
});
