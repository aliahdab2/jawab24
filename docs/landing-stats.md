# Landing social-proof stats — provenance and refresh procedure

The numbers in the landing page's social-proof block are **measured claims**, not
marketing rounding. They live in `frontend/src/i18n/{en,ar}/landing.json` under
`testimonials.*` and are rendered by
`frontend/src/components/landing/LandingSocialProof.tsx`.

| Key | Claim | Published | Actually measured |
|-----|-------|-----------|-------------------|
| `stat1Value` | Median time to reply to a customer | **6 seconds** | ≤2.7 s — see the latency caveat |
| `stat2Value` | Replies sent automatically | **300,000+** (`+300,000` in AR) | 305,792 |
| `stat3Value` | Share of replies sent automatically | **99%** | 98.97% |
| `statsScope` | Scope line governing all three | **58 business pages, March–August 2026** | 58 pages, 2026-03-12 → 2026-08-21 |

Measured **2026-08-21** against production via `scripts/prod-db-query.sh` (SELECT-only).
The previous values (193,694 / 53 pages) had gone stale by ~112,000 replies.

## Every number here is published as a floor, never as an exact figure

This is the rule that keeps the block from rotting, and it is why `stat2Value` reads
`300,000+` rather than `305,792`.

The fleet adds roughly **1,950 automated replies per day**. An exact figure is therefore
false again within about six weeks and badly wrong within four months — which is exactly
how the previous value drifted 112,000 replies off without anyone noticing. A floor on a
monotonically increasing quantity can only ever become *more* true with time: it degrades
to "conservative", never to "false".

So:

- **`stat2Value`** — round the measured total **down** to a clean threshold and append the
  plus. Bump it only when the real figure clears the next threshold (400,000, 500,000…).
- **`stat3Value`** — 98.97% published as 99% is a rounding *up* of less than a
  point on a ratio that has been stable since March. If it ever drops below 99%, lower
  the published claim rather than leaving it.
- **`stat1Value`** — see the latency caveat; 6 s is far above either measured basis.

**Do not "improve" this by wiring the real count into `getStaticProps` at build time.**
It was considered and rejected on 2026-08-21: the landing page is the most SEO-critical
page in the product, and a build-time production-DB dependency turns a database hiccup
into a failed build or a landing page with a missing number. A stat block that needs
touching once a year is not worth that failure mode.

> ⚠️ **Arabic `+` placement is unverified.** EN uses a trailing plus (`300,000+`), AR a
> leading one (`+300,000`), following the usual convention in each language. Under the
> BiDi algorithm a plus at the edge of a digit run is a neutral and resolves against the
> paragraph direction, so its *rendered* side in the RTL tile may not match how it is
> typed here. It was not possible to render it when this was written. **Eyeball the
> Arabic tile on the dev server or in production** and, if the plus lands somewhere
> confusing, fix it by wrapping the value in an LTR isolate (`⁦…⁩`) rather
> than by flipping the character and hoping.

> ⚠️ `statsScope` governs **all three** stats. If you refresh one, re-run all three —
> otherwise the untouched numbers are silently republished under a scope that no longer
> describes them.

## The queries

A reply is a row in `messages` or `comments` with `replied = true`. `comments` has no
`page_id`; it reaches a page through `posts`. "Automated" means
`reply_method IN ('ai', 'post_reply', 'template')` — the explicit list, not "everything
except `manual`": `app_auto` (the merchant's WhatsApp Business app greeting/away echoed
on a Coexistence number, D-109) is neither ours nor a human reply and lands in neither
bucket, though it does count toward `all_replies` below.

**`stat2Value` (automated replies), `stat3Value` (automated share), `statsScope` (pages):**

```sql
WITH r AS (
  SELECT page_id, reply_method, created_at FROM messages WHERE replied
  UNION ALL
  SELECT po.page_id, c.reply_method, c.created_at
    FROM comments c JOIN posts po ON po.id = c.post_id
   WHERE c.replied
)
SELECT count(*) FILTER (WHERE reply_method IN ('ai','post_reply','template')) AS automated,
       count(*)                                                              AS all_replies,
       count(DISTINCT page_id)                                               AS pages,
       min(created_at)::date                                                 AS window_start,
       max(created_at)::date                                                 AS window_end
  FROM r;
```

2026-08-21 result: `305792 | 308983 | 58 | 2026-03-12 | 2026-08-21`.
`stat3Value` = 305,792 / 308,983 = **98.97%**, published as 99%.

Note that `post_reply` (keyword-triggered, no model call) is a large share of the
automated total — 17,609 of the 58,724 automated replies in the trailing 30 days. It
belongs in `stat2Value` ("sent automatically") but **must not** be counted when
claiming AI reply volume anywhere else.

**`stat1Value` (median reply latency):**

```sql
WITH r AS (
  SELECT extract(epoch FROM (replied_at - created_time)) s
    FROM messages
   WHERE replied AND replied_at IS NOT NULL AND created_time IS NOT NULL
     AND reply_method = 'ai'
  UNION ALL
  SELECT extract(epoch FROM (c.replied_at - c.created_time))
    FROM comments c
   WHERE c.replied AND c.replied_at IS NOT NULL AND c.created_time IS NOT NULL
     AND c.reply_method = 'ai'
)
SELECT count(*), percentile_cont(0.5) WITHIN GROUP (ORDER BY s) median_s,
       percentile_cont(0.9) WITHIN GROUP (ORDER BY s) p90_s
  FROM r WHERE s >= 0;
```

`created_time` is the platform's own timestamp (when the customer sent it);
`created_at` is when our row was inserted. Both were measured on 2026-08-21:

| Basis | n | median | p90 |
|-------|---|--------|-----|
| `replied_at − created_at` | 226,002 | 2.7 s | 10.5 s |
| `replied_at − created_time` | 220,252 | 0.0 s † | 9.2 s |

† **Not a sub-millisecond reply.** `created_time` has second granularity, so the
percentile truncates. The bucket histogram is the honest read: 52% of AI replies land in
the 0–2 s bucket (semantic reply-cache hits are milliseconds, per AI_INSTRUCTIONS §17),
with a real 2–6 s tail of OpenAI calls and ~6,800 beyond 20 s.

⚠️ **Unexplained, do not paper over:** the end-to-end basis should be *larger* than the
internal one (`created_time ≤ created_at`), and it measures smaller. The populations also
differ by ~5,750 rows. Until someone diagnoses that, treat neither figure as a defensible
public latency claim. This is why **6 seconds was left unchanged** on the 2026-08-21
refresh: it over-states our latency on either basis, which is the safe direction for a
public claim.

## Rules for changing these numbers

1. **Never publish a number you have not just measured**, even when raising a floor.
   These are public claims about a live product; a stale one is a false statement, not an
   approximation.
2. **Publish floors, not exact figures** — see the section above. The reason the floor
   exists is that nobody will remember to re-run these queries.
3. **Only move `stat1Value` in the conservative direction** until the discrepancy above
   is resolved. Latency is the easiest of these claims to overstate.
4. **Aggregates only.** No merchant names, page names, or logos. The single named
   testimonial (الفريق الدمشقي) is there by explicit consent.
5. Both locales carry Western digits — keep them in step.
