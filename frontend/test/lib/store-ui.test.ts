import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useUIStore } from '@/lib/store';

// Mock Sentry
vi.mock('@sentry/nextjs', () => ({
  captureMessage: vi.fn(),
  captureException: vi.fn(),
  addBreadcrumb: vi.fn(),
}));

describe('useUIStore', () => {
  beforeEach(() => {
    // Reset to default state before each test
    useUIStore.setState({
      sidebarOpen: true,
      language: 'ar',
      _hasHydrated: false,
      isOnboardingVisible: false,
    });
  });

  describe('sidebar', () => {
    it('should start with sidebar open', () => {
      expect(useUIStore.getState().sidebarOpen).toBe(true);
    });

    it('should toggle sidebar', () => {
      useUIStore.getState().toggleSidebar();
      expect(useUIStore.getState().sidebarOpen).toBe(false);

      useUIStore.getState().toggleSidebar();
      expect(useUIStore.getState().sidebarOpen).toBe(true);
    });

    it('should set sidebar open/closed explicitly', () => {
      useUIStore.getState().setSidebarOpen(false);
      expect(useUIStore.getState().sidebarOpen).toBe(false);

      useUIStore.getState().setSidebarOpen(true);
      expect(useUIStore.getState().sidebarOpen).toBe(true);
    });
  });

  describe('language', () => {
    it('should default to Arabic', () => {
      expect(useUIStore.getState().language).toBe('ar');
    });

    it('should switch to English', () => {
      useUIStore.getState().setLanguage('en');
      expect(useUIStore.getState().language).toBe('en');
    });

    it('should switch back to Arabic', () => {
      useUIStore.getState().setLanguage('en');
      useUIStore.getState().setLanguage('ar');
      expect(useUIStore.getState().language).toBe('ar');
    });
  });

  describe('hydration', () => {
    it('should start with _hasHydrated false', () => {
      expect(useUIStore.getState()._hasHydrated).toBe(false);
    });

    it('should set hydration state', () => {
      useUIStore.getState().setHasHydrated(true);
      expect(useUIStore.getState()._hasHydrated).toBe(true);
    });
  });

  describe('onboarding', () => {
    it('should start with onboarding not visible', () => {
      expect(useUIStore.getState().isOnboardingVisible).toBe(false);
    });

    it('should show onboarding', () => {
      useUIStore.getState().setOnboardingVisible(true);
      expect(useUIStore.getState().isOnboardingVisible).toBe(true);
    });

    it('should hide onboarding', () => {
      useUIStore.getState().setOnboardingVisible(true);
      useUIStore.getState().setOnboardingVisible(false);
      expect(useUIStore.getState().isOnboardingVisible).toBe(false);
    });
  });
});
