import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { BreadcrumbJsonLd } from '@/components/seo/BreadcrumbJsonLd';

function parseJsonLd(container: HTMLElement) {
  const script = container.querySelector('script[type="application/ld+json"]');
  expect(script).not.toBeNull();
  return JSON.parse(script?.textContent ?? '{}');
}

describe('BreadcrumbJsonLd', () => {
  it('emits a valid BreadcrumbList with ordered positions and items', () => {
    const { container } = render(
      <BreadcrumbJsonLd
        items={[
          { name: 'Jawab24', url: 'https://jawab24.com/' },
          { name: 'Blog', url: 'https://jawab24.com/blog' },
          { name: 'Post Title', url: 'https://jawab24.com/blog/post' },
        ]}
      />,
    );
    const data = parseJsonLd(container);
    expect(data['@type']).toBe('BreadcrumbList');
    expect(data.itemListElement).toHaveLength(3);
    expect(data.itemListElement.map((i: { position: number }) => i.position)).toEqual([1, 2, 3]);
    expect(data.itemListElement[0]).toMatchObject({
      '@type': 'ListItem',
      name: 'Jawab24',
      item: 'https://jawab24.com/',
    });
    expect(data.itemListElement[2].name).toBe('Post Title');
  });

  it('omits `item` for a crumb without a url (current page)', () => {
    const { container } = render(
      <BreadcrumbJsonLd items={[{ name: 'Home', url: 'https://jawab24.com/' }, { name: 'Current' }]} />,
    );
    const data = parseJsonLd(container);
    expect(data.itemListElement[1].item).toBeUndefined();
    expect(data.itemListElement[1].name).toBe('Current');
  });
});
