# Tab Image Reaper Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a personal-use Manifest V3 Chrome extension that, on toolbar click, scans every non-pinned tab in the current window for an image matching a user-edited CSS selector, saves each match to `Downloads/<subfolder>/`, and closes the tab on confirmed save.

**Architecture:** Two layers. The popup (`src/popup/`) is a thin view that reads/writes config to `chrome.storage.local` and exchanges messages with the background. The background service worker (`src/background.js`) owns `chrome.tabs`/`downloads`/`scripting` and delegates orchestration to a factory-built engine (`src/lib/engine.js`) so the per-tab state machine can be unit-tested against an in-memory shim. Two pure helpers — `resolve-image.js` (DOM → image URL) and `filename.js` (URL → leaf) — are the primary TDD targets.

**Tech Stack:** Manifest V3, native ES modules, no bundler. Browser-only test harness (no Node, no jsdom) served by WAMP at `http://localhost/tab-image-reaper/test/test.html`. Mirrors the bimbi-stocker style (same harness API: `test`, `ok`, `eq`).

**Source of truth:** `docs/superpowers/specs/2026-05-28-tab-image-reaper-design.md`. Read it before touching code. Hard constraints from §1.2 (no build step, local-only, fail loudly, pinned tabs sacred, no evasion) and locked decisions from `CLAUDE.md` are non-negotiable.

---

## File map (what each file owns)

| File | Created in | Responsibility |
|---|---|---|
| `manifest.json` | Task 1 (minimal), Task 9 (final) | MV3 manifest: permissions, action, background SW, web_accessible_resources |
| `icons/{16,48,128}.png` | Task 1 | Toolbar / extensions-page icons (brand-blue solid placeholders) |
| `src/lib/filename.js` | Task 2 | Pure: `filenameFromUrl(url)` → leaf with `.jpg` extension fallback |
| `src/lib/resolve-image.js` | Task 3 | Pure: `resolveImageUrl(el)` for `<img>`/`<picture>`/`<source>` |
| `src/lib/engine.js` | Task 4–5 | Factory `createEngine({chrome, broadcast})` exposing `scan`, `runBatch`, `handleDownloadChanged`, `getState` |
| `src/background.js` | Task 6 | Wires real `chrome.*` to engine; module-top `downloads.onChanged` listener; `runtime.onMessage` handler |
| `src/popup/popup.html` | Task 7 | Popup structure: selector input, subfolder input, preview, Run button, results list |
| `src/popup/popup.css` | Task 7 | `--tir-*` brand tokens + layout + status pills + motion/a11y carve-outs |
| `src/popup/popup.js` | Task 8 | Loads config, sends `scan`/`saveConfig`/`run`/`getStatus`, renders preview + live progress + results |
| `test/test.html` | Task 1 | Mounts harness, imports every `*.test.js`, calls `run()` |
| `test/harness.js` | Task 1 | Minimal browser test runner: `test`, `ok`, `eq`, `throws`, `run` |
| `test/fixtures.js` | Task 1 (stub), Task 3 (HTML), Task 4–5 (chrome shim) | Static HTML snippets, URL strings, chrome shim factory |
| `test/filename.test.js` | Task 2 | Branches of `filenameFromUrl` |
| `test/resolve-image.test.js` | Task 3 | Branches of `resolveImageUrl` |
| `test/engine.test.js` | Task 4–5 | `scan` and `runBatch` against a chrome shim |
| `README.md` | Task 10 | What it is, install steps, manual smoke-test checklist |

`filename.js` is **not** in `web_accessible_resources` — it runs only in the background SW. `resolve-image.js` **is** listed there because the in-page extractor reaches it via `import(chrome.runtime.getURL(...))`.

---

## Task 1: Scaffold project, icons, and test harness

**Files:**
- Create: `manifest.json`
- Create: `icons/16.png`, `icons/48.png`, `icons/128.png`
- Create: `src/background.js` (stub)
- Create: `src/popup/popup.html` (stub)
- Create: `src/popup/popup.css` (empty)
- Create: `src/popup/popup.js` (empty)
- Create: `src/lib/.gitkeep` (or leave dir creation to later tasks)
- Create: `test/test.html`
- Create: `test/harness.js`
- Create: `test/fixtures.js` (empty exports for now)

- [ ] **Step 1: Create minimal `manifest.json`** (final permissions added in Task 9)

```json
{
  "manifest_version": 3,
  "name": "Tab Image Reaper",
  "version": "0.1.0",
  "description": "Save matching images from open tabs and close those tabs.",
  "permissions": ["storage"],
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
  }
}
```

- [ ] **Step 2: Generate solid-color placeholder icons via PowerShell**

Run (from project root):

```powershell
Add-Type -AssemblyName System.Drawing
New-Item -ItemType Directory -Force -Path icons | Out-Null
foreach ($size in 16, 48, 128) {
  $bmp = New-Object System.Drawing.Bitmap $size, $size
  $g   = [System.Drawing.Graphics]::FromImage($bmp)
  $g.Clear([System.Drawing.Color]::FromArgb(255, 59, 130, 246))  # --tir-primary
  $bmp.Save("icons/$size.png", [System.Drawing.Imaging.ImageFormat]::Png)
  $g.Dispose(); $bmp.Dispose()
}
```

Expected: `icons/16.png`, `icons/48.png`, `icons/128.png` exist (verify with `ls icons/`).

- [ ] **Step 3: Create stub source files**

`src/background.js`:
```js
// Wired in Task 6.
```

`src/popup/popup.html`:
```html
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>Tab Image Reaper</title>
  <link rel="stylesheet" href="popup.css" />
</head>
<body>
  <!-- Filled in Task 7. -->
  <script type="module" src="popup.js"></script>
</body>
</html>
```

`src/popup/popup.css`: empty file.

`src/popup/popup.js`:
```js
// Wired in Task 8.
```

- [ ] **Step 4: Create test harness**

`test/harness.js` (mirrors bimbi-stocker exactly):
```js
const tests = [];
export function test(name, fn) { tests.push({ name, fn }); }
export function ok(v, msg) { if (!v) throw new Error(msg || `expected truthy, got ${v}`); }
export function eq(actual, expected, msg) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a !== e) throw new Error(msg || `expected ${e}, got ${a}`);
}
export function throws(fn, msg) {
  try { fn(); } catch { return; }
  throw new Error(msg || "expected function to throw");
}
export async function run() {
  const root = document.getElementById("results");
  let pass = 0, fail = 0;
  for (const t of tests) {
    try { await t.fn(); pass++; line(root, `✓ ${t.name}`, "green"); }
    catch (e) { fail++; line(root, `✗ ${t.name} — ${e.message}`, "crimson"); }
  }
  const h = document.createElement("h2");
  h.textContent = `${pass} passed, ${fail} failed`;
  h.style.color = fail ? "crimson" : "green";
  root.prepend(h);
  console.log(`${pass} passed, ${fail} failed`);
}
function line(root, text, color) {
  const d = document.createElement("div");
  d.textContent = text; d.style.color = color; d.style.fontFamily = "monospace";
  root.appendChild(d);
}
```

`test/test.html`:
```html
<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>Tab Image Reaper — tests</title></head>
<body>
  <h1>Tab Image Reaper — test results</h1>
  <div id="results"></div>
  <script type="module">
    import { run } from "./harness.js";
    // Each task appends its test import below, then run() executes all.
    await run();
  </script>
</body>
</html>
```

`test/fixtures.js`:
```js
// Populated in Tasks 3 and 4.
export {};
```

- [ ] **Step 5: Verify the harness loads under WAMP**

In a browser, open `http://localhost/tab-image-reaper/test/test.html`.
Expected: page renders the "Tab Image Reaper — test results" heading and "0 passed, 0 failed" in green. No console errors.

If the page is blank or the console says "Failed to load module": confirm WAMP is running and `c:\wamp64\www\` is its document root.

- [ ] **Step 6: Commit**

```powershell
git add manifest.json icons src test
git commit -m @'
feat: scaffold MV3 manifest, icons, stubs, and test harness

- Minimal manifest.json (permissions filled in Task 9)
- Solid-blue placeholder icons (16/48/128)
- Empty src/{background,popup}/* stubs
- Browser test harness mirroring bimbi-stocker
'@
```

---

## Task 2: `filename.js` — TDD pure module

**Files:**
- Create: `src/lib/filename.js`
- Create: `test/filename.test.js`
- Modify: `test/test.html` (add import)

- [ ] **Step 1: Write the failing tests**

`test/filename.test.js`:
```js
import { test, eq } from "./harness.js";
import { filenameFromUrl } from "../src/lib/filename.js";

test("filename: standard URL with .jpg", () => {
  eq(filenameFromUrl("https://example.com/path/photo.jpg"), "photo.jpg");
});
test("filename: case-insensitive extension (.PNG)", () => {
  eq(filenameFromUrl("https://example.com/IMG.PNG"), "IMG.PNG");
});
test("filename: no extension gets .jpg", () => {
  eq(filenameFromUrl("https://example.com/path/photo"), "photo.jpg");
});
test("filename: query string is stripped", () => {
  eq(filenameFromUrl("https://example.com/photo.jpg?w=800&v=2"), "photo.jpg");
});
test("filename: hash is stripped", () => {
  eq(filenameFromUrl("https://example.com/photo.jpg#anchor"), "photo.jpg");
});
test("filename: trailing slash falls back to 'image.jpg'", () => {
  eq(filenameFromUrl("https://example.com/"), "image.jpg");
});
test("filename: data: URL falls through to 'image.jpg'", () => {
  eq(filenameFromUrl("data:image/png;base64,iVBOR..."), "image.jpg");
});
test("filename: blob: URL with UUID gets .jpg", () => {
  // blob URLs parse; pathname is the UUID with no extension.
  const out = filenameFromUrl("blob:https://example.com/12345678-1234-1234-1234-123456789abc");
  eq(out, "12345678-1234-1234-1234-123456789abc.jpg");
});
test("filename: garbage string falls back to 'image.jpg'", () => {
  eq(filenameFromUrl("not a url"), "image.jpg");
});
test("filename: null/undefined falls back to 'image.jpg'", () => {
  eq(filenameFromUrl(null), "image.jpg");
  eq(filenameFromUrl(undefined), "image.jpg");
});
```

- [ ] **Step 2: Wire the new test file into `test/test.html`**

Edit `test/test.html` — inside the `<script type="module">` block, before `await run();`, add:

```js
    import "./filename.test.js";
```

- [ ] **Step 3: Run the harness to verify the tests fail**

Open `http://localhost/tab-image-reaper/test/test.html` (hard-reload with Ctrl+F5 to bust the browser cache).
Expected: console error "Failed to resolve module specifier '../src/lib/filename.js'" or similar, page shows the red error.

- [ ] **Step 4: Implement `src/lib/filename.js`**

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

- [ ] **Step 5: Re-run the harness, verify all tests pass**

Hard-reload `test/test.html`.
Expected: "10 passed, 0 failed" in green.

- [ ] **Step 6: Commit**

```powershell
git add src/lib/filename.js test/filename.test.js test/test.html
git commit -m @'
feat(lib): add filenameFromUrl + tests

Leaf filename from URL with .jpg fallback for extensionless,
malformed, or non-http URLs. Pure module — runs only in the
background SW.
'@
```

---

## Task 3: `resolve-image.js` — TDD pure module

**Files:**
- Create: `src/lib/resolve-image.js`
- Create: `test/resolve-image.test.js`
- Modify: `test/fixtures.js` (add HTML snippets)
- Modify: `test/test.html` (add import)

- [ ] **Step 1: Add HTML fixtures**

Replace `test/fixtures.js` with:
```js
// HTML snippets parsed by tests via new DOMParser().parseFromString(...).
export const imgHtml = `
  <div id="root">
    <img id="hero" src="https://example.com/hero.jpg" alt="">
  </div>`;

// Note: in a parsed-but-not-rendered document, currentSrc is empty until
// the image loads. Tests of currentSrc preference operate on the live
// test page (created dynamically) rather than the parsed fixture.

export const pictureHtml = `
  <div id="root">
    <picture id="pic">
      <source srcset="https://example.com/large.webp" type="image/webp">
      <source srcset="https://example.com/large.jpg" type="image/jpeg">
      <img src="https://example.com/fallback.jpg" alt="">
    </picture>
  </div>`;

export const sourceHtml = pictureHtml; // tests grab the first <source>

export const emptyImgHtml = `
  <div id="root">
    <img id="empty" alt="">
  </div>`;
```

- [ ] **Step 2: Write the failing tests**

`test/resolve-image.test.js`:
```js
import { test, eq } from "./harness.js";
import { resolveImageUrl } from "../src/lib/resolve-image.js";
import { imgHtml, pictureHtml, emptyImgHtml } from "./fixtures.js";

function parse(html) {
  return new DOMParser().parseFromString(html, "text/html");
}

test("resolve: null input returns null", () => {
  eq(resolveImageUrl(null), null);
});
test("resolve: undefined input returns null", () => {
  eq(resolveImageUrl(undefined), null);
});
test("resolve: <img> with src returns src", () => {
  const doc = parse(imgHtml);
  eq(resolveImageUrl(doc.getElementById("hero")), "https://example.com/hero.jpg");
});
test("resolve: <img> with no src returns null", () => {
  const doc = parse(emptyImgHtml);
  eq(resolveImageUrl(doc.getElementById("empty")), null);
});
test("resolve: <img> with srcset prefers currentSrc when set", () => {
  // Build a live <img> with currentSrc populated by attaching to the document.
  const img = document.createElement("img");
  img.src = "https://example.com/small.jpg";
  // currentSrc reflects what the UA picked. In a JSDOM-free real browser
  // it equals src once src is set on an attached img element.
  document.body.appendChild(img);
  // Force layout / resource resolution.
  void img.currentSrc;
  eq(resolveImageUrl(img), img.currentSrc || "https://example.com/small.jpg");
  document.body.removeChild(img);
});
test("resolve: <picture> reads inner <img>", () => {
  const doc = parse(pictureHtml);
  eq(resolveImageUrl(doc.getElementById("pic")), "https://example.com/fallback.jpg");
});
test("resolve: <source> walks back to its <picture>'s <img>", () => {
  const doc = parse(pictureHtml);
  const source = doc.querySelector("source");
  eq(resolveImageUrl(source), "https://example.com/fallback.jpg");
});
test("resolve: <div> returns null", () => {
  const doc = parse(imgHtml);
  eq(resolveImageUrl(doc.getElementById("root")), null);
});
test("resolve: detached <source> with no parent <picture> returns null", () => {
  const orphan = document.createElement("source");
  eq(resolveImageUrl(orphan), null);
});
```

- [ ] **Step 3: Wire the test file into `test/test.html`**

Add inside the `<script type="module">` block, before `await run();`:
```js
    import "./resolve-image.test.js";
```

- [ ] **Step 4: Run the harness — expect failures**

Hard-reload. Expected: module-resolution error for `../src/lib/resolve-image.js`.

- [ ] **Step 5: Implement `src/lib/resolve-image.js`**

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

- [ ] **Step 6: Re-run the harness — verify all green**

Expected: total grows by 9 (now ~19 passed, 0 failed).

- [ ] **Step 7: Commit**

```powershell
git add src/lib/resolve-image.js test/resolve-image.test.js test/fixtures.js test/test.html
git commit -m @'
feat(lib): add resolveImageUrl + tests

Resolves <img>/<picture>/<source> to a URL, preferring currentSrc
over src. Listed in manifest.web_accessible_resources in Task 9 so
the in-page extractor can dynamically import it.
'@
```

---

## Task 4: `engine.js` — `createEngine` + `scan()` (TDD with chrome shim)

**Files:**
- Create: `src/lib/engine.js`
- Create: `test/engine.test.js`
- Modify: `test/fixtures.js` (add chrome shim factory)
- Modify: `test/test.html` (add import)

- [ ] **Step 1: Extend `test/fixtures.js` with a chrome shim factory**

Append to `test/fixtures.js`:
```js
// In-memory chrome.* shim. Tests configure it before invoking the engine.
//
// Helpers (underscored) let tests stage tab state, script results, and
// fire download events.
export function makeChromeShim() {
  const tabs = new Map();              // tabId -> { id, url, title, pinned }
  const scriptResults = new Map();     // tabId -> { value } | { throws }
  let downloadCounter = 0;
  const downloads = [];                // { id, url, filename, conflictAction, saveAs }
  const downloadListeners = new Set();
  const broadcasts = [];               // captured by tests via shim.broadcast
  const local = {};
  const session = {};

  const shim = {
    tabs: {
      query: async (opts) => Array.from(tabs.values()).filter((t) => {
        if (opts.pinned !== undefined && t.pinned !== opts.pinned) return false;
        if (opts.currentWindow !== undefined && opts.currentWindow && t.otherWindow) return false;
        return true;
      }),
      get: async (tabId) => {
        const t = tabs.get(tabId);
        if (!t) throw new Error(`No tab with id: ${tabId}`);
        return t;
      },
      remove: async (tabId) => { tabs.delete(tabId); },
    },
    scripting: {
      executeScript: async ({ target }) => {
        const r = scriptResults.get(target.tabId);
        if (!r) throw new Error(`no script result staged for tab ${target.tabId}`);
        if (r.throws) throw r.throws;
        return [{ result: r.value }];
      },
    },
    downloads: {
      download: async (opts) => {
        const id = ++downloadCounter;
        downloads.push({ id, ...opts });
        return id;
      },
      onChanged: {
        addListener: (fn) => downloadListeners.add(fn),
        removeListener: (fn) => downloadListeners.delete(fn),
      },
    },
    storage: {
      local: {
        get: async (key) => {
          if (key == null) return { ...local };
          if (Array.isArray(key)) return Object.fromEntries(key.map((k) => [k, local[k]]));
          if (typeof key === "object") return Object.fromEntries(Object.keys(key).map((k) => [k, local[k] ?? key[k]]));
          return { [key]: local[key] };
        },
        set: async (obj) => { Object.assign(local, obj); },
      },
      session: {
        get: async (key) => {
          if (key == null) return { ...session };
          if (Array.isArray(key)) return Object.fromEntries(key.map((k) => [k, session[k]]));
          return { [key]: session[key] };
        },
        set: async (obj) => { Object.assign(session, obj); },
        remove: async (key) => { delete session[key]; },
      },
    },
    runtime: {
      sendMessage: async (msg) => { broadcasts.push(msg); },
      getURL: (path) => `chrome-extension://test/${path}`,
    },
    // Test helpers (not part of real chrome API).
    _setTab(t) { tabs.set(t.id, t); },
    _setScriptResult(tabId, value) { scriptResults.set(tabId, { value }); },
    _setScriptThrows(tabId, err) { scriptResults.set(tabId, { throws: err }); },
    _fireDownloadComplete(id) {
      for (const fn of downloadListeners) fn({ id, state: { current: "complete" } });
    },
    _fireDownloadInterrupted(id, error = "NETWORK_FAILED") {
      for (const fn of downloadListeners) fn({ id, state: { current: "interrupted" }, error: { current: error } });
    },
    _broadcasts: broadcasts,
    _downloads: downloads,
    _tabsRemaining: () => Array.from(tabs.keys()),
    _local: local,
    _session: session,
  };
  return shim;
}
```

- [ ] **Step 2: Write the failing tests for `scan`**

`test/engine.test.js`:
```js
import { test, eq, ok } from "./harness.js";
import { createEngine } from "../src/lib/engine.js";
import { makeChromeShim } from "./fixtures.js";

test("scan: queries non-pinned tabs in current window, runs selector test per tab", async () => {
  const chrome = makeChromeShim();
  chrome._setTab({ id: 1, url: "https://a.example/", title: "A", pinned: false });
  chrome._setTab({ id: 2, url: "https://b.example/", title: "B", pinned: false });
  chrome._setScriptResult(1, { matched: true });
  chrome._setScriptResult(2, { matched: false });

  const engine = createEngine({ chrome, broadcast: () => {} });
  const tabs = await engine.scan({ selector: "img.hero" });

  eq(tabs, [
    { tabId: 1, matched: true,  url: "https://a.example/", title: "A" },
    { tabId: 2, matched: false, url: "https://b.example/", title: "B" },
  ]);
});

test("scan: executeScript rejection becomes matched=false (inaccessible at preview)", async () => {
  const chrome = makeChromeShim();
  chrome._setTab({ id: 1, url: "chrome://settings", title: "Settings", pinned: false });
  chrome._setScriptThrows(1, new Error("Cannot access contents of url"));

  const engine = createEngine({ chrome, broadcast: () => {} });
  const tabs = await engine.scan({ selector: "img" });

  eq(tabs.length, 1);
  eq(tabs[0].matched, false);
});

test("scan: pinned tabs are excluded by the shim's query filter", async () => {
  const chrome = makeChromeShim();
  chrome._setTab({ id: 1, url: "https://a.example/", title: "A", pinned: false });
  chrome._setTab({ id: 2, url: "https://b.example/", title: "B", pinned: true });
  chrome._setScriptResult(1, { matched: true });
  // tab 2 must never be invoked — no script staged.

  const engine = createEngine({ chrome, broadcast: () => {} });
  const tabs = await engine.scan({ selector: "img" });

  eq(tabs.map((t) => t.tabId), [1]);
});
```

- [ ] **Step 3: Wire `engine.test.js` into `test/test.html`**

Add inside the `<script type="module">` block, before `await run();`:
```js
    import "./engine.test.js";
```

- [ ] **Step 4: Run the harness — expect failures**

Expected: module-resolution error for `../src/lib/engine.js`.

- [ ] **Step 5: Implement the engine's `scan` (minimum to pass)**

`src/lib/engine.js`:
```js
import { filenameFromUrl } from "./filename.js";

export function createEngine({ chrome, broadcast }) {
  let state = { status: "idle", total: 0, processed: 0, results: [] };

  async function scan({ selector }) {
    const tabs = await chrome.tabs.query({ currentWindow: true, pinned: false });
    const out = [];
    for (const t of tabs) {
      let matched = false;
      try {
        const [{ result }] = await chrome.scripting.executeScript({
          target: { tabId: t.id },
          func: (sel) => ({ matched: !!document.querySelector(sel) }),
          args: [selector],
        });
        matched = !!(result && result.matched);
      } catch {
        matched = false;
      }
      out.push({ tabId: t.id, matched, url: t.url, title: t.title });
    }
    return out;
  }

  // runBatch + handleDownloadChanged added in Task 5.
  async function runBatch() { throw new Error("not implemented yet"); }
  function handleDownloadChanged() {}
  function getState() { return state; }

  return { scan, runBatch, handleDownloadChanged, getState };
}
```

- [ ] **Step 6: Re-run the harness — verify the three new tests pass**

Expected: total grows by 3 (now ~22 passed, 0 failed).

- [ ] **Step 7: Commit**

```powershell
git add src/lib/engine.js test/engine.test.js test/fixtures.js test/test.html
git commit -m @'
feat(lib): engine factory + scan() with chrome shim tests

createEngine returns scan/runBatch/handleDownloadChanged/getState.
Only scan is implemented here; runBatch + the download state machine
land in the next task. Tests use an in-memory chrome shim that
configures tab list, executeScript outcomes, and download events.
'@
```

---

## Task 5: `engine.js` — `runBatch()` + `handleDownloadChanged()` (TDD)

This is the most logic-heavy task. The engine drives a serial per-tab state machine: extract → download → wait for `onChanged` → close tab on `complete` (leave open on `interrupted`). A single `handleDownloadChanged` entrypoint serves both the in-flight Promise and the SW-restart recovery path via `chrome.storage.session`.

**Files:**
- Modify: `src/lib/engine.js`
- Modify: `test/engine.test.js`

- [ ] **Step 1: Write failing tests for `runBatch` happy path**

Append to `test/engine.test.js`:
```js
function asyncTick() { return new Promise((r) => setTimeout(r, 0)); }

test("runBatch: single tab, image resolves, download completes -> saved + tab closed", async () => {
  const chrome = makeChromeShim();
  chrome._setTab({ id: 1, url: "https://a.example/", title: "A", pinned: false });
  chrome._setScriptResult(1, "https://a.example/photo.jpg");

  const engine = createEngine({ chrome, broadcast: () => {} });
  const runPromise = engine.runBatch({
    tabIds: [1], selector: "img.hero", subfolder: "tir",
  });

  // Let the download be issued, then fire complete.
  await asyncTick();
  chrome._fireDownloadComplete(1);
  await runPromise;

  const s = engine.getState();
  eq(s.status, "done");
  eq(s.results.length, 1);
  eq(s.results[0].status, "saved");
  eq(s.results[0].filename, "photo.jpg");
  eq(s.results[0].url, "https://a.example/");   // url+title come from tabs.get
  eq(s.results[0].title, "A");
  eq(chrome._tabsRemaining(), []); // tab was closed
  eq(chrome._downloads[0].filename, "tir/photo.jpg");
  eq(chrome._downloads[0].conflictAction, "uniquify");
});

test("runBatch: extractor returns null -> no-image-url, tab left open, no download", async () => {
  const chrome = makeChromeShim();
  chrome._setTab({ id: 1, url: "https://a.example/", title: "A", pinned: false });
  chrome._setScriptResult(1, null);

  const engine = createEngine({ chrome, broadcast: () => {} });
  await engine.runBatch({ tabIds: [1], selector: "div", subfolder: "tir" });

  const s = engine.getState();
  eq(s.results[0].status, "no-image-url");
  eq(chrome._tabsRemaining(), [1]); // tab remains
  eq(chrome._downloads.length, 0);
});

test("runBatch: extractor throws -> inaccessible, tab left open", async () => {
  const chrome = makeChromeShim();
  chrome._setTab({ id: 1, url: "chrome://settings", title: "Settings", pinned: false });
  chrome._setScriptThrows(1, new Error("Cannot access"));

  const engine = createEngine({ chrome, broadcast: () => {} });
  await engine.runBatch({ tabIds: [1], selector: "img", subfolder: "tir" });

  const s = engine.getState();
  eq(s.results[0].status, "inaccessible");
  ok(s.results[0].error.includes("Cannot access"));
  eq(chrome._tabsRemaining(), [1]);
});

test("runBatch: download interrupted -> save-failed, tab left open", async () => {
  const chrome = makeChromeShim();
  chrome._setTab({ id: 1, url: "https://a.example/", title: "A", pinned: false });
  chrome._setScriptResult(1, "https://a.example/photo.jpg");

  const engine = createEngine({ chrome, broadcast: () => {} });
  const runPromise = engine.runBatch({ tabIds: [1], selector: "img", subfolder: "tir" });
  await asyncTick();
  chrome._fireDownloadInterrupted(1, "SERVER_FAILED");
  await runPromise;

  const s = engine.getState();
  eq(s.results[0].status, "save-failed");
  eq(s.results[0].error, "SERVER_FAILED");
  eq(chrome._tabsRemaining(), [1]);
});

test("runBatch: serial — second tab waits for first download to settle", async () => {
  const chrome = makeChromeShim();
  chrome._setTab({ id: 1, url: "https://a.example/", title: "A", pinned: false });
  chrome._setTab({ id: 2, url: "https://b.example/", title: "B", pinned: false });
  chrome._setScriptResult(1, "https://a.example/a.jpg");
  chrome._setScriptResult(2, "https://b.example/b.jpg");

  const engine = createEngine({ chrome, broadcast: () => {} });
  const runPromise = engine.runBatch({ tabIds: [1, 2], selector: "img", subfolder: "tir" });

  // After one tick, only the first download should be issued.
  await asyncTick();
  eq(chrome._downloads.length, 1);
  eq(chrome._downloads[0].id, 1);

  chrome._fireDownloadComplete(1);
  await asyncTick();
  eq(chrome._downloads.length, 2);
  eq(chrome._downloads[1].id, 2);

  chrome._fireDownloadComplete(2);
  await runPromise;

  const s = engine.getState();
  eq(s.results.map((r) => r.status), ["saved", "saved"]);
});

test("runBatch: emits progress broadcast after each tab", async () => {
  const chrome = makeChromeShim();
  chrome._setTab({ id: 1, url: "https://a.example/", title: "A", pinned: false });
  chrome._setScriptResult(1, "https://a.example/photo.jpg");

  const broadcasts = [];
  const engine = createEngine({ chrome, broadcast: (m) => broadcasts.push(m) });
  const runPromise = engine.runBatch({ tabIds: [1], selector: "img", subfolder: "tir" });
  await asyncTick();
  chrome._fireDownloadComplete(1);
  await runPromise;

  const types = broadcasts.map((b) => b.type);
  ok(types.includes("progress"));
  ok(types.includes("done"));
  const done = broadcasts.find((b) => b.type === "done");
  eq(done.results.length, 1);
});

test("runBatch: writes a session record per download and clears it on settle", async () => {
  const chrome = makeChromeShim();
  chrome._setTab({ id: 1, url: "https://a.example/", title: "A", pinned: false });
  chrome._setScriptResult(1, "https://a.example/photo.jpg");

  const engine = createEngine({ chrome, broadcast: () => {} });
  const runPromise = engine.runBatch({ tabIds: [1], selector: "img", subfolder: "tir" });

  await asyncTick();
  // Session record should exist while the download is in flight.
  ok(chrome._session["downloads.1"]);
  eq(chrome._session["downloads.1"].tabId, 1);

  chrome._fireDownloadComplete(1);
  await runPromise;

  // Cleared after the download settles.
  eq(chrome._session["downloads.1"], undefined);
});

test("handleDownloadChanged: SW-restart recovery — uses session record to close tab", async () => {
  // Simulate: engine was created fresh (no pending), but a session record
  // remains from a previous SW lifetime. A 'complete' delta must close
  // the recorded tab and clear the record.
  const chrome = makeChromeShim();
  chrome._setTab({ id: 7, url: "https://x.example/", title: "X", pinned: false });
  await chrome.storage.session.set({
    "downloads.42": { downloadId: 42, tabId: 7, tabUrl: "https://x.example/", tabTitle: "X" },
  });

  const engine = createEngine({ chrome, broadcast: () => {} });
  await engine.handleDownloadChanged({ id: 42, state: { current: "complete" } });

  eq(chrome._tabsRemaining(), []); // tab closed
  eq(chrome._session["downloads.42"], undefined); // record cleared
});

test("handleDownloadChanged: SW-restart, interrupted -> tab stays, record cleared", async () => {
  const chrome = makeChromeShim();
  chrome._setTab({ id: 7, url: "https://x.example/", title: "X", pinned: false });
  await chrome.storage.session.set({
    "downloads.42": { downloadId: 42, tabId: 7, tabUrl: "https://x.example/", tabTitle: "X" },
  });

  const engine = createEngine({ chrome, broadcast: () => {} });
  await engine.handleDownloadChanged({
    id: 42, state: { current: "interrupted" }, error: { current: "NETWORK_FAILED" },
  });

  eq(chrome._tabsRemaining(), [7]); // tab still there
  eq(chrome._session["downloads.42"], undefined); // record cleared
});
```

- [ ] **Step 2: Run the harness — expect the new tests to fail**

Expected: the new `runBatch`/`handleDownloadChanged` tests fail (`runBatch` currently throws "not implemented yet"); earlier tests still pass.

- [ ] **Step 3: Implement `runBatch` + `handleDownloadChanged`**

Replace `src/lib/engine.js` with:
```js
import { filenameFromUrl } from "./filename.js";

const RESOLVE_IMAGE_PATH = "src/lib/resolve-image.js";

export function createEngine({ chrome, broadcast }) {
  let state = { status: "idle", total: 0, processed: 0, results: [] };
  const pending = new Map(); // downloadId -> { resolve }

  async function scan({ selector }) {
    const tabs = await chrome.tabs.query({ currentWindow: true, pinned: false });
    const out = [];
    for (const t of tabs) {
      let matched = false;
      try {
        const [{ result }] = await chrome.scripting.executeScript({
          target: { tabId: t.id },
          func: (sel) => ({ matched: !!document.querySelector(sel) }),
          args: [selector],
        });
        matched = !!(result && result.matched);
      } catch {
        matched = false;
      }
      out.push({ tabId: t.id, matched, url: t.url, title: t.title });
    }
    return out;
  }

  async function extractImageUrl(tabId, selector) {
    // In real Chrome, executeScript runs the injected function in the page.
    // The function dynamically imports resolve-image.js (declared in
    // web_accessible_resources) and applies it to the matched element.
    // The shim doesn't actually run the function — it returns the pre-staged
    // value from _setScriptResult.
    const [{ result }] = await chrome.scripting.executeScript({
      target: { tabId },
      func: async (sel, resolveImagePath) => {
        const url = chrome.runtime.getURL(resolveImagePath);
        const { resolveImageUrl } = await import(url);
        const el = document.querySelector(sel);
        return resolveImageUrl(el);
      },
      args: [selector, RESOLVE_IMAGE_PATH],
    });
    return result;
  }

  function pushResult(r) {
    state.results.push(r);
    state.processed = state.results.length;
    safeBroadcast({ type: "progress", processed: state.processed, total: state.total, lastResult: r });
  }

  function safeBroadcast(msg) {
    try { broadcast(msg); } catch { /* popup may not be listening */ }
  }

  async function tabInfo(tabId) {
    try {
      const t = await chrome.tabs.get(tabId);
      return { url: t.url || "", title: t.title || "" };
    } catch {
      return { url: "", title: "" };
    }
  }

  async function processTab(tabId, selector, subfolder) {
    const info = await tabInfo(tabId);
    let imageUrl = null;
    try {
      imageUrl = await extractImageUrl(tabId, selector);
    } catch (err) {
      pushResult({ tabId, ...info, status: "inaccessible", error: String(err.message || err) });
      return;
    }
    if (!imageUrl) {
      pushResult({ tabId, ...info, status: "no-image-url" });
      return;
    }
    const filename = filenameFromUrl(imageUrl);
    const downloadId = await chrome.downloads.download({
      url: imageUrl,
      filename: `${subfolder}/${filename}`,
      conflictAction: "uniquify",
      saveAs: false,
    });
    await chrome.storage.session.set({
      [`downloads.${downloadId}`]: { downloadId, tabId, tabUrl: info.url, tabTitle: info.title },
    });

    const outcome = await new Promise((resolve) => {
      pending.set(downloadId, { resolve });
    });

    await chrome.storage.session.remove(`downloads.${downloadId}`);

    if (outcome.ok) {
      try { await chrome.tabs.remove(tabId); } catch { /* tab already gone */ }
      pushResult({ tabId, ...info, status: "saved", imageUrl, filename });
    } else {
      pushResult({ tabId, ...info, status: "save-failed", imageUrl, filename, error: outcome.error });
    }
  }

  async function runBatch({ tabIds, selector, subfolder }) {
    state = { status: "running", total: tabIds.length, processed: 0, results: [] };
    for (const tabId of tabIds) {
      await processTab(tabId, selector, subfolder);
    }
    state.status = "done";
    safeBroadcast({ type: "done", results: state.results });
  }

  async function handleDownloadChanged(delta) {
    if (!delta || !delta.state) return;
    const id = delta.id;
    const current = delta.state.current;
    if (current !== "complete" && current !== "interrupted") return;

    if (pending.has(id)) {
      const p = pending.get(id);
      pending.delete(id);
      if (current === "complete") p.resolve({ ok: true });
      else p.resolve({ ok: false, error: delta.error?.current || "interrupted" });
      return;
    }

    // SW-restart recovery path.
    const key = `downloads.${id}`;
    const rec = (await chrome.storage.session.get(key))[key];
    if (!rec) return;
    if (current === "complete") {
      try { await chrome.tabs.remove(rec.tabId); } catch { /* gone */ }
    }
    await chrome.storage.session.remove(key);
  }

  function getState() { return state; }

  return { scan, runBatch, handleDownloadChanged, getState };
}
```

- [ ] **Step 4: Wire the `handleDownloadChanged` bridge inside `runBatch`**

The shim test fires events directly into the listeners registered on `chrome.downloads.onChanged`. In production, `background.js` adds a single module-top listener that calls `engine.handleDownloadChanged`. For tests to exercise the same path, the engine must register that listener itself when created. Update `createEngine` to register the listener:

Replace the top of `createEngine` so that immediately after declaring `pending`, it registers:
```js
  chrome.downloads.onChanged.addListener((delta) => {
    handleDownloadChanged(delta);
  });
```

(Place this **after** `handleDownloadChanged` is declared, or use a forwarding wrapper. Simplest: declare the wrapper at the end of the function body, just before the `return`, so all closures are in scope.)

The final shape inside `createEngine`:
```js
  // ...all functions declared above...
  chrome.downloads.onChanged.addListener((delta) => { handleDownloadChanged(delta); });
  return { scan, runBatch, handleDownloadChanged, getState };
```

Note: production `background.js` will **not** register a second listener — it will let the engine own that registration. This keeps the test path and the production path identical.

- [ ] **Step 5: Re-run the harness — verify everything is green**

Expected: all engine tests pass (`runBatch` + recovery). Total ~31 passed, 0 failed.

- [ ] **Step 6: Commit**

```powershell
git add src/lib/engine.js test/engine.test.js
git commit -m @'
feat(lib): engine runBatch + SW-restart recovery

Per-tab serial state machine: extract image URL via executeScript,
issue download with conflictAction "uniquify", await onChanged via a
pending-map Promise, close tab on complete or surface save-failed on
interrupted. handleDownloadChanged also serves the SW-restart path
via chrome.storage.session records keyed by downloadId.
'@
```

---

## Task 6: `background.js` — wire real `chrome.*` to the engine

This task has no unit tests (chrome APIs aren't testable from the harness); verification is by loading the extension and opening the SW devtools console.

**Files:**
- Modify: `src/background.js`

- [ ] **Step 1: Replace `src/background.js` with the wiring**

```js
import { createEngine } from "./lib/engine.js";

const DEFAULT_SELECTOR = "img";
const DEFAULT_SUBFOLDER = "tab-image-reaper";

const engine = createEngine({
  chrome,
  broadcast: (msg) => {
    // No recipient — Chrome routes to any listening extension page.
    // Catch the "no receiver" rejection that happens when the popup is closed.
    chrome.runtime.sendMessage(msg).catch(() => {});
  },
});

// engine.handleDownloadChanged is already wired inside createEngine().
// Do NOT add a second downloads.onChanged listener here.

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  handle(msg).then(sendResponse).catch((err) => {
    sendResponse({ error: String(err?.message || err) });
  });
  return true; // keep the message channel open for the async response
});

async function handle(msg) {
  if (!msg || !msg.type) return { error: "missing type" };
  switch (msg.type) {
    case "scan": {
      const { selector = DEFAULT_SELECTOR } = await chrome.storage.local.get({ selector: DEFAULT_SELECTOR });
      const tabs = await engine.scan({ selector });
      return { tabs };
    }
    case "saveConfig": {
      const { selector, subfolder } = msg;
      await chrome.storage.local.set({ selector, subfolder });
      return { ok: true };
    }
    case "run": {
      const { selector = DEFAULT_SELECTOR, subfolder = DEFAULT_SUBFOLDER } =
        await chrome.storage.local.get({ selector: DEFAULT_SELECTOR, subfolder: DEFAULT_SUBFOLDER });
      // Fire-and-forget — caller gets an ack, progress flows via broadcasts.
      engine.runBatch({ tabIds: msg.tabIds, selector, subfolder });
      return { ack: true };
    }
    case "getStatus": {
      return engine.getState();
    }
    default:
      return { error: `unknown type: ${msg.type}` };
  }
}
```

- [ ] **Step 2: Manual verify the SW boots without errors**

1. Open `chrome://extensions`, enable Developer Mode, click "Load unpacked", select `c:\wamp64\www\tab-image-reaper`.
2. The extension card should appear with no red error banner.
3. Click "service worker" under the card to open the SW devtools console.
4. Type `engine` — expected: undefined (it's module-scoped). Type `chrome.runtime.getURL("src/lib/resolve-image.js")` — expected: a string like `chrome-extension://<id>/src/lib/resolve-image.js`.

If the SW shows red errors, fix them before proceeding. Common causes: missing `"type": "module"` (already in manifest), syntax error in `engine.js`, missing import path.

- [ ] **Step 3: Manual smoke — `scan` round-trip**

In the SW devtools console:
```js
chrome.runtime.sendMessage({ type: "scan" }).then(console.log);
```

Expected: `{ tabs: [{ tabId, matched: false, url, title }, ...] }` with one entry per non-pinned tab. `matched` will be `false` everywhere because `permissions` doesn't yet include `scripting`/`tabs`/`<all_urls>` — that's intentional; Task 9 finalizes the manifest. You're verifying the message channel here, not the scan result.

- [ ] **Step 4: Commit**

```powershell
git add src/background.js
git commit -m @'
feat(background): wire real chrome APIs to engine

Single-handler runtime.onMessage dispatches scan/saveConfig/run/getStatus.
Broadcasts flow through engine.broadcast -> chrome.runtime.sendMessage
with the no-receiver rejection swallowed. engine owns the
downloads.onChanged listener (registered inside createEngine).
'@
```

---

## Task 7: Popup HTML + CSS (brand tokens, layout, status pills)

**Files:**
- Modify: `src/popup/popup.html`
- Modify: `src/popup/popup.css`

- [ ] **Step 1: Replace `src/popup/popup.html` with the structure**

```html
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>Tab Image Reaper</title>
  <link rel="stylesheet" href="popup.css" />
</head>
<body>
  <main class="tir-card">
    <div class="tir-eyebrow">&lt;/&gt; tab image reaper</div>

    <label class="tir-field">
      <span class="tir-label">selector</span>
      <input id="selector" type="text" spellcheck="false" autocomplete="off" />
    </label>

    <label class="tir-field">
      <span class="tir-label">subfolder</span>
      <input id="subfolder" type="text" spellcheck="false" autocomplete="off" />
    </label>

    <div class="tir-headline">
      <strong id="match-count" class="tir-grad-text">0</strong>
      <span> of <span id="total-count">0</span> tabs match</span>
    </div>

    <button id="run" class="tir-run" type="button" disabled>Run</button>

    <ul id="results" class="tir-results" aria-live="polite"></ul>
  </main>
  <script type="module" src="popup.js"></script>
</body>
</html>
```

- [ ] **Step 2: Replace `src/popup/popup.css` with the full token block + layout**

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

* { box-sizing: border-box; }
html, body { margin: 0; }
body {
  background: var(--tir-bg);
  color: var(--tir-fg);
  font-family: var(--tir-font-sans);
  min-width: 360px;
}

.tir-card {
  width: 360px;
  padding: 16px;
  background: var(--tir-grad-card);
  border-radius: var(--tir-radius-card);
}

.tir-eyebrow {
  font-family: var(--tir-font-mono);
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--tir-primary-soft);
  font-size: 11px;
  margin-bottom: 12px;
}

.tir-field { display: block; margin-bottom: 10px; }
.tir-label {
  display: block;
  font-size: 11px;
  color: var(--tir-muted);
  margin-bottom: 4px;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}
.tir-field input {
  width: 100%;
  padding: 8px 10px;
  background: var(--tir-surface-deep);
  border: 1px solid var(--tir-subtle);
  border-radius: var(--tir-radius-input);
  color: var(--tir-fg);
  font-family: var(--tir-font-mono);
  font-size: 13px;
  transition: border-color var(--tir-duration) var(--tir-ease),
              box-shadow var(--tir-duration) var(--tir-ease);
}
.tir-field input:focus {
  outline: none;
  border-color: var(--tir-primary);
  box-shadow: var(--tir-glow-blue);
}

.tir-headline {
  margin: 14px 0 10px;
  font-size: 15px;
  color: var(--tir-muted);
}
.tir-headline strong { font-size: 22px; color: var(--tir-fg); }

.tir-grad-text {
  background: var(--tir-grad-brand);
  -webkit-background-clip: text;
  background-clip: text;
  -webkit-text-fill-color: transparent;
  color: var(--tir-primary-soft); /* fallback */
}

.tir-run {
  display: block;
  width: 100%;
  padding: 10px 14px;
  border: none;
  border-radius: var(--tir-radius-pill);
  background: var(--tir-grad-brand);
  color: white;
  font-weight: 600;
  font-size: 14px;
  cursor: pointer;
  transition: transform var(--tir-duration) var(--tir-ease),
              box-shadow var(--tir-duration) var(--tir-ease),
              filter var(--tir-duration) var(--tir-ease);
}
.tir-run:hover:not(:disabled) {
  transform: translateY(-2px);
  box-shadow: var(--tir-glow-violet);
}
.tir-run:focus-visible {
  outline: 2px solid var(--tir-primary-soft);
  outline-offset: 2px;
}
.tir-run:disabled {
  filter: grayscale(0.6) brightness(0.7);
  cursor: not-allowed;
}

.tir-results {
  list-style: none;
  margin: 14px 0 0;
  padding: 0;
  max-height: 320px;
  overflow-y: auto;
  scrollbar-width: thin;
  scrollbar-color: var(--tir-subtle) var(--tir-surface-deep);
}
.tir-result {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 8px 10px;
  padding: 8px 10px;
  margin-bottom: 6px;
  background: var(--tir-surface);
  border: 1px solid var(--tir-subtle);
  border-radius: var(--tir-radius-input);
  transition: transform var(--tir-duration) var(--tir-ease),
              border-color var(--tir-duration) var(--tir-ease),
              box-shadow var(--tir-duration) var(--tir-ease);
}
.tir-result:hover {
  transform: translateY(-2px);
  border-color: var(--tir-primary);
  box-shadow: var(--tir-glow-blue);
}
.tir-pill {
  width: 10px;
  height: 10px;
  border-radius: 999px;
  align-self: center;
}
.tir-pill[data-status="saved"]        { background: var(--tir-ok);        box-shadow: 0 0 0 4px rgba(34,197,94,.18); }
.tir-pill[data-status="save-failed"]  { background: var(--tir-hot);       box-shadow: 0 0 0 4px rgba(244,63,94,.18); }
.tir-pill[data-status="no-image-url"] { background: var(--tir-highlight); box-shadow: 0 0 0 4px rgba(250,204,21,.18); }
.tir-pill[data-status="inaccessible"] { background: var(--tir-highlight); box-shadow: 0 0 0 4px rgba(250,204,21,.18); }

.tir-result-title {
  font-size: 13px;
  color: var(--tir-fg);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.tir-result-url {
  grid-column: 2;
  font-size: 11px;
  color: var(--tir-muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-family: var(--tir-font-mono);
}
.tir-result-error {
  grid-column: 2;
  font-size: 11px;
  color: var(--tir-hot);
  font-family: var(--tir-font-mono);
}
.tir-result-note {
  grid-column: 2;
  font-size: 11px;
  color: var(--tir-ok);
  font-family: var(--tir-font-mono);
}

.tir-toast {
  margin-top: 10px;
  padding: 8px 10px;
  background: var(--tir-surface);
  border: 1px solid var(--tir-highlight);
  border-radius: var(--tir-radius-input);
  font-size: 12px;
  color: var(--tir-highlight);
}

@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after { transition: none !important; }
  .tir-run:hover:not(:disabled), .tir-result:hover { transform: none; }
}
@media (forced-colors: active) {
  .tir-grad-text {
    background: none;
    -webkit-text-fill-color: var(--tir-primary-soft);
    color: var(--tir-primary-soft);
  }
}
```

- [ ] **Step 2.5: Visual sanity check**

Open `src/popup/popup.html` directly in Chrome (`file:///c:/wamp64/www/tab-image-reaper/src/popup/popup.html`).
Expected: dark card, blue eyebrow label, two text inputs (empty), "0 of 0 tabs match" headline, disabled "Run" button below. No console errors (popup.js is still empty at this point). Resize the window — the card stays 360px wide.

- [ ] **Step 3: Commit**

```powershell
git add src/popup/popup.html src/popup/popup.css
git commit -m @'
feat(popup): brand-token CSS + structural HTML

--tir-* token block mirrors bimbi-stocker's --bs-* layer, sourced
from the dariobimbi.com palette. Layout covers selector/subfolder
inputs, gradient match-count headline, pill Run button, results
list with status pills, and reduced-motion / forced-colors carve-outs.
'@
```

---

## Task 8: Popup JS — scan-on-open, edit-and-save, Run, live progress, results

**Files:**
- Modify: `src/popup/popup.js`

- [ ] **Step 1: Replace `src/popup/popup.js`**

```js
const DEFAULT_SELECTOR = "img";
const DEFAULT_SUBFOLDER = "tab-image-reaper";

const $selector  = document.getElementById("selector");
const $subfolder = document.getElementById("subfolder");
const $match     = document.getElementById("match-count");
const $total     = document.getElementById("total-count");
const $run       = document.getElementById("run");
const $results   = document.getElementById("results");

let scanTabs = []; // last scan result; informs which tabIds to send on Run.
let running  = false;

init().catch((err) => console.error("[tir] init failed", err));

async function init() {
  const cfg = await chrome.storage.local.get({
    selector: DEFAULT_SELECTOR,
    subfolder: DEFAULT_SUBFOLDER,
  });
  $selector.value  = cfg.selector;
  $subfolder.value = cfg.subfolder;

  $selector.addEventListener("blur", saveConfig);
  $subfolder.addEventListener("blur", saveConfig);
  $selector.addEventListener("change", scan);
  $run.addEventListener("click", runBatch);

  chrome.runtime.onMessage.addListener(onBroadcast);

  // Re-attach to an in-flight run, if any.
  const status = await sendMessage({ type: "getStatus" });
  if (status && status.status === "running") {
    running = true;
    setRunButton();
    renderResults(status.results);
  }

  await scan();
}

async function saveConfig() {
  await sendMessage({
    type: "saveConfig",
    selector: $selector.value || DEFAULT_SELECTOR,
    subfolder: $subfolder.value || DEFAULT_SUBFOLDER,
  });
}

async function scan() {
  if (running) return;
  await saveConfig();
  const resp = await sendMessage({ type: "scan" });
  scanTabs = (resp && resp.tabs) || [];
  const matched = scanTabs.filter((t) => t.matched).length;
  $match.textContent = String(matched);
  $total.textContent = String(scanTabs.length);
  $run.disabled = matched === 0;
}

async function runBatch() {
  if (running) return;
  await saveConfig();
  const tabIds = scanTabs.filter((t) => t.matched).map((t) => t.tabId);
  if (tabIds.length === 0) return;
  running = true;
  setRunButton(0, tabIds.length);
  $results.innerHTML = "";
  await sendMessage({ type: "run", tabIds });
}

function onBroadcast(msg) {
  if (!msg || !msg.type) return;
  if (msg.type === "progress") {
    setRunButton(msg.processed, msg.total);
    appendResult(msg.lastResult);
  } else if (msg.type === "done") {
    running = false;
    setRunButton();
    // msg.results already reflects everything appendResult rendered.
  }
}

function setRunButton(processed, total) {
  if (running && total != null) {
    $run.textContent = `Working… (${processed}/${total})`;
    $run.disabled = true;
  } else {
    $run.textContent = "Run";
    const matched = scanTabs.filter((t) => t.matched).length;
    $run.disabled = running || matched === 0;
  }
}

function renderResults(results) {
  $results.innerHTML = "";
  for (const r of results) appendResult(r);
}

function appendResult(r) {
  if (!r) return;
  const li = document.createElement("li");
  li.className = "tir-result";

  const pill = document.createElement("span");
  pill.className = "tir-pill";
  pill.dataset.status = r.status;
  pill.title = labelFor(r.status); // status as accessible tooltip
  li.appendChild(pill);

  const title = document.createElement("div");
  title.className = "tir-result-title";
  title.textContent = r.title || r.url || "(no title)";
  li.appendChild(title);

  const sub = document.createElement("div");
  sub.className = "tir-result-url";
  sub.textContent = r.url || "";
  li.appendChild(sub);

  if (r.status === "saved" && r.filename) {
    const note = document.createElement("div");
    note.className = "tir-result-note";
    note.textContent = `saved → ${r.filename}`;
    li.appendChild(note);
  } else if (r.error) {
    const err = document.createElement("div");
    err.className = "tir-result-error";
    err.textContent = `${labelFor(r.status)} — ${r.error}`;
    li.appendChild(err);
  } else if (r.status !== "saved") {
    const note = document.createElement("div");
    note.className = "tir-result-error";
    note.textContent = labelFor(r.status);
    li.appendChild(note);
  }
  $results.appendChild(li);
}

function labelFor(status) {
  switch (status) {
    case "saved":         return "Saved";
    case "save-failed":   return "Save failed";
    case "no-image-url":  return "No image URL";
    case "inaccessible":  return "Inaccessible";
    default:              return status;
  }
}

function sendMessage(msg) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(msg, (resp) => {
      // Discard chrome.runtime.lastError to avoid console spam if the SW
      // is briefly down — the next user action will retry.
      void chrome.runtime.lastError;
      resolve(resp);
    });
  });
}
```

- [ ] **Step 2: Reload the extension and click the toolbar icon**

1. In `chrome://extensions`, click the reload icon on the Tab Image Reaper card.
2. Click the toolbar icon (you may need to pin it via the puzzle-piece menu).
3. Popup opens with the dark card, current config loaded, "N of M tabs match" populated (N likely 0 until Task 9 grants `scripting`/`tabs`/`host_permissions`).

If the popup shows console errors about `chrome.scripting` being undefined: that's expected — Task 9 fixes it. Move on.

- [ ] **Step 3: Commit**

```powershell
git add src/popup/popup.js
git commit -m @'
feat(popup): wire scan-on-open, edit-and-save, Run, live progress

Reads selector/subfolder from chrome.storage.local; persists on blur
and before each scan/run. Listens for progress/done broadcasts and
renders each result as it lands. Re-attaches to an in-flight run via
getStatus on popup re-open.
'@
```

---

## Task 9: Finalize `manifest.json` (permissions, web_accessible_resources)

**Files:**
- Modify: `manifest.json`

- [ ] **Step 1: Replace `manifest.json` with the final spec-§7 version**

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

- [ ] **Step 2: Reload the extension and verify the permissions prompt fires**

1. In `chrome://extensions`, click the reload icon. Chrome will surface a "Permissions changed" warning — accept it (or remove + re-add the extension if needed).
2. Inspect the extension card — the listed permissions should now include "Read your browsing history" (that's how Chrome describes `<all_urls>` + `tabs`).
3. Open the popup. The match count should now reflect real matches against the open tabs.

- [ ] **Step 3: Quick happy-path verification**

1. Open one tab to any page that has a clearly-identifiable image — e.g. `https://en.wikipedia.org/wiki/Main_Page`.
2. Click the toolbar icon. In the selector input type `img` (the default).
3. The headline should say "1 of N tabs match" (N depending on how many other tabs you have open).
4. Don't click Run yet — Task 11 is the full smoke pass.

- [ ] **Step 4: Commit**

```powershell
git add manifest.json
git commit -m @'
feat(manifest): finalize permissions and web_accessible_resources

scripting/downloads/tabs/storage + host_permissions <all_urls> +
src/lib/resolve-image.js exposed for in-page dynamic import.
'@
```

---

## Task 10: README with manual smoke-test checklist

**Files:**
- Create: `README.md`

- [ ] **Step 1: Write `README.md`**

```markdown
# Tab Image Reaper

A personal-use Manifest V3 Chrome extension that, on toolbar click, saves
the image matching a user-edited CSS selector from each non-pinned tab in
the current window — and closes the tab on successful save.

Mirrors the patterns of [bimbi-stocker](../bimbi-stocker): native ES
modules, no build step, brand tokens, browser-based test harness.

## Install (unpacked)

1. Open `chrome://extensions`, enable **Developer mode** (top-right).
2. Click **Load unpacked**, select `c:\wamp64\www\tab-image-reaper`.
3. Pin the toolbar icon via the puzzle-piece menu.

## Use

1. Click the toolbar icon. The popup shows the current selector and the
   match preview ("N of M tabs match").
2. Edit the selector (and optionally the subfolder under `Downloads/`).
3. Click **Run**. Each matching tab is saved to
   `Downloads/<subfolder>/<original-filename>` and closed on success.
4. Tabs that fail to save stay open with a visible status pill.

## Tests

Browser harness — no Node, no jsdom. WAMP must be running so the harness
is served over HTTP (Chrome blocks ES modules from `file://`).

Open: `http://localhost/tab-image-reaper/test/test.html`

The page renders pass/fail per test and a summary at the top.

## Manual smoke-test checklist

Per spec §11.3. Run these after any change touching the background SW,
the engine, the popup, or the manifest.

- [ ] **Happy path.** Open 5 tabs whose pages contain `<img class="hero">`.
      Set selector to `img.hero`. Preview reads "5 of 5". Run. 5 files
      appear in `Downloads/tab-image-reaper/`; 5 tabs close.
- [ ] **Mixed match.** Open 5 tabs where only 3 have `img.hero`. Preview
      reads "3 of 5". Run. 3 files saved; 3 matching tabs close; 2
      non-matching tabs remain.
- [ ] **Pinned tab safety.** Pin one of the matching tabs. Preview match
      count drops by one. Run. Pinned tab stays pinned and open.
- [ ] **Save failure.** Block the image URL in DevTools → Network. Run.
      Tab stays open. Results list shows `save-failed` pill with the
      reason.
- [ ] **Inaccessible tab.** Have a `chrome://settings` tab open. Run.
      Results list shows `inaccessible` pill. No save attempted.
- [ ] **No-image-url.** Set selector to `body`. Run. Every tab gets
      `no-image-url`. No tabs close.
- [ ] **Collision.** Open 3 tabs of the same image. Run. 3 files saved
      with Chrome's `(1)`, `(2)` suffixes; 3 tabs close.

## Design

- Design spec: [docs/superpowers/specs/2026-05-28-tab-image-reaper-design.md](docs/superpowers/specs/2026-05-28-tab-image-reaper-design.md)
- Implementation plan: [docs/superpowers/plans/2026-05-28-tab-image-reaper-plan.md](docs/superpowers/plans/2026-05-28-tab-image-reaper-plan.md)
- Working-session conventions for AI assistants: [CLAUDE.md](CLAUDE.md)
```

- [ ] **Step 2: Commit**

```powershell
git add README.md
git commit -m @'
docs: README with install steps and manual smoke checklist
'@
```

---

## Task 11: End-to-end manual smoke pass

This is the final acceptance gate. No code is written unless a smoke step fails — in which case, debug, fix, commit, then re-run the failing step.

- [ ] **Step 1: Reload the extension cleanly**

1. In `chrome://extensions`, **Remove** the extension (or reload it).
2. **Load unpacked** → `c:\wamp64\www\tab-image-reaper`.
3. Service worker console (click "service worker" on the card): no red errors.

- [ ] **Step 2: Run smoke tests 1–7 from `README.md`**

Walk through each checklist item. For each, **observe what actually happens** — don't trust assumptions:

- File appeared under `Downloads/tab-image-reaper/`? Check the file manager.
- Tab actually closed? Check the tab strip.
- Pill color matches expectation? Check the popup.
- Error reason populated where expected? Check the popup.

- [ ] **Step 3: Run smoke test 8 (Collision)**

Open 3 tabs of the same image URL. Run. Verify 3 files with `(1)`, `(2)` suffixes from Chrome's `conflictAction: "uniquify"`. All 3 tabs close.

- [ ] **Step 4: SW-termination sanity check**

This isn't in the spec's smoke list but it's the riskiest path. With one matching tab open:
1. Click Run, immediately close the popup.
2. In `chrome://extensions`, click "service worker" → "Stop" to force-terminate the SW mid-download (Chrome will reboot it when the download event fires).
3. Expected: the download still completes; the tab still closes. Re-open the popup — it may show a toast about lost results (acceptable per spec §5.4).

If the tab doesn't close: the recovery path in `engine.handleDownloadChanged` isn't being invoked. Debug by adding a `console.log` at the top of that function and re-running.

- [ ] **Step 5: Commit any fixes that came out of smoke testing**

Use `feat:` / `fix:` prefixes as appropriate. Keep commits small and focused.

- [ ] **Step 6: Final clean commit (no-op if smoke passed clean)**

If smoke passed without changes, no extra commit is needed. Otherwise, ensure the working tree is clean:

```powershell
git status
```

Expected: "nothing to commit, working tree clean".

- [ ] **Step 7: Push to GitHub**

```powershell
git push
```

Expected: "Everything up-to-date" or a fast-forward push log ending with the new HEAD on `origin/main`.

---

## Spec coverage cross-check

| Spec section | Covered by |
|---|---|
| §1.1 What it does | Tasks 6 (background), 8 (popup), 11 (smoke) |
| §1.2 Hard constraints | Applied throughout; flagged in CLAUDE.md |
| §1.3 Non-goals | Plan deliberately omits: retry, history, multi-window, URL patterns, custom templates, non-image elements, dedup, parallel tuning, visual picker |
| §2 Architecture | Tasks 4 (engine), 6 (background), 7–8 (popup) |
| §3 File layout | Task 1 (scaffold), 10 (README) |
| §4.1 Persistent config | Tasks 6 (read/write), 8 (popup edit/save) |
| §4.2 In-memory batch state | Task 5 (`createEngine` state shape) |
| §5.1 Popup-open flow | Tasks 6 (scan handler), 8 (popup init + scan) |
| §5.2 Run flow | Task 5 (engine.runBatch) |
| §5.3 Why serial | Task 5 (serial for-loop, single pending entry per tab) |
| §5.4 SW termination | Task 5 (`handleDownloadChanged` recovery + session records) |
| §5.5 Edit-and-save selector | Task 8 (blur + pre-run saveConfig) |
| §6 Message contract | Task 6 (handlers), Task 8 (senders + listener) |
| §7 Manifest | Task 1 (minimal), Task 9 (final) |
| §8.1 resolveImageUrl | Tasks 3 (impl + tests) |
| §8.2 filenameFromUrl | Task 2 (impl + tests) |
| §9 Status taxonomy | Task 5 (engine pushes all four), Task 7 (pill colors), Task 8 (render) |
| §10.1 Token block | Task 7 |
| §10.2 Layout | Task 7 |
| §10.3 Motion & a11y | Task 7 (carve-outs in CSS) |
| §11.1 Unit tests | Tasks 2 (filename), 3 (resolve-image), 4–5 (engine) |
| §11.2 Untested via shims | Tasks 4–5 cover scan + state machine; §11.2's "not unit-tested" list is genuinely manual |
| §11.3 Manual smoke | Tasks 10 (README checklist), 11 (execution) |
| §12 Implementation phasing | This plan is the authoritative ordering |

---

## Execution handoff

Plan complete and saved to `docs/superpowers/plans/2026-05-28-tab-image-reaper-plan.md`. Two execution options:

**1. Subagent-Driven (recommended)** — A fresh subagent runs each task, two-stage review between tasks. Best for keeping the main session lean and catching regressions early.

**2. Inline Execution** — Tasks executed in this session via `superpowers:executing-plans`, with checkpoints between groups of tasks (e.g. after Task 1, after Task 5, after Task 9, after Task 11). Faster wall-clock; reviews are batched.

Which approach?
