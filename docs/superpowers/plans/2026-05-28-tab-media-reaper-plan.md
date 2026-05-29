# Tab Media Reaper Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Evolve the phase-1 image-only extension into a media reaper that also handles `<video>` / `<source>`-inside-`<video>`, with user toggles for image/video inclusion and a persisted close-tabs option, and complete the user-facing rename from `tab-image-reaper` to `tab-media-reaper`.

**Architecture:** Same two-layer split (popup + background-with-engine), single `chrome.downloads.onChanged` listener registered inside `createEngine`, factory shape preserved. New `src/lib/resolve-video.js` joins `resolve-image.js` in `web_accessible_resources`. Engine gains a `types` parameter on `scan` and `runBatch`, dispatches to the matching resolver via a tagName-aware injected probe, and reads `closeTabs` to gate post-save tab removal. Status taxonomy renames `no-image-url` → `no-media-url`; result rows rename `imageUrl` → `mediaUrl` and gain a `type` field.

**Tech Stack:** Manifest V3, native ES modules, no bundler. Browser test harness mirrored from phase 1 (no Node, no jsdom). All 32 phase-1 tests continue to pass once migrated to the new field names.

**Source of truth:** `docs/superpowers/specs/2026-05-28-tab-media-reaper-design.md`. The phase-1 spec and plan stay in repo as historical record. Hard constraints from §1.2 (no build step, local-only, fail loudly, pinned tabs sacred, no DRM/HLS/evasion) are non-negotiable.

**Starting state:** `main` branch, HEAD at `764eb1a` (icon swap committed), 32 tests passing, repo at `https://github.com/dariobimbi/tab-image-reaper`, local folder at `c:\wamp64\www\tab-image-reaper`. The phase-2 spec is committed at `4e282a7`.

---

## File map (what each file owns after this plan)

| File | Status | Responsibility |
|---|---|---|
| `manifest.json` | Modify (Task 7) | Bump name → "Tab Media Reaper", version → 0.2.0, description, default_title; add `resolve-video.js` to `web_accessible_resources` |
| `src/lib/resolve-image.js` | Unchanged | Phase-1 image resolver (`<img>`/`<picture>`/`<source>`-in-`<picture>`) |
| `src/lib/resolve-video.js` | Create (Task 2) | New pure module: `resolveVideoUrl(el)` for `<video>` / `<source>`-in-`<video>` |
| `src/lib/filename.js` | Unchanged | Phase-1 leaf-filename helper; already handles `.mp4`/`.webm`/`.mov` |
| `src/lib/engine.js` | Modify (Task 3) | `scan` and `runBatch` take `types`; injected probe + extractor dispatch on element tag; result rows gain `type`, rename `imageUrl` → `mediaUrl`, status `no-image-url` → `no-media-url`; `closeTabs` gates post-save tab removal; session record gains `closeTabs` snapshot |
| `src/background.js` | Modify (Task 4) | Defaults for 5 fields; `saveConfig` accepts the 3 new fields; `scan` and `run` handlers build `types` array and read `closeTabs` from storage |
| `src/popup/popup.html` | Modify (Task 5) | Eyebrow text update; add Media Types row (two checkboxes); add Close-tabs row; subfolder placeholder default |
| `src/popup/popup.css` | Modify (Task 5) | Brand-token checkbox styling + new row classes; `[data-status="no-media-url"]` selector replaces the image-url one |
| `src/popup/popup.js` | Modify (Task 6) | Read/write 5 storage fields; wire 3 checkboxes; type-toggle triggers scan; result rendering reads `mediaUrl` instead of `imageUrl`; labelFor handles `no-media-url`; default subfolder updates |
| `test/fixtures.js` | Modify (Task 2) | Add HTML fixtures for `<video>` and `<source>`-inside-`<video>` |
| `test/resolve-video.test.js` | Create (Task 2) | 7 branches of `resolveVideoUrl` |
| `test/resolve-image.test.js` | Unchanged | Phase-1 image-resolver tests |
| `test/filename.test.js` | Modify (Task 8) | 3 additions: `.mp4`, `.webm`, video URL with query string |
| `test/engine.test.js` | Modify (Task 3) | Migrate phase-1 tests to the new shape (`mediaUrl`, `no-media-url`); add 9 new tests for type filter and closeTabs |
| `test/test.html` | Modify (Task 2) | Add the `resolve-video.test.js` import line |
| `README.md` | Modify (Task 9) | Project name, install paths, smoke checklist (add 6 new media-specific cases per spec §11.3) |
| `CLAUDE.md` | Modify (Task 9) | Project name, paths, reference to phase-2 spec |
| `HANDOFF.md` | Modify (Task 9) | Mark phase 1 + 2 as shipped; pointer to new spec |
| `docs/superpowers/specs/2026-05-28-tab-image-reaper-design.md` | Unchanged | Phase-1 spec stays as historical |
| `docs/superpowers/plans/2026-05-28-tab-image-reaper-plan.md` | Unchanged | Phase-1 plan stays as historical |

---

## Task 1: Migration — repo rename + folder move + Chrome re-add

This task is environmental, not code. It must run before any code edits because the spec §12 ordering says rename first, then implement at the new path. Every later task assumes the working directory is `c:\wamp64\www\tab-media-reaper`.

**Files:**
- No file edits in this task. All changes are git operations and OS file moves.

- [ ] **Step 1: Confirm working tree is clean**

```powershell
git status
```

Expected: `nothing to commit, working tree clean` (the spec commit `4e282a7` and the icon commit `764eb1a` are both already pushed).

If the tree is dirty, **stop**. The migration must happen on a clean tree.

- [ ] **Step 2: Rename the GitHub repo via `gh`**

```powershell
& "C:\Program Files\GitHub CLI\gh.exe" repo rename tab-media-reaper --yes
```

(`gh` is installed at the absolute path; the PATH in newly-opened terminals will resolve `gh` directly. Both forms work.)

Expected output (one line):

```
✓ Renamed repository dariobimbi/tab-media-reaper
```

GitHub will keep `dariobimbi/tab-image-reaper` redirecting to the new URL for one year.

- [ ] **Step 3: Update the local remote**

```powershell
git remote set-url origin https://github.com/dariobimbi/tab-media-reaper.git
git remote -v
```

Expected `git remote -v` output:

```
origin  https://github.com/dariobimbi/tab-media-reaper.git (fetch)
origin  https://github.com/dariobimbi/tab-media-reaper.git (push)
```

- [ ] **Step 4: Verify the new remote works**

```powershell
git fetch origin
```

Expected: no errors. The fetch should be a no-op (we're already up to date), but it proves the new URL is reachable.

- [ ] **Step 5: Close any editor windows pointing at the old folder**

Manual step. If VS Code is open at `c:\wamp64\www\tab-image-reaper`, close that window. Leaving it open causes the next step (folder move) to fail with "file in use."

- [ ] **Step 6: Move the local folder**

```powershell
Move-Item -Path "c:\wamp64\www\tab-image-reaper" -Destination "c:\wamp64\www\tab-media-reaper"
```

Expected: no output. The folder now exists at the new path.

Verify with:

```powershell
Test-Path "c:\wamp64\www\tab-media-reaper\.git"
```

Expected: `True`.

- [ ] **Step 7: Reopen VS Code at the new path**

Manual step. Open `c:\wamp64\www\tab-media-reaper`. From here on, every relative path in the plan resolves against that root.

- [ ] **Step 8: Re-add the unpacked extension in Chrome**

Manual step:
1. Open `chrome://extensions`.
2. Click **Remove** on the existing "Tab Image Reaper" card. (Reload alone does NOT follow the move.)
3. Click **Load unpacked** → select `c:\wamp64\www\tab-media-reaper`.
4. Pin the toolbar icon if it disappeared.

Expected: a fresh extension card appears, named "Tab Image Reaper" still (the manifest name hasn't changed yet — Task 7 renames it). No red error banner on the card.

- [ ] **Step 9: Verify the test harness still loads at the new URL**

Open `http://localhost/tab-media-reaper/test/test.html` in a browser.

Expected: **32 passed, 0 failed** (the phase-1 test suite, unchanged). WAMP's default `www`-subdirectory mapping picks up the new folder automatically — no Apache config change required (spec §12 risk note).

If the URL 404s, check `httpd.conf` / `httpd-vhosts.conf` / WAMP tray Alias menu for a hard-coded reference to `tab-image-reaper` and update it.

- [ ] **Step 10: No commit yet**

This task makes no code changes. There's nothing to commit. The remote URL change is a git config tweak, not a working-tree edit. Move on to Task 2.

---

## Task 2: `resolve-video.js` — TDD pure module

**Files:**
- Create: `src/lib/resolve-video.js`
- Create: `test/resolve-video.test.js`
- Modify: `test/fixtures.js` (add `<video>` HTML fixtures)
- Modify: `test/test.html` (add the new test import line)

- [ ] **Step 1: Add video HTML fixtures**

Append to `test/fixtures.js` (before the `makeChromeShim` function — the file currently has the image fixtures, then the shim factory; add the video fixtures right after `emptyImgHtml`):

```js
export const videoHtml = `
  <div id="root">
    <video id="vid" src="https://example.com/clip.mp4"></video>
  </div>`;

export const videoMultiSourceHtml = `
  <div id="root">
    <video id="vid">
      <source src="https://example.com/clip.webm" type="video/webm">
      <source src="https://example.com/clip.mp4" type="video/mp4">
    </video>
  </div>`;

export const emptyVideoHtml = `
  <div id="root">
    <video id="empty"></video>
  </div>`;
```

- [ ] **Step 2: Write the failing tests**

Create `test/resolve-video.test.js`:

```js
import { test, eq } from "./harness.js";
import { resolveVideoUrl } from "../src/lib/resolve-video.js";
import { videoHtml, videoMultiSourceHtml, emptyVideoHtml, imgHtml } from "./fixtures.js";

function parse(html) {
  return new DOMParser().parseFromString(html, "text/html");
}

test("resolve-video: null input returns null", () => {
  eq(resolveVideoUrl(null), null);
});
test("resolve-video: undefined input returns null", () => {
  eq(resolveVideoUrl(undefined), null);
});
test("resolve-video: <video> with src returns src", () => {
  const doc = parse(videoHtml);
  eq(resolveVideoUrl(doc.getElementById("vid")), "https://example.com/clip.mp4");
});
test("resolve-video: <video> with no src and no children returns null", () => {
  const doc = parse(emptyVideoHtml);
  eq(resolveVideoUrl(doc.getElementById("empty")), null);
});
test("resolve-video: <source> walks back to its <video>'s src", () => {
  // The parsed-but-not-loaded <video> has no currentSrc yet, so the
  // resolver falls through to src. With no direct src and only <source>
  // children, the result is null — confirming the contract that we only
  // read currentSrc/src from the <video> element itself, not from <source>.
  const doc = parse(videoMultiSourceHtml);
  const source = doc.querySelector("source");
  eq(resolveVideoUrl(source), null);
});
test("resolve-video: <source> with no <video> ancestor returns null", () => {
  const orphan = document.createElement("source");
  eq(resolveVideoUrl(orphan), null);
});
test("resolve-video: <img> passed by mistake returns null", () => {
  const doc = parse(imgHtml);
  eq(resolveVideoUrl(doc.getElementById("hero")), null);
});
```

- [ ] **Step 3: Wire the new test file into `test/test.html`**

Edit `test/test.html` — inside the `<script type="module">` block, after the existing `import "./resolve-image.test.js";`, add:

```js
    import "./resolve-video.test.js";
```

The block should now look like:

```html
  <script type="module">
    import { run } from "./harness.js";
    // Each task appends its test import below, then run() executes all.
    import "./filename.test.js";
    import "./resolve-image.test.js";
    import "./resolve-video.test.js";
    import "./engine.test.js";
    await run();
  </script>
```

- [ ] **Step 4: Run the harness — expect module-resolution failures**

Open `http://localhost/tab-media-reaper/test/test.html` (hard-reload Ctrl+F5).

Expected: console error `Failed to resolve module specifier '../src/lib/resolve-video.js'` or a 404 on that path; the 7 new tests don't even execute. The 32 phase-1 tests fail to start because the module load error stops the whole script.

- [ ] **Step 5: Implement `src/lib/resolve-video.js`**

Create `src/lib/resolve-video.js`:

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

- [ ] **Step 6: Re-run the harness — verify all green**

Hard-reload `test/test.html`. Expected: **39 passed, 0 failed** (32 prior + 7 new).

- [ ] **Step 7: Commit**

```powershell
git add src/lib/resolve-video.js test/resolve-video.test.js test/fixtures.js test/test.html
git commit -m @'
feat(lib): add resolveVideoUrl + tests

Mirrors resolveImageUrl for <video> / <source>-inside-<video>,
preferring currentSrc over src. Listed in manifest's
web_accessible_resources in Task 7 so the in-page extractor
can dynamically import it.
'@
```

The closing `'@` MUST be at column 0.

---

## Task 3: Engine — type-aware scan + runBatch + closeTabs + status rename

This is the largest task. It's one coherent change because the engine's `scan`, `runBatch`, result shape, and status taxonomy all shift together; splitting would leave intermediate broken states. Within the task, steps are small and each leaves the test suite green.

**Files:**
- Modify: `src/lib/engine.js`
- Modify: `test/engine.test.js`
- Modify: `test/fixtures.js` (extend the chrome shim — small)

Engine signature changes:

| Function | Phase-1 | Phase-2 |
|---|---|---|
| `scan` | `scan({ selector })` | `scan({ selector, types })` |
| `runBatch` | `runBatch({ tabIds, selector, subfolder })` | `runBatch({ tabIds, selector, subfolder, types, closeTabs })` |
| Result fields | `imageUrl`, `status: "no-image-url"` | `mediaUrl`, `type`, `status: "no-media-url"` |

No shim changes are needed for this task. The existing `_setScriptResult(tabId, value)` returns whatever value the test stages, regardless of how many times `executeScript` is called or what `args` are passed. Every test in this plan creates a fresh shim and stages exactly the value it expects the engine to read back. Skip ahead to the rename pass.

- [ ] **Step 1: Migrate phase-1 engine tests to the new result-shape names**

The result rename `imageUrl` → `mediaUrl` and status rename `no-image-url` → `no-media-url` affect existing assertions. Find every occurrence:

```powershell
Get-ChildItem test\engine.test.js | Select-String -Pattern "imageUrl|no-image-url"
```

In `test/engine.test.js`, do this exact text replace (one pass, two patterns):

- `imageUrl` → `mediaUrl` (literal substring; affects field-access in result assertions and probably one staged script-result name)
- `"no-image-url"` → `"no-media-url"` (literal substring with quotes; affects status comparison)

Verify by re-running the search:

```powershell
Get-ChildItem test\engine.test.js | Select-String -Pattern "imageUrl|no-image-url"
```

Expected: no matches.

Don't run the harness yet — the engine code hasn't been updated to produce these new names; tests will fail. The next step fixes the engine.

- [ ] **Step 2: Update the engine to produce the new field/status names**

Edit `src/lib/engine.js`. Two simultaneous renames in the file body:

- `imageUrl` → `mediaUrl` (literal). Affects:
  - Variable names inside `processTab` (`let imageUrl = null` → `let mediaUrl = null`)
  - The arg to `chrome.downloads.download({ url: imageUrl, ... })` → `url: mediaUrl`
  - The pushed result fields (`{ ..., imageUrl, filename }` → `{ ..., mediaUrl, filename }`)
  - The argument name `extractImageUrl(tabId, selector)` and call sites (later steps re-purpose this function entirely; for now just rename in place)

- `"no-image-url"` → `"no-media-url"` (literal status string). Affects the one `pushResult({ tabId, ...info, status: "no-image-url" })` line.

Run the harness:

Hard-reload. Expected: **39 passed, 0 failed**. The renames are name-only changes; behavior unchanged.

- [ ] **Step 3: Commit the rename pass**

```powershell
git add src/lib/engine.js test/engine.test.js
git commit -m @'
refactor(engine): rename imageUrl -> mediaUrl, no-image-url -> no-media-url

Pure rename pass for the phase-2 taxonomy. Behavior unchanged; all
39 tests pass. Result shape and status string updates land here so
subsequent feature commits can focus on actual logic changes.
'@
```

- [ ] **Step 4: Extend engine `scan` to take and use `types`**

The phase-2 probe function takes `(selector, types)` and returns `{ matched, type }`. The current probe takes `(selector)` and returns `{ matched }`. The engine needs to:
- accept `types` on the scan signature;
- pass it as a second `args` element to `executeScript`;
- read both `matched` and `type` from the result;
- include `type` in the per-tab response.

Replace the `scan` function in `src/lib/engine.js`:

```js
  async function scan({ selector, types = ["image"] }) {
    const tabs = await chrome.tabs.query({ currentWindow: true, pinned: false });
    const out = [];
    for (const t of tabs) {
      let matched = false;
      let type = null;
      try {
        const [{ result }] = await chrome.scripting.executeScript({
          target: { tabId: t.id },
          func: (sel, allowedTypes) => {
            const el = document.querySelector(sel);
            if (!el) return { matched: false };
            const tag = el.tagName.toUpperCase();
            let kind = null;
            if ((tag === "IMG" || tag === "PICTURE") && allowedTypes.includes("image")) kind = "image";
            else if (tag === "SOURCE") {
              const parent = el.closest("picture, video");
              if (parent && parent.tagName === "PICTURE" && allowedTypes.includes("image")) kind = "image";
              else if (parent && parent.tagName === "VIDEO" && allowedTypes.includes("video")) kind = "video";
            } else if (tag === "VIDEO" && allowedTypes.includes("video")) kind = "video";
            return { matched: kind !== null, type: kind };
          },
          args: [selector, types],
        });
        matched = !!(result && result.matched);
        type = (result && result.type) || null;
      } catch {
        matched = false;
        type = null;
      }
      out.push({ tabId: t.id, matched, type, url: t.url, title: t.title });
    }
    return out;
  }
```

Note the default `types = ["image"]` — this keeps phase-1 tests that don't pass `types` working unchanged.

- [ ] **Step 5: Update existing scan tests to stage probe-shaped results**

In `test/engine.test.js`, the phase-1 scan tests stage `{ matched: true }` / `{ matched: false }`. These still work because the engine reads `result.matched`. But the new `type` field needs assertions in any test that cares about it.

The first scan test (`"scan: queries non-pinned tabs in current window, runs selector test per tab"`) currently expects:

```js
  eq(tabs, [
    { tabId: 1, matched: true,  url: "https://a.example/", title: "A" },
    { tabId: 2, matched: false, url: "https://b.example/", title: "B" },
  ]);
```

Replace with the `type`-aware shape. The phase-1 staged values `{ matched: true }` produce `type: null` (no type field set by the shim's plain-object staging). To exercise the new shape, change the staged values to include type:

```js
test("scan: queries non-pinned tabs in current window, runs selector test per tab", async () => {
  const chrome = makeChromeShim();
  chrome._setTab({ id: 1, url: "https://a.example/", title: "A", pinned: false });
  chrome._setTab({ id: 2, url: "https://b.example/", title: "B", pinned: false });
  chrome._setScriptResult(1, { matched: true, type: "image" });
  chrome._setScriptResult(2, { matched: false });

  const engine = createEngine({ chrome, broadcast: () => {} });
  const tabs = await engine.scan({ selector: "img.hero", types: ["image"] });

  eq(tabs, [
    { tabId: 1, matched: true,  type: "image", url: "https://a.example/", title: "A" },
    { tabId: 2, matched: false, type: null,   url: "https://b.example/", title: "B" },
  ]);
});
```

For the other two phase-1 scan tests (`"scan: executeScript rejection becomes matched=false"` and `"scan: pinned tabs are excluded"`), only the result shape changes. Update them similarly — add `type: null` to the asserted tab objects, and pass `types: ["image"]` (or omit, since the default covers it).

Find them and edit. After editing, hard-reload the harness. Expected: **39 passed, 0 failed**.

- [ ] **Step 6: Add the 6 new scan tests for the type filter**

Append to `test/engine.test.js`:

```js
test("scan: selector matches <img>, Images on -> matched=true, type=image", async () => {
  const chrome = makeChromeShim();
  chrome._setTab({ id: 1, url: "https://a/", title: "A", pinned: false });
  chrome._setScriptResult(1, { matched: true, type: "image" });
  const engine = createEngine({ chrome, broadcast: () => {} });
  const tabs = await engine.scan({ selector: "img", types: ["image"] });
  eq(tabs[0].matched, true);
  eq(tabs[0].type, "image");
});

test("scan: selector matches <img>, Images off -> matched=false (collapsed to null)", async () => {
  const chrome = makeChromeShim();
  chrome._setTab({ id: 1, url: "https://a/", title: "A", pinned: false });
  // With Images off, the probe finds the IMG but allowedTypes.includes("image")
  // is false, so kind stays null and the probe returns { matched: false }.
  chrome._setScriptResult(1, { matched: false });
  const engine = createEngine({ chrome, broadcast: () => {} });
  const tabs = await engine.scan({ selector: "img", types: ["video"] });
  eq(tabs[0].matched, false);
  eq(tabs[0].type, null);
});

test("scan: selector matches <video>, Videos off -> matched=false", async () => {
  const chrome = makeChromeShim();
  chrome._setTab({ id: 1, url: "https://a/", title: "A", pinned: false });
  chrome._setScriptResult(1, { matched: false });
  const engine = createEngine({ chrome, broadcast: () => {} });
  const tabs = await engine.scan({ selector: "video", types: ["image"] });
  eq(tabs[0].matched, false);
});

test("scan: selector matches <video>, Videos on -> matched=true, type=video", async () => {
  const chrome = makeChromeShim();
  chrome._setTab({ id: 1, url: "https://a/", title: "A", pinned: false });
  chrome._setScriptResult(1, { matched: true, type: "video" });
  const engine = createEngine({ chrome, broadcast: () => {} });
  const tabs = await engine.scan({ selector: "video", types: ["video"] });
  eq(tabs[0].matched, true);
  eq(tabs[0].type, "video");
});

test("scan: selector matches <source> inside <picture>, Images on, Videos off -> type=image", async () => {
  const chrome = makeChromeShim();
  chrome._setTab({ id: 1, url: "https://a/", title: "A", pinned: false });
  chrome._setScriptResult(1, { matched: true, type: "image" });
  const engine = createEngine({ chrome, broadcast: () => {} });
  const tabs = await engine.scan({ selector: "source", types: ["image"] });
  eq(tabs[0].type, "image");
});

test("scan: selector matches <source> inside <video>, Images off, Videos on -> type=video", async () => {
  const chrome = makeChromeShim();
  chrome._setTab({ id: 1, url: "https://a/", title: "A", pinned: false });
  chrome._setScriptResult(1, { matched: true, type: "video" });
  const engine = createEngine({ chrome, broadcast: () => {} });
  const tabs = await engine.scan({ selector: "source", types: ["video"] });
  eq(tabs[0].type, "video");
});
```

Note: these tests stage the **expected probe output** directly via `_setScriptResult`. They don't exercise the real probe function — that runs in a real page via `executeScript` and is verified manually. What they DO verify is that the engine correctly receives the probe's result and propagates `matched`/`type` into the per-tab response.

Hard-reload the harness. Expected: **45 passed, 0 failed** (39 + 6).

- [ ] **Step 7: Commit the scan extension**

```powershell
git add src/lib/engine.js test/engine.test.js
git commit -m @'
feat(engine): type-aware scan with embedded probe + tests

scan({ selector, types }) injects a probe that walks the matched
element's tagName (and nearest picture/video ancestor for <source>)
to determine type, applies the active types filter, and returns
{ matched, type }. Phase-1 scan tests migrated to the new shape;
6 new tests cover the type-filter branches.
'@
```

- [ ] **Step 8: Extend engine `runBatch` to take `types` and `closeTabs`, dispatch resolver by type**

The current `extractImageUrl(tabId, selector)` hard-codes `resolve-image.js`. Replace it with `extractMedia(tabId, selector, types)` that mirrors §5.2's injected extractor.

Edit `src/lib/engine.js`:

1. Delete the `RESOLVE_IMAGE_PATH` constant at line 3 — no longer needed.

2. Replace the `extractImageUrl` function entirely with:

```js
  async function extractMedia(tabId, selector, types) {
    // In real Chrome, this function body runs in the page. The shim's
    // executeScript ignores `func` and returns whatever was staged via
    // _setScriptResult. Tests stage either { url, type } or null.
    const [{ result }] = await chrome.scripting.executeScript({
      target: { tabId },
      func: async (sel, allowedTypes) => {
        const el = document.querySelector(sel);
        if (!el) return null;
        const tag = el.tagName.toUpperCase();
        let type = null;
        if ((tag === "IMG" || tag === "PICTURE") && allowedTypes.includes("image")) type = "image";
        else if (tag === "SOURCE") {
          const parent = el.closest("picture, video");
          if (parent && parent.tagName === "PICTURE" && allowedTypes.includes("image")) type = "image";
          else if (parent && parent.tagName === "VIDEO" && allowedTypes.includes("video")) type = "video";
        } else if (tag === "VIDEO" && allowedTypes.includes("video")) type = "video";
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
      },
      args: [selector, types],
    });
    return result;
  }
```

3. Replace the `processTab` function entirely with:

```js
  async function processTab(tabId, selector, types, subfolder, closeTabs) {
    const info = await tabInfo(tabId);
    let extracted = null;
    try {
      extracted = await extractMedia(tabId, selector, types);
    } catch (err) {
      pushResult({ tabId, ...info, status: "inaccessible", error: String(err.message || err) });
      return;
    }
    if (!extracted || !extracted.url) {
      // Type is unknown when extraction failed — set to null so the result
      // shape is consistent.
      pushResult({ tabId, ...info, type: extracted?.type || null, status: "no-media-url" });
      return;
    }
    const { url: mediaUrl, type } = extracted;
    const filename = filenameFromUrl(mediaUrl);
    let downloadId;
    try {
      downloadId = await chrome.downloads.download({
        url: mediaUrl,
        filename: `${subfolder}/${filename}`,
        conflictAction: "uniquify",
        saveAs: false,
      });
    } catch (err) {
      pushResult({ tabId, ...info, type, status: "save-failed", mediaUrl, filename, error: String(err.message || err) });
      return;
    }
    await chrome.storage.session.set({
      [`downloads.${downloadId}`]: {
        downloadId,
        tabId,
        tabUrl: info.url,
        tabTitle: info.title,
        closeTabs,  // snapshot at batch start (spec §5.4)
      },
    });

    const outcome = await new Promise((resolve) => {
      pending.set(downloadId, { resolve });
    });

    await chrome.storage.session.remove(`downloads.${downloadId}`);

    if (outcome.ok) {
      if (closeTabs) {
        try { await chrome.tabs.remove(tabId); } catch { /* tab already gone */ }
      }
      pushResult({ tabId, ...info, type, status: "saved", mediaUrl, filename });
    } else {
      pushResult({ tabId, ...info, type, status: "save-failed", mediaUrl, filename, error: outcome.error });
    }
  }
```

4. Replace the `runBatch` function with:

```js
  async function runBatch({ tabIds, selector, subfolder, types = ["image"], closeTabs = true }) {
    state = { status: "running", total: tabIds.length, processed: 0, results: [] };
    for (const tabId of tabIds) {
      await processTab(tabId, selector, types, subfolder, closeTabs);
    }
    state.status = "done";
    safeBroadcast({ type: "done", results: state.results });
  }
```

5. Update `handleDownloadChanged` — the SW-restart recovery branch must honor the recorded `closeTabs` snapshot:

```js
    // SW-restart recovery path.
    const key = `downloads.${id}`;
    const rec = (await chrome.storage.session.get(key))[key];
    if (!rec) return;
    if (current === "complete" && rec.closeTabs) {
      try { await chrome.tabs.remove(rec.tabId); } catch { /* gone */ }
    }
    await chrome.storage.session.remove(key);
```

Note: previously the recovery path closed the tab unconditionally on complete. Phase 2 gates it on `rec.closeTabs`.

- [ ] **Step 9: Update existing runBatch tests for the new result shape and signature**

In `test/engine.test.js`, find every existing `runBatch` test and:

1. Change `_setScriptResult(tabId, "https://...")` calls to stage the new extractor shape: `_setScriptResult(tabId, { url: "https://...", type: "image" })`. The phase-1 extractor returned a bare URL string; the phase-2 extractor returns `{ url, type } | null`.

2. Change `chrome._setScriptResult(tabId, null)` (used in the no-image-url test) to stay as `null` — that's the "no eligible match" signal in the new shape, unchanged.

3. Add a `closeTabs: true` to `runBatch(...)` calls if the test asserts tab closure. The default is `true`, so omitting it works too — only add it where the test explicitly tests the closeTabs path.

Walk every existing `runBatch` test in the file. Patterns to update:

```js
// Before:
chrome._setScriptResult(1, "https://a.example/photo.jpg");
// After:
chrome._setScriptResult(1, { url: "https://a.example/photo.jpg", type: "image" });
```

Assertion updates: every `s.results[0].imageUrl` was already renamed to `mediaUrl` in step 3, but now you need to also assert `s.results[0].type`:

```js
// Add to the saved-tab test:
eq(s.results[0].type, "image");
```

Hard-reload. Expected: **45 passed, 0 failed** (the runBatch tests now produce the new shape; the 6 new scan tests still pass).

- [ ] **Step 10: Add 3 new runBatch tests for type + closeTabs**

Append to `test/engine.test.js`:

```js
test("runBatch: saved with closeTabs=true -> tab closed", async () => {
  const chrome = makeChromeShim();
  chrome._setTab({ id: 1, url: "https://a/", title: "A", pinned: false });
  chrome._setScriptResult(1, { url: "https://a/photo.jpg", type: "image" });
  const engine = createEngine({ chrome, broadcast: () => {} });
  const p = engine.runBatch({ tabIds: [1], selector: "img", subfolder: "tmr", types: ["image"], closeTabs: true });
  await new Promise((r) => setTimeout(r, 0));
  chrome._fireDownloadComplete(1);
  await p;
  eq(engine.getState().results[0].status, "saved");
  eq(chrome._tabsRemaining(), []);
});

test("runBatch: saved with closeTabs=false -> tab stays open", async () => {
  const chrome = makeChromeShim();
  chrome._setTab({ id: 1, url: "https://a/", title: "A", pinned: false });
  chrome._setScriptResult(1, { url: "https://a/photo.jpg", type: "image" });
  const engine = createEngine({ chrome, broadcast: () => {} });
  const p = engine.runBatch({ tabIds: [1], selector: "img", subfolder: "tmr", types: ["image"], closeTabs: false });
  await new Promise((r) => setTimeout(r, 0));
  chrome._fireDownloadComplete(1);
  await p;
  eq(engine.getState().results[0].status, "saved");
  eq(chrome._tabsRemaining(), [1]);
});

test("runBatch: video extraction -> downloaded with type=video and mp4 filename", async () => {
  const chrome = makeChromeShim();
  chrome._setTab({ id: 1, url: "https://a/", title: "A", pinned: false });
  chrome._setScriptResult(1, { url: "https://a/clip.mp4", type: "video" });
  const engine = createEngine({ chrome, broadcast: () => {} });
  const p = engine.runBatch({ tabIds: [1], selector: "video", subfolder: "tmr", types: ["video"], closeTabs: true });
  await new Promise((r) => setTimeout(r, 0));
  chrome._fireDownloadComplete(1);
  await p;
  const r = engine.getState().results[0];
  eq(r.status, "saved");
  eq(r.type, "video");
  eq(r.filename, "clip.mp4");
  eq(chrome._downloads[0].filename, "tmr/clip.mp4");
});
```

Hard-reload. Expected: **48 passed, 0 failed** (45 + 3).

- [ ] **Step 11: Add a SW-restart recovery test for the closeTabs snapshot**

Append to `test/engine.test.js`:

```js
test("handleDownloadChanged: SW-restart recovery honors closeTabs=false snapshot", async () => {
  // Simulate the SW restarting between download issuance and the
  // onChanged event. The session record has closeTabs: false; recovery
  // must NOT close the tab even though the download completed.
  const chrome = makeChromeShim();
  chrome._setTab({ id: 7, url: "https://x/", title: "X", pinned: false });
  await chrome.storage.session.set({
    "downloads.42": { downloadId: 42, tabId: 7, tabUrl: "https://x/", tabTitle: "X", closeTabs: false },
  });
  const engine = createEngine({ chrome, broadcast: () => {} });
  await engine.handleDownloadChanged({ id: 42, state: { current: "complete" } });
  eq(chrome._tabsRemaining(), [7]); // tab NOT closed because closeTabs=false
  eq(chrome._session["downloads.42"], undefined); // record still cleared
});
```

Hard-reload. Expected: **49 passed, 0 failed**.

- [ ] **Step 12: Commit the runBatch + recovery extension**

```powershell
git add src/lib/engine.js test/engine.test.js
git commit -m @'
feat(engine): type-aware runBatch, closeTabs gate, recovery snapshot

extractMedia dispatches to resolve-image.js or resolve-video.js
based on the matched element's tag (and parent picture/video for
<source>). runBatch gains types + closeTabs; closeTabs gates the
post-save tabs.remove call. The SW-restart recovery path records
closeTabs at batch start and honors that snapshot if the SW dies
mid-download.

Phase-1 runBatch tests migrated to the new staged-extractor shape
({ url, type } instead of bare URL string). Three new tests cover
closeTabs on/off and the video extraction path; one recovery test
covers closeTabs=false honored after SW restart.
'@
```

---

## Task 4: Background SW wiring

**Files:**
- Modify: `src/background.js`

- [ ] **Step 1: Replace `src/background.js`**

```js
import { createEngine } from "./lib/engine.js";

const DEFAULT_SELECTOR = "";
const DEFAULT_SUBFOLDER = "tab-media-reaper";
const DEFAULT_INCLUDE_IMAGES = true;
const DEFAULT_INCLUDE_VIDEOS = false;
const DEFAULT_CLOSE_TABS = true;

const engine = createEngine({
  chrome,
  broadcast: (msg) => {
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

async function readConfig() {
  return chrome.storage.local.get({
    selector: DEFAULT_SELECTOR,
    subfolder: DEFAULT_SUBFOLDER,
    includeImages: DEFAULT_INCLUDE_IMAGES,
    includeVideos: DEFAULT_INCLUDE_VIDEOS,
    closeTabs: DEFAULT_CLOSE_TABS,
  });
}

function typesFor(cfg) {
  const types = [];
  if (cfg.includeImages) types.push("image");
  if (cfg.includeVideos) types.push("video");
  return types;
}

async function handle(msg) {
  if (!msg || !msg.type) return { error: "missing type" };
  switch (msg.type) {
    case "scan": {
      const cfg = await readConfig();
      const tabs = await engine.scan({ selector: cfg.selector, types: typesFor(cfg) });
      return { tabs };
    }
    case "saveConfig": {
      const { selector, subfolder, includeImages, includeVideos, closeTabs } = msg;
      await chrome.storage.local.set({ selector, subfolder, includeImages, includeVideos, closeTabs });
      return { ok: true };
    }
    case "run": {
      const cfg = await readConfig();
      // Fire-and-forget — caller gets an ack, progress flows via broadcasts.
      engine.runBatch({
        tabIds: msg.tabIds,
        selector: cfg.selector,
        subfolder: cfg.subfolder,
        types: typesFor(cfg),
        closeTabs: cfg.closeTabs,
      });
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

Changes vs phase 1:
- Three new defaults (`DEFAULT_INCLUDE_IMAGES`, `DEFAULT_INCLUDE_VIDEOS`, `DEFAULT_CLOSE_TABS`)
- `DEFAULT_SUBFOLDER` renamed value from `"tab-image-reaper"` to `"tab-media-reaper"`
- New `readConfig` helper for the get-with-defaults pattern
- New `typesFor` helper to build the `types` array
- `saveConfig` accepts the 3 new fields
- `scan` and `run` pass `types` + `closeTabs` through to the engine
- No second `downloads.onChanged` listener added (still owned by the engine)

- [ ] **Step 2: Reload the extension and verify the SW boots cleanly**

In `chrome://extensions`, click the reload icon on the Tab Image Reaper card (name still "Tab Image Reaper" until Task 7). Click "service worker" to open the SW devtools.

Type:
```js
chrome.runtime.sendMessage({ type: "getStatus" }).then(console.log);
```

Expected: `{ status: "idle", total: 0, processed: 0, results: [] }`.

If red errors appear in the SW console, fix them before proceeding.

- [ ] **Step 3: Verify the harness still passes**

Hard-reload `http://localhost/tab-media-reaper/test/test.html`.

Expected: **49 passed, 0 failed** (the engine tests don't touch background.js; this is a sanity check that nothing else broke).

- [ ] **Step 4: Commit**

```powershell
git add src/background.js
git commit -m @'
feat(background): wire 5-field config, types array, closeTabs flag

readConfig pulls all five storage fields with phase-2 defaults
(selector "", subfolder "tab-media-reaper", includeImages true,
includeVideos false, closeTabs true). typesFor maps the two
booleans to the engine's types array. scan and run both pass the
derived types + closeTabs through. saveConfig accepts the three
new fields.

The default subfolder string is the only user-visible change;
existing chrome.storage.local subfolder values are honored as-is
(hands-off migration policy from spec §4.1).
'@
```

---

## Task 5: Popup HTML + CSS — checkbox rows

**Files:**
- Modify: `src/popup/popup.html`
- Modify: `src/popup/popup.css`

- [ ] **Step 1: Replace `src/popup/popup.html`**

```html
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>Tab Media Reaper</title>
  <link rel="stylesheet" href="popup.css" />
</head>
<body>
  <main class="tir-card">
    <div class="tir-eyebrow">&lt;/&gt; tab media reaper</div>

    <label class="tir-field">
      <span class="tir-label">selector</span>
      <input id="selector" type="text" spellcheck="false" autocomplete="off" placeholder="e.g. img.hero or #image or [itemprop=&quot;image&quot;]" />
    </label>

    <label class="tir-field">
      <span class="tir-label">subfolder</span>
      <input id="subfolder" type="text" spellcheck="false" autocomplete="off" placeholder="tab-media-reaper" />
    </label>

    <div class="tir-field">
      <span class="tir-label">media types</span>
      <div class="tir-toggles">
        <label class="tir-check">
          <input id="include-images" type="checkbox" />
          <span class="tir-check-box"></span>
          <span class="tir-check-text">Images</span>
        </label>
        <label class="tir-check">
          <input id="include-videos" type="checkbox" />
          <span class="tir-check-box"></span>
          <span class="tir-check-text">Videos</span>
        </label>
      </div>
    </div>

    <label class="tir-check tir-check-block">
      <input id="close-tabs" type="checkbox" />
      <span class="tir-check-box"></span>
      <span class="tir-check-text">Close tabs after saving</span>
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

Changes:
- Title `Tab Image Reaper` → `Tab Media Reaper`
- Eyebrow text `tab image reaper` → `tab media reaper`
- Subfolder placeholder `tab-image-reaper` → `tab-media-reaper`
- New `media types` field with two checkboxes (`include-images`, `include-videos`)
- New standalone close-tabs checkbox (`close-tabs`)

- [ ] **Step 2: Append the checkbox styles to `src/popup/popup.css`**

Open `src/popup/popup.css` and add the following block at the end of the file (before the `@media (prefers-reduced-motion: reduce)` block — keep the carve-out block last):

```css
.tir-toggles {
  display: flex;
  gap: 16px;
  padding: 4px 0;
}

.tir-check {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  cursor: pointer;
  user-select: none;
}

.tir-check-block {
  display: flex;
  margin: 10px 0 4px;
}

.tir-check input[type="checkbox"] {
  position: absolute;
  opacity: 0;
  width: 1px;
  height: 1px;
  pointer-events: none;
}

.tir-check-box {
  width: 16px;
  height: 16px;
  border-radius: 4px;
  background: var(--tir-subtle);
  border: 1px solid var(--tir-subtle);
  position: relative;
  transition: background var(--tir-duration) var(--tir-ease),
              border-color var(--tir-duration) var(--tir-ease),
              box-shadow var(--tir-duration) var(--tir-ease);
}

.tir-check input[type="checkbox"]:checked + .tir-check-box {
  background: var(--tir-grad-brand);
  border-color: transparent;
}

.tir-check input[type="checkbox"]:checked + .tir-check-box::after {
  content: "";
  position: absolute;
  left: 4px;
  top: 1px;
  width: 6px;
  height: 10px;
  border-right: 2px solid #fff;
  border-bottom: 2px solid #fff;
  transform: rotate(45deg);
}

.tir-check input[type="checkbox"]:focus-visible + .tir-check-box {
  outline: none;
  box-shadow: var(--tir-glow-blue);
  border-color: var(--tir-primary);
}

.tir-check-text {
  font-size: 13px;
  color: var(--tir-fg);
}
```

Then update the existing `@media (prefers-reduced-motion: reduce)` block (already in the file) to include the checkbox transitions in its `transition: none` carve-out. Find:

```css
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after { transition: none !important; }
  .tir-run:hover:not(:disabled), .tir-result:hover { transform: none; }
}
```

The `*` selector already covers the new `.tir-check-box` transitions. No change needed.

Update the existing `@media (forced-colors: active)` block to also handle the checkbox. Find it and replace with:

```css
@media (forced-colors: active) {
  .tir-grad-text {
    background: none;
    -webkit-text-fill-color: var(--tir-primary-soft);
    color: var(--tir-primary-soft);
  }
  .tir-check input[type="checkbox"]:checked + .tir-check-box {
    background: SystemColor(Highlight);
    border-color: SystemColor(Highlight);
  }
  .tir-check input[type="checkbox"]:checked + .tir-check-box::after {
    border-right-color: SystemColor(HighlightText);
    border-bottom-color: SystemColor(HighlightText);
  }
}
```

Also update the existing CSS that targets the result pill for `no-image-url`. Find:

```css
.tir-pill[data-status="no-image-url"] { background: var(--tir-highlight); box-shadow: 0 0 0 4px rgba(250,204,21,.18); }
```

Replace `no-image-url` with `no-media-url`:

```css
.tir-pill[data-status="no-media-url"] { background: var(--tir-highlight); box-shadow: 0 0 0 4px rgba(250,204,21,.18); }
```

- [ ] **Step 3: Visual sanity check the popup**

Open `http://localhost/tab-media-reaper/src/popup/popup.html` directly in Chrome (popup.js will error because it tries to call `chrome.storage.local.get` outside the extension context, but the layout will render).

Expected:
- Eyebrow reads `</> TAB MEDIA REAPER`.
- Selector and subfolder inputs render normally with the new placeholder.
- Two new checkbox-with-label rows appear: `Images / Videos` (side by side) and `Close tabs after saving` (full width).
- All checkboxes are unchecked by default in this isolated preview (popup.js can't set them without chrome.*).
- Run button at bottom is disabled and shows "Run".

The checkbox check-mark won't appear yet because the checkboxes start unchecked. To see the check mark in browser devtools: in the Elements panel, find `<input id="include-images">` and add the `checked` attribute manually — a white check mark should appear inside a brand-gradient square.

- [ ] **Step 4: Commit**

```powershell
git add src/popup/popup.html src/popup/popup.css
git commit -m @'
feat(popup): add media-type and close-tabs checkboxes + brand styling

Two new rows between the subfolder input and the match-count
headline: a "Media types" pair (Images / Videos) and a standalone
"Close tabs after saving" toggle. Custom-styled checkboxes via
visually-hidden native input + .tir-check-box indicator using
the existing --tir-* token layer (subtle background off, brand-
gradient fill on, glow-blue focus ring). prefers-reduced-motion
and forced-colors carve-outs extended to cover the new control.

CSS pill selector renamed from no-image-url to no-media-url to
match the engine's new status taxonomy.
'@
```

---

## Task 6: Popup JS — wire checkboxes + rename for media

**Files:**
- Modify: `src/popup/popup.js`

- [ ] **Step 1: Replace `src/popup/popup.js`**

```js
const DEFAULT_SELECTOR = "";
const DEFAULT_SUBFOLDER = "tab-media-reaper";
const DEFAULT_INCLUDE_IMAGES = true;
const DEFAULT_INCLUDE_VIDEOS = false;
const DEFAULT_CLOSE_TABS = true;

const $selector       = document.getElementById("selector");
const $subfolder      = document.getElementById("subfolder");
const $includeImages  = document.getElementById("include-images");
const $includeVideos  = document.getElementById("include-videos");
const $closeTabs      = document.getElementById("close-tabs");
const $match          = document.getElementById("match-count");
const $total          = document.getElementById("total-count");
const $run            = document.getElementById("run");
const $results        = document.getElementById("results");

let scanTabs = [];
let running  = false;

init().catch((err) => console.error("[tmr] init failed", err));

async function init() {
  const cfg = await chrome.storage.local.get({
    selector: DEFAULT_SELECTOR,
    subfolder: DEFAULT_SUBFOLDER,
    includeImages: DEFAULT_INCLUDE_IMAGES,
    includeVideos: DEFAULT_INCLUDE_VIDEOS,
    closeTabs: DEFAULT_CLOSE_TABS,
  });
  $selector.value        = cfg.selector;
  $subfolder.value       = cfg.subfolder;
  $includeImages.checked = cfg.includeImages;
  $includeVideos.checked = cfg.includeVideos;
  $closeTabs.checked     = cfg.closeTabs;

  $selector.addEventListener("blur", saveConfig);
  $subfolder.addEventListener("blur", saveConfig);
  $selector.addEventListener("change", scan);
  $includeImages.addEventListener("change", onTypeToggle);
  $includeVideos.addEventListener("change", onTypeToggle);
  $closeTabs.addEventListener("change", saveConfig);  // no rescan; doesn't affect what matches
  $run.addEventListener("click", runBatch);

  // Re-attach to an in-flight run, if any.
  const status = await sendMessage({ type: "getStatus" });
  if (status && status.status === "running") {
    running = true;
    renderResults(status.results);
    setRunButton(status.processed, status.total);
  }

  chrome.runtime.onMessage.addListener(onBroadcast);

  await scan();
}

async function onTypeToggle() {
  await saveConfig();
  await scan();
}

async function saveConfig() {
  await sendMessage({
    type: "saveConfig",
    selector:       $selector.value || DEFAULT_SELECTOR,
    subfolder:      $subfolder.value || DEFAULT_SUBFOLDER,
    includeImages:  $includeImages.checked,
    includeVideos:  $includeVideos.checked,
    closeTabs:      $closeTabs.checked,
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
  const anyTypeOn = $includeImages.checked || $includeVideos.checked;
  $run.disabled = matched === 0 || !anyTypeOn || !$selector.value;
}

async function runBatch() {
  if (running) return;
  await saveConfig();
  const tabIds = scanTabs.filter((t) => t.matched).map((t) => t.tabId);
  if (tabIds.length === 0) return;
  running = true;
  setRunButton(0, tabIds.length);
  $results.innerHTML = "";
  const ack = await sendMessage({ type: "run", tabIds });
  if (!ack || !ack.ack) {
    running = false;
    setRunButton();
  }
}

function onBroadcast(msg) {
  if (!msg || !msg.type) return;
  if (msg.type === "progress") {
    setRunButton(msg.processed, msg.total);
    appendResult(msg.lastResult);
  } else if (msg.type === "done") {
    running = false;
    setRunButton();
    scan().catch((err) => console.error("[tmr] scan failed after done", err));
  }
}

function setRunButton(processed, total) {
  if (running && total != null) {
    $run.textContent = `Working… (${processed}/${total})`;
    $run.disabled = true;
  } else {
    $run.textContent = "Run";
    const matched = scanTabs.filter((t) => t.matched).length;
    const anyTypeOn = $includeImages.checked || $includeVideos.checked;
    $run.disabled = running || matched === 0 || !anyTypeOn || !$selector.value;
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
  pill.title = labelFor(r.status);
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
    case "no-media-url":  return "No media URL";
    case "inaccessible":  return "Inaccessible";
    default:              return status;
  }
}

function sendMessage(msg) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(msg, (resp) => {
      void chrome.runtime.lastError;
      resolve(resp);
    });
  });
}
```

Diff vs phase 1:
- New constants for the three boolean defaults; subfolder default renamed.
- DOM references for the 3 new checkboxes.
- `init()` reads 5 fields, populates checkboxes, wires change listeners (`onTypeToggle` for the two type checkboxes — saves *and* rescans; `saveConfig` for close-tabs — saves only, no rescan).
- `saveConfig` sends the 5 fields.
- `scan` and `setRunButton` add a `anyTypeOn` and selector-non-empty gate to the Run-button disabled logic.
- `labelFor` updates `no-image-url` → `no-media-url` (with display text "No media URL").
- All log prefixes change from `[tir]` to `[tmr]` (cosmetic).

- [ ] **Step 2: Reload the extension and click the toolbar icon**

In `chrome://extensions`, reload the card. Open the popup. Expected:
- Selector field is empty (default), placeholder visible.
- Subfolder field shows `tab-media-reaper` (default).
- Images is checked, Videos is unchecked.
- Close tabs is checked.
- "0 of N tabs match" — preview reflects the active filter.
- Run button is disabled (selector is empty).

Type `img` in the selector. The match count should update; Run becomes enabled if any tab has an `<img>`.

Toggle Videos on. The match count should update again (likely upward — videos that previously didn't count now do).

Toggle Close tabs off. The match count should NOT change.

- [ ] **Step 3: Verify the harness still passes**

Hard-reload `test/test.html`. Expected: **49 passed, 0 failed**. (No engine changes; sanity check.)

- [ ] **Step 4: Commit**

```powershell
git add src/popup/popup.js
git commit -m @'
feat(popup): wire 3 new checkboxes + media taxonomy rename

init() reads 5 fields from storage and populates inputs + checkboxes;
type-toggle fires saveConfig + rescan; close-tabs fires saveConfig
only (no rescan, doesn't affect matches). Run-button disabled gate
now also requires at least one media type enabled AND a non-empty
selector. labelFor maps no-media-url to "No media URL"; log prefix
shifts from [tir] to [tmr].
'@
```

---

## Task 7: Manifest finalize

**Files:**
- Modify: `manifest.json`

- [ ] **Step 1: Replace `manifest.json`**

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

Changes:
- `name`: "Tab Image Reaper" → "Tab Media Reaper"
- `version`: "0.1.0" → "0.2.0"
- `description` updated to mention videos
- `action.default_title`: same rename
- `web_accessible_resources.resources` adds `src/lib/resolve-video.js`

- [ ] **Step 2: Reload the extension; Chrome surfaces permission/manifest changes**

In `chrome://extensions`, reload the card. Chrome will refresh the displayed name. No new permission prompts (permissions unchanged from phase 1).

Verify:
- Card name reads "Tab Media Reaper".
- Hover the toolbar icon — tooltip reads "Tab Media Reaper".
- The 16/48/128 icons are the new reaper artwork (committed at `764eb1a`).

- [ ] **Step 3: Quick end-to-end sanity (one happy path)**

Open one tab to any page with an obvious `<img>` (Wikipedia main page works). Click the toolbar icon. Selector: `img`. Verify the preview reads at least "1 of N tabs match". DO NOT click Run yet — the full smoke is Task 10.

- [ ] **Step 4: Commit**

```powershell
git add manifest.json
git commit -m @'
feat(manifest): finalize phase-2 name, version, web_accessible_resources

Name + default_title flip to "Tab Media Reaper". Version bumps to
0.2.0 to signal the feature delta. Description mentions videos.
web_accessible_resources gains src/lib/resolve-video.js alongside
resolve-image.js so the in-page extractor can dynamically import
either one based on the matched element's tag.
'@
```

---

## Task 8: Filename test additions

Small, low-risk. Adds 3 confirmation tests to `filename.test.js` for video extensions and the query-string case from spec §11.1. The underlying `filenameFromUrl` regex already handles these — these are documentational tests for the next reader.

**Files:**
- Modify: `test/filename.test.js`

- [ ] **Step 1: Append the new tests**

Open `test/filename.test.js` and add these tests at the end of the file (after the existing `garbage string` test, before the test runner closes):

```js
test("filename: .mp4 video URL -> leaf with .mp4", () => {
  eq(filenameFromUrl("https://cdn.example/clip.mp4"), "clip.mp4");
});
test("filename: .webm video URL -> leaf with .webm", () => {
  eq(filenameFromUrl("https://cdn.example/clip.webm"), "clip.webm");
});
test("filename: video URL with query parameters -> clean extension", () => {
  eq(filenameFromUrl("https://cdn.example/v/sample.mp4?token=abc&expires=123"), "sample.mp4");
});
```

- [ ] **Step 2: Run the harness**

Hard-reload `test/test.html`. Expected: **52 passed, 0 failed** (49 + 3).

If any of the three fail, the regex is wrong — investigate (it shouldn't be; the phase-1 regex `/\.[a-z0-9]{2,5}$/i` matches `.mp4` and `.webm` correctly, and `URL.pathname` strips query strings).

- [ ] **Step 3: Commit**

```powershell
git add test/filename.test.js
git commit -m @'
test(filename): add .mp4 / .webm / video-with-query confirmation tests

Documentational coverage. The phase-1 regex and URL.pathname behavior
already handle these — these tests make the contract explicit for
the next reader who's wondering whether video URLs with CDN tokens
get cleaned up correctly.
'@
```

---

## Task 9: Docs update — README, CLAUDE.md, HANDOFF.md

**Files:**
- Modify: `README.md`
- Modify: `CLAUDE.md`
- Modify: `HANDOFF.md`

Goal: every reference to "tab-image-reaper" / "Tab Image Reaper" in user-facing docs becomes "tab-media-reaper" / "Tab Media Reaper" where it refers to the *current* project, with phase-1 references preserved where they refer to historical state. The smoke checklist gains 6 new media-specific cases per spec §11.3.

- [ ] **Step 1: Update `README.md`**

Read the existing README. The phase-1 README has:
- Title + intro
- Install steps
- Use steps
- Tests section
- Manual smoke-test checklist (7 items)
- Design pointers

Replace the entire file with:

```markdown
# Tab Media Reaper

A personal-use Manifest V3 Chrome extension that, on toolbar click,
saves the image or video matching a user-edited CSS selector from each
non-pinned tab in the current window — and (optionally) closes the tab
on successful save.

Phase 2 of the project — replaces the original `tab-image-reaper` with
support for `<video>` / `<source>`-in-`<video>` plus user toggles for
which media types to grab and whether to close tabs after saving.

Mirrors the patterns of [bimbi-stocker](../bimbi-stocker): native ES
modules, no build step, brand tokens, browser-based test harness.

## Install (unpacked)

1. Open `chrome://extensions`, enable **Developer mode** (top-right).
2. Click **Load unpacked**, select `c:\wamp64\www\tab-media-reaper`.
3. Pin the toolbar icon via the puzzle-piece menu.

## Use

1. Click the toolbar icon. The popup shows the current selector,
   subfolder, media-type toggles, and close-tabs toggle.
2. Edit the selector and pick which types (Images / Videos / both) to
   include. The match preview reflects the active filter.
3. Click **Run**. Each matching tab is saved to
   `Downloads/<subfolder>/<original-filename>`. If "Close tabs after
   saving" is on, the tab closes on confirmed save; otherwise it stays
   open.
4. Tabs that fail to save stay open with a visible status pill.

## Tests

Browser harness — no Node, no jsdom. WAMP must be running so the
harness is served over HTTP (Chrome blocks ES modules from `file://`).

Open: `http://localhost/tab-media-reaper/test/test.html`

The page renders pass/fail per test and a summary at the top. Target
is **52 passed, 0 failed** at end of phase 2.

## Manual smoke-test checklist

Run these after any change touching the background SW, the engine,
the popup, or the manifest.

Phase-1 (image-only) cases:

- [ ] **Happy path.** Open 5 tabs whose pages contain `<img class="hero">`.
      Set selector to `img.hero`, Images on, Videos off, Close tabs on.
      Preview reads "5 of 5". Run. 5 files appear in
      `Downloads/tab-media-reaper/`; 5 tabs close.
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
- [ ] **No-media-url.** Set selector to `body`. Run. Every tab gets
      `no-media-url`. No tabs close.
- [ ] **Collision.** Open 3 tabs of the same image. Run. 3 files saved
      with Chrome's `(1)`, `(2)` suffixes; 3 tabs close.

Phase-2 (media-reaper) cases:

- [ ] **Video happy path.** Open a tab with a self-hosted
      `<video src="…mp4">`. Selector `video`. Toggle Videos on. Run.
      Verify: file appears in `Downloads/<subfolder>/`, tab closes.
- [ ] **Blob-backed video (expected to fail).** Open a tab whose video
      uses MediaSource (most modern streaming sites). Selector `video`.
      Videos on. Run. Verify: tab stays open, results list shows
      `save-failed` pill with Chrome's rejection reason.
- [ ] **Type filter — image only.** Open mixed tabs (some `<img>`, some
      `<video>`). Use a selector that hits both kinds (e.g.
      `[data-media]`). Images on, Videos off. Preview counts only image
      tabs.
- [ ] **Type filter — video only.** Same setup. Images off, Videos on.
      Preview counts only video tabs.
- [ ] **Both types off.** Both checkboxes off. Preview reads "0 of M";
      Run is disabled.
- [ ] **Close tabs off.** Set close-tabs off. Run any matching tab.
      Verify: file saved, tab stays open. Result row shows `saved`
      pill.

## Design

- Design spec: [docs/superpowers/specs/2026-05-28-tab-media-reaper-design.md](docs/superpowers/specs/2026-05-28-tab-media-reaper-design.md)
- Implementation plan: [docs/superpowers/plans/2026-05-28-tab-media-reaper-plan.md](docs/superpowers/plans/2026-05-28-tab-media-reaper-plan.md)
- Phase-1 historical: [docs/superpowers/specs/2026-05-28-tab-image-reaper-design.md](docs/superpowers/specs/2026-05-28-tab-image-reaper-design.md)
- Working-session conventions for AI assistants: [CLAUDE.md](CLAUDE.md)
```

- [ ] **Step 2: Update `CLAUDE.md`**

The phase-1 CLAUDE.md (committed at `e78bb9b`) is structured around the pre-implementation state, hard constraints, locked decisions, architecture, MV3 gotchas, testing, and workflow guardrails. Phase 2 doesn't change the architecture, just the surface area.

Targeted edits (don't rewrite — patch):

- Top heading reference and intro: "**Project status**" section needs updating from "Pre-implementation" to reflect that phase 2 is the current cycle, with both phase-1 and phase-2 specs in the repo.

- "What this is" section: rename "tab-image-reaper" mentions to "tab-media-reaper" where they refer to the *current* project. Phase 1 reference stays.

- File-tree references and paths: every `tab-image-reaper` path becomes `tab-media-reaper`.

- The test URL changes: `http://localhost/tab-image-reaper/test/test.html` → `http://localhost/tab-media-reaper/test/test.html`.

Easiest: do a search-and-replace in CLAUDE.md for these literal strings:

```powershell
$path = "CLAUDE.md"
$text = Get-Content $path -Raw
$text = $text -replace "tab-image-reaper", "tab-media-reaper"
$text = $text -replace "Tab Image Reaper", "Tab Media Reaper"
$text = $text -replace "image-reaper", "media-reaper"
Set-Content -Path $path -Value $text -Encoding utf8
```

Then read the file back and:

1. Add a note near the top under "Project status" that phase 2 ships videos + toggles and that the phase-1 spec stays in repo as historical record. One paragraph.

2. Update the "Reference material outside this repo" section if it mentions the old name in paths — it doesn't currently, but verify.

After these edits, the file should describe the current project state coherently.

- [ ] **Step 3: Update `HANDOFF.md`**

Similar treatment. The phase-1 HANDOFF described "spec written, awaiting user approval before writing-plans runs." Phase 2 is past that gate. Replace the whole "Where you are in the workflow" section with a phase-2 summary:

```powershell
$path = "HANDOFF.md"
$text = Get-Content $path -Raw
$text = $text -replace "tab-image-reaper", "tab-media-reaper"
$text = $text -replace "Tab Image Reaper", "Tab Media Reaper"
Set-Content -Path $path -Value $text -Encoding utf8
```

Then manually update the "Where you are in the workflow" section to reflect that phase 1 shipped, phase 2 was brainstormed → spec → plan → implementation, and the next session picks up from whatever state HEAD is at.

If you'd rather leave HANDOFF.md as historical-only (it was written for the phase-1 handoff specifically), add a one-line note at the top: "Historical: this handoff describes the phase-1 starting state; see README.md and the phase-2 spec/plan for current state." That's defensible too.

- [ ] **Step 4: Verify no path references are stale**

```powershell
Get-ChildItem -Recurse -Include *.md -File | Select-String -Pattern "tab-image-reaper" | Select-Object Path, LineNumber, Line
```

Expected: matches ONLY in the historical files:
- `docs/superpowers/specs/2026-05-28-tab-image-reaper-design.md` (phase-1 spec, kept verbatim)
- `docs/superpowers/plans/2026-05-28-tab-image-reaper-plan.md` (phase-1 plan, kept verbatim)
- Anywhere the phase-2 spec or plan explicitly references the phase-1 name (e.g. "supersedes 2026-05-28-tab-image-reaper-design.md")

If there are matches outside those files (in `README.md`, `CLAUDE.md`, or `HANDOFF.md`), edit them.

- [ ] **Step 5: Commit**

```powershell
git add README.md CLAUDE.md HANDOFF.md
git commit -m @'
docs: rename references to tab-media-reaper, extend smoke checklist

README rewritten for phase 2: install / use steps reflect the new
folder and the toggle UI; smoke checklist gains 6 video / type-
filter / close-tabs cases per spec §11.3. CLAUDE.md and HANDOFF.md
updated to point at the phase-2 spec/plan. Phase-1 spec and plan
remain in docs/superpowers/ as historical record.
'@
```

---

## Task 10: End-to-end manual smoke + push

Final acceptance gate. No code is written unless a smoke step fails — in which case, debug, fix, commit, then re-run the failing step.

- [ ] **Step 1: Reload the extension cleanly**

In `chrome://extensions`, remove the existing extension and Load unpacked from `c:\wamp64\www\tab-media-reaper`. Service worker console: no red errors.

- [ ] **Step 2: Run the full phase-1 smoke checklist from README**

7 cases. Same as phase 1; they validate that the rename + engine refactor didn't break anything. Status pills should now say "No media URL" (where phase 1 said "No image URL").

- [ ] **Step 3: Run the 6 phase-2 smoke cases from README**

- [ ] Video happy path
- [ ] Blob-backed video (expected save-failed)
- [ ] Type filter — image only
- [ ] Type filter — video only
- [ ] Both types off → Run disabled
- [ ] Close tabs off → tabs stay

For each: observe what actually happens (not what should happen). Check `Downloads/<subfolder>/` for files. Check the tab strip for closures. Check the popup pill colors and labels.

- [ ] **Step 4: SW-termination sanity check (carried forward from phase 1)**

With one matching tab open and Close tabs on:
1. Click Run, close the popup immediately.
2. In `chrome://extensions`, click "service worker" → "Stop" to force-terminate the SW mid-download.
3. Expected: the download still completes; the tab still closes. Re-open the popup — it may show a toast about lost results.

Then with Close tabs OFF:
1. Run, close popup, force-terminate SW.
2. Expected: download completes; tab stays open (closeTabs=false snapshot was honored in recovery).

- [ ] **Step 5: Commit any fixes that came out of smoke testing**

Each fix is its own small commit with `fix:` prefix.

- [ ] **Step 6: Verify the working tree is clean and tests still pass**

```powershell
git status
```

Expected: `nothing to commit, working tree clean`.

Open the harness:

Expected: **52 passed, 0 failed**.

- [ ] **Step 7: Push to GitHub**

```powershell
git push
```

Expected: fast-forward push log ending with the new HEAD on `origin/main` at `dariobimbi/tab-media-reaper`.

If the push fails with a remote-URL error, re-check Task 1 step 3 (`git remote set-url origin ...`).

---

## Spec coverage cross-check

| Spec section | Covered by |
|---|---|
| §1.1 What it does | Tasks 5 (popup HTML), 6 (popup JS), 10 (smoke) |
| §1.2 Hard constraints | Carried forward verbatim; CLAUDE.md flags them |
| §1.3 Non-goals | Plan deliberately omits: HLS/DASH stitching, blob-to-dataURL bridge, subfolder splitting, parallel tuning, visual picker |
| §2 Architecture | Tasks 2 (resolve-video.js), 3 (engine extension), 4 (background wiring), 5–6 (popup) |
| §3 File layout | Tasks 2 (new files), 9 (docs paths) |
| §4.1 Persistent config | Task 4 (background defaults), Task 6 (popup read/write) |
| §4.2 In-memory batch state | Task 3 (engine result shape + `type` field) |
| §5.1 Popup-open flow | Tasks 4 (scan handler builds types), 6 (popup init + scan-on-toggle) |
| §5.2 Run flow | Task 3 (engine runBatch + extractor dispatch) |
| §5.3 Why serial | Unchanged from phase 1 |
| §5.4 SW-termination + closeTabs snapshot | Task 3 step 10 (session record gains closeTabs), step 13 (recovery test) |
| §5.5 Edit-and-save config | Task 6 (popup blur + checkbox change handlers) |
| §6 Message contract | Tasks 4 (handlers), 6 (senders + listener) |
| §7 Manifest | Task 7 |
| §8.1 resolveImageUrl | Unchanged from phase 1 |
| §8.2 resolveVideoUrl | Task 2 (impl + tests) |
| §8.3 filenameFromUrl | Unchanged; Task 8 adds confirmation tests |
| §9 Status taxonomy | Task 3 (rename), Task 5 (CSS selector rename), Task 6 (labelFor rename) |
| §10.1 Token block | Unchanged from phase 1 |
| §10.2 Layout (new checkbox rows) | Task 5 |
| §10.3 Motion & a11y | Task 5 (carve-outs extended) |
| §11.1 Unit tests | Tasks 2 (resolve-video), 3 (engine extensions), 8 (filename additions) |
| §11.2 Untested via shims | Unchanged from phase 1 |
| §11.3 Manual smoke | Tasks 9 (README checklist), 10 (execution) |
| §12 Migration plan | Task 1 |
| §13 What is not changing | Honored throughout; CLAUDE.md flags the invariants |

---

## Execution handoff

Plan complete and saved to `docs/superpowers/plans/2026-05-28-tab-media-reaper-plan.md`. Two execution options:

**1. Subagent-Driven (recommended)** — A fresh subagent runs each task, two-stage review between tasks. Best for keeping the main session lean and catching regressions early.

**2. Inline Execution** — Tasks executed in this session via `superpowers:executing-plans`, with checkpoints between groups of tasks (e.g. after Task 1, after Task 3, after Task 7, after Task 10). Faster wall-clock; reviews are batched.

Which approach?
