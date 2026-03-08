#!/usr/bin/env node

/**
 * Translation Validation Script for Jawab24
 *
 * Checks:
 *  1. Key sync   — EN keys missing from AR and vice versa
 *  2. Language    — Arabic chars in EN values; Latin-only text in AR values
 *  3. Empty vals  — keys with "" value
 *
 * Usage:  node scripts/validate-translations.js
 * Exit:   0 = pass, 1 = errors found
 */

const fs = require('fs');
const path = require('path');

// ── Load files ──────────────────────────────────────────────────────────────

const I18N_DIR = path.join(__dirname, '..', 'src', 'i18n');

function loadJSON(filePath) {
  const raw = fs.readFileSync(filePath, 'utf-8');
  return JSON.parse(raw);
}

const en = loadJSON(path.join(I18N_DIR, 'en.json'));
const ar = loadJSON(path.join(I18N_DIR, 'ar.json'));

const enKeys = Object.keys(en);
const arKeys = Object.keys(ar);

// ── Helpers ─────────────────────────────────────────────────────────────────

const ARABIC_RE = /[\u0600-\u06FF\u0750-\u077F\uFB50-\uFDFF\uFE70-\uFEFF]/;

// Brand terms, technical strings, and patterns that are OK to leave in Latin in AR
const BRAND_TERMS = [
  'Jawab24', 'jawab24', 'Facebook', 'Instagram', 'WhatsApp', 'Stripe',
  'OpenAI', 'Meta', 'Regex', 'CSV', 'DELETE', 'API', 'AI',
  'Enskild Näringsverksamhet', 'Bergavägen', 'Eslöv', 'Sweden',
];

function isLikelyBrandOrTechnical(value) {
  // Remove known brand terms and see if anything Latin remains
  let cleaned = value;
  for (const term of BRAND_TERMS) {
    cleaned = cleaned.split(term).join('');
  }
  // Remove URLs, emails, numbers, punctuation, whitespace, placeholders, ICU syntax
  cleaned = cleaned
    .replace(/https?:\/\/\S+/g, '')           // URLs
    .replace(/\S+@\S+\.\S+/g, '')             // emails
    .replace(/\{[^}]+\}/g, '')                 // {placeholders} and ICU {count, plural, ...}
    .replace(/\{\{[^}]+\}\}/g, '')             // {{placeholders}}
    .replace(/\b(plural|select|one|two|few|many|other|zero|count|number)\b/g, '') // ICU keywords
    .replace(/#/g, '')                         // ICU # (number placeholder)
    .replace(/[0-9.,/:;!?@#$%^&*()_+=\-\[\]{}|\\<>"'`~\n\r\t ]+/g, '') // numbers + punctuation + whitespace
    .replace(/[\u2705\u23F0\u26A0\uFE0F\u{1F514}\u{1F4AC}\u{1F4B3}\u{1F50C}\u{1F389}\u{1F60E}]/gu, ''); // emojis

  // If nothing Latin remains, it's brand/technical
  return cleaned.length === 0;
}

// ── Check 1: Key Sync ──────────────────────────────────────────────────────

const enSet = new Set(enKeys);
const arSet = new Set(arKeys);

const missingInAR = enKeys.filter(k => !arSet.has(k));
const missingInEN = arKeys.filter(k => !enSet.has(k));

// ── Check 2: Language Integrity ─────────────────────────────────────────────

// Keys that intentionally contain mixed-language content
const BILINGUAL_KEYS = new Set([
  // Language switch button shows the OTHER language's name
  'common.switchLanguage',
  // Language labels always display in their native script
  'common.langArabic',
  'common.langEnglish',
  // Arabic placeholder examples shown in EN UI
  'templates.arabicPlaceholder',
  // Mixed-language keyword examples
  'templates.keywordsPlaceholder',
  'rules.keywordsPlaceholder',
  // SEO keys intentionally include Arabic brand name "جواب"
  'landing.seoTitle',
  'landing.seoDescription',
  'landing.seoKeywords',
  // EN placeholder example shown in AR UI
  'templates.englishPlaceholder',
]);

const arabicInEN = [];
for (const key of enKeys) {
  if (BILINGUAL_KEYS.has(key)) continue;
  if (ARABIC_RE.test(en[key])) {
    arabicInEN.push({ key, value: en[key] });
  }
}

const untranslatedInAR = [];
for (const key of arKeys) {
  if (BILINGUAL_KEYS.has(key)) continue;
  const value = ar[key];
  if (typeof value !== 'string' || value.length === 0) continue;
  if (!ARABIC_RE.test(value) && !isLikelyBrandOrTechnical(value)) {
    untranslatedInAR.push({ key, value });
  }
}

// ── Check 3: Empty Values ───────────────────────────────────────────────────

const emptyEN = enKeys.filter(k => en[k] === '');
const emptyAR = arKeys.filter(k => ar[k] === '');

// ── Output ──────────────────────────────────────────────────────────────────

let hasErrors = false;

console.log('');
console.log('Translation Validation');
console.log('══════════════════════════════════════════');
console.log(`EN: ${enKeys.length} keys  |  AR: ${arKeys.length} keys`);
console.log('');

// Key Sync
console.log('Key Sync');
if (missingInAR.length > 0) {
  hasErrors = true;
  console.log(`  ❌ ${missingInAR.length} key(s) in EN missing from AR:`);
  missingInAR.forEach(k => console.log(`     - ${k}`));
} else {
  console.log('  ✅ All EN keys exist in AR');
}

if (missingInEN.length > 0) {
  hasErrors = true;
  console.log(`  ❌ ${missingInEN.length} key(s) in AR missing from EN:`);
  missingInEN.forEach(k => console.log(`     - ${k}`));
} else {
  console.log('  ✅ All AR keys exist in EN');
}
console.log('');

// Language Integrity
console.log('Language Integrity');
if (arabicInEN.length > 0) {
  hasErrors = true;
  console.log(`  ❌ ${arabicInEN.length} EN value(s) contain Arabic text:`);
  arabicInEN.forEach(({ key, value }) =>
    console.log(`     - ${key}: "${value.substring(0, 60)}${value.length > 60 ? '...' : ''}"`)
  );
} else {
  console.log('  ✅ No Arabic text in EN');
}

if (untranslatedInAR.length > 0) {
  console.log(`  ⚠️  ${untranslatedInAR.length} AR value(s) may be untranslated (Latin-only):`);
  untranslatedInAR.forEach(({ key, value }) =>
    console.log(`     - ${key}: "${value.substring(0, 60)}${value.length > 60 ? '...' : ''}"`)
  );
} else {
  console.log('  ✅ All AR values contain Arabic text');
}
console.log('');

// Empty Values
console.log('Empty Values');
if (emptyEN.length > 0 || emptyAR.length > 0) {
  if (emptyEN.length > 0) {
    console.log(`  ⚠️  ${emptyEN.length} empty EN value(s):`);
    emptyEN.forEach(k => console.log(`     - ${k}`));
  }
  if (emptyAR.length > 0) {
    console.log(`  ⚠️  ${emptyAR.length} empty AR value(s):`);
    emptyAR.forEach(k => console.log(`     - ${k}`));
  }
} else {
  console.log('  ✅ No empty values');
}
console.log('');

// Result
console.log('══════════════════════════════════════════');
if (hasErrors) {
  const errorCount = missingInAR.length + missingInEN.length + arabicInEN.length;
  console.log(`Result: ❌ FAIL (${errorCount} error(s))`);
  console.log('');
  process.exit(1);
} else {
  console.log('Result: ✅ PASS');
  console.log('');
  process.exit(0);
}
