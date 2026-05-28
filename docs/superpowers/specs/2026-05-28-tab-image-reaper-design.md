# Tab Image Reaper — Design

**Date:** 2026-05-28
**Status:** Drafted, pending user review
**Project root:** `c:\wamp64\www\tab-image-reaper`

A personal-use Chrome (Manifest V3) extension that, on toolbar click,
scans every non-pinned tab in the current window for an image matching a
user-supplied CSS selector, saves each match to a fixed subfolder under
Downloads, and closes the tabs whose images saved successfully.

## 1. Scope and constraints

### 1.1 What it does

- One toolbar click opens a popup that shows the current selector, a
  preview match count ("N of M tabs match"), and a Run button.
- On Run, the background service worker iterates the matched tabs,
  downloads each matching image to `Downloads/<subfolder>/`, and closes
  the source tab on successful download.
- Non-matching tabs are untouched. Failed-download tabs stay open with a
  visible error in the popup.

### 1.2 Hard constraints (non-negotiable)

These mirror the bimbi-stocker hard constraints because they apply to
any tool Dario builds:

- **No build step.** Native ES modules, MV3, loaded unpacked from WAMP.
  No Webpack/Vite/bundler.
- **Local-only.** No server, no account, no network egress beyond the
  user-initiated downloads. `chrome.storage.local` is the single source
  of truth for config.
- **Fail loudly, never silently.** Every tab that wasn't closed must
  show *why* in the popup (no-match, no-image-url, save-failed,
  inaccessible). No tab gets closed without a confirmed save.
- **No anti-bot or evasion behavior.** If a page restricts execution
  (chrome://, blob:, restricted), surface `inaccessible` and move on.
- **Pinned tabs are sacred.** They are filtered at query time and never
  considered for either save or close.

### 1.3 Non-goals (explicitly out of scope)

- No retry on failed downloads.
- No history / log of past runs.
- No multi-window support — current window only.
- No URL-pattern filter for tabs.
- No custom filename templates beyond the source URL's leaf name.
- No saving of non-image elements (CSS `background-image`, inline SVG).
- No deduplication across tabs (two tabs of the same image = two saves;
  Chrome auto-suffixes collisions).
- No headless or parallel-download tuning.
- No visual element picker. The selector is a text field.

## 2. Architecture

```
┌──────────────────────┐
│ src/popup/popup.{html,css,js} │  ← view: selector input, preview, Run, results
└──────────┬───────────┘
           │ chrome.runtime.sendMessage
           ▼
┌──────────────────────┐
│   src/background.js  │  ← engine: scan, run, downloads listener, tab close
└──────────┬───────────┘
           │ chrome.scripting.executeScript / chrome.downloads / chrome.tabs
           ▼
        Active window's tabs
```

Two pure helpers live in `src/lib/` and are the primary TDD targets:

- `src/lib/resolve-image.js` — given a DOM element reference, return
  the best image URL (handles `<img>`, `<picture>`, `<source>`,
  preferring `currentSrc` over `src`).
- `src/lib/filename.js` — given an image URL string, return the leaf
  filename with extension fallback.

The popup never touches `chrome.tabs`, `chrome.downloads`, or
`chrome.scripting` directly. The background service worker owns those.
This isolation means a popup-close mid-run never strands a batch.

## 3. File layout

```
tab-image-reaper/
├── manifest.json
├── README.md
├── icons/
│   ├── 16.png
│   ├── 48.png
│   └── 128.png
├── src/
│   ├── background.js
│   ├── popup/
│   │   ├── popup.html
│   │   ├── popup.css
│   │   └── popup.js
│   └── lib/
│       ├── resolve-image.js
│       └── filename.js
├── test/
│   ├── test.html
│   ├── harness.js
│   ├── fixtures.js
│   ├── resolve-image.test.js
│   └── filename.test.js
└── docs/
    └── superpowers/
        └── specs/
            └── 2026-05-28-tab-image-reaper-design.md  ← this file
```

The harness mirrors the bimbi-stocker pattern: `test/test.html` is
opened via WAMP (`http://localhost/tab-image-reaper/test/test.html`) and
runs all `*.test.js` modules through `harness.js`. No Node, no jsdom.

## 4. Data model

### 4.1 Persistent (`chrome.storage.local`)

```js
{
  selector: "img",                    // CSS selector string; default "img"
  subfolder: "tab-image-reaper",      // path under Downloads; default project name
}
```

Both are user-editable from the popup. Saved on blur or on Run.

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
      status: "saved" | "save-failed" | "no-image-url" | "inaccessible",
      imageUrl?: string,               // present when an image URL was extracted
      filename?: string,               // present when a download was issued
      error?: string,                  // human-readable reason on non-`saved`
    }
  ],
}
```

State is held in a module-level variable in `background.js`. The SW may
terminate after a run completes; that's fine — the popup pulls state on
open and the `results` array is the source of truth until then. If the
SW terminates mid-run (rare; downloads keep it alive in practice), the
in-flight `chrome.downloads.onChanged` handlers still fire when the SW
wakes, and the state rebuilds from the last persisted progress (see
§5.4).

## 5. Flows

### 5.1 Popup open

1. `popup.js` reads `selector` and `subfolder` from `chrome.storage.local`
   and populates the inputs.
2. Popup sends `{ type: "scan" }` to background.
3. Background queries `chrome.tabs.query({ currentWindow: true,
   pinned: false })`.
4. For each tab, background runs
   `chrome.scripting.executeScript({ target: { tabId }, func: testSelector,
   args: [selector] })` where `testSelector(sel)` returns
   `{ matched: !!document.querySelector(sel) }`.
5. `executeScript` rejection (e.g. `chrome://`, `chrome-extension://`,
   PDF viewer) is caught per-tab and counted as not-matched.
6. Background replies with
   `{ tabs: [{ tabId, matched, url, title }] }`.
7. Popup renders "N of M tabs match" (N = matched, M = total queried)
   and enables the Run button when N > 0.

### 5.2 Run

1. Popup sends `{ type: "run", tabIds: matchedTabIds }`.
2. Background sets `status: "running"`, `total: tabIds.length`,
   `processed: 0`, `results: []`.
3. For each tabId, sequentially (see §5.3 for why serial):
   a. `executeScript` to extract the image URL via the pure helper.
      The extractor is injected as a self-contained async function; it
      dynamically imports `resolve-image.js` from the extension via
      `chrome.runtime.getURL`, then runs the helper against the matched
      element:
      ```js
      async (selector) => {
        const url = chrome.runtime.getURL("src/lib/resolve-image.js");
        const { resolveImageUrl } = await import(url);
        const el = document.querySelector(selector);
        return resolveImageUrl(el);
      }
      ```
      This is the same pattern bimbi-stocker uses for its picker
      injection and requires `src/lib/resolve-image.js` to be declared
      in `web_accessible_resources` (see §7).
   b. If no URL: record `no-image-url`, leave tab open, continue.
   c. If URL: compute filename via `filenameFromUrl(url)` (pure helper,
      runs in BG SW), call:
      ```js
      const downloadId = await chrome.downloads.download({
        url: imageUrl,
        filename: `${subfolder}/${filename}`,
        conflictAction: "uniquify",   // Chrome auto-suffixes "(1)", "(2)"
        saveAs: false,
      });
      ```
   d. Subscribe to `chrome.downloads.onChanged` once per downloadId; on
      `delta.state.current === "complete"`, call
      `chrome.tabs.remove(tabId)`, record `saved`, increment `processed`,
      unsubscribe.
   e. On `delta.state.current === "interrupted"`, record `save-failed`
      with `delta.error.current` as the reason, leave the tab,
      increment `processed`, unsubscribe.
   f. After each `processed` increment, broadcast
      `{ type: "progress", processed, total, lastResult }` so the popup
      (if open) updates live.
4. When `processed === total`, set `status: "done"` and broadcast a
   final progress message with the full `results` array.

### 5.3 Why serial, not parallel

For 5–20 tabs the wall-clock difference is small, but serial gives:

- Predictable order in the popup's result list.
- One outstanding `downloads.onChanged` subscription at a time, simpler
  state.
- No thundering herd of `executeScript` calls.

Parallelism is a Phase-2 concern (and out of scope per §1.3).

### 5.4 Service-worker termination during a run

MV3 service workers can be terminated when "idle." `chrome.downloads`
listeners that are registered at module top-level wake the SW when
events fire, so an in-flight download will reliably re-enter the
handler. The complication is matching the wake-up event to a specific
batch in-progress.

Mitigation: when a download is initiated, persist a tiny record to
`chrome.storage.session` (cleared on browser restart) keyed by
downloadId:

```js
// chrome.storage.session
{
  "downloads.<downloadId>": {
    downloadId: number,
    tabId: number,
    tabUrl: string,         // for the post-restart popup toast
    tabTitle: string,
  }
}
```

On `downloads.onChanged`, the handler first checks the in-memory
`results` array; if the downloadId is absent (SW was restarted), it
falls back to the session record, closes the tab on `complete` (or
leaves it on `interrupted`), then deletes the session record. Results
lost from `results[]` are not recoverable for the popup's live display,
but the *action* (save + close) is preserved — which is what matters.
On the next popup open, if any session records are still present and
their associated tabs no longer exist, the popup shows a toast: "N
result records were lost to a service worker restart; their tabs were
closed but aren't in the list." This trade-off is acceptable for a
personal tool.

`chrome.storage.session` requires no additional permission beyond
`storage` (already requested per §7).

### 5.5 Edit-and-save selector

When the user edits the selector or subfolder input in the popup, on
blur (or on Run click) the new value is written to
`chrome.storage.local`. The next time the popup opens, it reads the
updated value.

If the popup edits the selector and immediately clicks Run, the popup
sends a `{ type: "saveConfig", selector, subfolder }` message *before*
the `run` message and awaits the ack, so the BG uses the new value.

## 6. Message contract

All messages flow through `chrome.runtime.sendMessage` with
`{ type, ...payload }`. Background returns a promise.

### Popup → Background

| Type | Payload | Response | Notes |
|---|---|---|---|
| `scan` | none | `{ tabs: [{ tabId, matched, url, title }] }` | Queries the active window's non-pinned tabs and runs `testSelector` per tab. |
| `saveConfig` | `{ selector, subfolder }` | `{ ok: true }` | Persists to `chrome.storage.local`. |
| `run` | `{ tabIds: number[] }` | `{ ack: true }` | Kicks off the batch. Resolves immediately; progress comes via broadcast. |
| `getStatus` | none | `{ status, total, processed, results }` | Returned synchronously from the in-memory batch state. Used on popup re-open during a run. |

### Background → Popup (broadcast)

| Type | Payload | Notes |
|---|---|---|
| `progress` | `{ processed, total, lastResult }` | Sent after each tab finishes (saved, save-failed, no-image-url, inaccessible). |
| `done` | `{ results }` | Sent once when the batch finishes; popup shows the final tally. |

Broadcasts are emitted via `chrome.runtime.sendMessage` with no recipient
— Chrome routes them to any listening extension page. If the popup is
closed, the messages are dropped (harmless; popup picks up state via
`getStatus` on re-open).

## 7. Manifest

```json
{
  "manifest_version": 3,
  "name": "Tab Image Reaper",
  "version": "0.1.0",
  "description": "Save matching images from open tabs and close those tabs.",
  "permissions": ["scripting", "downloads", "tabs", "storage"],
  "host_permissions": ["<all_urls>"],
  "action": {
    "default_popup": "src/popup/popup.html",
    "default_title": "Tab Image Reaper"
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
      "resources": ["src/lib/resolve-image.js"],
      "matches": ["<all_urls>"]
    }
  ]
}
```

- `scripting` — required to call `chrome.scripting.executeScript`.
- `downloads` — required to call `chrome.downloads.download` and listen
  on `downloads.onChanged`.
- `tabs` — required to read tab `url` / `title` properties from
  `chrome.tabs.query` results across hosts (without it those fields come
  back undefined unless `activeTab` is granted, which is only valid
  immediately after user gesture in the active tab).
- `storage` — for `chrome.storage.local`.
- `host_permissions: ["<all_urls>"]` — needed so `executeScript` can
  inject into arbitrary pages the user has open.
- `web_accessible_resources` — required so the in-page extractor can
  `import(chrome.runtime.getURL("src/lib/resolve-image.js"))`.
  `filename.js` is *not* listed because it runs only in the background
  SW (static import), never in a page.

No `content_scripts` entry. Injection is on-demand via the
`scripting` API, which avoids running our code on every page load.

## 8. Pure modules

### 8.1 `src/lib/resolve-image.js`

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

Unit tests cover: plain `<img>`, `<img>` with srcset (prefers
`currentSrc`), `<picture>` with multiple sources, `<source>` walked back
to its `<img>`, non-image element returns `null`, null input returns
`null`.

### 8.2 `src/lib/filename.js`

```js
export function filenameFromUrl(url) {
  try {
    const u = new URL(url);
    const last = u.pathname.split("/").filter(Boolean).pop() || "image";
    if (!/\.[a-z0-9]{2,5}$/i.test(last)) return last + ".jpg";
    return last;
  } catch {
    return "image.jpg";
  }
}
```

Unit tests cover: standard URL with extension, URL with no extension,
URL with query string (stripped by `URL.pathname`), URL with hash
(ignored), `data:` URL (try/catch falls through — `data:` parses as a
URL, leaf becomes "image.jpg" via the extension regex), `blob:` URL
(parses; resulting filename is a UUID, no extension, gets `.jpg`),
malformed input returns the `image.jpg` fallback.

## 9. Error handling and status taxonomy

Every tab considered by a run lands in one bucket in `results[]`:

| Status | When | Tab fate |
|---|---|---|
| `saved` | Image URL resolved, download completed | Closed |
| `save-failed` | Download issued but `onChanged` reported `interrupted` (network, 404, CORS, etc.) | Left open |
| `no-image-url` | Selector matched but element wasn't `<img>`/`<picture>`/`<source>`, or `currentSrc`/`src` was empty | Left open |
| `inaccessible` | `executeScript` rejected (e.g. `chrome://`, restricted page, tab closed mid-run) | Left open |

Tabs that didn't match the selector during `scan` are not included in
the run at all. They are reported only as part of the "N of M" preview
count.

The popup's "done" view renders these as colored status pills (see §10)
with the URL and (if present) the `error` reason. The popup never
hides a non-`saved` outcome.

## 10. Visual design (Dario brand)

The popup adopts Dario's signature visual system, mirroring the
bimbi-stocker `--bs-*` token layer with a `--tir-*` prefix.

### 10.1 Token block (`popup.css` `:root`)

Duplicated from `dariobimbi.com` palette and the bimbi-stocker mirror.
Names and values:

```css
:root {
  color-scheme: dark;

  --tir-bg: #0a0e1a;
  --tir-surface: #11172a;
  --tir-surface-deep: #0d1326;
  --tir-subtle: #1a2138;
  --tir-fg: #e8ecf6;
  --tir-muted: #94a3b8;

  --tir-primary: #3b82f6;
  --tir-primary-soft: #60a5fa;
  --tir-accent: #a855f7;
  --tir-accent-soft: #c084fc;
  --tir-hot: #f43f5e;
  --tir-highlight: #facc15;
  --tir-ok: #22c55e;

  --tir-grad-brand: linear-gradient(135deg, #3b82f6, #a855f7);
  --tir-grad-brand-soft: linear-gradient(135deg, #60a5fa, #c084fc);
  --tir-grad-hot: linear-gradient(135deg, #a855f7, #f43f5e);
  --tir-grad-card: linear-gradient(180deg, #11172a, #0d1326);

  --tir-radius-card: 12px;
  --tir-radius-input: 8px;
  --tir-radius-pill: 999px;

  --tir-glow-blue: 0 0 18px -2px rgba(59, 130, 246, 0.55);
  --tir-glow-violet: 0 0 18px -2px rgba(168, 85, 247, 0.55);

  --tir-font-sans: system-ui, -apple-system, "Segoe UI", sans-serif;
  --tir-font-mono: ui-monospace, "SF Mono", Consolas, monospace;

  --tir-ease: cubic-bezier(.2, .7, .2, 1);
  --tir-duration: 220ms;
}
```

### 10.2 Layout

- Popup width 360px, padding 16px, `background: var(--tir-grad-card)`,
  `border-radius: var(--tir-radius-card)`.
- Top: eyebrow tag "`</> tab image reaper`" in `--tir-font-mono`,
  uppercase, `letter-spacing: 0.06em`, color `--tir-primary-soft`.
- Selector input + subfolder input: each a labeled `<input>` with
  `--tir-radius-input`, `1px solid var(--tir-subtle)`, focus border
  brightens to `--tir-primary` with `--tir-glow-blue` shadow over 220ms.
- Match count headline: "**N** of M tabs match", where the **N** is a
  brand-gradient text-clip (with `--tir-primary-soft` solid fallback and
  a `@media (forced-colors: active)` unwind block).
- Run button: pill, `background: var(--tir-grad-brand)`, white text, no
  border, hover lifts `translateY(-2px)` with `--tir-glow-violet` halo
  over 220ms. Disabled when N=0 or a run is in progress.
- During a run: Run button text becomes "Working… (P/T)" and stays
  disabled.
- Results section (after a run): list of rows, one per processed tab,
  each row is a card with a status pill (left), tab title (middle,
  truncated), and the URL (subtitle, `--tir-muted`).
  - `saved` pill: `--tir-ok` dot, `box-shadow: 0 0 0 4px rgba(34,197,94,.18)` halo.
  - `save-failed` pill: `--tir-hot` dot + matching halo.
  - `no-image-url` / `inaccessible` pills: `--tir-highlight` dot + halo.
- Card hover: `translateY(-2px)`, border brightens to `--tir-primary`,
  `--tir-glow-blue` shadow, 220ms.

### 10.3 Motion and accessibility

- `@media (prefers-reduced-motion: reduce)` carve-out: transitions and
  hover lifts disabled; gradients and colors retained.
- `@media (forced-colors: active)`: gradient text-clip unwound back to
  solid `--tir-primary-soft` so the headline doesn't vanish in Windows
  High Contrast Mode.
- Scrollbars styled via `scrollbar-width: thin; scrollbar-color:
  var(--tir-subtle) var(--tir-surface-deep);`.
- `aria-live="polite"` on the results list so screen readers announce
  each tab outcome as it lands.
- Run button focus ring: `outline: 2px solid var(--tir-primary-soft);
  outline-offset: 2px;` — never `outline: none`.

## 11. Testing

### 11.1 Unit tests

Browser harness (`test/test.html` + `test/harness.js`), opened via WAMP
at `http://localhost/tab-image-reaper/test/test.html`. No Node, no
jsdom.

Coverage:

- **`resolve-image.test.js`** — every branch in `resolveImageUrl`:
  plain `<img>`, `<img>` with `srcset` (DOM provides `currentSrc`),
  `<picture>` with inner `<img>`, `<source>` walked back to its `<img>`,
  div / span / other returns `null`, `null` input returns `null`,
  element with empty `src` returns `null`.
- **`filename.test.js`** — every branch in `filenameFromUrl`: URL with
  `.jpg`, URL with `.PNG` (case-insensitive regex), URL with no
  extension, URL with query string, URL with hash, `data:` URL fallback,
  `blob:` URL fallback, garbage string fallback.

The fixture file `test/fixtures.js` exports small HTML snippets and
URL strings. Tests parse HTML via `new DOMParser().parseFromString(...)`
and operate on the resulting document — no live page needed.

### 11.2 What is not unit-tested

- `chrome.scripting.executeScript` injection.
- `chrome.downloads.download` and `onChanged` event flow.
- `chrome.tabs.query` / `chrome.tabs.remove`.
- The background SW's batch orchestration end-to-end.

These are exercised manually (see §11.3). The background orchestration
*could* be tested via dependency-injected fake `chrome.*` shims like
bimbi-stocker does for its engine — that's worth doing for the scan and
the per-tab state-machine, and is included in the implementation plan.

### 11.3 Manual smoke test (README)

1. **Load unpacked.** Open `chrome://extensions`, enable Developer
   Mode, "Load unpacked" → select `c:\wamp64\www\tab-image-reaper`.
2. **Happy path.** Open 5 tabs of pages with a clearly-identifiable
   image (e.g. `<img class="hero">`). Click the toolbar icon. Edit
   selector to `img.hero`. Verify preview says "5 of 5 tabs match".
   Click Run. Verify: 5 files appear under
   `Downloads/tab-image-reaper/`, all 5 tabs close.
3. **Mixed match.** Open 5 tabs where only 3 have `img.hero`. Verify
   preview says "3 of 5 tabs match". Run. Verify: 3 files saved, 3
   matching tabs closed, 2 non-matching tabs untouched.
4. **Pinned tab safety.** Pin one of the matching tabs. Run.
   Verify: preview shows reduced match count (pinned tab excluded),
   pinned tab stays open and pinned.
5. **Save failure.** Point a watch at a page whose image URL returns
   404 (open DevTools → Network → block the image URL pattern). Run.
   Verify: tab stays open, results list shows `save-failed` pill with
   the reason.
6. **Inaccessible tab.** Open a `chrome://settings` tab. Run.
   Verify: preview either excludes it or shows it as not-matched,
   results list shows `inaccessible` pill, no save attempted.
7. **No-image-url.** Set selector to something that matches a `<div>`,
   e.g. `body`. Run. Verify: every tab gets `no-image-url`, no tabs
   close.
8. **Collision.** Open 3 tabs of the same page (same image URL). Run.
   Verify: 3 files saved with `(1)`, `(2)` suffixes from Chrome's
   `uniquify` conflict action, 3 tabs close.

## 12. Implementation phasing

There is no Phase 2. The entire design above is one phase. The natural
ordering of implementation tasks (the writing-plans skill will produce
the authoritative plan):

1. Project scaffold: `manifest.json`, `icons/`, empty
   `src/background.js`, popup files, `test/` harness.
2. Pure modules + their unit tests (`resolve-image.js`,
   `filename.js`). TDD.
3. Background scan flow (`scan` message, `testSelector` injection,
   tab query, response shape). Dep-injected unit test.
4. Background run flow (per-tab extract, download, listener, close).
   Dep-injected unit test for the state machine.
5. Popup UI (HTML, brand-tokens CSS, scan-on-open, render preview,
   Run button, live progress, results list).
6. Manifest finalization (permissions, web_accessible_resources).
7. README with manual smoke-test checklist.
8. End-to-end manual smoke pass.
