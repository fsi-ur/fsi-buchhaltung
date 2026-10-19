function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - base64String.length % 4) % 4)
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  const rawData = atob(base64)
  return Uint8Array.from([...rawData].map(char => char.charCodeAt(0)))
}

/**
 * `navigator.serviceWorker.ready` never settles when no service worker is registered (e.g. a build
 * without the PWA, or a plain-HTTP origin), which would leave the subscribe button spinning
 * forever — so every use of it is bounded.
 */
async function getRegistration(timeoutMs = 5000): Promise<ServiceWorkerRegistration | null> {
  return await Promise.race([
    navigator.serviceWorker.ready,
    new Promise<null>(resolve => setTimeout(() => resolve(null), timeoutMs)),
  ])
}

export function usePushSubscription() {
  const config = useRuntimeConfig()
  const supported = import.meta.client && 'serviceWorker' in navigator && 'PushManager' in window
  const vapidPublicKey = config.public.vapidPublicKey as string
  const configured = Boolean(vapidPublicKey)

  const subscribed = ref(false)
  const busy = ref(false)

  async function refreshStatus() {
    if (!supported) return
    try {
      const registration = await getRegistration()
      const subscription = await registration?.pushManager.getSubscription()
      subscribed.value = Boolean(subscription)
    } catch {
      subscribed.value = false
    }
  }

  async function subscribe(): Promise<{ ok: true } | { ok: false, error: string }> {
    if (!supported) return { ok: false, error: 'unsupported' }
    if (!configured) return { ok: false, error: 'not_configured' }
    if (busy.value) return { ok: false, error: 'busy' }

    busy.value = true
    try {
      const permission = await Notification.requestPermission()
      if (permission !== 'granted') return { ok: false, error: 'permission_denied' }

      const registration = await getRegistration()
      if (!registration) return { ok: false, error: 'no_service_worker' }

      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(vapidPublicKey) as BufferSource,
      })

      await apiFetch('/api/notifications/push-subscribe', { method: 'POST', body: subscription.toJSON() })
      subscribed.value = true
      return { ok: true }
    } catch {
      return { ok: false, error: 'subscribe_failed' }
    } finally {
      busy.value = false
    }
  }

  async function unsubscribe(): Promise<{ ok: true } | { ok: false, error: string }> {
    if (!supported || busy.value) return { ok: false, error: 'busy' }

    busy.value = true
    try {
      const registration = await getRegistration()
      const subscription = await registration?.pushManager.getSubscription()
      if (subscription) {
        await apiFetch('/api/notifications/push-unsubscribe', { method: 'POST', body: { endpoint: subscription.endpoint } })
        await subscription.unsubscribe()
      }
      subscribed.value = false
      return { ok: true }
    } catch {
      return { ok: false, error: 'unsubscribe_failed' }
    } finally {
      busy.value = false
    }
  }

  return { supported, configured, subscribed, busy, refreshStatus, subscribe, unsubscribe }
}
