/**
 * @vitest-environment jsdom
 */
import React from 'react';
import { render, screen } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { UpgradeCTA } from './UpgradeCTA';

const mockIsNative = vi.fn(() => false);
vi.mock('@/lib/capacitor', () => ({
  isNativePlatform: () => mockIsNative(),
}));

describe('UpgradeCTA', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockIsNative.mockReturnValue(false);
  });

  describe('on web', () => {
    it('renders a Link to /pricing wrapping its children', () => {
      render(
        <UpgradeCTA className="my-link">
          <span>Upgrade Plan</span>
        </UpgradeCTA>
      );
      const link = screen.getByRole('link', { name: 'Upgrade Plan' });
      expect(link).toHaveAttribute('href', '/pricing');
      expect(link).toHaveClass('my-link');
    });

    it('renders Link regardless of nativeVariant on web', () => {
      render(
        <UpgradeCTA nativeVariant="inline" className="badge">
          <span>Business+</span>
        </UpgradeCTA>
      );
      expect(screen.getByRole('link', { name: 'Business+' })).toHaveAttribute('href', '/pricing');
    });
  });

  describe('on native (block variant, default)', () => {
    beforeEach(() => {
      mockIsNative.mockReturnValue(true);
    });

    it('replaces children with an informational hint, not a link', () => {
      render(
        <UpgradeCTA>
          <span>Upgrade Plan</span>
        </UpgradeCTA>
      );
      expect(screen.queryByRole('link')).not.toBeInTheDocument();
      expect(screen.queryByText('Upgrade Plan')).not.toBeInTheDocument();
      expect(screen.getByText(/jawab24\.com/)).toBeInTheDocument();
    });
  });

  describe('on native (inline variant)', () => {
    beforeEach(() => {
      mockIsNative.mockReturnValue(true);
    });

    it('keeps the visual but strips interactivity', () => {
      render(
        <UpgradeCTA nativeVariant="inline" className="badge">
          <span>Business+</span>
        </UpgradeCTA>
      );
      expect(screen.queryByRole('link')).not.toBeInTheDocument();
      expect(screen.getByText('Business+')).toBeInTheDocument();
      const note = screen.getByRole('note');
      expect(note).toHaveAttribute('aria-label');
      expect(note).toHaveClass('badge');
    });
  });
});
