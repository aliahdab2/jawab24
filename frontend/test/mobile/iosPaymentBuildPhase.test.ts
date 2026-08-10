/**
 * Wiring invariant: the Xcode target must run the Guideline 3.1.1 verification
 * phase, and that phase must be able to fail a Release build.
 *
 * WHY. `neutralize-ios-payment-routes.js` is wired into `build:ios:sync`, but
 * nothing forces anyone to use it — the recipe in the launch notes, and the one
 * actually used to produce build 7, is `npm run build:mobile && npx cap sync
 * ios`, which skips it. The build phase is what makes the protection
 * unbypassable, so losing it silently would return us to a guard that depends
 * on remembering the right command. A regenerated `project.pbxproj` (a Capacitor
 * upgrade, an Xcode migration) is the realistic way that happens.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const iosDir = path.join(__dirname, '..', '..', 'ios', 'App');
const pbxproj = fs.readFileSync(path.join(iosDir, 'App.xcodeproj', 'project.pbxproj'), 'utf8');
const verifyScriptPath = path.join(iosDir, 'Scripts', 'verify-payment-routes-neutralized.sh');

describe('iOS payment-route verification build phase (Guideline 3.1.1)', () => {
    it('ships the verification script', () => {
        expect(fs.existsSync(verifyScriptPath)).toBe(true);
    });

    it('keeps the script executable', () => {
        // Xcode invokes it directly; a non-executable file fails at build time
        // with a confusing permission error.
        expect(fs.statSync(verifyScriptPath).mode & 0o111).toBeGreaterThan(0);
    });

    it('declares the phase and attaches it to the target', () => {
        const phaseId = pbxproj.match(
            /([0-9A-F]{24}) \/\* Verify payment routes neutralized \(3\.1\.1\) \*\/ = \{/,
        )?.[1];
        expect(phaseId, 'phase is not declared in PBXShellScriptBuildPhase').toBeTruthy();

        // Referenced from buildPhases, not merely defined — an orphan phase
        // never runs.
        const references = pbxproj.split(`${phaseId} /* Verify payment routes neutralized (3.1.1) */`).length - 1;
        expect(references, 'phase is declared but not listed in buildPhases').toBeGreaterThanOrEqual(2);
    });

    it('invokes the verification script from the phase', () => {
        expect(pbxproj).toMatch(/shellScript = "\\"\$\{SRCROOT\}\/Scripts\/verify-payment-routes-neutralized\.sh\\"/);
    });

    it('runs on every build rather than being cached away', () => {
        // Without alwaysOutOfDate Xcode may skip the phase when nothing it
        // declares as input changed — and it declares none, because the thing
        // it guards is copied by another phase.
        const phaseBlock = pbxproj.match(
            /\/\* Verify payment routes neutralized \(3\.1\.1\) \*\/ = \{[\s\S]*?\};/,
        )?.[0] ?? '';
        expect(phaseBlock).toMatch(/alwaysOutOfDate = 1/);
    });

    it('fails the build in Release rather than only warning', () => {
        const script = fs.readFileSync(verifyScriptPath, 'utf8');
        expect(script).toMatch(/CONFIGURATION.*=.*"?Release"?/);
        expect(script).toMatch(/exit 1/);
    });
});
