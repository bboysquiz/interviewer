const STATIC_CACHE = 'programming-interviewer-static-v1'
const RUNTIME_CACHE = 'programming-interviewer-runtime-v1'
const APP_SHELL_FILES = ['/', '/index.html', '/manifest.webmanifest', '/favicon.svg']

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(STATIC_CACHE)
      .then((cache) => cache.addAll(APP_SHELL_FILES))
      .then(() => self.skipWaiting()),
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter(
              (key) => key !== STATIC_CACHE && key !== RUNTIME_CACHE,
            )
            .map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  )
})

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') {
    return
  }

  const requestUrl = new URL(event.request.url)

  if (requestUrl.origin !== self.location.origin) {
    return
  }

  if (
    requestUrl.pathname.startsWith('/api/') ||
    requestUrl.pathname.startsWith('/uploads/')
  ) {
    return
  }

  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          const responseClone = response.clone()
          void caches
            .open(RUNTIME_CACHE)
            .then((cache) => cache.put('/index.html', responseClone))

          return response
        })
        .catch(async () => {
          const cachedResponse = await caches.match('/index.html')
          return cachedResponse ?? caches.match('/')
        }),
    )

    return
  }

  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      if (cachedResponse) {
        return cachedResponse
      }

      return fetch(event.request).then((response) => {
        if (!response.ok) {
          return response
        }

        const responseClone = response.clone()

        void caches
          .open(RUNTIME_CACHE)
          .then((cache) => cache.put(event.request, responseClone))

        return response
      })
    }),
  )
})
