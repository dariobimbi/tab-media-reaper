import { test, eq, ok } from "./harness.js";
import { createEngine } from "../src/lib/engine.js";
import { makeChromeShim } from "./fixtures.js";

test("scan: queries non-pinned tabs in current window, runs selector test per tab", async () => {
  const chrome = makeChromeShim();
  chrome._setTab({ id: 1, url: "https://a.example/", title: "A", pinned: false });
  chrome._setTab({ id: 2, url: "https://b.example/", title: "B", pinned: false });
  chrome._setScriptResult(1, { matched: true });
  chrome._setScriptResult(2, { matched: false });

  const engine = createEngine({ chrome, broadcast: () => {} });
  const tabs = await engine.scan({ selector: "img.hero" });

  eq(tabs, [
    { tabId: 1, matched: true,  url: "https://a.example/", title: "A" },
    { tabId: 2, matched: false, url: "https://b.example/", title: "B" },
  ]);
});

test("scan: executeScript rejection becomes matched=false (inaccessible at preview)", async () => {
  const chrome = makeChromeShim();
  chrome._setTab({ id: 1, url: "chrome://settings", title: "Settings", pinned: false });
  chrome._setScriptThrows(1, new Error("Cannot access contents of url"));

  const engine = createEngine({ chrome, broadcast: () => {} });
  const tabs = await engine.scan({ selector: "img" });

  eq(tabs.length, 1);
  eq(tabs[0].matched, false);
});

test("scan: pinned tabs are excluded by the shim's query filter", async () => {
  const chrome = makeChromeShim();
  chrome._setTab({ id: 1, url: "https://a.example/", title: "A", pinned: false });
  chrome._setTab({ id: 2, url: "https://b.example/", title: "B", pinned: true });
  chrome._setScriptResult(1, { matched: true });
  // tab 2 must never be invoked — no script staged.

  const engine = createEngine({ chrome, broadcast: () => {} });
  const tabs = await engine.scan({ selector: "img" });

  eq(tabs.map((t) => t.tabId), [1]);
});

function asyncTick() { return new Promise((r) => setTimeout(r, 0)); }

test("runBatch: single tab, image resolves, download completes -> saved + tab closed", async () => {
  const chrome = makeChromeShim();
  chrome._setTab({ id: 1, url: "https://a.example/", title: "A", pinned: false });
  chrome._setScriptResult(1, "https://a.example/photo.jpg");

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
  eq(s.results[0].filename, "photo.jpg");
  eq(s.results[0].url, "https://a.example/");   // url+title come from tabs.get
  eq(s.results[0].title, "A");
  eq(chrome._tabsRemaining(), []); // tab was closed
  eq(chrome._downloads[0].filename, "tir/photo.jpg");
  eq(chrome._downloads[0].conflictAction, "uniquify");
});

test("runBatch: extractor returns null -> no-image-url, tab left open, no download", async () => {
  const chrome = makeChromeShim();
  chrome._setTab({ id: 1, url: "https://a.example/", title: "A", pinned: false });
  chrome._setScriptResult(1, null);

  const engine = createEngine({ chrome, broadcast: () => {} });
  await engine.runBatch({ tabIds: [1], selector: "div", subfolder: "tir" });

  const s = engine.getState();
  eq(s.results[0].status, "no-image-url");
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
  chrome._setScriptResult(1, "https://a.example/photo.jpg");

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
  chrome._setScriptResult(1, "https://a.example/a.jpg");
  chrome._setScriptResult(2, "https://b.example/b.jpg");

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
  chrome._setScriptResult(1, "https://a.example/photo.jpg");

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
  chrome._setScriptResult(1, "https://a.example/photo.jpg");

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
    "downloads.42": { downloadId: 42, tabId: 7, tabUrl: "https://x.example/", tabTitle: "X" },
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
