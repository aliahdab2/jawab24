import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { HEALTH_FLAG_KEYS } from '../services/admin/health';

/**
 * Code → JSON coverage guard for the admin support console. `translation:validate`
 * only checks en/ar parity — it can't see that a key REFERENCED in code exists.
 * So the next backend flag added without locale entries would render a raw key in
 * production. This test asserts every dynamically-built `customer.*` key
 * (flag_*, setting_*, kbType_*) exists in BOTH admin.json files.
 */

// Banner-only derived keys the UI renders but computeHealthFlags never emits.
const RENDER_ONLY_FLAG_KEYS = ['merchant_never_seen', 'hold_low_confidence_weak_kb'];
// kb_chunks.type domain values rendered as pills (KbSection KB_TYPE_ORDER).
const KB_TYPES = ['offering', 'faq', 'policy', 'info', 'hours', 'location'];
// Settings rendered with a `setting_<key>` label — must match SettingsSection's
// SETTING_GROUPS + the replyStyle badge. (NOT SUPPORT_SETTINGS_KEYS, which also
// holds persona/jsonb keys shown without a labelled row.)
const RENDERED_SETTING_KEYS = [
    'aiEnabled', 'aiModel', 'commentsAutoReply', 'messagesAutoReply', 'commentReplyMode',
    'holdLowConfidence', 'replyDelay', 'defaultReplyLanguage', 'autoDetectLanguage',
    'supportedLanguages', 'businessHoursOnly', 'businessHoursStart', 'businessHoursEnd',
    'timezone', 'greetingMessageEnabled', 'limitFallbackEnabled', 'newLeadAlertsEnabled',
    'notificationsEnabled', 'replyStyle', 'replyMode',
];

function loadCustomer(locale: 'en' | 'ar'): Record<string, string> {
    const p = resolve(__dirname, `../../../frontend/src/i18n/${locale}/admin.json`);
    return JSON.parse(readFileSync(p, 'utf8')).customer;
}

const en = loadCustomer('en');
const ar = loadCustomer('ar');

const expectedKeys = [
    ...HEALTH_FLAG_KEYS.map(k => `flag_${k}`),
    ...RENDER_ONLY_FLAG_KEYS.map(k => `flag_${k}`),
    ...RENDERED_SETTING_KEYS.map(k => `setting_${k}`),
    ...KB_TYPES.map(k => `kbType_${k}`),
];

describe('admin support console — dynamic i18n key coverage', () => {
    for (const key of expectedKeys) {
        it(`customer.${key} exists in en + ar`, () => {
            expect(en[key], `customer.${key} missing in en/admin.json`).toBeDefined();
            expect(ar[key], `customer.${key} missing in ar/admin.json`).toBeDefined();
        });
    }
});
