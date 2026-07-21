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

**Cost:** first 10 GB storage free, then $6/TB/mo; 3× storage free egress (free via
Cloudflare). At one 2 MB image per post, realistic volume is effectively $0.

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

## 8. Data lifecycle / GDPR

- **Key scheme:** `trigger-images/{workspaceId}/{uuid}.{ext}`.
- **Reference-based lifecycle (industry standard):** an image lives exactly as long as
  its Post Reply. On replace / remove / trigger-clear the old object is deleted
  (`postsService.updateTrigger`, safe-order: upload new → commit DB → delete old, so a
  live image is never lost). Page delete drops all its images
  (`pagesService.deletePage`). **Age-based expiry targets ONLY orphaned/non-current
  objects — never a live, referenced image.**
- **Never hand a storage key to something that outlives it.** Deleting a replaced object is
  correct (it keeps the workspace quota honest), but a delivered message is permanent — so a
  sent message must never embed the bucket URL. See §10.
- **Audit:** `npx ts-node src/scripts/audit-trigger-images.ts` (READ-ONLY) lists DB
  rows whose object is missing (investigate) and bucket objects with no DB row
  (safe-to-clean orphans). Run before any bulk cleanup.

## 9. Delivery (two messages: text, then a native image)

Meta's Messenger/IG API has no single message type that carries body text **and** a full
image, so a Post Reply with an image is delivered as **two messages**:

1. **The reply text** — sent first. On Facebook this is the one-shot private reply to the
   comment (`sendPrivateReplyToComment`), which returns the customer's PSID; on Instagram
   it is a direct message to the commenter's PSID. This is the reliable, primary delivery.
2. **The image** — a native image attachment (`sendMetaImageAttachment`) to that PSID,
   sent **best-effort**: the text already landed, so an image failure is logged
   (`captureError`, fingerprint `post-reply-image-attachment-failed`) and never throws —
   throwing would retry the job and re-fire the one-shot private reply, which Meta rejects.

Because the image is its own message, the reply text keeps the **flat 1000-char cap**
whether or not an image is attached (no shorter "with image" limit). The
`flagMeta.reply_image` dashboard badge is set only when the image send actually succeeded
(`imageDelivered`), so it never claims an image the customer didn't receive.

A generic-template *card* was tried first (image + title/subtitle in one bubble) but it
cropped the image to ~1.91:1 and split/capped the caption at 160 chars — see git history.
WhatsApp, when added, will send a single message with a native `caption` (handled in its
own adapter; the storage + picker are reused unchanged).

## 10. Tap-through: the stable image link

The Facebook image card carries two URLs, and they are deliberately different:

| Field | URL | Why |
|-------|-----|-----|
| `image_url` | the bucket URL | Meta fetches it **once at send time** and serves its own cached copy thereafter — it never needs the object again |
| `default_action.url` | `${PUBLIC_API_BASE_URL}/post-reply-image/{source}/{postId}` | opened **live, on every tap, forever** — so it must not be a key we delete |

`GET /post-reply-image/:source/:id` (public, `routes/postReplyImage.ts`) looks the post up
and 302s (`cache-control: no-store`) to its **current** `trigger_image_url`. If the rule was
cleared it returns 410 with a short bilingual notice; an unknown post returns 404.

**The bug this fixes (2026-07-22):** cards used to point `default_action` at the bucket URL.
Because replacing or clearing a Post Reply deletes the old object (§8), every card already
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
