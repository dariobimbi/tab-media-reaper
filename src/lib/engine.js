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

  async function tabInfo(tabId) {
    try {
      const t = await chrome.tabs.get(tabId);
      return { url: t.url || "", title: t.title || "" };
    } catch {
      return { url: "", title: "" };
    }
  }

  function pushResult(r) {
    state.results.push(r);
    state.processed = state.results.length;
    safeBroadcast({ type: "progress", processed: state.processed, total: state.total, lastResult: r });
  }

  function safeBroadcast(msg) {
    try { broadcast(msg); } catch { /* popup may not be listening */ }
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

  // Register the single downloads.onChanged listener at engine-creation time.
  // background.js does NOT register a second listener — engine owns this.
  chrome.downloads.onChanged.addListener((delta) => { handleDownloadChanged(delta); });

  return { scan, runBatch, handleDownloadChanged, getState };
}
