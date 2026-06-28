const SW_VERSION = '53'
const ICON = '/icon-notif.png'

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

self.addEventListener('message', (event) => {
  if (event.data?.type === 'GET_VERSION') {
    event.source.postMessage({ type: 'SW_VERSION', version: SW_VERSION })
  }
})

self.addEventListener('push', (event) => {
  event.waitUntil((async () => {
    let data = {}
    try { data = event.data ? event.data.json() : {} }
    catch { try { data = { title: event.data.text() } } catch { data = {} } }
    await self.registration.showNotification(data.title ?? 'WC2026', {
      body: data.body ?? '',
      icon: data.icon ?? ICON,
      badge: data.badge ?? ICON,
      data: { url: data.url ?? '/app.html#/dashboard' }
    })
  })())
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
