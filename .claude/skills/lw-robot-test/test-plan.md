# lw-robot-test plan

`<folder>` is the run folder (`robot-<runId>`), `<base>` is `http://localhost:3006`, and
`<uploads.*>` and `<screenshots>` come from setup's output. **smoke** marks the cases in the
`smoke` suite. Unless a case says otherwise, "item" means a row in the explorer list
(`#items .item[data-name="…"]`). After every case, check the console as described in SKILL.md
rule 6.

## API (`api`)

- **A-\*** **smoke**: `npm test` passes, then `robot.mjs api <runId>` prints only PASS lines.
  Record each FAIL line as its own failure, with the message the script printed.

## Global (`global`)

- **G-01** **smoke** Every page loads. Navigate to `/`, `/files/`, `/chat/` and `/qrCoder/`.
  Expect titles `Local Web Share`, `Files · Local Web Share`, `Chat · Local Web Share` and
  `QR code · Local Web Share`. The header's nav link for the current page has
  `aria-current="page"` (the brand link on `/`). The console is clean on each page.
- **G-02** Header navigation. From `/qrCoder/`, click Files, Chat and QR code in the header, then
  the "Local Web Share" brand. Each lands on its page, and the brand goes to `/`.
- **G-03** **smoke** Connect dialog. On `/files/<folder>/`, click "Open on another device".
  Expect a modal titled "Open this page on another device" with a QR image
  (`img.address-qr`, `src` starting with `data:image/png`). The main address link ends with
  `/files/<folder>/` and uses port 3006. It closes with the ✕ button, with Escape, and when you
  click the backdrop: dispatch a click on the `dialog` element itself at a point outside its
  box, such as `clientX: 5, clientY: 5`.
- **G-04** Unknown route. Navigate to `/robot-nope-<runId>`. The home page shows (heading
  "Share between devices on your network"), and the console is clean.

## Home (`home`)

- **H-01** **smoke** On `/`, "Connect your phone" shows a QR image, an address link
  `http://<ip>:3006/` and a "Copy link" button. "Loading addresses…" does not stay on screen.
- **H-02** Click "Copy link". Expect the toast "Link copied", and the clipboard equals the shown
  address.
- **H-03** If "Not working? Try another address (n)" is present, open it. It lists n addresses,
  each with a note where relevant ("This computer only", "virtual machine network",
  "link-local…"). Click "Show QR code for <address>" on one. That address becomes the main one
  and the list stays open. If there's only one address, SKIP.
- **H-04** The three tool cards link to `/files/`, `/chat/` and `/qrCoder/`. Click one and check
  where it lands.

## Files (`files`)

Run these in order. Start every case on `<folderUrl>` unless it says otherwise.

- **F-01** **smoke** Deep link. Navigate to `<folderUrl>`. The title is
  `<folder> · Files · Local Web Share`. The breadcrumbs read `Files › <folder>`, with the last
  crumb a button "<folder>: folder actions". The folder summary is "3 folders · 5 files". With
  the default sort (Name ↑), folders Docs, Empty, Photos come before files binary.dat,
  crlf.txt, download-<runId>.bin, large.txt, readme.txt.
- **F-02** Folder navigation. Double-click Docs: the URL becomes `/files/<folder>/Docs/` and the
  list shows Archive and notes.md. Click the `<folder>` breadcrumb to go back. Then
  `navigate_page` back, which lands in Docs again, and forward, which lands in `<folder>`. Then
  select Docs, press Enter (it opens), then Alt+ArrowUp (back to the parent).
- **F-03** Missing folder. Navigate to `/files/<folder>/nope/`. Expect "This folder does not
  exist" and "It may have been moved, renamed or deleted." One 404 for `/api/files/list` is
  expected. Wait 7 s: the missing folder is not polled, so no new 404s appear.
- **F-04** **smoke** New folder. New → New folder. The dialog "New folder" is prefilled with
  "Untitled folder". Fill `Robot folder` and click Create. Expect the toast
  `Created “Robot folder”`, and the new folder selected in the list. Then New → New folder again
  with `Robot folder`. Expect an inline error that it already exists, with the dialog still
  open. Cancel.
- **F-05** Invalid names. In New folder, try `a/b`, `.hidden`, `con` and `trail.`, one by one.
  Each shows an inline error (`Name cannot contain any of…`, `Name cannot start with a dot`,
  `"con" is a reserved name`, `Name cannot end with a dot`), and the dialog stays open. An empty
  name shows "Enter a name." without a request. Cancel. Nothing new is in the list.
- **F-06** **smoke** Upload. New → File upload with `<uploads.upload>`. Expect
  `upload-<runId>.txt` in the list, and the Uploads panel reads "1 upload complete". Then
  `fetch('/files/<folder>/upload-<runId>.txt')` returns the sample's text. Close the Uploads
  panel.
- **F-07** Name clash. Upload `<uploads.clash>` (named readme.txt). Expect `readme (1).txt` to
  appear, and `readme.txt` still has its original content ("Hello from lw-robot-test.").
- **F-08** **smoke** Rename with F2. Click `readme (1).txt`, then press F2. The "Rename" dialog
  is prefilled with the name, and only `readme (1)` is selected
  (`selectionStart` 0, `selectionEnd` 10). Type `renamed`, which replaces the stem, and press
  Enter. Expect the toast `Renamed to “renamed.txt”`, and `readme (1).txt` is gone.
- **F-09** Rename from the menu. Click the ⋮ button "More actions for renamed.txt", then Rename,
  and rename the file to `crlf.txt`. Expect the inline error `"crlf.txt" already exists here`.
  Cancel.
- **F-10** **smoke** Move with the dialog. Select `renamed.txt`, then click Move to… in the
  selection bar. The dialog reads `Move “renamed.txt”`, shows "Current location", and "Move here"
  is disabled. Click Docs, then Move here. Expect the toast `Moved “renamed.txt” to Docs`, and the
  file is now in Docs (check through the API or by opening Docs).
- **F-11** Moving a folder into itself. Select Docs, then Move to…. In the picker, the Docs entry
  is disabled ("Cannot move a folder into itself"). Cancel.
- **F-12** Move by dragging. `drag` `upload-<runId>.txt` onto the Photos item. Expect the toast
  `Moved “upload-<runId>.txt” to Photos`. Open Photos and `drag` the file onto the `<folder>`
  breadcrumb. It's back in `<folder>`.
- **F-13** **smoke** Delete. Select `Robot folder` and press Delete. The dialog
  `Delete “Robot folder”?` starts with focus on Cancel. Click Cancel: the folder is still
  there. Delete again and click Delete: expect the toast `Deleted “Robot folder”`, and the
  folder is gone.
- **F-14** Multi-select. Click crlf.txt, then Ctrl+click large.txt (dispatched). The bar reads
  "2 selected", and Rename, Copy link and Edit are hidden. Shift+click readme.txt selects the
  range from crlf.txt to readme.txt. Ctrl+A selects every visible item, and Escape clears the
  selection. A click on empty list space also clears it.
- **F-15** Multi-file download. Select `download-<runId>.bin` and `upload-<runId>.txt` (both
  names contain the runId), then click Download in the selection bar. Two downloads complete.
  Check the `[download completed]` lines or `downloadsDir`.
- **F-16** Views. Click Grid view: `pixel.png` in Photos shows a thumbnail `img`. Reload: grid is
  still selected (`localStorage['lwShare.files.view']` is `"grid"`). Switch back to List view.
- **F-17** Sort. Open the sort button menu and pick File size. The files order becomes large.txt,
  download-<runId>.bin, upload-<runId>.txt, readme.txt, crlf.txt, binary.dat (largest first),
  and the button title reads "Sorted by file size, descending". Pick File size again to flip
  to ascending. Click the "Last modified" column header: newest first. Restore Name ↑, then
  reload: the sort persists.
- **F-18** Filter. Type `read` in "Filter this folder". Only readme.txt shows, and the summary
  reads "1 of 9 items match" (adjust the count to what is in the folder). ArrowDown selects
  and focuses the first match. Click back into the filter box and press Escape: the filter
  clears.
- **F-19** Live refresh. Through the API, upload `<folder>/live-<runId>.txt`. It appears within
  6 s without a reload. Delete it through the API: it disappears within 6 s.
- **F-20** Opening files. Double-click readme.txt: a new page
  `/files/<folder>/readme.txt` shows in `list_pages`. Close it. Double-click
  `download-<runId>.bin`: no new page stays open, and a `[download completed] …download-<runId>.bin`
  line appears.
- **F-21** Copy link. Select readme.txt, then click Copy link in the selection bar. Expect the
  toast "Link copied", and the clipboard is `<base>/files/<folder>/readme.txt`. For a folder
  (Docs), the link ends with `/Docs/`.
- **F-22** Paste upload. Run the paste snippet from SKILL.md. Expect
  `pasted_YYYY-MM-DD_HH-MM-SS.png` in the folder.
- **F-23** Keyboard selection. Click crlf.txt, then ArrowDown, ArrowUp, Home and End: the
  selection moves with the focus. Shift+F10 opens the item menu, and Escape closes it.
- **F-24** Empty folder. Open Empty. Expect "Drop files here" and the summary "Empty folder".
- **F-25** Offline. Call `emulate` with `networkConditions: "Offline"`. Within 6 s, expect the
  toast "Cannot reach lw-share. Is the server still running?" and the last listing stays on
  screen. Reset emulation. Within 6 s, expect "Connection restored".
- **F-26** Folder upload: BLOCKED if `upload_file` cannot pick a directory for "Folder upload".
  `robot.mjs api` covers the server side (A-14).

## Editor (`editor`)

- **E-01** **smoke** New file. New → New file. The dialog is prefilled with `Untitled.txt` and
  shows the hint about extensions. Fill `robot-note.md` and click Create. The editor dialog opens
  with an empty textarea "Contents of robot-note.md". Type `# Robot\nhello` and click Save.
  Expect the toast `Saved “robot-note.md”` and the dialog closes. `GET /api/files/text` for the
  file returns that content.
- **E-02** Ctrl+S keeps editing and CRLF stays. Open the ⋮ menu for crlf.txt, then Edit. Add a
  third line and press Control+S. The status reads "Saved" and the dialog stays open. Close it
  with Cancel: no prompt, since nothing is unsaved. The API content still uses `\r\n` on every
  line.
- **E-03** Unsaved changes. Edit readme.txt and type something. The status reads
  "Unsaved changes". Press Escape: "Discard changes?" opens with focus on Cancel. Cancel returns
  to the editor with the text intact. Escape → Discard closes it, and the API content is
  unchanged.
- **E-04** Save conflict. Edit readme.txt and change the text, then save a different content
  through the API (`PUT /api/files/text?path=<folder>/readme.txt`, no mtime). Click Save.
  "Overwrite their changes?" appears. Cancel: the editor stays open and the API still has the
  API's version. Click Save → Overwrite: the toast `Saved “readme.txt”` appears and the API has
  the editor's text. Two 412s are expected, one per Save attempt.
- **E-05** Not text. pixel.png's menu has no Edit, and neither does `download-<runId>.bin`
  (`.bin` is excluded by extension). binary.dat's menu has Edit. Using it shows
  `Could not open “binary.dat”: This is not a text file, so it cannot be edited here`, with only a
  Close button. One 415 is expected.
- **E-06** Backdrop doesn't close the editor. Open any editor, change the text, and dispatch a
  click on the dialog at `clientX: 5, clientY: 5`. The editor stays open. Close it with Escape
  → Discard.

## Chat (`chat`)

Uses two windows: A is the main page, and B is opened with `window.open('/chat/')`. Chat names
are at most 14 characters.

- **C-01** **smoke** Join. On `/chat/`, the "Join the chat" panel is shown, and the message box
  and Send are disabled. Fill `Robot A` and press Enter. Expect "You are Robot A", a welcome
  line ("Welcome, Robot A!…"), "N online", and the message box enabled.
- **C-02** **smoke** Second user. Open B and join as `Robot B`. A logs "Robot B joined", and
  both show the same "N online" (N+1 compared with before B joined).
- **C-03** Typing indicator. In B, `type_text` some text without sending. Right away, A's
  `#typingIndicator` reads "Robot B is typing…". About 0.5 s after typing stops, it clears.
- **C-04** **smoke** Messages both ways. B sends `hello from B https://example.com/robot.`
  with Enter. In A, the message shows author "Robot B" and an avatar "R", and its link is
  `https://example.com/robot`, without the trailing dot, with `target="_blank"` and
  `rel="noopener noreferrer"`. A replies `hi B`. In A it's `.msg-own`, with no author name, and
  B receives it with author "Robot A".
- **C-05** Multi-line and empty. In A, type `line 1`, press Shift+Enter, type `line 2`, then
  Enter. B receives one message with a line break. Sending only spaces sends nothing: the
  message count in B is unchanged.
- **C-06** Grouping. A sends two messages in a row. In B, the second has class `msg-continued`
  and no header.
- **C-07** Copy message. In B, click the "Copy message" button of the last message. Expect the
  toast "Message copied", and the clipboard holds the text.
- **C-08** Change name. In A, click Change. The panel reads "Change your name", with Cancel
  shown. Cancel keeps the name. Change again → `Robot C` → Save name. A logs
  "You are now Robot C.", and B logs "Robot A left" then "Robot C joined". The online count is
  the same as before.
- **C-09** Remembered name. Reload A. The join panel is prefilled with the last saved name.
  Since the windows share storage, that is whoever saved last. Join again.
- **C-10** Leaving. Close B with `close_page`. A logs "Robot B left" and the count drops by one.

## QR code (`qr`)

- **Q-01** **smoke** Empty state. On `/qrCoder/`, the placeholder reads "Your QR code will appear
  here.", `#qrResult` has `data-state="empty"`, and the character count is empty.
- **Q-02** **smoke** Generate. Fill `https://example.com/robot-<runId>`. Within 1 s,
  `data-state` is `ready`, `#qrImage` `src` starts with `data:image/png`, and the character
  count reads `<length> / 2000`. The download link's `download` attribute is
  `qr-example-com-robot-<runId>.png`.
- **Q-03** Sizes. The radios can't be clicked (see SKILL.md), so click the text box, press Tab,
  then ArrowLeft for Small and ArrowRight twice for Large. Each change sends a `POST /qrCoder/`,
  with `size` 250, then 500, then 1000 (check the request bodies with `get_network_request`).
  The image's `naturalWidth` grows from Small to Large: about 333, 666 and 1295 px for the Q-02
  text. ArrowLeft once to leave it on Medium.
- **Q-04** Copy text. Click "Copy text": expect the toast "Text copied", and the clipboard holds
  the text.
- **Q-05** Download. Click "Download PNG". The download completes as
  `qr-example-com-robot-<runId>.png`.
- **Q-06** Clear. Empty the text. The page goes back to the placeholder and the count clears.
- **Q-07** Long text. Fill 2000 characters. The box keeps 2000 (it has `maxlength`). The page
  ends up `ready`, or with the inline error "Could not make a QR code from this text. It may be
  too long." It never shows a QR code for older text.

## Responsive and theme (`responsive`)

- **R-01** Dark mode. The OS may already be dark, so test both directions explicitly. On each
  page, `emulate` with `colorScheme: "light"`, then `"dark"`.
  `document.documentElement.dataset.bsTheme` follows each change without a reload. In dark mode,
  take a screenshot of each page as evidence and look for unreadable text or white boxes. After
  you reset emulation, the theme matches `matchMedia('(prefers-color-scheme: dark)')` again.
- **R-02** Phone layout. `emulate` with `viewport: "390x844x3,mobile,touch"`, then reload each
  page. The header button shows "Connect", the short label. Nothing scrolls sideways:
  `document.documentElement.scrollWidth <= innerWidth`. Take a screenshot of each page. In the
  explorer (touch), tapping a folder opens it.
- **R-03** Reset emulation with `emulate` and only `pageId`. The header shows "Open on another
  device" again.
