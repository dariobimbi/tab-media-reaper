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
