import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import path from 'node:path';

/**
 * Android launch/splash background must be a FIXED dark brand color.
 *
 * History (2026-08-16): the splash resolved `@color/splash_background` from
 * `values-night/`, i.e. from the PHONE's system theme. But the app's theme is a
 * stored user preference (light / dark / system — see `hooks/useTheme.ts`), and
 * Android resolves the launch theme before any JS runs, so it can never know
 * that preference. A merchant on a light phone who had picked dark in-app got a
 * white splash in front of a dark app, reported from a real device.
 *
 * A single fixed brand background is the only value correct for every
 * combination of (system theme x in-app preference). These assertions exist
 * because the regression is invisible in code review — it comes back by ADDING
 * a file (`values-night/colors.xml`), not by editing one, and
 * `npx @capacitor/assets generate` re-creates exactly that file.
 */

const androidRes = path.resolve(__dirname, '../../android/app/src/main/res');
const SPLASH_COLOR = '#060D18';

/** Every `values*` dir that could override a color for a given configuration. */
function valuesDirs(): string[] {
  return readdirSync(androidRes).filter((d) => d.startsWith('values'));
}

function read(relative: string): string {
  return readFileSync(path.join(androidRes, relative), 'utf-8');
}

describe('Android splash — fixed dark background', () => {
  it('defines splash_background as the dark brand color in the default config', () => {
    const colors = read('values/colors.xml');
    const match = colors.match(/<color name="splash_background">(#[0-9A-Fa-f]{6,8})<\/color>/);

    expect(match, 'values/colors.xml must define splash_background').not.toBeNull();
    expect(match![1].toUpperCase()).toBe(SPLASH_COLOR);
  });

  it('has NO qualified values-* variant redefining splash_background', () => {
    // -night is the one that caused the bug, but any qualifier (-v31, -ar, a
    // future -land) reintroduces the same class of defect: a splash whose color
    // depends on device state the app's stored theme preference cannot control.
    const offenders = valuesDirs()
      .filter((dir) => dir !== 'values')
      .filter((dir) => {
        const file = path.join(androidRes, dir, 'colors.xml');
        return existsSync(file) && readFileSync(file, 'utf-8').includes('name="splash_background"');
      });

    expect(
      offenders,
      `splash_background must be fixed; these configs override it: ${offenders.join(', ')}`,
    ).toEqual([]);
  });

  it('routes all three launch surfaces through the same color', () => {
    // If any one of these drifts, a merchant sees a flash of the wrong color at
    // some point in the launch sequence rather than one continuous background.
    expect(read('values-v31/styles.xml'), 'API 31+ system splash')
      .toMatch(/android:windowSplashScreenBackground">@color\/splash_background</);
    expect(read('values/styles.xml'), 'post-splash window background')
      .toMatch(/android:windowBackground">@color\/splash_background</);
    expect(read('drawable/splash_screen.xml'), 'pre-31 layer-list / Capacitor fallback')
      .toMatch(/android:drawable="@color\/splash_background"/);
  });

  it('keeps capacitor.config.ts SplashScreen.backgroundColor in step', () => {
    // The Capacitor plugin paints this color on any manual SplashScreen.show()
    // and on the pre-12 fallback path, so a mismatch here is a visible flash.
    const config = readFileSync(path.resolve(__dirname, '../../capacitor.config.ts'), 'utf-8');
    const match = config.match(/backgroundColor:\s*'(#[0-9A-Fa-f]{6,8})'/);

    expect(match, 'capacitor.config.ts must set SplashScreen.backgroundColor').not.toBeNull();
    expect(match![1].toUpperCase()).toBe(SPLASH_COLOR);
  });
});
