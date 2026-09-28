const CACHE = "warisan-cafe-v5";

/* Assets to pre-cache on install */
const PRECACHE = [
  "/common.css",
  "/app.js",
  "/firebase-config.js",
  "/images/logo.png?v=warisan",
  "https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css",
  "https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/js/bootstrap.bundle.min.js",
  "https://cdn.jsdelivr.net/npm/bootstrap-icons@1.11.0/font/bootstrap-icons.css",
  "https://www.gstatic.com/firebasejs/10.12.5/firebase-app-compat.js",
  "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth-compat.js",
  "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore-compat.js",
  "https://www.gstatic.com/firebasejs/10.12.5/firebase-storage-compat.js",
  "https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js",
];

/* Install: pre-cache everything */
self.addEventListener("install", (e) => {
  e.waitUntil(
    caches.open(CACHE).then((cache) =>
      Promise.allSettled(PRECACHE.map((url) => cache.add(url)))
    ).then(() => self.skipWaiting())
  );
});

/* Activate: delete old caches */
self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

/* Fetch: cache-first for CDN & static assets, network-first for HTML & API */
self.addEventListener("fetch", (e) => {
  const { request } = e;
  const url = new URL(request.url);

  /* Skip non-GET, Chrome extensions, all Firebase/Google auth traffic */
  if (request.method !== "GET") return;
  if (url.protocol === "chrome-extension:") return;
  if (url.hostname.includes("firebaseio.com")) return;
  if (url.hostname.includes("googleapis.com")) return;
  if (url.hostname.includes("firebaseapp.com")) return;
  if (url.hostname.includes("firebase.com")) return;
  if (url.hostname.includes("accounts.google.com")) return;
  if (url.pathname.startsWith("/api/")) return;

  /* CDN and local static assets → cache-first */
  const isCDN = url.hostname.includes("jsdelivr.net") ||
                url.hostname.includes("gstatic.com") ||
                url.hostname.includes("bootstrap") ||
                url.hostname.includes("googleapis.com");
  const isStatic = /\.(js|css|png|jpg|jpeg|gif|webp|woff2?|ttf|svg|ico)$/i.test(url.pathname);

  if (isCDN || isStatic) {
    e.respondWith(
      caches.match(request).then((cached) => {
        if (cached) return cached;
        return fetch(request).then((res) => {
          if (res.ok) {
            const clone = res.clone();
            caches.open(CACHE).then((c) => c.put(request, clone));
          }
          return res;
        });
      })
    );
    return;
  }

  /* HTML pages → network-first, fall back to cache */
  if (request.headers.get("accept")?.includes("text/html")) {
    e.respondWith(
      fetch(request)
        .then((res) => {
          if (res.ok) {
            const clone = res.clone();
            caches.open(CACHE).then((c) => c.put(request, clone));
          }
          return res;
        })
        .catch(() => caches.match(request))
    );
  }
});
