// Service workers can't make blob: URLs, so this hidden page does it for downloads.
const urls = new Map();
chrome.runtime.onMessage.addListener((msg, _sender, respond) => {
  if (msg?.target !== "offscreen") return;
  if (msg.type === "blob-url") {
    ShotStore.get(msg.key).then((blob) => {
      if (!blob) return respond({ ok: false, error: "Screenshot data went missing" });
      const url = URL.createObjectURL(blob);
      urls.set(msg.key, url);
      respond({ ok: true, url });
    }, (e) => respond({ ok: false, error: e.message }));
    return true;
  }
  if (msg.type === "to-mp4") {
    toMp4(msg.url, msg.key).then(respond, (e) => respond({ ok: false, error: e.message || "Couldn't convert the video" }));
    return true;
  }
  if (msg.type === "revoke") {
    const url = urls.get(msg.key);
    if (url) URL.revokeObjectURL(url);
    urls.delete(msg.key);
    respond({ ok: true });
  }
});

// Play the video and record it in real time as H.264 MP4 (Chrome's MediaRecorder).
async function toMp4(url, key) {
  const res = await fetch(url, { credentials: "omit" });
  if (!res.ok) throw new Error(`Video download failed (${res.status})`);
  const src = URL.createObjectURL(await res.blob());
  const v = document.createElement("video");
  v.muted = true;
  v.playsInline = true;
  v.preload = "auto";
  v.src = src;
  try {
    await new Promise((ok, bad) => {
      v.onloadedmetadata = ok;
      v.onerror = () => bad(new Error("Chrome can't play this video"));
    });
    if (v.duration > 300) throw new Error("Video is longer than 5 minutes");

    const stream = v.captureStream();
    const withAudio = stream.getAudioTracks().length > 0;
    const types = withAudio
      ? ["video/mp4;codecs=avc1.640028,mp4a.40.2", "video/mp4;codecs=avc1,mp4a.40.2", "video/mp4"]
      : ["video/mp4;codecs=avc1.640028", "video/mp4;codecs=avc1", "video/mp4"];
    const mimeType = types.find((t) => MediaRecorder.isTypeSupported(t));
    if (!mimeType) throw new Error("This Chrome can't record MP4");

    const bitrate = Math.min(20e6, Math.max(4e6, v.videoWidth * v.videoHeight * 8));
    const rec = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: bitrate });
    const chunks = [];
    rec.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
    const stopped = new Promise((r) => (rec.onstop = r));

    rec.start(1000);
    await v.play();
    const limit = Number.isFinite(v.duration) ? (v.duration + 10) * 1000 : 300000;
    await new Promise((r) => { v.onended = r; setTimeout(r, limit); });
    rec.stop();
    await stopped;

    const out = new Blob(chunks, { type: "video/mp4" });
    if (out.size < 1000) throw new Error("Video conversion came out empty");
    await ShotStore.put(key, out);
    return { ok: true, size: out.size };
  } finally {
    v.pause();
    v.removeAttribute("src");
    URL.revokeObjectURL(src);
  }
}
