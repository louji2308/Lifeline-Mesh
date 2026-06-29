const CACHE_NAME = "lifeline-mesh-v14";

const ASSET_PATHS = [
  "/",
  "/index.html",
  "/manifest.json",
  "/src/app.js",
  "/src/schema.js",
  "/src/signaling/qrSignaling.js",
  "/src/signaling/qrCodec.js",
  "/src/signaling/qrcode-lib.js",
  "/src/signaling/lanDiscovery.js",
  "/src/transport/peerManager.js",
  "/src/transport/dataChannel.js",
  "/src/routing/bloomFilter.js",
  "/src/routing/priorityQueue.js",
  "/src/routing/gossipRouter.js",
  "/src/crdt/vectorClock.js",
  "/src/crdt/messageLog.js",
  "/src/crypto/keyManager.js",
  "/src/crypto/ecdh.js",
  "/src/crypto/cipher.js",
  "/src/storage/db.js",
  "/src/ui/meshStatus.js",
  "/src/ui/chatView.js",
  "/src/ui/pairingView.js",
  "/src/ui/effects.js",
  "/icons/icon-192.svg",
  "/icons/icon-512.svg",
];

function resolveAssetPath(relativePath) {
  const base = self.location.pathname.replace(/\/[^/]*$/, "/");
  if (base === "/") return relativePath;
  const cleanBase = base.replace(/\/$/, "");
  const cleanPath = relativePath.replace(/^\//, "");
  return `${cleanBase}/${cleanPath}`;
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(async (cache) => {
      const urls = ASSET_PATHS.map(resolveAssetPath);
      const results = await Promise.allSettled(
        urls.map((url) =>
          fetch(url).then((res) => {
            if (res.ok) return cache.put(url, res);
            throw new Error(`Failed to fetch ${url}: ${res.status}`);
          })
        )
      );
      const failed = results.filter((r) => r.status === "rejected");
      if (failed.length > 0) {
        console.warn(`[SW] ${failed.length} assets failed to cache:`, failed.map((r) => r.reason.message));
      }
    })
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames
          .filter((name) => name !== CACHE_NAME)
          .map((name) => caches.delete(name))
      );
    }).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;
      return fetch(event.request).then((response) => {
        if (response && response.status === 200 && response.type === "basic") {
          const cloned = response.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, cloned);
          });
        }
        return response;
      }).catch(() => {
        return new Response("Offline: LifeLine Mesh requires cache to be primed.", {
          status: 503,
          statusText: "Service Unavailable",
        });
      });
    })
  );
});
