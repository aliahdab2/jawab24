# Screenshot Capture Checklist — OnePlus 11

## Device prep

1. Install the release AAB: `cd frontend && npm run build:mobile` then sideload the APK/AAB from `frontend/android/app/build/outputs/bundle/release/app-release.aab` (use `bundletool` to convert AAB → APKs, or install a debug APK with release-like data).
2. Log in with a demo account that has realistic content:
   - At least 1 connected Facebook page with a few messages
   - At least 1 connected Instagram account (if you have one set up)
   - Ideally 1 connected e-commerce store (Shopify/Salla/Zid) for the Integrations shot
   - 3–5 conversations in the inbox
   - A couple of Smart Replies already sent so the conversation view looks alive
3. Enable **Pixelator** or similar to hide the status-bar clock/battery, OR accept the clock shown (Play allows it).
4. Turn **Do Not Disturb** on to hide notifications.

## Capture sequence (repeat in both languages)

OnePlus 11: screenshot = **Power + Volume Down**. Screenshots land in `Internal storage/DCIM/Screenshots/`.

### English set (device language: English, app locale: English)

- [ ] `01-dashboard.png` — Dashboard with stats and message counts
- [ ] `02-messages.png` — Messages inbox with conversation list
- [ ] `03-conversation.png` — Open a conversation with an AI reply visible
- [ ] `04-settings.png` — Settings page showing reply style + business hours
- [ ] `05-integrations.png` — Integrations page with connected store
- [ ] `06-post-reply.png` — Post Reply setup on the comments page (your key differentiator vs LetsBot/ManyChat)

### Arabic set (device language: Arabic OR app locale: Arabic)

Same 6 screens, same filenames, in the `ar/` folder. Verify RTL mirroring looks correct on each.

## Transfer to Mac

```bash
# With phone connected via USB (File Transfer mode):
cp ~/Downloads/[screenshot-files] /Users/aliahdab/Documents/AutoReply/.planning/play-store-assets/screenshots/en/
# Rename as you go to the filenames above.
```

## Verification before upload

- Each image: PNG, min 320px on short edge, max 3840px on long edge, portrait (9:16-ish)
- No visible notification shade, no debug overlays, no OS-level system UI artifacts
- Arabic set: all text properly RTL-mirrored, no LTR leakage
- Check: `file *.png` should show `8-bit/color RGBA` or `RGB` — either is fine

## Play Console upload order

Upload in the order you want them shown in the listing. Recommended order prioritizes the most compelling screens first:

1. Conversation (AI reply in action) — hooks the viewer
2. Dashboard — shows the product surface
3. Post Reply setup — differentiator
4. Integrations — shows breadth
5. Messages inbox — shows scale
6. Settings — shows control
