# Settings resolution — which store, and which workspace

> Companion to [`SETTINGS.md`](./SETTINGS.md), which documents *what* each setting means.
> This file documents *where a given surface reads it from*, and the defect class that
> comes from getting that wrong.
>
> Written 2026-08-11 after the merchant test reply was found previewing a persona from
> the wrong workspace. Every claim below was verified against the source, not inferred.

---

## 1. There are two stores, and they drift by design

| Store | Table | Role |
|---|---|---|
| **Legacy per-user row** | `settings` (keyed by `user_id`) | What the settings UI writes |
| **Per-workspace JSONB** | `workspaces.settings` | What the reply pipeline reads |

The overlap between them is `PIPELINE_FIELDS` (`services/pipelineFields.ts`) — 29 fields
including `commentsAutoReply`, `commentReplyMode`, `replyStyle`, `brandVoiceNotes`,
`brandVoiceNotesMulti`, `defaultReplyLanguage`, `timezone`, `businessHours*`.

They are **not** kept identical, and that is deliberate: `NEW_SIGNUP_SETTINGS_SEED` writes
auto-reply OFF into the JSONB only, so a new signup's legacy row shows the column defaults
(everything ON) while the pipeline is correctly silent. `admin/health.ts` documents 30
drifted users found on 2026-08-02 from exactly this.

Two mechanisms keep them converging:

- **Write-through** — `settingsService.updateSettings` → `syncPipelineFieldsToWorkspace`
  copies any pipeline field in the payload into the workspace JSONB.
- **Read-heal** — `workspaceSettingsService.getSettings` runs `detectLegacyDrift` and
  merges (and persists) legacy values the JSONB is missing
  (`services/workspaceSettings.ts:156-177`).

The read-heal matters for any migration reasoning: a workspace whose JSONB was never
backfilled still returns the legacy persona, so switching a reader from the legacy row to
the workspace store does **not** blank out un-backfilled merchants.

---

## 2. There are three workspace resolvers, and only one is authoritative

This is the actual root of the defect class. The same question — "which workspace is this
request about?" — is answered three different ways.

| # | Resolver | Location | How it picks | Verdict |
|---|---|---|---|---|
| 1 | `resolveWorkspace` (middleware) | `middleware/workspace.ts:40` | token pin (scoped embedded session) → `X-Workspace-Id` header, membership-checked → `resolveDefaultWorkspaceId` (last-active → most connected pages → owner-first → oldest) | ✅ **Authoritative.** Attaches `request.workspaceId` / `workspaceRole` / `workspaceOwnerId` |
| 2 | `resolvePipelineWorkspaceId` | `services/admin/health.ts:277` | the workspace the user's **pages** belong to → most pages → owned → smallest id; falls back to owned membership, then first | ✅ Correct for support views. Tested (`__tests__/adminHealth.test.ts:602`) |
| 3 | `settingsService.resolveWorkspaceId` | `services/settings.ts:220` | `SELECT workspace_id FROM workspace_members WHERE user_id = ? LIMIT 1` — **no ORDER BY** | ❌ **Arbitrary** |

Resolver 3's own comment says "Each user currently belongs to exactly one workspace" and
"limit(1) is intentional". That invariant no longer holds — see §3. Resolver 2's comment
already records the disagreement in writing:

> NOTE this is deliberately NOT `settingsService.resolveWorkspaceId` — that takes an
> arbitrary un-ordered `limit(1)` membership and never looks at pages.

So the codebase already knows resolver 3 is wrong. The knowledge was applied to the admin
console and nowhere else.

**Resolver 3 is also sticky.** Its result is memoized in a process-lifetime `Map`
(`settings.ts:212`) that is only cleared by a test helper. So the arbitrary pick is stable
within one backend process and can differ between processes — which is exactly the shape
of a bug that reproduces for one merchant, on one container, and not in a test.

---

## 3. A user really can belong to more than one workspace

Three reachable paths, all shipped:

1. **Team invites** — `workspaceService.addMember` (`services/workspace.ts:182`), bounded
   by `MAX_MEMBERS_PER_WORKSPACE`. An invited user keeps their own workspace and gains a
   second membership.
2. **Zid App Market installs** — D-066 auto-provisions a store workspace. D-067's own text
   states the case plainly: "a merchant can hold both a personal and a store workspace".
3. **Page transfer between workspaces** — pages can end up split across workspaces, which
   is why resolver 2 counts pages rather than trusting membership order.

> ⚠️ **Not measured:** how many production users hold more than one membership today. Two
> attempts to run that count over SSH were refused by the tool classifier. The code
> argument does not depend on the number — but the *priority* of fixing it does, so run
> this before scheduling the work:
> ```sql
> SELECT count(*) FROM (
>   SELECT user_id FROM workspace_members GROUP BY user_id HAVING count(*) > 1
> ) m;
> ```

---

## 4. The map — every settings read, and whether it is correct

### Reads the workspace store (correct by construction)

| Call site | Workspace from |
|---|---|
| `reply/messageProcessor.ts:314`, `:472` | `page.workspaceId` (refuses the page without one, `:161`) |
| `reply/commentProcessor.ts:180` | `page.workspaceId` (refuses the page without one, `:172`) |
| `reply/generator.ts:580`, `:669` | `context.workspaceId` |
| `services/escalation.ts:127`, `services/activation.ts:95`, `services/leadExtractor.ts:377` | passed-in `workspaceId` |
| `controllers/workspace.ts:273`, `controllers/messages.ts:503/548/600` | `request.workspaceId` (resolver 1) |
| `services/admin/users.ts:573` | `resolvePipelineWorkspaceId` (resolver 2) |
| `reply/playgroundContext.ts:129` | `page.workspaceId` — **fixed 2026-08-11**; previously the owner row |

### Reads the legacy row

| Call site | Fields read | Verdict |
|---|---|---|
| `controllers/auth.ts:98/328/759`, `plugins/demo/index.ts:83` | **only `dashboardLanguage`** — verified, it is the sole field consumed | ✅ Safe. `dashboardLanguage` is not a pipeline field, so resolver 3's pick cannot affect the answer. The overlay it triggers is pure waste on every login (a membership lookup + a workspace-settings read for a field the overlay never touches) — worth removing, but it is a performance item, not a correctness one |
| `controllers/settings.ts` GET `/settings` | full row, overlaid | ✅ **fixed** — passes `request.workspaceId` |
| `controllers/settings.ts` PUT `/settings` + `settingsService.updateSettings` | full row; **writes** pipeline fields | ✅ **fixed** — passes `request.workspaceId` |
| `services/postSuggestions.ts:229` | `brandVoiceNotes` (legacy scalar) | ❌ **D-3** |
| `scripts/warm-reply-cache.ts:128` | `commentReplyMode` | ⚠️ **D-4** |
| `reply/playgroundContext.ts:94` | `commentReplyMode`, `dualReplyNudgeVariations` | ⚠️ **D-4** |

---

## 5. The defects, in severity order

### D-2 — PUT `/settings` wrote pipeline fields to a workspace whose role was never checked ✅ FIXED

The route already resolves the workspace correctly and gates on it:

```
routes/settings.ts:43   preHandler: resolveWorkspace      → request.workspaceId  (resolver 1)
routes/settings.ts:44   preHandler: requireRole('admin')  → checks request.workspaceRole
```

`requireRole` gates on `request.workspaceRole` (`middleware/workspace.ts:177`) — the role
in the **resolved** workspace. But the handler then called
`settingsService.updateSettings(userId, updates)`, which reached
`syncPipelineFieldsToWorkspace` → `resolveWorkspaceId(userId)` (**resolver 3**) and wrote
there. The resolved workspace was on the request and was discarded.

Consequences when resolver 3's arbitrary pick ≠ the resolved workspace:

- **Authorization gap.** Admin in workspace A, plain member in B: the check passes against
  A, the pipeline write lands in B. Those fields include `commentsAutoReply`,
  `messagesAutoReply`, `businessHours*` and the persona — i.e. whether B's merchant gets
  replies at all.
- **It defeats D-067's token pin.** A restricted embedded session is pinned to the store
  workspace precisely so it cannot touch the owner's other workspaces. `resolveWorkspace`
  honors that pin; `resolveWorkspaceId` has never heard of it, so a settings save from an
  embedded Zid session can land in the merchant's personal workspace.
- **Silent.** The write succeeds, the response returns the legacy row overlaid from the
  same wrong workspace, so the UI shows the save as applied.

**The fix:** `getSettings` and `updateSettings` take an explicit `workspaceId`, and the
controller passes `request.workspaceId` — the workspace `requireRole` authorized. Pinned by
`test/services/settings.test.ts` → "explicit workspace scoping", where the arbitrary
membership and the named workspace are deliberately different so a regression cannot pass
by coincidence.

### D-1 — GET `/settings` could answer for a different workspace than the request asked for ✅ FIXED

Same cause, read side. The client sends `X-Workspace-Id: A`; `resolveWorkspace` verifies
membership and sets `request.workspaceId = A`; the handler called
`settingsService.getSettings(userId)`, whose overlay pulled pipeline fields from resolver
3's pick. A merchant switching workspaces in the UI could be shown the other one's toggles.

The login payload is **not** affected: all four login/demo call sites consume only
`dashboardLanguage`, which is not a pipeline field.

### D-3 — Post suggestions use the *English* persona, on a live feature

`postSuggestions.ts:229` reads `.brandVoiceNotes` — the **legacy scalar column**, not
`brandVoiceNotesMulti`, and not through `resolveBrandVoiceNotes`.

That column is written English-first (`controllers/settings.ts:214`):

```js
updates.brandVoiceNotes = updates.brandVoiceNotesMulti['en'] || updates.brandVoiceNotesMulti['ar'] || '';
```

So a merchant who authored «الاسم: سارة، لهجة ليبية…» in Arabic and let it auto-translate
has an **English** persona in that column — and the Arabic post generator is handed the
English copy. Post suggestions went GA on 2026-08-10, so this is live.

Fix is cheap and local: `buildPageBundle` already receives `workspaceId`
(`postSuggestions.ts:194`), so it can read the workspace store and go through
`resolveBrandVoiceNotes`, like every other consumer.

### D-4 — Tracked drift: `commentReplyMode` and the dual-reply nudge

`playgroundContext.ts:94` and `warm-reply-cache.ts:128` still take `commentReplyMode`
(a pipeline field) from the owner row. Same class as the persona bug that was just fixed,
lower blast radius: it changes which comment mode the test reply previews, and which pages
the warm job decides to skip.

Deliberately **not** folded into the persona fix — changing the previewed comment mode
moves eval baselines, so it needs the Rule 19 eval mirror.

---

## 6. The rule

> **A pipeline field is read from the workspace store, and the workspace comes from the
> request — never re-derived from the user.**

Concretely:

1. **In a route handler**, use `request.workspaceId` (resolver 1). It is already resolved,
   already membership-checked, and already honors the embedded token pin. Re-deriving from
   `userId` throws away all three.
2. **In the reply path or anything page-scoped**, use `page.workspaceId`. Both processors
   refuse a page without one, so there is no fallback case to invent.
3. **In a support/admin read**, use `resolvePipelineWorkspaceId` (resolver 2) — it stays
   correct in the drift states support gets called about.
4. **Never use `settingsService.resolveWorkspaceId` for anything new.** It is an unordered
   `limit(1)` with a process-lifetime memo. It should end up private to the legacy read
   path and then deleted.
5. **Persona always goes through `resolveBrandVoiceNotes(settings, message)`.** It is also
   a reply-cache key segment (`bv:`), so a second copy of the language-pick rule strands
   warmed entries. Never read `brandVoiceNotes` (the scalar) directly — it is the
   English-first legacy mirror.

### Status

1. ✅ **Done.** `settingsService.getSettings` / `updateSettings` take an explicit
   `workspaceId`; the settings controller passes `request.workspaceId`. Resolver 3 is now
   a documented last-resort fallback, kept only for callers that hold no workspace.
2. ⬜ **Open — D-3.** Point `postSuggestions` at the workspace store, through
   `resolveBrandVoiceNotes`. Small, local, and user-visible today.
3. ⬜ **Open — D-4.** Fold `commentReplyMode` / the dual-reply nudge onto the workspace
   store in `playgroundContext` and `warm-reply-cache`. Needs the Rule 19 eval mirror,
   because it changes which comment mode the test reply previews.
4. ⬜ **Open — cleanup.** Six user-scoped helpers on `SettingsService`
   (`isCommentsAutoReplyEnabled`, `isMessagesAutoReplyEnabled`, `getAwayMessage`,
   `getGreetingMessage`, `getLimitFallbackMessage`, `getReplyDelay`) have **no production
   callers** — only tests. `workspaceSettings.ts` carries the workspace-scoped equivalents
   that production actually uses. They are latent traps: each one routes through resolver
   3, so the next caller inherits the bug. Delete them with their tests.
5. ⬜ **Optional.** Drop the pointless overlay on the login path (see the table above) —
   a membership lookup plus a workspace-settings read per login, for a field the overlay
   cannot change.
