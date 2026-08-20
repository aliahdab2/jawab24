Diagnose the Instagram "thread owned elsewhere" outage — a foreign app holding a merchant's IG conversations so none of our replies can be delivered — and send the merchant the formal notice that gets it fixed.

Arguments: $ARGUMENTS
- Nothing → run the fleet scan (Step 1) and report which pages are affected. Do this periodically; the outage is invisible to the merchant and to us unless someone looks.
- A merchant email / page name / `facebook_page_id` / page UUID → diagnose that page only.
- `send` → after confirming, send the notice. Without it, draft and stop.

## The condition

A merchant connects a third-party messaging tool **directly to their Instagram account via Instagram Login**. That app becomes the conversation owner under Meta's Handover Protocol, and every `POST /me/messages` we issue dies with:

```
(#100) subcode 2534037 — "The action is invalid since it's not the thread owner"
```

Three properties make this nastier than it looks:

1. **Invisible from the Page side.** `subscribed_apps` on the Facebook Page lists only jawab24.com, because the rival is attached to the IG account, not the Page. Checking Page subscriptions "proves" everything is fine.
2. **The other tool usually isn't replying either.** Verified live 2026-08-08: the owner DM'd the account from his own Instagram and got silence from both tools. So this is not "another tool is handling it" — the customer gets nothing from anyone.
3. **Facebook keeps working perfectly**, so every dashboard and the merchant's own impression says the account is healthy. The IG channel dies silently, indefinitely.

⛔ **Never call `take_thread_control` to fix this.** It would yank threads out of a tool the merchant may be actively using. `request_thread_control` + one retry behind a flag is the only acceptable self-heal, and it isn't built. The fix is the merchant disconnecting the other app.

## Step 1 — Detect, with both queries

**Query A — precise.** Catches the classified bucket that #668 added:

```bash
./scripts/prod-db-query.sh "
SELECT p.name AS page_name, p.instagram_username, u.email, m.platform,
       COUNT(*) AS failures, MAX(m.created_at) AS latest
FROM messages m JOIN pages p ON p.id = m.page_id JOIN users u ON u.id = p.user_id
WHERE m.flag_reason = 'delivery_failed'
  AND (m.flag_meta #>> '{}') ILIKE '%thread_owned_elsewhere%'
GROUP BY 1,2,3,4 ORDER BY failures DESC;"
```

**Query B — complete but noisy.** Query A is blind to everything that failed before #668 shipped, so it under-reports. Run B too and reconcile:

```bash
./scripts/prod-db-query.sh "
SELECT p.name AS page_name, p.instagram_username, u.email, m.platform,
       COUNT(*) AS failures,
       COUNT(*) FILTER (WHERE (m.flag_meta #>> '{}') ILIKE '%thread_owned_elsewhere%') AS classified,
       COUNT(*) FILTER (WHERE m.flag_meta IS NULL OR (m.flag_meta #>> '{}') = '') AS unclassified,
       MAX(m.created_at) AS latest
FROM messages m JOIN pages p ON p.id = m.page_id JOIN users u ON u.id = p.user_id
WHERE m.flag_reason = 'delivery_failed'
GROUP BY 1,2,3,4 ORDER BY failures DESC;"
```

### ⛔ Two traps that will make you email the wrong merchant

**Recency is part of the diagnosis.** A page whose newest failure is weeks old has *recovered*, not broken. On 2026-08-12 the fleet scan showed Nourva with **264** IG failures — twenty times MES's count — but its newest was 2026-07-04, five weeks earlier, and Nourva's IG was verified sending normally on 08-08 (it was the healthy control in the original probe). Those are historical failures from a different cause. **A big count with a stale `latest` is not this outage.** Require failures within roughly the last few days.

**`classified = 0` with a populated `flag_meta` means a different bucket, not this one.** Same scan: «متجر إجدابيا» had 20 Facebook failures, only 1 unclassified — so 19 carried some *other* classified bucket. Unrelated problem. Only `unclassified` rows are genuinely ambiguous.

So a page qualifies when: recent failures, on `platform='instagram'`, AND either the bucket is present or the rows are unclassified *and* you confirm with Step 2.

## Step 2 — Confirm before you write anything

If the bucket is already on recent rows, that IS the confirmation — `flag_meta` carries Graph's own verdict. Read one:

```bash
./scripts/prod-db-query.sh "
SELECT platform, LEFT(message,60) AS msg, flag_meta, created_at
FROM messages WHERE page_id = '<PID>' AND flag_reason='delivery_failed'
ORDER BY created_at DESC LIMIT 5;"
```

For unclassified rows, or to learn **which app** owns the threads, run the probe (read-only; no writes, no control transfer). Get fresh recipients first — stale IGSIDs from an old session prove nothing:

```bash
./scripts/prod-db-query.sh "
SELECT DISTINCT sender_id, sender_name, MAX(created_at) AS last_msg
FROM messages WHERE page_id='<PID>' AND platform='instagram' AND direction='incoming'
GROUP BY 1,2 ORDER BY last_msg DESC LIMIT 5;"
```

Then run this probe — it asks who owns each thread, then resolves the owning `app_id` to a human name. Write it to your scratchpad and pipe it in (it is inline here on purpose: `.planning/` is gitignored, so a file there would not reach a future worktree):

```js
const PAGE = { pageId: '<PID>', workspaceId: '<WSID>' };
const RECIPIENTS = ['<IGSID_1>', '<IGSID_2>'];               // freshest failing threads
const clean = (s) => String(s).replace(/access_token=[^&"\\]+/g, 'access_token=REDACTED');

(async () => {
    const { pagesService } = require('/app/backend/dist/services/pages.js');
    const page = await pagesService.getPage(PAGE.workspaceId, PAGE.pageId);
    if (!page) throw new Error('page not found');
    const V = process.env.FACEBOOK_GRAPH_API_VERSION || 'v21.0';
    const token = page.accessToken, appIds = new Set();

    for (const rec of RECIPIENTS) {
        const r = await fetch(`https://graph.facebook.com/${V}/me/thread_owner?` +
            new URLSearchParams({ recipient: rec, access_token: token }));
        const body = await r.text();
        console.log(`thread ${rec} status=${r.status}: ${clean(body).slice(0, 300)}`);
        try {
            for (const d of (JSON.parse(body).data || [])) {
                if (d?.thread_owner?.app_id) appIds.add(String(d.thread_owner.app_id));
            }
        } catch { /* non-JSON already printed */ }
    }

    for (const id of appIds) {
        const r = await fetch(`https://graph.facebook.com/${V}/${id}` +
            `?fields=id,name,link,category&access_token=${encodeURIComponent(token)}`);
        console.log(`app ${id} status=${r.status}: ${clean(await r.text()).slice(0, 400)}`);
    }
    process.exit(0);
})().catch((e) => { console.error('FAILED:', clean(e.message)); process.exit(1); });
```

Never let a token reach stdout — that is what `clean()` is for. A Graph paging URL leaked a page token into a session transcript on 2026-08-08; low risk, but reconnecting the page rotates it if you want it gone.

Interpreting it: `{"data":[]}` empty = healthy. A populated `thread_owner` = foreign owner. If the grant expires ≈ last customer message + 24h, it is a **per-message** grant, meaning the rival is primary receiver account-wide — not one stray thread.

Run it in the prod backend container, and **`docker ps` first — the container flips `jawab24-backend-blue`/`-green` on every deploy:**

```bash
ssh -i ~/.ssh/id_jawab24_deploy root@91.99.95.196 \
  'docker exec -i -w /app/backend jawab24-backend-<blue|green> node' < probe.js
```

**Getting the app name is worth the extra step.** «احذف تطبيق ‹الاسم›» converts far better than «ابحث عن تطبيق لا تعرفه» — and once known, put it into step 5 of the email.

## Step 3 — Build the notice from THAT merchant's data

Register, structure and tone: follow `/merchant-email` (formal فصحى, «حضرة السيد … المحترم», أولاً/ثانياً/ثالثاً, «إدارة جواب24», ⛔ no reply request, ⛔ no "contact us if you can't find it" fallback, two files — sendable copy separate from founder notes). Do not restate those rules here.

Fill from queries you ran **today**:

| Placeholder | Source |
|---|---|
| اسم التاجر | `users.name` — full name, formal |
| حساب إنستغرام | `pages.instagram_username` |
| عدد الرسائل | count of recent IG `delivery_failed` |
| عدد الحسابات | `COUNT(DISTINCT sender_id)` over those rows |
| ثلاث استفسارات | the customers' own words, **verbatim, in their dialect** |
| اسم التطبيق | from Step 2, if known |

Pick quotes that are obviously *buying* questions — a price, an address, availability. «وين موقع الصاله» lands; «شكراً» does not.

The body that has been sent and works (MES, 2026-08-12) — adapt, never paste MES's numbers:

> **أولاً: وصف الخلل وأثره** — رسائل العملاء تصل إلى نظامنا ويُجهَّز الردّ، إلا أنّ إنستغرام يرفض تسليمه. `<N>` رسالة من `<M>` حسابات، مع الاقتباسات.
> **ثانياً: سبب الخلل** — تطبيق آخر متّصل بالحساب يستحوذ على ملكية المحادثات؛ إنستغرام لا يسمح لأكثر من تطبيق بالردّ على المحادثة ذاتها. ويُرجَّح أنّه تطبيق جرى تجريبه سابقاً وبقي متّصلاً. وننبّه أنّ ذلك التطبيق لا يردّ على العملاء كذلك.
> **ثالثاً: طريقة المعالجة** — الخطوات أدناه، ثم «وتعود القناة إلى العمل مباشرةً عند إزالة التطبيق».

Always include the sentence that prevents a panicked call: **«أمّا قناة فيسبوك فتعمل بصورة سليمة تماماً ولا تستدعي أي إجراء من جانبكم.»**

### The removal steps — and the one thing to check first

⚠️ **The Instagram menu path is NOT verified from official documentation.** `help.instagram.com` is JS-rendered and yields nothing to WebFetch; third-party sources converge on two variants and the UI differs by app version and locale. The shared footer now does print a reply address, but a merchant stuck mid-menu will not stop to write — so **the path must still be right the first time** — so verify it on a real device with Arabic Instagram if you can, and flag it as unverified in the founder notes if you cannot.

```
١. تطبيق إنستغرام ← «الإعدادات والخصوصية».
٢. أحد مسارين بحسب الإصدار:
   • «الأمان» ← «التطبيقات والمواقع الإلكترونية»
   • أو «تطبيقاتك والوسائط» ← «أذونات المواقع» ← «التطبيقات والمواقع الإلكترونية»
٣. تبويب «نشط» — فيه كل تطبيق له صلاحية على الحساب.
٤. سيظهر تطبيق Jawab24 وهو الخاص بنا، ويُرجى إبقاؤه دون تغيير.
٥. اختيار التطبيق غير المستخدم، ثم «إزالة».
```

Step 4 matters: without it a merchant may remove *us* and make it worse.

## Step 4 — Send (verified working 2026-08-12)

⛔ **Never hand-roll the HTML** — use the branded template, which supplies the logo lockup, the card, the footer and the Cairo/Tajawal RTL stack. The body you pass is **plain text**: it gets `escapeHtml`'d with `\n` → `<br>`, so markup would render as literal tags. Use «أولاً/ثانياً/ثالثاً» and «١.» / «•» for structure.

Use **`type: 'account_notice'`** — an existing `EmailType` in `backend/src/services/email.ts`. ⛔ Never invent a type value. Pass `userId` so the send is filterable per merchant.

```js
const { accountNoticeEmailTemplate } = require('/app/backend/dist/utils/emailTemplates.js');
const { emailService } = require('/app/backend/dist/services/email.js');

const { subject, html } = accountNoticeEmailTemplate({
    name: null,                    // see the greeting caveat in /merchant-email
    subject: 'توقّف تسليم الردود على قناة إنستغرام — السبب وطريقة المعالجة',
    body: BODY,                    // plain text, newlines only
});
const result = await emailService.send({ to: TO, subject, html, type: 'account_notice', userId: USER_ID });
console.log('send result:', JSON.stringify(result));
```

Run it the same way as the probe (`docker exec -i -w /app/backend jawab24-backend-<blue|green> node`), then verify the audit row:

```bash
./scripts/prod-db-query.sh "
SELECT to_email, subject, type, status, resend_email_id, user_id, created_at
FROM email_sends WHERE id = '<emailSendId>';"
```

Expect `status = sent`. Sends from `info@jawab24.com` (`RESEND_FROM_EMAIL` unset in prod → default).

**Get the founder's approval on the final text before sending.** It cannot be unsent.

## Step 5 — Confirm recovery

The merchant will not tell you they did it. Watch for the first *successful* IG send:

```bash
./scripts/prod-db-query.sh "
SELECT COUNT(*) FILTER (WHERE direction='outgoing') AS ig_sends,
       COUNT(*) FILTER (WHERE flag_reason='delivery_failed') AS still_failing,
       MAX(created_at) AS latest
FROM messages WHERE page_id='<PID>' AND platform='instagram'
  AND created_at > '<the send timestamp>';"
```

One outgoing IG message after the notice = fixed. Failures continuing for several days = he didn't find it, and the unverified menu path is the first suspect — follow up on WhatsApp rather than resending the same email.

## Related

- `/merchant-email` — the register, structure and two-file rules this skill defers to.
- `/reply-quality` — where this outage usually surfaces first, as a `delivery_failed` cluster.
- Memory: `project_mes_instagram_thread_ownership` (the original diagnosis and the two product defects found en route).
