---
name: "milkchat-apk-release"
description: "Builds and releases the milk.chat couples web app as a signed Android APK with a download link. Invoke when the user asks to update/ship the app as APK, package changes for Android, or wants a download link after editing features."
---

# Milk.chat APK Release Pipeline

End-to-end flow for turning feature edits in the `/workspace` web app into a signed,
installable Android APK plus a shareable download link. Use it whenever the user asks to
"打成 APK / 更新 APK / 给我下载链接 / 发布新版本" after code changes.

## Project layout

- `/workspace/index.html`, `/workspace/js/**`, `/workspace/css/**` — the web app source.
- `/workspace/js/features/*.js` — one IIFE module per feature (checkin, visit, peek,
  companion, call, control, proficiency, ledger, …). Each exposes a small `window.<Name>`
  API and follows the same `load()/save()` + `buildModal()/open()` pattern.
- `/workspace/android/` — the Android wrapper; `build.sh` produces `/workspace/milk.chat.apk`.
- Web assets are bundled into the APK under `assets/www/`.

## Step 1 — Make & sanity-check the change

1. Edit the relevant `js/features/*.js` / `index.html`. Reuse existing patterns:
   - New feature module: copy the IIFE + `buildModal()`/`open()` shape from a sibling file,
     register a `<script>` tag in `index.html`, and add a menu entry in `js/features/more-menu.js`.
   - Partner display name: read `settings.partnerName` (fallback `他`/`对方`), never hardcode.
   - No AI-flavored wording in user-visible strings (this app must not mention AI).
2. Syntax-check every touched JS file before anything else:

   ```bash
   node --check /workspace/js/features/<file>.js
   ```

## Step 2 — Browser smoke test

Serve the app and drive it with the browser agent. **Use a fresh port each run** so the
browser does not serve a cached copy of an old bundle:

```bash
python3 -m http.server <PORT> --bind 127.0.0.1   # run as web_server, cwd=/workspace
```

- Point the browser agent at `http://127.0.0.1:<PORT>/index.html`.
- Verify the new UI, exercise the happy path, and confirm **zero console errors**.
- Stop the server (`StopCommand`) when done.

## Step 3 — Build the APK

`build.sh` needs a JDK on `JAVA_HOME`; set it explicitly:

```bash
export JAVA_HOME=/root/.local/share/mise/installs/java/25
bash /workspace/android/build.sh
```

Run it as a long-running/background command and poll with `CheckCommandStatus`
(gradle + aapt take a while). Success ends with `DONE: /workspace/milk.chat.apk`.

## Step 4 — Verify signature & packaging

```bash
/opt/asdk/android-14/apksigner verify /workspace/milk.chat.apk
# confirm the new code actually landed in the bundle:
unzip -p /workspace/milk.chat.apk assets/www/js/features/<file>.js | grep -c "<marker>"
```

Both must pass before sharing the file. Same signer cert = clean over-install for the user.

## Step 5 — Upload & return a download link

Upload to LitterBox (72h link). **Must use `--http1.1`** (HTTP/2 fails in this sandbox),
and the expiry field is `time` (values like `1h`/`24h`/`72h`/`1w`):

```bash
curl -s --http1.1 -F "reqtype=fileupload" -F "time=72h" \
  -F "fileToUpload=@/workspace/milk.chat.apk" \
  https://litterbox.catbox.moe/resources/internals/api.php
```

The response body is the direct link, e.g. `https://litter.catbox.moe/xxxx.apk`.
Return that link to the user and note the 72-hour expiry.

## Gotchas learned the hard way

- `catbox.moe` main domain / HTTP2 uploads return empty replies here — always use the
  `litterbox.catbox.moe` endpoint with `--http1.1`.
- Outbound traffic goes through the sandbox proxy (`HTTP_PROXY`/`HTTPS_PROXY` already set);
  plain `curl` picks it up automatically.
- If a browser test sees stale UI, it is almost always caching — bump the port, not the code.
- Keep the APK signer certificate stable; do not regenerate keys or users lose over-install.
