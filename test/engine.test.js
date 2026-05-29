import { test, eq, ok } from "./harness.js";
import { createEngine } from "../src/lib/engine.js";
import { makeChromeShim } from "./fixtures.js";

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
    { tabId: 2, matched: false, type: null,    url: "https://b.example/", title: "B" },
  ]);
});

test("scan: executeScript rejection becomes matched=false (inaccessible at preview)", async () => {
  const chrome = makeChromeShim();
  chrome._setTab({ id: 1, url: "chrome://settings", title: "Settings", pinned: false });
  chrome._setScriptThrows(1, new Error("Cannot access contents of url"));

  const engine = createEngine({ chrome, broadcast: () => {} });
  const tabs = await engine.scan({ selector: "img", types: ["image"] });

  eq(tabs.length, 1);
  eq(tabs[0].matched, false);
  eq(tabs[0].type, null);
});

test("scan: pinned tabs are excluded by the shim's query filter", async () => {
  const chrome = makeChromeShim();
  chrome._setTab({ id: 1, url: "https://a.example/", title: "A", pinned: false });
  chrome._setTab({ id: 2, url: "https://b.example/", title: "B", pinned: true });
  chrome._setScriptResult(1, { matched: true, type: "image" });
  // tab 2 must never be invoked — no script staged.

  const engine = createEngine({ chrome, broadcast: () => {} });
  const tabs = await engine.scan({ selector: "img", types: ["image"] });

  eq(tabs.map((t) => t.tabId), [1]);
});

function asyncTick() { return new Promise((r) => setTimeout(r, 0)); }

test("runBatch: single tab, image resolves, download completes -> saved + tab closed", async () => {
  const chrome = makeChromeShim();
  chrome._setTab({ id: 1, url: "https://a.example/", title: "A", pinned: false });
  chrome._setScriptResult(1, { url: "https://a.example/photo.jpg", type: "image" });

  const engine = createEngine({ chrome, broadcast: () => {} });
  const runPromise = engine.runBatch({
    tabIds: [1], selector: "img.hero", subfolder: "tir",
  });

  // Let the download be issued, then fire complete.
  await asyncTick();
  chrome._fireDownloadComplete(1);
  await runPromise;

  const s = engine.getState();
  eq(s.status, "done");
  eq(s.results.length, 1);
  eq(s.results[0].status, "saved");
  eq(s.results[0].type, "image");
  eq(s.results[0].filename, "photo.jpg");
  eq(s.results[0].url, "https://a.example/");   // url+title come from tabs.get
  eq(s.results[0].title, "A");
  eq(chrome._tabsRemaining(), []); // tab was closed
  eq(chrome._downloads[0].filename, "tir/photo.jpg");
  eq(chrome._downloads[0].conflictAction, "uniquify");
});

test("runBatch: extractor returns null -> no-media-url, tab left open, no download", async () => {
  const chrome = makeChromeShim();
  chrome._setTab({ id: 1, url: "https://a.example/", title: "A", pinned: false });
  chrome._setScriptResult(1, null);

  const engine = createEngine({ chrome, broadcast: () => {} });
  await engine.runBatch({ tabIds: [1], selector: "div", subfolder: "tir" });

  const s = engine.getState();
  eq(s.results[0].status, "no-media-url");
  eq(chrome._tabsRemaining(), [1]); // tab remains
  eq(chrome._downloads.length, 0);
});

test("runBatch: extractor throws -> inaccessible, tab left open", async () => {
  const chrome = makeChromeShim();
  chrome._setTab({ id: 1, url: "chrome://settings", title: "Settings", pinned: false });
  chrome._setScriptThrows(1, new Error("Cannot access"));

  const engine = createEngine({ chrome, broadcast: () => {} });
  await engine.runBatch({ tabIds: [1], selector: "img", subfolder: "tir" });

  const s = engine.getState();
  eq(s.results[0].status, "inaccessible");
  ok(s.results[0].error.includes("Cannot access"));
  eq(chrome._tabsRemaining(), [1]);
});

test("runBatch: download interrupted -> save-failed, tab left open", async () => {
  const chrome = makeChromeShim();
  chrome._setTab({ id: 1, url: "https://a.example/", title: "A", pinned: false });
  chrome._setScriptResult(1, { url: "https://a.example/photo.jpg", type: "image" });

  const engine = createEngine({ chrome, broadcast: () => {} });
  const runPromise = engine.runBatch({ tabIds: [1], selector: "img", subfolder: "tir" });
  await asyncTick();
  chrome._fireDownloadInterrupted(1, "SERVER_FAILED");
  await runPromise;

  const s = engine.getState();
  eq(s.results[0].status, "save-failed");
  eq(s.results[0].error, "SERVER_FAILED");
  eq(chrome._tabsRemaining(), [1]);
});

test("runBatch: serial — second tab waits for first download to settle", async () => {
  const chrome = makeChromeShim();
  chrome._setTab({ id: 1, url: "https://a.example/", title: "A", pinned: false });
  chrome._setTab({ id: 2, url: "https://b.example/", title: "B", pinned: false });
  chrome._setScriptResult(1, { url: "https://a.example/a.jpg", type: "image" });
  chrome._setScriptResult(2, { url: "https://b.example/b.jpg", type: "image" });

  const engine = createEngine({ chrome, broadcast: () => {} });
  const runPromise = engine.runBatch({ tabIds: [1, 2], selector: "img", subfolder: "tir" });

  // After one tick, only the first download should be issued.
  await asyncTick();
  eq(chrome._downloads.length, 1);
  eq(chrome._downloads[0].id, 1);

  chrome._fireDownloadComplete(1);
  await asyncTick();
  eq(chrome._downloads.length, 2);
  eq(chrome._downloads[1].id, 2);

  chrome._fireDownloadComplete(2);
  await runPromise;

  const s = engine.getState();
  eq(s.results.map((r) => r.status), ["saved", "saved"]);
});

test("runBatch: emits progress broadcast after each tab", async () => {
  const chrome = makeChromeShim();
  chrome._setTab({ id: 1, url: "https://a.example/", title: "A", pinned: false });
  chrome._setScriptResult(1, { url: "https://a.example/photo.jpg", type: "image" });

  const broadcasts = [];
  const engine = createEngine({ chrome, broadcast: (m) => broadcasts.push(m) });
  const runPromise = engine.runBatch({ tabIds: [1], selector: "img", subfolder: "tir" });
  await asyncTick();
  chrome._fireDownloadComplete(1);
  await runPromise;

  const types = broadcasts.map((b) => b.type);
  ok(types.includes("progress"));
  ok(types.includes("done"));
  const done = broadcasts.find((b) => b.type === "done");
  eq(done.results.length, 1);
});

test("runBatch: writes a session record per download and clears it on settle", async () => {
  const chrome = makeChromeShim();
  chrome._setTab({ id: 1, url: "https://a.example/", title: "A", pinned: false });
  chrome._setScriptResult(1, { url: "https://a.example/photo.jpg", type: "image" });

  const engine = createEngine({ chrome, broadcast: () => {} });
  const runPromise = engine.runBatch({ tabIds: [1], selector: "img", subfolder: "tir" });

  await asyncTick();
  // Session record should exist while the download is in flight.
  ok(chrome._session["downloads.1"]);
  eq(chrome._session["downloads.1"].tabId, 1);

  chrome._fireDownloadComplete(1);
  await runPromise;

  // Cleared after the download settles.
  eq(chrome._session["downloads.1"], undefined);
});

test("handleDownloadChanged: SW-restart recovery — uses session record to close tab", async () => {
  // Simulate: engine was created fresh (no pending), but a session record
  // remains from a previous SW lifetime. A 'complete' delta must close
  // the recorded tab and clear the record.
  const chrome = makeChromeShim();
  chrome._setTab({ id: 7, url: "https://x.example/", title: "X", pinned: false });
  await chrome.storage.session.set({
    "downloads.42": { downloadId: 42, tabId: 7, tabUrl: "https://x.example/", tabTitle: "X", closeTabs: true },
  });

  const engine = createEngine({ chrome, broadcast: () => {} });
  await engine.handleDownloadChanged({ id: 42, state: { current: "complete" } });

  eq(chrome._tabsRemaining(), []); // tab closed
  eq(chrome._session["downloads.42"], undefined); // record cleared
});

test("handleDownloadChanged: SW-restart, interrupted -> tab stays, record cleared", async () => {
  const chrome = makeChromeShim();
  chrome._setTab({ id: 7, url: "https://x.example/", title: "X", pinned: false });
  await chrome.storage.session.set({
    "downloads.42": { downloadId: 42, tabId: 7, tabUrl: "https://x.example/", tabTitle: "X" },
  });

  const engine = createEngine({ chrome, broadcast: () => {} });
  await engine.handleDownloadChanged({
    id: 42, state: { current: "interrupted" }, error: { current: "NETWORK_FAILED" },
  });

  eq(chrome._tabsRemaining(), [7]); // tab still there
  eq(chrome._session["downloads.42"], undefined); // record cleared
});

test("runBatch: chrome.downloads.download throws -> save-failed, tab left open, no session record", async () => {
  const chrome = makeChromeShim();
  chrome._setTab({ id: 1, url: "https://a.example/", title: "A", pinned: false });
  chrome._setScriptResult(1, { url: "https://a.example/photo.jpg", type: "image" });
  // Force the download call itself to reject.
  chrome.downloads.download = async () => { throw new Error("INVALID_FILENAME"); };

  const engine = createEngine({ chrome, broadcast: () => {} });
  await engine.runBatch({ tabIds: [1], selector: "img", subfolder: "tir" });

  const s = engine.getState();
  eq(s.status, "done");
  eq(s.results[0].status, "save-failed");
  ok(s.results[0].error.includes("INVALID_FILENAME"));
  eq(chrome._tabsRemaining(), [1]);
  // No session record should exist — we never got far enough to write one.
  eq(Object.keys(chrome._session).length, 0);
});

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
