// Service worker: cache app shell untuk offline (data tetap di OPFS).
const CACHE = "duit-bot-v2";
const PRECACHE = ["./", "./manifest.webmanifest", "./icon.svg"];

const ASSET_DEST = new Set(["script", "style", "worker", "image", "font", "manifest"]);

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(PRECACHE)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);

  // Hanya tangani aset same-origin; lewati request lintas-origin (mis. Gemini).
  if (url.origin !== self.location.origin) return;

  const isAsset =
    ASSET_DEST.has(req.destination) || url.pathname.endsWith(".wasm");

  if (isAsset) {
    // Stale-while-revalidate untuk aset ber-hash (script/style/worker/wasm).
    e.respondWith(
      caches.open(CACHE).then(async (c) => {
        const hit = await c.match(req);
        const network = fetch(req)
          .then((res) => {
            if (res.ok) c.put(req, res.clone());
            return res;
          })
          .catch(() => hit);
        return hit || network;
      })
    );
    return;
  }

  // Navigasi (dokumen) → network-first, fallback ke shell.
  e.respondWith(
    fetch(req)
      .then((res) => res)
      .catch(() => caches.match("./"))
  );
});
