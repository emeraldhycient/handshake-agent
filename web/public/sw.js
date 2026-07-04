/*
 * Handshake Agent service worker — offline app shell for the installable PWA.
 *
 * Routing mirrors lib/pwa/sw-strategy.ts (unit-tested there; a classic worker
 * can't import it, so keep the two in sync):
 *   - non-GET / cross-origin            → passthrough (browser handles it)
 *   - same-origin /api/*                → network-only  (auth/chat/wallet NEVER cached)
 *   - navigations                       → network-first (fresh shell, offline fallback)
 *   - hashed static, icons, fonts, css  → cache-first   (immutable assets)
 *   - everything else same-origin GET   → network-first
 *
 * Safety (root CLAUDE.md §3): no money-moving or authenticated response is ever
 * stored. Only same-origin, ok, basic responses are cached.
 */
const VERSION = "hs-pwa-v1"
const CACHE = `handshake-${VERSION}`
const OFFLINE_URL = "/offline"

// App shell precached on install so the core UI opens with no network.
const PRECACHE_URLS = [
  "/",
  OFFLINE_URL,
  "/download",
  "/manifest.webmanifest",
  "/icon.svg",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
  "/icons/apple-touch-icon.png",
]

const STATIC_EXT =
  /\.(?:js|css|svg|png|jpe?g|gif|webp|avif|ico|woff2?|ttf|otf|eot)$/i
const STATIC_PREFIX = ["/_next/static/", "/icons/", "/fonts/", "/og/"]

function resolveStrategy(method, sameOrigin, pathname, isNavigate) {
  if (method !== "GET") return "passthrough"
  if (!sameOrigin) return "passthrough"
  if (pathname === "/api" || pathname.startsWith("/api/")) return "network-only"
  if (isNavigate) return "network-first"
  if (
    STATIC_PREFIX.some((p) => pathname.startsWith(p)) ||
    pathname === "/manifest.webmanifest" ||
    STATIC_EXT.test(pathname)
  ) {
    return "cache-first"
  }
  return "network-first"
}

function cacheable(response) {
  return response && response.ok && response.type === "basic"
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) =>
      // Per-URL so one missing asset can't fail the whole precache.
      Promise.allSettled(PRECACHE_URLS.map((url) => cache.add(url)))
    )
  )
  self.skipWaiting()
})

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((k) => k.startsWith("handshake-") && k !== CACHE)
            .map((k) => caches.delete(k))
        )
      )
      .then(() => self.clients.claim())
  )
})

self.addEventListener("message", (event) => {
  if (event.data === "SKIP_WAITING") self.skipWaiting()
})

async function cacheFirst(request) {
  const cache = await caches.open(CACHE)
  const cached = await cache.match(request)
  if (cached) {
    // Revalidate in the background so the next load is fresh.
    fetch(request)
      .then((res) => {
        if (cacheable(res)) cache.put(request, res.clone())
      })
      .catch(() => {})
    return cached
  }
  const res = await fetch(request)
  if (cacheable(res)) cache.put(request, res.clone())
  return res
}

async function networkFirst(request, isNavigate) {
  const cache = await caches.open(CACHE)
  try {
    const res = await fetch(request)
    if (cacheable(res)) cache.put(request, res.clone())
    return res
  } catch (err) {
    const cached = await cache.match(request)
    if (cached) return cached
    if (isNavigate) {
      const offline = await cache.match(OFFLINE_URL)
      if (offline) return offline
    }
    throw err
  }
}

self.addEventListener("fetch", (event) => {
  const { request } = event
  const url = new URL(request.url)
  const sameOrigin = url.origin === self.location.origin
  const isNavigate = request.mode === "navigate"
  const strategy = resolveStrategy(
    request.method,
    sameOrigin,
    url.pathname,
    isNavigate
  )

  if (strategy === "passthrough") return
  if (strategy === "network-only") {
    event.respondWith(fetch(request))
    return
  }
  if (strategy === "cache-first") {
    event.respondWith(cacheFirst(request))
    return
  }
  event.respondWith(networkFirst(request, isNavigate))
})
