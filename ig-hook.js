// Runs in Instagram's own page (MAIN world) from document_start.
// Instagram plays videos from blob: streams, but the post data it loads (embedded in
// the page and fetched as you scroll) lists the real .mp4 files. This keeps the media
// it has seen, so content.js can ask for a post's video without another request.
(() => {
  if (window.__atlasIgHook) return;
  window.__atlasIgHook = true;

  const byKey = new Map(); // code or pk → media node with video_versions / carousel_media
  const MAX = 800;

  function remember(node) {
    for (const k of [node.code, node.pk, String(node.id || "").split("_")[0]]) {
      if (!k) continue;
      byKey.delete(String(k));
      byKey.set(String(k), node);
    }
    while (byKey.size > MAX) byKey.delete(byKey.keys().next().value);
  }

  function walk(node, depth = 0) {
    if (!node || typeof node !== "object" || depth > 80) return;
    if (Array.isArray(node)) { for (const n of node) walk(n, depth + 1); return; }
    if ((node.code || node.pk) && (node.video_versions?.length || node.carousel_media?.some?.((c) => c?.video_versions?.length))) remember(node);
    for (const k in node) {
      const v = node[k];
      if (v && typeof v === "object") walk(v, depth + 1);
    }
  }

  function scanText(text) {
    if (typeof text !== "string" || !text.includes("video_versions")) return;
    const body = text.replace(/^for \(;;\);/, "");
    try { walk(JSON.parse(body)); return; } catch { /* streamed: one JSON per line */ }
    for (const line of body.split("\n")) {
      if (!line.includes("video_versions")) continue;
      try { walk(JSON.parse(line)); } catch {}
    }
  }

  const scannedScripts = new WeakSet();
  function scanScripts() {
    for (const s of document.querySelectorAll('script[type="application/json"]')) {
      if (scannedScripts.has(s)) continue;
      scannedScripts.add(s);
      scanText(s.textContent);
    }
  }

  // Index the data embedded in the page once it has loaded, so the first save is quick.
  const warm = () => (window.requestIdleCallback || setTimeout)(scanScripts);
  document.readyState === "loading" ? document.addEventListener("DOMContentLoaded", warm, { once: true }) : warm();

  const isData =(u) => /\/(api\/graphql|graphql\/query|api\/v1\/)/.test(String(u || ""));

  const origFetch = window.fetch;
  window.fetch = async function (...args) {
    const res = await origFetch.apply(this, args);
    try {
      const u = args[0]?.url || args[0];
      if (isData(u)) res.clone().text().then(scanText, () => {});
    } catch {}
    return res;
  };

  const origOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (method, url, ...rest) {
    if (isData(url)) {
      this.addEventListener("load", () => {
        try {
          if (this.responseType === "" || this.responseType === "text") scanText(this.responseText);
          else if (this.responseType === "json" && this.response) walk(this.response);
        } catch {}
      });
    }
    return origOpen.call(this, method, url, ...rest);
  };

  // Last saves as content.js reported them, for debugging from the page console.
  window.__atlasIgLog = [];
  window.addEventListener("message", (e) => {
    if (e.data?.type === "atlas-debug") { window.__atlasIgLog.push({ at: new Date().toISOString(), ...e.data.info }); return; }
    if (e.data?.type === "atlas-ig-ask") window.__atlasIgLog.push({ at: new Date().toISOString(), ask: e.data.keys, sameSource: e.source === window });
    if (e.source !== window || e.data?.type !== "atlas-ig-ask") return;
    scanScripts();
    const { id, keys } = e.data;
    let item = null;
    for (const k of keys || []) { if (k && byKey.has(String(k))) { item = byKey.get(String(k)); break; } }
    let copy = null;
    if (item) {
      // Send only what content.js needs.
      const slim = (n) => ({
        video_versions: n.video_versions || null,
        image_versions2: n.image_versions2 ? { candidates: n.image_versions2.candidates || [] } : null
      });
      copy = { ...slim(item), carousel_media: item.carousel_media ? item.carousel_media.map(slim) : null };
    }
    window.postMessage({ type: "atlas-ig-answer", id, item: copy }, location.origin);
  });
})();
