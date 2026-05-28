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
          if (typeof key === "object") return Object.fromEntries(Object.keys(key).map((k) => [k, session[k] ?? key[k]]));
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
