import { describe, it, expect, afterEach, vi } from 'vitest';
import { isMobileBrowser } from '@/lib/browserEnv';

type MutableNavigator = { userAgentData?: { mobile?: boolean }; userAgent: string; maxTouchPoints: number };
const nav = navigator as unknown as MutableNavigator;

const ORIGINAL_UA = nav.userAgent;

function setNavigator(patch: Partial<MutableNavigator>) {
  if ('userAgentData' in patch) {
    Object.defineProperty(navigator, 'userAgentData', { value: patch.userAgentData, configurable: true });
  }
  if (patch.userAgent !== undefined) {
    Object.defineProperty(navigator, 'userAgent', { value: patch.userAgent, configurable: true });
  }
  if (patch.maxTouchPoints !== undefined) {
    Object.defineProperty(navigator, 'maxTouchPoints', { value: patch.maxTouchPoints, configurable: true });
  }
}

describe('isMobileBrowser', () => {
  afterEach(() => {
    setNavigator({ userAgentData: undefined, userAgent: ORIGINAL_UA, maxTouchPoints: 0 });
    vi.restoreAllMocks();
  });

  it('trusts UA-Client-Hints when present', () => {
    setNavigator({ userAgentData: { mobile: true } });
    expect(isMobileBrowser()).toBe(true);
    setNavigator({ userAgentData: { mobile: false } });
    expect(isMobileBrowser()).toBe(false);
  });

  it('detects Android Chrome via UA fallback', () => {
    setNavigator({
      userAgentData: undefined,
      userAgent: 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Mobile Safari/537.36',
    });
    expect(isMobileBrowser()).toBe(true);
  });

  it('treats a desktop UA as desktop', () => {
    setNavigator({
      userAgentData: undefined,
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36',
      maxTouchPoints: 0,
    });
    expect(isMobileBrowser()).toBe(false);
  });

  it('catches iPadOS masquerading as macOS via multi-touch', () => {
    setNavigator({
      userAgentData: undefined,
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15',
      maxTouchPoints: 5,
    });
    expect(isMobileBrowser()).toBe(true);
  });

  it('a real Mac (no touch) is desktop', () => {
    setNavigator({
      userAgentData: undefined,
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15',
      maxTouchPoints: 0,
    });
    expect(isMobileBrowser()).toBe(false);
  });
});
