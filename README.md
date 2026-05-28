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
