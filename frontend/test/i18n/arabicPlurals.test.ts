/**
 * Every six-form Arabic plural must actually PARSE and FORMAT.
 *
 * Why this file exists, and why it is generic rather than per-namespace:
 *
 * The component suites mock `next-intl` and resolve EN messages with ENGLISH
 * plural rules, so an Arabic `two {}` / `few {}` / `many {}` branch is never
 * executed by them. A malformed branch therefore throws at RENDER — in
 * production, in Arabic only, on the one screen that formats it.
 *
 * A guard for exactly this used to live in PostSuggestionCard.test.tsx, aimed at
 * a single string (`postSuggestions.remaining`). That string is gone (the count
 * moved onto the create button as a bare parenthesised number, which needs no
 * plural), and deleting its test would have quietly ended the coverage. But the
 * guard was only ever covering ONE of the 20 namespaces that carry six-form
 * plurals — the other 19 were never protected at all.
 *
 * So this replaces it with the check that should have existed: discover every
 * Arabic plural message across every namespace and format each one through the
 * REAL translator, at every CLDR category boundary Arabic distinguishes.
 *
 * `import.meta.glob` (eager) is deliberate — it auto-discovers new namespaces,
 * so a file added later is covered without anyone remembering this test.
 */
import { describe, it, expect, vi } from 'vitest';

/** Counts that land on each Arabic CLDR category: zero, one, two, few, many, other. */
const CLDR_PROBES = [0, 1, 2, 3, 11, 100];

const modules = import.meta.glob('../../src/i18n/ar/*.json', { eager: true }) as
  Record<string, { default: Record<string, unknown> }>;

/** Flatten one level of nesting — the namespaces are flat or 1-level by policy. */
function flatten(obj: Record<string, unknown>, prefix = ''): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (typeof v === 'string') out.push([key, v]);
    else if (v && typeof v === 'object') out.push(...flatten(v as Record<string, unknown>, key));
  }
  return out;
}

/**
 * Every `{x, plural, …}` message, as [namespace, key, variableName].
 *
 * The VARIABLE NAME is extracted rather than assumed: these messages do not all
 * use `count` (`{days, plural, …}`, `{n, plural, …}` and others exist), and
 * passing the wrong name makes next-intl throw for a missing value — which
 * would look exactly like a malformed plural and make this guard cry wolf on
 * ~97 healthy strings. It did, on the first run.
 */
const PLURAL_VAR = /\{\s*(\w+)\s*,\s*plural\s*,/;
const pluralMessages: Array<[string, string, string]> = Object.entries(modules).flatMap(
  ([path, mod]) => {
    const namespace = path.split('/').pop()!.replace('.json', '');
    return flatten(mod.default)
      .map(([key, value]) => [key, value.match(PLURAL_VAR)?.[1]] as const)
      .filter((pair): pair is readonly [string, string] => Boolean(pair[1]))
      .map(([key, variable]) => [namespace, key, variable] as [string, string, string]);
  },
);

describe('Arabic plural messages parse and format at every CLDR boundary', () => {
  it('found plural messages to check (the glob is wired)', () => {
    // Guards the guard: a broken glob would make every case below vacuous.
    expect(pluralMessages.length).toBeGreaterThan(0);
  });

  it.each(pluralMessages)('%s.%s formats for zero/one/two/few/many/other', async (namespace, key, variable) => {
    // The suite mocks `next-intl` globally, so the mock has no
    // `createTranslator` — and a mocked translator would defeat the entire
    // point, since it is ENGLISH plural rules that hide the Arabic branches.
    // importActual is the only way to exercise the real ICU formatter.
    const { createTranslator } = await vi.importActual<typeof import('next-intl')>('next-intl');
    const t = createTranslator({
      locale: 'ar',
      messages: { [namespace]: modules[`../../src/i18n/ar/${namespace}.json`].default },
      namespace,
    });

    for (const count of CLDR_PROBES) {
      // The assertion is that formatting DOES NOT THROW and yields a string.
      //
      // Deliberately not `toBeTruthy()`: an EMPTY branch can be correct. Both
      // `leads.newLeadsBadge` and `catalog.cleanup.intro` define `zero {}` on
      // purpose — a badge renders nothing at zero — and asserting truthiness
      // failed them on the first run. The failure mode this guards is a
      // malformed branch throwing at render, in Arabic only; emptiness is a
      // design choice the guard has no business overruling.
      const formatted = t(key, { [variable]: count });
      expect(typeof formatted, `${namespace}.${key} @ ${variable}=${count}`).toBe('string');
    }
  });
});
