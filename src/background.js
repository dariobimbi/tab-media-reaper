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
