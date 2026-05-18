const SW_VERSION = '7'
const ICON = 'https://itayavioz.github.io/2026-World-Cup-Social-Predicting-App/icon-notif.png'

self.addEventListener('install', (event) => {
  self.skipWaiting()
  event.waitUntil(caches.open('wc2026-static').then(c => c.add(ICON)))
})
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
      icon: data.icon ?? ICON,
      badge: data.badge ?? ICON,
      data: { url: data.url ?? 'https://itayavioz.github.io/2026-World-Cup-Social-Predicting-App/app.html#/dashboard' }
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
