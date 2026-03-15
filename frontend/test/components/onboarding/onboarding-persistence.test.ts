import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Tests for onboarding completion persistence logic.
 *
 * The onboarding visibility is determined by two sources:
 * 1. Server-side: settings.onboardingCompletedAt (source of truth)
 * 2. Client-side: localStorage 'jawab24_onboarding_complete' (fast cache)
 *
 * These tests verify the decision matrix used in dashboard.tsx.
 */

const ONBOARDING_COMPLETE_KEY = 'jawab24_onboarding_complete';

/** Replicate the dashboard's onboarding visibility decision logic */
function shouldShowOnboarding(
  serverComplete: boolean,
  localComplete: boolean,
): boolean {
  return !serverComplete && !localComplete;
}

/** Should the server be backfilled when localStorage has the key but server doesn't? */
function shouldBackfillServer(
  serverComplete: boolean,
  localComplete: boolean,
): boolean {
  return localComplete && !serverComplete;
}

describe('Onboarding Persistence Logic', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('shows onboarding when neither server nor localStorage has completion', () => {
    expect(shouldShowOnboarding(false, false)).toBe(true);
  });

  it('hides onboarding when server has completion (even if localStorage is empty)', () => {
    // This is the key scenario: user clears browser cache but server knows they completed
    expect(shouldShowOnboarding(true, false)).toBe(false);
  });

  it('hides onboarding when localStorage has completion', () => {
    expect(shouldShowOnboarding(false, true)).toBe(false);
  });

  it('hides onboarding when both server and localStorage have completion', () => {
    expect(shouldShowOnboarding(true, true)).toBe(false);
  });

  it('triggers server backfill when localStorage set but server is not', () => {
    // Backward compat: user completed before server-side tracking was added
    expect(shouldBackfillServer(false, true)).toBe(true);
  });

  it('does NOT trigger server backfill when server already has completion', () => {
    expect(shouldBackfillServer(true, true)).toBe(false);
  });

  it('does NOT trigger server backfill for brand new users', () => {
    expect(shouldBackfillServer(false, false)).toBe(false);
  });

  describe('localStorage key', () => {
    it('uses the correct key name', () => {
      expect(ONBOARDING_COMPLETE_KEY).toBe('jawab24_onboarding_complete');
    });

    it('round-trips through localStorage', () => {
      localStorage.setItem(ONBOARDING_COMPLETE_KEY, 'true');
      expect(localStorage.getItem(ONBOARDING_COMPLETE_KEY)).toBe('true');
    });
  });
});
