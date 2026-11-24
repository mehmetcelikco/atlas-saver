// Tiny IndexedDB store shared by the service worker and the offscreen page, used to hand
// a screenshot Blob across without squeezing it through a message or a data: URL.
const ShotStore = (() => {
  const open = () => new Promise((resolve, reject) => {
    const req = indexedDB.open("atlas-saver", 1);
    req.onupgradeneeded = () => req.result.createObjectStore("shots");
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  const run = async (mode, fn) => {
    const db = await open();
    try {
      return await new Promise((resolve, reject) => {
        const tx = db.transaction("shots", mode);
        const req = fn(tx.objectStore("shots"));
        tx.oncomplete = () => resolve(req.result);
        tx.onerror = tx.onabort = () => reject(tx.error);
      });
    } finally {
      db.close();
    }
  };
  return {
    put: (key, blob) => run("readwrite", (s) => s.put(blob, key)),
    get: (key) => run("readonly", (s) => s.get(key)),
    del: (key) => run("readwrite", (s) => s.delete(key))
  };
})();
