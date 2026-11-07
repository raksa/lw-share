---
name: lw-robot-test
description: Robot-test lw-share end to end. Drives the real UI in the Electron dev window through the chrome-devtools MCP (home page, header connect dialog, files explorer and text editor, two-user chat, QR coder, dark mode and phone layout), runs scripted HTTP API checks, and reports pass/fail with evidence. Use when asked to robot test, smoke test, E2E or regression test, QA, or click through lw-share, or to check a change across the whole app before calling it done.
argument-hint: "[smoke | full | changed | api | global | home | files | editor | chat | qr | responsive] ..."
---

# lw-share robot test

Run the suites named in `$ARGUMENTS` (several may be given). With no arguments, run `smoke`.
The cases live in [test-plan.md](test-plan.md); [robot.mjs](robot.mjs) builds fixtures, cleans
up and runs the HTTP checks. Read [AGENTS.md](../../../AGENTS.md) for how the dev window and the
`chrome-devtools` MCP fit together; this skill builds on it.

| Suite | Covers |
| --- | --- |
| `smoke` | `npm test`, `api`, plus the cases marked **smoke** in the plan: one happy path per page |
| `full` | Every suite below |
| `changed` | Suites for the files changed since `HEAD`, from the table below, plus `smoke` |
| `api` | `npm test` and `robot.mjs api` (no browser) |
| `global` | Header, navigation, connect dialog and fallback route on every page (G-*) |
| `home` | Home page addresses and QR codes (H-*) |
| `files` | Explorer (F-*) |
| `editor` | Text editor (E-*) |
| `chat` | Chat with two users (C-*) |
| `qr` | QR code generator (Q-*) |
| `responsive` | Dark mode and phone layout on every page (R-*) |

For `changed`, list the files with `git status --porcelain` and `git diff --name-only HEAD`:

| Changed file | Suites |
| --- | --- |
| `public/fileApp.html`, `public/js/fileApp.js`, `public/css/fileApp.css`, `src/fileApp.mjs`, `src/fileStore.mjs` | `files`, `editor`, `api` |
| `public/chatApp.html`, `public/js/chatApp.js`, `public/css/chatApp.css`, `src/chatApp.mjs` | `chat` |
| `public/qrCoder.html`, `public/js/qrCoder.js`, `src/qrCoder.mjs` | `qr`, `api` |
| `public/index.html` | `home` |
| `public/js/common.js`, `public/css/style.css`, `public/img/*`, `public/css/bootstrap*`, `src/httpApp.mjs`, `src/helpers.mjs`, `src/index.mjs`, `lw-share.mjs` | `global`, `home`, `responsive` |
| `package.json` or `package-lock.json` dependency changes | `api` plus the suites of the packages that changed (`express`: all; `socket.io`: `chat`) |
| Anything else (docs, `scripts/`, tests, this skill) | `smoke` only |

## Ground rules

1. **Leave user data alone.** The share may hold the user's own files. Every file action
   happens inside the run folder `robot-<runId>/` that setup creates. Never select, rename,
   move or delete outside it. That includes Ctrl+A and multi-select: use them only after
   navigating into the run folder.
2. **Test, don't fix.** Don't edit `src/` or `public/` during a run. Report what you find.
   Fix only if the user asked for fixes too, and then re-run the failed cases plus `smoke`.
3. **Check against intended behavior.** Expectations come from the plan, the README and
   AGENTS.md. When the app disagrees with the plan, read the source to decide whether the
   plan is stale or the app is wrong, and say which in the report. If the plan is stale,
   update `test-plan.md` in the same change.
4. **Side effects outside the share.** Copy tests overwrite the OS clipboard. Downloads land
   in the real Downloads folder: download only files whose names contain the runId, so cleanup
   can remove them. Chat and the explorer write to the Electron profile's `localStorage`:
   save it before the run and restore it afterwards.
5. **Keep evidence.** Save a screenshot for every failure, and for key states in a `full` run,
   to `<screenshots>/<caseId>.png` from setup's output.
6. **Clean console after every case.** Run `list_console_messages` (and `list_network_requests`
   when a case talks to the server). Allowed:
   - `[issue] Session History Item Has Been Marked Skippable`, logged after scripted navigation.
   - `Failed to load resource: … status of 4xx` for a request the case provokes on purpose:
     a refused name, the 412 conflict, the missing folder, a binary file in the editor. Only
     those requests, and only as many times as the case provokes them.
   - `net::ERR_INTERNET_DISCONNECTED` while network emulation is set to Offline.

   Anything else is a finding, even if the case otherwise passed.

## 1. Preflight

1. `curl -s --max-time 3 http://127.0.0.1:9226/json/version`. JSON back means the window is up;
   don't start another copy. No answer: if `curl -s -o /dev/null -w "%{http_code}" http://localhost:3006/`
   answers, run only `npm run electron` in the background, otherwise `npm run dev`. Then poll
   9226 for up to 90 s. Remember whether you started it: if you did, the run owns it.
2. `list_pages`; use the `http://localhost:3006/...` page as the main page (pass its `pageId`
   everywhere). Close other localhost pages left over from earlier runs.
3. Save `localStorage` from the main page:
   `() => JSON.stringify(Object.fromEntries(Object.entries(localStorage)))`.
4. Note the time. The report gives the run's duration.

## 2. Setup

```bash
node .claude/skills/lw-robot-test/robot.mjs setup
```

It prints JSON and writes the same to `<artifacts>/run.json`. Keep `runId`, `folder`,
`folderUrl`, `screenshots`, `uploads.{upload,clash,image}` and `downloadsDir`. The run folder
holds:

```
robot-<runId>/
  Docs/          notes.md, Archive/ (empty)
  Empty/         (empty)
  Photos/        pixel.png
  binary.dat     6 B with NUL bytes: Edit is offered, the server refuses it (415)
  crlf.txt       25 B, CRLF line endings
  download-<runId>.bin   256 B, not viewable: opening it downloads it
  large.txt      4500 B
  readme.txt     26 B, "Hello from lw-robot-test."
```

Files were uploaded in the order readme, crlf, large, binary, download, a little apart, so
"Last modified" order is predictable. Artifacts go to `test-results/lw-robot-test/<runId>/`
(gitignored). If the MCP refuses that path for uploads or screenshots (some clients only allow
their roots or the OS temp dir), re-run setup with `--out <os temp dir>/lw-robot-test`.

## 3. Run

- **`api`**: run `npm test`, then `node .claude/skills/lw-robot-test/robot.mjs api <runId>`.
  Each line is `PASS|FAIL <id> <name>`. It works in its own `api-checks` subfolder and removes
  it at the end, so the run folder stays as setup made it.
- **UI suites**: follow the plan's sections in order. For each case: act, check the result, check
  the console, then record PASS / FAIL / BLOCKED / SKIP. A later case may depend on the state an
  earlier one left behind. The plan says so where that happens.

Driving tips, all verified in this window:

- Use `take_snapshot` for uids. They go stale quickly: the explorer re-renders on every 3 s
  refresh, and a later snapshot can renumber the whole page. Take the snapshot right before you
  interact. If a call fails with "uid … not found" or "no longer exists", take a new snapshot and
  retry once. That's not a finding. `click` with `includeSnapshot: true` saves a round trip.
  Check state with `evaluate_script` rather than reading screenshots, and keep screenshots for
  evidence.
- Visually hidden inputs: the QR size radios are Bootstrap `.btn-check` inputs, and `click` and
  `fill` time out on them. Use the keyboard, as a user would: click the text box, press Tab
  (focus lands on the checked size), then ArrowLeft or ArrowRight.
- Toasts (`.app-toast`) disappear after 3–5 s. Read them right after the action:
  `() => [...document.querySelectorAll('.app-toast')].map(t => t.textContent)`.
- Clipboard: `async () => navigator.clipboard.readText()` works on `localhost`.
- The explorer refreshes every 3 s, so changes made through the API show up without a reload.
  Use `wait_for` with the item name and a 6000 ms timeout.
- **Right-click** (the MCP can't): dispatch it on the item
  ```js
  () => { const el = document.querySelector('#items .item[data-name="readme.txt"]');
    const r = el.getBoundingClientRect();
    el.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, button: 2, clientX: r.left + 40, clientY: r.top + 10 })); }
  ```
  or click the item's "More actions for <name>" (⋮) button.
- **Ctrl/Shift+click** (the MCP's `click` has no modifiers): dispatch a click on the item with
  `{ bubbles: true, ctrlKey: true }` or `{ shiftKey: true }`.
- **Explorer shortcuts** (F2, Del, Enter, Ctrl+A, arrows) only fire when focus is on an item or
  the list. Click an item first, then `press_key`.
- **Second window** (second chat user): on the main page,
  `evaluate_script` `() => { window.open('/chat/'); }`, then `list_pages` for its id. `new_page`
  fails in Electron. Both windows share `localStorage`.
- **Opening files**: a viewable file opens as a new page in `list_pages`, so check its URL and
  close it with `close_page`. Other files download. The `npm run dev` output then logs
  `[electron] [download completed] <path>`; check it, or look in `downloadsDir`.
- **Uploads**: open New, then call `upload_file` on the "File upload" menu item with one path
  from `uploads`.
- **Paste** (screenshot upload), on the explorer page:
  ```js
  async () => { const blob = await (await fetch('/files/<folder>/Photos/pixel.png')).blob();
    const dt = new DataTransfer(); dt.items.add(new File([blob], 'image.png', { type: 'image/png' }));
    document.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true })); }
  ```
- **Emulation**: each `emulate` call replaces the previous settings. Call `emulate` with only
  `pageId` to reset everything.

If a tool can't do a step (for example, picking a folder for "Folder upload"), mark the case
BLOCKED with the reason. Don't fake the step with a script that bypasses the UI being tested.

## 4. Cleanup (always, even after a failure or an abort)

1. Close every page except the main one. Reset emulation and the viewport (`emulate` with only
   `pageId`). Navigate the main page back to `http://localhost:3006/`.
2. Restore `localStorage`: clear it, then set the saved entries back.
3. `node .claude/skills/lw-robot-test/robot.mjs cleanup <runId>` deletes the run folder from the
   share and the run's downloads (only names that contain the runId). It keeps the artifacts as
   evidence. `cleanup --all` also clears leftovers from runs that aborted.
4. If you started the dev window in preflight, leave it running unless the user asked you to
   stop it. Mention it in the report.
5. If anything was created outside the run folder by mistake, say exactly what in the report.

## 5. Report

```markdown
## lw-robot-test: <suites> (run <runId>)
**41 passed, 2 failed, 1 blocked, 3 skipped**, 14 min, lw-share <version from package.json> @ <git short sha><, dirty if uncommitted changes>

| ID | Case | Result | Notes |
| --- | --- | --- | --- |
| F-08 | Rename with F2 | PASS | |
| F-05 | Invalid names are refused | FAIL | "con" was accepted, see below |

### Failures
**F-05: Invalid names are refused** (FAIL)
- Steps: New → New folder, enter `con`, Create
- Expected: inline error `"con" is a reserved name`, dialog stays open
- Actual: folder `con` created
- Evidence: `<screenshots>/F-05.png`, console clean, `POST /api/files/folder` 200
- Likely cause: `src/fileStore.mjs:<line>` (only if you looked)
```

Results: **PASS**; **FAIL** (the app is wrong); **BLOCKED** (the environment or tooling stopped
the case); **SKIP** (not in the requested suites or not applicable). Put FAIL and BLOCKED first,
and finish with cleanup status (what was removed, and whether the dev window is still running).
Don't call the run green while any case is FAIL or the console had unexplained messages.
