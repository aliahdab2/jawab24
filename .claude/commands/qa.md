Run a closed-loop browser QA cycle on a page or flow: drive it in a real Chrome via the chrome-devtools MCP, read console + network, report findings — or fix and re-verify.

Arguments: $ARGUMENTS
- A page path or flow description (e.g. `/qa /pricing`, `/qa dashboard settings save flow`). Required.
- If arguments include "fix", apply root-cause fixes and re-run the loop until clean. Default (no "fix"): report-only — do not change code.
- If arguments include "mobile", also run at a mobile viewport (412×915, matching the Playwright `mobile-chrome` Pixel 7 project) in portrait AND landscape (915×412) using `resize_page`.

## Workflow

### 1. Ensure the dev environment is up

Same health checks as `/dev`:

```bash
curl -s http://localhost:3000/health 2>/dev/null && echo "Backend: UP" || echo "Backend: DOWN"
curl -s http://localhost:3002/health 2>/dev/null && echo "AI Worker: UP" || echo "AI Worker: DOWN"
curl -s http://localhost:3001 2>/dev/null && echo "Frontend: UP" || echo "Frontend: DOWN"
```

Start anything that's down by following the `/dev` command (background via `run_in_background` — never `&`). The frontend at `http://localhost:3001` is the QA target; the backend on `:3000` must be up for API calls to succeed.

### 2. Open the target in BOTH locales

Every page is QA'd twice — `http://localhost:3001/en/<path>` and `http://localhost:3001/ar/<path>` — using `mcp__chrome-devtools__new_page` / `navigate_page`. Never skip the `/ar` pass; RTL and translation regressions only show up there.

### 3. Exercise the flow

- `take_snapshot` (a11y tree) to locate elements — prefer this over screenshots for finding what to interact with.
- Drive with `click` / `fill` / `fill_form` / `press_key` / `hover`.
- `take_screenshot` for visual checks: RTL mirroring in `/ar`, no broken layout, no blank regions.
- If the flow needs a logged-in session, say so and ask the user for test credentials rather than guessing — do not create accounts.

### 4. Observe after each meaningful action

- `list_console_messages` — any error is a finding; a warning that appeared as a result of your action is too. Capture the source-mapped stack trace.
- `list_network_requests` — any 4xx/5xx or failed/aborted request is a finding; drill in with `get_network_request` (request/response bodies, headers). API calls should hit `:3000`.
- `evaluate_script` for targeted state checks (e.g. a store value, computed style, `document.documentElement.dir`).

### 5. Jawab24-specific checks (both locales)

- **Raw i18n keys on screen** — text like `topup.modal.title` or `pricing.<slug>` means a namespace wasn't loaded for this page or a slug key is missing. `translation:validate` does NOT catch this class of bug (it checks en/ar parity, not per-page loading) — this loop is the guard. See AI_INSTRUCTIONS.md §5 for the fix checklist.
- **RTL rendering in `/ar`** — layout mirrored correctly, text aligned to the start edge, icons/chevrons on the correct side. A physical directional class (`ml-*`, `text-left`, …) that slipped in shows up here.
- **States render** — no blank screens; loading, error, and empty states appear where expected.

### 6. Report or fix

**Report (default):** findings grouped by page + locale — console errors, failed requests, raw i18n keys, visual/RTL issues — each with the evidence (stack trace, request details, or screenshot). If the run is clean, say so explicitly per page/locale.

**With "fix":** fix root causes only (AI_INSTRUCTIONS rule 14 — no symptom patches, no swallowed errors). Then run `npm run lint` and the relevant unit tests, and **re-run this QA loop** on the affected pages until it comes back clean.

### 7. Cleanup

Close pages you opened (`close_page`). Leave the dev servers running.

## Webchat widget (dormant — do not activate yet)

The webchat widget (`.planning/WEBCHAT_PLAN.md`) is PARKED at owner request — do not build any widget code from this command. Once it ships, `/qa widget` means: load the embed/demo page, send a test message through the widget, watch the network exchange with the public chat API (including the SSE stream), and read the console for widget-script errors — same loop as above, same both-locales rule.
