const DEFAULT_SELECTOR = "";
const DEFAULT_SUBFOLDER = "tab-media-reaper";
const DEFAULT_INCLUDE_IMAGES = true;
const DEFAULT_INCLUDE_VIDEOS = false;
const DEFAULT_CLOSE_TABS = true;

const $selector       = document.getElementById("selector");
const $subfolder      = document.getElementById("subfolder");
const $includeImages  = document.getElementById("include-images");
const $includeVideos  = document.getElementById("include-videos");
const $closeTabs      = document.getElementById("close-tabs");
const $match          = document.getElementById("match-count");
const $total          = document.getElementById("total-count");
const $run            = document.getElementById("run");
const $results        = document.getElementById("results");

let scanTabs = [];
let running  = false;

init().catch((err) => console.error("[tmr] init failed", err));

async function init() {
  const cfg = await chrome.storage.local.get({
    selector: DEFAULT_SELECTOR,
    subfolder: DEFAULT_SUBFOLDER,
    includeImages: DEFAULT_INCLUDE_IMAGES,
    includeVideos: DEFAULT_INCLUDE_VIDEOS,
    closeTabs: DEFAULT_CLOSE_TABS,
  });
  $selector.value        = cfg.selector;
  $subfolder.value       = cfg.subfolder;
  $includeImages.checked = cfg.includeImages;
  $includeVideos.checked = cfg.includeVideos;
  $closeTabs.checked     = cfg.closeTabs;

  $selector.addEventListener("blur", saveConfig);
  $subfolder.addEventListener("blur", saveConfig);
  $selector.addEventListener("change", scan);
  $includeImages.addEventListener("change", onTypeToggle);
  $includeVideos.addEventListener("change", onTypeToggle);
  $closeTabs.addEventListener("change", saveConfig);  // no rescan; doesn't affect what matches
  $run.addEventListener("click", runBatch);

  // Re-attach to an in-flight run, if any.
  const status = await sendMessage({ type: "getStatus" });
  if (status && status.status === "running") {
    running = true;
    renderResults(status.results);
    setRunButton(status.processed, status.total);
  }

  chrome.runtime.onMessage.addListener(onBroadcast);

  await scan();
}

async function onTypeToggle() {
  await saveConfig();
  await scan();
}

async function saveConfig() {
  await sendMessage({
    type: "saveConfig",
    selector:       $selector.value || DEFAULT_SELECTOR,
    subfolder:      $subfolder.value || DEFAULT_SUBFOLDER,
    includeImages:  $includeImages.checked,
    includeVideos:  $includeVideos.checked,
    closeTabs:      $closeTabs.checked,
  });
}

async function scan() {
  if (running) return;
  await saveConfig();
  const resp = await sendMessage({ type: "scan" });
  scanTabs = (resp && resp.tabs) || [];
  const matched = scanTabs.filter((t) => t.matched).length;
  $match.textContent = String(matched);
  $total.textContent = String(scanTabs.length);
  const anyTypeOn = $includeImages.checked || $includeVideos.checked;
  $run.disabled = matched === 0 || !anyTypeOn || !$selector.value;
}

async function runBatch() {
  if (running) return;
  await saveConfig();
  const tabIds = scanTabs.filter((t) => t.matched).map((t) => t.tabId);
  if (tabIds.length === 0) return;
  running = true;
  setRunButton(0, tabIds.length);
  $results.innerHTML = "";
  const ack = await sendMessage({ type: "run", tabIds });
  if (!ack || !ack.ack) {
    running = false;
    setRunButton();
  }
}

function onBroadcast(msg) {
  if (!msg || !msg.type) return;
  if (msg.type === "progress") {
    setRunButton(msg.processed, msg.total);
    appendResult(msg.lastResult);
  } else if (msg.type === "done") {
    running = false;
    setRunButton();
    scan().catch((err) => console.error("[tmr] scan failed after done", err));
  }
}

function setRunButton(processed, total) {
  if (running && total != null) {
    $run.textContent = `Working… (${processed}/${total})`;
    $run.disabled = true;
  } else {
    $run.textContent = "Run";
    const matched = scanTabs.filter((t) => t.matched).length;
    const anyTypeOn = $includeImages.checked || $includeVideos.checked;
    $run.disabled = running || matched === 0 || !anyTypeOn || !$selector.value;
  }
}

function renderResults(results) {
  $results.innerHTML = "";
  for (const r of results) appendResult(r);
}

function appendResult(r) {
  if (!r) return;
  const li = document.createElement("li");
  li.className = "tir-result";

  const pill = document.createElement("span");
  pill.className = "tir-pill";
  pill.dataset.status = r.status;
  pill.title = labelFor(r.status);
  li.appendChild(pill);

  const title = document.createElement("div");
  title.className = "tir-result-title";
  title.textContent = r.title || r.url || "(no title)";
  li.appendChild(title);

  const sub = document.createElement("div");
  sub.className = "tir-result-url";
  sub.textContent = r.url || "";
  li.appendChild(sub);

  if (r.status === "saved" && r.filename) {
    const note = document.createElement("div");
    note.className = "tir-result-note";
    note.textContent = `saved → ${r.filename}`;
    li.appendChild(note);
  } else if (r.error) {
    const err = document.createElement("div");
    err.className = "tir-result-error";
    err.textContent = `${labelFor(r.status)} — ${r.error}`;
    li.appendChild(err);
  } else if (r.status !== "saved") {
    const note = document.createElement("div");
    note.className = "tir-result-error";
    note.textContent = labelFor(r.status);
    li.appendChild(note);
  }
  $results.appendChild(li);
}

function labelFor(status) {
  switch (status) {
    case "saved":         return "Saved";
    case "save-failed":   return "Save failed";
    case "no-media-url":  return "No media URL";
    case "inaccessible":  return "Inaccessible";
    default:              return status;
  }
}

function sendMessage(msg) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(msg, (resp) => {
      void chrome.runtime.lastError;
      resolve(resp);
    });
  });
}
