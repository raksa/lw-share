# lw-share — agent notes

Express + Socket.io server in `src/` serving the static pages in `public/`: home `/`,
files `/files/`, chat `/chat/`, QR coder `/qrCoder/`.

## Running the app for live testing

`npm run dev` starts two processes together:

- **server** (`npm run dev:server`): lw-share on <http://localhost:3006>, sharing `./share`.
  It runs under `node --watch`, so edits in `src/` restart it. `public/` is read from disk
  on every request, so reloading the page picks up those edits.
- **electron** (`npm run electron`, [scripts/electron-dev.mjs](scripts/electron-dev.mjs)):
  a window on that URL with the Chrome remote-debugging listener on <http://127.0.0.1:9226>.
  It waits up to 60 s for the server.

Closing the window stops both. If the server is already running, start only `npm run electron`.
The ports are fixed (instead of lw-share's usual random port) so the MCP config can point at
them. If you change one, update `package.json`, `scripts/electron-dev.mjs`, `.mcp.json` and
`.codex/config.toml` together.

## Chrome DevTools MCP (`chrome-devtools`)

[.mcp.json](.mcp.json) (Claude Code) and [.codex/config.toml](.codex/config.toml) (Codex) run
`chrome-devtools-mcp --browserUrl=http://127.0.0.1:9226`. It only **attaches** to that listener
and cannot launch a browser, so while 9226 is down every tool call fails. Use it to verify any
change to `public/` or to a route: do not call a UI change done until you have exercised it in
the window and the console is clean.

1. **Preflight**: `curl -s --max-time 3 http://127.0.0.1:9226/json/version`. JSON back means
   it is already running, so don't start another copy. No reply: run `npm run dev` in the
   background and poll that URL until it answers.
2. **Attach**: `list_pages`, then pick the `http://localhost:3006/...` page by URL. After a
   reconnect, the selected page can be a leftover popup instead. Tools take an explicit `pageId`.
3. **Navigate** the main window with `navigate_page`. `new_page` fails in Electron
   (`Target.createTarget: Not supported`); for a second window, such as a second chat user, use
   `evaluate_script` with `() => window.open('/chat/')`. It shows up in `list_pages`.
4. **Interact**: `take_snapshot` for element uids, `take_screenshot` for evidence, then `click`,
   `fill`, `press_key`, `drag`. On `/files/` (the explorer, where each folder has its own URL,
   such as `/files/Photos/`):
   - **Upload**: use `upload_file` on New → "File upload". It takes one file per call and uploads
     at once into the open folder. A name clash keeps both files (`name (1).ext`).
   - **Dialogs**: New folder, Rename, Move and Delete open in-page `<dialog>`s, not `confirm()`,
     so click their buttons and don't use `handle_dialog`. Deletes are permanent; there is no trash.
   - **Menus**: `click` can't right-click. Use each item's ⋮ button, or dispatch a `contextmenu`
     event with `evaluate_script`.
   - **Moves**: `drag` works from an item onto a folder or a breadcrumb.
   - **Setup and cleanup**: use the JSON API under `/api/files` (`GET list?path=`;
     `POST folder|rename|move|delete`; `PUT upload?path=&name=`). POSTs need
     `Content-Type: application/json`.
5. **Check**: `list_console_messages` and `list_network_requests` after every change. The console
   should be empty. The one harmless entry is
   `[issue] Session History Item Has Been Marked Skippable`, which Chromium logs after scripted
   (gesture-less) navigation.
6. **Opening files** (double-click, Enter or Open in the explorer; `target="_blank"` links
   elsewhere): viewable files open in a new window (a new page in
   `list_pages`; close it with `close_page`). Other files download straight to the OS Downloads
   folder with no dialog, saved as `name (1).ext` rather than overwriting. Their empty window
   closes itself, and the `[electron]` output logs `[download completed] <path>`.
7. **File paths**: `chrome-devtools-mcp` limits local file paths (uploads, saved screenshots) to
   the client's MCP roots, or to the OS temp dir if the client sends none.

Electron's "Insecure Content-Security-Policy" warning is switched off by
[scripts/electron-preload.cjs](scripts/electron-preload.cjs). It describes the Electron shell,
not lw-share, and it would otherwise appear on every page load.

## Robot testing (`lw-robot-test`)

[.claude/skills/lw-robot-test/SKILL.md](.claude/skills/lw-robot-test/SKILL.md) runs a full
click-through of the app in this window and reports pass/fail with evidence. In Claude Code, run
`/lw-robot-test` (smoke), `/lw-robot-test full` or `/lw-robot-test changed`. Other agents can
follow SKILL.md directly. It works only inside a `robot-<runId>/` folder that it creates in the
share and deletes afterwards. Screenshots and upload samples go to `test-results/` (gitignored).
`node .claude/skills/lw-robot-test/robot.mjs api` runs just the HTTP checks, with no browser.
