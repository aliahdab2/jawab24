# Product-resolver probe — 2026-08-22

65 queries over 16 product chunks (3 pages, prod, read-only).

## 1. Top-1 ranking accuracy (single-answer cases; thresholds not applied)

| variant | correct / n | by class |
|---|---|---|
| vec only | **47/50** | exact 11/11 · article 7/7 · morphology 4/4 · cross-script 16/19 · near-dup 4/4 · category 3/3 · partial 2/2 |
| trigram (0.6 sim_t + 0.4 sim_c) | **40/50** | exact 11/11 · article 7/7 · morphology 4/4 · cross-script 9/19 · near-dup 4/4 · category 3/3 · partial 2/2 |
| word_sim title only | **31/50** | exact 11/11 · article 7/7 · morphology 4/4 · cross-script 2/19 · near-dup 4/4 · category 1/3 · partial 2/2 |
| hybrid (0.7 vec + 0.3 trigram)  = retrieval.ts minus boosts | **48/50** | exact 11/11 · article 7/7 · morphology 4/4 · cross-script 17/19 · near-dup 4/4 · category 3/3 · partial 2/2 |
| hybrid-ws (0.7 vec + 0.3 (0.6 ws_t + 0.4 sim_c)) | **46/50** | exact 11/11 · article 7/7 · morphology 4/4 · cross-script 15/19 · near-dup 4/4 · category 3/3 · partial 2/2 |

## 2. Decision accuracy with thresholds (all cases: resolved / ambiguous / not_found must match)

### vec only

| T_CAND \ GAP | 0 | 0.02 | 0.04 | 0.06 | 0.08 | 0.1 | 0.15 | 0.2 |
|---|---|---|---|---|---|---|---|---|
| 0.3 | 50 | 50 | 50 | 49 | 47 | 46 | 41 | 37 |
| 0.35 | 47 | 47 | 47 | 46 | 46 | 44 | 41 | 38 |
| 0.4 | 45 | 45 | 45 | 45 | 45 | 44 | 44 | 43 |
| 0.45 | 40 | 40 | 40 | 40 | 40 | 40 | 40 | 39 |
| 0.5 | 33 | 33 | 32 | 32 | 32 | 32 | 32 | 31 |
| 0.55 | 27 | 27 | 27 | 27 | 27 | 28 | 28 | 27 |
| 0.6 | 25 | 25 | 25 | 25 | 25 | 26 | 26 | 25 |
| 0.65 | 21 | 21 | 21 | 21 | 21 | 21 | 21 | 21 |
| 0.7 | 18 | 18 | 18 | 18 | 18 | 18 | 18 | 18 |
| 0.75 | 15 | 15 | 15 | 15 | 15 | 15 | 15 | 15 |
| 0.8 | 11 | 11 | 11 | 11 | 11 | 11 | 11 | 11 |

best: T_CAND=0.3, GAP=0 → **50/65**

### trigram (0.6 sim_t + 0.4 sim_c)

| T_CAND \ GAP | 0 | 0.02 | 0.04 | 0.06 | 0.08 | 0.1 | 0.15 | 0.2 |
|---|---|---|---|---|---|---|---|---|
| 0.3 | 22 | 22 | 22 | 22 | 22 | 22 | 23 | 23 |
| 0.35 | 20 | 20 | 20 | 20 | 20 | 20 | 20 | 20 |
| 0.4 | 19 | 19 | 19 | 19 | 19 | 19 | 19 | 19 |
| 0.45 | 18 | 18 | 18 | 18 | 18 | 18 | 18 | 18 |
| 0.5 | 18 | 18 | 18 | 18 | 18 | 18 | 18 | 18 |
| 0.55 | 18 | 18 | 18 | 18 | 18 | 18 | 18 | 18 |
| 0.6 | 18 | 18 | 18 | 18 | 18 | 18 | 18 | 18 |
| 0.65 | 8 | 8 | 8 | 8 | 8 | 8 | 8 | 8 |
| 0.7 | 8 | 8 | 8 | 8 | 8 | 8 | 8 | 8 |
| 0.75 | 8 | 8 | 8 | 8 | 8 | 8 | 8 | 8 |
| 0.8 | 8 | 8 | 8 | 8 | 8 | 8 | 8 | 8 |

best: T_CAND=0.3, GAP=0.15 → **23/65**

### word_sim title only

| T_CAND \ GAP | 0 | 0.02 | 0.04 | 0.06 | 0.08 | 0.1 | 0.15 | 0.2 |
|---|---|---|---|---|---|---|---|---|
| 0.3 | 37 | 41 | 41 | 41 | 41 | 41 | 40 | 40 |
| 0.35 | 33 | 37 | 37 | 37 | 37 | 37 | 36 | 36 |
| 0.4 | 32 | 36 | 36 | 36 | 36 | 36 | 35 | 35 |
| 0.45 | 30 | 34 | 34 | 34 | 34 | 34 | 33 | 33 |
| 0.5 | 30 | 34 | 34 | 34 | 34 | 34 | 33 | 33 |
| 0.55 | 26 | 29 | 29 | 29 | 29 | 29 | 29 | 29 |
| 0.6 | 23 | 25 | 25 | 25 | 25 | 25 | 25 | 25 |
| 0.65 | 22 | 24 | 24 | 24 | 24 | 24 | 24 | 24 |
| 0.7 | 21 | 23 | 23 | 23 | 23 | 23 | 23 | 23 |
| 0.75 | 21 | 23 | 23 | 23 | 23 | 23 | 23 | 23 |
| 0.8 | 21 | 23 | 23 | 23 | 23 | 23 | 23 | 23 |

best: T_CAND=0.3, GAP=0.02 → **41/65**

### hybrid (0.7 vec + 0.3 trigram)  = retrieval.ts minus boosts

| T_CAND \ GAP | 0 | 0.02 | 0.04 | 0.06 | 0.08 | 0.1 | 0.15 | 0.2 |
|---|---|---|---|---|---|---|---|---|
| 0.3 | 45 | 45 | 45 | 45 | 43 | 43 | 43 | 43 |
| 0.35 | 38 | 37 | 37 | 37 | 36 | 36 | 36 | 36 |
| 0.4 | 33 | 32 | 32 | 32 | 32 | 32 | 32 | 32 |
| 0.45 | 27 | 27 | 27 | 27 | 27 | 28 | 28 | 28 |
| 0.5 | 24 | 24 | 24 | 24 | 24 | 25 | 25 | 25 |
| 0.55 | 22 | 22 | 22 | 22 | 22 | 22 | 22 | 22 |
| 0.6 | 20 | 20 | 20 | 20 | 20 | 20 | 20 | 20 |
| 0.65 | 16 | 16 | 16 | 16 | 16 | 16 | 16 | 16 |
| 0.7 | 15 | 15 | 15 | 15 | 15 | 15 | 15 | 15 |
| 0.75 | 10 | 10 | 10 | 10 | 10 | 10 | 10 | 10 |
| 0.8 | 8 | 8 | 8 | 8 | 8 | 8 | 8 | 8 |

best: T_CAND=0.3, GAP=0 → **45/65**

### hybrid-ws (0.7 vec + 0.3 (0.6 ws_t + 0.4 sim_c))

| T_CAND \ GAP | 0 | 0.02 | 0.04 | 0.06 | 0.08 | 0.1 | 0.15 | 0.2 |
|---|---|---|---|---|---|---|---|---|
| 0.3 | 43 | 44 | 45 | 45 | 44 | 44 | 44 | 43 |
| 0.35 | 39 | 39 | 39 | 39 | 39 | 39 | 39 | 38 |
| 0.4 | 35 | 35 | 35 | 35 | 36 | 36 | 36 | 35 |
| 0.45 | 32 | 32 | 32 | 32 | 32 | 32 | 32 | 31 |
| 0.5 | 26 | 26 | 26 | 27 | 27 | 27 | 27 | 26 |
| 0.55 | 23 | 23 | 23 | 24 | 24 | 24 | 24 | 23 |
| 0.6 | 20 | 20 | 20 | 21 | 21 | 21 | 21 | 21 |
| 0.65 | 17 | 17 | 17 | 17 | 17 | 17 | 17 | 17 |
| 0.7 | 16 | 16 | 16 | 16 | 16 | 16 | 16 | 16 |
| 0.75 | 10 | 10 | 10 | 10 | 10 | 10 | 10 | 10 |
| 0.8 | 8 | 8 | 8 | 8 | 8 | 8 | 8 | 8 |

best: T_CAND=0.3, GAP=0.04 → **45/65**

## 3. Per-query detail — vec only @ T_CAND=0.3, GAP=0

| page | class | query | expected | decision | top-3 (pid:score) | ok |
|---|---|---|---|---|---|---|
| zid | exact | Sony A7S III | d2fc56 | resolved d2fc56 | d2fc56:0.829 c51630:0.332 aa38a9:0.223 | ✅ |
| zid | exact | نظارة شمسية | c51630 | resolved c51630 | c51630:0.754 d2fc56:0.287 c51712:0.195 | ✅ |
| zid | exact | قميص قطني رجالي | c51712 | resolved c51712 | c51712:0.785 aa38a9:0.269 c51630:0.238 | ✅ |
| zid | exact | Running Shoes | aa38a9 | resolved aa38a9 | aa38a9:0.693 c51712:0.230 c51630:0.200 | ✅ |
| zid | article | النظارة | c51630 | resolved c51630 | c51630:0.536 d2fc56:0.236 c51712:0.185 | ✅ |
| zid | article | القميص | c51712 | resolved c51712 | c51712:0.653 aa38a9:0.265 c51630:0.186 | ✅ |
| zid | article | النظارة الشمسية | c51630 | resolved c51630 | c51630:0.701 d2fc56:0.312 aa38a9:0.225 | ✅ |
| zid | article | بكم القميص القطني | c51712 | resolved c51712 | c51712:0.574 aa38a9:0.263 d2fc56:0.174 | ✅ |
| zid | morphology | نظارات | c51630 | resolved c51630 | c51630:0.528 d2fc56:0.243 aa38a9:0.195 | ✅ |
| zid | morphology | نظاره شمسيه | c51630 | resolved c51630 | c51630:0.646 d2fc56:0.280 aa38a9:0.169 | ✅ |
| zid | morphology | قمصان | c51712 | resolved c51712 | c51712:0.493 aa38a9:0.295 c51630:0.213 | ✅ |
| zid | cross-script | سوني | d2fc56 | resolved d2fc56 | d2fc56:0.376 c51630:0.296 c51712:0.183 | ✅ |
| zid | cross-script | كاميرا سوني | d2fc56 | resolved d2fc56 | d2fc56:0.468 c51630:0.333 c51712:0.173 | ✅ |
| zid | cross-script | كاميرا | d2fc56 | resolved d2fc56 | d2fc56:0.331 c51630:0.307 c51712:0.172 | ✅ |
| zid | cross-script | حذاء رياضي | aa38a9 | resolved aa38a9 | aa38a9:0.532 c51712:0.386 c51630:0.215 | ✅ |
| zid | cross-script | الحذاء | aa38a9 | resolved aa38a9 | aa38a9:0.407 c51712:0.287 c51630:0.164 | ✅ |
| zid | cross-script | عندكم حذاء للجري؟ | aa38a9 | resolved aa38a9 | aa38a9:0.456 c51712:0.339 c51630:0.195 | ✅ |
| zid | cross-script | shirt | c51712 | resolved c51712 | c51712:0.387 aa38a9:0.323 c51630:0.238 | ✅ |
| zid | cross-script | sunglasses | c51630 | resolved c51630 | c51630:0.407 aa38a9:0.258 d2fc56:0.212 | ✅ |
| zid | cross-script | camera | d2fc56 | resolved d2fc56 | d2fc56:0.427 c51630:0.376 aa38a9:0.176 | ✅ |
| zid | not-found | ساعة ذكية | — | resolved c51630 | c51630:0.413 aa38a9:0.293 d2fc56:0.277 | ❌ |
| zid | not-found | بتشحنوا لحلب | — | not_found | c51630:0.212 aa38a9:0.177 c51712:0.131 | ✅ |
| zid | not-found | iphone | — | resolved d2fc56 | d2fc56:0.375 c51630:0.308 aa38a9:0.206 | ❌ |
| zid | not-found | عطر | — | not_found | c51712:0.238 c51630:0.215 aa38a9:0.193 | ✅ |
| shopify | exact | iPhone 15 Pro | shop1 | resolved shop1 | shop1:0.800 shop5:0.618 shop4:0.472 | ✅ |
| shopify | exact | AirPods Pro | shop4 | resolved shop4 | shop4:0.739 shop1:0.497 shop5:0.420 | ✅ |
| shopify | exact | Apple TV 4K | shop6 | resolved shop6 | shop6:0.751 shop1:0.414 shop3:0.375 | ✅ |
| shopify | exact | MacBook Air M3 | shop3 | resolved shop3 | shop3:0.816 shop6:0.348 shop1:0.339 | ✅ |
| shopify | ambiguous | iPhone 15 | shop1, shop5 | resolved shop1 | shop1:0.716 shop5:0.635 shop6:0.435 | ❌ |
| shopify | ambiguous | ايفون | shop1, shop5 | resolved shop6 | shop6:0.382 shop2:0.372 shop5:0.368 | ❌ |
| shopify | ambiguous | جوال | shop1, shop2 | resolved shop2 | shop2:0.346 shop5:0.306 shop1:0.302 | ❌ |
| shopify | cross-script | ايفون 15 برو | shop1 | resolved shop5 | shop5:0.552 shop1:0.546 shop6:0.432 | ❌ |
| shopify | near-dup | كفر ايفون | shop5 | resolved shop5 | shop5:0.545 shop1:0.390 shop6:0.386 | ✅ |
| shopify | near-dup | كفر | shop5 | resolved shop5 | shop5:0.397 shop6:0.186 shop4:0.174 | ✅ |
| shopify | cross-script | سامسونج | shop2 | resolved shop2 | shop2:0.499 shop1:0.367 shop5:0.338 | ✅ |
| shopify | cross-script | جالكسي | shop2 | not_found | shop5:0.245 shop2:0.236 shop1:0.177 | ❌ |
| shopify | cross-script | هاتف سامسونج | shop2 | resolved shop2 | shop2:0.538 shop1:0.444 shop5:0.378 | ✅ |
| shopify | cross-script | ماك بوك | shop3 | not_found | shop3:0.253 shop6:0.201 shop1:0.191 | ❌ |
| shopify | category | لابتوب | shop3 | resolved shop3 | shop3:0.325 shop6:0.293 shop2:0.287 | ✅ |
| shopify | cross-script | ايربودز | shop4 | not_found | shop2:0.182 shop6:0.153 shop1:0.117 | ❌ |
| shopify | category | سماعات | shop4 | resolved shop4 | shop4:0.409 shop2:0.332 shop5:0.289 | ✅ |
| shopify | cross-script | ابل تي في | shop6 | not_found | shop6:0.292 shop5:0.204 shop1:0.174 | ❌ |
| shopify | not-found | شاحن | — | not_found | shop3:0.286 shop5:0.267 shop1:0.261 | ✅ |
| shopify | not-found | ساعة ابل | — | resolved shop2 | shop2:0.412 shop6:0.392 shop4:0.388 | ❌ |
| salla | exact | عباية مطرزة فاخرة | salla2 | resolved salla2 | salla2:0.651 salla4:0.415 salla1:0.374 | ✅ |
| salla | exact | عطر عود ملكي | salla5 | resolved salla5 | salla5:0.758 salla2:0.351 salla3:0.280 | ✅ |
| salla | exact | بشت رجالي فاخر | salla4 | resolved salla4 | salla4:0.626 salla2:0.323 salla3:0.295 | ✅ |
| salla | ambiguous | عباية | salla1, salla2 | resolved salla2 | salla2:0.435 salla1:0.339 salla5:0.268 | ❌ |
| salla | ambiguous | العباية | salla1, salla2 | not_found | salla2:0.299 salla1:0.281 salla4:0.223 | ❌ |
| salla | ambiguous | عبايات | salla1, salla2 | resolved salla2 | salla2:0.336 salla1:0.292 salla4:0.257 | ❌ |
| salla | ambiguous | abaya | salla1, salla2 | resolved salla1 | salla1:0.480 salla2:0.453 salla6:0.388 | ❌ |
| salla | near-dup | عباية سوداء | salla1 | resolved salla1 | salla1:0.548 salla2:0.512 salla4:0.335 | ✅ |
| salla | near-dup | العباية المطرزة | salla2 | resolved salla2 | salla2:0.427 salla1:0.277 salla3:0.275 | ✅ |
| salla | cross-script | black abaya | salla1 | resolved salla1 | salla1:0.617 salla2:0.531 salla3:0.427 | ✅ |
| salla | partial | ثوب قطن | salla3 | resolved salla3 | salla3:0.640 salla4:0.412 salla2:0.343 | ✅ |
| salla | article | الثوب | salla3 | resolved salla3 | salla3:0.485 salla4:0.360 salla1:0.356 | ✅ |
| salla | cross-script | thobe | salla3 | resolved salla3 | salla3:0.420 salla6:0.295 salla4:0.274 | ✅ |
| salla | article | البشت | salla4 | resolved salla4 | salla4:0.429 salla1:0.211 salla6:0.200 | ✅ |
| salla | article | العود | salla5 | resolved salla5 | salla5:0.318 salla1:0.230 salla2:0.209 | ✅ |
| salla | partial | عطر | salla5 | resolved salla5 | salla5:0.496 salla4:0.316 salla2:0.267 | ✅ |
| salla | cross-script | oud perfume | salla5 | resolved salla5 | salla5:0.476 salla4:0.395 salla2:0.343 | ✅ |
| salla | morphology | طقم عيد للاطفال | salla6 | resolved salla6 | salla6:0.712 salla2:0.309 salla1:0.306 | ✅ |
| salla | category | ملابس اطفال | salla6 | resolved salla6 | salla6:0.570 salla1:0.388 salla3:0.361 | ✅ |
| salla | not-found | حذاء | — | not_found | salla3:0.287 salla6:0.266 salla4:0.260 | ✅ |
| salla | not-found | شماغ | — | not_found | salla2:0.298 salla1:0.226 salla4:0.212 | ✅ |

## 4. Distributions — vec only

- top-1 score when the top-1 is CORRECT (single-answer): n=47 min=0.253 median=0.532 max=0.829
- top-1 score when the top-1 is WRONG (single-answer): n=3 min=0.182 median=0.245 max=0.552
- top-1 score on NOT-FOUND queries (must sit below T_CAND): n=8 min=0.212 median=0.298 max=0.413
- gap top1−top2 on single-answer queries (should exceed GAP): n=50 min=0.006 median=0.155 max=0.516
- gap top1−top2 on AMBIGUOUS queries (should fall below GAP): n=7 min=0.009 median=0.039 max=0.095

## 5. Two-stage decision (trigram first, then semantic) — cost-weighted sweep

Top settings by cost (of 6048 combinations):

| T_TRI | G_TRI | T_VEC | G_VEC | T_SOLO | cost | strict | wrong resolved | false not_found | ambiguous | semantic resolved right |
|---|---|---|---|---|---|---|---|---|---|---|
| 0.2 | 0.15 | 0.25 | 0.12 | 0.35 | **32** | 42/65 | 0 | 2 | 27 | 17 |
| 0.2 | 0.2 | 0.25 | 0.12 | 0.35 | **32** | 42/65 | 0 | 2 | 27 | 18 |
| 0.25 | 0.15 | 0.25 | 0.12 | 0.35 | **32** | 42/65 | 0 | 2 | 27 | 18 |
| 0.25 | 0.2 | 0.25 | 0.12 | 0.35 | **32** | 42/65 | 0 | 2 | 27 | 18 |
| 0.3 | 0.15 | 0.25 | 0.12 | 0.35 | **32** | 42/65 | 0 | 2 | 27 | 20 |
| 0.3 | 0.2 | 0.25 | 0.12 | 0.35 | **32** | 42/65 | 0 | 2 | 27 | 20 |
| 0.35 | 0.15 | 0.25 | 0.12 | 0.35 | **32** | 42/65 | 0 | 2 | 27 | 22 |
| 0.35 | 0.2 | 0.25 | 0.12 | 0.35 | **32** | 42/65 | 0 | 2 | 27 | 22 |
| 0.2 | 0.15 | 0.2 | 0.12 | 0.35 | **32** | 40/65 | 0 | 1 | 30 | 17 |
| 0.2 | 0.2 | 0.2 | 0.12 | 0.35 | **32** | 40/65 | 0 | 1 | 30 | 18 |

Best setting per T_VEC (the not_found floor) — what raising the floor buys and costs:

| T_TRI | G_TRI | T_VEC | G_VEC | T_SOLO | cost | strict | wrong resolved | false not_found | ambiguous | semantic resolved right |
|---|---|---|---|---|---|---|---|---|---|---|
| 0.2 | 0.15 | 0.2 | 0.12 | 0.35 | **32** | 40/65 | 0 | 1 | 30 | 17 |
| 0.2 | 0.15 | 0.25 | 0.12 | 0.35 | **32** | 42/65 | 0 | 2 | 27 | 17 |
| 0.2 | 0.15 | 0.3 | 0.1 | 0.35 | **24** | 45/65 | 1 | 5 | 18 | 19 |
| 0.2 | 0.05 | 0.35 | 0.05 | 0.35 | **4.5** | 48/65 | 4 | 10 | 4 | 24 |
| 0.2 | 0.15 | 0.4 | 0.1 | 0.35 | **-6** | 45/65 | 3 | 14 | 5 | 20 |
| 0.2 | 0.05 | 0.45 | 0.05 | 0.35 | **-24** | 42/65 | 1 | 21 | 2 | 15 |
| 0.2 | 0.05 | 0.5 | 0.05 | 0.35 | **-52** | 35/65 | 1 | 28 | 1 | 9 |

Best setting per T_SOLO (how much the semantic stage is allowed to decide):

| T_TRI | G_TRI | T_VEC | G_VEC | T_SOLO | cost | strict | wrong resolved | false not_found | ambiguous | semantic resolved right |
|---|---|---|---|---|---|---|---|---|---|---|
| 0.2 | 0.15 | 0.25 | 0.12 | 0.35 | **32** | 42/65 | 0 | 2 | 27 | 17 |
| 0.2 | 0.15 | 0.25 | 0.12 | 0.4 | **31** | 41/65 | 0 | 2 | 28 | 16 |
| 0.2 | 0.05 | 0.25 | 0.05 | 0.45 | **27** | 40/65 | 1 | 2 | 27 | 15 |
| 0.2 | 0.15 | 0.25 | 0.1 | 0.5 | **22** | 32/65 | 0 | 2 | 37 | 7 |
| 0.2 | 0.15 | 0.25 | 0.1 | 0.55 | **18** | 28/65 | 0 | 2 | 41 | 3 |
| 0.2 | 0.15 | 0.25 | 0.05 | 1 | **15** | 25/65 | 0 | 2 | 44 | 0 |

Safest settings (zero wrong resolved, then fewest false not_found, then cost):

| T_TRI | G_TRI | T_VEC | G_VEC | T_SOLO | cost | strict | wrong resolved | false not_found | ambiguous | semantic resolved right |
|---|---|---|---|---|---|---|---|---|---|---|
| 0.2 | 0.15 | 0.2 | 0.12 | 0.35 | **32** | 40/65 | 0 | 1 | 30 | 17 |
| 0.2 | 0.2 | 0.2 | 0.12 | 0.35 | **32** | 40/65 | 0 | 1 | 30 | 18 |
| 0.25 | 0.15 | 0.2 | 0.12 | 0.35 | **32** | 40/65 | 0 | 1 | 30 | 18 |
| 0.25 | 0.2 | 0.2 | 0.12 | 0.35 | **32** | 40/65 | 0 | 1 | 30 | 18 |
| 0.3 | 0.15 | 0.2 | 0.12 | 0.35 | **32** | 40/65 | 0 | 1 | 30 | 20 |
| 0.3 | 0.2 | 0.2 | 0.12 | 0.35 | **32** | 40/65 | 0 | 1 | 30 | 20 |

### Per-query detail at the SAFEST setting (T_TRI=0.2, G_TRI=0.15, T_VEC=0.2, G_VEC=0.12, T_SOLO=0.35)

| page | class | query | expected | stage | decision | tri top-2 | vec top-3 | cost |
|---|---|---|---|---|---|---|---|---|
| zid | exact | Sony A7S III | d2fc56 | trigram | resolved d2fc56 | d2fc56:0.63 aa38a9:0.03 | d2fc56:0.829 c51630:0.332 aa38a9:0.223 | ✅ 1 |
| zid | exact | نظارة شمسية | c51630 | trigram | resolved c51630 | c51630:0.64 aa38a9:0.00 | c51630:0.754 d2fc56:0.287 c51712:0.195 | ✅ 1 |
| zid | exact | قميص قطني رجالي | c51712 | trigram | resolved c51712 | c51712:0.65 aa38a9:0.00 | c51712:0.785 aa38a9:0.269 c51630:0.238 | ✅ 1 |
| zid | exact | Running Shoes | aa38a9 | trigram | resolved aa38a9 | aa38a9:0.64 d2fc56:0.03 | aa38a9:0.693 c51712:0.230 c51630:0.200 | ✅ 1 |
| zid | article | النظارة | c51630 | semantic | resolved c51630 | c51630:0.16 d2fc56:0.01 | c51630:0.536 d2fc56:0.236 c51712:0.185 | ✅ 1 |
| zid | article | القميص | c51712 | semantic | resolved c51712 | c51712:0.10 d2fc56:0.01 | c51712:0.653 aa38a9:0.265 c51630:0.186 | ✅ 1 |
| zid | article | النظارة الشمسية | c51630 | trigram | resolved c51630 | c51630:0.29 d2fc56:0.00 | c51630:0.701 d2fc56:0.312 aa38a9:0.225 | ✅ 1 |
| zid | article | بكم القميص القطني | c51712 | semantic | resolved c51712 | c51712:0.17 d2fc56:0.00 | c51712:0.574 aa38a9:0.263 d2fc56:0.174 | ✅ 1 |
| zid | morphology | نظارات | c51630 | semantic | resolved c51630 | c51630:0.17 aa38a9:0.00 | c51630:0.528 d2fc56:0.243 aa38a9:0.195 | ✅ 1 |
| zid | morphology | نظاره شمسيه | c51630 | trigram | resolved c51630 | c51630:0.33 aa38a9:0.00 | c51630:0.646 d2fc56:0.280 aa38a9:0.169 | ✅ 1 |
| zid | morphology | قمصان | c51712 | semantic | resolved c51712 | c51712:0.07 c51630:0.00 | c51712:0.493 aa38a9:0.295 c51630:0.213 | ✅ 1 |
| zid | cross-script | سوني | d2fc56 | semantic | ambiguous [d2fc56, c51630] | c51712:0.03 d2fc56:0.01 | d2fc56:0.376 c51630:0.296 c51712:0.183 | 🟡 0 |
| zid | cross-script | كاميرا سوني | d2fc56 | semantic | resolved d2fc56 | c51712:0.03 d2fc56:0.01 | d2fc56:0.468 c51630:0.333 c51712:0.173 | ✅ 1 |
| zid | cross-script | كاميرا | d2fc56 | semantic | ambiguous [d2fc56, c51630] | c51630:0.00 aa38a9:0.00 | d2fc56:0.331 c51630:0.307 c51712:0.172 | 🟡 0 |
| zid | cross-script | حذاء رياضي | aa38a9 | semantic | resolved aa38a9 | aa38a9:0.03 c51712:0.03 | aa38a9:0.532 c51712:0.386 c51630:0.215 | ✅ 1 |
| zid | cross-script | الحذاء | aa38a9 | semantic | resolved aa38a9 | aa38a9:0.01 d2fc56:0.01 | aa38a9:0.407 c51712:0.287 c51630:0.164 | ✅ 1 |
| zid | cross-script | عندكم حذاء للجري؟ | aa38a9 | semantic | ambiguous [aa38a9, c51712] | aa38a9:0.01 c51630:0.00 | aa38a9:0.456 c51712:0.339 c51630:0.195 | 🟡 0 |
| zid | cross-script | shirt | c51712 | semantic | ambiguous [c51712, aa38a9, c51630] | aa38a9:0.07 d2fc56:0.04 | c51712:0.387 aa38a9:0.323 c51630:0.238 | 🟡 0 |
| zid | cross-script | sunglasses | c51630 | semantic | resolved c51630 | aa38a9:0.06 d2fc56:0.03 | c51630:0.407 aa38a9:0.258 d2fc56:0.212 | ✅ 1 |
| zid | cross-script | camera | d2fc56 | semantic | ambiguous [d2fc56, c51630] | d2fc56:0.02 c51630:0.00 | d2fc56:0.427 c51630:0.376 aa38a9:0.176 | 🟡 0 |
| zid | not-found | ساعة ذكية | — | semantic | ambiguous [c51630, aa38a9, d2fc56] | c51630:0.03 d2fc56:0.00 | c51630:0.413 aa38a9:0.293 d2fc56:0.277 | ❌ -0.5 |
| zid | not-found | بتشحنوا لحلب | — | semantic | ambiguous [c51630] | c51630:0.00 aa38a9:0.00 | c51630:0.212 aa38a9:0.177 c51712:0.131 | ❌ -0.5 |
| zid | not-found | iphone | — | semantic | ambiguous [d2fc56, c51630, aa38a9] | d2fc56:0.03 c51630:0.00 | d2fc56:0.375 c51630:0.308 aa38a9:0.206 | ❌ -0.5 |
| zid | not-found | عطر | — | semantic | ambiguous [c51712, c51630] | c51630:0.00 aa38a9:0.00 | c51712:0.238 c51630:0.215 aa38a9:0.193 | ❌ -0.5 |
| shopify | exact | iPhone 15 Pro | shop1 | trigram | resolved shop1 | shop1:0.62 shop5:0.27 | shop1:0.800 shop5:0.618 shop4:0.472 | ✅ 1 |
| shopify | exact | AirPods Pro | shop4 | trigram | resolved shop4 | shop4:0.33 shop1:0.12 | shop4:0.739 shop1:0.497 shop5:0.420 | ✅ 1 |
| shopify | exact | Apple TV 4K | shop6 | trigram | resolved shop6 | shop6:0.62 shop3:0.03 | shop6:0.751 shop1:0.414 shop3:0.375 | ✅ 1 |
| shopify | exact | MacBook Air M3 | shop3 | trigram | resolved shop3 | shop3:0.62 shop4:0.06 | shop3:0.816 shop6:0.348 shop1:0.339 | ✅ 1 |
| shopify | ambiguous | iPhone 15 | shop1, shop5 | semantic | ambiguous [shop1, shop5, shop6] | shop1:0.44 shop5:0.31 | shop1:0.716 shop5:0.635 shop6:0.435 | ✅ 1 |
| shopify | ambiguous | ايفون | shop1, shop5 | semantic | ambiguous [shop6, shop2, shop5] | shop4:0.02 shop5:0.00 | shop6:0.382 shop2:0.372 shop5:0.368 | ❌ -1 |
| shopify | ambiguous | جوال | shop1, shop2 | semantic | ambiguous [shop2, shop5, shop1] | shop1:0.01 shop2:0.01 | shop2:0.346 shop5:0.306 shop1:0.302 | ✅ 1 |
| shopify | cross-script | ايفون 15 برو | shop1 | semantic | ambiguous [shop5, shop1, shop6] | shop1:0.08 shop5:0.07 | shop5:0.552 shop1:0.546 shop6:0.432 | 🟡 0 |
| shopify | near-dup | كفر ايفون | shop5 | semantic | resolved shop5 | shop5:0.10 shop4:0.02 | shop5:0.545 shop1:0.390 shop6:0.386 | ✅ 1 |
| shopify | near-dup | كفر | shop5 | semantic | resolved shop5 | shop5:0.12 shop1:0.00 | shop5:0.397 shop6:0.186 shop4:0.174 | ✅ 1 |
| shopify | cross-script | سامسونج | shop2 | semantic | resolved shop2 | shop4:0.00 shop3:0.00 | shop2:0.499 shop1:0.367 shop5:0.338 | ✅ 1 |
| shopify | cross-script | جالكسي | shop2 | semantic | ambiguous [shop5, shop2] | shop6:0.00 shop1:0.00 | shop5:0.245 shop2:0.236 shop1:0.177 | 🟡 0 |
| shopify | cross-script | هاتف سامسونج | shop2 | semantic | ambiguous [shop2, shop1, shop5] | shop4:0.00 shop3:0.00 | shop2:0.538 shop1:0.444 shop5:0.378 | 🟡 0 |
| shopify | cross-script | ماك بوك | shop3 | semantic | ambiguous [shop3, shop6] | shop1:0.00 shop2:0.00 | shop3:0.253 shop6:0.201 shop1:0.191 | 🟡 0 |
| shopify | category | لابتوب | shop3 | semantic | ambiguous [shop3, shop6, shop2] | shop3:0.01 shop4:0.00 | shop3:0.325 shop6:0.293 shop2:0.287 | 🟡 0 |
| shopify | cross-script | ايربودز | shop4 | semantic | not_found | shop4:0.02 shop6:0.00 | shop2:0.182 shop6:0.153 shop1:0.117 | ❌ -3 |
| shopify | category | سماعات | shop4 | semantic | ambiguous [shop4, shop2, shop5] | shop4:0.01 shop3:0.01 | shop4:0.409 shop2:0.332 shop5:0.289 | 🟡 0 |
| shopify | cross-script | ابل تي في | shop6 | semantic | ambiguous [shop6, shop5] | shop4:0.02 shop1:0.01 | shop6:0.292 shop5:0.204 shop1:0.174 | 🟡 0 |
| shopify | not-found | شاحن | — | semantic | ambiguous [shop3, shop5, shop1] | shop2:0.00 shop4:0.00 | shop3:0.286 shop5:0.267 shop1:0.261 | ❌ -0.5 |
| shopify | not-found | ساعة ابل | — | semantic | ambiguous [shop2, shop6, shop4] | shop4:0.03 shop3:0.01 | shop2:0.412 shop6:0.392 shop4:0.388 | ❌ -0.5 |
| salla | exact | عباية مطرزة فاخرة | salla2 | trigram | resolved salla2 | salla2:0.63 salla1:0.13 | salla2:0.651 salla4:0.415 salla1:0.374 | ✅ 1 |
| salla | exact | عطر عود ملكي | salla5 | trigram | resolved salla5 | salla5:0.62 salla2:0.05 | salla5:0.758 salla2:0.351 salla3:0.280 | ✅ 1 |
| salla | exact | بشت رجالي فاخر | salla4 | trigram | resolved salla4 | salla4:0.62 salla3:0.14 | salla4:0.626 salla2:0.323 salla3:0.295 | ✅ 1 |
| salla | ambiguous | عباية | salla1, salla2 | semantic | ambiguous [salla2, salla1, salla5] | salla2:0.21 salla1:0.20 | salla2:0.435 salla1:0.339 salla5:0.268 | ✅ 1 |
| salla | ambiguous | العباية | salla1, salla2 | semantic | ambiguous [salla2, salla1, salla4] | salla2:0.12 salla1:0.11 | salla2:0.299 salla1:0.281 salla4:0.223 | ✅ 1 |
| salla | ambiguous | عبايات | salla1, salla2 | semantic | ambiguous [salla2, salla1, salla4] | salla2:0.12 salla1:0.12 | salla2:0.336 salla1:0.292 salla4:0.257 | ✅ 1 |
| salla | ambiguous | abaya | salla1, salla2 | semantic | ambiguous [salla1, salla2, salla6] | salla1:0.01 salla2:0.01 | salla1:0.480 salla2:0.453 salla6:0.388 | ✅ 1 |
| salla | near-dup | عباية سوداء | salla1 | trigram | resolved salla1 | salla1:0.40 salla2:0.16 | salla1:0.548 salla2:0.512 salla4:0.335 | ✅ 1 |
| salla | near-dup | العباية المطرزة | salla2 | semantic | resolved salla2 | salla2:0.21 salla1:0.09 | salla2:0.427 salla1:0.277 salla3:0.275 | ✅ 1 |
| salla | cross-script | black abaya | salla1 | semantic | ambiguous [salla1, salla2, salla3] | salla1:0.02 salla2:0.01 | salla1:0.617 salla2:0.531 salla3:0.427 | 🟡 0 |
| salla | partial | ثوب قطن | salla3 | trigram | resolved salla3 | salla3:0.26 salla6:0.01 | salla3:0.640 salla4:0.412 salla2:0.343 | ✅ 1 |
| salla | article | الثوب | salla3 | semantic | resolved salla3 | salla3:0.06 salla6:0.04 | salla3:0.485 salla4:0.360 salla1:0.356 | ✅ 1 |
| salla | cross-script | thobe | salla3 | semantic | resolved salla3 | salla3:0.01 salla5:0.00 | salla3:0.420 salla6:0.295 salla4:0.274 | ✅ 1 |
| salla | article | البشت | salla4 | semantic | resolved salla4 | salla4:0.07 salla6:0.03 | salla4:0.429 salla1:0.211 salla6:0.200 | ✅ 1 |
| salla | article | العود | salla5 | semantic | ambiguous [salla5, salla1, salla2] | salla5:0.09 salla6:0.03 | salla5:0.318 salla1:0.230 salla2:0.209 | 🟡 0 |
| salla | partial | عطر | salla5 | trigram | resolved salla5 | salla5:0.21 salla6:0.04 | salla5:0.496 salla4:0.316 salla2:0.267 | ✅ 1 |
| salla | cross-script | oud perfume | salla5 | semantic | ambiguous [salla5, salla4, salla2] | salla5:0.02 salla6:0.00 | salla5:0.476 salla4:0.395 salla2:0.343 | 🟡 0 |
| salla | morphology | طقم عيد للاطفال | salla6 | trigram | resolved salla6 | salla6:0.43 salla5:0.03 | salla6:0.712 salla2:0.309 salla1:0.306 | ✅ 1 |
| salla | category | ملابس اطفال | salla6 | semantic | resolved salla6 | salla6:0.19 salla5:0.06 | salla6:0.570 salla1:0.388 salla3:0.361 | ✅ 1 |
| salla | not-found | حذاء | — | semantic | ambiguous [salla3, salla6, salla4] | salla1:0.03 salla5:0.00 | salla3:0.287 salla6:0.266 salla4:0.260 | ❌ -0.5 |
| salla | not-found | شماغ | — | semantic | ambiguous [salla2, salla1, salla4] | salla2:0.00 salla5:0.00 | salla2:0.298 salla1:0.226 salla4:0.212 | ❌ -0.5 |
