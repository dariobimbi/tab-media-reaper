# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project status

**Phase 2 shipped.** Phase 1 (`tab-image-reaper`) shipped image-only
support. Phase 2 (`tab-media-reaper`, this repo's current state) adds
`<video>` resolution, the Images/Videos toggle pair, and the
persisted Close-tabs toggle. The phase-1 spec and plan stay in
`docs/superpowers/` as historical record; the current contract lives
at `docs/superpowers/specs/2026-05-28-tab-media-reaper-design.md`
and `docs/superpowers/plans/2026-05-28-tab-media-reaper-plan.md`.

## What this is

A personal-use **Manifest V3 Chrome extension**. One toolbar click opens a popup showing
"N of M tabs match" for a user-edited CSS selector; on Run, the background service worker
saves the matching image or video from each non-pinned tab in the current window to
`Downloads/<subfolder>/` and optionally closes the tab on confirmed save.

Author: Dario. The project is the smaller sibling of [bimbi-stocker](../bimbi-stocker)
and deliberately mirrors its style (no build step, brand tokens, browser test harness).

## Hard constraints (non-negotiable — do not violate when implementing)

These are deliberate design boundaries, not omissions. Do not "improve" past them.

- **No build step.** Native ES modules, MV3, loaded unpacked from WAMP. No Webpack, Vite,
  or any bundler.
- **Local-only.** No server, no account, no network egress beyond the user-initiated
  downloads. `chrome.storage.local` is the single config source of truth.
- **Fail loudly, never silently.** Every tab the run touched must end up in `results[]`
  with one of `saved` / `save-failed` / `no-media-url` / `inaccessible`. The popup must
  show non-`saved` outcomes; never hide a failure. No tab is closed without a confirmed
  save.
- **Pinned tabs are sacred.** Filtered at `chrome.tabs.query` time. Never scanned, never
  closed.
- **No anti-bot or evasion behavior.** If a page is `chrome://` or otherwise restricted,
  surface `inaccessible` and move on.

## Decisions locked by brainstorming (do not re-litigate)

The spec records these; they came from explicit Q&A and are not up for revisit unless the
user reopens them:

- Media identification is a **single CSS selector**, edited in the popup (not options
  page, not a visual picker).
- Trigger is **toolbar click → popup**; preview count first, then Run.
- Scope is **non-pinned tabs in the current window only** — not all windows, no
  URL-pattern filter.
- Destination is **one fixed subfolder under Downloads**, name configurable.
- Filename is the URL's **leaf name**; Chrome's `conflictAction: "uniquify"` handles
  collisions.
- `<img>` / `<picture>` / `<source>` and `<video>` / `<source>`-in-`<video>` are
  resolved (via `currentSrc`). No CSS `background-image`, no inline SVG.
- Per-tab processing is **serial**, not parallel (see spec §5.3).

## Architecture (the parts that need cross-file understanding)

Two layers, isolated so the popup can close mid-run without stranding a batch:

- **Background service worker** (`src/background.js`) owns `chrome.tabs`,
  `chrome.downloads`, and `chrome.scripting`. It holds the in-memory batch state
  (`status`, `total`, `processed`, `results[]`), runs the scan, drives the per-tab
  state machine, and registers the `downloads.onChanged` listener at module top level
  (required for MV3 wake-up — see spec §5.4).
- **Popup** (`src/popup/`) is a thin view: reads/writes config to `chrome.storage.local`,
  sends `scan` / `saveConfig` / `run` / `getStatus` messages, renders `progress`
  broadcasts. It never touches `chrome.tabs`/`downloads`/`scripting` directly.

Two pure helpers in `src/lib/` are the primary TDD targets:

- `src/lib/resolve-image.js` — `resolveImageUrl(el)` for `<img>` / `<picture>` /
  `<source>` and `<video>` / `<source>`-in-`<video>`, preferring `currentSrc`. **Must**
  be listed in `manifest.json → web_accessible_resources` because the in-page extractor
  reaches it via `import(chrome.runtime.getURL(...))`.
- `src/lib/filename.js` — `filenameFromUrl(url)` returns the leaf with a `.jpg` extension
  fallback. Runs only in the background SW; **not** web-accessible.

Message contract (popup ↔ background) is fully specified in spec §6 — do not invent new
message types without updating the spec.

## MV3 gotchas you will hit

These are the ones that bit the bimbi-stocker work; they apply identically here.

- **Service workers terminate when idle.** The spec mitigates via a
  `chrome.storage.session` record per `downloadId`, so a wake-up event can still
  close the right tab. Do not invent a different mechanism.
- **Chrome's extension module cache is sticky.** When iterating on files loaded via
  `chrome.runtime.getURL` + dynamic `import()` (i.e. `resolve-image.js`), old bytes
  persist even across extension reload. Cache-bust with `?v=<n>` on the import URL
  during dev — bimbi-stocker's `background.js` shows the pattern.
- **`activeTab` is insufficient** for scanning every tab on toolbar click; that's why
  the manifest requests `host_permissions: ["<all_urls>"]`.
- **`chrome.scripting.executeScript` can't share variables with the background.** The
  injected function dynamically imports `resolve-image.js` via `chrome.runtime.getURL`,
  which is the reason that file is in `web_accessible_resources`.

## Testing

Mirrors bimbi-stocker: a browser harness, no Node, no jsdom.

- Pure modules (`resolve-image.js`, `filename.js`) get real unit tests in
  `test/*.test.js`, run via `test/harness.js` and `test/test.html`.
- `file://` blocks ES module imports in Chrome — tests **must** be served over HTTP.
  WAMP serves `c:\wamp64\www\` at `http://localhost/`, so the test URL is:
  `http://localhost/tab-media-reaper/test/test.html`.
- Background batch orchestration is exercised manually (spec §11.3 has the smoke-test
  checklist) and via dependency-injected `chrome.*` shims if a deeper unit test is
  needed — same approach as bimbi-stocker's engine tests.

## Workflow guardrails

Both phases have been approved and implemented. The general process for any future
phase would be: brainstorm → spec → user review → writing-plans → user review →
test-driven-development for pure modules → subagent-driven-development for the rest.

Use `superpowers:verification-before-completion` before claiming any step done.

## Reference material outside this repo

- **`c:\wamp64\www\bimbi-stocker`** — Dario's other MV3 extension. Same patterns, slightly
  larger. Its `CLAUDE.md`, `src/popup/popup.css` (the `--bs-*` token layer this project
  mirrors with `--tir-*`), and `src/background.js` are the closest reference
  implementations.
- **`c:\wamp64\www\dariobimbi.com\wp-content\themes\dariobimbi`** — original source for
  the brand palette and gradients (`theme.json`, `style.css`).
