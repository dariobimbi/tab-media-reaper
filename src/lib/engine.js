import { filenameFromUrl } from "./filename.js";

export function createEngine({ chrome, broadcast }) {
  let state = { status: "idle", total: 0, processed: 0, results: [] };
  const pending = new Map(); // downloadId -> { resolve }

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

  async function processTab(tabId, selector, types, subfolder, closeTabs) {
    const info = await tabInfo(tabId);
    let extracted = null;
    try {
      extracted = await extractMedia(tabId, selector, types);
    } catch (err) {
      pushResult({ tabId, ...info, type: null, status: "inaccessible", error: String(err.message || err) });
      return;
    }
    if (!extracted || !extracted.url) {
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

  async function runBatch({ tabIds, selector, subfolder, types = ["image"], closeTabs = true }) {
    state = { status: "running", total: tabIds.length, processed: 0, results: [] };
    for (const tabId of tabIds) {
      await processTab(tabId, selector, types, subfolder, closeTabs);
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
    if (current === "complete" && rec.closeTabs) {
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
