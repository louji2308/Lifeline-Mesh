const CACHE_NAME = "lifeline-mesh-v3";

const ASSETS = [
  "/",
  "/index.html",
  "/manifest.json",
  "/src/app.js",
  "/src/schema.js",
  "/src/signaling/qrSignaling.js",
  "/src/signaling/qrCodec.js",
  "/src/signaling/qrEncoder.js",
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
  "/icons/icon-192.svg",
  "/icons/icon-512.svg",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(ASSETS);
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
