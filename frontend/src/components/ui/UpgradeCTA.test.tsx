/**
 * @vitest-environment jsdom
 */
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { UpgradeCTA } from './UpgradeCTA';

const mockIsNative = vi.fn(() => false);
vi.mock('@/lib/capacitor', () => ({
  isNativePlatform: () => mockIsNative(),
}));

const mockOpenExternalUrl = vi.fn();
vi.mock('@/lib/openExternalUrl', () => ({
  openExternalUrl: (...args: unknown[]) => mockOpenExternalUrl(...args),
}));

vi.mock('next-intl', () => ({
  useLocale: () => 'en',
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
  });

  describe('on native', () => {
    beforeEach(() => {
      mockIsNative.mockReturnValue(true);
    });

    it('renders a role="button" wrapper with the provided className', () => {
      render(
        <UpgradeCTA className="badge">
          <span>Upgrade Plan</span>
        </UpgradeCTA>
      );
      expect(screen.queryByRole('link')).not.toBeInTheDocument();
      const btn = screen.getByRole('button', { name: 'Upgrade Plan' });
      expect(btn).toHaveClass('badge');
    });

    it('opens the embedded pricing URL via openExternalUrl when clicked', () => {
      render(
        <UpgradeCTA>
          <span>Upgrade Plan</span>
        </UpgradeCTA>
      );
      fireEvent.click(screen.getByRole('button', { name: 'Upgrade Plan' }));
      expect(mockOpenExternalUrl).toHaveBeenCalledTimes(1);
      expect(mockOpenExternalUrl).toHaveBeenCalledWith(
        'https://jawab24.com/en/pricing?embedded=1',
      );
    });

    it('activates on Enter key for keyboard users', () => {
      render(
        <UpgradeCTA>
          <span>Upgrade Plan</span>
        </UpgradeCTA>
      );
      fireEvent.keyDown(screen.getByRole('button', { name: 'Upgrade Plan' }), { key: 'Enter' });
      expect(mockOpenExternalUrl).toHaveBeenCalledTimes(1);
    });

    it('activates on Space key for keyboard users', () => {
      render(
        <UpgradeCTA>
          <span>Upgrade Plan</span>
        </UpgradeCTA>
      );
      fireEvent.keyDown(screen.getByRole('button', { name: 'Upgrade Plan' }), { key: ' ' });
      expect(mockOpenExternalUrl).toHaveBeenCalledTimes(1);
    });

    it('does not activate on unrelated keys', () => {
      render(
        <UpgradeCTA>
          <span>Upgrade Plan</span>
        </UpgradeCTA>
      );
      fireEvent.keyDown(screen.getByRole('button', { name: 'Upgrade Plan' }), { key: 'Tab' });
      expect(mockOpenExternalUrl).not.toHaveBeenCalled();
    });
  });
});
