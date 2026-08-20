# Salla portal — field-by-field paste map

> **What this is:** a map from each field of the Salla publish wizard to the file that already
> holds its content, plus the decisions the existing drafts do **not** cover. It deliberately
> copies no prose — the copy lives in `.planning/SALLA_LISTING_BRIEF.md` and `benefits.md`, and
> duplicating it here would guarantee the two drift.
>
> **Portal state it was written against:** app `665811310`, read 2026-08-20. `Status: Development`,
> publish wizard an unsubmitted draft. Fill and **Save Draft** — see the runbook's readiness gate
> before anyone presses *Submit for Review*.

## 1. Basic Info

| Field | Source | State 2026-08-20 |
|---|---|---|
| App Name | `Jawab24` | ✅ filled |
| Short Description | `SALLA_LISTING_BRIEF.md` §2 — **v2** (the one naming واتساب) | ⚠️ EN present; **confirm the Arabic field carries v2 too**. v1 was saved against the *dev* app `1565152053`, so this app may never have had the AR string at all |
| App Description (long) | `SALLA_LISTING_BRIEF.md` §2 — Arabic ~250w, English ~230w | ❌ empty. ⚠️ still marked *awaiting marketing sign-off* — get that before pasting |
| App Logo | `icon-512.png` (512×512, 58 KB) | ❌ empty |
| Educational Video | `SALLA_LISTING_BRIEF.md` §5 has the 60–90s script; no video is produced | ❌ empty — optional, ship without it |
| Categories | see **Sub-category correction** below | ❌ empty |
| Supported Countries | **decision owed** — see below | ❌ empty |
| Search Terms (0/20) | `SALLA_LISTING_BRIEF.md` §2 tag list (10 tags). ⚠️ `ai-agent` is an EN-side SEO term only (D-014) — never in the Arabic copy | ❌ empty |

### Sub-category correction

The app currently sits under `Category: General App` → `Sub Category: **Cross-sell / Upsell**`.
That describes a merchandising widget, not a reply assistant, and it is what a merchant browsing
the store will filter on. The brief (§2) leans **Marketing / Sales (التسويق / المبيعات)** over
Customer Service to match the sales-rep positioning. Pick from Salla's live taxonomy at fill time
and record what was chosen here — the brief lists this as open question §9.1.

### Supported Countries — decision owed

Not addressed anywhere in the brief. Two constraints that must shape it:

- 🔴 **Syria is barred on WhatsApp** and the listing copy leads with WhatsApp. See
  `project_whatsapp_syria_barred` in memory before ticking countries.
- Salla merchants are overwhelmingly **KSA**; the free-tier strategy (§7) was written for that
  audience. Narrow is safer than wide — a country we cannot serve is a support burden and a
  review risk.

## 2. App Configuration

✅ Already mirrors live config (scopes, webhook URL `https://jawab24.com/salla/webhooks`, Security
Strategy = Token). **One gap:** `shipping.read` is not ticked — see the runbook, Phase 2.5. The
portal is the whole grant; `config.salla.scopes` has zero effect in Easy Mode.

## 3. Features & Media

| Slot | File | Note |
|---|---|---|
| Screenshots (min 3) | `gallery-1.png`, `gallery-2.png`, `gallery-3.png` | 1366×768, already the exact required count and size |
| Key Benefits ×3 | `benefit-1..3.png` + titles/descriptions in `benefits.md` | 1600×1600 |
| Promotional Banner | ❌ **not produced** | Check whether the wizard hard-requires it; if so this is the one asset still owed |
| Embedded App Banner | ❌ not produced | Only needed for embedded apps — we are headless, expect optional |

⚠️ `README.md` §"Compromises" flags that the screenshots show dev fixtures (“Test User / Test
Workspace”, «متجر تجريبي»). Decide whether that is acceptable before upload — re-rendering is
`cd sources && node render.js`.

## 4. App Pricing — set **Free**, not the current `One-Time / 0`

The wizard is sitting on untouched defaults (`Pricing Type: One-Time`, price 0, trial unchecked).
`One-Time` with a zero price is not the same statement as *free*, and it is the wrong shape for a
subscription product.

⛔ **Do not configure any paid tier at launch.** Salla apps-policy **Article 5** requires paid apps
to bill through Salla, and Salla-managed billing is **NOT IMPLEMENTED** — the code path that would
drive a `'salla'` subscription source from `app.subscription.*` webhooks does not exist. Our Stripe
surfaces are guarded to *refuse* Salla-sourced merchants (D-065), so a paid listing would advertise
a purchase no rail can complete. Launch free-tier-only, exactly as decided 2026-05-30.

## 5. Contact Info — founder-owed, blocks submission

All fields empty. Needed: Notification Email, Submission Email, Support Email, Support Phone,
Privacy Policy URL.

- **Support email** is still `[TBD]` in the brief §7 (`support@jawab24.com` vs a routed
  `salla-support@jawab24.com`). Whichever is chosen must be a **real, monitored inbox with an
  auto-responder** before submission — Salla's reviewer may test it.
- 🔴 **Privacy Policy URL is not merely a link to paste.** The brief §6 gap analysis found
  `frontend/src/pages/privacy.tsx` carries **zero** Salla/processor content. Pointing the listing
  at it as-is publishes a privacy policy that does not describe what the Salla app does with store
  data. **Update the privacy page first**, then paste its URL.

## 6. Service Trial — founder-owed, blocks review

Service URL, Test Username, Test Password, Additional Instructions — all empty. Salla's reviewer
uses these to exercise the app.

Owed: a **dedicated review account** on jawab24.com with a connected Salla demo store and synced
products, plus short instructions in Arabic pointing at the two things worth seeing (the store card
on «المتاجر», and «اختبار الرد الذكي» quoting a real product price). ⛔ Do not hand over a real
merchant's account, and do not use the founder's own.

> This same demo store is what Tier 3 of `docs/SALLA_TEST_PLAN.md` needs — including the
> `track_shipment` gate that has never been run. Create it once, use it for both.
