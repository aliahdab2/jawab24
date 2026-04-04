/* eslint-disable @typescript-eslint/no-require-imports */
/**
 * Strips web-only pages and assets from the mobile build output (out/).
 * Run after `build:mobile` and before `cap sync` to reduce AAB/APK size.
 * These pages are SEO/marketing content that mobile users access via the website.
 */
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const outDir = path.join(__dirname, '..', 'out');

if (!fs.existsSync(outDir)) {
  console.error('out/ directory not found. Run build:mobile first.');
  process.exit(1);
}

// Directories that only serve web/SEO purposes
const webOnlyDirs = ['blog', 'compare', 'integrations', 'apk'];

// Large images used only on web landing/marketing pages
const webOnlyFiles = [
  'brand/logo-large.png',
  'brand/app-icon.png',
  'images/social-icons-3d.png',
];

// HTML pages not needed in mobile (users see native app screens, not these)
// NOTE: privacy.html and terms.html are kept — login page links to them internally
const webOnlyHtml = ['blog.html', 'what-is-jawab24.html'];

console.log('Stripping web-only assets from mobile build...');
let saved = 0;

for (const dir of webOnlyDirs) {
  const dirPath = path.join(outDir, dir);
  if (fs.existsSync(dirPath)) {
    const size = execSync(`du -sk "${dirPath}"`).toString().split('\t')[0];
    saved += parseInt(size, 10);
    fs.rmSync(dirPath, { recursive: true });
    console.log(`  Removed ${dir}/ (${size}KB)`);
  }
}

for (const file of webOnlyFiles) {
  const filePath = path.join(outDir, file);
  if (fs.existsSync(filePath)) {
    const sizeKB = Math.round(fs.statSync(filePath).size / 1024);
    saved += sizeKB;
    fs.unlinkSync(filePath);
    console.log(`  Removed ${file} (${sizeKB}KB)`);
  }
}

for (const htmlFile of webOnlyHtml) {
  const htmlPath = path.join(outDir, htmlFile);
  if (fs.existsSync(htmlPath)) {
    const sizeKB = Math.round(fs.statSync(htmlPath).size / 1024);
    saved += sizeKB;
    fs.unlinkSync(htmlPath);
    console.log(`  Removed ${htmlFile} (${sizeKB}KB)`);
  }
}

console.log(`Stripped ${Math.round(saved / 1024 * 10) / 10}MB of web-only assets from mobile build.`);
