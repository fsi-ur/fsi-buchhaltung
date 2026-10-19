import type { NotificationInboxItem } from '~/types/notification'
import type { GetNotificationInboxResponse } from '~/server/api/notifications/inbox.get'
import type { MarkNotificationsReadResponse } from '~/server/api/notifications/read.post'

const items = ref<NotificationInboxItem[]>([])
const unreadCount = ref(0)
const loading = ref(false)
let pollHandle: ReturnType<typeof setInterval> | null = null

/**
 * An instant notification (shift assigned/removed, event changed) is dispatched a couple of seconds
 * after the action, so the poll interval is what the recipient actually waits for — it only costs a
 * tiny COUNT query per open tab, and ticks are skipped while the tab is hidden.
 */
const POLL_INTERVAL_MS = 15000

/** `limit` lets the full notification centre pull a deeper history than the bell's preview. */
async function fetchInbox(options?: { limit?: number }) {
  loading.value = true
  try {
    const res = await apiFetch<GetNotificationInboxResponse>('/api/notifications/inbox', {
      query: options?.limit ? { limit: options.limit } : undefined,
    })
    if (res.ok) {
      items.value = res.items
      unreadCount.value = res.unreadCount
    }
  } finally {
    loading.value = false
  }
}

async function fetchUnreadCount() {
  const res = await apiFetch<GetNotificationInboxResponse>('/api/notifications/inbox', { query: { limit: 1, unreadOnly: 'true' } })
  if (!res.ok) return

  const grew = res.unreadCount > unreadCount.value
  unreadCount.value = res.unreadCount

  // Pull the messages themselves whenever something new arrived, so the bell shows the actual
  // notification the moment it is opened instead of loading it on click.
  if (grew || (res.unreadCount > 0 && !items.value.length)) await fetchInbox()
}

async function markRead(ids: number[]) {
  if (!ids.length) return
  const res = await apiFetch<MarkNotificationsReadResponse>('/api/notifications/read', { method: 'POST', body: { ids } })
  if (res.ok) {
    for (const item of items.value) {
      if (ids.includes(item.deliveryId) && !item.readAt) {
        item.readAt = new Date().toISOString()
        unreadCount.value = Math.max(0, unreadCount.value - 1)
      }
    }
  }
}

async function markAllRead() {
  const res = await apiFetch<MarkNotificationsReadResponse>('/api/notifications/read', { method: 'POST', body: { all: true } })
  if (res.ok) {
    for (const item of items.value) item.readAt = item.readAt || new Date().toISOString()
    unreadCount.value = 0
  }
}

// Module scope so add/removeEventListener always see the same function reference.
function catchUpWhenVisible() {
  if (document.hidden) return
  fetchUnreadCount().catch(() => {})
}

function startPolling() {
  if (pollHandle || !import.meta.client) return
  pollHandle = setInterval(() => {
    if (document.hidden) return
    fetchUnreadCount().catch(() => {})
  }, POLL_INTERVAL_MS)

  // Ticks are skipped while the tab is in the background, so catch up the moment it is looked at
  // again — otherwise returning to the app shows a stale bell until the next tick.
  document.addEventListener('visibilitychange', catchUpWhenVisible)
  window.addEventListener('focus', catchUpWhenVisible)
}

function stopPolling() {
  if (pollHandle) {
    clearInterval(pollHandle)
    pollHandle = null
  }
  if (import.meta.client) {
    document.removeEventListener('visibilitychange', catchUpWhenVisible)
    window.removeEventListener('focus', catchUpWhenVisible)
  }
  items.value = []
  unreadCount.value = 0
}

export function useNotifications() {
  return { items, unreadCount, loading, fetchInbox, fetchUnreadCount, markRead, markAllRead, startPolling, stopPolling }
}
