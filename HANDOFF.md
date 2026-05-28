# Handoff — Tab Image Reaper

**Date:** 2026-05-28
**For:** A fresh Claude Code session, picking up this project cold.
**From:** Previous session that ran brainstorming → spec.

## Where you are in the workflow

The brainstorming skill (`superpowers:brainstorming`) was run to completion.
The design spec is written, committed, and is now waiting on **user review**.

**Do not write code yet.** The brainstorming skill's hard gate says: no
implementation skills, no code, no scaffolding until the user approves the
spec AND an implementation plan derived from it.

Sequence:

1. ✅ Brainstorm with the user, lock decisions.
2. ✅ Write the design spec.
3. ✅ Commit the spec to a fresh git repo (root commit `3be5bf2`).
4. ⏳ **User reviews the spec.** ← we are here
5. ⏳ User approves → invoke `superpowers:writing-plans` to produce
   the implementation plan.
6. ⏳ User reviews the plan.
7. ⏳ User approves → implementation begins (subagent-driven-development,
   TDD per the spec).

When you read the user's next message, treat it as their response to the
spec — apply requested changes inline, re-commit, and ask again before
moving to writing-plans. Only after they explicitly approve do you invoke
`superpowers:writing-plans`.

## What the project is

A personal-use Manifest V3 Chrome extension. One toolbar click → popup shows
"N of M tabs match" for a user-edited CSS selector → Run → for each matching
non-pinned tab in the current window, save its image to
`Downloads/<subfolder>/` and close the tab on successful save. Tabs that
don't match are untouched; tabs whose download fails stay open with a
visible error in the popup.

**Author:** Dario (`dario@clickswebdesign.com`). His personal-tool style is
already established by his other extension, `bimbi-stocker`. This project
mirrors that style.

## Where things live

| Thing | Path |
|---|---|
| Project root | `c:\wamp64\www\tab-image-reaper` |
| Design spec (the source of truth) | `docs/superpowers/specs/2026-05-28-tab-image-reaper-design.md` |
| Git | Initialized, branch `main`, root commit `3be5bf2`. No remote. |
| Reference implementation to study | `c:\wamp64\www\bimbi-stocker` (Dario's other MV3 extension — same patterns) |
| Brand source (palette, gradients, tokens) | `c:\wamp64\www\dariobimbi.com\wp-content\themes\dariobimbi\theme.json` + `style.css` |
| Brand mirror in code (closest pattern to copy) | `c:\wamp64\www\bimbi-stocker\src\popup\popup.css` (the `--bs-*` token layer) |

Read the spec before doing anything else. It is the contract.

## Hard constraints (do not violate)

These were locked in brainstorming and mirror Dario's bimbi-stocker style:

- **No build step.** Native ES modules. No Webpack, no Vite, no bundler.
  Loaded unpacked from WAMP.
- **Local-only.** No server, no account. `chrome.storage.local` is the
  single config source of truth.
- **Fail loudly, never silently.** Every tab the run touched must end up
  in `results[]` with one of `saved` / `save-failed` / `no-image-url` /
  `inaccessible`. The popup must show non-`saved` outcomes; never hide a
  failure.
- **Pinned tabs are sacred.** Filtered at query time. Never scanned,
  never closed.
- **No anti-bot or evasion behavior.** If a page is `chrome://` or
  restricted, surface `inaccessible` and move on.

## Decisions locked by the brainstorm (don't re-litigate)

These were chosen via explicit Q&A — push back only if the user does:

- Identify image: **DOM selector** (CSS), single selector edited in the popup
  (not options page, not picker).
- Trigger: **toolbar click** opens popup; preview count first, then Run.
- Scope: **all non-pinned tabs in the current window only**. Not all
  windows. Not URL-pattern filtered.
- Destination: **one fixed subfolder under Downloads**, name configurable.
- Filename: **original from URL leaf**. Chrome auto-suffixes collisions.
- Element kinds: `<img>`, `<picture>`, `<source>`. Resolved via `currentSrc`.
- On save failure: **leave tab open**, never close without a confirmed save.

## Gotchas you'll hit otherwise

- **`file://` blocks ES module imports in Chrome.** Tests must be served
  over HTTP — the URL is `http://localhost/tab-image-reaper/test/test.html`
  (WAMP serves `c:\wamp64\www\` at `http://localhost/`).
- **Chrome's extension module cache is sticky.** When iterating on
  `src/lib/*.js` files imported dynamically via `chrome.runtime.getURL`,
  the old bytes hang around even after extension reload. Cache-bust with
  `?v=<n>` on the import URL during dev. (See bimbi-stocker's
  `background.js` — recent commits added this workaround.)
- **MV3 service workers terminate.** The spec already handles this via
  `chrome.storage.session` records keyed by downloadId. Do not invent a
  different mechanism.
- **`activeTab` is not enough** to scan every tab on toolbar click — it's
  only granted to the active tab. The manifest requests
  `host_permissions: ["<all_urls>"]` for this reason. Documented in §7.
- **`chrome.scripting.executeScript`** can't share variables with the
  background. The injected function dynamically imports
  `src/lib/resolve-image.js` via `chrome.runtime.getURL`. That file must
  be in `web_accessible_resources`. Spec §7 has the manifest.

## Memory context the user has built up

The user's persistent memory (in
`C:\Users\dario\.claude\projects\c--wamp64-www-bimbi-stocker\memory\`) is
scoped to the `bimbi-stocker` directory. When working from
`tab-image-reaper`, those memories are NOT auto-loaded.

The relevant facts have been inlined into this handoff and into the spec.
If you need more context, the bimbi-stocker project is right next door —
read its `CLAUDE.md`, its `popup.css`, and its `background.js` for the
exact patterns to mirror.

## Skills to invoke (in order)

When the user approves the spec:

1. `superpowers:writing-plans` — produce the implementation plan from the
   spec. The plan lives in `docs/superpowers/plans/` and gets its own
   user review.
2. After the plan is approved: `superpowers:test-driven-development` for
   the pure modules (`resolve-image.js`, `filename.js`), then
   `superpowers:subagent-driven-development` for the rest (background SW,
   popup, manifest, README).
3. Use `superpowers:verification-before-completion` before claiming any
   step done.

Do not jump ahead. Do not invoke `frontend-design`. Do not write code in
this session until the user has explicitly approved both the spec AND the
plan.

## Your first message to the user

Something brief like:

> Picked up the tab-image-reaper handoff. The spec is at
> `docs/superpowers/specs/2026-05-28-tab-image-reaper-design.md`. Have
> you reviewed it? Any changes before I run writing-plans?
