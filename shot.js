// Screenshot mode: hover snaps to page blocks (divs, cards, sections), click captures
// the block, drag draws a free rectangle whose edges snap to nearby block edges.
(() => {
  if (window.__atlasShot) return;
  window.__atlasShot = true;

  const ACCENT = "#3d8bff";
  const SNAP = 6;          // px distance at which a dragged edge sticks to a block edge
  const MIN_W = 24, MIN_H = 16;
  const MAX_FRAMES = 40;   // big areas are stitched from at most this many viewport captures
  const MAX_PX = 16000;    // longest side of the final image, in pixels
  const PAD = 16;          // breathing room added around a picked block that has no padding of its own

  /* ---------- UI ---------- */

  const host = document.createElement("atlas-shot");
  for (const [k, v] of Object.entries({ all: "initial", position: "fixed", top: "0", left: "0", width: "0", height: "0", "z-index": "2147483647", "pointer-events": "none" })) {
    host.style.setProperty(k, v);
  }
  const root = host.attachShadow({ mode: "closed" });
  const sheet = new CSSStyleSheet();
  sheet.replaceSync(`
    * { box-sizing: border-box; }
    .layer { position: fixed; inset: 0; pointer-events: auto; cursor: crosshair; display: none; }
    .layer.on { display: block; }
    .layer.empty { background: rgba(0,0,0,.18); }
    .box { position: fixed; top: 0; left: 0; display: none; pointer-events: none;
           border: 1.5px solid ${ACCENT}; background: rgba(61,139,255,.06);
           box-shadow: 0 0 0 100vmax rgba(0,0,0,.32); transition: all .07s ease-out; }
    .box.on { display: block; }
    .box.drag { transition: none; border-style: solid; }
    .label { position: fixed; top: 0; left: 0; display: none; height: 20px; padding: 0 7px; border-radius: 5px;
             align-items: center; white-space: nowrap; color: #fff; background: ${ACCENT};
             font: 500 11px/1 ui-monospace, "SF Mono", Menlo, monospace; pointer-events: none; }
    .label.on { display: flex; }
    .guide { position: fixed; display: none; background: #ff3d9a; pointer-events: none; }
    .guide.on { display: block; }
    .gx { top: 0; bottom: 0; width: 1px; }
    .gy { left: 0; right: 0; height: 1px; }
    .pill { position: fixed; left: 50%; bottom: 22px; translate: -50% 0; height: 32px; padding: 0 14px;
            border-radius: 16px; display: flex; align-items: center; gap: 10px; white-space: nowrap;
            font: 500 12px/1 -apple-system, BlinkMacSystemFont, "Inter", "Segoe UI", sans-serif;
            letter-spacing: -.005em; color: #fff; background: rgba(18,18,18,.86);
            -webkit-backdrop-filter: blur(14px); backdrop-filter: blur(14px);
            box-shadow: 0 6px 24px rgba(0,0,0,.25); opacity: 0; pointer-events: none; transition: opacity .14s ease; }
    .pill.on { opacity: 1; }
    .pill kbd { font: 500 11px/1 ui-monospace, "SF Mono", Menlo, monospace; padding: 3px 5px; border-radius: 4px;
                background: rgba(255,255,255,.14); }
    .pill .sep { opacity: .35; }
    .toast.error { background: rgba(214,52,52,.94); }
    @media (prefers-reduced-motion: reduce) { .box { transition: none; } }
  `);
  root.adoptedStyleSheets = [sheet];

  const div = (cls) => { const d = document.createElement("div"); d.className = cls; return d; };
  const layer = div("layer");
  const box = div("box");
  const label = div("label");
  const gx = div("guide gx");
  const gy = div("guide gy");
  const hint = div("pill hint");
  const toastEl = div("pill toast");
  toastEl.setAttribute("role", "status");
  const kbd = (t) => { const k = document.createElement("kbd"); k.textContent = t; return k; };
  const txt = (t) => document.createTextNode(t);
  const sep = () => { const s = document.createElement("span"); s.className = "sep"; s.textContent = "·"; return s; };
  hint.append(txt("Drag an area"), sep(), txt("Click: visible screen"), sep(), kbd("F"), txt("full page"), sep(), txt("Hold"), kbd("⌥"), txt("to pick blocks"), sep(), kbd("esc"));
  root.append(layer, box, label, gx, gy, hint, toastEl);

  const mount = () => { if (!host.isConnected) document.documentElement.appendChild(host); };
  const saverHost = () => document.querySelector("atlas-saver");
  const setSaverHidden = (on) => {
    const s = saverHost();
    if (s) on ? s.style.setProperty("display", "none", "important") : s.style.removeProperty("display");
  };

  let toastTimer = 0;
  function toast(message, kind = "", stay = false) {
    mount();
    clearTimeout(toastTimer);
    toastEl.textContent = message;
    toastEl.classList.toggle("error", kind === "error");
    toastEl.classList.add("on");
    if (!stay) toastTimer = setTimeout(() => toastEl.classList.remove("on"), 2600);
  }

  /* ---------- picking blocks ---------- */

  const sameRect = (a, b) => Math.abs(a.left - b.left) < 1 && Math.abs(a.top - b.top) < 1 && Math.abs(a.width - b.width) < 1 && Math.abs(a.height - b.height) < 1;
  const isOurs = (el) => el === host || el === saverHost();

  function meaningful(el) {
    if (el instanceof SVGElement && el.ownerSVGElement) el = el.ownerSVGElement;
    while (el && el !== document.body && el !== document.documentElement) {
      const r = el.getBoundingClientRect();
      const d = getComputedStyle(el).display;
      if (d !== "inline" && d !== "contents" && r.width >= MIN_W && r.height >= MIN_H) return el;
      el = el.parentElement;
    }
    return el || null;
  }

  function baseAt(x, y) {
    return document.elementsFromPoint(x, y).find((el) => !isOurs(el) && el !== document.documentElement) || null;
  }

  function parentOf(el) {
    const r = el.getBoundingClientRect();
    let p = el.parentElement;
    while (p && p !== document.documentElement && sameRect(p.getBoundingClientRect(), r)) p = p.parentElement;
    return p && p !== document.documentElement ? p : null;
  }

  function describeEl(el) {
    let s = el.tagName.toLowerCase();
    if (el.id) s += `#${el.id}`;
    else if (typeof el.className === "string" && el.className.trim()) s += `.${el.className.trim().split(/\s+/)[0]}`;
    return s.length > 38 ? `${s.slice(0, 37)}…` : s;
  }

  /* ---------- snapping for free drags ---------- */

  let edges = null;
  function gatherEdges() {
    const vw = innerWidth, vh = innerHeight;
    const xs = [0, vw], ys = [0, vh];
    const all = document.body ? document.body.getElementsByTagName("*") : [];
    const n = Math.min(all.length, 6000);
    for (let i = 0; i < n; i++) {
      const el = all[i];
      if (isOurs(el)) continue;
      const r = el.getBoundingClientRect();
      if (r.width < 8 || r.height < 8 || r.bottom < 0 || r.top > vh || r.right < 0 || r.left > vw) continue;
      xs.push(r.left, r.right);
      ys.push(r.top, r.bottom);
    }
    return { xs, ys };
  }

  function snapTo(v, list) {
    let best = v, d = SNAP + 0.01;
    for (const e of list) {
      const dd = Math.abs(e - v);
      if (dd < d) { d = dd; best = e; }
    }
    return { v: best, hit: d <= SNAP };
  }

  function snapPoint(x, y, free) {
    if (free || !edges) return { x, y, hx: false, hy: false };
    const sx = snapTo(x, edges.xs), sy = snapTo(y, edges.ys);
    return { x: sx.v, y: sy.v, hx: sx.hit, hy: sy.hit };
  }

  /* ---------- drawing ---------- */

  function drawBox(r, text, radius = "2px", drag = false) {
    if (!r) {
      box.classList.remove("on");
      label.classList.remove("on");
      layer.classList.add("empty");
      return;
    }
    layer.classList.remove("empty");
    box.classList.toggle("drag", drag);
    box.style.translate = `${r.left}px ${r.top}px`;
    box.style.width = `${r.width}px`;
    box.style.height = `${r.height}px`;
    box.style.borderRadius = radius;
    box.classList.add("on");
    label.textContent = text;
    label.classList.add("on");
    const lw = label.offsetWidth;
    const lx = Math.max(4, Math.min(r.left, innerWidth - lw - 4));
    const ly = r.top >= 26 ? r.top - 24 : Math.min(Math.max(r.top, 0) + 4, innerHeight - 24);
    label.style.translate = `${Math.round(lx)}px ${Math.round(ly)}px`;
  }

  function drawGuides(p) {
    gx.classList.toggle("on", !!p?.hx);
    gy.classList.toggle("on", !!p?.hy);
    if (p?.hx) gx.style.translate = `${Math.round(p.x)}px 0`;
    if (p?.hy) gy.style.translate = `0 ${Math.round(p.y)}px`;
  }

  const size = (r) => `${Math.round(r.width)} × ${Math.round(r.height)}`;

  /* ---------- the mode ---------- */

  let active = false;
  let alt = false;         // ⌥ held: pick blocks and snap; otherwise a plain screenshot
  let px = 0, py = 0;
  let base = null, picked = null, chain = [];
  let down = null, dragging = false, dragRect = null;

  function showPicked() {
    if (!picked) return drawBox(null);
    const r = picked.getBoundingClientRect();
    drawBox(r, `${describeEl(picked)}  ${size(r)}`, getComputedStyle(picked).borderRadius || "2px");
  }

  function hover() {
    if (!alt) {
      base = picked = null;
      chain = [];
      return drawBox(null);
    }
    const b = baseAt(px, py);
    if (b !== base) {
      base = b;
      chain = [];
      picked = b ? meaningful(b) : null;
    }
    showPicked();
  }

  function activate() {
    if (active) return;
    active = true;
    mount();
    setSaverHidden(true);
    layer.classList.add("on", "empty");
    hint.classList.add("on");
    toastEl.classList.remove("on");
    base = picked = null;
    chain = [];
    alt = false;
    addEventListener("keydown", onKey, true);
    addEventListener("keyup", onKey, true);
    addEventListener("blur", onBlur);
    addEventListener("scroll", onScroll, { passive: true, capture: true });
  }

  function deactivate() {
    active = false;
    down = null;
    dragging = false;
    layer.classList.remove("on");
    hint.classList.remove("on");
    drawBox(null);
    drawGuides(null);
    removeEventListener("keydown", onKey, true);
    removeEventListener("keyup", onKey, true);
    removeEventListener("blur", onBlur);
    removeEventListener("scroll", onScroll, true);
    setSaverHidden(false);
  }

  function onScroll() {
    if (active && !dragging) requestAnimationFrame(showPicked);
  }

  function setAlt(on) {
    if (on === alt) return;
    alt = on;
    if (!dragging) hover();
  }

  function onBlur() { setAlt(false); }

  function onKey(e) {
    if (!active) return;
    if (e.key === "Alt") {
      e.preventDefault();
      e.stopImmediatePropagation();
      return setAlt(e.type === "keydown");
    }
    if (e.type !== "keydown") return;
    const keys = ["Escape", "Enter", "ArrowUp", "ArrowDown", "f", "F"];
    if (!keys.includes(e.key)) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    if (e.key === "Escape") return deactivate();
    if ((e.key === "f" || e.key === "F") && !dragging) return takeFull();
    if (dragging) return;
    if (e.key === "Enter" && picked) return takeElement(picked);
    if (e.key === "ArrowUp" && picked) {
      const p = parentOf(picked);
      if (p) { chain.push(picked); picked = p; }
    }
    if (e.key === "ArrowDown" && chain.length) picked = chain.pop();
    showPicked();
  }

  layer.addEventListener("pointermove", (e) => {
    e.stopPropagation();
    px = e.clientX; py = e.clientY;
    if (e.altKey !== alt && !down) return setAlt(e.altKey);
    if (!down) return requestAnimationFrame(hover);
    if (!dragging && Math.hypot(px - down.rawX, py - down.rawY) < 4) return;
    dragging = true;
    const p = snapPoint(px, py, !e.altKey);
    const left = Math.min(down.x, p.x), top = Math.min(down.y, p.y);
    dragRect = { left, top, width: Math.abs(p.x - down.x), height: Math.abs(p.y - down.y) };
    drawBox(dragRect, size(dragRect), "0", true);
    drawGuides(p);
  });

  layer.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.button !== 0) return;
    layer.setPointerCapture(e.pointerId);
    edges = e.altKey ? gatherEdges() : null;
    const p = snapPoint(e.clientX, e.clientY, !e.altKey);
    down = { x: p.x, y: p.y, rawX: e.clientX, rawY: e.clientY };
    dragging = false;
    dragRect = null;
  });

  layer.addEventListener("pointerup", (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (!down) return;
    const wasDrag = dragging;
    down = null;
    dragging = false;
    edges = null;
    drawGuides(null);
    if (wasDrag) {
      if (dragRect && dragRect.width >= 4 && dragRect.height >= 4) return takeRect(dragRect);
      return hover();
    }
    if (alt && picked) return takeElement(picked);
    const docEl = document.documentElement;
    takeRect({ left: 0, top: 0, width: docEl.clientWidth || innerWidth, height: docEl.clientHeight || innerHeight });
  });

  for (const type of ["click", "dblclick", "contextmenu", "mousedown", "mouseup", "wheel"]) {
    layer.addEventListener(type, (e) => {
      if (type !== "wheel") e.preventDefault();
      e.stopPropagation();
      if (type === "contextmenu") deactivate();
    }, { passive: type === "wheel" ? true : false });
  }

  /* ---------- capturing ---------- */

  const send = async (msg) => {
    try { return await chrome.runtime.sendMessage(msg); }
    catch { return { ok: false, error: "Reload the page" }; }
  };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const paint = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  const pageUrl = () => { try { const u = new URL(location.href); u.hash = ""; return u.href; } catch { return location.href; } };

  function toDoc(r) {
    return { x: r.left + scrollX, y: r.top + scrollY, w: r.width, h: r.height };
  }

  function takeElement(el) {
    const d = toDoc(el.getBoundingClientRect());
    const docEl = document.documentElement;
    const maxW = Math.max(docEl.scrollWidth, d.x + d.w), maxH = Math.max(docEl.scrollHeight, d.y + d.h);
    const cs = getComputedStyle(el);
    const padded = ["Top", "Right", "Bottom", "Left"].some((k) => parseFloat(cs[`padding${k}`]) > 0);
    const pad = padded ? 0 : PAD;
    const x = Math.max(0, d.x - pad), y = Math.max(0, d.y - pad);
    takeDoc({ x, y, w: Math.min(maxW, d.x + d.w + pad) - x, h: Math.min(maxH, d.y + d.h + pad) - y }, el);
  }

  function takeFull() {
    const docEl = document.documentElement;
    const h = Math.max(docEl.scrollHeight, document.body?.scrollHeight || 0, docEl.clientHeight);
    takeDoc({ x: 0, y: 0, w: docEl.clientWidth || innerWidth, h }, null);
  }

  function takeRect(r) {
    takeDoc(toDoc(r), null);
  }

  // Fixed and sticky bars would repeat in every stitched slice; hide them after the first.
  function hideFixed(el, list) {
    const all = document.body ? document.body.getElementsByTagName("*") : [];
    const n = Math.min(all.length, 8000);
    for (let i = 0; i < n; i++) {
      const node = all[i];
      if (isOurs(node) || (el && (node.contains(el) || el.contains(node)))) continue;
      const pos = getComputedStyle(node).position;
      if (pos !== "fixed" && pos !== "sticky") continue;
      list.push([node, node.style.getPropertyValue("visibility"), node.style.getPropertyPriority("visibility")]);
      node.style.setProperty("visibility", "hidden", "important");
    }
  }

  let busy = false;
  async function takeDoc(doc, el) {
    deactivate();
    if (busy) return;
    busy = true;
    setSaverHidden(true);
    const sx0 = scrollX, sy0 = scrollY;
    const docEl = document.documentElement;
    const hidden = [];
    let outW = 0, outH = 0;
    let error = "";
    try {
      const { scale = 2 } = (await send({ type: "atlas-shot-config" })) || {};
      // More pixels than the screen has: Chrome re-renders the area at that scale
      // (through its debugger, which shows a bar at the top for a moment).
      if (scale > (devicePixelRatio || 1) + 0.01) {
        await paint();
        const clip = { x: Math.round(doc.x), y: Math.round(doc.y), width: Math.round(doc.w), height: Math.round(doc.h) };
        if (clip.width < 2 || clip.height < 2) throw new Error("Nothing to capture here");
        const res = await send({ type: "atlas-shot-render", clip, scale });
        if (!res?.ok) throw new Error(res?.error || "Capture failed");
        outW = clip.width;
        outH = clip.height;
      } else {
        await stitch();
      }
    } catch (e) {
      error = e.message || "Capture failed";
    } finally {
      for (const [node, v, p] of hidden) v ? node.style.setProperty("visibility", v, p) : node.style.removeProperty("visibility");
      window.scrollTo({ left: sx0, top: sy0, behavior: "instant" });
      setSaverHidden(false);
    }

    if (!error && (outW < 2 || outH < 2)) error = "Nothing to capture here";
    if (error) {
      busy = false;
      send({ type: "atlas-shot-cancel" });
      return toast(error, "error");
    }

    finish(outW, outH);

    // Screen-resolution capture: scroll through the area and stitch viewport slices.
    async function stitch() {
      const r = { x: Math.round(doc.x), y: Math.round(doc.y), w: Math.round(doc.w), h: Math.round(doc.h) };
      if (r.w < 2 || r.h < 2) throw new Error("Nothing to capture here");

      const viewW = () => Math.min(innerWidth, docEl.clientWidth || innerWidth);
      const viewH = () => Math.min(innerHeight, docEl.clientHeight || innerHeight);
      const allVisible = r.x - scrollX >= 0 && r.y - scrollY >= 0 && r.x + r.w - scrollX <= viewW() && r.y + r.h - scrollY <= viewH();

      const begin = await send({ type: "atlas-shot-begin", width: r.w, height: r.h });
      if (!begin?.ok) throw new Error(begin?.error || "Couldn't start the capture");

      let frames = 0, doneY = 0, widthLimit = r.w;
      rows: while (doneY < r.h && frames < MAX_FRAMES) {
        let doneX = 0, rowH = 0;
        while (doneX < widthLimit && frames < MAX_FRAMES) {
          const wx = r.x + doneX, wy = r.y + doneY;
          if (!(frames === 0 && allVisible)) window.scrollTo({ left: wx, top: wy, behavior: "instant" });
          if (frames === 1) hideFixed(el, hidden);
          await paint();
          const vx = Math.round(wx - scrollX), vy = Math.round(wy - scrollY);
          if (vy < 0 || vy >= viewH()) break rows;       // can't scroll further down (inner scroller)
          if (vx < 0 || vx >= viewW()) { widthLimit = doneX; break; } // or further right
          const w = Math.min(widthLimit - doneX, viewW() - vx);
          const h = Math.min(r.h - doneY, viewH() - vy);
          const res = await send({ type: "atlas-shot-frame", rect: { x: vx, y: vy, w, h }, dx: doneX, dy: doneY, vw: innerWidth });
          if (!res?.ok) throw new Error(res?.error || "Capture failed");
          frames++;
          doneX += w;
          rowH = rowH ? Math.min(rowH, h) : h;
        }
        if (!doneX) break;
        if (!doneY) widthLimit = doneX; // the first row decides the width
        doneY += rowH;
      }
      outW = widthLimit;
      outH = doneY;
    }
  }

  async function finish(width, height) {
    toast("Saving screenshot…", "", true);
    const res = await send({ type: "atlas-shot-finish", width, height, sourceUrl: pageUrl(), title: document.title });
    busy = false;
    if (res?.ok) toast(res.duplicate ? "Already in Atlas" : res.linked === false ? "Saved, link not attached" : res.clipped ? "Saved (trimmed to max size)" : "Screenshot saved to Atlas");
    else toast(res?.error || "No answer from the extension, reload the page", "error");
  }

  chrome.runtime.onMessage.addListener((msg) => {
    if (msg?.type !== "atlas-shot-start" || busy) return;
    if (msg.full) return takeFull();
    active ? deactivate() : activate();
  });
})();
