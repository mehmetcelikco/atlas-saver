(() => {
  if (window.__atlasSaver) return;
  window.__atlasSaver = true;

  const SIZE = 28;
  const INSET = 10;
  const MIN_SIDE = 120; // skips avatars, emoji, icons
  const SVG_NS = "http://www.w3.org/2000/svg";
  const host_ = location.hostname;
  const SITE = /instagram\.com$/.test(host_) ? "instagram"
    : /(^|\.)(x|twitter)\.com$/.test(host_) ? "x"
    : /linkedin\.com$/.test(host_) ? "linkedin"
    : "generic";

  /* ---------- UI (closed shadow root, no page CSS leaks in or out) ---------- */

  const host = document.createElement("atlas-saver");
  const hs = host.style;
  hs.setProperty("all", "initial");
  hs.setProperty("position", "fixed");
  hs.setProperty("top", "0");
  hs.setProperty("left", "0");
  hs.setProperty("width", "0");
  hs.setProperty("height", "0");
  hs.setProperty("z-index", "2147483647");
  hs.setProperty("pointer-events", "none");
  const root = host.attachShadow({ mode: "closed" });

  const sheet = new CSSStyleSheet();
  sheet.replaceSync(`
    button {
      all: unset; box-sizing: border-box; position: fixed; top: 0; left: 0;
      width: ${SIZE}px; height: ${SIZE}px; border-radius: 50%;
      display: grid; place-items: center; cursor: pointer; color: #fff;
      background: rgba(18,18,18,.2);
      -webkit-backdrop-filter: blur(14px) saturate(1.5); backdrop-filter: blur(14px) saturate(1.5);
      box-shadow: inset 0 0 0 1px rgba(255,255,255,.14);
      opacity: 0; scale: .82; pointer-events: none;
      transition: opacity .05s linear, scale .05s linear;
    }
    button.on { opacity: 1; scale: 1; pointer-events: auto;
      transition: opacity .14s ease, scale .18s cubic-bezier(.2,.8,.2,1), background .14s ease; }
    button.on:hover { background: rgba(18,18,18,.45); scale: 1.07; }
    button.on:active { scale: .93; }
    button:focus-visible { outline: 2px solid #fff; outline-offset: 2px; }
    button[data-state="saved"] { background: rgba(255,255,255,.94); color: #111; }
    button[data-state="error"] { background: rgba(214,52,52,.92); }
    svg { width: 14px; height: 14px; fill: none; stroke: currentColor; stroke-width: 1.5;
          stroke-linecap: round; stroke-linejoin: round; display: none;
          filter: drop-shadow(0 0 1px rgba(0,0,0,.35)); }
    button[data-state="idle"] .plus, button[data-state="saving"] .spin,
    button[data-state="saved"] .check, button[data-state="error"] .bang { display: block; }
    .spin { animation: turn .7s linear infinite; }
    @keyframes turn { to { rotate: 360deg; } }
    .tip {
      position: fixed; top: 0; left: 0; height: ${SIZE}px; padding: 0 10px; border-radius: 14px;
      display: flex; align-items: center; white-space: nowrap;
      font: 500 12px/1 -apple-system, BlinkMacSystemFont, "Inter", "Segoe UI", sans-serif;
      letter-spacing: -.005em; color: #fff; background: rgba(18,18,18,.82);
      -webkit-backdrop-filter: blur(14px); backdrop-filter: blur(14px);
      opacity: 0; pointer-events: none; transition: opacity .14s ease;
    }
    .tip.on { opacity: 1; }
    @media (prefers-reduced-motion: reduce) {
      button, .tip { transition: opacity .1s linear; }
      button.on:hover, button.on:active { scale: 1; }
    }
  `);
  const noteSheet = new CSSStyleSheet();
  noteSheet.replaceSync(`
    button[data-note="1"][data-state="idle"] .plus { display: none; }
    button[data-note="1"][data-state="idle"] .pen { display: block; }

    .scrim { position: fixed; inset: 0; width: 100vw; height: 100vh; display: none; place-items: center;
             background: rgba(0,0,0,.28); pointer-events: auto; }
    .scrim.on { display: grid; animation: fade .14s ease; }
    .modal { width: min(380px, calc(100vw - 32px)); box-sizing: border-box; padding: 14px; border-radius: 14px;
             display: flex; flex-direction: column; gap: 10px; color: #f2f2f2; background: rgba(24,24,24,.94);
             -webkit-backdrop-filter: blur(20px) saturate(1.4); backdrop-filter: blur(20px) saturate(1.4);
             box-shadow: 0 0 0 1px rgba(255,255,255,.08), 0 18px 50px rgba(0,0,0,.35);
             font: 13px/1.4 -apple-system, BlinkMacSystemFont, "Inter", "Segoe UI", sans-serif; letter-spacing: -.005em;
             animation: pop .18s cubic-bezier(.2,.8,.2,1); }
    .head { display: flex; align-items: center; gap: 10px; }
    .thumb { width: 40px; height: 40px; border-radius: 8px; object-fit: cover; background: rgba(255,255,255,.08); flex: none; }
    .title { font-weight: 600; }
    .sub { color: rgba(255,255,255,.5); font-size: 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 280px; }
    .modal textarea, .modal input { all: unset; box-sizing: border-box; width: 100%; padding: 8px 10px; border-radius: 8px;
             background: rgba(255,255,255,.07); color: #f2f2f2; font: inherit; }
    .modal textarea { min-height: 74px; resize: vertical; white-space: pre-wrap; }
    .modal textarea:focus-visible, .tagbox:focus-within { box-shadow: 0 0 0 1.5px rgba(255,255,255,.55); }
    .modal ::placeholder { color: rgba(255,255,255,.38); }
    .tagbox { display: flex; flex-wrap: wrap; gap: 5px; padding: 6px; border-radius: 8px; background: rgba(255,255,255,.07); cursor: text; }
    .tagbox input { flex: 1; min-width: 90px; width: auto; padding: 3px 4px; background: transparent; }
    .chip { display: inline-flex; align-items: center; gap: 4px; height: 22px; padding: 0 4px 0 8px; border-radius: 11px;
            background: rgba(255,255,255,.14); font-size: 12px; }
    .chip b { font-weight: 400; cursor: pointer; opacity: .6; padding: 0 3px; }
    .chip b:hover { opacity: 1; }
    .sugg { display: flex; flex-wrap: wrap; gap: 5px; min-height: 0; }
    .sugg:empty { display: none; }
    .sugg span { height: 22px; padding: 0 8px; border-radius: 11px; display: inline-flex; align-items: center; cursor: pointer;
                 font-size: 12px; color: rgba(255,255,255,.75); box-shadow: inset 0 0 0 1px rgba(255,255,255,.16); }
    .sugg span:hover, .sugg span.hi { background: rgba(255,255,255,.12); color: #fff; }
    .actions { display: flex; align-items: center; gap: 8px; margin-top: 2px; }
    .actions .hint { margin-right: auto; color: rgba(255,255,255,.4); font-size: 11px; }
    .modal button { all: unset; box-sizing: border-box; position: static; width: auto; height: 30px; padding: 0 12px;
                    border-radius: 8px; display: inline-flex; align-items: center; cursor: pointer; font-weight: 500;
                    opacity: 1; scale: 1; pointer-events: auto; color: #f2f2f2; box-shadow: inset 0 0 0 1px rgba(255,255,255,.16); }
    .modal button.primary { background: #f2f2f2; color: #111; box-shadow: none; }
    .modal button:focus-visible { outline: 2px solid #fff; outline-offset: 2px; }
    @keyframes fade { from { opacity: 0; } }
    @keyframes pop { from { opacity: 0; scale: .96; } }
    @media (prefers-reduced-motion: reduce) { .scrim.on, .modal { animation: none; } }
  `);
  root.adoptedStyleSheets = [sheet, noteSheet];

  const icon = (cls, d) => {
    const svg = document.createElementNS(SVG_NS, "svg");
    svg.setAttribute("viewBox", "0 0 14 14");
    svg.setAttribute("class", cls);
    svg.setAttribute("aria-hidden", "true");
    const path = document.createElementNS(SVG_NS, "path");
    path.setAttribute("d", d);
    svg.appendChild(path);
    return svg;
  };

  const btn = document.createElement("button");
  btn.type = "button";
  btn.dataset.state = "idle";
  btn.setAttribute("aria-label", "Save to Atlas");
  btn.append(
    icon("plus", "M7 2.25v9.5M2.25 7h9.5"),
    icon("spin", "M7 1.75A5.25 5.25 0 1 0 12.25 7"),
    icon("check", "M2.9 7.4l2.7 2.7 5.5-5.9"),
    icon("bang", "M7 3v4.6M7 10.6v.1"),
    icon("pen", "M9.4 2.6l2 2-6.3 6.3-2.6.6.6-2.6 6.3-6.3z")
  );
  const tip = document.createElement("div");
  tip.className = "tip";
  root.append(btn, tip);

  /* ---------- finding the media under the pointer ---------- */

  const isMedia = (el) => el instanceof HTMLImageElement || el instanceof HTMLVideoElement;
  const bigEnough = (r) => r.width >= MIN_SIDE && r.height >= MIN_SIDE;
  const contains = (r, x, y) => x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;

  function mediaAt(x, y) {
    const stack = document.elementsFromPoint(x, y);
    if (stack[0] === host) return current;

    const hits = stack.filter((el) => isMedia(el) && bigEnough(el.getBoundingClientRect()));
    if (!hits.length) {
      // Sites often lay a transparent div over the media; look around the top element.
      let node = stack[0];
      for (let i = 0; i < 6 && node && node !== document.body; i++, node = node.parentElement) {
        const found = node.querySelectorAll("video, img");
        if (found.length > 60) break;
        for (const m of found) {
          const r = m.getBoundingClientRect();
          if (bigEnough(r) && contains(r, x, y)) hits.push(m);
        }
        if (hits.length) break;
      }
    }
    let video = hits.find((el) => el instanceof HTMLVideoElement);
    if (!video && hits[0]) {
      // A cover image often sits on top of the <video>; prefer the video next to it.
      let node = hits[0].parentElement;
      for (let i = 0; i < 5 && node && node !== document.body && !video; i++, node = node.parentElement) {
        video = [...node.querySelectorAll("video")].find((v) => {
          const r = v.getBoundingClientRect();
          return bigEnough(r) && contains(r, x, y);
        });
      }
    }
    return video || hits[0] || null;
  }

  /* ---------- working out what to send to Atlas ---------- */

  const isHttp = (u) => /^https?:\/\//i.test(u || "");
  const abs = (href) => { try { return new URL(href, location.href).href; } catch { return ""; } };
  const clean = (href) => { try { const u = new URL(href, location.href); u.search = ""; u.hash = ""; return u.href; } catch { return ""; } };

  function bestImage(img) {
    const set = img.getAttribute("srcset");
    let best = "", bestW = 0;
    if (set) {
      for (const part of set.split(/,\s+/)) {
        const [u, d] = part.trim().split(/\s+/);
        const w = parseFloat(d) || 1;
        if (u && w >= bestW) { best = u; bestW = w; }
      }
    }
    let url = abs(best || img.currentSrc || img.src);
    if (SITE === "x" && /pbs\.twimg\.com\/media\//.test(url)) {
      const u = new URL(url);
      u.searchParams.set("name", "orig"); // full resolution instead of the timeline size
      url = u.href;
    }
    return isHttp(url) ? url : "";
  }

  function directVideo(video) {
    const src = video.currentSrc || video.src || video.querySelector("source")?.src || "";
    return isHttp(src) && !/\.m3u8(\?|$)/i.test(src) ? src : ""; // blob:/HLS can't be fetched by Atlas
  }

  function postUrl(el) {
    if (SITE === "instagram") {
      const sel = 'a[href*="/p/"], a[href*="/reel/"], a[href*="/tv/"]';
      const trim = (href) => clean(href).replace(/(\/(?:p|reel|tv)\/[^/]+\/).*$/, "$1");
      const a = el.closest(sel) || el.closest("article")?.querySelector(sel);
      if (a) return trim(a.href);
      // Newer feeds have no <article>: climb until a container links to exactly one post.
      const codeOf = (href) => href.match(/\/(?:p|reel|tv)\/([A-Za-z0-9_-]+)/)?.[1];
      let node = el.parentElement;
      for (let i = 0; i < 14 && node && node !== document.body; i++, node = node.parentElement) {
        const links = [...node.querySelectorAll(sel)].filter((x) => codeOf(x.href));
        const codes = new Set(links.map((x) => codeOf(x.href)));
        if (codes.size === 1) return trim(links[0].href);
        if (codes.size > 1) break;
      }
      if (/\/(p|reel|reels|tv|stories)\//.test(location.pathname)) return clean(location.href);
      return "";
    }
    if (SITE === "x") {
      const status = (href) => {
        const m = (href || "").match(/^https?:\/\/[^/]+\/([^/]+)\/status\/(\d+)/);
        return m ? `https://x.com/${m[1]}/status/${m[2]}` : "";
      };
      const near = el.closest('a[href*="/status/"]');
      if (near && status(near.href)) return status(near.href);
      const article = el.closest("article");
      const time = article?.querySelector('a[href*="/status/"] time');
      if (time) return status(time.closest("a").href);
      const any = article?.querySelector('a[href*="/status/"]');
      return status(any?.href) || status(location.href);
    }
    if (SITE === "linkedin") {
      const node = el.closest('[data-urn^="urn:li:"], [data-id^="urn:li:"]');
      const urn = node?.getAttribute("data-urn") || node?.getAttribute("data-id") || "";
      if (/^urn:li:(activity|ugcPost|share):\d+/.test(urn)) return `https://www.linkedin.com/feed/update/${urn}/`;
      if (/\/(feed\/update|posts)\//.test(location.pathname)) return clean(location.href);
      return "";
    }
    return "";
  }

  const pageUrl = () => { try { const u = new URL(location.href); u.hash = ""; return u.href; } catch { return location.href; } };

  function describe(el) {
    const post = postUrl(el);
    const isVideo = el instanceof HTMLVideoElement;
    const direct = isVideo ? directVideo(el) : bestImage(el);
    const page = pageUrl();
    // On profile grids a reel is only a thumbnail image linking to /reel/…
    const reelThumb = SITE === "instagram" && !isVideo && /\/reels?\//.test(post);
    return {
      // what Atlas downloads: the file itself when reachable, else the post or page
      url: direct || post || (isVideo ? page : ""),
      // what Atlas records as the link: the post or page the media lives on
      sourceUrl: post || page,
      key: direct || `${post}#${isVideo ? "video" : "image"}`,
      post,
      resolveVideo: SITE === "instagram" && !!post && (reelThumb || (isVideo && !direct))
    };
  }

  /* ---------- Instagram: find the real video file ---------- */
  // Instagram plays videos from a blob: stream that nothing outside the tab can fetch.
  // The post's own data (read with your logged-in session) lists the actual .mp4.

  function instagramMediaId(post) {
    const story = post.match(/\/stories\/[^/]+\/(\d+)/);
    if (story) return story[1];
    const m = post.match(/\/(?:p|reel|reels|tv)\/([A-Za-z0-9_-]+)/);
    if (!m) return "";
    const abc = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
    let id = 0n;
    for (const ch of m[1].slice(0, 11)) {
      const i = abc.indexOf(ch);
      if (i < 0) return "";
      id = id * 64n + BigInt(i);
    }
    return id.toString();
  }

  const fileName = (u) => { try { return new URL(u, location.href).pathname.split("/").pop(); } catch { return ""; } };

  function videoFromItem(item, el) {
    if (!item) return "";
    const slides = item.carousel_media?.length ? item.carousel_media : [item];
    const videos = slides.filter((sl) => sl?.video_versions?.length);
    if (!videos.length) return "";

    // In a carousel, match the hovered slide by its poster image.
    let pick = videos[0];
    const poster = fileName(el.poster || el.currentSrc || el.src || "");
    if (videos.length > 1 && poster) {
      pick = videos.find((sl) => (sl.image_versions2?.candidates || []).some((c) => fileName(c.url) === poster)) || pick;
    }
    const best = [...pick.video_versions].sort((p, q) => (q.width || 0) * (q.height || 0) - (p.width || 0) * (p.height || 0))[0];
    return isHttp(best?.url) ? best.url : "";
  }

  // 1) Ask ig-hook.js (page world) for the post data Instagram already loaded.
  function askPage(keys) {
    return new Promise((resolve) => {
      const id = Math.random().toString(36).slice(2);
      const done = (item) => { removeEventListener("message", on); clearTimeout(timer); resolve(item); };
      const on = (e) => { if (e.source === window && e.data?.type === "atlas-ig-answer" && e.data.id === id) done(e.data.item); };
      const timer = setTimeout(() => done(undefined), 1500); // undefined = ig-hook.js never answered
      addEventListener("message", on);
      window.postMessage({ type: "atlas-ig-ask", id, keys }, location.origin);
    });
  }

  // 2) Ask Instagram's API with the same headers its web app sends.
  async function askApi(id) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 7000);
    try {
      const csrf = document.cookie.match(/(?:^|;\s*)csrftoken=([^;]+)/)?.[1];
      let claim = "0";
      try { claim = sessionStorage.getItem("www-claim-v2") || "0"; } catch {}
      const res = await fetch(`/api/v1/media/${id}/info/`, {
        headers: {
          "X-IG-App-ID": "936619743392459",
          "X-ASBD-ID": "129477",
          "X-IG-WWW-Claim": claim,
          "X-Requested-With": "XMLHttpRequest",
          ...(csrf ? { "X-CSRFToken": csrf } : {})
        },
        credentials: "include",
        signal: ctrl.signal
      });
      if (!res.ok) { lastWhy.api = `API ${res.status}`; return null; }
      const item = (await res.json())?.items?.[0] || null;
      lastWhy.api = item ? (item.video_versions || item.carousel_media ? "API ok" : "API no video") : "API empty";
      return item;
    } catch (e) {
      lastWhy.api = e?.name === "AbortError" ? "API timeout" : "API error";
      return null;
    } finally {
      clearTimeout(timer);
    }
  }

  // Why the last lookup failed, shown in the tip so a failure can be traced.
  const lastWhy = { page: "", api: "" };

  async function instagramVideo(el, post) {
    lastWhy.page = lastWhy.api = "";
    const id = instagramMediaId(post);
    const code = post.match(/\/(?:p|reel|reels|tv)\/([A-Za-z0-9_-]+)/)?.[1];
    if (!id && !code) { lastWhy.page = "no post id"; return ""; }
    const pageItem = await askPage([code, id]);
    lastWhy.page = pageItem === undefined ? "hook missing" : pageItem ? "page item, no video" : "page no data";
    const fromPage = videoFromItem(pageItem, el);
    if (fromPage) return fromPage;
    const fromApi = id ? videoFromItem(await askApi(id), el) : "";
    console.info("[Atlas Saver] Instagram video lookup", { post, code, id, ...lastWhy, found: !!fromApi });
    return fromApi;
  }

  /* ---------- behaviour ---------- */

  let current = null;
  let state = "idle";
  let hideTimer = 0;
  let tipTimer = 0;
  let px = -1, py = -1, queued = false;
  let alt = false; // the + button only shows while the chosen key (⌥ by default) is held
  let noting = false; // the note panel is open
  const saved = new Set();

  function setState(next, message) {
    state = next;
    btn.dataset.state = next;
    btn.setAttribute("aria-label", next === "saved" ? "Saved to Atlas" : next === "saving" ? "Saving to Atlas" : "Save to Atlas");
    clearTimeout(tipTimer);
    if (message) {
      tip.textContent = message;
      tip.classList.add("on");
      place();
      tipTimer = setTimeout(() => tip.classList.remove("on"), 2600);
    } else {
      tip.classList.remove("on");
    }
  }

  function place() {
    if (!current) return;
    if (!current.isConnected) return hide(true);
    const r = current.getBoundingClientRect();
    if (r.bottom < SIZE || r.top > innerHeight || !bigEnough(r)) return hide(true);
    const left = Math.min(r.right, innerWidth) - SIZE - INSET;
    const top = Math.max(r.top, 0) + INSET;
    btn.style.translate = `${Math.round(left)}px ${Math.round(top)}px`;
    const tipW = tip.offsetWidth;
    tip.style.translate = `${Math.round(left - tipW - 6)}px ${Math.round(top)}px`;
  }

  function show(el) {
    clearTimeout(hideTimer);
    if (el !== current) {
      current = el;
      if (state !== "saving") setState(saved.has(describe(el).key) ? "saved" : "idle");
    }
    if (!host.isConnected) document.documentElement.appendChild(host);
    place();
    btn.classList.add("on");
  }

  function hide(now) {
    clearTimeout(hideTimer);
    const run = () => {
      if (state === "saving" || noting) return; // keep the button while saving or writing a note
      btn.classList.remove("on");
      tip.classList.remove("on");
      current = null;
    };
    now ? run() : (hideTimer = setTimeout(run, 120));
  }

  // The button only appears once the pointer nears the media's top-right corner.
  function inCorner(el) {
    const r = el.getBoundingClientRect();
    const zone = Math.max(72, Math.min(140, Math.min(r.width, r.height) * 0.35));
    const right = Math.min(r.right, innerWidth);
    const top = Math.max(r.top, 0);
    return px >= right - zone && px <= right && py >= top && py <= top + zone;
  }

  function track() {
    queued = false;
    const el = mediaAt(px, py);
    el && alt && inCorner(el) ? show(el) : current && hide(true);
  }

  const schedule = () => { if (!queued) { queued = true; requestAnimationFrame(track); } };
  const setAlt = (on) => { if (on !== alt) { alt = on; if (px >= 0) schedule(); } };
  const setMeta = (on) => { btn.dataset.note = on ? "1" : ""; };

  // Keys are set in the popup: hoverKey shows the + button ("none" = always),
  // noteKey held as well opens the note and tags panel before saving.
  const KEY_PROP = { Alt: "altKey", Control: "ctrlKey", Shift: "shiftKey", Meta: "metaKey" };
  let hoverKey = "Alt", noteKey = "Meta";
  const held = (e, key) => key === "none" || !!e[KEY_PROP[key]];
  function applyKeys(v = {}) {
    hoverKey = v.hoverKey === "none" || KEY_PROP[v.hoverKey] ? v.hoverKey : "Alt";
    noteKey = KEY_PROP[v.noteKey] && v.noteKey !== hoverKey ? v.noteKey : hoverKey === "Meta" ? "Alt" : "Meta";
    setAlt(hoverKey === "none");
  }
  try {
    chrome.storage.local.get(["hoverKey", "noteKey"]).then(applyKeys, () => {});
    chrome.storage.onChanged.addListener((c, area) => {
      if (area === "local" && (c.hoverKey || c.noteKey)) chrome.storage.local.get(["hoverKey", "noteKey"]).then(applyKeys, () => {});
    });
  } catch { /* extension reloaded under this tab */ }

  addEventListener("keydown", (e) => { if (e.key === hoverKey) setAlt(true); if (e.key === noteKey) setMeta(true); }, true);
  addEventListener("keyup", (e) => { if (e.key === hoverKey) setAlt(false); if (e.key === noteKey) setMeta(false); }, true);
  addEventListener("blur", () => { setAlt(hoverKey === "none"); setMeta(false); });

  document.addEventListener("pointermove", (e) => {
    if (e.pointerType === "touch") return;
    px = e.clientX; py = e.clientY;
    alt = held(e, hoverKey);
    setMeta(held(e, noteKey));
    schedule();
  }, { passive: true, capture: true });

  addEventListener("scroll", () => { if (current) requestAnimationFrame(place); }, { passive: true, capture: true });
  addEventListener("resize", () => { if (current) place(); }, { passive: true });
  document.addEventListener("pointerleave", () => hide(true));

  // Keep the page from reacting to presses on the button (opening the post, pausing the video…).
  for (const type of ["pointerdown", "mousedown", "mouseup", "pointerup", "dblclick"]) {
    btn.addEventListener(type, (e) => e.stopPropagation());
  }

  btn.addEventListener("click", async (e) => {
    e.preventDefault();
    e.stopPropagation();
    try { window.postMessage({ type: "atlas-debug", info: { step: "click", hasCurrent: !!current, tag: current?.tagName, state } }, location.origin); } catch {}
    if (!current || state === "saving") return;
    if (state === "saved") return setState("saved", "Already saved");

    const target = current;
    const info = describe(target);
    if (!info.url) return fail("No link found for this post");

    let extras = null;
    if (held(e, noteKey)) {
      noting = true;
      extras = await openNote(target, info);
      noting = false;
      if (!extras) { if (!mediaAt(px, py)) hide(false); return; }
    }

    setState("saving");
    let viaPost = false, igFile = false;
    const igNoPost = SITE === "instagram" && !info.post && !info.url.startsWith("https://scontent") && target instanceof HTMLVideoElement;
    if (info.resolveVideo) {
      const file = await instagramVideo(target, info.post);
      if (file) { info.url = file; igFile = true; }
      else { info.url = info.post; viaPost = true; }
    }
    const debug = (extra) => { try { window.postMessage({ type: "atlas-debug", info: { tag: target.tagName, post: info.post, resolveVideo: info.resolveVideo, sent: String(info.url).slice(0, 90), viaPost, igFile, ...lastWhy, ...extra } }, location.origin); } catch {} };
    debug({ step: "sending" });
    let res;
    try {
      res = await chrome.runtime.sendMessage({ type: "atlas-save", payload: { url: info.url, sourceUrl: info.sourceUrl, ...(extras || {}) } });
    } catch {
      res = { ok: false, error: "Reload the page" }; // extension was updated under this tab
    }

    debug({ step: "answered", res });
    if (res?.ok) {
      saved.add(info.key);
      if (current === target || !current) setState("saved", extras && res.noted === false ? "Saved, note or tags not added" : extras && res.duplicate ? "Already in Atlas, note added" : extras ? "Saved with note" : res.linked === false ? "Saved, link not attached" : viaPost ? `Sent post link (${lastWhy.page || "?"} · ${lastWhy.api || "no API call"})` : igNoPost ? "Sent page link (post not found)" : res.duplicate ? "Already in Atlas" : igFile ? "Saved video file to Atlas" : res.converted ? "Saved to Atlas as MP4" : "Saved to Atlas");
      else setState(saved.has(describe(current).key) ? "saved" : "idle");
    } else {
      fail(res?.error || "No answer from the extension, reload the page");
    }
    if (!mediaAt(px, py)) hide(false);
  });

  function fail(message) {
    setState("error", message);
    setTimeout(() => { if (state === "error") setState("idle"); }, 2600);
  }
  /* ---------- note and tags panel (⌘⌥ + click) ---------- */

  const scrim = document.createElement("div");
  scrim.className = "scrim";
  root.append(scrim);
  let tagNames = null;

  function openNote(target, info) {
    return new Promise((resolve) => {
      const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text) n.textContent = text; return n; };
      const modal = el("div", "modal");
      modal.setAttribute("role", "dialog");
      modal.setAttribute("aria-modal", "true");
      modal.setAttribute("aria-label", "Save to Atlas with a note");

      const head = el("div", "head");
      const thumb = el("img", "thumb");
      thumb.alt = "";
      const still = target instanceof HTMLVideoElement ? target.poster : target.currentSrc || target.src;
      if (still) thumb.src = still; else thumb.style.visibility = "hidden";
      const text = el("div");
      let where = info.sourceUrl;
      try { const u = new URL(info.sourceUrl); where = u.hostname.replace(/^www\./, "") + u.pathname.replace(/\/$/, ""); } catch {}
      text.append(el("div", "title", "Save to Atlas"), el("div", "sub", where));
      head.append(thumb, text);

      const note = el("textarea");
      note.placeholder = "Add a note…";
      note.rows = 3;

      const tags = [];
      const box = el("div", "tagbox");
      const input = el("input");
      input.placeholder = "Add tags";
      input.setAttribute("aria-label", "Tags");
      box.append(input);
      const sugg = el("div", "sugg");

      const actions = el("div", "actions");
      const cancel = el("button", "", "Cancel");
      const save = el("button", "primary", "Save");
      cancel.type = save.type = "button";
      actions.append(el("span", "hint", "⌘↵ to save · esc to cancel"), cancel, save);

      modal.append(head, note, box, sugg, actions);
      scrim.replaceChildren(modal);
      scrim.classList.add("on");

      function drawChips() {
        box.querySelectorAll(".chip").forEach((c) => c.remove());
        for (const t of tags) {
          const chip = el("span", "chip", t);
          const x = el("b", "", "×");
          x.setAttribute("aria-label", `Remove ${t}`);
          x.addEventListener("click", (e) => { e.stopPropagation(); tags.splice(tags.indexOf(t), 1); drawChips(); drawSugg(); });
          chip.append(x);
          box.insertBefore(chip, input);
        }
      }
      function addTag(t) {
        t = t.replace(/,/g, "").trim().replace(/^#/, "");
        if (t && !tags.some((x) => x.toLowerCase() === t.toLowerCase())) tags.push(t);
        input.value = "";
        drawChips();
        drawSugg();
      }
      function drawSugg() {
        const q = input.value.trim().toLowerCase();
        const pool = (tagNames || []).filter((n) => !tags.includes(n));
        const list = (q ? pool.filter((n) => n.toLowerCase().includes(q)) : pool).slice(0, 8);
        sugg.replaceChildren(...list.map((n, i) => {
          const s = el("span", q && i === 0 ? "hi" : "", n);
          s.addEventListener("mousedown", (e) => { e.preventDefault(); addTag(n); input.focus(); });
          return s;
        }));
      }
      if (tagNames) drawSugg();
      else chrome.runtime.sendMessage({ type: "atlas-tags" }).then((r) => { tagNames = r?.names || []; drawSugg(); }, () => {});

      input.addEventListener("input", () => {
        // A comma (typed or pasted) ends a tag.
        if (input.value.includes(",")) {
          const parts = input.value.split(",");
          const rest = parts.pop();
          for (const p of parts) addTag(p);
          input.value = rest;
        }
        drawSugg();
      });
      input.addEventListener("keydown", (e) => {
        if ((e.key === "Enter" && !e.metaKey) || e.key === ",") {
          e.preventDefault();
          const pick = input.value.trim() && sugg.querySelector(".hi");
          addTag(pick ? pick.textContent : input.value);
        } else if (e.key === "Backspace" && !input.value && tags.length) {
          tags.pop();
          drawChips();
          drawSugg();
        }
      });
      box.addEventListener("click", () => input.focus());

      const close = (result) => {
        scrim.classList.remove("on");
        scrim.replaceChildren();
        resolve(result);
      };
      const submit = () => {
        if (input.value.trim()) addTag(input.value);
        close({ note: note.value.trim(), tags: [...tags] });
      };
      save.addEventListener("click", submit);
      cancel.addEventListener("click", () => close(null));
      scrim.onpointerdown = (e) => { if (e.target === scrim) close(null); };

      // Keep typing inside the panel: no page shortcuts (X, Instagram…) fire while it's open.
      for (const type of ["keydown", "keyup", "keypress"]) {
        modal.addEventListener(type, (e) => {
          e.stopPropagation();
          if (type !== "keydown") return;
          if (e.key === "Escape") { e.preventDefault(); close(null); }
          else if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); submit(); }
        });
      }
      for (const type of ["pointerdown", "mousedown", "click", "wheel"]) modal.addEventListener(type, (e) => e.stopPropagation());

      requestAnimationFrame(() => note.focus());
    });
  }
})();
