const SW_VERSION = '5'

self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (event) => { event.waitUntil(self.clients.claim()) })

self.addEventListener('fetch', (event) => {
  if (event.request.url.includes('/app.html')) {
    event.respondWith(fetch(event.request, { cache: 'no-store' }))
  }
})

self.addEventListener('push', (event) => {
  const data = event.data?.json() ?? {}
  event.waitUntil(
    self.registration.showNotification(data.title ?? 'WC2026', {
      body: data.body,
      icon: data.icon ?? '/2026-World-Cup-Social-Predicting-App/icon-180.png',
      badge: data.badge ?? '/2026-World-Cup-Social-Predicting-App/icon-180.png',
      data: { url: data.url ?? '/2026-World-Cup-Social-Predicting-App/app.html#/dashboard' }
    })
  )
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
      const url = event.notification.data?.url
      const existing = list.find(c => c.url.includes('app.html'))
      if (existing) { existing.focus(); existing.navigate(url) }
      else clients.openWindow(url)
    })
  )
})
