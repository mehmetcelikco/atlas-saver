#!/usr/bin/python3
# Atlas Saver helper: Chrome hands it a screenshot, it writes the PNG to a private
# cache folder so Atlas can import it. Nothing lands in Downloads.
import base64, json, os, struct, sys, time

DIR = os.path.expanduser("~/Library/Caches/Atlas Saver")


def read():
    raw = sys.stdin.buffer.read(4)
    if len(raw) < 4:
        return None
    size = struct.unpack("<I", raw)[0]
    return json.loads(sys.stdin.buffer.read(size).decode("utf-8"))


def send(obj):
    data = json.dumps(obj).encode("utf-8")
    sys.stdout.buffer.write(struct.pack("<I", len(data)) + data)
    sys.stdout.buffer.flush()


def inside(path):
    real = os.path.realpath(path)
    return real.startswith(os.path.realpath(DIR) + os.sep)


def sweep():
    # Leftovers older than an hour (Atlas keeps its own copy).
    now = time.time()
    for name in os.listdir(DIR):
        p = os.path.join(DIR, name)
        try:
            if os.path.isfile(p) and now - os.path.getmtime(p) > 3600:
                os.remove(p)
        except OSError:
            pass


def handle(msg):
    op = msg.get("op")
    if op == "ping":
        return {"ok": True, "version": 1}
    if op == "write":
        os.makedirs(DIR, exist_ok=True)
        sweep()
        name = os.path.basename(msg.get("name") or "screenshot.png") or "screenshot.png"
        stem, ext = os.path.splitext(name)
        path, n = os.path.join(DIR, name), 1
        while os.path.exists(path):
            n += 1
            path = os.path.join(DIR, f"{stem}-{n}{ext}")
        with open(path, "wb") as f:
            f.write(base64.b64decode(msg["data"]))
        return {"ok": True, "path": path}
    if op == "remove":
        path = msg.get("path") or ""
        if inside(path) and os.path.isfile(path):
            os.remove(path)
        return {"ok": True}
    return {"ok": False, "error": "Unknown request"}


msg = read()
if msg is not None:
    try:
        send(handle(msg))
    except Exception as e:  # report instead of dying silently
        send({"ok": False, "error": str(e)[:200]})
