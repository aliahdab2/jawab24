#!/usr/bin/env node

/**
 * One-time script: splits en.json / ar.json into per-namespace files.
 *
 * Input:  frontend/src/i18n/en.json, frontend/src/i18n/ar.json
 * Output: frontend/src/i18n/en/*.json, frontend/src/i18n/ar/*.json
 *
 * Usage: node scripts/split-translations.js
 */

const fs = require('fs');
const path = require('path');

const I18N_DIR = path.join(__dirname, '..', 'src', 'i18n');

for (const lang of ['en', 'ar']) {
  const srcFile = path.join(I18N_DIR, `${lang}.json`);
  const outDir = path.join(I18N_DIR, lang);

  const data = JSON.parse(fs.readFileSync(srcFile, 'utf-8'));

  // Create output directory
  fs.mkdirSync(outDir, { recursive: true });

  const namespaces = Object.keys(data);
  for (const ns of namespaces) {
    const outFile = path.join(outDir, `${ns}.json`);
    fs.writeFileSync(outFile, JSON.stringify(data[ns], null, 2) + '\n', 'utf-8');
  }

  console.log(`${lang}: split ${namespaces.length} namespaces into ${outDir}/`);
}

console.log('Done.');
