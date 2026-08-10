import { describe, it, expect } from 'vitest';
import type { Event as SentryEvent, StackFrame } from '@sentry/nextjs';
import {
  isInAppBrowserInjectedEvent,
  IN_APP_BROWSER_MESSAGE_PATTERNS,
  IN_APP_BROWSER_SCRIPT_URL,
} from '@/lib/sentryEventFilters';

/**
 * Frames are given OLDEST-FIRST, the order Sentry actually stores them in
 * (`stripSentryFramesAndReverse` reverses the parsed stack) — i.e. the reverse
 * of how the issue page displays them. That ordering is the whole reason
 * `denyUrls` misses these events, so the fixtures must preserve it.
 */
function eventWithFrames(frames: StackFrame[], value = 'boom'): SentryEvent {
  return { exception: { values: [{ type: 'Error', value, stacktrace: { frames } }] } };
}

function matchesIgnoreErrors(message: string): boolean {
  return IN_APP_BROWSER_MESSAGE_PATTERNS.some((pattern) => pattern.test(message));
}

describe('isInAppBrowserInjectedEvent', () => {
  describe('real events that reached production Sentry', () => {
    it('drops the Facebook Android logger crash whose innermost frame is our own bundle (JAWAB24-FRONTEND-2V)', () => {
      // "Error invoking postMessage: Java object is gone". denyUrls tests only
      // the innermost frame — here Sentry's addEventListener wrapper inside our
      // _app chunk — so the three Meta frames below it were never considered.
      const event = eventWithFrames([
        { filename: 'app://navigation_performance_logger_android', function: 'sendDataToNative', lineno: 1, colno: 10034 },
        { filename: 'app://navigation_performance_logger_android', function: 'sendBeforeUnloadMessage', lineno: 1, colno: 13584 },
        { filename: 'app://navigation_performance_logger_android', function: '?', lineno: 1, colno: 18136 },
        { filename: 'app:///_next/static/chunks/pages/_app-bd0af39b225fe452.js', function: 'r', lineno: 2, colno: 4655 },
      ]);
      expect(isInAppBrowserInjectedEvent(event)).toBe(true);
    });

    it('drops the Facebook Android declutter script crash (JAWAB24-FRONTEND-2Y)', () => {
      const event = eventWithFrames(
        [{ filename: 'app://browser_declutter', function: '?', lineno: 41, colno: 40 }],
        'Unexpected end of input',
      );
      expect(isInAppBrowserInjectedEvent(event)).toBe(true);
    });

    it('drops the Instagram iOS logger crash via bridge function name when filenames are the page URL (JAWAB24-FRONTEND-30)', () => {
      // Injected INLINE: every filename is the document, indistinguishable from
      // a first-party frame. Only the function names give it away.
      const event = eventWithFrames([
        { filename: 'app:///en/login', function: 'sendDataToNative', lineno: 1, colno: 1142 },
        { filename: 'app:///en/login', function: 'sendPageHideMessage', lineno: 1, colno: 3712 },
        { filename: 'app:///en/login', function: '?', lineno: 1, colno: 5421 },
      ]);
      expect(isInAppBrowserInjectedEvent(event)).toBe(true);
    });

    it('cannot identify the fully minified Instagram variant from frames alone — the message rule covers it (JAWAB24-FRONTEND-2Z)', () => {
      // Same injected script, minified to one-letter function names. This
      // documents the frame check's known blind spot and pins the division of
      // labour with ignoreErrors.
      const event = eventWithFrames([
        { filename: 'app:///en/login', function: 'T', lineno: 1, colno: 770 },
        { filename: 'app:///en/login', function: 'M', lineno: 1, colno: 2510 },
        { filename: 'app:///en/login', function: '?', lineno: 1, colno: 3759 },
      ]);
      expect(isInAppBrowserInjectedEvent(event)).toBe(false);
      expect(matchesIgnoreErrors("undefined is not an object (evaluating 'window.webkit.messageHandlers')")).toBe(true);
    });
  });

  describe('first-party errors must survive', () => {
    it('keeps an ordinary error from our Next.js chunks', () => {
      const event = eventWithFrames([
        { filename: 'app:///_next/static/chunks/pages/_app-bd0af39b225fe452.js', function: 'handleSubmit', lineno: 2, colno: 4655 },
        { filename: 'app:///_next/static/chunks/main-abc123.js', function: 'onClick', lineno: 1, colno: 900 },
      ]);
      expect(isInAppBrowserInjectedEvent(event)).toBe(false);
    });

    it('keeps an error thrown from an inline script in our own document', () => {
      // Same `app:///en/login` shape as the Instagram inline injection — proof
      // the filename rule is not what catches those.
      const event = eventWithFrames([{ filename: 'app:///en/login', function: 'bootstrapTheme', lineno: 1, colno: 200 }]);
      expect(isInAppBrowserInjectedEvent(event)).toBe(false);
    });

    it('keeps a genuine Capacitor bridge failure that shares the Android error text', () => {
      // The exact risk the config comment flagged: "Java object is gone" is a
      // WebView message our own native bridge could also produce. We key on the
      // injected script, never the message, so ours is still reported.
      const event = eventWithFrames(
        [{ filename: 'app:///_next/static/chunks/capacitor-xyz.js', function: 'postMessage', lineno: 1, colno: 42 }],
        'Error invoking postMessage: Java object is gone',
      );
      expect(isInAppBrowserInjectedEvent(event)).toBe(false);
    });

    it('does not treat our three-slash app:// origin as an injected script', () => {
      const event = eventWithFrames([{ filename: 'app:///_next/static/chunks/framework.js', function: 'render' }]);
      expect(isInAppBrowserInjectedEvent(event)).toBe(false);
    });
  });

  describe('degenerate events', () => {
    it('keeps events with no exception values', () => {
      expect(isInAppBrowserInjectedEvent({})).toBe(false);
      expect(isInAppBrowserInjectedEvent({ exception: { values: [] } })).toBe(false);
    });

    it('keeps events whose exception has no stacktrace', () => {
      expect(isInAppBrowserInjectedEvent({ exception: { values: [{ type: 'Error', value: 'boom' }] } })).toBe(false);
    });

    it('handles frames missing filename and function', () => {
      expect(isInAppBrowserInjectedEvent(eventWithFrames([{}, { lineno: 3 }]))).toBe(false);
    });

    it('scans every exception value, not just the first', () => {
      const event: SentryEvent = {
        exception: {
          values: [
            { type: 'Error', value: 'wrapper', stacktrace: { frames: [{ filename: 'app:///_next/static/chunks/main.js' }] } },
            { type: 'Error', value: 'cause', stacktrace: { frames: [{ filename: 'app://browser_declutter' }] } },
          ],
        },
      };
      expect(isInAppBrowserInjectedEvent(event)).toBe(true);
    });
  });

  describe('IN_APP_BROWSER_SCRIPT_URL (also consumed standalone by denyUrls)', () => {
    it('matches the injected two-slash host form and never our three-slash origin', () => {
      expect(IN_APP_BROWSER_SCRIPT_URL.test('app://browser_declutter')).toBe(true);
      expect(IN_APP_BROWSER_SCRIPT_URL.test('app://navigation_performance_logger_android')).toBe(true);
      expect(IN_APP_BROWSER_SCRIPT_URL.test('app:///_next/static/chunks/main.js')).toBe(false);
      expect(IN_APP_BROWSER_SCRIPT_URL.test('app:///en/login')).toBe(false);
    });

    it('is stateless — no /g flag, since two call sites share this instance', () => {
      // A global regex carries lastIndex between .test() calls, so denyUrls and
      // the frame scan would intermittently disagree on the same filename.
      expect(IN_APP_BROWSER_SCRIPT_URL.global).toBe(false);
      expect(IN_APP_BROWSER_SCRIPT_URL.test('app://browser_declutter')).toBe(true);
      expect(IN_APP_BROWSER_SCRIPT_URL.test('app://browser_declutter')).toBe(true);
    });
  });

  describe('IN_APP_BROWSER_MESSAGE_PATTERNS', () => {
    it('does not match unrelated webkit mentions', () => {
      expect(matchesIgnoreErrors('window.webkit is undefined')).toBe(false);
      expect(matchesIgnoreErrors('Cannot read properties of undefined')).toBe(false);
    });
  });
});
