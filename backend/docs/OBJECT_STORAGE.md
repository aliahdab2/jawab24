# Object Storage (S3-compatible)

Single source of truth for how Jawab24 stores merchant-uploaded images. Written to
survive provider moves, backups, key rotation, and account handoffs — if it's about
where image bytes live, it's here.

## 1. Overview

`backend/src/services/imageStorage.ts` is a **thin, provider-agnostic S3 wrapper**.
Application code talks the S3 API through it; the actual bucket (Backblaze B2,
Cloudflare R2, AWS S3, or self-hosted MinIO) is chosen entirely by env. Swapping
provider is an env change with **zero code change**.

**Who uses it today:** Post Reply trigger images (an image attached to a per-post
keyword reply, delivered on the DM channel). On Messenger/Instagram it is sent as
**two messages** — the reply text, then a **native image attachment**
(`metaMessaging.imageAttachmentMessage` via the shared `sendMetaImageAttachment`), so
the customer gets the full uniform text plus a full, uncropped, tap-to-open image.
(Meta's Messenger/IG API has no single "image + caption" message; a generic-template
card was tried first but cropped the image and split/capped the text — see the git
history. WhatsApp, when added, sends one message with a native caption.) The service is
**deliberately reply-type-agnostic** — a future "Smart Reply with image" feature is
expected to reuse it and the image send path as-is; the only net-new work then is the AI
image-*selection* problem (a merchant image library + retrieval), not this plumbing.
**The door was left open on purpose.**

**Model = ManyChat, right-sized:** per-file size cap only, no total-storage wall,
reference-based auto-cleanup. A central reusable media-library UI is intentionally
deferred until Smart Reply images need it.

## 2. Interface contract (keep it thin)

```ts
imageStorage.put(key, buffer, mimeType) → { url, key }
imageStorage.remove(key) → boolean          // best-effort, logs+swallows
imageStorage.isConfigured() → boolean       // feature gate
```

**Rule:** no provider-specific detail (presigned URLs, path-style flags, provider
names) may leak through these three methods. Every quirk stays inside the file. If a
caller ever needs to know which provider is behind it, the abstraction has failed.

## 3. Environment variables

| Var | Meaning | Required | Example |
|-----|---------|----------|---------|
| `S3_BUCKET` | Bucket name | ✅ | `jawab-media` |
| `S3_ACCESS_KEY_ID` | Access key id | ✅ | `002abc…` |
| `S3_SECRET_ACCESS_KEY` | Secret key | ✅ | *(secret)* |
| `S3_PUBLIC_BASE_URL` | Public base the bucket serves from; stored URL is `${base}/${key}` — this is what Meta fetches | ✅ | `https://media.jawab24.com` |
| `S3_ENDPOINT` | Custom endpoint. **Empty ⇒ real AWS S3.** Set ⇒ B2/R2/MinIO (forces path-style internally) | — | `https://s3.us-west-002.backblazeb2.com` |
| `S3_REGION` | Region | — (default `us-east-1`) | `us-west-002` |
| `POST_REPLY_IMAGE_QUOTA_BYTES` | Per-workspace generous abuse cap | — (default 1 GB) | `1073741824` |

**`isConfigured()`** returns true only when `S3_BUCKET`, `S3_ACCESS_KEY_ID`,
`S3_SECRET_ACCESS_KEY`, and `S3_PUBLIC_BASE_URL` are all set. Any missing ⇒ feature
OFF (picker hidden, uploads rejected with `Image attachments are not available`), and
the rest of the app boots normally. **Never** fail-fast on this — it's optional.

## 4. Current provider — Backblaze B2 (recommended)

Reuses the existing B2 account (already used for DB backups), so no new vendor.

1. **Create a bucket** (e.g. `jawab-media`), type **Public**.
2. **Serve it over your domain / Cloudflare** for free egress → that hostname is
   `S3_PUBLIC_BASE_URL` (e.g. `https://media.jawab24.com`). The raw B2 friendly URL
   (`https://f002.backblazeb2.com/file/jawab-media`) also works if you skip the CDN.
3. **Create an application key scoped to that bucket** → `S3_ACCESS_KEY_ID` (keyID) +
   `S3_SECRET_ACCESS_KEY` (applicationKey).
4. **Endpoint + region** come from the bucket's "Endpoint" (e.g.
   `s3.us-west-002.backblazeb2.com` → `S3_ENDPOINT=https://…`, `S3_REGION=us-west-002`).
5. Set the 6 vars in prod `env/backend.env`. Redeploy. Never commit secrets.
6. No bucket CORS rule is needed — the app serves downloads through its own origin. See §4b.

**Cost:** first 10 GB storage free, then $6/TB/mo; 3× storage free egress (free via
Cloudflare). At one 2 MB image per post, realistic volume is effectively $0.

## 4b. Displaying ≠ downloading — and why downloads go through US

Two different browser operations, with different permission rules, and they are easy to
confuse because one of them lets the image *look* perfectly fine:

| Path | What the browser needs | Where |
|------|------------------------|-------|
| `<img src>` — previews | CSP `img-src` only. The bucket's consent is NOT required. | `nginx/nginx.conf` |
| Saving the file | the bytes must be **readable**, not merely displayable | our own API |

Shipped broken (Sentry `JAWAB24-FRONTEND-31`): the frontend fetched the bucket URL
directly to get a Blob for the share sheet, because a cross-origin `<a download>`
navigates instead of downloading. The bucket serves no `Access-Control-Allow-Origin`, so
**every** «حفظ الصورة» press threw `TypeError: Failed to fetch` from the day the feature
shipped, while previews rendered normally and hid it.

**The fix is `GET /pages/:pageId/post-suggestions/:suggestionId/image`** — the app reads
the object with `imageStorage.get()` and returns it from its own origin with
`Content-Disposition: attachment`. Same-origin, so cross-origin permission never enters
the picture.

⛔ **Do not "fix" this by adding a bucket CORS rule.** That was the earlier plan and it is
now the wrong one:

- it lives in **provider config, outside this repo** — no test can pin it, and it is lost
  on a key rotation or a bucket move (§8);
- it still would not be reliable in the Android WebView, whose cross-origin download
  semantics are narrower than a desktop browser's;
- it would put every merchant's media one guessable URL away from anyone, whereas the
  route above checks workspace ownership before it reads a single byte.

⭐ The storage key is **derived server-side** from (workspace, page, suggestion, take
index). The route accepts a take INDEX and never a key or a URL — taking either would be
an arbitrary read of the whole bucket behind one authenticated session.

Note that CSP `connect-src` no longer needs the storage host for this feature; `img-src`
still does, and stays pinned by `backend/src/__tests__/nginx-config.test.ts`.

## 5. Switching provider (the payoff — env-only, no code change)

**Cloudflare R2** (zero egress):
```
S3_ENDPOINT=https://<accountid>.r2.cloudflarestorage.com
S3_REGION=auto
S3_BUCKET=jawab-media
S3_ACCESS_KEY_ID=<r2 access key>
S3_SECRET_ACCESS_KEY=<r2 secret>
S3_PUBLIC_BASE_URL=https://media.jawab24.com   # R2 public bucket / custom domain
```

**AWS S3** (leave endpoint empty → region-based addressing):
```
S3_ENDPOINT=
S3_REGION=eu-central-1
S3_BUCKET=jawab-media
S3_ACCESS_KEY_ID=AKIA…
S3_SECRET_ACCESS_KEY=<secret>
S3_PUBLIC_BASE_URL=https://jawab-media.s3.eu-central-1.amazonaws.com
```

**Self-hosted MinIO** (the documented fallback — keeps bytes on your own infra). Add
to `docker-compose.yml` next to postgres/redis:
```yaml
  minio:
    image: minio/minio:RELEASE.2025-01-01T00-00-00Z   # pin, don't use :latest
    command: server --console-address ":9001" /data
    environment:
      MINIO_ROOT_USER: ${MINIO_ROOT_USER:?}
      MINIO_ROOT_PASSWORD: ${MINIO_ROOT_PASSWORD:?}
    volumes: [ "minio-data:/data" ]
    networks: [ jawab-net ]           # internal only — nginx fronts it
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:9000/minio/health/live"]
  createbuckets:
    image: minio/mc
    depends_on: [ minio ]
    entrypoint: >
      /bin/sh -c "mc alias set local http://minio:9000 $$MINIO_ROOT_USER $$MINIO_ROOT_PASSWORD &&
      mc mb --ignore-existing local/jawab-media &&
      mc anonymous set download local/jawab-media"   # public-read (non-deprecated form)
```
nginx: add a `location /media/ { proxy_pass http://minio:9000/jawab-media/; }` under
the TLS server, then:
```
S3_ENDPOINT=http://minio:9000
S3_BUCKET=jawab-media
S3_ACCESS_KEY_ID=${MINIO_ROOT_USER}
S3_SECRET_ACCESS_KEY=${MINIO_ROOT_PASSWORD}
S3_PUBLIC_BASE_URL=https://jawab24.com/media
```
`forcePathStyle` is applied automatically whenever `S3_ENDPOINT` is set. Add the
`minio-data` volume to your host backup routine (see §6).

⚠️ **Env-only applies to CODE, not to the CSP.** Any swap that changes the
`S3_PUBLIC_BASE_URL` *host* also needs the new host added to CSP `img-src`, or previews
go blank. Nothing in the app fails at boot when you forget. Downloads are unaffected —
they are served from our own origin (§4b) and never touch the storage host from the
browser. The MinIO variant above needs nothing at all: it serves from
`https://jawab24.com/media`, which is already same-origin.

## 6. Backup & restore

- **Managed provider (B2/R2/S3):** durability is the provider's job. **Enable bucket
  versioning** so an accidental overwrite/delete is recoverable, and add a lifecycle
  rule to expire **non-current** versions after N days (30–90) so versioning can't
  grow unbounded. **No image data is in `pg_dump`** — only the `trigger_image_url` /
  `trigger_image_key` text columns. Nothing extra to back up.
- **MinIO fallback:** extend `scripts/backup.sh` after the DB dump —
  `docker compose exec -T minio mc mirror --overwrite local/jawab-media "$BACKUP_DIR/media"`,
  then upload `media/` in the same B2 block. `scripts/restore.sh` mirrors it back.

## 7. Key rotation (no downtime)

1. Create a NEW application key scoped to the same bucket.
2. Update `S3_ACCESS_KEY_ID` / `S3_SECRET_ACCESS_KEY` in prod env.
3. Redeploy (new client picks up the new key).
4. Revoke the OLD key in the provider console.

See the broader secret-rotation practice for cadence.

## 8. Upload normalization (metadata stripping) — MANDATORY

`normalizeImage` (`src/services/imageNormalize.ts`) re-encodes every upload before it is
stored. It is called from `controllers/posts.ts` right after the magic-byte check.

**Why it exists:** uploads were previously written byte-for-byte, so EXIF survived —
including the **GPS coordinates** a phone camera records. The bucket is public and its URL
is handed to customers (the «عرض الصورة» button redirects to it, see §11), so a merchant
photographing products at home was publishing their home location to anyone who tapped.
Re-encoding drops every metadata chunk. Bounding the long edge to 1920px is a secondary
benefit: with `is_reusable: false` Meta re-fetches per recipient, so it bounds egress too.

**Placement is load-bearing — do NOT move this into `imageStorage.put`.** The quota check
and the stored `trigger_image_bytes` (`services/posts.ts`) are computed from the buffer
*before* upload; normalizing inside `put` would leave the DB recording pre-normalization
sizes forever, permanently drifting the quota from reality.

Invariants (all covered by `test/services/imageNormalize.test.ts`):

- **Format is pinned to the input** — JPEG→JPEG, PNG→PNG, WEBP→WEBP. Changing it would
  desync the stored `mimeType` and the key's extension (`extForMime`) from the content.
- **`.rotate()` runs before the metadata is dropped**, baking in the EXIF Orientation tag.
  Skip it and every photo a phone recorded sideways is stored sideways.
- **Animated WEBP is re-encoded but not resized** — sharp resizes the stacked frame strip,
  and getting that wrong corrupts the animation. `{ animated: true }` is required or sharp
  silently collapses it to frame one.
- **Transparency is preserved** (no `.flatten()`).
- **Undecodable input is rejected with a 400**, never stored raw. A silent fallback to the
  original buffer would reintroduce the leak invisibly — that is the whole failure mode.

`sharp` is a **native** dependency. It is verified to load on `node:22-alpine` (amd64 and
arm64) even with the Dockerfile's `npm ci --ignore-scripts`, but re-verify in-container on
any Node or base-image bump — a missing platform binary fails at require time, i.e. boot.

**Images uploaded before this shipped still carry their EXIF.** Normalization applies to new
uploads only; there is no backfill. A one-off reprocess pass rewrites live objects and needs
its own decision.

## 9. Data lifecycle / GDPR

- **Key schemes (one per writer):**
  - `trigger-images/{workspaceId}/{uuid}.{ext}` — Post Reply trigger images
    (`postsService.updateTrigger`).
  - `generated-posts/{workspaceId}/{uuid}.jpg` — «إنشاء منشور» AI-suggested post images
    (`services/postSuggestions.ts`, pilot 2026-08; JPEG q88 — photographic cards, ~10×
    smaller than PNG). The reuse the door was left open for (§1) — same three-method
    surface, no new abstraction.
- **Reference-based lifecycle (industry standard):** an image lives exactly as long as
  its Post Reply. On replace / remove / trigger-clear the old object is deleted
  (`postsService.updateTrigger`, safe-order: upload new → commit DB → delete old, so a
  live image is never lost). Page delete drops all its images
  (`pagesService.deletePage`). **Age-based expiry targets ONLY orphaned/non-current
  objects — never a live, referenced image.**
  ⚠️ **Post-suggestion images do NOT follow the reference-based lifecycle — they are
  KEPT (changed 2026-08-13, D-077).** Until then a regenerate superseded the old row and
  best-effort deleted its objects after commit. That destroyed the merchant's work — in
  production on 11 Aug a page's three attempts produced its best post FIRST and the third
  erased it — and it was backwards economically, an image costing ~$0.0064 to generate
  and a fraction of a cent a year to store. So **a `superseded` row is a LIVE, REFERENCED
  row**: it keeps `image_url` / `image_key` and every `variants[].imageKey`, and the
  merchant's history strip renders those objects. Supersede is now a status relabel and
  touches storage not at all.
  Consequences to respect:
  - **Nothing but page delete removes a `generated-posts/` object.** There is no other
    sweep, and there must not be an age-based one — every row that names a key is live.
  - **The orphan audit's meaning is unchanged but its input grew**: bucket objects with
    no DB row are still safe-to-clean; objects named by a superseded row are NOT.
  - Rows written before 2026-08-13 were gutted by the old path — they carry
    `image_url = NULL` with their files already deleted, and render text-only in the
    strip. That is history, not a bug to repair.
  Page delete still removes the `generated-posts/` objects after the cascade commits
  (`pagesService.deletePage`), so the "page delete drops all its images" invariant holds
  for BOTH prefixes.
  ⚠️ **A post-suggestion row owns SEVERAL objects, not one.** Since variants (migration
  0162) a generation stores one card per take, and `image_key` mirrors only the SELECTED
  take. The page-delete sweep must therefore go through `imageKeysOf(row)`
  (`lib/postSuggestionVariants.ts`), which unions the mirrored column with every
  `variants[].imageKey` and deduplicates the overlap. Collecting `image_key` alone
  silently leaks N-1 objects per row. (Supersede used to be the second caller; it is not
  a caller at all any more, which is why the leak it once risked cannot recur there.)
- **Never hand a storage key to something that outlives it.** Deleting a replaced object is
  correct (it keeps the workspace quota honest), but a delivered message is permanent — so a
  sent message must never embed the bucket URL. See §11. (Post-suggestion images are never
  sent by us at all — the merchant downloads and posts manually.)
- **Audit:** `npx ts-node src/scripts/audit-trigger-images.ts` (READ-ONLY) covers BOTH
  prefixes: lists DB rows whose object is missing (investigate) and bucket objects with
  no DB row (safe-to-clean orphans). Run before any bulk cleanup.

## 10. Delivery — differs per platform

**Facebook: ONE message (an inline card).** Meta allows exactly **one** message on a cold
comment→DM, so image and text must ride together: `sendPrivateReplyWithImage`
(`sender.ts`) sends a generic-template card whose `image_url` is the bucket URL. A short
caption shows in full; a long one shows a teaser plus a «Read more» postback. A
non-transient rejection falls back to a plain-text private reply (`imageDelivered` stays
false, so the `flagMeta.reply_image` badge never claims an image the customer didn't get);
a transient error rethrows so the whole job retries with nothing partially sent.

> A two-message design (text, then a separate image) shipped on 2026-07-18 and was
> **reversed** on 07-19 (PR #465): the second message is rejected on a cold comment→DM
> (`code=551`), so **0 of 33** images were delivered for one merchant while the text landed
> and the image vanished. It only appears to work in warm self-tests, where the customer
> already has an open 24h window. Do not reintroduce it.

**Instagram: still two messages** — `sendDirectMessage`, then `deliverReplyImageBestEffort`
(a native attachment, `sendMetaImageAttachment`) sent best-effort so it never throws
(a throw would retry the job and re-fire the one-shot private reply). **This carries the
same latent bug as the reversed FB design and is a known deferred fix.**

The reply text keeps the **flat 1000-char cap** whether or not an image is attached.
WhatsApp, when added, sends a single message with a native `caption` (its own adapter; the
storage + picker are reused unchanged).

## 11. Tap-through: the stable image link

The Facebook image card carries two URLs, and they are deliberately different:

| Field | URL | Why |
|-------|-----|-----|
| `image_url` | the bucket URL | Meta fetches it **once at send time** and serves its own cached copy thereafter — it never needs the object again |
| `default_action.url` | `${PUBLIC_API_BASE_URL}/post-reply-image/{source}/{postId}` | opened **live, on every tap, forever** — so it must not be a key we delete |

`GET /post-reply-image/:source/:id` (public, `routes/postReplyImage.ts`) looks the post up
and 302s (`cache-control: no-store`) to its **current** `trigger_image_url`. If the rule was
cleared it returns 410 with a short bilingual notice; an unknown post returns 404.

**The bug this fixes (2026-07-22):** cards used to point `default_action` at the bucket URL.
Because replacing or clearing a Post Reply deletes the old object (§9), every card already
sitting in a customer's thread started rendering Backblaze's raw `NoSuchKey` XML page on tap —
the thumbnail still showed (Meta's cache), so the failure was invisible from the dashboard.
Regression coverage: `test/routes/postReplyImage.test.ts`,
`test/services/reply/postReplyImageLink.test.ts`, and the `default_action` assertions in
`test/services/metaMessaging.test.ts`.

Instagram is unaffected: its image is delivered as a native attachment (Meta hosts it), with
no link back to our bucket.

**Config:** `PUBLIC_API_BASE_URL` — the public origin+prefix that reaches this backend.
Defaults to `${FRONTEND_URL}/api`, which matches the nginx `/api/` → backend mapping. It ends
up baked into DMs permanently, so changing it later strands old links: keep it stable.
