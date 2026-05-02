/**
 * @vitest-environment jsdom
 */
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { UpgradeCTA } from './UpgradeCTA';

const mockIsNative = vi.fn(() => false);
const mockIsIOSNative = vi.fn(() => false);
vi.mock('@/lib/capacitor', () => ({
  isNativePlatform: () => mockIsNative(),
  isIOSNative: () => mockIsIOSNative(),
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
    mockIsIOSNative.mockReturnValue(false);
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

    it('opens the embedded pricing URL with the current theme forwarded', () => {
      render(
        <UpgradeCTA>
          <span>Upgrade Plan</span>
        </UpgradeCTA>
      );
      fireEvent.click(screen.getByRole('button', { name: 'Upgrade Plan' }));
      expect(mockOpenExternalUrl).toHaveBeenCalledTimes(1);
      expect(mockOpenExternalUrl).toHaveBeenCalledWith(
        'https://jawab24.com/en/pricing?embedded=1&theme=light',
      );
    });

    it('forwards dark theme when the app is in dark mode', () => {
      document.documentElement.classList.add('dark');
      render(
        <UpgradeCTA>
          <span>Upgrade Plan</span>
        </UpgradeCTA>
      );
      fireEvent.click(screen.getByRole('button', { name: 'Upgrade Plan' }));
      expect(mockOpenExternalUrl).toHaveBeenCalledWith(
        'https://jawab24.com/en/pricing?embedded=1&theme=dark',
      );
      document.documentElement.classList.remove('dark');
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

  describe('on iOS native (App Store reader-app)', () => {
    beforeEach(() => {
      mockIsNative.mockReturnValue(true);
      mockIsIOSNative.mockReturnValue(true);
    });

    it('renders nothing — no upgrade UI may be reachable from the iOS app', () => {
      const { container } = render(
        <UpgradeCTA className="should-not-render">
          <span>Upgrade Plan</span>
        </UpgradeCTA>
      );
      expect(container).toBeEmptyDOMElement();
      expect(screen.queryByRole('link')).not.toBeInTheDocument();
      expect(screen.queryByRole('button')).not.toBeInTheDocument();
      expect(screen.queryByText('Upgrade Plan')).not.toBeInTheDocument();
    });

    it('does not call openExternalUrl', () => {
      render(
        <UpgradeCTA>
          <span>Upgrade Plan</span>
        </UpgradeCTA>
      );
      expect(mockOpenExternalUrl).not.toHaveBeenCalled();
    });
  });
});
