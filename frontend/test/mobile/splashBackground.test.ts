import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { inflateSync, constants } from 'node:zlib';
import path from 'node:path';

/**
 * The launch/splash background must be a FIXED dark brand color on every
 * platform and in every asset that can produce one.
 *
 * History (2026-08-16): on Android the splash resolved `@color/splash_background`
 * from `values-night/`, i.e. from the PHONE's system theme. But the app's theme
 * is a stored user preference (light / dark / system — see `hooks/useTheme.ts`),
 * and the launch theme is resolved before any JS runs, so it can never know that
 * preference. A merchant on a light phone who had picked dark in-app got a white
 * splash in front of a dark app, reported from a real device (#782).
 *
 * A single fixed brand background is the only value correct for every
 * combination of (system theme x in-app preference). These assertions exist
 * because the regression is invisible in code review — it comes back by ADDING
 * or REGENERATING a file, not by editing one, and `npx @capacitor/assets
 * generate` rewrites the whole splash set from `frontend/assets/splash.png`.
 */

const frontend = path.resolve(__dirname, '../..');
const androidRes = path.join(frontend, 'android/app/src/main/res');
const SPLASH_COLOR = '#060D18';

/** Every `values*` dir that could override a color for a given configuration. */
function valuesDirs(): string[] {
  return readdirSync(androidRes).filter((d) => d.startsWith('values'));
}

function readRes(relative: string): string {
  return readFileSync(path.join(androidRes, relative), 'utf-8');
}

/**
 * Top-left pixel of a PNG as #RRGGBB — the splash canvas color, since the icon
 * sits in the middle.
 *
 * Only the first pixel of row 0 is needed, and for that pixel EVERY filter type
 * reduces to the stored byte: the left neighbour and the entire previous row are
 * defined as zero, so Sub/Up/Average/Paeth all add 0. That means inflating just
 * the first IDAT chunk (with Z_SYNC_FLUSH, which tolerates the truncated stream)
 * is enough — no need to decompress 30MB of pixels to read four bytes.
 */
function pngCanvasHex(file: string): string {
  const buf = readFileSync(file);
  const bitDepth = buf[24];
  const colorType = buf[25];
  expect(bitDepth, `${path.basename(file)} bit depth`).toBe(8);
  expect([2, 6], `${path.basename(file)} color type`).toContain(colorType);

  let offset = 8;
  let firstIdat: Buffer | null = null;
  while (offset < buf.length && !firstIdat) {
    const length = buf.readUInt32BE(offset);
    if (buf.toString('ascii', offset + 4, offset + 8) === 'IDAT') {
      firstIdat = buf.subarray(offset + 8, offset + 8 + length);
    }
    offset += 12 + length;
  }
  expect(firstIdat, `${path.basename(file)} has an IDAT chunk`).not.toBeNull();

  const raw = inflateSync(firstIdat!, { finishFlush: constants.Z_SYNC_FLUSH });
  expect(raw.length, `${path.basename(file)} decoded bytes`).toBeGreaterThanOrEqual(4);

  // raw[0] is the row filter byte; the pixel follows.
  const hex = (n: number) => n.toString(16).padStart(2, '0');
  return `#${hex(raw[1])}${hex(raw[2])}${hex(raw[3])}`.toUpperCase();
}

describe('Android splash — fixed dark background', () => {
  it('defines splash_background as the dark brand color in the default config', () => {
    const colors = readRes('values/colors.xml');
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
    expect(readRes('values-v31/styles.xml'), 'API 31+ system splash')
      .toMatch(/android:windowSplashScreenBackground">@color\/splash_background</);
    expect(readRes('values/styles.xml'), 'post-splash window background')
      .toMatch(/android:windowBackground">@color\/splash_background</);
    expect(readRes('drawable/splash_screen.xml'), 'pre-31 layer-list / Capacitor fallback')
      .toMatch(/android:drawable="@color\/splash_background"/);
  });

  it('keeps capacitor.config.ts SplashScreen.backgroundColor in step', () => {
    // The Capacitor plugin paints this color on any manual SplashScreen.show()
    // and on the pre-12 fallback path, so a mismatch here is a visible flash.
    const config = readFileSync(path.join(frontend, 'capacitor.config.ts'), 'utf-8');
    const match = config.match(/backgroundColor:\s*'(#[0-9A-Fa-f]{6,8})'/);

    expect(match, 'capacitor.config.ts must set SplashScreen.backgroundColor').not.toBeNull();
    expect(match![1].toUpperCase()).toBe(SPLASH_COLOR);
  });
});

describe('iOS splash — fixed dark background', () => {
  const storyboard = path.join(frontend, 'ios/App/App/Base.lproj/LaunchScreen.storyboard');
  const imageset = path.join(frontend, 'ios/App/App/Assets.xcassets/Splash.imageset');

  it('does not let the launch background follow the system appearance', () => {
    // `systemColor="systemBackgroundColor"` resolves to white in light mode and
    // black in dark mode. It is covered today by an opaque scaleAspectFill image,
    // so it is latent rather than visible — but any change to the image or the
    // content mode uncovers the same white launch screen that #782 fixed.
    const xml = readFileSync(storyboard, 'utf-8');

    expect(xml, 'LaunchScreen must not use a system (theme-following) color')
      .not.toMatch(/key="backgroundColor"[^>]*systemColor=/);
  });

  it('pins the launch background to the brand color', () => {
    const xml = readFileSync(storyboard, 'utf-8');
    const match = xml.match(
      /key="backgroundColor"\s+red="([\d.]+)"\s+green="([\d.]+)"\s+blue="([\d.]+)"/,
    );
    expect(match, 'LaunchScreen must set an explicit rgb backgroundColor').not.toBeNull();

    const hex = (v: string) => Math.round(parseFloat(v) * 255).toString(16).padStart(2, '0');
    expect(`#${hex(match![1])}${hex(match![2])}${hex(match![3])}`.toUpperCase()).toBe(SPLASH_COLOR);
  });

  it('ships a splash image whose canvas is the brand color, at every scale', () => {
    const files = readdirSync(imageset).filter((f) => f.endsWith('.png'));
    expect(files.length, 'Splash.imageset must contain PNGs').toBeGreaterThan(0);

    for (const file of files) {
      expect(pngCanvasHex(path.join(imageset, file)), `${file} canvas`).toBe(SPLASH_COLOR);
    }
  });
});

describe('splash generator source', () => {
  it('matches what ships, so regenerating assets cannot flip the splash light', () => {
    // `npx @capacitor/assets generate` rebuilds the whole splash set from this
    // file. It used to be a 512x512 icon on WHITE — regenerating would have
    // silently undone #782 on both platforms and dropped the resolution.
    const source = path.join(frontend, 'assets/splash.png');
    expect(existsSync(source), 'frontend/assets/splash.png must exist').toBe(true);
    expect(pngCanvasHex(source), 'generator source canvas').toBe(SPLASH_COLOR);
  });

  it('has no splash-dark source, which would regenerate a night variant', () => {
    // A dark source makes the generator emit drawable-night/ + values-night/,
    // reintroducing exactly the system-theme dependency this suite forbids.
    expect(existsSync(path.join(frontend, 'assets/splash-dark.png'))).toBe(false);
  });
});
