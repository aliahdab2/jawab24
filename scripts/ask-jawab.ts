#!/usr/bin/env npx tsx
/**
 * Ask Jawab a set of probe questions against a page via the admin playground (the same path
 * the eval uses) and print the actual reply + intent/confidence/flags. Used to demonstrate the
 * structured-facts backfill BEFORE vs AFTER on a real merchant's KB.
 *
 *   ADMIN_TOKEN=<jwt> npx tsx scripts/ask-jawab.ts --page=<uuid> --label=BEFORE
 *   # token is auto-fetched from POST /auth/demo when ADMIN_TOKEN is unset.
 *
 * Probe set defaults to the institute's known failure modes; override with QUESTIONS env
 * (JSON array of { q: string, history?: {role,content}[] }).
 */
const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';
const PAGE_ID = process.argv.find(a => a.startsWith('--page='))?.split('=')[1];
const LABEL = process.argv.find(a => a.startsWith('--label='))?.split('=')[1] || '';

type Probe = { q: string; history?: { role: string; content: string }[]; note?: string };

// Institute (الفريق الدمشقي) verified failure modes: false-denial of women's haircut, confident
// wrong/cross-wired makeup price (100k vs real 35k), buried address/hours, first-aid price.
const DEFAULT_PROBES: Probe[] = [
    { q: 'قديش سعر دورة المكياج؟', note: 'makeup price → expect 35,000, NOT 100k, NOT deflection' },
    { q: 'بكم دورة المكياج', note: 'makeup price, different phrasing' },
    { q: 'عندكم دورة حلاقة نسائية؟', note: "women's haircut → must NOT deny (it exists at 35k)" },
    { q: 'بدي دورة حلاقة لسيدات', note: "women's haircut, different phrasing" },
    { q: 'دورة الاسعافات بكم؟', note: 'first-aid price → 35,000' },
    { q: 'وين عنوانكم؟', note: 'address → برامكة / مكتبة الحافظ' },
    { q: 'شو اوقات الدوام؟', note: 'hours → 9ص–8م عدا الجمعة' },
    {
        q: 'طيب كم تكلفة دورة المكياج بالضبط؟',
        history: [{ role: 'user', content: 'بدي اعرف عن دورة المكياج' }, { role: 'assistant', content: 'دورة المكياج متوفرة لدينا.' }],
        note: 'cross-wire trap → must give makeup 35k, must NOT emit 100k',
    },
];

async function getToken(): Promise<string> {
    if (process.env.ADMIN_TOKEN) return process.env.ADMIN_TOKEN;
    const res = await fetch(`${BASE_URL}/auth/demo`, { method: 'POST', headers: { 'Content-Type': 'application/json' } });
    const j = await res.json() as { token: string };
    return j.token;
}

async function main() {
    if (!PAGE_ID) { console.error('Usage: --page=<uuid> [--label=BEFORE]'); process.exit(1); }
    const token = await getToken();
    const probes: Probe[] = process.env.QUESTIONS ? JSON.parse(process.env.QUESTIONS) : DEFAULT_PROBES;

    console.log(`\n${'='.repeat(90)}\n  ${LABEL ? LABEL + ' — ' : ''}page ${PAGE_ID}  (${probes.length} probes)\n${'='.repeat(90)}`);

    for (const p of probes) {
        const body: Record<string, unknown> = { pageId: PAGE_ID, question: p.q, channel: 'dm', source: 'eval' };
        if (p.history) body.conversationHistory = p.history;

        let line = '';
        try {
            const res = await fetch(`${BASE_URL}/admin/ai/playground`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
                body: JSON.stringify(body),
            });
            if (!res.ok) { console.log(`\n❓ ${p.q}\n   HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`); continue; }
            const j = await res.json() as { data?: { reply: string | null; intent: string | null; confidence: string | null; flags: string[]; replyMethod: string; cached: boolean } };
            const d = j.data;
            const flags = d?.flags?.length ? ` flags=[${d.flags.join(',')}]` : '';
            line = `   → [${d?.intent ?? '-'}/${d?.confidence ?? '-'}${flags}${d?.cached ? ' CACHED' : ''}]\n   ${d?.reply ?? '(no reply / skipped: ' + d?.replyMethod + ')'}`;
        } catch (e) {
            line = `   ERROR ${(e as Error).message}`;
        }
        console.log(`\n❓ ${p.q}${p.note ? `\n   (${p.note})` : ''}\n${line}`);
    }
    console.log('');
    process.exit(0);
}

main().catch(e => { console.error('ERR', e instanceof Error ? e.message : e); process.exit(1); });
