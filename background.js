importScripts("defaults.js", "idb.js");
try { importScripts("config.js"); } catch { /* optional local override, not shipped */ }

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
let schemaCache = { endpoint: null, tools: null };

async function getConfig() {
  const stored = await chrome.storage.local.get(Object.keys(ATLAS_DEFAULTS));
  const cfg = { ...ATLAS_DEFAULTS };
  for (const k of Object.keys(cfg)) {
    if (typeof stored[k] === "string" && stored[k] !== "") cfg[k] = stored[k];
  }
  return cfg;
}

async function rpc(cfg, method, params) {
  if (!cfg.endpoint || !cfg.token) throw new Error("Add your Atlas endpoint and access key in Atlas Saver settings");
  let res;
  try {
    res = await fetch(cfg.endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${cfg.token}`,
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream"
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: Date.now(), method, ...(params ? { params } : {}) })
    });
  } catch {
    throw new Error("Atlas isn't running. Open Atlas and try again.");
  }
  if (res.status === 401) throw new Error("Atlas didn't accept the access key. Paste the current key in Atlas Saver settings.");
  if (!res.ok) throw new Error(`Atlas couldn't take the request (${res.status}). Try again, or restart Atlas.`);

  const text = await res.text();
  let msg;
  if ((res.headers.get("content-type") || "").includes("event-stream")) {
    const lines = text.split(/\r?\n/).filter((l) => l.startsWith("data:"));
    msg = JSON.parse(lines[lines.length - 1].slice(5));
  } else {
    msg = JSON.parse(text);
  }
  if (msg.error) throw new Error(msg.error.message || "Atlas error");
  return msg.result;
}

async function callTool(cfg, name, args) {
  const result = await rpc(cfg, "tools/call", { name, arguments: args });
  const text = (result?.content || []).filter((c) => c.type === "text").map((c) => c.text).join("\n");
  if (result?.isError) throw new Error(text.slice(0, 140) || `Atlas refused ${name} without a reason`);
  let data = result?.structuredContent ?? null;
  if (!data) {
    try { data = JSON.parse(text); } catch { data = null; }
  }
  return { text, data };
}

// Read the tool's real parameter names from Atlas instead of guessing them.
async function toolProps(cfg, name) {
  if (schemaCache.endpoint !== cfg.endpoint || !schemaCache.tools) {
    try {
      const result = await rpc(cfg, "tools/list");
      schemaCache = { endpoint: cfg.endpoint, tools: result?.tools || [] };
    } catch (e) {
      if (/running|key/.test(e.message)) throw e;
      return null;
    }
  }
  const tool = schemaCache.tools.find((t) => t.name === name);
  return tool?.inputSchema?.properties || null;
}

function idsFrom(value, out = []) {
  if (!value) return out;
  if (typeof value === "string") {
    const m = value.match(UUID);
    if (m) out.push(...m);
  } else if (Array.isArray(value)) {
    value.forEach((v) => idsFrom(v, out));
  } else if (typeof value === "object") {
    if (typeof value.id === "string") idsFrom(value.id, out);
    for (const k of ["item_id", "item_ids", "item", "items", "existing", "existing_id"]) idsFrom(value[k], out);
  }
  return out;
}

// Write the post/page URL onto the saved items. Tries the batch first, then one by one,
// so a stray id in the reply can't stop the real items from getting their link.
async function attachSource(cfg, ids, sourceUrl) {
  const props = await toolProps(cfg, "set_metadata");
  if (props && !("source_url" in props)) return false;
  const batch = !props || "item_ids" in props;
  const single = props && ["item_id", "id"].find((k) => k in props);
  if (batch) {
    try {
      await callTool(cfg, "set_metadata", { item_ids: ids, source_url: sourceUrl });
      return true;
    } catch { /* fall through to one by one */ }
  }
  let ok = false;
  for (const id of ids) {
    const args = batch ? { item_ids: [id] } : { [single || "item_id"]: id };
    try {
      await callTool(cfg, "set_metadata", { ...args, source_url: sourceUrl });
      ok = true;
    } catch { /* not an item id */ }
  }
  return ok;
}

// Atlas answers a save with just {"imported": n, "ok": true} — no ids. So the items
// are looked up afterwards: the n newest items added since the save began.
function itemIds(data) {
  if (!data || typeof data !== "object") return [];
  const lists = Array.isArray(data) ? [data] : Object.values(data).filter(Array.isArray);
  for (const list of lists) {
    const ids = list.map((x) => (typeof x === "string" ? x : x?.id)).filter((id) => typeof id === "string" && /^[0-9a-f-]{36}$/i.test(id));
    if (ids.length) return ids;
  }
  return [];
}

async function newestItems(cfg, sinceIso, count) {
  const props = await toolProps(cfg, "search_items");
  const args = {};
  const put = (k, v) => { if (!props || k in props) args[k] = v; };
  put("added_after", sinceIso);
  put("sort", "date_added");
  put("order", "desc");
  put("limit", count);
  const { data } = await callTool(cfg, "search_items", args);
  return itemIds(data).slice(0, count);
}

/* ---------- note and tags ---------- */

const cleanTags = (tags) => [...new Set((tags || []).map((t) => String(t).trim()).filter(Boolean))].slice(0, 30);

// Put the user's note (Atlas "annotation") and tags on the saved items.
async function applyExtras(cfg, ids, { note, tags } = {}) {
  note = (note || "").trim();
  tags = cleanTags(tags);
  if (!note && !tags.length) return {};
  if (!ids.length) return { noted: false };
  let ok = true;
  if (note) {
    try { await callTool(cfg, "set_metadata", { item_ids: ids, annotation: note }); }
    catch { ok = false; }
  }
  if (tags.length) {
    try { await callTool(cfg, "add_tags", { item_ids: ids, tags }); }
    catch { ok = false; }
  }
  return { noted: ok };
}

let tagCache = { at: 0, names: [] };
async function libraryTags() {
  if (Date.now() - tagCache.at < 60000) return tagCache.names;
  const cfg = await getConfig();
  const { data } = await callTool(cfg, "list_tags", {});
  const list = Array.isArray(data) ? data : data?.tags || [];
  const names = list
    .map((t) => (typeof t === "string" ? { name: t, n: 0 } : { name: t?.name, n: t?.count ?? t?.item_count ?? 0 }))
    .filter((t) => t.name)
    .sort((a, b) => b.n - a.n)
    .map((t) => t.name);
  tagCache = { at: Date.now(), names };
  return names;
}

/* ---------- the page itself as a link card ---------- */

async function saveLink({ url, note, tags }) {
  const cfg = await getConfig();
  const args = { url };
  const since = new Date(Math.floor(Date.now() / 1000) * 1000).toISOString().replace(".000Z", "Z");
  const { data, text } = await callTool(cfg, "add_link", args);
  const extras = { note, tags };
  const needExtras = !!((note || "").trim() || cleanTags(tags).length);
  if (!needExtras) return { ok: true };
  let ids = JSON.stringify(data ?? text ?? "").match(UUID) || [];
  if (!ids.length) ids = await newestItems(cfg, since, 1).catch(() => []);
  return { ok: true, ...(await applyExtras(cfg, [...new Set(ids)].slice(0, 1), extras)) };
}

/* ---------- videos macOS can't read ---------- */
// Atlas imports through macOS, which can't open WebM (VP8/VP9/AV1). Those are played
// in the offscreen page and re-recorded as H.264 MP4, then imported as a file.

const IMPORT_FAILED = /import failed|couldn.t (be )?(read|open)|unsupported|not supported/i;
const isWebm = (url) => /\.(webm|mkv|ogv)(\?|#|$)/i.test(url);

function videoName(url) {
  let base = "";
  try { base = decodeURIComponent(new URL(url).pathname.split("/").pop() || ""); } catch {}
  base = slug(base.replace(/\.[a-z0-9]{2,4}$/i, ""));
  return `${base || "video"}-${stamp()}.mp4`;
}

async function saveConverted(url, sourceUrl, extras) {
  const key = `video-${Date.now()}`;
  await ensureOffscreen();
  const made = await chrome.runtime.sendMessage({ target: "offscreen", type: "to-mp4", url, key });
  if (!made?.ok) throw new Error(made?.error || "Couldn't convert the video");
  try {
    const blob = await ShotStore.get(key);
    if (!blob) throw new Error("Converted video went missing");
    const res = await importBlob(blob, videoName(url), sourceUrl, extras);
    return { ...res, converted: true };
  } finally {
    ShotStore.del(key).catch(() => {});
  }
}

async function save({ url, sourceUrl, note, tags }) {
  const extras = { note, tags };
  if (isWebm(url)) return saveConverted(url, sourceUrl, extras);
  try {
    return await saveViaAtlas({ url, sourceUrl }, extras);
  } catch (e) {
    // Atlas fetched the file but macOS couldn't open it: convert it ourselves.
    if (!IMPORT_FAILED.test(e.message || "")) throw e;
    try {
      return await saveConverted(url, sourceUrl, extras);
    } catch {
      throw e;
    }
  }
}

async function saveViaAtlas({ url, sourceUrl }, extras = {}) {
  const cfg = await getConfig();
  const args = { url };

  // Whole seconds, no fraction: the safest ISO 8601 form for Atlas to parse.
  const since = new Date(Math.floor(Date.now() / 1000) * 1000).toISOString().replace(".000Z", "Z");
  const { data } = await callTool(cfg, "save_media_from_url", args);
  const imported = Number(data?.imported ?? 1);
  if (imported < 1) return { ok: true, duplicate: true, linked: true };

  const needLink = !!sourceUrl && sourceUrl !== url;
  const needExtras = !!((extras.note || "").trim() || cleanTags(extras.tags).length);
  if (!needLink && !needExtras) return { ok: true, duplicate: false, linked: true };

  let ids = [];
  try {
    ids = idsFrom(data?.items ?? null);
    if (!ids.length) ids = await newestItems(cfg, since, imported);
  } catch { /* media is saved; the tip reports what's missing */ }
  let linked = true;
  if (needLink) linked = ids.length ? await attachSource(cfg, ids, sourceUrl).catch(() => false) : false;
  return { ok: true, duplicate: false, linked, ...(await applyExtras(cfg, ids, extras)) };
}

// One save at a time, so "newest items since the save began" can't mix up two saves.
let queue = Promise.resolve();
function enqueue(job) {
  const run = queue.then(job);
  queue = run.catch(() => {});
  return run;
}

/* ---------- screenshots ---------- */
// The page tells us which part of the viewport to keep after each scroll; slices are
// stitched into one canvas, written to Downloads, imported into Atlas, then removed.

const MAX_DEVICE_H = 16000;
let shot = null;
let lastCapture = 0;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function captureVisible(windowId) {
  // Chrome allows about two captures a second.
  const wait = lastCapture + 560 - Date.now();
  if (wait > 0) await sleep(wait);
  const url = await chrome.tabs.captureVisibleTab(windowId, { format: "png" });
  lastCapture = Date.now();
  const blob = await (await fetch(url)).blob();
  return createImageBitmap(blob);
}

async function shotFrame({ rect, dx = 0, dy, vw }, sender) {
  if (!shot) throw new Error("Capture was reset");
  const bmp = await captureVisible(sender.tab.windowId);
  if (!shot.canvas) {
    shot.scale = bmp.width / vw;
    const w = Math.max(1, Math.min(Math.round(shot.width * shot.scale), MAX_DEVICE_H));
    const h = Math.max(1, Math.min(Math.round(shot.height * shot.scale), MAX_DEVICE_H));
    shot.canvas = new OffscreenCanvas(w, h);
    shot.ctx = shot.canvas.getContext("2d");
  }
  const s = shot.scale;
  const sx = Math.round(rect.x * s), sy = Math.round(rect.y * s);
  const sw = Math.round((rect.x + rect.w) * s) - sx, sh = Math.round((rect.y + rect.h) * s) - sy;
  const tx = Math.round(dx * s), ty = Math.round(dy * s);
  if (ty < shot.canvas.height && tx < shot.canvas.width) shot.ctx.drawImage(bmp, sx, sy, sw, sh, tx, ty, sw, sh);
  else shot.clipped = true;
  bmp.close();
}

function base64(buf) {
  const bytes = new Uint8Array(buf);
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

const HELPER = "atlas_saver.helper";

async function helper(msg) {
  let res;
  try {
    res = await chrome.runtime.sendNativeMessage(HELPER, msg);
  } catch {
    throw new Error("Helper not installed");
  }
  if (!res?.ok) throw new Error(res?.error || "Helper failed");
  return res;
}

function downloadDone(id) {
  return new Promise((resolve, reject) => {
    const finish = (fn, v) => { chrome.downloads.onChanged.removeListener(onChange); clearTimeout(timer); fn(v); };
    const check = async () => {
      const [item] = await chrome.downloads.search({ id });
      if (item?.state === "complete") finish(resolve, item.filename);
      else if (item?.state === "interrupted") finish(reject, new Error(`Couldn't write the screenshot (${item.error || "interrupted"})`));
    };
    const onChange = (d) => { if (d.id === id && d.state) check(); };
    const timer = setTimeout(() => finish(reject, new Error("Writing the screenshot timed out")), 20000);
    chrome.downloads.onChanged.addListener(onChange);
    check();
  });
}

async function ensureOffscreen() {
  if (await chrome.offscreen.hasDocument?.()) return;
  try {
    await chrome.offscreen.createDocument({
      url: "offscreen.html",
      reasons: ["BLOBS"],
      justification: "Turn a screenshot into a blob: URL so it can be written to disk for Atlas."
    });
  } catch (e) {
    if (!/single offscreen/i.test(e.message || "")) throw e;
  }
}

// No-setup path: Chrome writes the PNG to Downloads/Atlas Saver with its download UI
// switched off, Atlas imports it, then the file and its history entry are removed.
// A blob: URL is used because Chrome rejects data: URLs over 2 MB.
async function writeViaDownload(blob, name) {
  const key = `shot-${Date.now()}`;
  await ShotStore.put(key, blob);
  await ensureOffscreen();
  const made = await chrome.runtime.sendMessage({ target: "offscreen", type: "blob-url", key });
  if (!made?.ok) throw new Error(made?.error || "Couldn't prepare the screenshot");
  const release = () => {
    chrome.runtime.sendMessage({ target: "offscreen", type: "revoke", key }).catch(() => {});
    ShotStore.del(key).catch(() => {});
  };

  await chrome.downloads.setUiOptions?.({ enabled: false }).catch(() => {});
  let id;
  try {
    id = await chrome.downloads.download({ url: made.url, filename: `Atlas Saver/${name}`, conflictAction: "uniquify", saveAs: false });
    const path = await downloadDone(id);
    return {
      path,
      cleanup: async () => {
        await chrome.downloads.removeFile(id).catch(() => {});
        await chrome.downloads.erase({ id }).catch(() => {});
      }
    };
  } catch (e) {
    if (id) chrome.downloads.erase({ id }).catch(() => {});
    throw e;
  } finally {
    release();
    // Give the finished item a moment to be erased before the UI comes back.
    setTimeout(() => chrome.downloads.setUiOptions?.({ enabled: true }).catch(() => {}), 1500);
  }
}

async function writeShot(blob, name) {
  try {
    if (blob.size > 40e6) throw new Error("too big for the helper"); // native messages cap at 64 MB
    const { path } = await helper({ op: "write", name, data: base64(await blob.arrayBuffer()) });
    return { path, cleanup: () => helper({ op: "remove", path }).catch(() => {}) };
  } catch {
    return writeViaDownload(blob, name);
  }
}

const stamp = () => new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
const slug = (t) => (t || "").normalize("NFKD").replace(/[^\w\s-]/g, "").trim().replace(/\s+/g, "-").slice(0, 40);

// Re-render the area at a higher device scale through the DevTools protocol. It also
// captures beyond the viewport, so no scrolling or stitching is needed.
async function shotRender({ clip, scale }, sender) {
  let s = scale;
  while (s > 1 && (clip.height * s > MAX_DEVICE_H || clip.width * s > MAX_DEVICE_H)) s--;
  const target = { tabId: sender.tab.id };
  try {
    await chrome.debugger.attach(target, "1.3");
  } catch {
    throw new Error("Close DevTools on this tab and try again");
  }
  try {
    await chrome.debugger.sendCommand(target, "Emulation.setDeviceMetricsOverride", { width: 0, height: 0, deviceScaleFactor: s, mobile: false });
    const { data } = await chrome.debugger.sendCommand(target, "Page.captureScreenshot", {
      format: "png", clip: { ...clip, scale: 1 }, captureBeyondViewport: true, fromSurface: true
    });
    shot = { png: data, clipped: s < scale };
    return { ok: true };
  } finally {
    await chrome.debugger.sendCommand(target, "Emulation.clearDeviceMetricsOverride").catch(() => {});
    await chrome.debugger.detach(target).catch(() => {});
  }
}

async function shotFinish({ width, height, sourceUrl, title }) {
  if (shot?.png) {
    const cur = shot;
    shot = null;
    const bin = atob(cur.png);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return saveShot(new Blob([bytes], { type: "image/png" }), sourceUrl, title, cur.clipped);
  }
  if (!shot?.canvas) throw new Error("Nothing was captured");
  const cur = shot;
  shot = null;
  let canvas = cur.canvas;
  const h = Math.min(Math.round(height * cur.scale), canvas.height);
  const w = Math.min(Math.round((width || cur.width) * cur.scale), canvas.width);
  if (h < canvas.height || w < canvas.width) {
    const trimmed = new OffscreenCanvas(w, h);
    trimmed.getContext("2d").drawImage(canvas, 0, 0);
    canvas = trimmed;
  }
  const blob = await canvas.convertToBlob({ type: "image/png" });
  return saveShot(blob, sourceUrl, title, cur.clipped);
}

async function saveShot(blob, sourceUrl, title, clipped) {
  const res = await importBlob(blob, `${slug(title) || "screenshot"}-${stamp()}.png`, sourceUrl);
  return { ...res, clipped: !!clipped };
}

// Hand a file to Atlas: write it to disk (helper or hidden download), import, link, clean up.
async function importBlob(blob, name, sourceUrl, extras = {}) {
  const cfg = await getConfig();
  const { path, cleanup } = await writeShot(blob, name);
  try {
    const args = { paths: [path] };
    const { data, text } = await callTool(cfg, "import_files", args);
    const ids = JSON.stringify(data?.items ?? "").match(UUID) || [];
    if (!ids.length) {
      if (data?.skipped_duplicate || data?.duplicates?.length) {
        // Already in Atlas: still add the note and tags to the item that's there.
        const existing = JSON.stringify(data?.duplicates ?? "").match(UUID) || [];
        return { ok: true, duplicate: true, ...(await applyExtras(cfg, existing, extras)) };
      }
      const why = data?.failed?.[0]?.reason || (data?.skipped_unsupported ? "unsupported file" : text);
      throw new Error(`Atlas didn't import it${why ? `: ${String(why).slice(0, 80)}` : ""}`);
    }
    const linked = sourceUrl ? await attachSource(cfg, ids, sourceUrl).catch(() => false) : true;
    return { ok: true, duplicate: false, linked, ...(await applyExtras(cfg, ids, extras)) };
  } finally {
    // Atlas keeps its own copy; the written file was only a hand-off.
    setTimeout(cleanup, 1000);
  }
}

async function startShot(tab, full = false) {
  if (!tab?.id || !/^https?:/.test(tab.url || "")) throw new Error("Screenshots work on web pages only");
  try {
    await chrome.tabs.sendMessage(tab.id, { type: "atlas-shot-start", full });
  } catch {
    // Tab was open before the extension loaded; add the scripts now.
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["ui.js", "content.js", "shot.js"] });
    await chrome.tabs.sendMessage(tab.id, { type: "atlas-shot-start", full });
  }
}

chrome.commands?.onCommand?.addListener(async (command, tab) => {
  if (command !== "take-screenshot" && command !== "take-full-page") return;
  if (!tab) [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  startShot(tab, command === "take-full-page").catch(() => {});
});

// The "Save to collection" setting is gone; drop any value saved by older versions.
chrome.runtime.onInstalled.addListener(() => { chrome.storage.local.remove("collection").catch(() => {}); });

// Saves always land in Atlas's Inbox; the page says "Added to Inbox".
async function withWhere(res) {
  return { ...res, where: "Inbox" };
}

const reply = (respond, job) => {
  Promise.resolve().then(job).then(
    (v) => respond(v && typeof v === "object" ? v : { ok: true }),
    (e) => respond({ ok: false, error: e.message || "Failed" })
  );
  return true;
};

chrome.runtime.onMessage.addListener((msg, sender, respond) => {
  if (msg?.type === "atlas-shot-request") {
    return reply(respond, async () => {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      await startShot(tab, !!msg.full);
    });
  }
  if (msg?.type === "atlas-shot-config") {
    respond({ ok: true, scale: 2 }); // always Retina 2×
    return;
  }
  if (msg?.type === "atlas-shot-render") return reply(respond, () => shotRender(msg, sender));
  if (msg?.type === "atlas-helper-ping") {
    helper({ op: "ping" }).then(() => respond({ ok: true, id: chrome.runtime.id }), () => respond({ ok: false, id: chrome.runtime.id }));
    return true;
  }
  if (msg?.type === "atlas-shot-begin") {
    shot = { width: msg.width, height: msg.height, canvas: null, scale: 1, clipped: false };
    respond({ ok: true });
    return;
  }
  if (msg?.type === "atlas-shot-frame") return reply(respond, () => shotFrame(msg, sender));
  if (msg?.type === "atlas-shot-cancel") { shot = null; return; }
  if (msg?.type === "atlas-shot-finish") return reply(respond, () => enqueue(() => shotFinish(msg)).then(withWhere));

  if (msg?.type === "atlas-tags") {
    libraryTags().then((names) => respond({ ok: true, names }), () => respond({ ok: false, names: [] }));
    return true;
  }
  if (msg?.type === "atlas-save-link") {
    enqueue(() => saveLink(msg.payload)).then(withWhere).then(respond, (e) => respond({ ok: false, error: e.message || "Failed" }));
    return true;
  }
  if (msg?.type === "atlas-save") {
    enqueue(() => save(msg.payload)).then(withWhere).then(respond, (e) => respond({ ok: false, error: e.message || "Failed" }));
    return true;
  }
  if (msg?.type === "atlas-config") {
    getConfig().then(({ endpoint, token }) => respond({ endpoint, token }), () => respond(null));
    return true;
  }
  if (msg?.type === "atlas-ping") {
    getConfig()
      .then((cfg) => rpc({ ...cfg, ...(msg.override || {}) }, "ping"))
      .then(() => respond({ ok: true }), (e) => respond({ ok: false, error: e.message }));
    return true;
  }
});
