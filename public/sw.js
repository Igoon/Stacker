// Service worker: cache app shell untuk offline (data tetap di OPFS).
// `scripts/gen-sw-preache.mjs` mengganti dua blok di bawah saat `npm run build`
// dengan daftar aset ber-hash + nama cache unik per build.
// CACHE-BEGIN
const CACHE = "stacker-v9";
// CACHE-END
// PRECACHE-BEGIN
const PRECACHE = [
  "./",
  "./manifest.webmanifest",
  "./icon.svg",
  "./icon-192.png",
  "./icon-512.png",
  "./icon-maskable-512.png",
  "./apple-touch-icon.png",
];
// PRECACHE-END

const ASSET_DEST = new Set(["script", "style", "worker", "image", "font", "manifest"]);

self.addEventListener("install", (e) => {
  // JANGAN skipWaiting: versi baru menunggu sampai user menekan "Muat ulang".
  // Ini mencegah app berganti versi diam-diam saat dibuka ulang.
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(PRECACHE)));
});

self.addEventListener("message", (e) => {
  if (e.data && e.data.type === "SKIP_WAITING") self.skipWaiting();
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    (async () => {
      // Simpan cache versi sebelumnya satu siklus supaya tab lama yang masih
      // terbuka tidak 404 saat meminta aset lama.
      const META = "stacker-meta";
      const meta = await caches.open(META);
      const prevRes = await meta.match("/prev");
      const prev = prevRes ? await prevRes.text() : "";
      const keep = new Set([CACHE, prev].filter(Boolean));
      for (const k of await caches.keys()) {
        if (k !== META && !keep.has(k)) await caches.delete(k);
      }
      await meta.put("/prev", new Response(CACHE));
      await self.clients.claim();
    })()
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
    // ignoreVary: request modul bisa membawa Origin berbeda. Query hanya
    // diabaikan untuk proxy sqlite (`?vfs=...`), jangan untuk `?url`/`?worker_file`
    // karena artinya beda.
    e.respondWith(
      caches.open(CACHE).then(async (c) => {
        let hit = await c.match(req, { ignoreVary: true });
        if (!hit) hit = await caches.match(req, { ignoreVary: true }); // cache versi sebelumnya
        if (!hit && url.pathname.includes("sqlite3-opfs-async-proxy")) {
          hit =
            (await c.match(req, { ignoreVary: true, ignoreSearch: true })) ??
            (await caches.match(req, { ignoreVary: true, ignoreSearch: true }));
        }
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

  // version.json (info update) → SELALU dari jaringan, jangan pernah dianggap
  // shell. Tanpa ini, cache-first navigasi bisa mengembalikan HTML untuk JSON.
  if (url.pathname.endsWith("/version.json") || url.pathname === "/version.json") {
    e.respondWith(fetch(req, { cache: "no-store" }).catch(() => Response.error()));
    return;
  }

  // Navigasi (dokumen) → CACHE-FIRST dari cache SW aktif. Versi baru hanya
  // dipakai setelah SW baru diaktifkan lewat tombol "Muat ulang".
  if (req.mode === "navigate" || req.destination === "document") {
    e.respondWith(
      caches.open(CACHE).then(async (c) => {
        const hit = await c.match("./", { ignoreVary: true, ignoreSearch: true });
        if (hit) return hit;
        try {
          return await fetch(req);
        } catch {
          return (
            (await caches.match("./", { ignoreVary: true, ignoreSearch: true })) || Response.error()
          );
        }
      })
    );
  }
  // Request same-origin lain (non-aset, non-navigasi) dibiarkan lewat jaringan.
});
