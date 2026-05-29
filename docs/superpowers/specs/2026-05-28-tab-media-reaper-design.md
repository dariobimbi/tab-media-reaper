# Tab Media Reaper — Design

**Date:** 2026-05-28
**Status:** Drafted, pending user review
**Supersedes:** `2026-05-28-tab-image-reaper-design.md` (kept in repo as historical record)
**Project root (post-rename):** `c:\wamp64\www\tab-media-reaper`
**GitHub (post-rename):** `https://github.com/dariobimbi/tab-media-reaper`

A personal-use Chrome (Manifest V3) extension that, on toolbar click,
scans every non-pinned tab in the current window for a media element
(image or video) matching a user-supplied CSS selector, saves each
match to a fixed subfolder under Downloads, and (optionally) closes
the tabs whose media saved successfully.

This is the second phase of the project. The first phase
(`tab-image-reaper`) shipped a one-toolbar-click image saver. This phase
adds video support, makes the close-tab behavior optional, and renames
the project to reflect the broader scope.

## 1. Scope and constraints

### 1.1 What it does

- One toolbar click opens a popup that shows:
  - the current CSS selector (text input);
  - the current subfolder (text input);
  - two type-toggle checkboxes (**Images**, **Videos**);
  - a "close tabs after saving" checkbox (persisted, default on);
  - a preview match count ("N of M tabs match");
  - a Run button.
- On Run, the background service worker iterates the matched tabs,
  downloads each matching media file to `Downloads/<subfolder>/`, and
  (if close-tabs is on) closes the source tab on successful download.
- Non-matching tabs are untouched. Failed-download tabs stay open with
  a visible error in the popup. Tabs whose matched element is of a
  disabled type are not counted as matching.

### 1.2 Hard constraints (non-negotiable)

Carried forward verbatim from the first-phase spec:

- **No build step.** Native ES modules, MV3, loaded unpacked from WAMP.
  No Webpack/Vite/bundler.
- **Local-only.** No server, no account, no network egress beyond the
  user-initiated downloads. `chrome.storage.local` is the single source
  of truth for config.
- **Fail loudly, never silently.** Every tab that wasn't closed must
  show *why* in the popup (no-media-url, save-failed, inaccessible).
  No tab gets closed without a confirmed save.
- **No anti-bot or evasion behavior.** If a page restricts execution
  (chrome://, blob:, restricted), surface `inaccessible` and move on.
  Specifically: no `chrome.webRequest` sniffing for HLS/DASH segment
  stitching; no DRM circumvention.
- **Pinned tabs are sacred.** They are filtered at query time and
  never considered for either save or close.

### 1.3 Non-goals (explicitly out of scope)

- No retry on failed downloads.
- No history / log of past runs.
- No multi-window support — current window only.
- No URL-pattern filter for tabs.
- No custom filename templates beyond the source URL's leaf name.
- No saving of CSS `background-image`, inline SVG, `<iframe>`-embedded
  video (YouTube, Vimeo, etc.), or HLS/DASH manifest stitching.
- No content-script blob-to-data-URL bridge for MediaSource-backed
  videos. Blob URLs are attempted via `chrome.downloads.download` and
  expected to fail loudly with `save-failed` when Chrome rejects them.
- No deduplication across tabs (two tabs of the same image = two
  saves; Chrome auto-suffixes collisions).
- No automatic split of saved files into `images/` / `videos/`
  subfolders. One flat folder.
- No headless or parallel-download tuning.
- No visual element picker. The selector is a text field.

## 2. Architecture

```
┌──────────────────────┐
│ src/popup/popup.{html,css,js} │  ← view: selector, type toggles,
│                               │     close-tabs toggle, preview,
│                               │     Run, results
└──────────┬───────────┘
           │ chrome.runtime.sendMessage
           ▼
┌──────────────────────┐
│   src/background.js  │  ← engine wiring: scan, run, downloads
│                      │     listener, tab close
└──────────┬───────────┘
           │ chrome.scripting.executeScript / chrome.downloads /
           │ chrome.tabs / chrome.storage
           ▼
        Active window's tabs
```

Three pure helpers live in `src/lib/` and are the primary TDD targets:

- `src/lib/resolve-image.js` — `resolveImageUrl(el)` for `<img>` /
  `<picture>` / `<source>`-inside-`<picture>`, preferring `currentSrc`
  over `src`. **Unchanged from phase 1.**
- `src/lib/resolve-video.js` — `resolveVideoUrl(el)` for `<video>` /
  `<source>`-inside-`<video>`, preferring `currentSrc` over `src`.
  **New in phase 2.**
- `src/lib/filename.js` — `filenameFromUrl(url)` returns the leaf
  filename with extension fallback. **Unchanged from phase 1**; its
  regex already handles `.mp4`/`.webm`/`.mov` extensions.

The popup never touches `chrome.tabs`, `chrome.downloads`, or
`chrome.scripting` directly. The background service worker owns those
via a factory-built engine (`src/lib/engine.js`), preserving the
phase-1 isolation that lets a popup-close mid-run leave the batch
intact.

## 3. File layout

```
tab-media-reaper/
├── manifest.json
├── README.md
├── icons/
│   ├── 16.png
│   ├── 48.png
│   ├── 128.png
│   └── reaper.png                  ← 1024px master; resampled to the above
├── src/
│   ├── background.js
│   ├── popup/
│   │   ├── popup.html
│   │   ├── popup.css
│   │   └── popup.js
│   └── lib/
│       ├── engine.js
│       ├── resolve-image.js
│       ├── resolve-video.js        ← new
│       └── filename.js
├── test/
│   ├── test.html
│   ├── harness.js
│   ├── fixtures.js
│   ├── resolve-image.test.js
│   ├── resolve-video.test.js       ← new
│   ├── filename.test.js
│   └── engine.test.js
└── docs/
    └── superpowers/
        ├── specs/
        │   ├── 2026-05-28-tab-image-reaper-design.md   ← phase-1, historical
        │   └── 2026-05-28-tab-media-reaper-design.md   ← this file
        └── plans/
            ├── 2026-05-28-tab-image-reaper-plan.md     ← phase-1, historical
            └── 2026-05-28-tab-media-reaper-plan.md     ← derived from this spec
```

The harness mirrors the phase-1 pattern: `test/test.html` is opened
via WAMP (`http://localhost/tab-media-reaper/test/test.html` after the
folder rename) and runs all `*.test.js` modules through `harness.js`.
No Node, no jsdom.

## 4. Data model

### 4.1 Persistent (`chrome.storage.local`)

```js
{
  selector: "",                       // CSS selector string; default ""
  subfolder: "tab-media-reaper",      // path under Downloads; default project name
  includeImages: true,                // default true
  includeVideos: false,               // default false
  closeTabs: true,                    // default true
}
```

All five are user-editable from the popup. The two text inputs save on
blur or before Run. The three booleans save the moment they toggle.

**State migration policy (hands-off):** an existing phase-1 user has
`selector: "..."` and `subfolder: "tab-image-reaper"` (or whatever they
last typed) already in `chrome.storage.local`. Phase 2 does NOT
overwrite those values. The new fields (`includeImages`,
`includeVideos`, `closeTabs`) are read with `chrome.storage.local.get`
using built-in defaults, so they appear with their phase-2 defaults on
first popup-open after the upgrade. Users who want downloads to land
at `Downloads/tab-media-reaper/` instead of the old folder update the
subfolder input themselves.

### 4.2 In-memory batch state (background SW, life-of-run only)

```js
{
  status: "idle" | "scanning" | "running" | "done",
  total: number,                       // matched tabs at run start
  processed: number,                   // tabs whose result has been recorded
  results: [
    {
      tabId: number,
      url: string,                     // tab URL at run start
      title: string,
      type: "image" | "video",         // which resolver fired
      status: "saved" | "save-failed" | "no-media-url" | "inaccessible",
      mediaUrl?: string,               // present when a URL was extracted
      filename?: string,               // present when a download was issued
      error?: string,                  // human-readable reason on non-`saved`
    }
  ],
}
```

State lives in the engine's closure (returned from `createEngine`).
The SW may terminate after a run completes; the popup pulls state on
open via `getStatus` and the `results` array is the source of truth
until then. SW termination *mid-run* is handled via
`chrome.storage.session` records keyed by `downloadId` — see §5.4.

## 5. Flows

### 5.1 Popup open

1. `popup.js` reads `selector` / `subfolder` / `includeImages` /
   `includeVideos` / `closeTabs` from `chrome.storage.local` and
   populates the inputs and checkboxes.
2. Popup sends `{ type: "scan" }` to background.
3. Background reads selector + the two type booleans from storage,
   computes `types = [...(includeImages ? ["image"] : []),
   ...(includeVideos ? ["video"] : [])]`, then queries
   `chrome.tabs.query({ currentWindow: true, pinned: false })`.
4. For each tab, background runs `chrome.scripting.executeScript`
   with a `testSelector` function that takes `(selector, types)` and
   returns the type the matched element belongs to (or `null` if no
   match or wrong type). The probe function:
   ```js
   (sel, types) => {
     const el = document.querySelector(sel);
     if (!el) return { matched: false };
     const tag = el.tagName.toUpperCase();
     let type = null;
     if ((tag === "IMG" || tag === "PICTURE") && types.includes("image")) type = "image";
     else if (tag === "SOURCE") {
       const parent = el.closest("picture, video");
       if (parent?.tagName === "PICTURE" && types.includes("image")) type = "image";
       else if (parent?.tagName === "VIDEO" && types.includes("video")) type = "video";
     } else if (tag === "VIDEO" && types.includes("video")) type = "video";
     return { matched: type !== null, type };
   }
   ```
5. `executeScript` rejection (e.g. `chrome://`, restricted, PDF
   viewer) is caught per-tab and reported as `matched: false`.
6. Background replies with
   `{ tabs: [{ tabId, matched, type, url, title }] }`. `type` is
   `"image"` or `"video"` when `matched` is `true`; absent or `null`
   when `matched` is `false`.
7. Popup renders "N of M tabs match" (N = matched count after type
   filter, M = total queried) and enables the Run button when N > 0
   AND at least one of Images/Videos is checked AND the selector is
   non-empty.

A selector edit, a subfolder edit, or a toggle of either type
checkbox triggers a fresh `scan`. A toggle of close-tabs does NOT
re-scan (it doesn't affect what's matched).

### 5.2 Run

1. Popup sends `{ type: "run", tabIds: matchedTabIds }`. (The
   selector, type filter, subfolder, and close-tabs flag are all read
   by the background from `chrome.storage.local` — they live in one
   source of truth, not in the message payload.)
2. Background sets `status: "running"`, `total: tabIds.length`,
   `processed: 0`, `results: []`.
3. For each tabId, sequentially (see §5.3):

   a. `executeScript` to extract the media URL. The injected function
      is self-contained and dynamically imports either
      `resolve-image.js` or `resolve-video.js` from the extension via
      `chrome.runtime.getURL`, then applies the matching resolver:
      ```js
      async (selector, types) => {
        const el = document.querySelector(selector);
        if (!el) return null;
        const tag = el.tagName.toUpperCase();
        let type = null;
        if ((tag === "IMG" || tag === "PICTURE") && types.includes("image")) type = "image";
        else if (tag === "SOURCE") {
          const parent = el.closest("picture, video");
          if (parent?.tagName === "PICTURE" && types.includes("image")) type = "image";
          else if (parent?.tagName === "VIDEO" && types.includes("video")) type = "video";
        } else if (tag === "VIDEO" && types.includes("video")) type = "video";
        if (!type) return null;
        const moduleUrl = chrome.runtime.getURL(
          type === "image" ? "src/lib/resolve-image.js" : "src/lib/resolve-video.js"
        );
        let url = null;
        if (type === "image") {
          const { resolveImageUrl } = await import(moduleUrl);
          url = resolveImageUrl(el);
        } else {
          const { resolveVideoUrl } = await import(moduleUrl);
          url = resolveVideoUrl(el);
        }
        return url ? { url, type } : null;
      }
      ```
      This requires both `resolve-image.js` and `resolve-video.js`
      to be declared in `web_accessible_resources` (see §7).
   b. If no URL: record `no-media-url`, leave tab open, continue.
   c. If URL: compute filename via `filenameFromUrl(url)`, then call:
      ```js
      const downloadId = await chrome.downloads.download({
        url: mediaUrl,
        filename: `${subfolder}/${filename}`,
        conflictAction: "uniquify",
        saveAs: false,
      });
      ```
      Wrapped in try/catch (phase-1 fix carried forward): on
      rejection, record `save-failed` with the error message and
      continue.
   d. Persist a `chrome.storage.session` record keyed by
      `downloadId` (see §5.4) so the SW-restart recovery handler can
      close the right tab if the SW dies mid-download.
   e. Subscribe (via the engine's pending-Promise map) and wait for
      the `downloads.onChanged` event whose `delta.id` matches. On
      `delta.state.current === "complete"`:
      - If `closeTabs === true`, call `chrome.tabs.remove(tabId)`.
      - Record `saved`, increment `processed`.
      On `delta.state.current === "interrupted"`: record
      `save-failed` with `delta.error.current` as the reason, leave
      the tab, increment `processed`.
   f. Delete the session record for this `downloadId`.
   g. Broadcast
      `{ type: "progress", processed, total, lastResult }` so the
      popup (if open) updates live.

4. When `processed === total`, set `status: "done"` and broadcast
   `{ type: "done", results }`.

### 5.3 Why serial, not parallel

Unchanged from phase 1 (see prior spec §5.3). The single
`pending`-map entry per tab keeps state simple; serial gives
predictable result ordering; for 5–20 tabs the wall-clock difference
is small. Parallelism remains out of scope.

### 5.4 Service-worker termination during a run

Unchanged from phase 1. The module-top `chrome.downloads.onChanged`
listener (registered inside `createEngine` so it can route to
in-memory pending entries OR fall back to
`chrome.storage.session["downloads.<downloadId>"]` records when the
SW was restarted) wakes the SW on each download event. On recovery,
the handler closes the recorded `tabId` (if `closeTabs` was true at
batch start — the recorded value, not the current setting, see
below) and clears the record.

The recorded session value includes the closeTabs flag at batch
start:
```js
// chrome.storage.session
{
  "downloads.<downloadId>": {
    downloadId: number,
    tabId: number,
    tabUrl: string,
    tabTitle: string,
    closeTabs: boolean,   // snapshot at batch start
  }
}
```
This way, a user who starts a batch with closeTabs=true and toggles
it off mid-run doesn't get a surprise inconsistency on the recovered
download. The batch's behavior is decided at start.

### 5.5 Edit-and-save config

When the user edits the selector or subfolder input on blur, the new
value is written to `chrome.storage.local`. When either type checkbox
or the close-tabs checkbox is toggled, the new value writes
immediately. The next scan or run reads from storage, so all five
fields stay coherent.

If the popup edits the selector and immediately clicks Run, the popup
sends `{ type: "saveConfig", selector, subfolder, includeImages,
includeVideos, closeTabs }` *before* the `run` message and awaits the
ack, so the BG uses the new values.

## 6. Message contract

All messages flow through `chrome.runtime.sendMessage` with
`{ type, ...payload }`. Background returns a promise.

### Popup → Background

| Type | Payload | Response | Notes |
|---|---|---|---|
| `scan` | none | `{ tabs: [{ tabId, matched, type, url, title }] }` | Queries the active window's non-pinned tabs and runs `testSelector` per tab using the current selector + types from storage. |
| `saveConfig` | `{ selector, subfolder, includeImages, includeVideos, closeTabs }` | `{ ok: true }` | Persists to `chrome.storage.local`. |
| `run` | `{ tabIds: number[] }` | `{ ack: true }` | Kicks off the batch. Resolves immediately; progress comes via broadcast. |
| `getStatus` | none | `{ status, total, processed, results }` | Returned synchronously from the in-memory batch state. Used on popup re-open during a run. |

### Background → Popup (broadcast)

| Type | Payload | Notes |
|---|---|---|
| `progress` | `{ processed, total, lastResult }` | Sent after each tab finishes. |
| `done` | `{ results }` | Sent once when the batch finishes. |

Broadcasts use `chrome.runtime.sendMessage` with no recipient; Chrome
routes them to any listening extension page. The popup ignores the
"no receiver" rejection (phase-1 fix).

## 7. Manifest

```json
{
  "manifest_version": 3,
  "name": "Tab Media Reaper",
  "version": "0.2.0",
  "description": "Save matching images and videos from open tabs and close those tabs.",
  "permissions": ["scripting", "downloads", "tabs", "storage"],
  "host_permissions": ["<all_urls>"],
  "action": {
    "default_popup": "src/popup/popup.html",
    "default_title": "Tab Media Reaper"
  },
  "background": {
    "service_worker": "src/background.js",
    "type": "module"
  },
  "icons": {
    "16": "icons/16.png",
    "48": "icons/48.png",
    "128": "icons/128.png"
  },
  "web_accessible_resources": [
    {
      "resources": [
        "src/lib/resolve-image.js",
        "src/lib/resolve-video.js"
      ],
      "matches": ["<all_urls>"]
    }
  ]
}
```

Permissions unchanged from phase 1. `web_accessible_resources` gains
`src/lib/resolve-video.js`. `version` bumps to `0.2.0` to signal the
feature delta.

## 8. Pure modules

### 8.1 `src/lib/resolve-image.js`

Unchanged from phase 1:
```js
export function resolveImageUrl(el) {
  if (!el) return null;
  if (el.tagName === "IMG") return el.currentSrc || el.src || null;
  if (el.tagName === "PICTURE") {
    const img = el.querySelector("img");
    return img ? (img.currentSrc || img.src || null) : null;
  }
  if (el.tagName === "SOURCE") {
    const pic = el.closest("picture");
    const img = pic ? pic.querySelector("img") : null;
    return img ? (img.currentSrc || img.src || null) : null;
  }
  return null;
}
```

### 8.2 `src/lib/resolve-video.js`

New in phase 2:
```js
export function resolveVideoUrl(el) {
  if (!el) return null;
  if (el.tagName === "VIDEO") return el.currentSrc || el.src || null;
  if (el.tagName === "SOURCE") {
    const vid = el.closest("video");
    return vid ? (vid.currentSrc || vid.src || null) : null;
  }
  return null;
}
```

Note that `<source>` is reachable from both `resolve-image.js` (when
inside `<picture>`) and `resolve-video.js` (when inside `<video>`).
The dispatch happens in the injected extractor (§5.2 step 3a), which
walks the `<source>`'s nearest `picture, video` ancestor before
choosing a resolver.

`<video>` elements that rely on child `<source>` tags have their
`currentSrc` populated by the browser once the source is picked.
Same `||` short-circuit behavior as the image resolver: empty
strings fall through to `null`.

### 8.3 `src/lib/filename.js`

Unchanged from phase 1 (with the `data:` URL early-return fix from
phase-1 implementation). Its regex `/\.[a-z0-9]{2,5}$/i` matches all
relevant video extensions (`.mp4`, `.webm`, `.mov`, `.m4v`) — no
adjustment needed.

## 9. Error handling and status taxonomy

Every tab considered by a run lands in one bucket in `results[]`:

| Status | When | Tab fate |
|---|---|---|
| `saved` | Media URL resolved, download completed | Closed if `closeTabs` was on; left open otherwise |
| `save-failed` | Download issued but `onChanged` reported `interrupted`, OR `chrome.downloads.download` itself rejected | Left open |
| `no-media-url` | Selector matched an eligible-type element, but its `currentSrc`/`src` was empty | Left open |
| `inaccessible` | `executeScript` rejected (e.g. `chrome://`, restricted page, tab closed mid-run) | Left open |

Tabs that didn't match the selector, or whose matched element was a
type-filtered-out kind (e.g. selector hit `<video>` but Videos=off),
are not included in the run at all. They're counted only as part of
the "N of M" preview's *M*.

The popup's "done" view renders these as colored status pills (see
§10) with the URL and (if present) the `error` reason. The popup
never hides a non-`saved` outcome.

## 10. Visual design (Dario brand)

The popup adopts Dario's signature visual system, mirroring the
phase-1 `--tir-*` token layer (token names unchanged — the rename is
user-facing only).

### 10.1 Token block (`popup.css` `:root`)

Unchanged from phase 1. The full `--tir-*` token block stays
(`tir-primary`, `tir-grad-brand`, `tir-grad-hot`, etc.).

### 10.2 Layout

Phase-2 popup adds two checkbox rows between subfolder and headline:

```
┌────────────────────────────────────┐
│ </> TAB MEDIA REAPER               │
│                                    │
│ SELECTOR                           │
│ [ e.g. img.hero or #image…    ]    │
│                                    │
│ SUBFOLDER                          │
│ [ tab-media-reaper            ]    │
│                                    │
│ MEDIA TYPES                        │
│ [✓] Images    [✓] Videos           │  ← new
│                                    │
│ [✓] Close tabs after saving        │  ← new
│                                    │
│   1 of 178 tabs match              │
│                                    │
│ [        Run        ]              │
│                                    │
│ ▾ result rows…                     │
└────────────────────────────────────┘
```

**Checkbox styling:** visually-hidden native `<input type="checkbox">`
+ a styled `<span>` indicator. Brand: 16px square, `--tir-subtle`
background when off, `--tir-grad-brand` when on, with `--tir-glow-blue`
focus ring. Same `prefers-reduced-motion` and `forced-colors` carve-outs
as the rest of the popup.

**Result rows** unchanged in shape. The `imageUrl` field becomes
`mediaUrl` — popup reads it the same way. The pill `data-status`
selector for the yellow color changes from `no-image-url` to
`no-media-url`.

### 10.3 Motion and accessibility

Unchanged from phase 1. The new checkboxes inherit the
`prefers-reduced-motion` carve-out (no fill transition under reduced
motion; instant state change) and the `forced-colors` carve-out
(SystemColor fallback for the indicator).

## 11. Testing

### 11.1 Unit tests

Same browser harness, served by WAMP at
`http://localhost/tab-media-reaper/test/test.html` after the folder
rename.

**New tests** (additive to phase-1's 32-test suite):

- `resolve-video.test.js` — 7 tests covering every branch of
  `resolveVideoUrl`: null/undefined → null; `<video>` with src → src;
  `<video>` with srcset-via-children → currentSrc when set, else
  src; `<video>` with empty src and no children → null; `<source>`
  inside `<video>` walks to parent video; `<source>` with no
  `<video>` ancestor → null; non-video element (`<img>`) → null.
- `filename.test.js` — 3 additions: `.mp4` URL, `.webm` URL, video
  URL with query parameters (proves token stripping for the next
  reader; functionally redundant with phase-1's query-string test).
- `engine.test.js` — 9 additions:
  - scan: selector matches `<img>`, Images on → matched=true, type=image
  - scan: selector matches `<img>`, Images off → matched=false
  - scan: selector matches `<video>`, Videos off → matched=false
  - scan: selector matches `<video>`, Videos on → matched=true, type=video
  - scan: selector matches `<source>` inside `<picture>`, Images on, Videos off → type=image
  - scan: selector matches `<source>` inside `<video>`, Images off, Videos on → type=video
  - runBatch: saved + closeTabs=true → tab closed
  - runBatch: saved + closeTabs=false → tab stays open, result still saved
  - runBatch: video extraction returns `{url, type: "video"}` → downloaded with video extension

Target total: ~51 tests.

### 11.2 What is not unit-tested

Unchanged from phase 1. `chrome.scripting.executeScript` injection,
`chrome.downloads.download` real flow, `chrome.tabs.query` /
`chrome.tabs.remove`, and the background SW's batch orchestration
end-to-end are exercised manually (see §11.3) and via dependency-injected
fake `chrome.*` shims for the engine.

### 11.3 Manual smoke test (README)

Phase-1 checklist plus:

- **Video happy path.** Open a tab with a self-hosted `<video src="…mp4">`
  (e.g. a Wikipedia article with `mw-mmv` video or any direct
  `https://…/sample.mp4` page). Set selector to `video`. Toggle
  Videos on. Verify preview shows "1 of N tabs match". Run. Verify:
  file appears under `Downloads/<subfolder>/`, tab closes.
- **Blob-backed video (expected to fail).** Open a tab whose video
  uses MediaSource Extensions (most modern streaming sites). Set
  selector to `video`. Toggle Videos on. Run. Verify: tab stays
  open, results list shows `save-failed` pill with the reason
  (Chrome's rejection of the blob URL).
- **Type filter — image only.** Open mixed tabs (some `<img>`, some
  `<video>`). Selector `*[data-media]` (or whatever hits both
  kinds). Images on, Videos off. Preview counts only the image tabs.
- **Type filter — video only.** Same setup. Images off, Videos on.
  Preview counts only the video tabs.
- **Both types off.** Both checkboxes off. Preview reads "0 of M";
  Run is disabled.
- **Close tabs off.** Set close-tabs off. Run any matching tab.
  Verify: file saved, tab stays open. Result row shows `saved`
  pill (the difference is the tab fate, not the result status).

## 12. Migration plan (from phase 1)

Strict ordering:

1. **Commit** the new spec (this file) and the new plan derived from
   it to `docs/superpowers/specs/` and `docs/superpowers/plans/` —
   both files live alongside the phase-1 originals (no deletions;
   the phase-1 docs remain as historical record).
2. **`gh repo rename tab-media-reaper`** while the working tree is
   clean. GitHub redirects `dariobimbi/tab-image-reaper` →
   `dariobimbi/tab-media-reaper` for one year.
3. **`git remote set-url origin https://github.com/dariobimbi/tab-media-reaper.git`** — update the local remote.
4. **`git push`** — verifies the new URL works.
5. **Close VS Code / any editor pointing at the old path.**
6. **`Move-Item c:\wamp64\www\tab-image-reaper c:\wamp64\www\tab-media-reaper`** in PowerShell.
7. **Reopen VS Code** at `c:\wamp64\www\tab-media-reaper`.
8. **Chrome:** `chrome://extensions` → remove the existing "Tab Image
   Reaper" load, then "Load unpacked" → select the new path.
   Reload alone doesn't follow the move; it has to be re-added.
9. **Implement** the code delta per the new plan (TDD ordering:
   `resolve-video.js` first, then engine type-filter extensions,
   then popup checkboxes, then manifest rename, then docs).
10. **Manual smoke** at the new test URL.

### Migration risks

- **Forgetting Chrome re-add after the move:** the extension card
  points at a dead path, popup won't open. Step 8 above; called out
  inline in the migration plan and the README.
- **Stale `git remote` URL:** if step 3 is skipped, the next push
  fails. Easy to fix in the moment.
- **WAMP custom Alias / VirtualHost:** if a non-default Apache
  alias or vhost in `httpd.conf` / `httpd-vhosts.conf` / the WAMP
  tray Alias menu points at `c:\wamp64\www\tab-image-reaper`, update
  it. WAMP's default `www`-subdirectory mapping picks up the new
  folder automatically — no config change needed there.
- **Existing user has `subfolder: "tab-image-reaper"` stored:**
  downloads keep landing at the old name. Hands-off policy; user
  edits the popup field if they want the move.

## 13. What is not changing

Listing these explicitly to head off scope creep during
implementation:

- The single-listener-inside-`createEngine` invariant for
  `chrome.downloads.onChanged`.
- The `--tir-*` CSS token names (they're internal; renaming would
  be churn for zero user value).
- The factory shape of `createEngine`.
- The `chrome.storage.session` recovery path's basic shape
  (downloadId → tabId mapping); only the recorded payload grows by
  one field (`closeTabs`).
- The harness API (`test`, `ok`, `eq`, `throws`, `run`).
- The 32 phase-1 tests — all continue to pass.
- All four hard constraints from §1.2.
