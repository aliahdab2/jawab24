import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * The hero phone mockup plays a scripted conversation. Two defects made the
 * typing dots and the reply share the column — both are `justify-end`, so they
 * read as one overlapping blob on the right edge.
 *
 *  1. Two independently-conditional children sat inside one
 *     `<AnimatePresence mode="wait">`, and the first was unkeyed.
 *     `HeroTypingDots` did carry `key="hero-dots"` — but on the `motion.div`
 *     INSIDE the component, which AnimatePresence never sees; it only reads the
 *     keys of its own direct children. With two slots and one unkeyed, `wait`
 *     held the exiting dots at slot 0 while mounting the reply at slot 1.
 *
 *  2. The blank step that restarts the loop was shorter than the exit
 *     animation, so a new cycle began while the old bubbles were still leaving.
 *
 * Both are structural, so they are pinned structurally: the source must make a
 * second simultaneous child impossible, rather than merely not produce one.
 *
 * Mutation check: split either ternary back into two `&&` siblings, move the
 * key back inside HeroTypingDots, or drop the blank delay to 100 — each fails a
 * named test below.
 */

const src = readFileSync(
  resolve(__dirname, '../../../components/landing/LandingHero.tsx'),
  'utf-8',
);

/** Every `<AnimatePresence mode="wait">…</AnimatePresence>` block. */
const waitBlocks = (() => {
  const out: string[] = [];
  const re = /<AnimatePresence mode="wait"[^>]*>/g;
  for (let m = re.exec(src); m; m = re.exec(src)) {
    const end = src.indexOf('</AnimatePresence>', m.index);
    expect(end).toBeGreaterThan(-1);
    out.push(src.slice(m.index, end));
  }
  return out;
})();

describe('hero chat: only one child can occupy a wait-mode slot', () => {
  it('has the two wait-mode blocks the sequence needs', () => {
    expect(waitBlocks).toHaveLength(2);
  });

  it('renders each block as a single ternary, never two sibling conditionals', () => {
    for (const block of waitBlocks) {
      // `{cond && <X />}{cond2 && <Y />}` is the shape that gave AnimatePresence
      // two slots. A ternary can only ever yield one child.
      expect(block, 'a `&&` conditional child reintroduces the second slot')
        .not.toMatch(/\{\s*(?:phase|show)[^}]*&&/);
      expect(block).toMatch(/\?\s*\(/);
      expect(block).toMatch(/\)\s*:\s*(?:show|null)/);
    }
  });

  it('keys every branch, at the call site where AnimatePresence can see it', () => {
    for (const block of waitBlocks) {
      const branches = block.match(/<(?:HeroTypingDots|motion\.div)\b/g) ?? [];
      const keys = block.match(/\bkey="[^"]+"/g) ?? [];
      expect(branches.length).toBeGreaterThanOrEqual(2);
      expect(keys.length, 'every branch needs its own key').toBe(branches.length);
    }
  });

  it('gives the two dots instances distinct keys', () => {
    const dotsKeys = [...src.matchAll(/<HeroTypingDots\s+key="([^"]+)"/g)].map((m) => m[1]);
    expect(dotsKeys).toHaveLength(2);
    expect(new Set(dotsKeys).size).toBe(2);
  });

  it('keeps the presence key OUT of HeroTypingDots itself', () => {
    // A key on the inner motion.div looks like presence is handled and is
    // exactly what hid the original bug.
    const body = src.slice(
      src.indexOf('function HeroTypingDots'),
      src.indexOf('function ', src.indexOf('function HeroTypingDots') + 1),
    );
    expect(body).not.toMatch(/\bkey="hero-dots"/);
  });

  it('keeps mode="wait" — without it the dots and reply cross-fade together', () => {
    expect(waitBlocks).toHaveLength(2);
  });
});

describe('hero chat: the restart outlasts the exit it is waiting on', () => {
  it('blanks for longer than heroFadeSlide.exit takes to run', () => {
    const exitMs = (() => {
      const m = src.match(/exit:\s*\{[^}]*transition:\s*\{\s*duration:\s*([\d.]+)/);
      expect(m, 'heroFadeSlide.exit duration not found').toBeTruthy();
      return parseFloat(m![1]) * 1000;
    })();

    const blankMs = (() => {
      const m = src.match(/\[\s*(\d+)\s*,\s*'blank'\s*\]/);
      expect(m, "the 'blank' step was not found").toBeTruthy();
      return parseInt(m![1], 10);
    })();

    expect(exitMs).toBeGreaterThan(0);
    // Restarting mid-exit re-mounts `hc1` under a key that is still leaving,
    // while the container snaps back to opacity 1 with duration 0.
    expect(blankMs).toBeGreaterThan(exitMs);
  });
});
