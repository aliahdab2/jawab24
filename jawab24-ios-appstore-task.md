> # ⛔ SUPERSEDED — HISTORICAL ONLY. DO NOT FOLLOW.
>
> This is the **April 2026** one-off task brief for the very first submission (build
> `1.1.1 (3)`). It is kept for history. Several of its instructions are now **wrong** and
> following them would cause a rejection or a policy breach:
>
> | This brief says | Actual, as of 2026-08-13 |
> |---|---|
> | Build `1.1.1 (3)`, upload via Transporter | **2.0.33 (10)**; uploads go via `altool` / the ASC API |
> | Age Rating **17+** | **4+** — and "Messaging and Chat" must be **Yes** (Apple's 2.3.6 rejection, 2026-08-13; answering Yes keeps it at 4+) |
> | Contact `ali.ahdab@telavox.com` | `aliahdab@gmail.com`. ⛔ The Telavox account must never be used for Jawab24 |
> | Review notes text (as quoted) | Fully replaced — the current notes argue **Guideline 3.1.3(f)** |
> | *(silent on payments)* | The 3.1.1 posture is the single most rejection-prone part of this app. See **D-064** and **D-079** |
>
> **Current source of truth:** `DECISIONS.md` D-064 + **D-079**, the "Mobile / Capacitor"
> table in `SYSTEM_ANALYSIS.md`, and the launch plan at
> `~/.claude/plans/ios-app-store-launch-2026-08.md`.

Task: Publish Jawab24 iOS app to App Store Connect / TestFlight

Context you need

- Jawab24 is a Facebook/Instagram auto-reply SaaS for business Pages. B2B, no ads, no in-app purchases, no paid content. Target audience 18+.
- We just published Jawab24 for Android (Play Console) and 15 policy-form changes are in review with Google. iOS is the parallel track.
- Apple Developer Program: active. App is already created in App Store Connect. Team ID: `7N8P4V43AM`. Bundle ID: `com.jawab24.app`.
- New build `1.1.1 (3)` has been archived and exported as IPA. The user will upload the IPA via Transporter themselves — do NOT attempt to upload files yourself (we know from the Play Console work that file uploads via browser extension are unreliable).
- Domains: `jawab24.com` is the marketing site; `jawab24.com/privacy` is the privacy policy.
- This is a first-time App Store submission for this app.

Strict safety rails — do NOT click without my explicit confirmation

- Do NOT click Submit for Review (App Store) or Submit for Review on a TestFlight external group — always stop and screenshot first
- Do NOT Remove Build / Reject This Build / Expire Build
- Do NOT change Bundle ID, SKU, Primary Language, or Team
- Do NOT change Pricing from Free unless I explicitly ask
- Do NOT enable or disable In-App Purchases, Family Sharing, Game Center
- Do NOT click Delete App, Transfer App, Remove from Sale
- Do NOT respond to Apple review messages on my behalf

If any screen shows a destructive-looking option not in my plan, stop and screenshot before clicking.

Phase 1 — Wait for IPA to finish processing

I (the user) will upload `Jawab24-1.1.1-3.ipa` via the Transporter app on my Mac. After that:

1. Navigate to App Store Connect → Apps → Jawab24 → TestFlight → Builds.
2. Look for build 1.1.1 (3). Initial status will be "Processing" (typically 10-30 minutes).
3. Refresh every ~5 minutes. Do not click on the build while processing.
4. When status changes to something actionable (likely showing a yellow warning about missing compliance), proceed to Phase 2.

Report back when the build is no longer "Processing."

Phase 2 — Export Compliance declaration

Once the build finishes processing, it will show "Missing Compliance" or similar.

1. Click the build 1.1.1 (3).
2. Find the Export Compliance Information section / warning.
3. Click Provide Export Compliance Information (or similar).
4. On the questionnaire:
   - "Does your app use encryption?" → Yes
   - "Does your app qualify for any of the exemptions provided in Category 5, Part 2 of the U.S. Export Administration Regulations?" → Yes
   - The specific exemption: Yes, the app uses/implements/incorporates encryption for authentication, digital signature, or the decryption of data/files, AND the app uses standard encryption (HTTPS, TLS) only.
   - End goal: answer in a way that declares "uses standard encryption only (HTTPS/TLS) — exempt from export compliance uploads."
5. Do NOT click Save / Submit on the compliance form yet — screenshot the filled form and report back for my confirmation first.

Phase 3 — App information (App Store tab, not TestFlight)

Navigate to App Store Connect → Apps → Jawab24 → App Store → App Information (left sidebar).
For each field below, check current state and report back. Do NOT save changes yet — just report what's there.

- Name: Jawab24
- Subtitle (30 chars max): suggested "AI auto-reply for Instagram & Facebook"
- Privacy Policy URL: `https://jawab24.com/privacy`
- Category: Primary Business, Secondary Productivity
- Content Rights: check if it asks about third-party content — answer No (it's first-party software)
- Age Rating: 17+ (or closest equivalent for B2B business app)

Report the current state of each field. I'll confirm changes individually before you save.

Phase 4 — Pricing & Availability

Navigate to Pricing and Availability.

- Price: Free
- Availability: All countries/regions except the following sanctioned countries: Cuba, Iran, North Korea, Syria, Crimea, occupied regions of Ukraine (Donetsk/Luhansk). Do NOT save — screenshot the country selection after I confirm the list.

Phase 5 — Privacy Nutrition Labels (Data Types)

Navigate to App Privacy. This is the critical one — similar to Data Safety in Play Store.

Data the app collects, with purpose:

- Contact Info → Email Address — for Account Management, linked to user, not tracking
- User Content → Customer Support — only if they email support, linked to user, not tracking
- Identifiers → User ID — for App Functionality, linked to user, not tracking
- Usage Data → Product Interaction — for Analytics (Sentry), NOT linked to user, not tracking
- Diagnostics → Crash Data, Performance Data — for Analytics (Sentry), NOT linked to user, not tracking

We do NOT collect: Location, Contacts, Photos, Audio, Health, Financial, Browsing History, Search History, Sensitive Info. We do NOT use Advertising ID or do any advertising/tracking.

For each category, check current state, report back, wait for my confirmation before committing.

Phase 6 — App Review Information

Navigate to App Review Information (in the version you're submitting).

- Sign-in required: Yes
- Demo account credentials: I (the user) will provide these separately — ask me for them when you reach this step.
- Notes for review:

Jawab24 is a SaaS platform for Facebook Page and Instagram business account owners to configure AI-powered automatic replies to comments and messages. To test, use the provided demo account. After login, the demo mode bypasses Facebook OAuth and shows sample pages, comments, and AI-generated replies. No real Facebook/Instagram account needed for review. All AI replies are generated by OpenAI and customizable by the user.

- Contact Information: ali.ahdab@telavox.com (or the user's preferred contact)

Do not save — screenshot the filled form and report back.

Phase 7 — Screenshots

I (the user) will take screenshots from the iOS Simulator. Do not generate or upload screenshots yourself. When ready, the user will upload them via the browser file picker. Your job is only to:

1. Identify the required screenshot slots (6.7" iPhone required; 12.9" iPad if iPad supported).
2. Confirm after user uploads that they appear correctly.

Phase 8 — TestFlight first

Before submitting for App Store review, add the build to Internal Testing group in TestFlight (internal testers do not require Apple review).

1. Navigate to TestFlight → Internal Testing.
2. Check if a group exists (probably "App Store Connect Users" or similar default).
3. If yes, click the group, then click + next to Builds, select 1.1.1 (3). Screenshot before clicking final confirm.
4. Do NOT create External Testing groups yet — we'll do that only after the user confirms.

Phase 9 — Submit for App Store Review (hold for explicit go-ahead)

Only after all of the above are filled and I say "submit", navigate to the version page and click Add for Review → Submit for Review. Screenshot the final confirmation screen BEFORE clicking Submit. Wait for explicit "confirmed, submit" from me.

Proceed with Phase 1 — wait for the upload and report when build 1.1.1 (3) is no longer in "Processing" state in TestFlight. Do nothing else yet.
