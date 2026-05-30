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
