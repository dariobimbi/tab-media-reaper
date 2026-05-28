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
