# Jawab24 - Complete System Analysis / تحليل النظام الكامل

> **System Reference Document / وثيقة مرجعية للنظام**
> Generated: 2026-02-28 | Updated: 2026-04-15 (v30 — Email service via Resend; waitlist with admin management; all Facebook+Instagram permissions approved 2026-04-07; prompt v30)
>
> **Terminology note:** Preset Replies (formerly Templates+Rules) was removed. Template reply paths are now handled by **Post Replies** only — a per-post trigger with two modes (`posts/instagram_media.trigger_type`): **keyword** (comment matches one of ≤10 keywords) or **any-comment** (fires on every comment; runs the spam/friend-tag skip rules + a best-effort complaint keyword-guard first, bounded by an invisible per-post/24h anti-runaway cap — see D-013; content-free comments like "." / emoji-only / "٠٠٠" DO get the template — dot-CTA campaigns, see D-021). A per-post **like-the-comment** option (`posts.like_comment`, Facebook only — the Instagram API has no like endpoint; opt-in, default off; ManyChat parity) makes the page like the customer's comment after a successful trigger send (fire-and-forget `POST /{comment-id}/likes`). A per-post **exclude-keyword** veto list (`posts/instagram_media.trigger_exclude_keyword`, both platforms) blocks the trigger when a comment contains any excluded keyword — it falls through to the AI pipeline instead (e.g. keep «سعر» firing but let «السعر غالي» pass to AI). A per-post **CTA link button** (`posts.trigger_button_label` + `trigger_button_url`, Facebook + DM-channel only; ManyChat "auto-DM a link" parity) rides the private reply: a button template when no image is attached (reply text capped at Meta's 640), or the generic image card alongside «Read more» when one is. A delivered button is stamped on both stored reply rows (`flag_meta.reply_cta` — label + URL), which the message/comment thread views render as a Messenger-style pill so the merchant sees the button the customer received (rows stored before this shipped predate the marker and show text only). A Post Reply can also be armed on a **still-scheduled Facebook post** (the picker lists `GET /{page-id}/scheduled_posts` above the published page, behind an explicit `?includeScheduled=1` opt-in so older installed app builds keep the list they can render): the trigger saves immediately and fires as soon as the post publishes. `posts.scheduled_publish_time` records the pending state — set from Graph on arm (never from the client), cleared by the feed webhook at publish, and used as the tripwire for a scheduled post that publishes under a different post id. An overdue marker is re-checked against Graph before anything is claimed (published ⇒ heal it, our webhook was missed; still pending ⇒ drift → Sentry `post-reply-scheduled-id-drift` **plus** a `post_reply_orphaned` notification to the merchant, who is the only one who can re-arm it). Facebook owns the id, so this is detection, not prevention — see D-060. Instagram has no scheduled-media edge. Smart Replies (AI) remain the default for comments and DMs that don't match a Post Reply trigger.
>
> **«إنشاء منشور» — Post Suggestions (PILOT, 2026-08-09, dark by default):** the first outbound-content feature. ⚠️ **Renamed from «بوست اليوم» and moved to ON-DEMAND generation on 2026-08-13 (D-077).** Exactly ONE post is generated unprompted — the first time a page meets the feature — and every post after it is created when the merchant asks. There is no daily cron any more, posts are KEPT rather than replaced, and the read is not scoped to a calendar day. AI-suggested posts (text from `gpt-4.1-mini` grounded ONLY on Business Info/catalog/fact lists + brand voice; square image from `gpt-image-2` low (~$0.006/image — owner ruling 08-09; `medium` ~$0.05 is the documented upgrade lever), hard no-text/no-people rule) surfaced as a dashboard card — the merchant copies the text, downloads the image, and posts manually. **No publishing**: `FB_SCOPES` has no `pages_manage_posts`; creating another post KEEPS the previous one — the new row is filled in and the old relabelled `superseded` in ONE transaction, both gated on `status = 'ready'` (the current post is displaced only once the replacement exists). ⚠️ **Its images are KEPT.** Until 2026-08-13 supersede nulled `image_url`/`image_key` on the row and every take and deleted the files from storage; that is how a merchant's best post was destroyed in production on 08-11 (three attempts, the first was the best, the third erased it), and it was backwards economically — an image costs ~$0.0064 to generate and a fraction of a cent a year to store. `superseded` now means "an earlier post, intact", and the sheet's history strip is built from those rows — so a superseded row is a LIVE, REFERENCED row and page delete is the ONLY sweep that may remove a `generated-posts/` object (`backend/docs/OBJECT_STORAGE.md` §9). Absolute 3 generations/day/page cap (the one-time seed consumes 1) enforced as an atomic Redis claim floored by the durable count of today's `post_suggestions` rows, with page ownership verified before any cap read. Gated `POST_SUGGESTIONS_ENABLED` (default OFF) + `POST_SUGGESTIONS_WORKSPACE_IDS` allowlist whose BUILT-IN default is the founder workspace plus the owner-invited merchant testers (MES 2026-08-10, Waleed 2026-08-11; the original 08-09 ruling was founder-only — testers are added by editing BOTH defaults in one reviewable commit, never a server env edit); the frontend card is workspace-gated the same way (BUSINESS_SURFACE pattern, no build args). The seed sweep (`seedFirstPostSuggestions`, still on a daily tick — that is now a POLL INTERVAL for newly-eligible pages, not a generation cadence) gives ONE first post to CONNECTED pages of explicitly allowlisted workspaces **that have never had a post** (empty list ⇒ it seeds nothing). Repeat spend is structurally impossible rather than guarded: the predicate is "this page has no rows at all" and rows are never deleted, so the sweep can tick forever without generating again — which is why the old unopened-streak waste guard was removed with the cron rather than kept. A seed that FAILS is not retried; the merchant lands on the create button, and an automatic retry loop is the unattended spend this model removes. Merchant controls: page switcher (connected pages only), editable text, angle chips DATA-GATED by `availableTypes` (an angle without data is disabled with a complete-your-Business-Info hint), contact-footer toggle (footer composed in code — never model-written digits). **VARIANTS (migration 0162):** one generation now returns 3 takes on the same angle and the merchant picks — the industry norm (Meta Business Suite drafts 3–5 captions; Copy.ai / Predis / Ocoya all return sets) and the fix for a failure observed in prod on 2026-08-11, where a page's three generations produced its best post FIRST and the third silently destroyed it. Cost is unchanged: the takes differ in text and headline only and share ONE paid image, re-composited locally per headline (a poster-mode set costs nothing at all, since posters are drawn in code). `variants` JSONB holds `{text, headline, imageUrl, imageKey}` per take and `selected_variant` indexes it, while `text`/`image_url`/`image_key` keep MIRRORING the selected take — that mirror is what pre-variants readers see (shipped app bundles, SQL consumers), so the feature degrades cleanly rather than breaking them. `PUT …/post-suggestions/:id/selection` persists the pick; rows written before 0162 carry `variants = null` and project to a single take via `variantsOf`. One generation is still ONE cap slot. Images ship as DESIGNED cards: brand scrim + typeset Arabic headline (we render the text; the model returns `headline`) + page-logo badge via `imageCompose.composePostCard` (sharp, zero AI cost). Table `post_suggestions` (migration 0155) with `opened/copied/downloaded` stamps — the pilot's market signal. The badge is the FACEBOOK PAGE picture (the card's destination), with a linked Instagram avatar only as fallback — the reverse order stamped a personal photo on every card whenever the linked IG was a personal account. `image_brief` is stored (migration 0156) and the page's last 5 briefs are fed back into the prompt: the angle picker always had cross-day memory, the IMAGE did not, so service businesses converged on the same desk-and-laptop scene daily. It is also a post-hoc audit of visual variety (and no longer the ONLY one — superseded rows keep their images since 2026-08-13, so the output itself is inspectable). 🔴 **KNOWN LIMITATION, measured 2026-08-10: prompt-steering the image scene does NOT work.** Three attempts on one page — listing the last five scenes with "must differ in SUBJECT and SETTING", steering to the business's own world, and naming a concrete framing chosen in code — each returned the same Damascus classroom, varying only the daylight, with the prompt verified to contain every instruction. Service businesses with no physical product are the worst case (their world genuinely IS one room); a product-led page (nappy shelves) does vary. The remaining idea is structural — compose the image prompt in code from the merchant's data and leave the model only the caption, the same posture D-047 takes with digits — so ⛔ do not retry a fourth prompt instruction. A shadow-only `findUngroundedNumbers` also logs figures a post contains that its inputs do not; it never blocks, because the one case that looked like invention («45 د») turned out to be real data in `fact_rows.price`. **ASYNC GENERATION (migration 0163):** the work no longer runs on the request. A generation takes ~35s while nginx caps this route at `proxy_read_timeout 30s`, so the synchronous shape could only ever fail in front of the merchant — and did, in production on 2026-08-12: the socket closed at 35.25s, the post was created anyway, and the merchant was shown «حدث خطأ ما» with a capped attempt already spent. The mismatch predates variants (the code comment assumed a 60s frontend budget nginx never honoured); variants pushed the text call from ~170 to ~439 output tokens and crossed the line. The request now runs gate → ownership → cap → atomic claim → INSERT a `pending` row → enqueue → return at once, and `postSuggestionWorker` fulfils it. `status` gains `pending`/`failed` beside `ready`/`superseded`; `failure_reason` records WHY a row failed as one of the service's own codes (never a raw error string), and `fulfilled_at` paired with `created_at` is what makes generation latency measurable at all. ⭐ **`GET …/today` answers TWO questions separately: `suggestion` = what the merchant HAS (the newest `ready` row, or null), `inFlight` = what is HAPPENING (the newest row when it is `pending` or `failed`, else null).** Both were one field until 2026-08-13, and that was a real defect: a failed generation supersedes nothing, so its row is NEWER than the intact post it did not replace — served as "the newest live row" it took the post's place, and `history` (superseded rows only) could not hand it back. Day-scoped it cleared at midnight; on demand nothing clears it, so the post stayed masked until the merchant happened to generate again, and a page whose one-time SEED failed showed an empty card forever (the seed predicate is "has any row"). The client now keeps the post on screen while a generation runs and while one fails, and offers to create one when there is genuinely none. Pending and failed are still REPORTED, never hidden — it is what the client polls, so hiding a pending row would say "nothing happening" over work already paid for, and hiding a failed one would leave the merchant waiting on something that ended. Older shipped bundles read only `suggestion`, so the split degrades safely for them: they keep showing the previous post instead of an empty-text pending row. ⚠️ **The path still says `today`; since 2026-08-13 the behaviour does not.** It returns the page's current post whenever it was made, plus the earlier ones as `history` (capped at 10, newest first, superseded rows only). All three reads are "this page's newest row, filtered by status" and issue in ONE parallel round trip, served by `idx_post_suggestions_page_created` (migration 0164 — going day-blind took `suggested_for`, the only indexed discriminator they had, out of every one of them). The day filter was removed because with nothing generating on its own, a day-scoped read hands an empty sheet to every merchant whose last post predates midnight and nothing ever fills it. The URL is frozen because shipped mobile bundles call it and cannot be redeployed. `history` is sent by the READ route only — the generate route answers with a `pending` row, so any list built there is one behind by construction; an ABSENT field means "this response doesn't carry history", never "there are none" (that is `[]`), and clients keep what they last held. The sheet polls it every 3s while pending (and says «taking longer» rather than reporting a failure that did not happen); the dashboard card polls only while the sheet is CLOSED, so exactly one poller writes to the query cache. `image_degraded` moved from the generate RESPONSE onto the ROW for the same reason — a reason returned once cannot reach a client whose request returned 35s earlier, which is also why the dead-connection recovery silently lost that notice before. The seed sweep still fulfils INLINE (it was already off the request path, and its per-page counters must keep meaning something); only the merchant path queues. Pipelines `post_generation` / `post_image_generation` in `ai_usage_log`; images under `generated-posts/` (see `backend/docs/OBJECT_STORAGE.md` §9). Plan-tier target at GA: Business + Pro (owner ruling 2026-08-09) — ⚠️ still enforced by the WORKSPACE allowlist only, so "Business + Pro" is a target, not a gate.

---

# Table of Contents / جدول المحتويات

1. [System Architecture Overview / نظرة عامة على البنية](#1-system-architecture-overview)
2. [Complete Message Flow / مسار الرسالة الكامل](#2-complete-message-flow)
3. [Decision Tree / شجرة القرارات](#3-decision-tree)
4. [AI Prompt Construction / بناء الأوامر للذكاء الاصطناعي](#4-ai-prompt-construction)
5. [Settings & Their Effects / الإعدادات وتأثيراتها](#5-settings-and-their-effects)
6. [With Store vs Without Store / مع متجر vs بدون متجر](#6-with-store-vs-without-store)
7. [Knowledge Base & RAG System / قاعدة المعرفة ونظام RAG](#7-knowledge-base-and-rag)
8. [Caching Strategy / استراتيجية التخزين المؤقت](#8-caching-strategy)
9. [Safety & Validation / الأمان والتحقق](#9-safety-and-validation)
10. [Edge Cases & Scenarios / حالات خاصة وسيناريوهات](#10-edge-cases-and-scenarios)
11. [Known Gaps & Concerns / فجوات معروفة ومخاوف](#11-known-gaps)
12. [Monitoring & Alerting / المراقبة والتنبيهات](#12-monitoring--alerting)
13. [Launch Defaults / القيم الافتراضية عند الإطلاق](#launch-defaults-single-source-of-truth)
14. [RBAC & Workspace System / نظام الأدوار ومساحات العمل](#14-rbac--workspace-system)
15. [Security: Token Encryption / الأمان: تشفير التوكنات](#15-security-token-encryption)
16. [Content & SEO / المحتوى وتحسين محركات البحث](#16-content--seo)

---

# 1. System Architecture Overview
# نظرة عامة على البنية

## English

Jawab24 is a **monorepo** with 3 services + 1 shared package:

```
┌─────────────────────────────────────────────────────────────────────┐
│                        JAWAB24 ARCHITECTURE                        │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────────────┐  │
│  │   Frontend    │    │   Backend    │    │     AI Worker        │  │
│  │  (Next.js)   │◄──►│  (Fastify)   │◄──►│   (Fastify)         │  │
│  │  Port: 3001  │    │  Port: 3000  │    │   Port: 3002        │  │
│  └──────────────┘    └──────┬───────┘    └──────────┬───────────┘  │
│                             │                       │               │
│                      ┌──────┴───────┐        ┌──────┴──────┐       │
│                      │  PostgreSQL  │        │   OpenAI    │       │
│                      │   + Redis    │        │  gpt-4.1-   │       │
│                      │   + BullMQ   │        │    mini     │       │
│                      └──────────────┘        └─────────────┘       │
│                                                                     │
│  ┌──────────────────────────────────────────────────────────────┐  │
│  │                    packages/shared                            │  │
│  │  Types, Constants, Sanitization, Intent Normalization         │  │
│  └──────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────┘
```

**Services:**
- **Frontend** (Port 3001): Next.js 15 + Tailwind + Capacitor (mobile)
- **Backend** (Port 3000): Fastify 5 + Drizzle ORM + PostgreSQL + Redis
- **AI Worker** (Port 3002): Fastify 5 + OpenAI API (gpt-4.1-mini)
- **Shared Package**: TypeScript types, constants, sanitization utilities

**External Integrations:**
- Facebook Graph API (comments + DMs) — Live (App ID: 774211662298446)
- Instagram Graph API (comments + DMs) — Live (all permissions approved 2026-04-07)
- WhatsApp Cloud API (DMs) — **LIVE (GA)**: Meta approved the app 2026-07-26; Embedded Signup connect + voice/media + WhatsApp-only cards (no Facebook page; also = multi-number, one card per number w/ own Business Info) + manual inbox replies + read receipts/typing indicators. **Coexistence (D-045)**: at connect time the merchant chooses whether the number stays live on their WhatsApp Business app (Meta's `whatsapp_business_app_onboarding`) or moves to Jawab24; a reconnect always re-uses the stored path. Meta enforces the precondition — a number not registered in the Business app is refused at the phone-number step rather than silently migrated. ⛔ Meta bars businesses AND recipients in Cuba, Iran, North Korea, **Syria** and three sanctioned Ukrainian regions from the WhatsApp Business Platform entirely — Syrian merchants can never connect and Syrian customers can never receive replies; Libya is unrestricted. UI: the Pages screen is now "Channels" (قنوات التواصل). **Plan-gated (Business+)**: `plans.whatsapp_enabled` is true on business/pro/scale, false on starter (trial rides on starter → excluded) — enforced in `controllers/whatsapp.ts` on connect/connectNew/toggle-enable (403 `WHATSAPP_PLAN_REQUIRED`; disconnect/disable never gated, no retroactive disable on downgrade). Non-entitled plans see an upgrade CTA instead of Connect; the pricing/scale/checkout pages list WhatsApp (crossed-out on Starter) via `isWhatsAppMarketable()` (= config env set AND canary flag off). **Readiness-gated (all channels)**: enabling auto-reply on a page with no groundable Business Info is refused with 409 `BUSINESS_INFO_REQUIRED` (`services/businessReadiness.ts`) — a WhatsApp-only card is created empty (no FB page to seed it) and the client used to enable auto-reply straight after connect, putting an ungrounded AI in front of customers; disable is never gated. **Connect from the NATIVE app (v2.0.20, owner-verified 2026-07-31)** mirrors the shipped Facebook page-connect flow exactly, and must keep doing so: the onboarding-path question is asked in-app, `POST /auth/whatsapp/start {nativeApp:true}` mints the dialog URL, and `Browser.open()` takes the tab **straight to facebook.com** — routing it through a jawab24.com page first fails silently on real devices (three variants died: page-side `location.assign` in a Custom Tab and in an intent-opened Chrome tab, and a server 302). The return is the `/auth/app-sync` App Link, delivered as a **page whose script navigates** — a 302 to an App Link is not intercepted by Android. Because the nonce cookie cannot cross the WebView/browser jar boundary, app-minted states are **single-use** instead (`lib/singleUseKey`). Full pattern: AI_INSTRUCTIONS Rule 17b
- Shopify API (products + policies; App Store installs billed via **Shopify App Pricing**, mirrored locally by verify-and-reconcile — D-054, `services/shopifyBilling.ts`)
- Salla API (products + policies)
- Zid API (products + policies — Saudi Arabia)
- OpenAI API (reply generation + embeddings + translation)
- Stripe API (subscriptions + billing for direct jawab24.com customers; Embedded Checkout with PaymentElement, monthly + yearly billing intervals, Billing Portal for plan changes. **Not** the rail for Shopify App Store installs — those are Shopify-billed (D-054) and hard-blocked from every Stripe surface with 400 `SHOPIFY_BILLED`)
- Vonage SMS API (e-commerce customer notifications only; phone-OTP auth + SMS team invites are retired/disabled — see Authentication Architecture)
- Resend Email API (transactional emails — waitlist notifications, customer communications)

## عربي

Jawab24 هو **مستودع أحادي (monorepo)** يتكون من 3 خدمات + حزمة مشتركة:

**الخدمات:**
- **الواجهة الأمامية** (منفذ 3001): Next.js 15 + Tailwind + Capacitor (للموبايل)
- **الخادم الخلفي** (منفذ 3000): Fastify 5 + Drizzle ORM + PostgreSQL + Redis
- **عامل الذكاء الاصطناعي** (منفذ 3002): Fastify 5 + واجهة OpenAI (gpt-4.1-mini)
- **الحزمة المشتركة**: أنواع TypeScript، ثوابت، أدوات تنظيف المدخلات

**التكاملات الخارجية:**
- Facebook Graph API (التعليقات + الرسائل المباشرة) — مباشر (App ID: 774211662298446)
- Instagram Graph API (التعليقات + الرسائل المباشرة) — مباشر (جميع الصلاحيات مُوافَق عليها 2026-04-07)
- WhatsApp Cloud API (الرسائل المباشرة) — **مباشر (متاح للجميع)**: وافقت Meta على التطبيق في 2026-07-26؛ الربط عبر Embedded Signup + الرسائل الصوتية والوسائط + بطاقات واتساب مستقلة بدون صفحة فيسبوك (= دعم أكثر من رقم، لكل رقم معلومات نشاطه) + الرد اليدوي من صندوق الوارد + إشعارات القراءة ومؤشر الكتابة. **التعايش (القرار D-045)**: عند الربط يختار التاجر إمّا أن يبقى الرقم عاملاً في تطبيق واتساب للأعمال أو أن يُخصَّص لجواب24، وتعيد إعادةُ الربط استخدامَ المسار المحفوظ دائماً. وتفرض Meta الشرط بنفسها: الرقم غير المسجَّل في تطبيق واتساب للأعمال يُرفض عند خطوة إدخال الرقم بدل أن يُنقل ضمناً. ⛔ تمنع Meta الأنشطة التجارية والمستقبِلين في كوبا وإيران وكوريا الشمالية **وسوريا** وثلاث مناطق أوكرانية خاضعة للعقوبات من منصة واتساب للأعمال بالكامل — لا يستطيع التاجر السوري الربط ولا يستطيع العميل السوري استقبال الردود؛ وليبيا غير مقيّدة. الواجهة: شاشة الصفحات أصبحت «قنوات التواصل». **مقيّد بالباقة (باقة الأعمال فما فوق)**: `plans.whatsapp_enabled` مفعّل في باقات الأعمال/الاحترافية/التوسع دون باقة البداية (الفترة التجريبية تتبع باقة البداية → مستثناة) — يُفرض في `controllers/whatsapp.ts` عند الربط والتفعيل (403 برمز `WHATSAPP_PLAN_REQUIRED`؛ قطع الربط والإيقاف متاحان دائماً، ولا إيقاف رجعي عند تخفيض الباقة). الباقات غير المشمولة ترى زر ترقية بدل زر الربط؛ وتعرض صفحات الأسعار والتوسع والدفع ميزة واتساب (مشطوبة في باقة البداية) عبر `isWhatsAppMarketable()`. **الربط من تطبيق أندرويد (النسخة 2.0.20، مؤكَّد على جهاز حقيقي 2026-07-31)** يطابق مسار ربط صفحة فيسبوك المعمول به، ويجب أن يبقى مطابقاً له: يُسأل التاجر عن مسار الإعداد داخل التطبيق، ثم يسكّ `POST /auth/whatsapp/start {nativeApp:true}` رابطَ الحوار، ويفتحه `Browser.open()` **على فيسبوك مباشرة** — أما تمرير التبويب عبر صفحة من jawab24.com أولاً فيفشل بصمت على الأجهزة الحقيقية (فشلت ثلاث صور: قفزة من الصفحة داخل Custom Tab، والقفزة نفسها في تبويب Chrome، وإعادة توجيه 302 من الخادم). والعودة عبر رابط التطبيق `/auth/app-sync` تُقدَّم كـ**صفحة ينفّذ سكربتها التنقّل** — إذ لا يعترض أندرويد إعادة توجيه 302 إلى رابط تطبيق. ولأن كوكي الـ nonce لا يعبر بين جرّة الـ WebView وجرّة المتصفح، صارت حالات التطبيق **أحادية الاستخدام** بدلاً منه (`lib/singleUseKey`). التفاصيل الكاملة في القاعدة 17b من AI_INSTRUCTIONS
- Shopify API (المنتجات + السياسات)
- Salla API (المنتجات + السياسات)
- Zid API (المنتجات + السياسات — المملكة العربية السعودية)
- OpenAI API (توليد الردود + التضمينات + الترجمة)
- Stripe API (الاشتراكات + الفواتير؛ Embedded Checkout مع PaymentElement، دوري شهري وسنوي)
- Vonage SMS API (إشعارات عملاء التجارة الإلكترونية فقط؛ مصادقة OTP عبر الهاتف ودعوات الفريق عبر SMS معطّلة)
- Resend Email API (بريد إلكتروني للمعاملات — إشعارات قائمة الانتظار، تواصل العملاء)

---

# 2. Complete Message Flow
# مسار الرسالة الكامل

## English

### The Full Journey: From Customer Message to Reply Sent

```
╔═══════════════════════════════════════════════════════════════════════════╗
║                    COMPLETE MESSAGE LIFECYCLE                            ║
╠═══════════════════════════════════════════════════════════════════════════╣
║                                                                         ║
║  CUSTOMER writes on Facebook/Instagram                                  ║
║       │                                                                 ║
║       ▼                                                                 ║
║  ┌─────────────────────────────────────────┐                            ║
║  │  STEP 1: WEBHOOK RECEIPT                │                            ║
║  │  • Facebook/Instagram sends POST        │                            ║
║  │  • Backend verifies HMAC-SHA256         │                            ║
║  │  • Returns 200 OK immediately           │                            ║
║  │  • Enqueues job to BullMQ (async)       │                            ║
║  └────────────────┬────────────────────────┘                            ║
║                   │                                                     ║
║                   ▼                                                     ║
║  ┌─────────────────────────────────────────┐                            ║
║  │  STEP 2: WORKER PICKS UP JOB           │                            ║
║  │  • 5 concurrent workers (configurable)  │                            ║
║  │  • Routes by jobType:                   │                            ║
║  │    - facebook_comment                   │                            ║
║  │    - facebook_message                   │                            ║
║  │    - instagram_comment                  │                            ║
║  │    - instagram_message                  │                            ║
║  │    - whatsapp_message                   │                            ║
║  └────────────────┬────────────────────────┘                            ║
║                   │                                                     ║
║                   ▼                                                     ║
║  ┌─────────────────────────────────────────┐                            ║
║  │  STEP 3: VALIDATION CHECKS             │                            ║
║  │  ✓ Page exists & auto-reply enabled?    │                            ║
║  │  ✓ Platform auto-reply enabled?         │                            ║
║  │  ✓ Within business hours? (if setting)  │                            ║
║  │  ✓ Rate limit OK? (5/min comments,     │                            ║
║  │    10/min messages)                    │                            ║
║  │  ✓ Handoff pause active? (human agent) │                            ║
║  │  ✓ Already replied?                     │                            ║
║  │  ✓ Debounce (fast-path only, skipped   │                            ║
║  │    when replyDelay > 0)                │                            ║
║  └────────────────┬────────────────────────┘                            ║
║                   │                                                     ║
║                   ▼                                                     ║
║  ┌─────────────────────────────────────────┐                            ║
║  │  STEP 3b: DISTRIBUTED LOCK (Redis)     │                            ║
║  │  • SET reply_lock:{pageId}:{senderId}  │                            ║
║  │    EX 60 NX (one-shot acquire)         │                            ║
║  │  • If held → skip (another worker has  │                            ║
║  │    it); prevents double-replies         │                            ║
║  │  • Released in finally (Lua CAS)       │                            ║
║  └────────────────┬────────────────────────┘                            ║
║                   │                                                     ║
║          ┌────────┴─────────┐                                           ║
║          │ FIRST CONVERSATION│                                          ║
║          └────────┬─────────┘                                           ║
║             YES   │                                                     ║
║                   ▼                                                     ║
║  ┌─────────────────────────────────────────┐                            ║
║  │  STEP 4: GREETING GATE (DMs only)        │                            ║
║  │  Fires on opener tap OR first real msg  │                            ║
║  │  when greetingMessageEnabled=true AND   │                            ║
║  │  configured text is non-empty:           │                            ║
║  │  • Send greeting → mark replied → STOP  │                            ║
║  │                                          │                            ║
║  │  Opener taps with toggle off / empty:   │                            ║
║  │  • Silently suppress (never reach AI)    │                            ║
║  │  Opener rows are excluded from the      │                            ║
║  │  first-message count so a tap + reply   │                            ║
║  │  flow doesn't burn the slot.             │                            ║
║  └────────────────┬────────────────────────┘                            ║
║                   │                                                     ║
║                   ▼                                                     ║
║  ┌─────────────────────────────────────────┐                            ║
║  │  STEP 5: REPLY DELAY (consolidation)   │                            ║
║  │  • Wait X seconds (e.g., 2s)            │                            ║
║  │  • Post-delay debounce re-check         │                            ║
║  │  • Acts as message consolidation window │                            ║
║  └────────────────┬────────────────────────┘                            ║
║                   │                                                     ║
║                   ▼                                                     ║
║  ┌─────────────────────────────────────────┐                            ║
║  │  STEP 6: CONSOLIDATE MESSAGES           │                            ║
║  │  • Fetch all unreplied msgs from sender │                            ║
║  │  • Join for AI context                  │                            ║
║  │  • Use latest msg for template matching │                            ║
║  └────────────────┬────────────────────────┘                            ║
║                   │                                                     ║
║         ┌─────────┴──────────┐                                          ║
║         ▼                    ▼                                           ║
║  ┌──────────────┐    ┌──────────────┐                                   ║
║  │  TEMPLATE    │    │  AI REPLY    │                                   ║
║  │  MATCHING    │    │  GENERATION  │                                   ║
║  │  (Step 7a)   │    │  (Step 7b)   │                                   ║
║  └──────┬───────┘    └──────┬───────┘                                   ║
║         │                   │                                           ║
║         │    ┌──────────────┘                                           ║
║         │    │                                                          ║
║         ▼    ▼                                                          ║
║  ┌─────────────────────────────────────────┐                            ║
║  │  STEP 8: SAFETY FILTERS                │                            ║
║  │  • Offensive? → Skip reply, flag        │                            ║
║  │  • Price hallucination (2-tier)?        │                            ║
║  │    Tier A: currency-adjacent number     │                            ║
║  │    Tier B: price-cue phrase + number    │                            ║
║  │    → Replace with safe fallback         │                            ║
║  │  • Low confidence? → Hold for review    │                            ║
║  │    (AI draft shown in review UI)       │                            ║
║  │  • Comment > 50 words? → Flag            │                            ║
║  │  • Comment > 280 chars? → Truncate      │                            ║
║  │    (public mode only, at sentence)      │                            ║
║  └────────────────┬────────────────────────┘                            ║
║                   │                                                     ║
║                   ▼                                                     ║
║  ┌─────────────────────────────────────────┐                            ║
║  │  STEP 8b: TYPING INDICATOR (DMs only)  │                            ║
║  │  • Send "typing..." to Messenger/IG    │                            ║
║  │  • Shown before AI reply arrives       │                            ║
║  │  • Makes response feel more natural    │                            ║
║  └────────────────┬────────────────────────┘                            ║
║                   │                                                     ║
║                   ▼                                                     ║
║  ┌─────────────────────────────────────────┐                            ║
║  │  STEP 9: SEND REPLY                    │                            ║
║  │  • Via Facebook/Instagram Graph API     │                            ║
║  │  • Mark message as replied (DB)         │                            ║
║  │  • Store outgoing message               │                            ║
║  │  • Notify merchant if flagged           │                            ║
║  │  • Structured log: reply_sent event     │                            ║
║  │    (method, intent, confidence, flags,  │                            ║
║  │     duration, consolidated count)        │                            ║
║  └─────────────────────────────────────────┘                            ║
║                                                                         ║
╚═══════════════════════════════════════════════════════════════════════════╝
```

### Step 7a: Template Matching (Detail)

```
Customer message: "كم سعر القميص الأزرق؟"
         │
         ▼
┌───────────────────────────────┐
│  Fetch active rules           │
│  (ordered by priority)        │
│                               │
│  Rule 1: keywords=["سعر"]     │ ◄── Priority 0 (highest)
│  Rule 2: keywords=["توصيل"]   │ ◄── Priority 1
│  Rule 3: keywords=["مرتجع"]   │ ◄── Priority 2
└───────────┬───────────────────┘
            │
            ▼
┌───────────────────────────────┐
│  Normalize text:              │
│  "كم سعر القميص الأزرق"       │
│                               │
│  Check Rule 1:                │
│    keyword "سعر" in text?     │
│    ✓ MATCH (Arabic substring) │
│                               │
│  → Return Rule 1's template   │
│  → replyMethod = 'template'   │
└───────────────────────────────┘
```

**Arabic keyword matching is special:**
- Substring match (handles prefixes like ال)
- Root consonant match (handles broken plurals: سعر → اسعار)
- English uses word-boundary regex (\bkeyword\b)

### Step 7b: AI Reply Generation (Detail)

```
┌─────────────────────────────────────────────────────────────────┐
│                    AI REPLY GENERATION PIPELINE                  │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  1. CHECK SUBSCRIPTION                                          │
│     └─ Can user use AI replies? (plan limit)                    │
│                                                                 │
│  2. BUILD CONTEXT                                               │
│     ├─ Page name                                                │
│     ├─ Knowledge base (static or RAG chunks)                    │
│     ├─ Store policies (if e-commerce linked)                    │
│     ├─ Product catalog (if e-commerce linked)                   │
│     ├─ Post message (for comments)                              │
│     ├─ Conversation history (for DMs, compressed if > 8 msgs)  │
│     ├─ Customer context (name + returning status, DMs only)     │
│     ├─ Reply style (professional/casual/enthusiastic)           │
│     └─ Brand voice notes                                        │
│                                                                 │
│  3. CHECK EXACT CACHE (Redis → Postgres fallback)               │
│     Key = SHA256(comment + lang + pageId + kbVersion +          │
│           postMsg + policies + style + promptVersion +          │
│           customerContext)                                      │
│     └─ HIT? → Return cached {reply, intent, confidence, flags} │
│                                                                 │
│  4. CHECK SEMANTIC CACHE (Vector similarity)                    │
│     └─ Skipped for PRICE/PURCHASE_INTENT (exact answers only)  │
│     └─ Skipped when customerContext present (personalized)      │
│     └─ Similar question asked before? → Return cached reply     │
│                                                                 │
│  5. CALL AI WORKER (HTTP POST /generate)                        │
│     ├─ Build system prompt (~3000 words)                        │
│     ├─ Include KB + products + policies                         │
│     ├─ Include conversation history                             │
│     ├─ Call OpenAI gpt-4.1-mini                                 │
│     ├─ Parse JSON response                                      │
│     └─ Run 6 post-validation checks                             │
│                                                                 │
│  6. SAVE TO CACHES (quality-gated: confidence 'low' or          │
│     info/price_not_in_kb / language_mismatch → serve, don't     │
│     cache; kill-switch AI_QUALITY_GATE_ENABLED)                 │
│     ├─ Exact cache (Redis + Postgres)                           │
│     └─ Semantic cache (fire-and-forget)                         │
│                                                                 │
│  7. LOG TOKEN USAGE                                             │
│     └─ userId, pageId, model, tokensIn, tokensOut               │
│                                                                 │
│  RETURN: {reply, intent, confidence, flags}                     │
└─────────────────────────────────────────────────────────────────┘
```

**Post-deploy cache warm** — every deploy replays last week's top AI-replied
comments through the playground pipeline (`backend/src/scripts/warm-reply-cache.ts`,
hooked in `deploy-on-server.sh` after migrations, before traffic switch; pipeline
tag `cache_warm`). Already-cached items are free hits, so the step is idempotent;
after a `PROMPT_VERSION` bump it rebuilds the hot set in minutes instead of the
~week of organic warm-up. Comments on public-mode pages only (DM and dual/private
keys are name-bucketed and can't be warmed). Kill-switch: `WARM_REPLY_CACHE_DISABLED=1`.

## عربي

### الرحلة الكاملة: من رسالة العميل إلى إرسال الرد

**الخطوة 1: استقبال Webhook**
- فيسبوك/إنستغرام يرسل POST إلى الخادم
- التحقق من التوقيع HMAC-SHA256
- إرجاع 200 OK فوراً (عدم حجب)
- إضافة المهمة إلى طابور BullMQ (معالجة غير متزامنة)

**الخطوة 2: العامل يلتقط المهمة**
- 5 عمال متزامنين (قابل للتعديل)
- توجيه حسب نوع المهمة (تعليق فيسبوك، رسالة فيسبوك، تعليق إنستغرام، رسالة إنستغرام)

**الخطوة 3: فحوصات التحقق**
- هل الصفحة موجودة والرد التلقائي مفعّل؟
- هل الرد التلقائي للمنصة مفعّل؟
- هل نحن ضمن ساعات العمل؟ (إذا كان الإعداد مفعّلاً)
- هل حد المعدل مقبول؟ (5/دقيقة للتعليقات، 10/دقيقة للرسائل)
- هل هناك توقف تسليم نشط؟ (وكيل بشري)
- هل تم الرد مسبقاً؟
- إزالة الازدواجية (هل هناك رسالة أحدث قادمة؟)

**الخطوة 3ب: القفل الموزع (Redis)**
- اكتساب قفل لكل محادثة (SET NX EX 60)
- إذا كان محجوزاً → تخطي (عامل آخر يعالج)
- يُحرر في كتلة finally عبر سكريبت Lua CAS

**الخطوة 4: رسالة الترحيب** (للرسائل المباشرة فقط)
- فقط عند أول رسالة مباشرة من المرسل (على الإطلاق)
- كشف لغة العميل تلقائياً
- إرسال ترحيب → تعليم كمُرد عليها → **توقف** (لا معالجة AI بعد الترحيب)
- عند الفشل: تجاوز إلى الذكاء الاصطناعي كاحتياطي

**الخطوة 5: تأخير الرد** (إذا كان مُعدّاً)
- انتظار X ثانية
- يسمح لرسائل متتالية بالتجمع

**الخطوة 6: دمج الرسائل**
- جلب جميع الرسائل غير المرد عليها من نفس المرسل
- دمجها لسياق الذكاء الاصطناعي
- استخدام أحدث رسالة لمطابقة القوالب

**الخطوة 7أ: مطابقة القوالب**
- البحث في القواعد النشطة حسب الأولوية
- مطابقة الكلمات المفتاحية (دعم خاص للعربية: الجذور والبادئات)
- إذا تطابقت → استخدام قالب الرد (بدون تكلفة AI)

**الخطوة 7ب: توليد رد الذكاء الاصطناعي**
- فحص حد الاشتراك
- بناء السياق (قاعدة معرفة + منتجات + سياسات + تاريخ محادثة + سياق العميل)
- سياق العميل (للرسائل المباشرة فقط): اسم العميل + حالة عميل عائد
- فحص الكاش الدقيق (Redis/Postgres) — يشمل سياق العميل في المفتاح
- فحص الكاش الدلالي (تشابه متجهات) — يُتخطى عند وجود سياق عميل مخصص
- استدعاء AI Worker (OpenAI gpt-4.1-mini)
- حفظ في الكاش

**الخطوة 8: فلاتر الأمان**
- محتوى مسيء؟ → تخطي الرد وتعليم للمراجعة
- هلوسة أسعار (طبقتين)؟
  - الطبقة أ: رقم مجاور لعملة (SAR/$/ريال)
  - الطبقة ب: عبارة سعرية + رقم قريب (مثل "سعره 120"، "only 50")
  - → رد آمن بديل
- ثقة منخفضة؟ → احتجاز للمراجعة البشرية (مع عرض مسودة AI في واجهة المراجعة)
- تعليق > 50 كلمة؟ → إضافة علم `comment_too_long`
- تعليق > 280 حرف؟ → اقتطاع عند حدود الجملة (الوضع العام فقط)

**الخطوة 8ب: مؤشر الكتابة** (للرسائل المباشرة فقط)
- إرسال مؤشر "يكتب..." إلى Messenger/Instagram قبل الرد
- يجعل الرد يبدو أكثر طبيعية

**الخطوة 9: إرسال الرد**
- عبر واجهة Facebook/Instagram Graph API
- تعليم الرسالة كمُرد عليها في قاعدة البيانات
- تخزين الرسالة الصادرة
- إشعار التاجر إذا تم التعليم

---

# 3. Decision Tree
# شجرة القرارات

## English

```
CUSTOMER SENDS MESSAGE/COMMENT
│
├── Is page valid & auto-reply enabled?
│   └── NO → ❌ Ignore (log error)
│
├── Is platform auto-reply enabled? (comments/messages separately)
│   ├── Comments OFF → ❌ Ignore silently (comment still stored) → STOP
│   └── Messages OFF → Send AWAY MESSAGE (language-matched, first msg only) → STOP
│
├── Is businessHoursOnly enabled?
│   ├── YES → Is it within business hours?
│   │   └── NO → Same as "platform disabled" above:
│   │       ├── Comments → ❌ Ignore silently → STOP
│   │       └── Messages → Send AWAY MESSAGE (first msg only) → STOP
│   └── NO → Continue
│
├── Is there an active HANDOFF PAUSE? (human agent took over)
│   └── YES → Re-enqueue with delay → STOP (max 3 retries)
│
├── Rate limit exceeded? (>5/min comments, >10/min messages per sender)
│   └── YES → ❌ Skip silently → STOP
│
├── Already replied to this message?
│   └── YES → ❌ Skip → STOP
│
├── [DM only, fast-path] Is there a newer unreplied message? (debounce)
│   └── Skipped when replyDelay > 0 (delay acts as consolidation window)
│   └── YES → ❌ Skip (newer job will handle) → STOP
│
├── ACQUIRE DISTRIBUTED LOCK (Redis SET NX EX 60)
│   └── ALREADY HELD → ❌ Skip (another worker handling) → STOP
│   └── ACQUIRED → Continue (released in finally block via Lua CAS)
│
├── [DM only] Is this the FIRST message ever from sender?
│   └── YES → Send GREETING MESSAGE (always present — seeded at workspace creation,
│             backfilled by migration 0095), mark as replied, RETURN early
│   └── Greeting send failure → fall through to AI as fallback
│
├── [If configured] Wait reply delay (consolidation window)
│
├── [DM only, post-delay] Re-check debounce after delay
│   └── YES → ❌ Skip (newer job arrived during delay) → STOP
│
├── [DM only] Consolidate unreplied messages from same sender
│
├── Try POST REPLY MATCHING (per-post trigger: keyword match, or any-comment mode)
│   ├── any-comment mode → run skip rules (spam/friend-tag/promo-link) + complaint
│   │   keyword-guard + handoff-pause gate + per-post 24h cap BEFORE sending,
│   │   inside the per-comment idempotency check + lock (postReplyRule.ts).
│   │   Content-free comments ("." / emoji / digits) SEND — dot-CTA (D-021)
│   └── MATCH → Use Post Reply → Go to Safety Filters
│
├── Is AI enabled?
│   └── NO → ❌ No reply generated → STOP
│
├── Check subscription limit (can use AI?)
│   └── NO → Send generic fallback → Go to Send
│
├── BUILD AI CONTEXT:
│   ├── Knowledge Base (static or RAG chunks)
│   ├── Store products (if e-commerce linked)
│   ├── Store policies (if e-commerce linked)
│   ├── Post message (if comment)
│   ├── Conversation history (if DM)
│   ├── Reply style + brand voice
│   └── Channel type (comment vs DM)
│
├── Check EXACT CACHE → HIT? → Go to Safety Filters
├── Check SEMANTIC CACHE (skipped for PRICE/PURCHASE_INTENT) → HIT? → Go to Safety Filters
│
├── CALL AI WORKER → OpenAI gpt-4.1-mini
│   └── TIMEOUT/ERROR → Return FALLBACK reply
│
├── SAVE to caches (exact + semantic) — quality-gated: replies the model
│   marked weak (confidence 'low', info_not_in_kb, price_not_in_kb,
│   language_mismatch) are served but never cached
│   (services/cacheQualityGate.ts, counters metrics:cache:quality_gate:*)
│
├── SAFETY FILTERS:
│   ├── Intent = OFFENSIVE or SPAM? → Flag → ❌ DON'T reply → STOP
│   ├── Flag = price_not_in_kb AND intent QUESTION/PURCHASE_INTENT?
│   │   → Replace with SAFE FALLBACK (other intents: flag-only, no swap)
│   │   (Tier A: currency-adjacent number not in KB)
│   │   (Tier B: price-cue phrase + nearby number not in KB)
│   ├── Confidence = low AND holdLowConfidence? → ❌ DON'T send (AI draft saved for review) → STOP
│   ├── [Comment] Reply > 50 words? → Add `comment_too_long` flag
│   ├── [Comment, public mode] Reply > 280 chars? → Truncate at sentence
│   ├── [Comment + QUESTION/PURCHASE] → Auto-append "DM us!"
│   └── [Comment + dual mode] → Pick random nudge variation (anti-spam)
│
├── [DM only] SEND TYPING INDICATOR → "typing..." to Messenger/Instagram
│
├── SEND REPLY via Graph API
│   └── FAIL → ❌ Don't mark as replied → STOP
│
└── SUCCESS:
    ├── Mark message as replied (DB transaction)
    ├── Store outgoing message
    ├── Mark older consolidated messages as replied
    └── Notify merchant if flagged (needsAttention)
```

## عربي

```
العميل يرسل رسالة/تعليق
│
├── هل الصفحة صالحة والرد التلقائي مفعّل؟
│   └── لا → ❌ تجاهل
│
├── هل الرد التلقائي للمنصة مفعّل؟ (التعليقات/الرسائل منفصلة)
│   ├── التعليقات مُعطّلة → ❌ تجاهل بصمت (التعليق يُحفظ) → توقف
│   └── الرسائل مُعطّلة → إرسال رسالة الغياب (أول رسالة فقط) → توقف
│
├── هل وضع ساعات العمل فقط مفعّل؟
│   ├── نعم → هل نحن ضمن ساعات العمل؟
│   │   └── لا → نفس سلوك "المنصة مُعطّلة" أعلاه:
│   │       ├── التعليقات → ❌ تجاهل بصمت → توقف
│   │       └── الرسائل → إرسال رسالة الغياب (أول رسالة فقط) → توقف
│   └── لا → متابعة
│
├── هل هناك توقف تسليم نشط؟ (وكيل بشري تولى المحادثة)
│   └── نعم → إعادة جدولة مع تأخير → توقف
│
├── هل تجاوز حد المعدل؟ (>5/دقيقة تعليقات، >10/دقيقة رسائل)
│   └── نعم → ❌ تخطي → توقف
│
├── هل تم الرد مسبقاً؟
│   └── نعم → ❌ تخطي → توقف
│
├── [رسائل مباشرة] هل هناك رسالة أحدث غير مُرد عليها؟
│   └── نعم → ❌ تخطي (المهمة الأحدث ستتولى)
│
├── اكتساب قفل موزع (Redis SET NX EX 60)
│   └── القفل محجوز → ❌ تخطي (عامل آخر يعالج) → توقف
│   └── تم الاكتساب → متابعة (يُحرر في كتلة finally عبر Lua CAS)
│
├── [رسائل مباشرة] هل هذه أول رسالة من المرسل (على الإطلاق)؟
│   └── نعم → إرسال رسالة ترحيب → تعليم كمُرد عليها → **توقف** (لا AI)
│   └── فشل الإرسال → تجاوز إلى AI كاحتياطي
│
├── محاولة مطابقة القوالب (قواعد الكلمات المفتاحية)
│   └── تطابق → استخدام قالب الرد
│
├── هل الذكاء الاصطناعي مفعّل؟
│   └── لا → ❌ لا رد → توقف
│
├── بناء سياق الذكاء الاصطناعي
│   ├── قاعدة المعرفة
│   ├── منتجات المتجر (إذا متصل)
│   ├── سياسات المتجر (إذا متصل)
│   ├── محتوى المنشور (للتعليقات)
│   ├── تاريخ المحادثة (للرسائل المباشرة)
│   └── أسلوب الرد + ملاحظات العلامة التجارية
│
├── فحص الكاش (الدلالي يُتخطى لنوايا PRICE/PURCHASE_INTENT) → استدعاء AI Worker إذا لم يوجد
│
├── فلاتر الأمان:
│   ├── مسيء/سبام؟ → تعليم للمراجعة → لا رد
│   ├── هلوسة أسعار؟ → رد آمن بديل
│   ├── ثقة منخفضة + احتجاز مفعّل؟ → احتجاز للمراجعة (مع حفظ مسودة AI)
│   ├── [تعليق] > 50 كلمة؟ → إضافة علم `comment_too_long`
│   ├── [تعليق، وضع عام] > 280 حرف؟ → اقتطاع عند حدود الجملة
│   ├── [تعليق + سؤال] → إضافة "راسلنا للتفاصيل!"
│   └── [تعليق + وضع مزدوج] → اختيار صيغة تنبيه عشوائية (مكافحة السبام)
│
├── [رسائل مباشرة فقط] إرسال مؤشر "يكتب..."
│
└── إرسال الرد → تعليم كمُرد عليه → تخزين → إشعار
```

---

# 4. AI Prompt Construction
# بناء الأوامر للذكاء الاصطناعي

## English

### What Exactly Gets Sent to OpenAI

The system prompt sent to gpt-4.1-mini is approximately **3,000+ words** and consists of 9 sections:

```
┌─────────────────────────────────────────────────────────────────┐
│                    SYSTEM PROMPT STRUCTURE                       │
│                    (~3000+ words total)                          │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  SECTION 1: ROLE & CONTEXT (~50 words)                         │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │ "You are a [STYLE] customer service assistant for       │   │
│  │  '[pageName]'."                                          │   │
│  │                                                          │   │
│  │  Style mapping:                                          │   │
│  │  • professional → "professional yet approachable —       │   │
│  │    like a knowledgeable colleague"                       │   │
│  │  • casual → "casual and relaxed — like texting a         │   │
│  │    helpful friend who knows the business"                │   │
│  │  • enthusiastic → "upbeat and enthusiastic —             │   │
│  │    genuinely excited to help"                            │   │
│  │                                                          │   │
│  │  Channel mapping:                                        │   │
│  │  • comment → "respond to customer comments on social     │   │
│  │    media posts"                                          │   │
│  │  • dm → "having a conversation with a customer via      │   │
│  │    direct message"                                       │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
│  SECTION 2: INTENT IDENTIFICATION (~850 words)                 │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │ 8 MANDATORY intent categories:                           │   │
│  │                                                          │   │
│  │ 1. QUESTION      - Info seeking (price, hours, etc.)     │   │
│  │ 2. COMPLIMENT    - Positive feedback/praise              │   │
│  │ 3. COMPLAINT     - Negative experience, frustration      │   │
│  │ 4. PURCHASE_INTENT - Wants to buy/order/book             │   │
│  │ 5. GREETING      - Simple hello/hi                       │   │
│  │ 6. BUSINESS_INQUIRY - Partnership/wholesale              │   │
│  │ 7. OFFENSIVE     - Insults, profanity, threats           │   │
│  │ 8. SPAM_OR_IRRELEVANT - Unrelated, ads, links           │   │
│  │                                                          │   │
│  │ + Sarcasm detection rules                                │   │
│  │ + Arabic dialect matching (Egyptian, Levantine, Gulf,    │   │
│  │   Maghrebi, Iraqi, formal)                               │   │
│  │ + Punctuation-only = SPAM                                │   │
│  │ + 9 detailed examples (Arabic + English)                 │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
│  SECTION 3: RESPONSE GUIDELINES BY INTENT (~180 words)         │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │ QUESTION     → Search KB; if not found → "I'll check"   │   │
│  │ COMPLIMENT   → Thank warmly                              │   │
│  │ COMPLAINT    → Apologize, acknowledge, offer help        │   │
│  │ PURCHASE     → Guide how to order/contact                │   │
│  │ GREETING     → Greet back, ask how to help               │   │
│  │ BUSINESS_INQ → Thank, express openness, ask details      │   │
│  │ OFFENSIVE    → Reply = "" (empty), skip                  │   │
│  │ SPAM         → Reply = "" (empty), skip                  │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
│  SECTION 4: GENERAL RESPONSE RULES (~420 words)                │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │ LANGUAGE:                                                │   │
│  │ • Reply in SAME language customer used                   │   │
│  │ • Match dialect naturally                                │   │
│  │                                                          │   │
│  │ COMMENT (public):                                        │   │
│  │ • Max 1-2 sentences, max 40 words                        │   │
│  │ • Never include prices/detailed specs                    │   │
│  │ • Redirect to DM for details                             │   │
│  │                                                          │   │
│  │ DM (private):                                            │   │
│  │ • Can provide full detailed answers                      │   │
│  │ • List ALL options if asked about pricing                │   │
│  │ • Context continuity (vague follow-ups use history)      │   │
│  │ • NEVER say "contact us" when IN a DM                    │   │
│  │                                                          │   │
│  │ EMOJI: 1-2 max, sparingly                                │   │
│  │ BRAND VOICE: Follow brandVoiceNotes if provided          │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
│  SECTION 4b: CUSTOMER CONTEXT (DMs only, conditional)          │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │ Only present when customerContext is available:          │   │
│  │                                                          │   │
│  │ "CUSTOMER CONTEXT: Customer name: محمد.                  │   │
│  │  Returning customer (8 previous messages,                │   │
│  │  last active 2 days ago, past topics: QUESTION)."        │   │
│  │                                                          │   │
│  │ GPT uses this as information — no forced greeting        │   │
│  │ behavior. The AI naturally incorporates the name         │   │
│  │ and returning status when appropriate.                   │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
│  SECTION 5: CRITICAL SAFETY RULES (~960 words)                 │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │ KNOWLEDGE SOURCE:                                        │   │
│  │ • ONLY use <business_knowledge> as source                │   │
│  │ • Do NOT use training data even if correct               │   │
│  │                                                          │   │
│  │ NEVER:                                                   │   │
│  │ • Invent/guess prices, costs, fees                       │   │
│  │ • Make up availability, stock, delivery dates            │   │
│  │ • Invent dates, deadlines, offers                        │   │
│  │ • Promise refunds/returns (unless in KB)                 │   │
│  │ • Provide medical/legal/financial advice                 │   │
│  │ • Share personal customer data                           │   │
│  │ • Discuss affiliate/partner terms                        │   │
│  │                                                          │   │
│  │ WHEN UNSURE:                                             │   │
│  │ "Let me check with the team and get back to you"         │   │
│  │                                                          │   │
│  │ CONFIDENCE SCORING (STRICT):                             │   │
│  │ • HIGH: Every claim backed by KB                         │   │
│  │ • MEDIUM: Partial KB coverage + info_not_in_kb flag      │   │
│  │ • LOW: Not answered by KB + info_not_in_kb flag          │   │
│  │                                                          │   │
│  │ 9 common confidence mistake examples                     │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
│  SECTION 6: BUSINESS KNOWLEDGE (variable size)                 │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │ <business_knowledge>                                     │   │
│  │   [RAG chunks OR static KB, max 16,000 chars]            │   │
│  │   [Store policies, max 2,000 chars]                      │   │
│  │ </business_knowledge>                                    │   │
│  │                                                          │   │
│  │ <product_catalog>                                        │   │
│  │   [Top 15 products, ~800 chars]                          │   │
│  │   Product Name — Price — Variants — Stock Status          │   │
│  │ </product_catalog>                                       │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
│  SECTION 7: JSON OUTPUT FORMAT                                 │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │ Must return:                                             │   │
│  │ {                                                        │   │
│  │   "reply": "text",                                       │   │
│  │   "intent": "QUESTION",                                  │   │
│  │   "confidence": "high|medium|low",                       │   │
│  │   "flags": ["info_not_in_kb", ...]                       │   │
│  │ }                                                        │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
│  SECTION 8: FEW-SHOT EXAMPLES (9 examples)                    │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │ 1. Answer in KB → high confidence                        │   │
│  │ 2. Answer NOT in KB → low + info_not_in_kb               │   │
│  │ 3. Offensive → empty reply + offensive flag              │   │
│  │ 4. WHO question KB has WHAT → low                        │   │
│  │ 5. Sarcasm detection → COMPLAINT                         │   │
│  │ 6. Angry customer → COMPLAINT + angry_customer           │   │
│  │ 7. Partial geo match → medium + info_not_in_kb           │   │
│  │ 8. Related but different concept → low                   │   │
│  │ 9. Price listing in DM → high (list ALL)                 │   │
│  └─────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
```

### Post-Response Validation (6 Checks)

After OpenAI returns, the system runs **6 automated checks**:

| Check | What It Does | Action |
|-------|-------------|--------|
| **Hallucinated Prices** | Matches numbers adjacent to currency tokens (SAR, SR, ريال, $, etc.) and checks if they exist in KB. Ignores dates, phone numbers, delivery times. Since v56 the accepted set is KB values **∪ verified `price_math`** — the model self-reports its cart arithmetic `[{total, terms:[{unit, qty}]}]` and code verifies every `unit` against the KB and that Σ(unit×qty)=total, so a correct computed total (items + delivery) is no longer treated as a hallucination. Additive only: absent/malformed/unverifiable claims fall back to the literal-KB check. Runs on **every intent** (was QUESTION-gated until 2026-07-27 — a purchase-turn «نعم» answered with an invented price went unflagged; the BAMBO regression). | Adds `price_not_in_kb` flag; backend swaps the reply for the safe fallback on QUESTION/PURCHASE_INTENT (flag-only on other intents) |
| **Comment Too Long** | Word count > 50 for comment replies (AI Worker flags it; backend separately truncates at 280 chars for public mode) | Adds `comment_too_long` flag |
| **Language Mismatch** | Reply language differs from input language | Adds `language_mismatch` flag |
| **Hedge Words** | Detects "let me check", "سأتحقق", etc. with high/medium confidence | **Downgrades to LOW** + adds `info_not_in_kb` |
| **DM Deflection** | DM reply says "contact us" / "message us" | Adds `info_not_in_kb` + downgrades confidence |
| **Low Confidence Flag** | Low confidence without `info_not_in_kb` flag | **Auto-adds** `info_not_in_kb` flag |

### Valid Flags

| Flag | Meaning |
|------|---------|
| `info_not_in_kb` | Answer not found in knowledge base |
| `price_not_in_kb` | Reply mentions a price not in KB (hallucination!) |
| `angry_customer` | Customer seems angry/frustrated (structured 6-point trigger list, v19+) |
| `offensive_or_abusive` | Insults, profanity, threats |
| `low_confidence` | AI is uncertain about reply quality |
| `redirect_to_human` | Advised customer to contact human |
| `language_mismatch` | Reply language differs from input |
| `comment_too_long` | Public comment exceeded 50 words |
| `invalid_json` | AI returned non-JSON (parsing fallback) |

### Prompt Version History

| Version | Date | Key Changes | Eval Accuracy |
|---------|------|-------------|---------------|
| **v18** | 2026-03-02 | Customer awareness: pass customer name + returning status as context to GPT. Sharpened style descriptions. Natural behavior rules (vary structure, mirror dialect, emoji mirroring). | 98.3% |
| **v19** | 2026-03-05 | Structured `angry_customer` flag with explicit 5-point trigger list (strong words, refund demands, ignored complaints, exclamation marks, escalation threats). Added confidence rule: reply style changes TONE only, must NOT affect confidence. Added Arabic vague follow-up examples ("وش المدة؟"). | 99.6% |
| **v20** | 2026-03-06 | Made `angry_customer` trigger list non-exhaustive — added catch-all point (6): "any expression of strong dissatisfaction — use your judgment". Added Arabic colloquial examples (زفت/فشل). Clarified: polite complaint alone ≠ angry_customer. | 99.6% |
| **v21** | 2026-03-15 | Prompt tuning for eval accuracy and edge case handling. Workspace-scoped context. | 99.6% |
| **v22–v26** | 2026-03-29 – 2026-04-03 | Iterative prompt refinements and edge case tuning. | 99.6% (last measured at v19) |
| **v27–v30** | 2026-04-03 – 2026-04-15 | Continued prompt refinements, edge case coverage, and tuning. | 97.6% (226 test cases) |
| **v31–v50** | 2026-04-15 – 2026-06-28 | Iterative refinements (see the per-version comments above `PROMPT_VERSION` in `packages/shared/src/index.ts`): dialect mirroring, stale-date guard, comment-on-post context, KB prompt-cache hoist, anti-robotic sign-off rule. | ~96–97% |
| **v51** | 2026-07-04 | Gender-aware Arabic addressing, scoped to **Arabic DMs only** (per-call block under `language === 'ar' && isDM`, NOT the shared static prefix — every other language/comment/business gets a v50-identical prompt). Name surfaced + `ARABIC GENDER` directive matching masculine/feminine from name + self-reference, neutral when unclear. Exact cache name-bucketed for DMs; semantic cache bypassed for DMs. See [`DECISIONS.md` D-015](DECISIONS.md). | no-regression vs v50 |
| **v52** | 2026-07-05 | Source fix for the offer-closing bot-tell ("إذا حابة تفاصيل خبريني"): removed the prompt's three self-contradictions (question-back license beside the ban, `enthusiastic` style license, no clean-ending demonstration) and added two flat-ending few-shot examples in labelled light MSA. Worst-case tic rate 56.7% → 1.7%; deterministic post-strip prototyped and removed as redundant. See D-019/PR #398. | 96.7% (389 tests) |
| **v53** | 2026-07-17 | Gender self-report as structured output: three new required JSON fields (`gender` m/f/unknown, `gender_basis` self/name/unclear, `used_name`) — field docs in the static RESPONSE FORMAT block, reporting instruction inside the Arabic-DM directive only. Feeds the fleet-learned first-name→gender map (`backend/src/services/genderMap.ts`) that re-buckets the DM exact cache by learned gender (`g:m`/`g:f`) instead of per-name, restoring cross-sender cache sharing lost in v51. Save-side gated by the reply's own labels; kill-switch `AI_GENDER_BUCKET_ENABLED`. Map warm-up: passive per-reply learning plus `scripts/backfill-gender-map.ts` — a one-off batch that classifies distinct historical DM first names via a memoized model call (pipeline `gender_name_backfill`) and seeds counters to exactly `MIN_OBSERVATIONS` (unisex/ambiguous → `unknown` → never seeded; a wrong seed self-heals after one contrary organic observation). Superseded in practice by the D-036 dual-variant cache (`g:d`, dark behind `AI_DUAL_VARIANT_ENABLED`): gendered replies store both addressee renderings under one shared key (save-time transform call, `services/genderVariantTransform.ts`, content-invariance guarded); the map's role narrows to picking the rendering at read time. See [`DECISIONS.md` D-030/D-036](DECISIONS.md). | pending eval |

### Fallback Classifier (when AI Worker is down)

When the AI worker circuit breaker opens, the 3-tier fallback chain activates:
1. **Tier 2 — Claude Haiku** (`AI_FALLBACK_MODEL=claude-haiku-4-5-20251001`): attempts LLM classification via Anthropic SDK
2. **Tier 3 — keyword classifier** (`fallbackClassifier.ts`): if Claude also fails, a zero-cost keyword-based classifier provides basic metadata (intent, confidence, flags) instead of returning empty data

The keyword classifier detects:
- Spam/irrelevant (emoji-only, mentions, spam keywords EN/AR/Franco, punctuation-only)
- Compliments (Arabic + English patterns, compliment emoji)
- Basic intent classification via keyword matching

This ensures pipeline metrics and downstream guards still function even without the AI worker.

## عربي

### ما الذي يُرسل بالضبط إلى OpenAI

يتكون الـ System Prompt من **3,000+ كلمة** مقسمة إلى 9 أقسام:

**القسم 1: الدور والسياق** - "أنت مساعد خدمة عملاء [أسلوب] لـ '[اسم الصفحة]'"

**القسم 2: تحديد النية** - 8 فئات إلزامية:
1. **سؤال** (QUESTION) - استفسار عن سعر، مواعيد، إلخ
2. **إطراء** (COMPLIMENT) - ردود إيجابية
3. **شكوى** (COMPLAINT) - تجربة سلبية، إحباط
4. **نية شراء** (PURCHASE_INTENT) - يريد الطلب/الحجز
5. **تحية** (GREETING) - مرحبا/أهلاً
6. **استفسار تجاري** (BUSINESS_INQUIRY) - شراكة/جملة
7. **مسيء** (OFFENSIVE) - إهانات، ألفاظ نابية
8. **سبام** (SPAM_OR_IRRELEVANT) - غير ذي صلة، إعلانات

+ كشف السخرية + مطابقة اللهجة العربية (مصرية، شامية، خليجية، مغاربية، عراقية، فصحى)

**القسم 3: إرشادات الرد حسب النية**
- سؤال → البحث في قاعدة المعرفة؛ إذا لم يُوجد → "خليني أتحقق"
- شكوى → اعتذار وعرض المساعدة
- مسيء → رد فارغ + تخطي

**القسم 4: قواعد الرد العامة**
- التعليقات العامة: جملة أو جملتين فقط، 40 كلمة كحد أقصى
- الرسائل المباشرة: تفاصيل كاملة، أسعار، قوائم
- لا تقل "راسلنا" عندما تكون بالفعل في رسالة مباشرة!

**القسم 4ب: سياق العميل** (للرسائل المباشرة فقط، اختياري)
- يظهر فقط عند توفر سياق العميل
- مثال: "اسم العميل: محمد. عميل عائد (8 رسائل سابقة، آخر نشاط قبل يومين)"
- GPT يستخدم هذه المعلومات بشكل طبيعي — بدون إجبار على التحية

**القسم 5: قواعد الأمان الحرجة**
- استخدم فقط قاعدة المعرفة كمصدر
- لا تخترع أسعار أو مواعيد أو سياسات
- عند الشك: "خليني أتحقق مع الفريق"

**القسم 6: المعرفة التجارية**
- قاعدة المعرفة (حتى 16,000 حرف)
- سياسات المتجر (حتى 2,000 حرف)
- كتالوج المنتجات (أعلى 15 منتج، ~800 حرف)

**القسم 7: تنسيق JSON المطلوب**

**القسم 8: أمثلة (9 أمثلة مفصلة)**

### التحقق بعد الرد (6 فحوصات)

| الفحص | ماذا يفعل | الإجراء |
|-------|-----------|---------|
| أرقام مهلوسة | استخراج الأرقام من الرد والتحقق من وجودها في KB | إضافة علم `info_not_in_kb` |
| تعليق طويل | عدد الكلمات > 50 لردود التعليقات (AI Worker يعلّم؛ الخادم يقتطع منفصلاً عند 280 حرف في الوضع العام) | إضافة علم `comment_too_long` |
| عدم تطابق اللغة | لغة الرد مختلفة عن لغة المدخل | إضافة علم `language_mismatch` |
| كلمات تحفظية | كشف "خليني أتحقق"، "سأتحقق" مع ثقة عالية/متوسطة | **تخفيض إلى منخفض** |
| تحويل في الرسائل المباشرة | الرد يقول "راسلنا" وهو في رسالة مباشرة | إضافة علم + تخفيض الثقة |
| فرض علم الثقة المنخفضة | ثقة منخفضة بدون علم `info_not_in_kb` | **إضافة تلقائية** |

---

# 5. Settings and Their Effects
# الإعدادات وتأثيراتها

## English

### Complete Settings Table

| Setting | Type | Default | Where It Affects |
|---------|------|---------|------------------|
| **commentsAutoReply** | boolean | true | If false, ignore comments silently (no away message) |
| **messagesAutoReply** | boolean | true | If false, send away message (language-matched, first msg only) |
| **commentReplyMode** | enum | 'public' | `public` = visible comment, `private` = DM, `dual` = both |
| **dualReplyNudge** | text | "Details sent in DM" | Appended to public reply in dual mode |
| **businessHoursOnly** | boolean | false | If true, auto-reply ONLY during business hours |
| **businessHoursStart** | time | '09:00' | Start of business hours (timezone-aware) |
| **businessHoursEnd** | time | '18:00' | End of business hours (timezone-aware) |
| **timezone** | string | 'Asia/Damascus' | Used for business hours calculation |
| **aiEnabled** | boolean | true | Master switch: if false, only templates work |
| **replyDelay** | integer | 0 | Seconds to wait before sending (consolidation) |
| **commentEscalationMinutes** | integer | 60 | Auto-flag unreplied comments after X minutes |
| **messageEscalationMinutes** | integer | 30 | Auto-flag unreplied DMs after X minutes |
| **handoffPauseDurationMinutes** | integer | 15 | Pause auto-reply after human takes over |
| **replyStyle** | enum | 'professional' | `professional` / `casual` / `enthusiastic` |
| **brandVoiceNotes** | text | '' | Custom brand voice guidelines (500 char max) |
| **holdLowConfidence** | boolean | false | Hold low-confidence AI replies for review |
| **greetingMessageMulti** | JSONB | seeded | `{ar: "...", en: "...", sourceLang: 'default'}` - first msg to new customer. Seeded at workspace creation (`workspace.ts:createWorkspace`) and backfilled for legacy rows by migration `0095_backfill_default_greeting`. Strings come from `i18n.t('defaultGreeting', lang)` and match the settings UI placeholder so what merchants see in the empty field is what gets sent. **Sending is gated by `greetingMessageEnabled`** — the text alone no longer triggers a send. |
| **greetingMessageEnabled** | boolean | false | Master switch for the greeting message. New merchants default to off (AI handles first message). Migration `0103_lovely_polaris` flips this to true for existing merchants whose `greetingMessageMulti.sourceLang` was already customized, preserving deploy-day behavior. |
| **awayMessageMulti** | JSONB | {} | `{ar: "...", en: "..."}` - sent when off/outside hours |
| **defaultReplyLanguage** | enum | 'ar' | Default if auto-detect fails |
| **autoDetectLanguage** | boolean | true | Detect customer language from message |
| **supportedLanguages** | array | ['en','ar'] | Languages business supports |
| **notificationsEnabled** | boolean | true | Push/in-app notifications. SSE badge/toast are skipped for disabled or disconnected pages. See Notification Channels below |
| **dashboardLanguage** | enum | 'ar' | UI language preference for dashboard |
| **aiModel** | string | gpt-4.1-mini | AI model selection (locked to DEFAULT_AI_MODEL) |
| **dualReplyNudgeMulti** | JSONB | {} | `{ar: "...", en: "..."}` - translated nudge messages |
| **dualReplyNudgeVariations** | JSONB | {} | `{ar: [...], en: [...]}` - anti-spam nudge variations per language |
| **brandVoiceNotesMulti** | JSONB | {} | `{ar: "...", en: "..."}` - translated brand voice notes |

### Notification Channels

| Channel | Status | Details |
|---------|--------|---------|
| **In-app (polling)** | Implemented | `NotificationBell` component polls unread count every 60 seconds |
| **SSE (Server-Sent Events)** | Implemented | Real-time dashboard updates — badge/toast for new messages, flagged replies |
| **Push (Capacitor native)** | Implemented | Native push notifications on iOS/Android via `@capacitor/push-notifications` |
| **E-commerce SMS notifications** | Implemented | Abandoned cart, order confirmed/shipped/delivered, review request — SMS via Vonage, BullMQ queue, per-store templates, Arabic/English auto-detected from phone prefix |

### Mobile / Capacitor

| Item | Details |
|------|---------|
| **Framework** | Capacitor 8 (native wrapper around Next.js) |
| **Platforms** | iOS (`frontend/ios/`) + Android (`frontend/android/`) |
| **Native features** | Push notifications, voice recording, biometric auth guards |
| **Published** | **Android: live** on Google Play (production 2.0.34). **iOS: not live** — 2.0.33 (build 10) resubmitted to App Review 2026-08-13 and `Waiting for Review`; release is MANUAL, so approval alone does not publish |
| **iOS billing posture** | Free stand-alone companion under App Store Guideline **3.1.3(f)** — no IAP, no purchase UI, no external purchase CTA. Enforced by `useIOSRouteGuard` + the `isIOSNative()` / `iosOr()` gates, not by convention. See D-064 (the ruling) and **D-079** (the corrected citation — it is NOT 3.1.3(b)) |

### Comments UI

Comments dashboard groups conversations by commenter + post, so all replies from the same person on the same post appear as a thread.

### Settings Save Flow

```
User saves settings on frontend
         │
         ▼
┌──────────────────────────────────┐
│  1. VALIDATE (Zod schema)        │
│  2. SMART AUTO-TRANSLATION:      │
│     ├─ 1 language changed →      │
│     │   auto-translate to other   │
│     ├─ 2+ languages changed →    │
│     │   sourceLang = 'manual'     │
│     └─ source cleared → reset    │
│  3. UPDATE settings table        │
│  4. INVALIDATE Redis cache       │
│  5. SYNC to workspace settings   │
│     (20+ fields for pipeline)    │
└──────────────────────────────────┘
```

**Settings UI (D-029):** the Auto-Reply section renders as ONE flat board
(`AutoReplyBoardCard`): comments/messages Smart-Replies toggles + an always-on
رد البوست row + the display-mode radiogroup at card level. There is no standalone
"Enable Smart Replies" switch — `aiEnabled` is derived (`commentsAutoReply ||
messagesAutoReply`) by the toggles; the DB column remains and the pipeline still
honors it.

**Read path (D-026):** legacy `GET/PUT /settings` responses serve the pipeline fields
(`PIPELINE_FIELDS` minus `aiModel`) read-through from the **workspace** JSONB store — the
store the reply pipeline actually obeys — failing open to the legacy row on any error.
This keeps the UI truthful for the D-025 new-signup cohort, whose seed (masters OFF,
mode `dual`) exists only in the workspace store while the legacy columns default ON.
`aiModel` stays legacy-authoritative (admin override writes the legacy table directly;
`aiModelResolver` reads it).

## عربي

### جدول الإعدادات الكامل

| الإعداد | النوع | الافتراضي | التأثير |
|---------|-------|-----------|---------|
| **الرد التلقائي على التعليقات** | منطقي | مفعّل | إذا مُعطّل، تجاهل التعليقات بصمت (بدون رسالة غياب) |
| **الرد التلقائي على الرسائل** | منطقي | مفعّل | إذا مُعطّل، إرسال رسالة الغياب (أول رسالة فقط) |
| **وضع رد التعليقات** | اختيار | عام | `عام` = تعليق مرئي، `خاص` = رسالة مباشرة، `مزدوج` = كلاهما |
| **ساعات العمل فقط** | منطقي | مُعطّل | إذا مفعّل، الرد فقط خلال ساعات العمل |
| **بداية ساعات العمل** | وقت | 09:00 | بداية العمل (حسب المنطقة الزمنية) |
| **نهاية ساعات العمل** | وقت | 18:00 | نهاية العمل (حسب المنطقة الزمنية) |
| **المنطقة الزمنية** | نص | آسيا/دمشق | لحساب ساعات العمل |
| **تفعيل الذكاء الاصطناعي** | منطقي | مفعّل | مفتاح رئيسي: إذا مُعطّل، القوالب فقط |
| **تأخير الرد** | رقم | 0 | ثوانٍ قبل الإرسال (نافذة دمج) |
| **أسلوب الرد** | اختيار | مهني | شخصية AI: `مهني` / `ودي` / `حماسي` |
| **ملاحظات صوت العلامة** | نص | فارغ | إرشادات مخصصة لصوت العلامة التجارية |
| **احتجاز الثقة المنخفضة** | منطقي | مُعطّل | الردود منخفضة الثقة تُحتجز للمراجعة البشرية |
| **رسالة الترحيب** | JSONB | {} | `{ar: "...", en: "..."}` - أول رسالة للعميل الجديد |
| **رسالة الغياب** | JSONB | {} | `{ar: "...", en: "..."}` - خارج ساعات العمل |
| **لغة لوحة التحكم** | اختيار | عربي | لغة واجهة المستخدم |
| **نموذج AI** | نص | gpt-4.1-mini | نموذج الذكاء الاصطناعي |
| **نص التنبيه المترجم** | JSONB | {} | `{ar: "...", en: "..."}` - نصوص تنبيه الرد المزدوج |
| **تنويعات نص التنبيه** | JSONB | {} | `{ar: [...], en: [...]}` - صيغ متعددة لتجنب كشف السبام |
| **ملاحظات صوت العلامة المترجمة** | JSONB | {} | `{ar: "...", en: "..."}` - ملاحظات صوت العلامة بلغتين |

---

# 6. With Store vs Without Store
# مع متجر vs بدون متجر

## English

### Scenario Comparison

```
┌────────────────────────────────────────────────────────────────────────┐
│                    WITHOUT E-COMMERCE STORE                            │
├────────────────────────────────────────────────────────────────────────┤
│                                                                        │
│  AI Prompt receives:                                                   │
│  ┌──────────────────────────────────────┐                              │
│  │ <business_knowledge>                 │                              │
│  │   [Knowledge base text only]         │                              │
│  │   (max 16,000 chars)                 │                              │
│  │ </business_knowledge>                │                              │
│  │                                      │                              │
│  │ NO <product_catalog>                 │                              │
│  │ NO store_policies                    │                              │
│  └──────────────────────────────────────┘                              │
│                                                                        │
│  Customer: "كم سعر القميص الأزرق؟"                                     │
│  AI: "خليني أتحقق من الفريق وبرجعلك 😊"                                │
│  → confidence: LOW                                                     │
│  → flags: [info_not_in_kb]                                             │
│                                                                        │
│  Customer: "ما هي ساعات العمل؟"                                        │
│  AI: "ساعات العمل من 9 صباحاً حتى 6 مساءً" (if in KB)                  │
│  → confidence: HIGH                                                    │
│                                                                        │
└────────────────────────────────────────────────────────────────────────┘

> **Native catalog (Stage 2 v2, admin canary):** a store-less page CAN
> still get a `<product_catalog>` block — merchant-entered items from the
> `/catalog` page (`catalog_items` table). Entry points, easiest first:
> **the unified page scan** (`POST /pages/:id/catalog/scan-posts`, D-059 —
> ONE scan that reads the page's recent FB posts (incl. full-res attachment
> images via Vision) AND the merchant's configured Post Reply auto-replies
> on BOTH channels (`posts.trigger_reply` + `instagram_media.trigger_reply`,
> DB-only: no Graph/Vision, works even on a dead token). A fresh post whose
> configured reply is attached becomes ONE complete proposal — name from the
> post, price from the reply — and spends no Vision budget when the post has
> its own text; replies are scanned AGELESS (no window, no bookmark — the
> review sheet's reconcile absorbs re-proposals). A per-page bookmark
> `pages.catalog_scan_last_post_time` makes re-scans propose only NEW posts,
> and it only advances when the posts were actually read AND the AI call
> succeeded. Degrades honestly: a blocked page (WhatsApp-only / dead token)
> with replies still scans replies-only, and a transient Graph failure comes
> back as `postsUnavailable: 'graph_error'` — NEVER as «up to date» (the
> fail-soft masking bug); only a page with neither source 409s. The review
> shows what was read («قرأنا: N منشور · M ردّ بوست» — counting only what
> actually reached the extractor: standalone reply blocks lead the 16k
> input so a heavy OCR window can't silently crowd them out, and dropped
> input raises `truncated`). UI entry: «استخراج منتجاتك من صفحتك» — the
> «استورد من ردود منشوراتك» button is REMOVED, merged into this scan;
> `/catalog/scan-post-replies` remains as a deprecated ALIAS of the same
> unified scan because app builds ≤2.0.23 still ship that button. The
> extractor's page framing also names the pseudo-product traps a
> marketing-heavy page produces — the brand itself, a «prices start from»
> headline as an item name, one item per promoting post — and receives the
> page's own name so the model knows what must NOT become an item; the
> 2026-08-08 specimen was the Jawab24 dogfood page scan proposing «جواب24»
> and «الباقات تبدأ من» as $15 products),
> **bulk import** (paste a price list / upload a file →
> extract proposals), and manual add. Entry PRIORITY flipped 2026-08-05
> (owner ruling: the scan under-delivers — prices deliberately live off-post,
> while a pasted list came back 56/56 priced in the الدمشقي replay): the
> empty state leads with the paste import; the scan is a footnote link. The
> whole «المنتجات والخدمات» section HIDES when the page's products live in
> the fact lists (BAMBO: 245 rows — its «أضف ما تبيعه» pitch contradicted
> the readiness card right above it); rule + carve-outs in
> `shouldShowProductsSection` (frontend/src/utils/businessCoverage.ts).
> All paths land in one review sheet
> shaped as a PRICE-COMPLETION step: merchants deliberately keep prices out
> of public posts (comment-bait), so proposals arrive priceless and the
> sheet asks for private prices (only ever sent inside replies — the pitch).
> A page-level **business vertical** (merchant override in
> `pages.catalog_vertical`, else derived from the FB page category, else
> 'other') shapes DEFAULTS only: preselected item type (dealer→vehicle,
> institute→course), date fields shown only for time-bound types, and an
> extraction hint. Items optionally carry `starts_at`/`ends_at` calendar
> dates (rendered as `starts/ends YYYY-MM-DD`; an item past its end date is
> EXCLUDED from the block — the AI can never offer an ended cohort/offer) and
> flexible label+value details (`attributes` jsonb, type-suggested labels,
> rendered as `label: value`). The diagram above shows the default store-less
> page with zero items; the prompt stays byte-identical until the merchant
> adds some.

┌────────────────────────────────────────────────────────────────────────┐
│                    WITH E-COMMERCE STORE                               │
├────────────────────────────────────────────────────────────────────────┤
│                                                                        │
│  AI Prompt receives:                                                   │
│  ┌──────────────────────────────────────┐                              │
│  │ <business_knowledge>                 │                              │
│  │   [RAG chunks from KB]               │                              │
│  │   [store_policies: shipping,         │                              │
│  │    returns, warranty (~2000 chars)]   │                              │
│  │ </business_knowledge>                │                              │
│  │                                      │                              │
│  │ <product_catalog>                    │                              │
│  │   Top 15 products (~800 chars):      │                              │
│  │   1. Blue Shirt — 120 SAR —          │                              │
│  │      S,M,L in Blue — in stock        │                              │
│  │   2. Red Dress — 250 SAR —           │                              │
│  │      S,M,L in Red — in stock         │                              │
│  │   3. ...                             │                              │
│  │ </product_catalog>                   │                              │
│  └──────────────────────────────────────┘                              │
│                                                                        │
│  Customer: "كم سعر القميص الأزرق؟"                                     │
│  AI: "القميص الأزرق سعره 120 ريال، متوفر بمقاسات S, M, L 😊"          │
│  → confidence: HIGH                                                    │
│  → flags: []                                                           │
│                                                                        │
│  Customer: "ما سياسة الإرجاع؟"                                         │
│  AI: "يمكنك الإرجاع خلال 14 يوم من تاريخ الاستلام..."                 │
│  → confidence: HIGH (from policies)                                    │
│                                                                        │
└────────────────────────────────────────────────────────────────────────┘
```

### What Product Data Looks Like in Prompt

```
<product_catalog>
Top Products:
1. iPhone 15 Pro — 3,800 SAR — black, silver, gold — in stock
2. Samsung Galaxy S24 — 2,900 SAR — blue, gray — in stock
3. MacBook Air M3 — 5,200 SAR — 256GB, 512GB — low stock
4. AirPods Pro — 850 SAR — white — out of stock
5. iPad Air — 2,400 SAR — 64GB, 256GB — in stock
...
[Max 15 products, ~800 characters total]
</product_catalog>
```

### Supported E-Commerce Platforms

| Platform | Status | OAuth | Token Expiry | Max Products | Webhook hardening |
|----------|--------|-------|-------------|--------------|-------------------|
| **Shopify** | Active | OAuth 2.0 | Never expires | GraphQL, up to `PRODUCT_SAFETY_CAP` (5000) | ✅ Full (retry incl. THROTTLED, exhaustion flag, manual reregister, frontend recovery UI). Billing: App Pricing mirror (D-054) — `syncShopifyBilling` + 6h reconciler; uninstall cancels the local sub |
| **Salla** | Active | OAuth 2.0 (Custom + **Easy Mode**) | 14 days (auto-refresh, single-use refresh tokens) | REST, up to `PRODUCT_SAFETY_CAP` (5000) | ✅ Full (lifted to platform-agnostic in PR #27, 2026-05-07). Billing: free-tier-only + **Article-5 Stripe guard** (D-065); Salla-managed billing itself ❌ NOT IMPLEMENTED |
| **Zid** | 🔧 Rebuilt — pending live validation (not user-facing) | OAuth 2.0 (dual-token: Bearer + X-Manager-Token) | ~1 year (auto-refresh) | REST, up to `PRODUCT_SAFETY_CAP` (5000) | ✅ Shares the platform-agnostic hardening; deliveries verified via timing-safe Basic auth (Zid sends no HMAC). Rebuilt 2026-08-01 against the docs.zid.sa-verified contract (D-053); still surfaced as "coming soon" until a real dev-store round-trip passes (D-020 gate). Embedded Apps direct access (D-066/D-067) and the App Market **billing rail** (D-070 — verify-first, `GET /v1/market/app/subscription` is the authority, webhooks only trigger) both ship unvalidated for the same reason. See `docs/integrations/zid.md` |

**Salla Easy Mode** (required for the public App Store listing): published apps receive tokens via the server-to-server `app.store.authorize` webhook (the OAuth callback is never hit — Easy Mode drops the app's registered redirect URIs entirely, so the OAuth authorize endpoint 404s for it; proven live 2026-07-18, D-031). `controllers/salla.ts:handleStoreAuthorize` ingests/refreshes tokens idempotently; fresh installs stage a `merchantId`-keyed pending install (`pending_ecommerce_installs.merchant_id`, migration `0123`) that the merchant claims after login via `GET /salla/store/pending` + `POST /salla/store/claim` (landing page `frontend/src/pages/salla/connected.tsx`). The claim is bound by an **owner-email match** (D-031): the store's registered email, fetched live with the pushed token, must equal the logged-in user's (Facebook-verified) email — client-supplied ids never prove ownership. With Easy Mode live, `POST /salla/store/connect` redirects to the public listing (`SALLA_APP_STORE_URL`) instead of the dead OAuth URL. Custom Mode (OAuth redirect) is retained for dev.

**Salla Article-5 billing guard** (D-065, 2026-08-10): Salla's apps-policy Article 5 mandates that paid apps bill through Salla, so a Salla merchant must never reach a Stripe surface. `services/marketplaceBilling.ts:resolveMarketplaceBilling` answers the question in one place for all three rails (D-073; it replaced `mustBillThroughSalla`, which no longer exists — `sallaBilling.ts` survives only as `config/sallaBilling.ts`, holding the Article-5 vocabulary) — true when the **billing subject** (the workspace owner, via `hasActiveStoreForBillingSubject`) has an active Salla store AND no established live Stripe relationship (`config/sallaBilling.ts:hasLiveStripeBilling`; a merchant who was already paying us through Stripe before connecting Salla is exempt). All six **merchant-facing** Stripe entry points refuse with **400 `SALLA_BILLED`** through the shared `rejectIfMarketplaceBilled` guard, which evaluates Shopify's D-G rule first and unchanged (⚠️ the admin manual payment-request path, `services/admin/billing.ts:createPaymentRequest`, is NOT covered by either rail — see `docs/integrations/salla.md`). The UI reads the same answer from the `getUsageSummary` choke point as `subscription.marketplaceBilling` (#720; the Salla-only `sallaBilled` is still on the wire for older bundled app builds, but no web frontend code reads it) — plan select, pricing banner and top-up CTA all go through `frontend/src/lib/marketplaceBilling.ts`, so the frontend can never offer an upgrade the backend then refuses. The `/pricing` bounce on checkout is code-based instead (`isMarketplaceBilledCode`), since that surface can be reached from a stale link before any summary is read. ❌ **Salla-managed billing itself is NOT IMPLEMENTED**: we launch free-tier-only, and the suppression becomes a redirect once `app.subscription.*` webhooks drive a `'salla'` subscription source.

**Webhook recovery infrastructure** (cross-platform, 2026-05-07):
- Shared `registerWebhooksWithPersist` helper in `services/ecommerce.ts` — install path persists status JSONB and enqueues a BullMQ retry on partial or total failure. Install never fails because of webhook hiccups.
- Adapter contract in `integrations/registry.ts` — `IntegrationAdapter.registerWebhooks(store)` and `getWebhookTopics()`. Worker dispatches via `integrationRegistry.get(platform)` instead of switching on platform name.
- Manual recovery endpoint `POST /:platform/store/webhooks/reregister` for all three platforms (one shared handler).
- Frontend integrations card surfaces `webhookHealth` (`ok | pending | failed | unknown`) with a "Try again" button when `failed`. EN + AR.
- Sentry stage tags: `webhook-registration`, `webhook-status-persist-failed`, `webhook-retry-enqueue-failed`, `webhook-retry-exhausted`.
- See [`.planning/codebase/INTEGRATIONS.md`](.planning/codebase/INTEGRATIONS.md#cross-platform-webhook-hardening-shopify--salla--zid) for the full architecture.

### Product Sync → Cache Invalidation

```
Products synced from Shopify/Salla
         │
         ▼
┌──────────────────────────────┐
│ 1. Delete old products       │
│ 2. Insert new products       │
│ 3. Rebuild productSummary    │
│ 4. Update productCount       │
└──────────┬───────────────────┘
           │
           ▼
┌──────────────────────────────┐
│ INVALIDATE AI CACHES:        │
│ 1. Bump kbVersion per page   │
│ 2. Flush Redis exact cache   │
│ 3. Delete semantic cache     │
│ 4. Re-ingest KB + products   │
│    into RAG (new embeddings) │
│ 5. Activate new kbVersion    │
│    (atomic — no empty window)│
└──────────────────────────────┘
```

## عربي

### مقارنة السيناريوهات

**بدون متجر إلكتروني:**
- الذكاء الاصطناعي يحصل فقط على قاعدة المعرفة النصية
- لا كتالوج منتجات، لا سياسات متجر (افتراضيًا)
- **الكتالوج الأصلي (تجربة مغلقة للمؤسس):** يمكن للتاجر بلا متجر إدخال عناصره من صفحة `/catalog` — بفحص منشورات صفحته (قراءة النصوص وصور المنشورات ← استخراج ← مراجعة) أو بالاستيراد الذكي (لصق قائمة أسعار / رفع ملف) أو يدويًا — فتُحقن في كتلة `<product_catalog>` نفسها. المراجعة مصممة كخطوة «إكمال الأسعار»: الأسعار تبقى خاصة وتُرسل فقط داخل الردود، ونوع النشاط (يُستنتج من تصنيف الصفحة في فيسبوك) يهيّئ النموذج تلقائيًا لكل نشاط
- أسئلة عن المنتجات والأسعار → "خليني أتحقق" (ثقة منخفضة)
- أسئلة عامة (مواعيد، موقع) → يُجيب إذا كانت في قاعدة المعرفة

**مع متجر إلكتروني (Shopify/Salla):**
- الذكاء الاصطناعي يحصل على:
  - قاعدة المعرفة + أجزاء RAG
  - سياسات المتجر (شحن، إرجاع، ضمان) — حتى 2,000 حرف
  - كتالوج المنتجات (أعلى 15 منتج) — اسم، سعر، مقاسات/ألوان، حالة المخزون
- أسئلة عن المنتجات → يُجيب بالتفاصيل والأسعار (ثقة عالية)
- أسئلة عن السياسات → يُجيب من سياسات المتجر

**المنصات المدعومة:**
- **Shopify**: نشط، OAuth 2.0، التوكن لا ينتهي أبداً
- **سلة (Salla)**: نشط، OAuth 2.0، التوكن ينتهي كل 14 يوم (تجديد تلقائي)
- **زد (Zid)**: 🔧 أُعيد بناؤه وفق التعاقد الموثّق (2026-08-01) — بانتظار التحقق على متجر تجريبي حقيقي قبل الإتاحة للتجار (بوابة قرار D-020؛ راجع `docs/integrations/zid.md` وقرار D-053)

---

# 7. Knowledge Base and RAG
# قاعدة المعرفة ونظام RAG

## English

### How Knowledge Flows Through the System

```
┌────────────────────────────────────────────────────────────────┐
│                 KNOWLEDGE BASE PIPELINE                        │
├────────────────────────────────────────────────────────────────┤
│                                                                │
│  MERCHANT writes KB text in settings                           │
│  "ساعات العمل من 9 صباحاً حتى 6 مساءً                         │
│   الشحن مجاني للطلبات فوق 200 ريال                             │
│   لدينا فرعين: الرياض وجدة"                                    │
│         │                                                      │
│         ▼                                                      │
│  ┌──────────────────────────────────────┐                      │
│  │  CHUNKING                            │                      │
│  │  Split by double-newline or topic    │                      │
│  │  Auto-detect type per chunk:         │                      │
│  │    • hours → "ساعات العمل من 9..."   │                      │
│  │    • policy → "الشحن مجاني..."       │                      │
│  │    • location → "لدينا فرعين..."     │                      │
│  │  Max 800 tokens per chunk            │                      │
│  └──────────────┬───────────────────────┘                      │
│                 │                                               │
│                 ▼                                               │
│  ┌──────────────────────────────────────┐                      │
│  │  EMBEDDING                           │                      │
│  │  text-embedding-3-small (512 dims)   │                      │
│  │  Normalize Arabic before embedding   │                      │
│  │  Store in kb_chunks table            │                      │
│  │  with pgvector HNSW index            │                      │
│  └──────────────┬───────────────────────┘                      │
│                 │                                               │
│                 ▼                                               │
│  ┌──────────────────────────────────────┐                      │
│  │  VERSION ACTIVATION                  │                      │
│  │  kbVersion bumped                    │                      │
│  │  kbActiveVersion set AFTER all       │                      │
│  │  chunks stored (atomic, no gaps)     │                      │
│  └──────────────────────────────────────┘                      │
│                                                                │
│  ─────────── CUSTOMER ASKS QUESTION ───────────                │
│                                                                │
│  Customer: "هل الشحن مجاني؟"                                   │
│         │                                                      │
│         ▼                                                      │
│  ┌──────────────────────────────────────┐                      │
│  │  HYBRID RETRIEVAL                    │                      │
│  │                                      │                      │
│  │  1. Embed query → vector            │                      │
│  │  2. Vector search: top-20 (HNSW)    │                      │
│  │  3. Trigram re-rank (pg_trgm)       │                      │
│  │  4. Fuse scores:                    │                      │
│  │     0.7 * vector + 0.3 * trigram    │                      │
│  │     + language bonus                 │                      │
│  │  5. Filter > 0.3 threshold          │                      │
│  │  6. Return top-5 chunks              │                      │
│  └──────────────────────────────────────┘                      │
│                                                                │
│  AI receives relevant chunks:                                  │
│  [policy: "الشحن مجاني للطلبات فوق 200 ريال"]                  │
│                                                                │
│  AI reply: "نعم! الشحن مجاني للطلبات فوق 200 ريال 😊"          │
│  → confidence: HIGH                                            │
└────────────────────────────────────────────────────────────────┘
```

### Voice KB Input (Merchant Side)

Merchants can add KB content via voice recording in addition to typing:
- **UI**: `VoiceRecordButton.tsx` in the knowledge-base components
- **Transcription**: `backend/src/services/transcription.ts` — audio sent to GPT-4o-mini-transcribe
- **Flow**: Voice recording → upload → transcribe → transcription text inserted into KB text field → normal chunking/embedding pipeline

### File Upload for KB

Merchants can extract text from documents and images to populate KB content:

| Feature | Details |
|---------|---------|
| **Component** | `FileUploadButton.tsx` in `frontend/src/components/knowledge-base/` |
| **Backend** | `POST /kb/extract-text` — `backend/src/routes/kb-upload.ts` |
| **Extractor** | `backend/src/services/kb/file-extractor.ts` |
| **Formats** | PDF, Word (.docx), images (JPEG, PNG, WebP) |
| **Size limit** | 5MB per file |
| **PDF page limit** | First 5 pages only |
| **Text output cap** | 16,000 chars (same as KB limit) |
| **PDF/Word** | Free — `pdf-parse` v2 + `mammoth` (no API cost) |
| **Images/scanned PDFs** | GPT-4o-mini Vision — Business+ plans only |
| **Daily Vision quota** | Business: 10/day, Pro: 25/day (Redis counter) |
| **UX** | Paperclip icon next to mic icon in each KB section + onboarding |
| **Flow** | Upload → extract text → append to textarea → user reviews → save |

### Incoming Voice & Image Messages (Customer Side)

When a customer sends a voice/audio or image message via Facebook Messenger, Instagram, or WhatsApp:
- **Handler**: `backend/src/services/reply/nonTextHandler.ts`
- **Voice flow**: Audio → GPT-4o-mini-transcribe → transcribed text → fed into AI reply pipeline (same as text message)
- **Image flow**: Image → GPT-4.1-mini vision description (`imageUnderstanding.ts`, `image_understanding` cost pipeline) → description stored/enqueued as `[صورة: …]` / `[Image: …]` (marker protocol shared via `@jawab24/shared` `imageMessage.ts`; drift-guarded against the i18n template) → fed into AI reply pipeline (describe-then-enqueue, mirrors voice). The ai-worker injects a per-call IMAGE MESSAGE prompt directive when the marker is present (and only then — non-image prompts stay byte-identical, no PROMPT_VERSION bump), so a bare screenshot of the merchant's own product/ad is answered as an implicit "available?/price?" inquiry from the KB instead of acknowledged; receipts route to low-confidence human follow-up. Image bytes are **never stored** — only the text description. **No per-merchant toggle** (default-on, like voice); gated by the `IMAGE_UNDERSTANDING_ENABLED` env kill switch + a per-plan daily cap via shared `lib/dailyCap`: free 3 / starter 15 / business 40 / pro 75 / scale-20k 150 / scale-30k 200, **doubled when the merchant has an active top-up (PAYG) balance**. Cost ≈ $0.0015/image (~$2–3/mo). **On `cap_reached` the customer gets NOTHING** (2026-07-26): the photo is stored, the stub finalized, and the *merchant* receives an `image_limit_reached` notification (deduped per UTC day) — the customer is never told, because the old text-only nudge («we can only reply to text and voice») was both false (images were read for that page earlier the same day) and made the merchant's assistant announce a limitation to their own buyer. **Extended 2026-08-11 to every failure that is OURS**, after a guest photographed a bad meal to complain and was told 20.7s later that we only handle text — our vision deadline had fired. `describeFromUrl`/`describeFromBuffer` now return a typed `ImageDescriptionOutcome` instead of a bare `null`, so the caller can tell "this image is unusable" (→ nudge, the customer can act) from "we failed on a readable image" (→ silence). `our_failure` covers the vision timeout, network/OpenAI errors, a dead CDN link — including one answering 200 with an HTML error page — an empty download, an empty completion, and a missing API key. Among the gate denials the line is whether the capability is available at all: `env_disabled` and `no_subscription` keep the nudge (both are true — the feature genuinely cannot run, and a retry will not change that), while `cap_check_failed` now stays silent, since image reading works and only our counter lookup broke — which matters most during a Redis outage, when the nudge would otherwise reach every image sender fleet-wide with its cooldown also failing open. The vision deadline was raised 20s → **25s** in the same change against measured production latency (p50 7.8s / p90 12.8s / **p99 19.7s** across 852 successful reads — the old budget sat exactly on the p99, which is why losses came in bursts). It was deliberately not raised further: the call is awaited inline while holding one of ten global webhook slots, and vision slowdowns are correlated, so a longer deadline risks pinning every slot and 503-ing unrelated webhooks fleet-wide. `jawab24_vision_duration_seconds` now records the distribution including timeouts, so the next adjustment is answerable from `histogram_quantile`. Starter was raised 5 → 15 in the same change: real stores hit 5 before lunchtime, and at $0.00113/image the cap was never protecting meaningful cost.
- **Fallback**: video / file / unknown type, an unusable image, or a failed transcription → store placeholder + send nudge reply. A failure of OURS (see above) or a no-intent attachment stores the placeholder and sends **nothing**. Out-of-domain images (e.g. a legal document) are described factually and flagged by the existing low-confidence/needs-attention guard rather than answered.
- **Non-text types handled**: voice (transcribed), image (vision), video/file (nudge), sticker (silent), Instagram story mentions `story_mention` (silent + auto-resolved — the customer asked nothing, and one resort's entire `[مرفق]` volume was story tags being nudged and then filed as unanswered). ⛔ `ig_story` is NOT in that set — it is a customer REPLYING to the merchant's story, which is how many purchase conversations open (production shows «كم الواحد؟» / «السعر» arriving right after), so it keeps the nudge

### RAG Modes

| Mode | Behavior | Use Case |
|------|----------|----------|
| `off` | No retrieval, use static KB only | Legacy / simple businesses |
| `shadow` | Run retrieval + log, but AI uses static KB | A/B testing retrieval quality |
| `on` | Use retrieved chunks, drop static KB | Production (recommended) |

### KB Gap Detection

When the AI can't find an answer in KB:
1. Query recorded in `kbGaps` table
2. Similar queries deduplicated (trigram similarity)
3. Occurrence count incremented
4. At count **>=3**: merchant notified
5. When merchant updates KB: all gaps auto-resolved

## عربي

### كيف تتدفق المعرفة عبر النظام

**المرحلة 1: التاجر يكتب قاعدة المعرفة**
- نص حر في إعدادات الصفحة
- يُقسم تلقائياً إلى أجزاء حسب الموضوع

**المرحلة 2: التقطيع (Chunking)**
- تقسيم بالسطر المزدوج أو الموضوع
- كشف تلقائي لنوع كل جزء (ساعات، سياسة، موقع، عرض، إلخ)
- حد أقصى 800 توكن لكل جزء

**المرحلة 3: التضمين (Embedding)**
- text-embedding-3-small (512 بُعد)
- تطبيع العربية قبل التضمين (إزالة التشكيل، توحيد الألف)
- تخزين في جدول `kb_chunks` مع فهرس pgvector HNSW

**المرحلة 4: الاسترجاع الهجين عند السؤال**
1. تضمين السؤال → متجه
2. بحث متجهي: أعلى 20 مرشح (HNSW)
3. إعادة ترتيب بالتشابه النصي (pg_trgm)
4. دمج النتائج: 0.7 * متجه + 0.3 * نص + مكافأة اللغة
5. تصفية > عتبة 0.3
6. إرجاع أعلى 5 أجزاء

**الإدخال الصوتي لقاعدة المعرفة (من جانب التاجر):**
- `VoiceRecordButton.tsx` يتيح للتاجر تسجيل محتوى بصوته
- الصوت يُرسل إلى `backend/src/services/transcription.ts` ويُحوَّل نصاً عبر GPT-4o-mini-transcribe
- النص المحوَّل يدخل خط المعالجة المعتاد (تقطيع + تضمين)

**رسائل العميل الصوتية الواردة (من جانب العميل):**
- عند إرسال العميل رسالة صوتية عبر Messenger أو Instagram
- `nonTextHandler.ts` يتولى المعالجة: URL الصوت → GPT-4o-mini-transcribe → النص المحوَّل → خط معالجة AI كرسالة نصية عادية
- عند فشل التحويل أو وجود نوع آخر (صورة، فيديو، ملصق): تخزين نص بديل + إرسال رد توجيهي

**كشف الفجوات:**
- يُسجل السؤال في جدول `kbGaps`
- الأسئلة المتشابهة تُدمج
- عند بلوغ 3 مرات: إشعار للتاجر
- عند تحديث قاعدة المعرفة: كل الفجوات تُحل تلقائياً

---

# 8. Caching Strategy
# استراتيجية التخزين المؤقت

## English

### 3-Layer Cache Architecture

```
Customer question arrives
         │
         ▼
┌──────────────────────────────────────┐
│  LAYER 1: EXACT CACHE (Redis)        │
│                                      │
│  Key: SHA256(                        │
│    normalized_comment +              │
│    language +                        │
│    pageId +                          │
│    kbActiveVersion +                 │
│    postMessage +                     │
│    storePolicies_hash +              │
│    replyStyle +                      │
│    PROMPT_VERSION +                  │
│    customerContext +                 │
│    model +                           │
│    brandVoice_hash +                 │
│    DM bucket (v53: learned gender    │
│      g:m/g:f via genderMap.ts, else  │
│      first-name hash — D-030/D-015)  │
│  )                                   │
│                                      │
│  Value: {reply, intent,              │
│          confidence, flags}          │
│  TTL: 30 days                        │
│                                      │
│  Fallback: PostgreSQL aiCache table  │
├────────────┬─────────────────────────┘
│  MISS      │ HIT → Return (zero cost)
│            │
▼            │
┌──────────────────────────────────────┐
│  LAYER 2: SEMANTIC CACHE (pgvector)  │
│                                      │
│  Query embedding vs cached embeddings│
│  Scoped by:                          │
│    • pageId                          │
│    • intent category                 │
│    • kbActiveVersion                 │
│    • promptVersion                   │
│    • channel (comment/dm) *          │
│    • replyStyle *                    │
│    • model *                         │
│    • brandVoiceHash *                │
│    (* stored in metadata JSONB,      │
│       filtered application-side)     │
│                                      │
│  Thresholds (per intent):            │
│    GREETING: 0.88 (low bar)          │
│    COMPLAINT: 0.95 (high bar)        │
│    Default: 0.93                     │
│                                      │
│  Skipped entirely for:               │
│    • PRICE intent                    │
│    • PURCHASE_INTENT intent          │
│    • COMPLAINT intent                │
│    (exact answers required — only    │
│     exact hash cache remains active) │
│    • customerContext present         │
│    (personalized replies shouldn't   │
│     be served to other customers)    │
│  Skipped for OTHER intent            │
├────────────┬─────────────────────────┘
│  MISS      │ HIT → Return cached reply
│            │
▼            │
┌──────────────────────────────────────┐
│  LAYER 3: FULL AI CALL               │
│                                      │
│  HTTP POST to AI Worker (:3002)      │
│  Circuit breaker protection          │
│  Timeout: 30 seconds                 │
│                                      │
│  On success: save to both caches     │
│  On failure: return fallback reply   │
└──────────────────────────────────────┘
```

### What Invalidates the Cache

| Event | Exact Cache | Semantic Cache |
|-------|------------|----------------|
| KB updated | Old keys stale (new kbVersion) | Old entries filtered out |
| Products synced | Redis flushed | Rows deleted |
| Policies changed | Hash changes = new keys | Auto (part of KB ingest) |
| Reply style changed | New keys (style in hash) | N/A |
| Customer context differs | New keys (context in hash) | Skipped entirely |
| Prompt version bumped | New keys (version in hash) | Old entries filtered |
| Brand voice changed | New keys (voice hash in key) | Old entries filtered (voice hash in metadata) |
| Model override changed | New keys (model in key) | Old entries filtered (model in metadata) |
| DM sender name learns its gender (v53) | Reads move from `n:<name>` to `g:m`/`g:f` bucket (old per-name entries age out via TTL) | N/A (DMs bypass semantic cache) |

## عربي

### بنية الكاش ثلاثية الطبقات

**الطبقة 1: الكاش الدقيق (Redis)**
- مفتاح: SHA256 (التعليق + اللغة + معرف الصفحة + إصدار KB + المنشور + السياسات + الأسلوب + إصدار الأوامر + سياق العميل + النموذج + بصمة أسلوب العلامة)
- القيمة: {الرد، النية، الثقة، الأعلام}
- مدة الصلاحية: 30 يوم
- احتياطي: PostgreSQL

**الطبقة 2: الكاش الدلالي (pgvector)**
- تضمين السؤال مقابل التضمينات المخزنة
- عتبات حسب النية: تحية=0.88، شكوى=0.95، افتراضي=0.93
- **يُتخطى بالكامل** لنوايا PRICE و PURCHASE_INTENT (تحتاج إجابات دقيقة)
- **يُتخطى بالكامل** عند وجود سياق عميل مخصص (ردود مخصصة لا يجب تقديمها لعملاء آخرين)

**الطبقة 3: استدعاء AI كامل**
- HTTP POST إلى AI Worker
- حماية بقاطع الدائرة
- مهلة: 30 ثانية

---

# 9. Safety and Validation
# الأمان والتحقق

## English

### 3-Layer Input Sanitization

```
┌────────────────────────────────────────────────────────────────┐
│                 SANITIZATION LAYERS                             │
├────────────────────────────────────────────────────────────────┤
│                                                                │
│  LAYER 1: Customer Message                                     │
│  • Strip HTML tags                                             │
│  • Remove prompt injection patterns:                           │
│    - "ignore all previous instructions"                        │
│    - "act as", "SYSTEM:", "OVERRIDE:"                          │
│    - Special tokens: <|endoftext|>, etc.                       │
│  • Cap at 2,000 characters                                     │
│                                                                │
│  LAYER 2: KB Content                                           │
│  • Same injection pattern removal                              │
│  • Applied on save AND retrieval                               │
│                                                                │
│  LAYER 3: Page Name                                            │
│  • Remove quotes, newlines, backslashes                        │
│  • Truncate to 100 characters                                  │
│                                                                │
│  LAYER 4: Arabic Text Normalization                            │
│  • Remove diacritics (harakat)                                 │
│  • Normalize alef variants (أ/إ/آ → ا)                        │
│  • Remove tatweel (ـ)                                          │
│  • Normalize Arabic digits (٠-٩ → 0-9)                        │
└────────────────────────────────────────────────────────────────┘
```

### Safety Actions by Scenario

| Scenario | Detection | Action | Merchant Notified? |
|----------|-----------|--------|-------------------|
| Offensive comment | intent = OFFENSIVE | Empty reply, flag for review | Yes |
| Spam/irrelevant | intent = SPAM_OR_IRRELEVANT | Empty reply, don't send | No |
| Price hallucination (Tier A) | `price_not_in_kb` flag — currency-adjacent number not in KB (SAR/$/ريال etc.) and not a verified `price_math` total (v56) | Replace with safe fallback | Yes |
| Price hallucination (Tier B) | `price_not_in_kb` flag — price-cue phrase + nearby number not in KB (e.g. "سعره 120", "only 50", "starts at 200") and not a verified `price_math` total (v56) | Replace with safe fallback | Yes |
| Low confidence + hold | confidence=low + setting on | Don't send, flag for review | Yes |
| Angry customer | `angry_customer` flag | Send reply + notify merchant | Yes |
| AI worker down | Circuit breaker open | Lightweight fallback reply | No |
| Invalid JSON from AI | Parse error | Use raw text + `invalid_json` flag | No |
| Rate limit exceeded | >5/min (comments) or >10/min (messages) | Skip silently | No |

### Circuit Breaker

```
Healthy → CLOSED (normal)
    │
    5 consecutive failures
    │
    ▼
Failing → OPEN (all requests get fallback)
    │
    30-second timeout
    │
    ▼
    HALF-OPEN (try one request)
    │
    ├── Success → CLOSED
    └── Failure → OPEN
```

## عربي

### إجراءات الأمان حسب السيناريو

| السيناريو | الكشف | الإجراء | إشعار التاجر؟ |
|-----------|-------|---------|--------------|
| تعليق مسيء | نية = OFFENSIVE | رد فارغ، تعليم للمراجعة | نعم |
| سبام | نية = SPAM | رد فارغ، لا إرسال | لا |
| هلوسة أسعار (الطبقة أ) | علم `price_not_in_kb` — رقم مجاور لعملة غير موجود في KB | استبدال بالرد الآمن | نعم |
| هلوسة أسعار (الطبقة ب) | علم `price_not_in_kb` — عبارة سعرية + رقم قريب غير موجود في KB (مثل "سعره 120"، "only 50") | استبدال بالرد الآمن | نعم |
| ثقة منخفضة + احتجاز | confidence=low + مفعّل | لا إرسال، مراجعة | نعم |
| عميل غاضب | علم `angry_customer` | إرسال + إشعار التاجر | نعم |
| AI Worker معطل | قاطع الدائرة مفتوح | رد احتياطي خفيف | لا |

---

# 10. Edge Cases and Scenarios
# حالات خاصة وسيناريوهات

## English

### Scenario 1: Rapid-Fire Messages (Debounce + Consolidation)

```
Customer sends 3 messages quickly (replyDelay=0, fast-path debounce):
  t=0ms:   "hi"
  t=200ms: "How much for blue shirt?"
  t=400ms: "Do you have XL?"

RESULT:
  "hi"         → Processed → Reply: "Hi! 👋"
  "blue shirt?" → DEBOUNCED (newer msg exists) → SKIPPED
  "Do you have XL?" → Processed → Reply: "Yes, XL available!"

With replyDelay=3s (consolidation window):
  t=0ms:   "hi"           → Stored, skip debounce, wait 3s...
  t=200ms: "blue shirt?"  → Stored, skip debounce, wait 3s...
  t=400ms: "Do you have XL?" → Stored, skip debounce, wait 3s...

  t=3400ms: "Do you have XL?" job wakes → post-delay debounce: no newer →
            consolidates all 3 → AI reply: "Hi! XL blue shirt is $50, yes available!"
  t=3200ms: "blue shirt?" job wakes → post-delay debounce: newer exists → SKIPPED
  t=3000ms: "hi" job wakes → post-delay debounce: newer exists → SKIPPED
```

### Scenario 2: Human Agent Takes Over

```
0:00 - Customer asks → AI replies
0:05 - Customer follow-up → AI replies
0:10 - Human agent sends manual reply → AUTO-PAUSE (15 min)
0:12 - Customer messages → PAUSED → re-enqueued
0:25 - Pause expires → AI processes → Reply sent
```

### Scenario 3: Comment vs DM - Same Question

```
Question: "كم سعر القميص الأزرق وهل متوفر بمقاس XL؟"

AS COMMENT (public):                   AS DM (private):
─────────────────────                  ──────────────────
"شكراً لسؤالك! راسلنا                  "القميص الأزرق سعره 120 ريال
 وبنعطيك كل التفاصيل 😊"               ومتوفر بمقاسات S, M, L, XL.
                                        نقدر نرسله لأي مكان
• Max 40 words                          بالمملكة والشحن مجاني
• No prices                             للطلبات فوق 200 ريال 😊"
• Redirect to DM
                                       • Full details + prices
                                       • Shipping info included
```

### Scenario 4: DM Context Continuity

```
Msg 1 (customer): "ما هي المنتجات المتوفرة؟"
Reply 1 (AI): "لدينا iPhone 15 Pro بـ 3,800 ريال..."

Msg 2 (customer): "عطيني تفاصيل أكثر"  ← VAGUE

RAG QUERY ENRICHMENT (v14):
  Original query: "عطيني تفاصيل أكثر" (≤6 words = vague)
  Last assistant reply: "لدينا iPhone 15 Pro بـ 3,800 ريال..."
  Enriched query: "لدينا iPhone 15 Pro بـ 3,800 ريال... عطيني تفاصيل أكثر"
  (capped at 300 chars for embedding cost/quality)
  → RAG finds iPhone 15 Pro chunk (not random product!)

AI MUST: Talk about iPhone (from previous exchange)
AI MUST NOT: Ask "which product?" or switch topic
```

### Scenario 5: Outside Business Hours

```
Settings: businessHoursOnly=true, 09:00-18:00, Asia/Riyadh
Customer DMs at 21:00 Riyadh time:
→ Away message sent: "شكراً لتواصلك! سنرد عليك خلال ساعات العمل 🕐"
→ NO AI processing

Customer comments at 21:00 Riyadh time:
→ Comment stored in DB (visible in dashboard)
→ NO reply sent, NO away message (comments don't get away messages)
```

### Scenario 6: Post Reply Match vs AI

```
Post-level trigger: keywords=["سعر","كم"] → "الأسعار على الموقع"
Customer: "كم سعر الشحن؟"
→ "سعر" matches the post's trigger keyword
→ Post Reply sent via DM (AI NEVER called = zero cost!)
```

### Scenario 7: Product Not in Catalog

```
Catalog: iPhone 15, Galaxy S24, AirPods Pro
Customer: "عندكم Samsung Tab S9?"
AI: "خليني أتحقق من توفر Samsung Tab S9 وبرجعلك!"
→ confidence: LOW, flags: [info_not_in_kb]
→ NOT "we don't have it" (inference, not fact!)
```

## عربي

### السيناريو 1: رسائل متتالية سريعة (إزالة الازدواجية + التجميع)
- العميل يرسل 3 رسائل بسرعة
- **بدون تأخير رد** (replyDelay=0): مسار سريع — الرسالة الثانية تُتخطى، فقط 1 و 3 تحصل على ردود
- **مع تأخير رد** (replyDelay=3s): نافذة تجميع — جميع الرسائل تنتظر، ثم تُجمع في رد واحد شامل
- إعادة فحص الازدواجية بعد التأخير تمنع الردود المكررة

### السيناريو 2: الوكيل البشري يتولى
- عند الرد اليدوي → توقف تلقائي 15 دقيقة
- الرسائل خلال التوقف تُعاد جدولتها
- بعد انتهاء التوقف → AI يعود

### السيناريو 3: تعليق vs رسالة مباشرة
- التعليق: 40 كلمة كحد أقصى، لا أسعار، إحالة للرسائل
- الرسالة المباشرة: تفاصيل كاملة، أسعار، شحن

### السيناريو 4: استمرارية السياق (إثراء استعلام RAG - v14)
- "عطيني تفاصيل" بعد الحديث عن منتج → AI يتحدث عن نفس المنتج
- لا يسأل "أي منتج تقصد؟"
- **آلية إثراء الاستعلام**: إذا كان سؤال العميل غامضاً (≤6 كلمات)، يُضاف أول 100 حرف من آخر رد AI إلى استعلام RAG
- **حد أقصى**: 300 حرف للاستعلام المُثرى (للحفاظ على جودة وتكلفة التضمين)
- مثال: "شو مميزاتها؟" → يُصبح "لدينا iPhone 15 Pro بـ 3,800 ريال... شو مميزاتها؟"
- هذا يضمن أن RAG يجد الأجزاء المتعلقة بالمنتج الصحيح بدلاً من منتج عشوائي

### السيناريو 5: خارج ساعات العمل
- الرسائل المباشرة: إرسال رسالة الغياب (أول رسالة فقط)، لا معالجة AI
- التعليقات: تُحفظ في قاعدة البيانات، لا رد ولا رسالة غياب

### السيناريو 6: قالب vs AI
- القوالب تُفحص أولاً = صفر تكلفة عند التطابق

### السيناريو 7: منتج غير موجود
- AI لا يقول "ما عندنا" (استنتاج وليس حقيقة!)
- يقول "خليني أتحقق" → ثقة منخفضة

---

# 11. Known Gaps
# فجوات معروفة ومخاوف

## English

### Current Gaps

| # | Gap | Severity | Impact |
|---|-----|----------|--------|
| 1 | Zid rebuilt but unvalidated against a live store | Medium | The 2026-08-01 rebuild (D-053) replaced the broken auth/endpoint/webhook layer with the docs.zid.sa-verified contract, but payload-shape parsers are provisional until a real dev-store round-trip. **Blocked, and not on the agreement:** app 7367 was **Rejected 2026-08-10** ("OAuth does not yet meet our required standards … Direct merchant access"), and a Rejected app cannot be installed — a real install attempt on dev store 3195980 fails at Zid with `error_code=EC3` before reaching our code. So validation is chicken-and-egg: resubmit first, or validate against a second private dev app. ⚠️ The partnership agreement is an **exit** condition (technical review passes → agreement countersigned), never an entry one — the earlier "unblocks on Zid's approval / agreement In Review" reading cost eight idle days. Stays "coming soon" / not user-facing until then (D-020 gate). **Next step is ours, not Zid's:** deploy the merged Embedded Apps (#704/#708) + billing (#711) work, make the two portal changes, then resubmit 7367 — the ordered path and what is owed in parallel live in `docs/integrations/zid.md` § **What's next**; run-book `docs/testing/ZID_TEST_PLAN.md` |
| ~~2~~ | ~~No scheduled product sync~~ | ~~RESOLVED~~ | Scheduled sync runs every 6 hours via `setInterval` in `index.ts` — **note**: `setInterval` doesn't survive process restart without external scheduler; acceptable for single-instance deploy |
| ~~3~~ | ~~No voice input for KB~~ | ~~RESOLVED~~ | Voice recording via VoiceRecordButton.tsx — transcribed via GPT-4o-mini-transcribe before KB ingestion |
| 4 | Single-language KB | Medium | Must mix both languages in one text |
| 5 | Templates not auto-translated | Low | Manual both-language maintenance |
| 6 | No visual regression tests | Medium | RTL/landscape may break silently (macOS baselines only) |
| 7 | One store per workspace | Low | Multi-store needs workaround |
| ~~8~~ | ~~No pluralization in i18n~~ | ~~RESOLVED~~ | Migrated to next-intl v4 with ICU Message Format support. Arabic uses all 6 CLDR plural forms (zero/one/two/few/many/other) |
| 9 | Inventory is point-in-time | Info | AI adds "verify before ordering" caveat |
| ~~10~~ | ~~E-commerce customer notifications (abandoned cart, order updates, review requests)~~ | ~~RESOLVED~~ | Shipped — SMS via Vonage, BullMQ worker, dedup by platformEventId, opt-in per template (is_enabled=false default) |
| ~~11~~ | ~~Plan-limit "shadow pages": pages connected beyond the plan's slot count were persisted with auto-reply silently OFF (slot went to whichever page Facebook listed first), and their incoming comments were dropped with no DB/inbox trace — merchants read it as "product broken" (June 2026 خوجة case: 9 comments lost; 160 across 3 merchants in 2 days)~~ | ~~RESOLVED~~ | Connect flow now refuses over-limit pages outright and returns their names (`skippedPages`); `pages.auto_reply_disabled_reason` records WHY a page is off (`user`/`trial_block`/`auto_pause`; `plan_limit` is declared but **never written** — see "Why a page went quiet" below); comments on system-disabled pages are stored unreplied (no Graph fetch, no AI) instead of dropped; admin customer page shows per-page reply state |
| ~~12~~ | ~~Facts buried at the tail of a long KB are ignored~~ | ~~RETRACTED~~ | **Diagnosis error, retracted 2026-07-27 same day.** The BAMBO LIBYA deflections attributed to "burial" all ran against kb v9, which contained **no prices** — the price list only entered the KB at v10 (10:20 UTC), after every observed failure. The deflections were honest answers and the price guard fired correctly. Two controlled experiments confirm v61 reads a tail price list fine: playground Cat 69 passes at prod-scale distractor volume (236 outlet lines, prices at 93%/98% depth) and passes with the merchant's stale scripted price-deflection instruction present. Cat 69 (#724–#727) is retained as a **green guard** for long-context tail-fact readability — if it ever fails, that is a real regression. Lesson recorded: check `kb_chunks.kb_version` timestamps against message timestamps before attributing a miss to prompt position |
| 14 | `plans.ecommerceEnabled` is advertised but **never enforced** for the store integration | Medium | The pricing page shows e-commerce as a Business/Pro feature and Starter carries `ecommerceEnabled: false`, but **nothing in the backend gates it**. The flag's only backend reader is `routes/kb-upload.ts:201`, which gates *image extraction (vision)* — unrelated. Its only frontend reader is `pages/pricing.tsx:239`, a feature bullet. Store connect, product sync and the AI order tools have no plan check at all — contrast `whatsappEnabled`, which IS enforced (`controllers/whatsapp.ts:69`), and `maxProducts`, whose non-enforcement is at least stated in code. So a $15 Starter account gets the integration $39 Business is priced for. **Not exploitable today** (zero connected stores; all three integrations are `coming_soon`), which also means fixing it currently costs no migration. ⚠️ **Blocked on the Zid review, not on effort:** the only robust enforcement point is `/auth/callback` (`connectStore` merely mints an OAuth URL, and `GET /auth` does the same thing with **no** `authenticate` preHandler — so gating `connectStore` alone is bypassable). `/auth/callback` is exactly the path Zid's reviewer walks and `EC3` makes it untestable until app 7367 is approved. Sequence: approval → test a real install → then enforce against observed behaviour. ⚠️ Also note **D-071's stated reasoning is inaccurate** — it argues Starter "cannot use" the store integration; in the code it can. The ruling stands on commercial grounds; only its justification is wrong. |
| 13 | No validator for place / name claims | High | Check 1 grounds **numbers** only. A reply can attribute real KB entities to a location that appears nowhere in the KB and nothing flags it — the merchant never sees it in Needs Attention. Found live on BAMBO LIBYA (2026-07-27): asked about العجيلات (absent from both outlet lists), the AI returned the الزاوية list under «أما للعجيلات تحديداً فهذه هي الصيدليات المتوفرة», and repeated it after the customer objected «هدوم مش في العجيلات». Real names, invented city. **A fix was built and REJECTED on measurement (2026-07-28) — do not rebuild it the same way.** The approach was a model self-report (`place_claims`, required in the strict schema) verified against the KB by a validator check. Evidence against it: across **four full eval suites (~1,690 scored tests) the flag fired exactly once, and that once was a false positive** (an honest denial, «هل عندكم صيدلية في مصراتة؟»); meanwhile the new regression case #737 — a replay of the real doubling-down turn — reproduces the fabrication in ~2 of 4 runs at temp 0 **with the guard installed and the flag firing zero times**. The model stops self-reporting precisely when it is defending a wrong claim, so the guard fails open exactly where it is needed. Costs were real (prompt-version bump ⇒ fleet cache flush, a required field on every AI call, and a prompt example that measurably regressed eval #298). **What a real fix needs:** detection from the REPLY TEXT against KB place names, not a self-report. Regression coverage now in place: playground-eval #737 (expectedFail, the only case that reproduces the defect — #728 passes even on unfixed code). **Measurement harness (2026-07-28): `scripts/grounding-audit.ts`** — scores a candidate INDEPENDENT grounding verifier (a separate call over `(business info, question, reply)`, not a self-report) against a labeled set of documented prod fabrications + the must-not-flag shapes, and against a random sample of real prod replies. Ships nothing: no prompt bump, no cache flush, no hot-path code. The prod export keeps only replies whose page has not changed its KB since, so the KB scored IS the KB the model saw. Run it before building any guard for this gap — the eval suite holds ~2 instances of the defect in 1,690 tests, which is what made the last attempt untunable. **FIRST MEASUREMENT (2026-07-28, gpt-4.1-mini):** labeled gate 9/9 recall, 90% precision, and the two honest-denial shapes that killed the self-report guard both stayed clean. Prod sweep over 204 replies from the four accounts that matter (feras/nourva/aliahdab/waleed) fired on **15.7%** (16.1% traffic-weighted), **26 of 32 on replies carrying no flag today**; hand adjudication = **22 real / 4 false / 6 borderline**. BAMBO LIBYA fires at 27.5% — gap 13 is systemic there, not one incident (three more cities got «تلقى منتجاتنا في بعض الصيدليات», plus an invented sunscreen line and invented size-by-weight advice). Two new defect classes surfaced that no existing check covers: a **medical suitability claim** invented on الخليج's medical-devices page, and a reply **thanking a customer for a photo they never sent**. Cost $0.001/reply (57% of input tokens cached). Measured against real spend (ai_usage_log, 30d: dm_reply $48.14 + comment_reply $8.13 over 36,581 calls), that is **~$37/mo ungated = +65% of reply cost**; with the measured gate — skip GREETING/COMPLIMENT/OFFENSIVE (22.5% of replies) and require reply >=80 chars — **62% of replies get verified, 29 of 32 detections survive, ~$23/mo = +40%**. **Model is not a cost lever:** gpt-4.1-nano collapses (78% recall, 50% precision, flags BOTH honest-denial shapes) and gpt-5-mini flags N2 while costing MORE ($0.0015/reply on reasoning tokens). gpt-4.1-mini is the floor. **PHASE 1 BUILT 2026-07-28 (detection only, uncommitted):** `backend/src/services/groundingVerifier.ts` + `config.groundingVerify` (`GROUNDING_VERIFY_ENABLED` OFF by default, plus `GROUNDING_VERIFY_PAGE_IDS` page allowlist so a pilot cannot become a fleet rollout by accident — first pilot is BAMBO LIBYA `8c086c86-c31e-4761-97e3-875ddc79a2eb`, 114 replies/mo ⇒ **$0.08/month**, ~31 flags/mo of which ~20 are invisible today), fired fire-and-forget from messageProcessor/commentProcessor in the same slot as `maybeCaptureLead` — after the send, so it cannot delay or alter a reply. Writes the `reply_not_grounded` flag + claim meta, sets needs_attention, and blocks caching via cacheQualityGate. Pipeline `grounding_verify` in ai_usage_log. 27 gate unit tests; full backend suite green. Phase 2 (inline + reply swap, the industry default) is deliberately NOT built — it changes the request path and needs prod precision first. **STRUCTURAL FIX WIRED 2026-07-28 (G1a, PROMPT_VERSION v62):** the verifier detects; what stops the fabrication is giving enumerable facts a boundary. `fact_collections`/`fact_rows` + `factCollectionsRenderer` now reach the model as `<business_lists>` through `contextEnricher` -> `promptBuilder`, each list followed by a coverage/absence statement DERIVED from the merchant's data (`is_complete` + the distinct key values) — never hand-written, so it cannot embed an assumption the merchant never stated. Alongside it the prompt carries the two rules the measured defect needs: an entry may never be re-attributed to a key it does not carry, and an address elsewhere in the prompt (the business's own address, a post) is not a list entry. Gated on the page HAVING collections, so every page without them gets a byte-identical prompt (unit-pinned). The price guard and `buildGroundingSource` both include the block, so a correctly-quoted outlet or delivery fee cannot be flagged as invented. **Same defect, found on the OTHER block (2026-08-04, fixed):** `buildGroundingSource` omitted the BUSINESS_INFO block, so a reply quoting the merchant's own CONFIRMED address/hours/phone read as invented — those fields reach the model on their own path, never inside `knowledgeBase`. It fired hardest on the page that adopted field authority first: 17 of الفريق الدمشقي's 66 shadow flags in 10 days were his own address, after he moved it out of the KB free text on 08-03. The block is now a `buildGroundingSource` part, passed at both call sites and pinned by a regression test. ⚠️ `scripts/grounding-audit.ts` export mode still reconstructs only `pages.knowledge_base` — read ITS firings on adopting pages as a floor, and prefer the live shadow verdicts. **Evidence, measured on the wired path with a new committed battery (`scripts/place-fabrication-probe.ts` — replies generated through the playground, judged by the shipped verifier; "controls" = a LISTED area and a real price, which must stay answerable):** | arm | absent-place | first ask | near-name | doubling down | controls | where the numbers come from |
|---|---|---|---|---|---|---|
| no mechanism | 9/32 (28%) | — | — | — | — | 2026-07-28 baseline |
| L1 derived coverage statement | 8/48 (16.7%) | 1/6 | 5/6 | 2/6 | 0/24 | this session |
| + prompt rule «match exactly» | 8/48 | 1/6 | 6/6 | 2/6 | 0/24 | NEUTRAL ⇒ reverted |
| + computed match stated as a fact | 12/48 | 3/6 | 5/6 | 4/6 | 0/24 | WORSE ⇒ removed |
| **L2 row gating (shipped default)** | 10/48 | **0/6** | 6/6 † | 4/6 ‡ | **0/24** | `FACT_LIST_MODE=gated`, post-review |

**The lesson, recorded as D-047:** where a fact is decidable by code — "is what the customer named one of this merchant's registered values?" is a string comparison — decide it in code and enforce it by CONTROLLING WHAT THE MODEL SEES. Telling the model failed twice (a rule: neutral; the computed result as a prompt fact: worse — it started answering "yes, but I don't have the list"). Row gating (`factCollectionsMatcher.ts` + `displayRows` in the renderer) eliminated the first-ask class outright: a model never given «صيدلية السنونو» cannot place it anywhere. † the near-name class stops being a FABRICATION under gating — no unmatched outlet name is named at all; what the verifier still flags is an unsupported availability inference about the business's OWN address, a data gap only the merchant can close (already on Feras's question list: «هل مقرّك نقطة بيع مباشرة؟»). ‡ this probe injects an already-fabricated assistant turn into the history, which gating cannot remove — in production that turn is exactly what gating prevents (0/6), so it measures recovery from a lie this mode stops telling; tracked by the shadow verifier, eval #737 stays `expectedFail`. History sanitization is deliberately NOT built until prod shadow verdicts show real echo cases. **No regression, proven by a controlled same-day A/B at temp 0** (my changes stashed in one arm, everything else identical): baseline **97.3%** / 401 PASS / 17 PARTIAL / 3 FAIL vs this work **97.3%** / 401 / 17 / 3 — the FAIL set is IDENTICAL (#511, #544, #720), so all three predate this work. ⚠️ **But a real INTERACTION was found with an unrelated in-flight prompt change** (another session, `systemPrompt.ts`: the stock «هذه المعلومة غير متوفرة» sentence banned, no-answer wording composed per-customer). 2×2 probe on the listed-area control (#729, «أنا ساكن في عين الدالية، وين نلقاكم؟»), 3-4 samples per cell: main prompt + block+gating → answers with the area's pharmacies 3/3 ✅; main prompt + no gating → 4/4 ✅; **that prompt change + the block → 4/4 answers with the shop ADDRESS instead of the area's pharmacies ❌** (identical with gating on or off, so it is the block/prose difference, not the gate). Neither change is broken alone — the combination is, and the two also collide on PROMPT_VERSION (v62 here, v63 there). **They must be evaluated together before either ships.** Cat 69's other green guards (#724-#730) are intact under gating. A self+persona review of this work found 9 defects before merge, two Critical: the SEMANTIC cache could serve one area's gated reply to a similar question about another (0.91 LOCATION threshold — now skipped on read and write for gated replies), and the row filter matched an attribute's VALUE without checking its LABEL, so a row could surface under a key it does not carry (the same class as the earlier H2). Also fixed: the matcher now reads the consolidated DM burst, so «أنا من عين الدالية» + «وين نلقاكم؟» keeps the customer's own rows; gating logs which list, which values matched, and how many rows were withheld; a fixture typo can no longer break public demo login. What is still open: the reply-text place-name validator (this fix prevents the fabrication on pages whose lists are STRUCTURED; a merchant whose places live only in prose is still unprotected, which is what the shadow verifier is there to see). **SCHEDULES SLICE (2026-07-31, D-052 — the 3rd list shape, ZERO engine code):** the damascus fixture's courses moved to three collections (un-keyed undated prices · keyed cohort slots self-expiring at their start date (originally via the #528 `endsAt` exclusion with `startsAt=endsAt`; since **D-057** the start date owns visibility natively and `endsAt` is descriptive — see `isRowLive` in `@jawab24/shared/factSchedule`) · keyed closed online list), KB prose 12.8k→5.5k in the same step. New battery `scripts/schedule-fabrication-probe.ts` (13 probes × 4, TWO judges: the shipped verifier for invention + a deterministic date-scan, because on the prose arm expired dates are grounded and the verifier is stale-blind by design): baseline 11/32 invented + **17/52 replies serving already-passed dates** + 0/4 able to name an upcoming date → shipped shape **1/52 + 1/52 (one planted-history echo, pinned as eval #744 expectedFail, the #737 twin)**, upcoming-date control 4/4, controls 0/20 both arms. The un-keyed A/B arm proved the keyed gate is load-bearing (cross-attribution returns at 6/32 and stale quotes mutate into invented FUTURE dates). Temp-0 full-suite A/B same day, same pinned script: 97.4% vs 97.1%, failing-case identity clean (#503 genuinely fixed — the un-keyed online list let it affirm «الإنجليزية أونلاين»; keying it applies the enumerated-boundary mechanism). What is still open here: the REAL merchant's rows (extraction + owner review, الدمشقي only per owner ruling 2026-07-31 — BAMBO's prod page is not touched). **SEEDED SAME DAY:** الدمشقي's prod page got its two live collections (47 un-keyed price rows + 50 keyed cohort slots; NO online list — his own KB deleted that section hours earlier) through the compiled service inside the container (same tx + cache invalidation as product writes; verified server-side: matcher gates correctly, coverage enumerates 23 keys, zero past dates reachable). **G1b SLICE 1 (list editor) BUILT same day:** row-level CRUD on `factCollectionsService` (add/update/deleteRow, page-ownership re-checked per call, every write invalidates reply caches, last-row delete refused so a coverage boundary can't be silently dropped) + `/pages/:pageId/fact-collections` API (member read, admin writes, 9 wiring tests) + the «قوائم النشاط» section on /business (renders ONLY when collections exist — absence is the rollout gate; expired rows visible behind a divider for reuse but never in the prompt; completeness = the D-038 tri-state question naming its customer-facing consequence) + `ListRowSheet` (mobile-first, one date field driving startsAt=endsAt — the mirror is now redundant under D-057, where `startsAt` alone governs visibility; a two-field editor is a later slice). Migration 0144 widened `catalog_items.currency` + `fact_rows.currency` varchar(10)→30 — fixing a LATENT prod bug: `CurrencyInput` truncates at 30 by documented contract («ل.س بالعملة القديمة» must fit) but both columns were 10, so an 11–30-char currency passed validation then crashed the insert. **PROSE CLEANUP EXECUTED same day (owner-approved line-by-line review, `.planning/DAMASCUS_CLEANUP_REVIEW.md`):** الدمشقي's live KB cut 13,097 → 6,075 chars via `pagesService.updatePage(…, { skipGapResolution: true })` in the prod container — every price/schedule section removed now lives ONLY in the fact rows (dual-home era over for this page; the 26/7 live incident + the accidental prose+rows probe arm — S1 3/4 stale, S2 4/4 invented vs rows-only 0/4, 0/4 — proved dual-home actively harmful, and the shadow verifier is stale-blind by design so detection could not substitute for removal). All Q&A denials, anchors, address/hours/payment prose kept; post-write md5 = the reviewed text byte-for-byte; kbVersion bump auto-invalidated caches; pre-cleanup original archived locally for one-call rollback. Open: 48h shadow-verifier watch + the guard-on-save slice (KB save containing price/date patterns on a page WITH collections → offer to move them to the lists) **SUB-KEY SLICE (2026-08-06, D-062):** row gating no longer stops at the key. The residual defect the shadow verifier kept flagging as attribute invention is an ILLEGAL JOIN — asked for the انكليزي **مبتدئ** cohort (retired by D-057 while متوسط 1/2 stayed live) the model returned متوسط 1's row verbatim, date + days + time, with the level swapped, 6/8 at prod sampling. The coverage line cannot prevent it: keyed on «الدورة» it *asserts* انكليزي is covered, and what is missing sits one attribute below the key. Fixed in CODE, not prose — a derived record-integrity clause measured 6/8 → 5/8 = NEUTRAL and was reverted (same verdict as the near-name rule, 8/48 vs 8/48; the rejection is recorded in `renderCoverageStatement` so it is not re-proposed, and re-adding it would bump PROMPT_VERSION and flush the semantic reply cache for nothing). `matchAttributeValues` reports which stored attribute values the customer named, grouped by the label they were stored under; `createAttributeScope` then restricts those to values the customer's KEY match actually reaches; `buildFactCollectionsContext` narrows the key-gated rows by each surviving constraint, per ROW. **S9 6/8 borrowed → 0/40** on `scripts/schedule-fabrication-probe.ts`, controls C6/C7/C8 mute in both arms, no prompt change and no extra query. **Three false-denial guards, all found by review before merge and all pinned deterministically** — a constraint may not judge a row that lacks the label (per-collection filtering denied 5 real ICDL cohorts, 0/6 vs 8/8); a value may only constrain rows its own key match reaches (page-global vocabulary let «متقدم», a BARBERING level, withhold all 9 live انكليزي cohorts); and letter-free values need a token boundary (slot time «2-4» matched inside the phone number «0932-4567», and because `composeFactMatchText` reads the conversation's earlier USER turns it poisoned every later question in the thread). Observability: `metrics:facts:rows_gated_subkey` and `metrics:facts:rows_emptied_subkey` — the second is the one to watch, since a correct withhold and a false denial are otherwise indistinguishable in aggregate. Blast radius is pages WITH collections (الدمشقي + demo today). **Still open:** detection (the illegal-join validator, no model call needed); under-specified questions naming no level; a value the merchant recorded nowhere gets no constraint; and normalizer gaps stay invisible (#546 shows the class is real in prod). **G1b SLICE 4 (2026-08-09) — collection CREATION UI:** merchants can now create lists themselves. `POST /pages/:pageId/fact-collections` (admin-gated like every fact write) takes label + first rows through `FactCollectionCreateSchema` — deliberately narrower than the seeder's service input: **no `keyAttr`** (reply-time gating stays an admin/seeder concern; un-keyed lists answer fine, the MES-showrooms precedent) and `source` pinned to `'editor'`. Duplicate labels now answer **409 `DUPLICATE_LABEL`** instead of a raw unique-violation 500 (pre-check + translated 23505 for the race; `uq_fact_collections_page_label` stays the authority), and `createCollection` persists the `structured` shadow it used to silently drop. UI: the /business «قوائم النشاط» section now shows an ADMIN an empty state with «إضافة قائمة» (two-step: `NewListSheet` names the list with inline duplicate refusal → the existing `ListRowSheet` collects the FIRST item → one atomic POST, because a born-empty list renders no prompt block and no card); the same door sits at the bottom of both populated layouts. A plain member still sees nothing on an empty page — every affordance there is a write. The old "absence is the rollout gate" rule is therefore retired for admins; completeness still starts un-asked (D-038). **G1b SLICE 5 (2026-08-10) — RENAMING a list:** creation left the label write-once, and the label is not decoration — `renderFactCollectionBlock` prints it as the header of the list's block, so a merchant's typo is read and quoted by the model, with a DB write the only cure. `PATCH /pages/:pageId/fact-collections/:collectionId` (admin, label only — `keyAttr`/`source`/`isComplete` keep their own doors) now renames one, sharing `FactCollectionCreateSchema`'s label field so create and rename cannot disagree on a valid name, answering the same 409 `DUPLICATE_LABEL` (pre-check + translated 23505), and invalidating the page's reply caches because the prompt changed. A **no-op rename is a no-op**: same label ⇒ the row is returned untouched and NO cache is retired (D-049 — a miss costs 2–4s, a re-save costs nothing). UI: «تعديل الاسم» sits beside the list name in both layouts (the card header on directory pages, the completeness block on entity-card pages — the only per-list surface there), and one `ListLabelSheet` now serves naming and renaming so the trim rule, the 120-char cap and the inline duplicate refusal cannot drift apart. Same slice fixed a shipped copy defect: `lists.errLastRow` told the merchant to «احذف القائمة بالكامل» — an operation the product does not have (`deleteCollection` exists in the service, deliberately unexposed); it now says to edit the row instead. Deleting a whole list stays UNBUILT on purpose (owner ruling 2026-08-10: the real need is fixing a name, and a destructive door over a 200-row list needs a reason better than "the error message mentioned it"). **The section's own copy was also a vertical leak** (owner catch, same day): one fixed sentence promised «كل ما يخص العنصر الواحد في بطاقة واحدة — أسعاره ومواعيده معاً» to EVERY page, which is institute vocabulary asserted at an outlet directory that has no prices, no dates, and is not laid out as cards. The hint is now DERIVED like everything else in this engine — one universal clause («يقتبس جواب من هذه القوائم حرفياً»), plus the card clause only when the page's lists actually join on one entity, plus the expiry clause only when some row carries a date; `lists.tierGap` lost «مواعيد معلنة» for the same reason. Verified across three live shapes: the courses page gets all three clauses, BAMBO's directory and الخليج's single list get only the first. **PORT SAID FULL MIGRATION (2026-08-12, owner-driven) — first merchant 100% off free-text KB onto the lists:** مستشفى جامعة بورسعيد (ws `7027473d…`, allowlisted in #728) now runs on **10 collections / 202 rows** (timetable 34 · eye prices 41 · imaging/labs 31 · inpatient stays 8 · surgery tiers 10 · surgery examples 35 · specialty clinics 14 · checkup programs 3 · physio 5 · other departments 21), KB prose **15,720 → 2,823 chars (98.3% → 17.6% of `KB_MAX_CHARS`)** across three md5-gated same-day passes (seed → probe → cut), after the merchant answered the 6 blocking questions the same evening (رسم عصب dept-split pricing 250/400 neuro vs 350/700 physio NCS, إيكو heart-only + سونار البطن redirect, the 4 orphan timetable cells, canonical hours/HR/insurance texts — all transcribed verbatim). The MRI/CT/X-ray «حسب العضو» hedges moved into their OWN rows beside the specifically-priced organs — the structural kill for the hedge-swallows-specific-price class that produced the «رنين المخ 900 lost 4/8» defect. Two things this migration validated for the next one: (1) **test the cut BEFORE cutting** — `generateForPlayground` with `pipeline:'eval'` (bypasses ALL caches, `ai.ts`) and `knowledgeBase` overridden to the staged post-cut text, same collections both arms; 15-question A/B came back post-cut ≥ pre-cut everywhere and strictly better on one («رنين على الركبة»: the prose+rows dual-home made the LIVE arm conflate MRI with رسم عصب — the same dual-home harm the الدمشقي cleanup recorded), with the page's `kb_gaps` snapshot/restored so probe questions never pollute the merchant's gap list (gap recording fires on `info_not_in_kb` even on eval/playground pipelines). (2) **a runner calling `updatePage` must outlive the fire-and-forget ingestion** or `kbActiveVersion` is left behind its `kbVersion` — the drift reconciler (`pagesService.reingestPage`) self-heals it within minutes, but the clean pattern is polling av in-process before exit. Known residual, both arms equally: **two-hop pricing** («شفط الدهون» → tier ذات مهارة → 10000/5000) is not connected even with the «السعر: حسب درجة العملية» pointer attribute — candidate fix is inlining tier prices into example-row attributes; XGAP eval case pending. |

### System Resilience

| Failure Point | What Happens | User Impact |
|---------------|-------------|-------------|
| AI Worker down | Circuit breaker open → (Tier 2) Claude Haiku → (Tier 3) static reply + keyword classifier | Classified fallback replies (not empty metadata) |
| Redis down | Fail-open → bypass cache + lock | Higher cost, possible double-reply (rare) |
| PostgreSQL down | Fatal → service down | No replies |
| OpenAI API down | Timeout → fallback | Generic replies |
| Facebook API down | Webhook retries | Delayed replies |
| Salla token expires | Auto-refresh | Transparent |
| Reply lock stuck | TTL auto-expires after 60s | At most 60s delay for that sender |
| Page token compromised | AES-256-GCM encrypted at rest | Cannot read token from DB dump |

### Key Numbers

| Config | Value |
|--------|-------|
| AI Model | gpt-4.1-mini |
| Max Output Tokens | 300 |
| Temperature | 0.3 |
| Max Input Tokens | 24,000 |
| KB Max Chars | 16,000 |
| Product Catalog | 15 products, 800 chars |
| Store Policies | 2,000 chars max |
| Rate Limit (Comments) | 5/min per sender per page |
| Rate Limit (Messages) | 10/min per sender per page |
| Comment Reply Length | AI prompt: 40 words, flag: >50 words, hard truncate: >280 chars (public only) |
| Worker Concurrency | 5 jobs |
| Cache TTL | 30 days |
| Prompt Version | v30 |
| Pipeline Outcomes | 20 types x 4 pipelines |
| Eval Accuracy | 97.6% (226 test cases at v27; current prompt is v30) |
| Scheduled Product Sync | Every 6 hours |
| Queue Retries | 3 (exponential backoff) |
| Handoff Pause | 15 minutes default |
| Reply Lock TTL | 60 seconds (Redis SET NX EX) |
| Reply Lock Key (DMs) | `reply_lock:{pageId}:{senderId}` |
| Reply Lock Key (comments) | `reply_lock:comment:{pageId}:{commentId}` |
| DB Migrations | 81 SQL files |
| DB Index | Composite: `(page_id, sender_id, direction, replied, created_at)` |
| Price Detection | Two-tier: Tier A (currency-adjacent) + Tier B (price-cue phrases) |
| Workspace Roles | owner (level 3), admin (level 2), member (level 1) |
| Page Token Encryption | AES-256-GCM at rest |
| E2E Spec Files | 21 Playwright spec files |

## عربي

### الفجوات الحالية

| # | الفجوة | الشدة | التأثير |
|---|--------|-------|---------|
| ~~1~~ | ~~تكامل زد غير مُنفذ~~ | ~~تم الحل~~ | تكامل زد كامل — OAuth، مزامنة، إثراء قاعدة المعرفة، أدوات AI، webhooks |
| ~~2~~ | ~~لا مزامنة تلقائية للمنتجات~~ | ~~تم الحل~~ | مزامنة تلقائية كل 6 ساعات عبر `setInterval` — **ملاحظة**: لا تنجو من إعادة تشغيل العملية؛ مقبول للنشر على خادم واحد |
| ~~3~~ | ~~لا إدخال صوتي لقاعدة المعرفة~~ | ~~تم الحل~~ | تسجيل صوتي عبر VoiceRecordButton.tsx — يُحوَّل نصاً عبر GPT-4o-mini-transcribe قبل الإضافة |
| 4 | قاعدة معرفة بلغة واحدة | متوسط | خلط اللغتين في نص واحد |
| 5 | القوالب لا تُترجم تلقائياً | منخفض | صيانة يدوية |
| 6 | لا اختبارات بصرية | متوسط | أعطال RTL قد لا تُكتشف |
| 7 | متجر واحد لكل مساحة عمل | منخفض | يتطلب حلاً بديلاً للمتعدد |
| ~~8~~ | ~~لا صيغ جمع في الترجمة~~ | ~~تم الحل~~ | تم الترحيل إلى next-intl v4 مع دعم ICU Message Format. العربية تستخدم جميع صيغ CLDR الستة |
| 9 | المخزون نقطة زمنية | معلوماتي | AI يضيف "تأكد قبل الطلب" |
| ~~10~~ | ~~إشعارات العملاء للتجارة الإلكترونية (سلة مهجورة، تحديثات الطلب، طلبات المراجعة)~~ | ~~تم الحل~~ | تم الشحن — SMS عبر Vonage، BullMQ worker، مكافحة التكرار بـ platformEventId، اشتراك اختياري لكل قالب |

### مرونة النظام

| نقطة الفشل | ماذا يحدث | التأثير |
|------------|-----------|---------|
| AI Worker معطل | قاطع الدائرة → مُصنّف احتياطي (تصنيف النية/الثقة/الأعلام بالكلمات المفتاحية) | ردود مُصنّفة (ليست بيانات فارغة) |
| Redis معطل | تجاوز الكاش + القفل | تكلفة أعلى، رد مزدوج ممكن (نادر) |
| PostgreSQL معطل | الخدمة تتوقف | لا ردود |
| OpenAI معطل | مهلة → رد احتياطي | ردود عامة |
| القفل معلق | ينتهي تلقائياً بعد 60 ثانية | تأخير 60 ثانية كحد أقصى لذلك المرسل |
| توكن الصفحة مُخترق | مشفر بـ AES-256-GCM في حالة السكون | لا يمكن قراءة التوكن من نسخة قاعدة البيانات |

---

# 12. Monitoring & Alerting
# المراقبة والتنبيهات

## English

### What's Already Instrumented

Jawab24 has a solid monitoring foundation across 5 layers:

```
┌─────────────────────────────────────────────────────────────────┐
│                  OBSERVABILITY STACK                             │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  LAYER 1: PIPELINE METRICS (Redis counters)                     │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │ 20 outcome types × 4 pipelines = 80 counters            │   │
│  │ Endpoint: GET /health/pipeline-metrics                   │   │
│  │ Auth: x-cleanup-token header                             │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
│  LAYER 2: AI COST TRACKING (PostgreSQL)                         │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │ Every AI call: model, tokensIn, tokensOut, costUsd,      │   │
│  │ cached (bool), pipeline, userId, pageId                  │   │
│  │ Table: ai_usage_log (180-day retention)                  │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
│  LAYER 3: ERROR TRACKING (Sentry)                               │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │ All 5xx errors, async failures, circuit breaker opens    │   │
│  │ Tags: service, context, action                           │   │
│  │ Trace sampling: 10% prod, 100% dev                       │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
│  LAYER 4: STRUCTURED LOGGING (Pino → stdout)                    │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │ Every pipeline step timed with lap timer (⏱ labels)      │   │
│  │ reply_sent event: method, intent, confidence, flags,     │   │
│  │ duration, consolidated count                             │   │
│  │ Auth headers auto-redacted in request logs               │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
│  LAYER 5: HEALTH PROBES (HTTP endpoints)                        │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │ GET /health        → full status (DB, Stripe, AI)        │   │
│  │ GET /health/live   → liveness (always 200)               │   │
│  │ GET /health/ready  → readiness (DB check)                │   │
│  │ GET /health/cache-stats → AI cache metrics               │   │
│  │ GET /health/pipeline-metrics → outcome counters          │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### Why a Page Went Quiet — Reading `pages` Correctly

A dead page has several possible causes that look alike in the admin UI. **Read
`auto_reply_disabled_reason` and `access_token` together** — that pair is the only
reliable discriminator, and guessing from "their plan only allows one page" has already
sent a live investigation down the wrong path (2026-07-31).

| Cause | `auto_reply_disabled_reason` | `access_token` | `token_last_verified_at` | Fix |
|---|---|---|---|---|
| Merchant toggled it off | `user` | present | set | their choice — ask before "fixing" |
| Channel already used its free trial | `trial_block` | **present** | set | subscribe (anti-abuse ledger, applied at connect) |
| Repeated send failures | `auto_pause` | present ⚠️ but possibly DEAD | set | merchant notified since 2026-08 **on Facebook/Instagram only** (in-app+push+email, `pageAutoPause.ts`; a WhatsApp-driven pause is silent by design — the copy is Facebook-specific); re-enable via the dashboard toggle (`pages.ts toggleAutoReply` clears the pause on off→on). ⚠️ A dead token (Graph 190/460, e.g. FB password change) also lands here with a healthy-looking row — then the fix is reconnect FIRST, and a bare re-toggle just re-pauses |
| **Facebook stopped returning the page** | **`NULL`** | **`''` (cleared)** | **`NULL`** | **reconnect via Facebook — upgrading does nothing** |

**A page can also be ARCHIVED (`pages.archived_at` set, since 2026-08-09).** That is a
merchant soft-hide, only offered on a page Facebook has ALREADY disconnected (blank
token) with no live WhatsApp channel behind it — so it never explains why a page went
quiet, it only explains why the merchant cannot see the card. The row and all its data
are intact; hard delete remains admin/GDPR-only. Archived rows are filtered out in
`controllers/pages.ts` `getAll` (the one endpoint every merchant surface reads) and are
deliberately still returned by `pagesService.getPages`, because `syncFromFacebook` builds
its existing-page map and revoke list from that call. `syncFromFacebook` clears
`archived_at` the moment the page reappears in the merchant's Meta grant (both the
existing-page and cross-workspace claim branches); the revoke path never touches it, so a
page that stays out of the grant stays hidden. Both transitions are audited as
`page.archived` / `page.unarchived`. Support sees `archivedAt` on the admin customer page.

Two consequences that are easy to get wrong:

- **The plan limit never turns an existing page off.** Over-limit pages are refused at
  connect and not persisted (see the `auto_reply_disabled_reason` comment in `db/schema.ts`),
  and the guards themselves — `canEnablePage` / `checkPageLimit` in
  `services/subscriptions.ts` — only ever **return** `allowed:false`. They never write to the
  DB, never clear a token, and never retroactively disable a page that is already connected.
  A workspace can still accumulate more `pages` rows than its plan allows across separate
  connects, so a row count above `maxPages` is **not** evidence that the limit disabled
  anything.
- **`plan_limit` is a reserved enum value that nothing in the repo ever writes**
  (stated at `services/reply/commentProcessor.ts:129`). It is honoured on the *read* side
  as a system-disable reason, so it must stay in the union — but it will never appear in
  production data. Do not diagnose from it.

The revoke path (`services/pages.ts`, "disable pages that the user revoked access to in
Facebook") computes its victim list from what `facebookService.getUserPages` returns —
not from our UI selection and not from the plan — then clears the token and **deliberately
nulls the reason** so a stale system reason can't misdescribe the page. That is why
"revoked by Facebook" and "off with no reason recorded" are indistinguishable in the DB.
Since 2026-08-09 it runs **before** the plan-slot check in the same sync, so slots freed
by deselected pages are immediately usable by pages granted in the same Meta grant edit
(the one-shot swap: drop N pages, add one — previously refused on the first attempt).

**`/me/accounts` is not the grant truth — `getUserPages` reconciles it against
`granular_scopes` (2026-08-09).** For New-Pages-Experience / Business-Portfolio pages,
`/me/accounts` can omit *some* granted pages while listing others (InMedia case: the
token's `granular_scopes` carried two page ids, `/me/accounts` returned one — the newly
granted page was invisible to every sync, and had the omission pattern been inverted, the
revoke path would have wrongly disconnected a granted page). `getUserPages` therefore
always diffs `/me/accounts` against the token's `granular_scopes` (`/debug_token`) and
fetches every omitted page individually via `GET /{page-id}`, returning the union. The
reconciliation is best-effort when `/me/accounts` returned pages: a `/debug_token` failure
degrades to the primary list rather than failing the sync (a thrown sync would read as
"user revoked everything").

**Known gaps (both open):** the revoke path writes no distinguishing reason (e.g.
`fb_revoked`), and the merchant is never notified — a `page_disconnected` notification type
exists but is not fired here, so the page simply goes quiet.

### Pipeline Metrics: All 20 Outcomes

These are tracked per pipeline (facebook_comment, instagram_comment, facebook_message, instagram_message, whatsapp_message):

| Outcome | What It Means | Severity |
|---------|--------------|----------|
| `success` | Reply sent successfully | Normal |
| `greeting_sent` | First-conversation greeting sent | Normal |
| `page_not_found` | Page doesn't exist in DB | Error |
| `no_user` | Page has no associated user | Error |
| `no_workspace` | Page has no associated workspace | Error |
| `auto_reply_disabled` | Platform auto-reply toggle off. Comments: if the page was disabled by the SYSTEM (`auto_reply_disabled_reason` = `trial_block`/`auto_pause`, or reserved `plan_limit`) the comment is still stored unreplied (no Graph fetch, no AI); merchant-toggled (`user`, or legacy null) pages drop it silently. DMs are always stored regardless of reason. | Expected |
| `settings_disabled` | Workspace auto-reply master off — AI path only; a configured Post Reply trigger still fires (D-027) | Expected |
| `post_disabled` | Post/media has auto-reply off | Expected |
| `media_disabled` | Instagram media auto-reply off | Expected |
| `debounce_skipped` | Newer message pending, skipped | Normal |
| `handoff_active` | Human agent pause active | Expected |
| `handoff_requeued` | Job re-enqueued after pause | Expected |
| `rate_limited` | Rate limit exceeded (5/min comments, 10/min messages) | Watch |
| `already_replied` | Already replied to this message | Normal |
| `lock_contention` | Redis lock held by another worker | Watch |
| `no_reply_generated` | AI/template failed to generate | Warning |
| `send_failed` | Generated but failed to send | Error |
| `skipped_risky` | Offensive/spam detected | Normal |
| `held_low_confidence` | AI reply held for review | Normal |
| `held_self_identification` | Check 6 stripped the whole reply — withheld for merchant review (always on) | Watch |
| `error` | Unhandled error in pipeline | Error |

### AI Cost Tracking

Every AI call logged to `ai_usage_log` table:

```
┌─────────────────────────────────────────────────────────┐
│  ai_usage_log row:                                      │
│  ┌───────────────────────────────────────────────────┐  │
│  │ userId:     who triggered                         │  │
│  │ pageId:     which page                            │  │
│  │ model:      gpt-4.1-mini                          │  │
│  │ tokensIn:   prompt tokens (0 if cached)           │  │
│  │ tokensOut:  completion tokens (0 if cached)       │  │
│  │ costUsd:    pre-computed USD cost                  │  │
│  │ cached:     true/false                             │  │
│  │ pipeline:   facebook_comment, etc.                │  │
│  │ createdAt:  timestamp                              │  │
│  └───────────────────────────────────────────────────┘  │
│                                                         │
│  Cost computed by estimateCostUsd() from aiPricing      │
│  Fire-and-forget (never blocks reply pipeline)          │
│  On write failure: increments ai_usage_log.dropped      │
└─────────────────────────────────────────────────────────┘
```

### Cache Hit/Miss Events

| Log Event | Meaning |
|-----------|---------|
| `ai_cache_hit_with_metadata` | Redis exact cache hit (full metadata) |
| `ai_cache_hit_postgres` | Postgres fallback hit (Redis missed) |
| `ai_cache_miss_legacy_discarded` | Old format entry discarded |
| `ai_cache_miss_postgres_no_metadata` | Postgres row without metadata (skipped) |
| `ai_cache_miss` | Full miss, calling AI Worker |

### Circuit Breaker Observability

```
Normal operation: CLOSED
         │
    5 consecutive AI Worker failures
         │
         ▼
    OPEN (30 seconds)
    • Sentry warning on first open
    • Pipeline metric: circuit.ai_worker.opened
    • All requests get fallback reply via fallbackClassifier
    •   (keyword-based: detects spam, compliments, basic intents)
         │
    30s timeout expires
         │
         ▼
    HALF-OPEN (probe with Redis lock)
    • 1 request allowed through
    • Success → CLOSED
    • Failure → OPEN again

    Failure counter auto-resets after 300s idle
```

**Redis keys:**
- `cb:ai_worker:failures` — failure counter
- `cb:ai_worker:open` — open state with TTL
- `cb:ai_worker:probe_lock` — half-open probe lock
- `metrics:pipeline:circuit.ai_worker.opened` — total open count

**Config (env vars):**
- `CIRCUIT_BREAKER_FAILURE_THRESHOLD` (default: 5)
- `CIRCUIT_BREAKER_OPEN_DURATION_SECONDS` (default: 30)

### Sentry Integration Map

| Service | Error Tags | When |
|---------|-----------|------|
| Auth | `context: auth, action: create-*` | User/subscription creation |
| Pages | `service: kb-ingestion` | KB update, page sync |
| Facebook | `service: facebook` | Webhook, token refresh |
| Instagram | `service: instagram` | Webhook, token refresh |
| Shopify | `service: shopify` | Webhook registration |
| Salla | `service: salla` | Token refresh, webhooks |
| E-commerce | `service: {platform}` | Cache invalidation, claims |
| Settings | `context: settings` | Workspace sync failures |
| Notifications | `service: notifications` | Push send failures |
| Escalation | `service: escalation` | Sweep/notify failures |
| AI Worker | `circuit: ai_worker` | Circuit breaker opens |

**Sentry config:**
- Prod trace rate: 10%
- Error replay: 10% of errors
- Ignored: `Rate limit exceeded`, `ECONNREFUSED`, `ETIMEDOUT`, `ResizeObserver loop`

### Health Endpoints Detail

| Endpoint | Purpose | Auth | Status Codes |
|----------|---------|------|-------------|
| `GET /health` | Full service status (DB, Stripe, AI circuit) | None | 200 healthy/degraded, 503 unhealthy |
| `GET /health/live` | Liveness probe (Docker/K8s) | None | Always 200 |
| `GET /health/ready` | Readiness probe (DB connectivity) | None | 200 ready, 503 not ready |
| `GET /health/cache-stats` | AI cache: total entries, hits, age | x-cleanup-token | 200/403 |
| `GET /health/pipeline-metrics` | All 20×4 outcome counters | x-cleanup-token | 200/403 |
| `POST /health/cleanup` | Run DB cleanup (cache, logs, tokens) | x-cleanup-token | 200 |

### Database Cleanup Schedule

| Table | Retention | Batch Size | Trigger |
|-------|----------|------------|---------|
| `ai_cache` | 30 days (by `lastUsedAt`) | 1,000 rows | `POST /health/cleanup` |
| `semantic_cache` | KB-version mismatch + 30 days age backstop | 1,000 rows | `POST /health/cleanup` |
| `logs` | 90 days | 1,000 rows | `POST /health/cleanup` |
| `ai_usage_log` | 180 days | 1,000 rows | `POST /health/cleanup` |
| `refresh_tokens` | Expired + revoked >7 days | All | `POST /health/cleanup` |

### Recommended Alert Thresholds

| Alert | Condition | Severity | Action |
|-------|-----------|----------|--------|
| **High error rate** | `error` outcome > 50 in 5 min | Critical | Check logs, likely infrastructure issue |
| **Circuit breaker open** | `circuit.ai_worker.opened` increments | High | AI Worker or OpenAI is down |
| **Send failures spike** | `send_failed` > 20 in 5 min | High | Facebook/Instagram API issue |
| **AI cost spike** | Daily costUsd > 2x baseline | Medium | Cache miss rate high, or traffic spike |
| **No-reply generated** | `no_reply_generated` > 100 in 1h | Medium | Template/AI both failing |
| **Rate limit storm** | `rate_limited` > 500 in 5 min | Medium | Bot/spam attack on a page |
| **Lock contention** | `lock_contention` > 50 in 5 min | Medium | Workers fighting over same sender |
| **Usage log drops** | `ai_usage_log.dropped` > 0 | Low | DB write issues (cost tracking gap) |
| **Cache hit rate low** | Exact cache hits < 30% of total | Low | Check if KB/products changed a lot |
| **Queue backlog** ✅ SHIPPED 2026-07-04 | `alert:reply_queue_backlog`: waiting ≥ 25 jobs OR p95 queue-wait ≥ 15s (15-min window), on 2 consecutive 60s checks; 1h SET-NX cooldown → Sentry + admin email | High | Raise `REPLY_WORKER_CONCURRENCY` first; per-channel queue split only if persistent (D-016) |
| **Held replies pile up** | `held_low_confidence` > 100/day | Low | KB may need updating (too many unknowns) |

### Reply-Queue Wait Metric (shipped 2026-07-04)

The instrument for the D-016 scaling trigger ("sustained queue wait-time"):

- **Sample**: the reply worker records `queueWaitMs = pickup − enqueue − intentional delay` per job (first attempt only — retries measure backoff, not backlog). Stored newest-first in the Redis LIST `metrics:queue_wait:reply` (`ts:waitMs` entries, capped at 2,000), fire-and-forget.
- **Surface**: `GET /analytics/system-health` (admin-guarded) returns a `queue` block — live BullMQ depth (waiting/active/delayed/failed via `getQueueStats()`) + p50/p95/max wait over the last 15 min; rendered as the "Reply Queue" card on `/admin/observability` (polls every 60s).
- **Evaluate**: `services/replyQueueHealth.ts` cron (every 60s, `config.replyQueueHealth`) fires the Queue-backlog alert above. Alert dispatch goes through the shared `services/adminAlerts.ts` helper (SET-NX dedup + Sentry + admin email), also used by the AI cost alerts.
- **Baseline** (measured 2026-07-04, prod): p50 wait 2 ms, p95 6 ms, worst 2.1 s in micro-bursts; ~4% worker utilization at concurrency 8 (~115 jobs/min sustained capacity).

### Structured Log Events: Complete Reference

#### Pipeline Timing (per message/comment)

Every pipeline step is timed with a lap timer:

```
[facebook_message] ⏱ 1-getPage           {ms: 2,  messageId: "..."}
[facebook_message] ⏱ 3-fetchSenderName    {ms: 45, messageId: "..."}
[facebook_message] ⏱ 4-storeMessage       {ms: 8,  messageId: "..."}
[facebook_message] ⏱ 5-debounce           {ms: 3,  messageId: "..."}
[facebook_message] ⏱ 6-isPaused           {ms: 2,  messageId: "..."}
[facebook_message] ⏱ 7-rateLimit          {ms: 1,  messageId: "..."}
[facebook_message] ⏱ 8-settingsCheck      {ms: 4,  messageId: "..."}
...
```

#### Reply Worker Lifecycle

```
[ReplyWorker] Starting job     {jobId, jobType, requestId, attemptNumber, queueWaitMs}
[ReplyWorker] Processing ...   {jobId, requestId, pageId, commentId|messageId}
[ReplyWorker] Job completed    {jobId, jobType, duration, queueWaitMs, replyMethod}
[ReplyWorker] Job failed       {jobId, jobType, duration, error, attemptsMade}
[ReplyWorker] Job stalled      {jobId}  ← watch for these!
```

#### Rate Limiting

```
[RateLimit] comment limit exceeded  {pageId, userId, count: 6, max: 5}  (warn)
[RateLimit] Redis error, allowing   {error: "ECONNREFUSED"}             (error)
```

### Analytics Queries Available

The `analytics` service computes these from live tables (30-day window):

```
{
  totals: { comments, messages, replied, unreplied, replyRate, flagged },
  byMethod: { template: 500, ai: 2500 },
  byIntent: { GREETING: 100, QUESTION: 800, OFFENSIVE: 5, ... },
  byLanguage: { en: 2000, ar: 1200 },
  byPlatform: { facebook: 2500, instagram: 700 },
  flags: { low_confidence: 45, offensive: 2, price_not_in_kb: 10 },
  responseTime: { avgSeconds: 2.3, p50: 1.5, p95: 5.2 }
}
```

### Monitoring Gaps — ALL RESOLVED

| Gap | Resolution |
|-----|------------|
| ~~No database query tracing~~ | Sentry auto-instruments postgres via `@sentry/node` v10+ (tracesSampleRate: 0.1) |
| ~~No Redis latency metrics~~ | Sentry auto-instruments ioredis + Redis PING latency in `/health` endpoint |
| ~~No external API latency tracking~~ | `tracedExternalCall()` in `utils/tracing.ts` — Sentry spans + prom-client histograms with p50/p95/p99 + success/error labels on all Facebook, Shopify, Salla, Translation calls |
| ~~No Prometheus /metrics endpoint~~ | `GET /health/metrics` via `prom-client` — default Node.js metrics (CPU, memory, event loop, GC) + pipeline counters + external API histograms + uptime |
| ~~No frontend RUM~~ | `@sentry/nextjs` with `tracesSampleRate: 0.1` in `sentry.client.config.ts` (LCP, FCP, CLS, route changes) |
| ~~No distributed tracing~~ | Both backend + AI worker use `@sentry/node` v10+ with tracing; trace headers auto-propagated on HTTP calls |

**Admin dashboard**: `/admin/observability` shows service status (DB/Redis/AI circuit latency), reply-queue health (waiting/active/delayed depth + queue-wait p50/p95/max over 15 min), process metrics (RSS, heap, uptime), and external API latency table with p50/p95/p99.

**Merchant-facing analytics** (shipped 2026-04-25): `/ecommerce-analytics` page + a summary widget inside `ConnectedStoreCard` on the integrations page. Aggregates from `customerNotificationsLog` + `messages` over a 30d/90d window. Surfaces revenue recovered (approximate — phone-window matching), carts recovered, AI reply count, notification funnel (delivered/failed/pending) and per-type breakdown. Channel-keyed funnel structure (`{ total, byChannel }`) is forward-compatible with WhatsApp + DM channels when those land. Endpoint: `GET /api/ecommerce-analytics/:storeId?range=30d|90d`. Code: `services/ecommerceAnalytics.ts` + `controllers/ecommerceAnalytics.ts` + `components/analytics/`.

**Rich product cards in DM** (shipped 2026-04-24): when a Messenger or Instagram DM triggers an ecommerce tool that surfaces a product reference (e.g. `check_inventory`) and the synced product has an image, the message pipeline sends a Generic Template carousel (image + price + "View product" button) as a follow-up to the text reply. Uses Meta's `template_type: "generic"` payload via shared `metaMessaging.ts`. Falls back to text-only when no image is available. Card-send failures are fire-and-forget (don't invalidate the text reply). Forward-compatible with WhatsApp Catalog (Phase 5 of `WHATSAPP_PLAN.md`) since the `MessagePlatformAdapter.sendProductCards` interface is platform-agnostic.

## عربي

### ما هو مُراقَب حالياً

النظام يحتوي على 5 طبقات مراقبة:

**الطبقة 1: مقاييس خط الإنتاج (Redis)**
- 20 نتيجة × 4 خطوط إنتاج = 80 عداد
- نقطة وصول: `GET /health/pipeline-metrics`

**الطبقة 2: تتبع تكلفة AI (PostgreSQL)**
- كل استدعاء AI: النموذج، التوكنات، التكلفة بالدولار، مخزن مؤقت أم لا
- جدول: `ai_usage_log` (احتفاظ 180 يوم)

**الطبقة 3: تتبع الأخطاء (Sentry)**
- جميع أخطاء 5xx، الفشل غير المتزامن، فتح قاطع الدائرة
- وسوم: الخدمة، السياق، الإجراء

**الطبقة 4: السجلات المنظمة (Pino)**
- كل خطوة في خط الإنتاج مُوقتة
- حدث `reply_sent`: الطريقة، النية، الثقة، الأعلام، المدة

**الطبقة 5: فحوصات الصحة (HTTP)**
- `/health` → حالة كاملة (قاعدة بيانات، Stripe، دائرة AI)
- `/health/live` → فحص الحياة (Docker)
- `/health/ready` → فحص الجاهزية (اتصال قاعدة البيانات)

### نتائج خط الإنتاج (20 نتيجة)

| النتيجة | المعنى | الشدة |
|---------|--------|-------|
| `success` | الرد أُرسل بنجاح | طبيعي |
| `greeting_sent` | ترحيب أول محادثة | طبيعي |
| `page_not_found` | الصفحة غير موجودة | خطأ |
| `no_user` / `no_workspace` | صفحة بدون مستخدم/مساحة عمل | خطأ |
| `auto_reply_disabled` | الرد التلقائي مُعطّل | متوقع |
| `debounce_skipped` | رسالة أحدث قادمة | طبيعي |
| `handoff_active` | وكيل بشري نشط | متوقع |
| `rate_limited` | تجاوز حد المعدل | مراقبة |
| `lock_contention` | القفل محجوز من عامل آخر | مراقبة |
| `no_reply_generated` | فشل التوليد | تحذير |
| `send_failed` | فشل الإرسال | خطأ |
| `skipped_risky` | محتوى مسيء/سبام | طبيعي |
| `held_low_confidence` | محتجز للمراجعة | طبيعي |
| `held_self_identification` | حُجِب الرد لأن الفحص السادس أزال كل جُمله — بانتظار مراجعة التاجر | مراقبة |
| `error` | خطأ غير متوقع | خطأ |

### عتبات التنبيه المقترحة

| التنبيه | الشرط | الشدة |
|---------|-------|-------|
| **معدل أخطاء عالي** | `error` > 50 في 5 دقائق | حرج |
| **قاطع الدائرة مفتوح** | `circuit.ai_worker.opened` يزداد | عالي |
| **فشل إرسال مرتفع** | `send_failed` > 20 في 5 دقائق | عالي |
| **ارتفاع تكلفة AI** | التكلفة اليومية > 2× الأساس | متوسط |
| **لا رد مُولَّد** | `no_reply_generated` > 100 في ساعة | متوسط |
| **هجوم سبام** | `rate_limited` > 500 في 5 دقائق | متوسط |
| **تنافس على القفل** | `lock_contention` > 50 في 5 دقائق | متوسط |
| **تراكم ردود محتجزة** | `held_low_confidence` > 100/يوم | منخفض |

### فجوات المراقبة

### فجوات المراقبة — تم حل الجميع

| الفجوة | الحل |
|--------|------|
| ~~لا تتبع لاستعلامات قاعدة البيانات~~ | Sentry يتتبع استعلامات postgres تلقائياً عبر `@sentry/node` v10+ |
| ~~لا مقاييس Redis~~ | Sentry يتتبع ioredis تلقائياً + زمن PING في `/health` |
| ~~لا تتبع APIs خارجية~~ | `tracedExternalCall()` في `utils/tracing.ts` — Sentry spans + prom-client histograms مع p50/p95/p99 + تصنيف نجاح/خطأ على جميع استدعاءات Facebook وShopify وSalla وTranslation |
| ~~لا نقطة Prometheus~~ | `GET /health/metrics` عبر `prom-client` — مقاييس Node.js الافتراضية + عدادات خط الإنتاج + histograms APIs الخارجية + وقت التشغيل |
| ~~لا تتبع تجربة المستخدم (RUM)~~ | `@sentry/nextjs` مع `tracesSampleRate: 0.1` (LCP، FCP، CLS، تنقل الصفحات) |
| ~~لا تتبع موزع~~ | كلتا الخدمتين تستخدمان `@sentry/node` v10+ مع تتبع؛ رؤوس التتبع تُنشر تلقائياً |

**لوحة الإدارة**: `/admin/observability` تعرض حالة الخدمات (زمن استجابة DB/Redis/AI circuit)، مقاييس العملية (الذاكرة، heap، وقت التشغيل)، وجدول زمن استجابة APIs الخارجية مع p50/p95/p99.

---

# Launch Defaults (Single Source of Truth)
# القيم الافتراضية عند الإطلاق

These are the **actual production defaults** from the codebase (`workspaceSettings.ts`, `rate-limiter.ts`, `config.ts`, `shared/index.ts`).

هذه هي **القيم الافتراضية الفعلية في الإنتاج** من الكود المصدري.

| Parameter | Default | Source |
|-----------|---------|--------|
| **AI Model** | `gpt-4.1-mini` | `packages/shared` `DEFAULT_AI_MODEL` |
| **Prompt Version** | `v30` | `packages/shared` `PROMPT_VERSION` |
| **Temperature** | `0.3` | `ai-worker/config.ts` |
| **Max Output Tokens** | `300` | `ai-worker/config.ts` |
| **Comments Auto-Reply** | `true` | `workspaceSettings.ts` |
| **Messages Auto-Reply** | `true` | `workspaceSettings.ts` |
| **Comment Reply Mode** | `public` | `workspaceSettings.ts` |
| **Business Hours Only** | `false` (always active) | `workspaceSettings.ts` |
| **Business Hours** | `09:00–18:00` | `workspaceSettings.ts` |
| **Timezone** | `Asia/Damascus` | `workspaceSettings.ts` |
| **AI Enabled** | `true` | `workspaceSettings.ts` |
| **Reply Delay** | `0` seconds (instant) | `workspaceSettings.ts` |
| **Reply Style** | `professional` | `workspaceSettings.ts` |
| **Hold Low Confidence** | `false` | `workspaceSettings.ts` |
| **Auto Detect Language** | `true` | `workspaceSettings.ts` |
| **Default Reply Language** | `ar` | `workspaceSettings.ts` |
| **Rate Limit (Comments)** | `5/min` per sender per page | `rate-limiter.ts` |
| **Rate Limit (Messages)** | `10/min` per sender per page | `rate-limiter.ts` |
| **Comment Flag Threshold** | `> 50 words` → `comment_too_long` flag | `ai-worker/src/services/reply/replyValidator.ts` |
| **Comment Hard Truncate** | `> 280 chars` → truncate at sentence (public mode only) | `commentProcessor.ts` |
| **Completion Token Cap** | `500` (`OPENAI_MAX_TOKENS`); `finish_reason: length` → ONE retry with a brevity instruction (prompt-cache-priced); still truncated → `ai_empty_reply` flag with truncation-specific reason. A successful retry tags the reply `reply_shortened` (informational only — stripped from the alarm flag set in `computeReplyFlags`, never trips needs-attention) → quiet inbox badge (outgoing-row `flag_meta`) + Test Page hint + `replyShortened` on the test-reply response | `ai-worker/src/services/openai.ts`, `backend/src/services/reply/generator.ts` |
| **Cache TTL** | `30 days` | `ai.ts` |
| **Reply Lock TTL** | `60 seconds` | `replyLock.ts` |
| **Handoff Pause** | `15 minutes` | `workspaceSettings.ts` |
| **Circuit Breaker** | `5 failures → 30s open` | env vars |
| **Worker Concurrency** | `5 jobs` | `replyWorker.ts` |
| **KB Max** | `16,000 chars` | prompt builder |
| **Product Catalog** | `15 products, ~800 chars` | `ecommerce.ts` |
| **Product Sync** | every `6 hours` via `setInterval` | `index.ts` |

---

# 14. RBAC & Workspace System
# نظام الأدوار ومساحات العمل

## English

### Multi-Tenant Workspace Architecture

Jawab24 supports **multi-tenant workspaces** with role-based access control (RBAC). Each workspace is an isolated unit containing pages, rules, templates, stores, and team members.

```
┌─────────────────────────────────────────────────────────────────┐
│                    WORKSPACE ARCHITECTURE                        │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  WORKSPACE (isolated tenant)                                    │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │ owner_id, name, slug, logo_url, settings (JSONB)        │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
│  WORKSPACE MEMBERS                                              │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │ workspace_id, user_id, role, joined_at, invited_by      │   │
│  │                                                          │   │
│  │ Roles (3-level hierarchy):                               │   │
│  │  • owner  (level 3): Full control, billing, delete       │   │
│  │  • admin  (level 2): Manage pages, rules, templates,     │   │
│  │                       settings, team members              │   │
│  │  • member (level 1): Read-only dashboard, view messages  │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
│  WORKSPACE INVITES                                              │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │ email/phone, token_hash, role, expires_at, status        │   │
│  │ Token: 48-hour expiry; delivered by email (bilingual)    │   │
│  │   or SMS, with a copy-and-share link as fallback         │   │
│  │ Status: pending → accepted | expired | revoked           │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
│  SCOPED RESOURCES — own workspace_id (source of truth):         │
│  • pages                    • rules                             │
│  • templates                • ecommerce_stores                  │
│  • logs                     • ai_usage_log                      │
│                                                                 │
│  DENORMALIZED COPY of pages.workspace_id (inbox indexes):       │
│  • comments (via posts)     • messages (has page_id)            │
│  • instagram_comments (via instagram_media)                     │
│  ⚠ Moving a page between workspaces MUST re-scope all three     │
│    (services/pages.ts → rescopePageWorkspace). Page row alone   │
│    = inbox strands in the old workspace.                        │
└─────────────────────────────────────────────────────────────────┘
```

### Backend Route Guards

```
Protected routes use requireRole('admin') middleware:
  POST/PUT/DELETE on /pages, /rules, /templates, /settings → admin+
  POST/PATCH/DELETE on /pages/:id/catalog, /pages/:id/fact-collections → admin+
  POST /kb/extract-text, POST /voice/transcribe → admin+
    (AI-cost endpoints; every caller is an admin-only authoring surface)
  GET on /pages, /rules, /templates, /messages, /pages/:id/kb-gaps → member+
  GET on /pages/:id/catalog, /pages/:id/fact-collections → member+
  POST /workspace/invite, DELETE /workspace/members → admin+
  DELETE /workspace → owner only
```

Refusals answer `403` with `code: 'INSUFFICIENT_ROLE'` (in the workspace, wrong
role) or `code: 'WORKSPACE_ACCESS_DENIED'` (no longer a member). The frontend
classifies both through `utils/authorizationOutcome.ts` — one place, because
three surfaces must agree that a refusal is an OUTCOME, not a defect: they
explain it to the merchant, leave a Sentry breadcrumb, and file **no** error.
`WORKSPACE_REQUIRED` is deliberately excluded — that one IS a client bug.

### Frontend RBAC UX

- **Route guards**: Protected pages check user role before rendering
- **Read-only mode**: a `member` gets the same screens with the write
  affordances removed, never a blank page or a disabled text box — reading is
  the whole point of their role. Gated surfaces: /settings, /integrations,
  /pages, and every section of /business (products catalog, fact rows, fact
  lists, and the Business Info editor, which also serves the /pages screen and
  the inbox's in-conversation editor via `KnowledgeBasePanel`).
  Editors go `readOnly`, never `disabled`, so the text stays selectable and
  reachable by keyboard.
- **Permission banner**: view-only surfaces render the shared
  `<ViewOnlyBanner />` — "Only admins can make changes" / «المشرفون فقط يمكنهم
  إجراء تعديلات» (`common.viewOnlyHint`)
- **403 toast**: a refused write names who *can* do it, rather than "try again"
- **Team management UI**: Admins can invite members, assign roles, revoke access
- **Workspace context**: Set via `X-Workspace-Id` header; auto-selected if user has only 1 workspace

> Invites carry no role picker (`createInvite` takes none) — everyone joins as
> `member` and is promoted from /team. Until 2026-08-06 the Business Info editor
> and the /business sections ignored the role entirely: a member could fill in a
> whole document and only learn on Save, via a generic failure that also filed a
> Sentry error. Fixed by gating at `KnowledgeBasePanel` (the single choke point
> behind all four entry points) and threading one `canEdit` through /business.

### Database Tables (Migration 0034+)

| Table | Key Columns |
|-------|-------------|
| `workspaces` | id, owner_id, name, slug, logo_url, settings (JSONB) |
| `workspace_members` | workspace_id, user_id, role, joined_at, invited_by |
| `workspace_invites` | email, token_hash, role, expires_at, status, workspace_id |

## عربي

### بنية مساحات العمل متعددة المستأجرين

Jawab24 يدعم **مساحات عمل متعددة المستأجرين** مع التحكم بالوصول حسب الأدوار (RBAC). كل مساحة عمل وحدة معزولة تحتوي على الصفحات والقواعد والقوالب والمتاجر وأعضاء الفريق.

**الأدوار (3 مستويات):**
- **مالك** (المستوى 3): تحكم كامل، الفواتير، الحذف
- **مدير** (المستوى 2): إدارة الصفحات، القواعد، القوالب، الإعدادات، أعضاء الفريق
- **عضو** (المستوى 1): قراءة فقط، عرض لوحة التحكم والرسائل

**نظام الدعوات:**
- رابط دعوة قابل للمشاركة مع صلاحية 48 ساعة
- الحالات: معلقة → مقبولة | منتهية | ملغاة

**حماية الواجهة الأمامية:**
- الأعضاء يرون لوحة التحكم لكن العناصر التفاعلية معطلة
- تلميحات الصلاحيات: الأزرار المعطلة تظهر "تحتاج صلاحية مدير"
- إشعار 403 عند محاولة إجراء غير مصرح

---

# 15. Security: Token Encryption
# الأمان: تشفير التوكنات

## English

### Authentication Architecture

**Identity model:** **Facebook OAuth is the primary, sole reliable identity.** Phone is optional and is **never collected during onboarding**. (The codebase was originally architected with phone as a co-primary identity for phone-OTP login; that path is **retired** — see below.)

**Login methods:**
- **Facebook OAuth (primary, always on)** — the reliable identity for every user; never gated behind a phone step.
- **Phone OTP (behind `PHONE_AUTH_ENABLED`, currently OFF — SMS retired)** — E.164 phone → 6-digit code → JWT + 60-day refresh token. **SMS delivery is broken across the core markets** (Syria is sanctions-blocked; Saudi Arabia/KSA denies foreign A2P SMS; Libya unreliable), so phone auth is disabled everywhere. The OTP infrastructure (`otpService`, `otp_codes`, `/auth/phone/*`) is **preserved** and will be re-enabled on a **WhatsApp Cloud API** channel for deliverable regions — **Syria stays permanently exempt** (no OTP channel, SMS or WhatsApp, can reach it). The undeliverable-region prefix list lives in `@jawab24/shared` (`SMS_BLOCKED_DIAL_PREFIXES` / `isSmsBlockedPhone`).

**OTP security:** (preserved for the WhatsApp rollout)
- Codes bcrypt-hashed before storage (10 rounds)
- Dummy bcrypt compare on missing record (timing attack prevention)
- Max 3 attempts per OTP, 1 OTP per phone per 60s
- 5-minute expiry, automatic cleanup

**Session security:**
- Access token: 15-minute JWT (HMAC-SHA256, RFC 7519 — exp in seconds)
- Refresh token: 60-day opaque token, DB-stored, rotated on every use
- Cookies: HttpOnly + Secure + SameSite:strict
- Feature flag: `PHONE_AUTH_ENABLED` / `NEXT_PUBLIC_PHONE_AUTH_ENABLED` — single switch gating **all** phone UI (login phone tab, the dormant phone-collect page, team phone invites, sidebar phone fallback) AND the `/auth/phone/*` routes. Currently OFF. Onboarding **never** forces a phone regardless of the flag (decoupled at the code level — `requiresPhone` removed from the OAuth callbacks).
- **Team invites are email-only** while phone auth is off (phone invites depend on SMS, which is retired)

---

### Page Token Encryption at Rest

Facebook page access tokens are now **encrypted at rest** using AES-256-GCM encryption.

```
┌─────────────────────────────────────────────────────────────┐
│                 TOKEN ENCRYPTION FLOW                         │
├─────────────────────────────────────────────────────────────┤
│                                                               │
│  Facebook OAuth returns access_token                          │
│         │                                                     │
│         ▼                                                     │
│  ┌───────────────────────────────────────┐                    │
│  │  maybeEncryptToken(token)              │                    │
│  │  • If FACEBOOK_TOKEN_ENCRYPTION_KEY    │                    │
│  │    is configured → AES-256-GCM encrypt │                    │
│  │  • Store: "enc:v1:iv:ciphertext.tag"  │                    │
│  │  • Key is REQUIRED in production       │                    │
│  │    (startup fails fast without it)     │                    │
│  └───────────────┬───────────────────────┘                    │
│                   │                                            │
│                   ▼                                            │
│  Stored in pages.access_token column                          │
│  (users.facebook_access_token same scheme)                    │
│                                                               │
│  ─────────── ON READ ───────────                              │
│                                                               │
│  ┌───────────────────────────────────────┐                    │
│  │  safeDecryptToken(stored)              │                    │
│  │  • If starts with "enc:v1:" → decrypt │                    │
│  │  • Otherwise → return as-is (legacy)  │                    │
│  │  • Decrypt failure → Sentry + treat   │                    │
│  │    page as disconnected (never 500s)  │                    │
│  │  • Transparent to all consumers       │                    │
│  └───────────────────────────────────────┘                    │
│                                                               │
│  E-commerce store tokens also encrypted:                      │
│  • Shopify: access_token + IV columns                         │
│  • Salla: access_token + refresh_token + IV columns           │
│                                                               │
│  Backfill script: migrate-encrypt-page-tokens.ts              │
│  (covers pages + users tables; idempotent, safe to re-run)    │
└─────────────────────────────────────────────────────────────┘
```

## عربي

### تشفير توكنات الصفحات في حالة السكون

توكنات الوصول لصفحات فيسبوك الآن **مشفرة في حالة السكون** باستخدام تشفير AES-256-GCM.

- **عند الحفظ**: تشفير AES-256-GCM، التخزين بصيغة `enc:v1:iv:ciphertext.tag` — المفتاح **إلزامي في الإنتاج** (يفشل التشغيل فوراً بدونه)
- **عند القراءة**: إذا كان يبدأ بـ `enc:v1:` → فك التشفير، وإلا → إرجاع كنص عادي (للتوافق مع القديم)
- **فشل فك التشفير** (صف تالف أو مفتاح خاطئ) → تبليغ Sentry + تُعامل الصفحة كغير متصلة بدلاً من تعطيل لوحة التحكم
- **شفاف تماماً** لجميع المستهلكين — توكنات المستخدمين (`users.facebook_access_token`) بنفس الآلية
- توكنات المتاجر الإلكترونية (Shopify/Salla) مشفرة أيضاً مع أعمدة IV
- سكريبت التعبئة `migrate-encrypt-page-tokens.ts` يغطي جدولي الصفحات والمستخدمين، وآمن لإعادة التشغيل

---

# 16. Content & SEO
# المحتوى وتحسين محركات البحث

## English

### Blog System

A full bilingual blog system was added for SEO and content marketing:

- **Data**: TSX data files at `frontend/src/data/blog-posts.ts`
- **Pages**: `frontend/src/pages/blog/index.tsx` (listing) + `frontend/src/pages/blog/[slug].tsx` (SSG per post)
- **Rendering**: Markdown with `remark-gfm` for tables, bilingual (EN + AR)
- **Articles**: 6+ bilingual articles targeting keywords like "auto reply Facebook", "Salla chatbot", "Shopify auto reply Arabic"

### Comparison Pages

Dynamic competitor comparison pages for SEO:

- **Route**: `frontend/src/pages/compare/[slug].tsx`
- **Competitors**: Tidio, Botpress (expandable via data file)
- **Content**: Feature comparison tables, FAQ sections, advantages — all translated EN + AR
- **Translations**: `compare` namespace in i18n files

### Admin Observability Dashboard

Internal **ops-only** dashboard — system health, not cost (all AI cost visibility moved to the AI Cost & Quota panel below):

- **Route**: `/admin/observability` (protected, admin+ access)
- **Metrics displayed**:
  - System health (DB/Redis/ai-worker circuit, process metrics, external-API latencies)
  - Reply pipeline stats (reply rate, response times, flagged count)
  - Breakdowns by method, intent, platform
  - Activation funnel, cache management, lead-digest tooling
- **Data source**: Existing backend analytics endpoints

### Admin AI Cost & Quota Panel

The single home for AI cost visibility and quota-runway monitoring (built to prevent a repeat of the 2026-06-28 `insufficient_quota` outage):

- **Route**: `/admin/ai-cost` (protected, admin+ access)
- **Consumption**: cost by feature (pipeline), by model, by intent, plus a daily-spend trend — with a billed-vs-cached split, a per-pipeline hit-rate column, and prompt-cache savings, from `ai_usage_log` via `getGlobalAiCostByPipeline`. The headline "Reply cache hit rate" card is scoped to `REPLY_PIPELINES` (`comment_reply` + `dm_reply`) — the only cacheable traffic; the blended all-pipeline rate counts never-cacheable calls (embeddings, translation, …) and once made a healthy 54% comment-reply cache read as "12%"
- **OpenAI billing (authoritative)**: pulled daily from the OpenAI org **Costs API** into `ai_cost_snapshots`, split prod vs eval/dev by API key, with a reconciliation view against `ai_usage_log` (prod key matched the DB within 0.6%)
- **Credit runway**: admin-entered balance anchor (OpenAI has no balance API) → remaining ÷ rolling org burn; surfaced by a `AiCreditRunwayBanner` (not dismissible at critical)
- **Proactive alerts**: throttled admin email + Sentry on credit-low (`alert:openai_credit_low`) and spend-spike (`alert:openai_spend_spike`). OpenAI **auto-recharge** (enabled in the OpenAI dashboard) is the primary outage protection; these alerts are the backstop
- **Endpoints**: `GET /admin/ai-cost/{consumption,billing,reconciliation,runway}`, `POST /admin/ai-cost/sync`, `PUT /admin/ai-cost/balance`

### SEO Infrastructure

| Feature | Status |
|---------|--------|
| Dynamic hreflang (page-aware) | Done |
| Dynamic `<html lang>` per locale | Done |
| Translated meta descriptions | Done |
| Structured data (JSON-LD) with 17 features | Done |
| Sitemap + robots.txt | Done |
| Canonical URLs | Done |
| "What is Jawab24" page (AI-discoverable) | Done |
| Blog system (6+ articles) | Done |
| Comparison pages (vs competitors) | Done |
| 39 E2E SEO regression tests | Done |
| Google Search Console verification | Done |
| Backlink campaign | Pending |

## عربي

### نظام المدونة

نظام مدونة ثنائي اللغة كامل لتحسين محركات البحث والتسويق بالمحتوى:
- ملفات بيانات TSX + صفحات SSG ثابتة
- 6+ مقالات ثنائية اللغة تستهدف كلمات بحث مثل "رد تلقائي فيسبوك"، "شات بوت سلة"

### صفحات المقارنة

صفحات مقارنة ديناميكية مع المنافسين:
- المسار: `/compare/[slug]`
- المنافسون: Tidio، Botpress (قابل للتوسيع)
- المحتوى: جداول مقارنة الميزات، أسئلة شائعة، مزايا — الكل مترجم

### لوحة المراقبة الإدارية

لوحة تحكم داخلية لمراقبة صحة النظام وتكاليف الذكاء الاصطناعي:
- المسار: `/admin/observability` (محمي، مدير+ فقط)
- تفصيل تكلفة AI حسب النموذج واليوم ومعدل إصابة الكاش
- إحصائيات خط الإنتاج: معدل الرد، أوقات الاستجابة، العدد المُعلَّم

### بنية SEO التحتية

- hreflang ديناميكي حسب الصفحة
- وصف ميتا مترجم + بيانات منظمة (JSON-LD) بـ 17 ميزة
- خريطة موقع + robots.txt + عناوين URL أساسية
- 39 اختبار E2E لضمان جودة SEO
- صفحة "ما هو Jawab24" محسّنة لاكتشاف الذكاء الاصطناعي

---

# 17. Leads Module
# وحدة العملاء المحتملين

## English

### Overview

Automatically captures structured lead records whenever a customer shares a phone number in an AI conversation (DM or comment). AI analyzes the full conversation to extract dynamic, context-specific fields — e.g., course of interest for an institute, specialty needed for a clinic.

**Follow-up re-extraction (July 2026):** customers naturally send the phone first and the order details after (final size, recipient name, address). While a DM-sourced lead is still `new` and within `LEAD_REEXTRACT_WINDOW_HOURS` (default 24h, `0` = kill-switch), each further customer message — including one whose only phone-like number fails the customer-phone gate (e.g. the merchant's own quoted line) — re-runs the extraction over the full history and **merges** the result into the card (`mergeExtractedData`: fresh value wins per field key, existing keys are never dropped, phone/status/follow-up flags never touched; the UPDATE re-checks `status='new'` so a card the merchant flips mid-call is never mutated). **Both** card-write paths merge: the phone-re-share upsert uses the same semantics, so an over-limit or AI-failed re-share can never wipe a populated card, and a `completed` card is never demoted to `pending`. Bounded by a 3-min per-lead Redis cooldown, an `extractionAttempts` cap of 10 (a **shared counter across all extraction runs for the lead** — first capture, phone re-shares, and follow-up re-reads all increment it), and a separate 150/day workspace budget so re-extraction can never starve first-time capture. Root cause fixed: 2026-07-02 Nourva orders shipped from cards with a stale size / missing recipient name because extraction ran exactly once, at the phone message.

**Multi-contact conversations (July 2026, D-041):** a lead keeps ONE `phone` column (newest share wins, so the call/WhatsApp buttons dial the latest number), and extra people live on the card as paired `name_N` / `phone_N` fields the extraction prompt emits. `upsertLead` preserves any *different* number it displaces from the column as an `additional_phone[_N]` field — the last destructive write in the upsert, closed. Root cause fixed: 2026-07-25 (الفريق الدمشقي) a parent registered two daughters; the second number silently overwrote the first, so the buttons dialled daughter B while the card showed daughter A's name and B's name was lost entirely. Full design, gate rules, and the complete lead-incident history live in [`docs/leads.md`](docs/leads.md).

### Pipeline Position

Runs fire-and-forget after `reply_sent` in both `messageProcessor.ts` and `commentProcessor.ts`. Never blocks the reply pipeline.

```
Incoming message (with phone number)
        ↓
messageProcessor.ts / commentProcessor.ts — after reply_sent
        ↓
leadExtractorService.maybeCaptureLead() — fire-and-forget
        ↓
Phone detection (extractPhoneFromText — handles Arabic-Indic ٠١٢٣٤٥٦٧٨٩)
        ↓
Redis rate limit check (50 AI extractions/day per workspace)
        ↓
OpenAI gpt-4.1-mini — extracts { phone, summary, fields[] }
        ↓
DB upsert — ON CONFLICT (senderId, pageId) DO UPDATE (no duplicates)
        ↓
SSE lead:captured → invalidates ['leads-count'] → badge refetches + toast
```

**Visibility of the standing queue (Aug 2026).** Three surfaces, all fed by the
workspace-wide `new` count (`GET /leads/count` with **no** `pageId` →
`{ count, latestName, latestAt }`):
1. **Dashboard attention banner** — `SmartStatusBanner` renders ONE aggregate leads
   row (never one row per lead) above the comment/message rows, and adds the count
   to the banner total.
2. **Nav badge** (sidebar + mobile "More") — reads the server count via
   `useNewLeadsSummary`, so it survives an app restart. It clears when a lead's
   **status changes**, not when the merchant merely visits `/leads`.
3. **Digest email** — fires on volume (≥ `DIGEST_THRESHOLD`) **OR** age (oldest
   unsent lead ≥ `DIGEST_MAX_AGE_HOURS`, 48h).

Why all three: before Aug 2026 the badge was a session counter that reset to 0 on
every app load and only ever incremented from a live SSE event, and the digest was
volume-only. A paying merchant at ~1 lead/day was therefore emailed exactly once
ever, saw a zero badge over 19 unworked leads, and the dashboard never mentioned
leads at all.

### DB Schema

`leads` table — key columns:
- `(sender_id, page_id)` unique index — deduplication
- `extracted_data` JSONB `{ summary, fields: [{ key, label_en, label_ar, value }] }`
- `status`: `new` → `contacted` → `converted`
- `sub_stage` varchar(64) — id of a merchant-defined sub-stage (see Customization below); nullable
- `custom_fields` JSONB — merchant-entered values keyed by field-definition id
- `source_type`: `message` or `comment`

### Merchant Customization (June 2026)

The three main statuses are fixed (the system depends on `new` for counters/digests/AI default). Merchants customize via workspace settings (`settings.leadStages` / `settings.leadFields`, admin-only writes, sanitized server-side):
- **Sub-stages**: free-text label + color (8-color palette) per main status, ≤20 per status. Leads store the stable sub-stage **id** — renames propagate, deletions fall back to the main-status badge. `PATCH /leads/:id/status` validates the id against the workspace config (stale/foreign ids → 400).
- **Custom data fields**: ≤10 free-text field definitions; values entered per lead from the detail panel, stored in `leads.custom_fields`, exported as CSV columns. Writes to undefined field ids are rejected.
- **Per-page override (multi-page workspaces)**: a page may override either slice for itself — stored in nullable `pages.lead_stages` / `pages.lead_fields` JSONB. Effective config = `page override ?? workspace default` (pure `??`, not merge) via the shared `resolveEffectiveLeadStages/Fields`; `null` = inherit, a set value fully replaces that slice for the page. `PATCH /pages/:id/lead-config` (admin-only, sanitized; `null` reverts a slice) writes overrides; the leads controller validates sub-stage/field writes against the **effective** config (`workspaceSettings.getEffectiveLeadConfig`). Scope is implicit — the leads page selector IS the scope: the customizer edits the selected page when the workspace has 2+ pages or that page already overrides; a single-page workspace edits the shared workspace config with no scope UI. A cross-workspace page **reclaim clears** the override (no config leak); a disconnect→reconnect within the same workspace **preserves** it (sync's set clause excludes the columns).
- **Business-type templates** (store/clinic/school/services) pre-fill an editable draft in the UI language via `StageCustomizerModal`.

### Frontend

`/leads` page — page selector, status filter tabs (All/New/Contacted/Converted), dynamic table columns from `extractedData.fields`, CSV export (incl. sub-stage + custom-field columns), real-time SSE updates via `lead:captured` event, server-backed new-leads badge in sidebar (see "Visibility of the standing queue" above — visiting the page no longer clears it). Detail panel ordered by merchant workflow: AI intent summary + extracted details first, then contact actions, status + sub-stage picker, custom data fields. "Customize leads" opens `StageCustomizerModal`.

**Search is server-side (July 2026):** `GET /leads?search=` matches senderName, phone, and the extracted data's **summary + field values only** (never JSON keys or the bilingual labels — a whole-document text match would return every lead for common words like "الاسم"/"size"). Legacy double-encoded rows (jsonb strings) are normalized to objects in SQL before navigating; wildcards are escaped via `escapeLike`. Previously search filtered only the client-loaded rows, so any lead beyond the first page (50) was unfindable by name — the 2026-07-02 "Jawab24 didn't catch the lead" complaint was partly this.

### Rate Limiting

Redis key `leads:extraction:{workspaceId}:{YYYY-MM-DD}` — 50 AI calls/day per workspace, TTL 86400s. Prevents runaway OpenAI costs on high-traffic pages. Follow-up re-extraction has its own budget: `leads:reextraction:{workspaceId}:{YYYY-MM-DD}`, 150/day, plus a `lead:reextract:{leadId}` 180s cooldown.

---

## عربي

### نظرة عامة

تلتقط وحدة العملاء المحتملين تلقائيًا سجلات منظمة في كل مرة يشارك فيها عميل رقم هاتفه في محادثة ذكاء اصطناعي (رسالة مباشرة أو تعليق). يحلل الذكاء الاصطناعي المحادثة كاملة لاستخراج حقول ديناميكية تناسب السياق — مثل الدورة المطلوبة لمعهد، أو التخصص الطبي لعيادة.

### الموقع في خط الإنتاج

تعمل بأسلوب "أطلق وانسَ" (fire-and-forget) بعد إرسال الرد في `messageProcessor.ts` و`commentProcessor.ts`. لا تعيق خط الرد أبدًا.

**إعادة الاستخلاص عند رسائل المتابعة (يوليو 2026):** يرسل العميل رقمه أولًا ثم تفاصيل الطلب بعده (المقاس النهائي، اسم المستلم، العنوان). ما دام العميل المحتمل (من الرسائل الخاصة) في حالة `new` وخلال نافذة `LEAD_REEXTRACT_WINDOW_HOURS` (افتراضيًا 24 ساعة، والقيمة `0` توقف الميزة)، تعيد كل رسالة لاحقة من العميل تشغيل الاستخلاص على كامل المحادثة **وتدمج** النتيجة في البطاقة (القيمة الأحدث تفوز لكل حقل، الحقول القديمة لا تُحذف أبدًا، ولا يُمَسّ الرقم أو الحالة أو أعلام المتابعة). **كلا مساري الكتابة يدمجان**: إعادة مشاركة الرقم تدمج أيضًا ولا تستبدل، فلا يمكن لبطاقة ممتلئة أن تُمسح عند تجاوز الحد اليومي أو فشل الذكاء الاصطناعي. محكومة بمهلة تهدئة 3 دقائق لكل عميل، وعدّاد `extractionAttempts` بحد 10 (عدّاد مشترك لكل عمليات الاستخلاص للعميل الواحد: الالتقاط الأول وإعادة مشاركة الرقم وإعادات القراءة)، وميزانية يومية منفصلة (150/يوم لكل مساحة عمل) حتى لا تزاحم الالتقاط الأول.

**المحادثات متعددة جهات الاتصال (يوليو 2026، القرار D-041):** يحتفظ العميل المحتمل بعمود هاتف **واحد** تفوز فيه المشاركة الأحدث، حتى يتصل زرّا الاتصال وواتساب بالرقم الأخير الذي أرسله العميل. أما الأشخاص الإضافيون فتُسجَّل بياناتهم في البطاقة على هيئة أزواج حقول مقترنة (`name_N` / `phone_N`) يستخرجها الذكاء الاصطناعي. وعند وصول رقم مختلف، يحفظ `upsertLead` الرقم المُزاح في حقل `additional_phone[_N]` بدلًا من إسقاطه — وهو آخر كتابة مُدمِّرة في مسار التحديث، وقد أُغلقت. سبب الجذر المُصلَح: في 2026-07-25 (الفريق الدمشقي) سجّلت أمٌّ ابنتيها، فطمس الرقم الثاني الرقم الأول؛ فأصبح الزرّان يتصلان برقم الابنة الثانية بينما تعرض البطاقة اسم الابنة الأولى، واختفى اسم الثانية كليًا. التصميم الكامل وقواعد البوابة وسجل حوادث العملاء المحتملين في [`docs/leads.md`](docs/leads.md).

### المخطط في قاعدة البيانات

جدول `leads` — الأعمدة الرئيسية:
- مؤشر فريد على `(sender_id, page_id)` — لمنع التكرار
- `extracted_data` JSONB يحتوي على `{ summary, fields: [{ key, label_en, label_ar, value }] }`
- `status`: `new` → `contacted` → `converted`
- `sub_stage` varchar(64) — معرّف مرحلة فرعية يحددها التاجر (انظر التخصيص أدناه)
- `custom_fields` JSONB — قيم يدخلها التاجر، مفاتيحها معرّفات تعريفات الحقول

### تخصيص التاجر (يونيو 2026)

الحالات الرئيسية الثلاث ثابتة، ويخصص التاجر عبر إعدادات مساحة العمل (`settings.leadStages` / `settings.leadFields`، كتابة للمشرفين فقط مع تعقيم في الخادم):
- **مراحل فرعية**: تسمية حرة + لون (8 ألوان) لكل حالة رئيسية، بحد 20 لكل حالة. يخزَّن **معرّف** المرحلة في العميل — إعادة التسمية تنعكس فورًا، والحذف يعود تلقائيًا لشارة الحالة الرئيسية.
- **حقول بيانات**: حتى 10 حقول نصية، تعبَّأ لكل عميل من لوحة التفاصيل وتظهر كأعمدة في التصدير.
- **تخصيص لكل صفحة (مساحات العمل متعددة الصفحات)**: يمكن لصفحة أن تتجاوز أيًّا من الإعدادين لنفسها — يُخزَّن في عمودي `pages.lead_stages` / `pages.lead_fields` (JSONB، قابلة لأن تكون فارغة). الإعداد الفعّال = تجاوز الصفحة وإلا الإعداد الافتراضي لمساحة العمل (عبر `resolveEffectiveLeadStages/Fields` المشتركة)؛ القيمة الفارغة `null` تعني الوراثة، والقيمة المضبوطة تستبدل ذلك الإعداد للصفحة بالكامل. نقطة النهاية `PATCH /pages/:id/lead-config` (للمشرفين فقط مع تعقيم؛ `null` يعيد للإعداد الافتراضي) تكتب التجاوزات، ويتحقّق متحكّم العملاء من الكتابة مقابل الإعداد **الفعّال**. النطاق ضمني — مُحدِّد الصفحة في صفحة العملاء هو النطاق: يحرّر المخصِّص الصفحة المختارة عند وجود صفحتين أو أكثر أو عند وجود تجاوز للصفحة؛ ومساحة العمل أحادية الصفحة تحرّر الإعداد المشترك دون أي عنصر نطاق. نقل الصفحة بين مساحات العمل **يمسح** التجاوز (منعًا للتسريب)، أما الفصل ثم إعادة الربط داخل نفس مساحة العمل **فيحافظ** عليه.
- **قوالب جاهزة** (متجر/عيادة/معهد/خدمات) تملأ مسودة قابلة للتعديل بلغة الواجهة عبر `StageCustomizerModal`.

### الواجهة الأمامية

صفحة `/leads` — تحديد الصفحة، تصفية بالحالة، أعمدة ديناميكية من `extractedData.fields`، تصدير CSV (يشمل المرحلة الفرعية والحقول المخصصة)، تحديثات فورية عبر SSE، شارة عملاء جدد في الشريط الجانبي. لوحة التفاصيل مرتبة حسب سير عمل التاجر: ملخص الطلب أولًا، ثم أزرار التواصل، ثم الحالة والمراحل، ثم حقول البيانات.

**البحث من الخادم (يوليو 2026):** `GET /leads?search=` يطابق اسم المرسل والرقم والبيانات المستخلصة. سابقًا كان البحث يصفّي الصفوف المحمّلة في المتصفح فقط، فأي عميل بعد الصفحة الأولى (50) لا يظهر عند البحث باسمه.

---

# Quick Reference Card / بطاقة مرجعية سريعة

```
╔══════════════════════════════════════════════════════════════════╗
║                    JAWAB24 QUICK REFERENCE                      ║
╠══════════════════════════════════════════════════════════════════╣
║                                                                  ║
║  REPLY PRIORITY:                                                 ║
║  1. Template match (keyword rules) → FREE, instant              ║
║  2. Exact cache hit (Redis/Postgres) → FREE, instant            ║
║  3. Semantic cache hit (pgvector) → FREE, instant               ║
║  4. Full AI call (gpt-4.1-mini) → COST, ~2-5 seconds           ║
║  5a. Tier-2 fallback (circuit open) → Claude Haiku              ║
║  5b. Tier-3 fallback (Claude also fails) → keyword classifier   ║
║                                                                  ║
║  CONCURRENCY: Redis distributed lock (SET NX EX 60)              ║
║  DM key: reply_lock:{pageId}:{senderId}                          ║
║  Comment key: reply_lock:comment:{pageId}:{commentId}            ║
║  Release: Lua CAS script in finally block                        ║
║                                                                  ║
║  SAFETY CHAIN:                                                   ║
║  Input sanitization → AI generation → 6 post-checks →           ║
║  Offensive filter → Price hallucination (2-tier) →               ║
║  Low confidence filter → Send or hold                            ║
║                                                                  ║
║  INTENTS: QUESTION | COMPLIMENT | COMPLAINT | PURCHASE_INTENT   ║
║           GREETING | BUSINESS_INQUIRY | OFFENSIVE |              ║
║           SPAM_OR_IRRELEVANT                                     ║
║                                                                  ║
║  CONFIDENCE: HIGH (KB-backed) | MEDIUM (partial) | LOW (guess)  ║
║                                                                  ║
║  KEY LIMITS:                                                     ║
║  • Comment reply: 40 words max (public)                          ║
║  • DM reply: 3-4 sentences with detail                           ║
║  • KB: 16,000 chars / Products: 15 items, 800 chars             ║
║  • Rate: 5/min comments, 10/min messages per sender              ║
║  • Token budget: 24,000 input tokens                             ║
║  • Cache: 30-day TTL, version-scoped                             ║
║                                                                  ║
║  PORTS: Frontend=3001 | Backend=3000 | AI Worker=3002            ║
║  MODEL: gpt-4.1-mini | PROMPT: v30 | TEMP: 0.3                  ║
║                                                                  ║
║  RBAC ROLES: owner (full) | admin (manage) | member (read-only) ║
║  ENCRYPTION: Page tokens AES-256-GCM at rest                     ║
║  MIGRATIONS: 81 SQL files                                        ║
╚══════════════════════════════════════════════════════════════════╝
```
