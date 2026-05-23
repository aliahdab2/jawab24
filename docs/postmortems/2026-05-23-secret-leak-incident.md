# Postmortem: 2026-05-23 Production Secret Leak (Self-Inflicted via AI Assistant)

**Date:** 2026-05-23
**Severity:** Critical (full production secret exposure)
**Author:** Claude (AI assistant) at user's request
**Status:** Containment in progress (Tier 1 partial)

## Summary

During an unrelated investigation (Stage 2 KB catalog tool test on prod), the AI assistant ran a poorly-designed `sed` command intended to redact values from production environment files. The redaction logic was wrong: instead of replacing the values with `<REDACTED>` markers, sed substituted a shell-expansion string that *embedded the plaintext value inside it*. The full output — containing every secret in `backend.env` and `ai.env` — was returned through the Bash tool and recorded in the conversation transcript (and thus Anthropic's logs).

No external compromise has been detected. Containment was started immediately upon discovery.

## Secrets exposed in plaintext

Every secret in `/var/www/jawab24/env/backend.env` and `/var/www/jawab24/env/ai.env`:

- `JWT_SECRET` (was the placeholder `jawab24_jwt_secret_change_this_in_production_2024` — pre-existing critical issue)
- `COOKIE_SECRET`
- `FACEBOOK_APP_SECRET`
- `FACEBOOK_WEBHOOK_VERIFY_TOKEN` (was a placeholder `jawab24_webhook_verify_token_2024`)
- `FACEBOOK_TOKEN_ENCRYPTION_KEY`
- `STRIPE_SECRET_KEY` (`sk_live_*`)
- `STRIPE_PUBLISHABLE_KEY` (public by design, leak is non-event)
- `STRIPE_WEBHOOK_SECRET`
- `OPENAI_API_KEY` (`sk-proj-*`)
- `FIREBASE_SERVICE_ACCOUNT_KEY` (full JSON including RSA private key)
- `REDIS_PASSWORD`
- `SHOPIFY_API_SECRET` (prod app)
- `SHOPIFY_TOKEN_ENCRYPTION_KEY`
- `SALLA_CLIENT_SECRET`
- `SALLA_WEBHOOK_SECRET`
- `RESEND_API_KEY`
- Postgres password (in `DATABASE_URL`)

## Pre-existing finding (separate severity issue)

The audit that triggered the leak also surfaced a **critical pre-existing issue**: `JWT_SECRET` and `FACEBOOK_WEBHOOK_VERIFY_TOKEN` in prod were the literal default placeholder values shipped with the repo's `.env.example` files. Anyone with access to the public repo could forge JWTs for any user account. This had been live in prod since initial deployment (date unknown; both placeholders contain `_2024` suffix). This is the kind of issue a proper config-validation check (e.g., refusing to boot if `JWT_SECRET` matches any value in a known-placeholder blocklist) would have caught at deploy time.

## Containment timeline (2026-05-23, all UTC)

| Time  | Action |
|-------|--------|
| 09:33 | Leak occurred (sed-based "redaction" dumped all secrets to chat) |
| 09:34 | User notified; incident response started |
| 09:34 | Server-side rotation: `JWT_SECRET`, `COOKIE_SECRET`, `FACEBOOK_WEBHOOK_VERIFY_TOKEN` |
| 09:36 | Backend restarted with new server-side secrets |
| ~09:38 | Prod went down (502 Bad Gateway) — nginx held cached DNS for old backend container IP |
| 09:51 | Nginx reloaded → prod recovered (~13 min outage) |
| 09:56 | `STRIPE_SECRET_KEY` rotated via Stripe dashboard → applied to `backend.env` |
| 10:01 | `OPENAI_API_KEY` rotated via OpenAI dashboard → applied to `backend.env` + `ai.env` |
| 10:11 | `FIREBASE_SERVICE_ACCOUNT_KEY` rotated via Firebase console → applied to `backend.env` |
| 10:18 | `FACEBOOK_APP_SECRET` rotated via Facebook Developers → applied to `backend.env` |
| 10:30 | Session paused. Rotation incomplete. |

## Outstanding (not yet rotated as of session end)

**Tier 1 remaining:**
- `STRIPE_WEBHOOK_SECRET` — webhook-signature forgery vector
- `RESEND_API_KEY` — email impersonation vector
- Update `FACEBOOK_WEBHOOK_VERIFY_TOKEN` in FB Developer Dashboard to match server-side value (backend rotated; FB still has the old value, so new webhook subscriptions fail until updated)

**Tier 2 (merchant-impersonation risk):**
- `SHOPIFY_API_SECRET` (prod app `93c86e8524610bbf5353d5fc5ce27eca`)
- `SALLA_CLIENT_SECRET`
- `SALLA_WEBHOOK_SECRET`

**Tier 3 (encryption-at-rest, customer-disruptive):**
- `FACEBOOK_TOKEN_ENCRYPTION_KEY` — invalidates all stored FB page tokens; merchants must reconnect
- `SHOPIFY_TOKEN_ENCRYPTION_KEY` — invalidates all stored Shopify store tokens; merchants must reconnect
- Should be done during low-traffic window with merchant-comms email

**Tier 4 (internal-network only, low risk):**
- `REDIS_PASSWORD`
- Postgres password
- `STRIPE_PUBLISHABLE_KEY` (public anyway; hygiene rotation)

## Side-effect outage #1 (nginx DNS cache)

Outage of ~13 min on 2026-05-23 09:38–09:51 UTC. Cause: `docker restart jawab24-backend-blue` gives the container a new IP on the docker bridge network. Nginx in this stack uses `server jawab24-backend-blue:3000` in `upstream.conf`, but nginx caches DNS resolution at config-load time. The cached IP `172.18.0.10` became unreachable when the container restarted at `172.18.0.3`, causing every request to fail with `connect() failed (113: Host is unreachable)`.

Fix: always run `docker exec jawab24-nginx nginx -s reload` after any container restart. This forces nginx to re-resolve upstream hostnames.

Lost data during outage: Facebook webhook events (FB will retry, most should be redelivered). User-facing 502s for ~13 min.

## Side-effect outage #2 (docker restart does not reload env_file)

Outage of ~25 min on 2026-05-23 10:18–10:43 UTC. Cause: I rotated `FACEBOOK_APP_SECRET` in `/var/www/jawab24/env/backend.env` then ran `docker restart jawab24-backend-blue` expecting the new value to load. **`docker restart` restarts the process inside the container but does NOT re-read `env_file` from docker-compose.** Environment variables are fixed at container *create* time, not restart time. Result: the container kept using the OLD (leaked) app secret while Facebook started signing webhooks with the NEW value (after `Reset App Secret` in the FB dashboard). Every incoming webhook failed signature verification → returned 403 → no replies for ~25 minutes.

**This bug affected every secret rotation in the session.** The "rotation verified working" tests I ran (e.g., probing Firebase Admin SDK) were silently running against the OLD leaked secrets baked into the container env, not the new values written to disk. The leaked secrets remained active until 10:43.

Diagnosis: compare hashes of `docker exec <container> printenv KEY` vs `grep ^KEY= env_file`. If they differ, the rotation hasn't actually taken effect.

Fix: use `docker-compose -f docker-compose.yml -f docker-compose.<env>.yml up -d --force-recreate --no-deps <service>` (the deploy script's pattern) instead of `docker restart`. This destroys+recreates the container, reading `env_file` fresh.

Lost data during outage #2:
- ~25 minutes of Facebook webhooks 403'd. After force-recreate at 10:43, FB retries flowed back in (15× normal rate visible in next 10 min).
- Reconciliation via FB Graph API for the two high-traffic affected pages identified 11 customer messages that didn't redeliver in time: 4 system/button-click events (auto-ignore), 7 real customer messages on Nourva (5) + Damascene (2). Decision: wait for FB's 24-36h retry mechanism rather than manually replay (45-min-late replies would confuse customers more than help).

## Pre-existing finding #3 (production model misconfiguration, 5 days silent)

While diagnosing a customer-reported AI hallucination (the bot invented phone number "1234567" for a registration question), I discovered production has been running on `gpt-4o-mini` (93.8% eval) instead of the intended default `gpt-4.1-mini` (95.7% eval) for ~95% of customer-facing chat traffic since 2026-05-18.

Root cause: three users had explicit `settings.ai_model = 'gpt-4o-mini'` overrides:
- `nourvacare@gmail.com` (Nourva) — set 2026-05-16
- `aliahdab@gmail.com` (owns Jawab24 + الفريق الدمشقي) — set 2026-05-20
- `demo@jawab24.com` — set 2026-05-21

These three accounts own the highest-traffic pages. The remaining 31 users on `gpt-4.1-mini` (the correct default) generate only ~3% of total chat call volume. The model resolver (`backend/src/services/aiModelResolver.ts`) correctly applies per-user overrides; the bug is in the data, not the code.

Cross-model eval baseline data (recorded in memory at 2026-05-18):
- `gpt-4.1-mini`: 95.7% pass / $0.75 per eval run / 1.4s avg latency
- `gpt-4o-mini`: 93.8% pass / $0.78 per eval run / 2.3s avg latency / "concentrated COMPLAINT→OFFENSIVE misclassification"

So `gpt-4o-mini` was strictly worse on every dimension, yet was running for 5 days against the busiest pages. Memory entry "default is gpt-4.1-mini" was true about the code but false about effective production behavior.

The phone-hallucination on Damascene is consistent with `gpt-4o-mini`'s known weakness in refusing-when-info-not-in-KB.

Fix applied at 11:04:05 UTC: `UPDATE settings SET ai_model='gpt-4.1-mini' WHERE ai_model='gpt-4o-mini'` (all 3 rows). Verified at 11:06:13 — first post-update completion used `gpt-4.1-mini`. Resolver cache TTL (60s) cleared naturally.

Outstanding follow-ups from this finding:
- Add boot-time check or admin-dashboard alert when any user's `ai_model` differs from `DEFAULT_AI_MODEL` (so future drift is visible)
- Eval-comparable-to-prod sanity: assert that the eval-suite model matches the dominant prod model. Today they were different and that's why the eval kept reporting 95.7% while customers saw 93.8% behavior

**Origin of the overrides (resolved):** PR #164 (`feat(ai): per-customer model override via settings.ai_model`, commit `bd91ab94`) merged 2026-05-17 18:44:43 UTC introduced the `getModelForUser` resolver. The PR's own description states *"set via SQL for now"* — meaning no UI exists for users to flip their own model.

Timing analysis (ai_usage_log per-user min(created_at) on gpt-4o-mini):
- aliahdab@gmail.com → first gpt-4o-mini call 2026-05-17 **19:09:11 UTC** (24 min after PR merge)
- nourvacare@gmail.com → first gpt-4o-mini call 2026-05-17 **19:10:45 UTC** (94 sec later)

This pattern (two accounts flipped within 94 seconds of each other, ~24 min after the override feature shipped) is consistent with **the PR author manually running `UPDATE settings SET ai_model='gpt-4o-mini' WHERE user_id IN (...)`** to verify the new feature end-to-end on a developer account + a beta merchant account. Reasonable test. The bug was the test data was never reverted, and there was no monitoring to flag the drift.

**Lesson**: when shipping a "set via SQL for now" feature, capture the test-flip values in a session note or postmortem-style comment, AND set a follow-up reminder to revert before walking away. Better: provide a tiny admin script (`scripts/set-user-ai-model.sh USER MODEL`) that records its changes to an audit log, so future-you can grep it.

## Root cause of the leak

A sed substitution intended as `s/=(.*)/= [len:N] [suspicious:flag]/` was constructed to dynamically compute `len` and `suspicious` via shell command substitution embedded in the replacement string. The author expected the substitution to evaluate as: `(extract value via \1) → (pass to shell) → (return computed length)`. In reality, `sed` performs purely textual replacement — the `$(echo "\1" | wc -c)` text was written into the output *verbatim with `\1` already substituted to the secret value*. The output therefore contained:

```
JWT_SECRET= [len:$(echo -n "actual_secret_here" | wc -c)] [suspicious:$(echo "actual_secret_here" | grep ...)]
```

…with the secret embedded as a literal substring of the supposed "summary." This was returned through the Bash tool to the AI's context and recorded in the transcript.

The correct approach (used successfully two commands earlier in the same session) is purely textual sed with no shell substitution at all:

```
sed 's/=.*/=<REDACTED>/'
```

## Corrective actions

### Immediate (done in session)
- ✅ Rotated 5 of ~16 leaked secrets (see timeline)
- ✅ Posted incident note (this file)

### Short-term (next 24h)
- Complete remaining Tier 1 + Tier 2 rotations
- Plan customer-comms email for Tier 3 (encryption keys) rotation window
- Boot-time validation: reject startup if `JWT_SECRET`, `COOKIE_SECRET`, or any other critical secret matches a known-placeholder blocklist (e.g., contains `change_this`, `example`, `secret_`, `password`, default value from `.env.example`)
- Add `pre-deploy-check.sh` rule: fail if `env/*.env` contains any known-placeholder pattern

### Medium-term (this week)
- Audit `git log -p` on `.env.example` files and any other place secrets-style values could have leaked historically. Rotate anything similarly default-valued elsewhere.
- Move secrets out of `.env` files into a secrets manager (Docker secrets / Hashicorp Vault / 1Password Connect). The current pattern of long-lived files on disk amplifies blast radius of any future leak.
- Add CI scanner (e.g. gitleaks, trufflehog) on every PR to catch accidental commits of patterns matching production secret formats.

### Process changes for AI-assisted work on prod
- **Never invoke shell-expansion in redaction logic.** When summarizing files that contain secrets, the safe pattern is `sed 's/=.*/=<REDACTED>/'` (purely textual) — no `$(...)` or `${...}` allowed in the replacement string.
- **Show env-file metadata only by `awk` on length/prefix**, never `cat`, `head`, or any pattern that could expand values.
- **When in doubt about output safety, run on a single dummy line first** and verify before scaling to the whole file.
- Update CLAUDE.md / global instructions to explicitly forbid the failed pattern.
- **After any env-file edit, recreate the container, don't restart it.** `docker restart` does not reload `env_file`. Use `docker-compose ... up -d --force-recreate --no-deps <service>`. To verify, compare `docker exec <container> printenv KEY` to `grep ^KEY= env_file` — if they differ, the rotation hasn't taken effect.
- **After any container recreate, reload nginx** (`docker exec jawab24-nginx nginx -s reload`) to clear the upstream DNS cache, otherwise nginx routes to the stale container IP and traffic 502s.

## Detection

Exposed values are now in:
1. Anthropic's conversation log retention
2. Local Claude Code transcript on user's laptop
3. Any backups/syncs of either of the above

Anthropic has documented retention policies; in practice this means the values should be considered permanently exposed for monitoring purposes.

Monitoring to add post-rotation:
- Stripe Radar: alert on unusual charge patterns for next 30 days
- OpenAI usage alerts: spike threshold
- Sentry: alert on unusual auth failure patterns (suggests forged JWT attempts)
- Facebook app dashboard: monitor "API access" log for unfamiliar IPs

## What went well

- User noticed the issue immediately (well, the AI flagged it, but the user agreed and prioritized correctly)
- Highest-fraud-risk keys (Stripe + OpenAI + Firebase + FB app) rotated within 45 minutes of discovery
- Server-side rotation never re-exposed values (helper script `/usr/local/bin/rotate-secret` reads from stdin only)
- Backups created before every env-file write — easy rollback path if any rotation broke things

## What did not go well

- The leak itself
- The 13-minute self-inflicted outage during the response
- Pre-existing placeholder secrets in prod (separate issue, just exposed now)
- No deploy-time guard against placeholder values
- Single .env files as the secret store (high blast radius for any leak)
