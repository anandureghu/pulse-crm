/// <reference lib="webworker" />
import { clientsClaim } from 'workbox-core'
import { cleanupOutdatedCaches, createHandlerBoundToURL, precacheAndRoute } from 'workbox-precaching'
import { NavigationRoute, registerRoute } from 'workbox-routing'

declare let self: ServiceWorkerGlobalScope

self.skipWaiting()
clientsClaim()

precacheAndRoute(self.__WB_MANIFEST)
cleanupOutdatedCaches()

registerRoute(
  new NavigationRoute(createHandlerBoundToURL('/index.html'), {
    denylist: [/^\/api\//],
  }),
)

self.addEventListener('push', (event) => {
  let title = 'pulsrm'
  let body = 'You have a new notification'
  try {
    const data = event.data?.json() as { title?: string; body?: string } | undefined
    if (data?.title) title = data.title
    if (data?.body) body = data.body
  } catch {
    const text = event.data?.text()
    if (text) body = text
  }

  event.waitUntil(
    (async () => {
      const channel = new BroadcastChannel('push-messages')
      channel.postMessage({ title, body })
      channel.close()

      const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
      const isVisible = clients.some((c) => c.visibilityState === 'visible')
      if (isVisible) return

      await self.registration.showNotification(title, {
        body,
        icon: '/pwa-192x192.png',
        badge: '/pwa-192x192.png',
        data: { url: '/' },
      })
    })(),
  )
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const url = (event.notification.data as { url?: string } | undefined)?.url ?? '/'
  event.waitUntil(
    (async () => {
      const allClients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
      for (const client of allClients) {
        if ('focus' in client) {
          await client.focus()
          if ('navigate' in client) await client.navigate(url)
          return
        }
      }
      await self.clients.openWindow(url)
    })(),
  )
})
