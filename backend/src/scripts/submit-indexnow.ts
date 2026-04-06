#!/usr/bin/env npx tsx
/**
 * One-shot script to submit all public jawab24.com URLs to IndexNow.
 *
 * Run from the backend directory:
 *   npx tsx src/scripts/submit-indexnow.ts
 *
 * Or submit specific URLs:
 *   npx tsx src/scripts/submit-indexnow.ts https://jawab24.com/en/blog/my-post
 *
 * IMPORTANT: The key verification file must be deployed first:
 *   https://jawab24.com/d073137a2fccfe02f0a8a88ec96e3400.txt
 */

import { submitToIndexNow, INDEXNOW_KEY, INDEXNOW_KEY_LOCATION } from '../utils/indexnow';

// All public URLs from the sitemap (both AR and EN versions)
const ALL_PUBLIC_URLS = [
  // Homepage
  'https://jawab24.com/',
  'https://jawab24.com/en',
  // Core pages
  'https://jawab24.com/pricing',
  'https://jawab24.com/en/pricing',
  'https://jawab24.com/what-is-jawab24',
  'https://jawab24.com/en/what-is-jawab24',
  'https://jawab24.com/contact',
  'https://jawab24.com/en/contact',
  // Comparison pages
  'https://jawab24.com/en/compare/manychat',
  'https://jawab24.com/en/compare/chatfuel',
  'https://jawab24.com/en/compare/tidio',
  'https://jawab24.com/en/compare/botpress',
  // Blog index
  'https://jawab24.com/blog',
  'https://jawab24.com/en/blog',
  // Blog posts (EN)
  'https://jawab24.com/en/blog/social-commerce-ai-customer-service-statistics-2026',
  'https://jawab24.com/en/blog/instagram-facebook-dm-selling-statistics-2026',
  'https://jawab24.com/en/blog/auto-reply-facebook-setup-guide',
  'https://jawab24.com/en/blog/instagram-auto-reply-guide',
  'https://jawab24.com/en/blog/best-auto-reply-tools-2026',
  'https://jawab24.com/en/blog/salla-store-facebook-auto-reply',
  'https://jawab24.com/en/blog/shopify-facebook-auto-reply-arabic',
  'https://jawab24.com/en/blog/jawab24-setup-tutorial',
  'https://jawab24.com/en/blog/reduce-facebook-response-time',
  'https://jawab24.com/en/blog/salla-vs-shopify-arabic-sellers',
  'https://jawab24.com/en/blog/ai-auto-reply-angry-customers',
  'https://jawab24.com/en/blog/common-facebook-auto-reply-mistakes',
  // Blog posts (AR)
  'https://jawab24.com/blog/social-commerce-ai-customer-service-statistics-2026',
  'https://jawab24.com/blog/instagram-facebook-dm-selling-statistics-2026',
  'https://jawab24.com/blog/auto-reply-facebook-setup-guide',
  'https://jawab24.com/blog/instagram-auto-reply-guide',
  'https://jawab24.com/blog/best-auto-reply-tools-2026',
  'https://jawab24.com/blog/salla-store-facebook-auto-reply',
  'https://jawab24.com/blog/shopify-facebook-auto-reply-arabic',
  'https://jawab24.com/blog/jawab24-setup-tutorial',
  'https://jawab24.com/blog/reduce-facebook-response-time',
  'https://jawab24.com/blog/salla-vs-shopify-arabic-sellers',
  'https://jawab24.com/blog/ai-auto-reply-angry-customers',
  'https://jawab24.com/blog/common-facebook-auto-reply-mistakes',
];

async function main() {
  const customUrls = process.argv.slice(2);
  const urls = customUrls.length > 0 ? customUrls : ALL_PUBLIC_URLS;

  console.log('=== IndexNow URL Submission ===');
  console.log(`Key: ${INDEXNOW_KEY}`);
  console.log(`Key location: ${INDEXNOW_KEY_LOCATION}`);
  console.log(`URLs to submit: ${urls.length}`);
  console.log('');

  const result = await submitToIndexNow(urls);

  if (result.success) {
    console.log(`✅ ${result.message}`);
    console.log(`   Status: ${result.status}`);
    console.log(`   URLs submitted: ${result.urlCount}`);
  } else {
    console.error(`❌ ${result.message}`);
    console.error(`   Status: ${result.status}`);
    if (result.status === 403) {
      console.error('');
      console.error('   ⚠️  Make sure the key file is deployed at:');
      console.error(`   ${INDEXNOW_KEY_LOCATION}`);
      console.error('   Deploy the frontend first, then re-run this script.');
    }
  }

  console.log('');
  console.log('Submitted URLs:');
  urls.forEach((url, i) => console.log(`  ${i + 1}. ${url}`));
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
