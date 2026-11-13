/*
 * Offline support. The game is fully client-side, so once the shell and its assets are cached it
 * plays with no connection.
 * - Pages: network first, cached shell when offline, so a new deploy is picked up right away.
 *   Only a good response for the root replaces the cached shell, and assets the new shell no
 *   longer references are dropped, so old builds do not pile up.
 * - Hashed build assets (/assets/*) and font files: cache first. Their names change with content.
 * - Everything else (icons, manifest, font CSS): served from cache, refreshed in the background.
 */
const CACHE = 'bounce-arena-v3'
const SHELL = ['/', '/manifest.webmanifest', '/favicon.svg', '/icons/icon-192.png', '/icons/icon-512.png']

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()))
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  )
})

/** Drop cached /assets/* files the current shell no longer links. */
async function prune(html) {
  const cache = await caches.open(CACHE)
  const live = new Set([...html.matchAll(/\/assets\/[^"'\s)]+/g)].map((m) => m[0]))
  for (const req of await cache.keys()) {
    const path = new URL(req.url).pathname
    if (path.startsWith('/assets/') && !live.has(path)) await cache.delete(req)
  }
}

async function page(req) {
  try {
    const res = await fetch(req)
    const url = new URL(req.url)
    if (res.ok && (url.pathname === '/' || url.pathname === '/index.html')) {
      const copy = res.clone()
      const cache = await caches.open(CACHE)
      await cache.put('/', copy.clone())
      copy.text().then(prune).catch(() => {})
    }
    return res
  } catch {
    return (await caches.match('/')) || Response.error()
  }
}

async function cacheFirst(req) {
  const hit = await caches.match(req)
  if (hit) return hit
  const res = await fetch(req)
  if (res.ok || res.type === 'opaque') {
    const cache = await caches.open(CACHE)
    await cache.put(req, res.clone())
  }
  return res
}

async function staleWhileRevalidate(req, event) {
  const cache = await caches.open(CACHE)
  const hit = await cache.match(req)
  const fresh = fetch(req)
    .then((res) => {
      if (res.ok || res.type === 'opaque') return cache.put(req, res.clone()).then(() => res)
      return res
    })
    .catch(() => hit)
  if (hit) {
    event.waitUntil(fresh)
    return hit
  }
  return (await fresh) || Response.error()
}

self.addEventListener('fetch', (event) => {
  const req = event.request
  if (req.method !== 'GET') return
  const url = new URL(req.url)
  const sameOrigin = url.origin === self.location.origin
  if (!sameOrigin && url.hostname !== 'fonts.googleapis.com' && url.hostname !== 'fonts.gstatic.com') return

  if (req.mode === 'navigate') event.respondWith(page(req))
  else if ((sameOrigin && url.pathname.startsWith('/assets/')) || url.hostname === 'fonts.gstatic.com') event.respondWith(cacheFirst(req))
  else event.respondWith(staleWhileRevalidate(req, event))
})
