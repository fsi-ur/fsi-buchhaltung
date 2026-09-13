<template>
  <CommonPageTableCard
    :title="t('notifications.title')"
    :persist-key="tab === 'outbox' ? 'notifications-outbox' : undefined"
    :search-value="search"
    :search-placeholder="t('common.searchList')"
    :can-create="tab === 'outbox' && canSend"
    :create-label="`+ ${t('notifications.newNotification')}`"
    @update:search-value="search = $event"
    @create="create"
  >
    <template #actions>
      <PageAuditTableHistoryButton v-if="tab === 'outbox'" :tables="['notifications', 'notification_deliveries']" />
      <div v-if="canViewOutbox" class="flex gap-1 rounded-lg bg-base-100 p-1">
        <button
          v-for="entry in tabs"
          :key="entry.key"
          type="button"
          class="inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition cursor-pointer"
          :class="tab === entry.key ? 'bg-white text-base-900 shadow-sm' : 'text-base-500 hover:text-base-700'"
          @click="tab = entry.key"
        >
          <Icon :name="entry.icon" class="h-4 w-4" aria-hidden="true" />
          {{ entry.label }}
          <span
            v-if="entry.key === 'inbox' && unreadCount > 0"
            class="rounded-full bg-cyan-100 px-1.5 text-[11px] font-semibold text-cyan-800"
          >
            {{ unreadCount }}
          </span>
        </button>
      </div>
    </template>

    <PageNotificationsMailStatusNotice v-if="tab === 'outbox'" class="mb-3" />

    <div v-if="tab === 'inbox'" class="space-y-3">
      <div class="flex flex-wrap items-center justify-between gap-2">
        <div class="flex gap-1 rounded-lg bg-base-100 p-1">
          <button
            type="button"
            class="rounded-md px-3 py-1 text-xs font-medium transition cursor-pointer"
            :class="!unreadOnly ? 'bg-white text-base-900 shadow-sm' : 'text-base-500 hover:text-base-700'"
            @click="unreadOnly = false"
          >
            {{ t('notifications.filterAll') }}
          </button>
          <button
            type="button"
            class="rounded-md px-3 py-1 text-xs font-medium transition cursor-pointer"
            :class="unreadOnly ? 'bg-white text-base-900 shadow-sm' : 'text-base-500 hover:text-base-700'"
            @click="unreadOnly = true"
          >
            {{ t('notifications.filterUnread') }} ({{ unreadCount }})
          </button>
        </div>

        <button
          v-if="unreadCount > 0"
          type="button"
          class="inline-flex items-center gap-1.5 text-sm font-medium text-cyan-700 hover:underline cursor-pointer"
          @click="markAllRead"
        >
          <Icon name="material-symbols:mark-email-read-outline-rounded" class="h-4 w-4" aria-hidden="true" />
          {{ t('notifications.markAllRead') }}
        </button>
      </div>

      <div v-if="loading && !inboxItems.length" class="flex items-center justify-center p-10 text-base-400">
        <Icon name="material-symbols:progress-activity" class="animate-spin text-2xl" aria-hidden="true" />
      </div>

      <div v-else-if="!filteredInbox.length" class="flex flex-col items-center gap-2 py-12 text-center">
        <Icon name="material-symbols:notifications-off-outline-rounded" class="h-10 w-10 text-base-300" aria-hidden="true" />
        <p class="text-sm text-base-500">{{ t('notifications.empty') }}</p>
      </div>

      <ul v-else class="space-y-2">
        <li
          v-for="item in filteredInbox"
          :key="item.deliveryId"
          :data-delivery-id="item.deliveryId"
          class="group relative scroll-mt-4 overflow-hidden rounded-xl border border-l-4 transition"
          :class="item.readAt
            ? 'border-base-200 border-l-base-200 bg-white hover:border-base-300'
            : 'border-cyan-300 border-l-cyan-500 bg-cyan-100/70 hover:border-cyan-400 hover:border-l-cyan-600'"
        >
          <!--
            A notification is only interactive when it has somewhere to go. Messages without a deep
            link (custom messages above all) render as a plain <div>, so nothing suggests a click
            that would do nothing.
          -->
          <component
            :is="item.linkPage ? 'button' : 'div'"
            :type="item.linkPage ? 'button' : undefined"
            class="flex w-full items-start gap-3 p-3 text-left sm:p-4"
            :class="item.linkPage ? 'cursor-pointer' : ''"
            @click="item.linkPage ? openInboxItem(item) : undefined"
          >
            <span
              class="flex h-10 w-10 shrink-0 items-center justify-center rounded-full"
              :class="typeColorClass(item.typeKey)"
            >
              <Icon :name="typeIcon(item.typeKey)" class="h-5 w-5" aria-hidden="true" />
            </span>

            <span class="min-w-0 flex-1">
              <span class="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                <span
                  class="min-w-0 truncate text-sm text-base-900"
                  :class="item.readAt ? 'font-medium' : 'font-semibold'"
                >
                  {{ item.subject || typeLabel(item.typeKey) }}
                </span>
                <span class="shrink-0 text-xs text-base-400" :title="absoluteTime(receivedAt(item))">
                  {{ relativeTime(receivedAt(item)) }}
                </span>
              </span>

              <!-- Long messages stay readable but must not turn one entry into a wall of text:
                   clamped to six lines with an explicit expander, and wrapped so an unbroken string
                   cannot stretch the card. `line-clamp-*` sets `display: -webkit-box`, so it must
                   not be combined with a `block` utility — whichever came last in the stylesheet
                   would win, and `block` did. Always the inline-safe renderer here (bold/italic/line
                   breaks, no `p`/`ul`/`hr`) so expanding only lifts the height cap — it must not also
                   change how the text looks, or the toggle reads as a rendering glitch. -->
              <span
                class="mt-1 text-sm break-words text-base-600"
                :class="expanded.includes(item.deliveryId) ? 'block' : 'line-clamp-6'"
                v-html="renderNotificationInlineHtml(item.body)"
              ></span>

              <span v-if="item.attachments.length" class="mt-2 flex flex-wrap gap-1.5">
                <a
                  v-for="attachment in item.attachments"
                  :key="attachment.key"
                  :href="`/api/files/${attachment.fileId}`"
                  target="_blank"
                  rel="noopener"
                  class="inline-flex max-w-full items-center gap-1 rounded-md border border-base-200 bg-white px-2 py-0.5 text-[11px] font-medium text-base-700 hover:border-base-300 hover:text-link-600"
                  :title="attachment.fileName || attachment.title"
                  @click.stop
                >
                  <Icon
                    :name="attachment.kind === 'document' ? 'material-symbols:folder-open-rounded' : 'material-symbols:attach-file-rounded'"
                    class="h-3.5 w-3.5 shrink-0 text-base-400"
                    aria-hidden="true"
                  />
                  <span class="truncate">{{ attachment.title }}</span>
                </a>
              </span>

              <span class="mt-2 flex flex-wrap items-center gap-2">
                <span class="rounded-md bg-base-100 px-2 py-0.5 text-[11px] font-medium text-base-600">
                  {{ typeLabel(item.typeKey) }}
                </span>
                <span v-if="item.linkPage" class="inline-flex items-center gap-0.5 text-[11px] font-medium text-secondary-700">
                  {{ t('notifications.openLink') }}
                  <Icon name="material-symbols:chevron-right-rounded" class="h-4 w-4" aria-hidden="true" />
                </span>
              </span>
            </span>
          </component>

          <!-- Outside the entry above: for a linked notification that is a <button>, and a button
               inside a button is invalid markup that browsers silently unnest. -->
          <button
            v-if="isLongBody(item.body)"
            type="button"
            class="px-3 pb-3 text-[11px] font-medium text-base-500 hover:underline cursor-pointer sm:px-4 sm:pb-4"
            @click.stop="toggleExpanded(item.deliveryId)"
          >
            {{ expanded.includes(item.deliveryId) ? t('actions.showLess') : t('actions.showMore') }}
          </button>

          <button
            v-if="!item.readAt"
            type="button"
            class="absolute top-2 right-2 inline-flex h-7 w-7 items-center justify-center rounded-lg bg-white/90 text-base-400 transition hover:text-cyan-700 cursor-pointer sm:opacity-0 sm:group-hover:opacity-100 sm:focus:opacity-100"
            :title="t('notifications.markRead')"
            :aria-label="t('notifications.markRead')"
            @click.stop="markRead([item.deliveryId])"
          >
            <Icon name="material-symbols:check-rounded" class="h-4 w-4" aria-hidden="true" />
          </button>
        </li>
      </ul>
    </div>

    <CommonAdvancedTable
      v-else
      :loading="outboxLoading"
      v-model:search="search"
      persist-key="notifications-outbox"
      :rows="outboxRows"
      :columns="columns"
      :empty-text="t('notifications.empty')"
      table-class="min-w-[52rem]"
      @row-open="openOutboxItem($event.id)"
    >
      <template #cell-status="{ row }">
        <CommonStatusBadge :label="statusLabel(row.status)" :tone="statusTone(row.status)" />
      </template>

      <template #cell-counts="{ row }">
        <span class="inline-flex items-center gap-2">
          <span class="text-base-700">{{ row.counts.sent }} / {{ totalDeliveries(row) }}</span>
          <span v-if="row.counts.failed > 0" class="text-xs font-medium text-danger-600">
            {{ row.counts.failed }} {{ t('notifications.status.failed') }}
          </span>
        </span>
      </template>
    </CommonAdvancedTable>
  </CommonPageTableCard>

  <CommonModal v-model="detailOpen" :title="t('notifications.details')" width-class="max-w-2xl">
    <div v-if="detail" class="space-y-4">
      <div class="flex flex-wrap items-center gap-2">
        <CommonStatusBadge :label="statusLabel(detail.status)" :tone="statusTone(detail.status)" />
        <span class="rounded-md bg-base-100 px-2 py-0.5 text-xs font-medium text-base-600">
          {{ typeLabel(detail.typeKey) }}
        </span>
        <span class="inline-flex items-center gap-1 text-xs text-base-500">
          <Icon name="material-symbols:schedule-rounded" class="h-4 w-4" aria-hidden="true" />
          {{ scheduledTime(detail.scheduledFor) }}
        </span>
      </div>

      <div class="rounded-xl border border-base-200 p-3">
        <p class="text-sm font-semibold text-base-900">
          {{ detail.subject || typeLabel(detail.typeKey) }}
        </p>
        <div class="notification-body-html mt-1 text-sm text-base-600" v-html="renderNotificationBodyHtml(detail.body)"></div>

        <div v-if="detail.attachments.length" class="mt-2 flex flex-wrap gap-1.5 border-t border-base-100 pt-2">
          <span
            v-for="attachment in detail.attachments"
            :key="attachment.key"
            class="inline-flex items-center gap-1.5 rounded-md border border-base-200 bg-base-50 px-2 py-1 text-[11px] text-base-600"
            :title="attachment.fileName || attachment.title"
          >
            <Icon
              :name="attachment.kind === 'document' ? 'material-symbols:library-books-outline-rounded' : 'material-symbols:attach-file-rounded'"
              class="h-3.5 w-3.5 shrink-0"
              aria-hidden="true"
            />
            {{ attachment.title }}
          </span>
        </div>
      </div>

      <div class="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <div
          v-for="entry in detailCounts"
          :key="entry.key"
          class="rounded-lg border border-base-200 px-3 py-2 text-center"
        >
          <p class="text-lg font-semibold" :class="entry.class">{{ entry.value }}</p>
          <p class="text-[11px] text-base-500">{{ entry.label }}</p>
        </div>
      </div>

      <div class="max-h-64 overflow-auto rounded-xl border border-base-200">
        <table class="w-full text-xs">
          <thead class="sticky top-0 z-10 bg-base-50 text-left text-base-500">
            <tr>
              <th class="p-2 font-medium">{{ t('common.name') }}</th>
              <th class="p-2 font-medium">{{ t('notifications.compose.channels') }}</th>
              <th class="p-2 font-medium">{{ t('notifications.deliveryStatus') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="d in detail.deliveries" :key="d.id" class="border-t border-base-100 align-top">
              <td class="p-2">
                <p class="font-medium text-base-800">{{ d.recipientName }}</p>
                <p v-if="d.address" class="break-all text-[11px] text-base-400">{{ d.address }}</p>
              </td>
              <td class="p-2">
                <span class="inline-flex items-center gap-1 text-base-600">
                  <Icon :name="channelIcon(d.channel)" class="h-4 w-4" aria-hidden="true" />
                  {{ channelLabel(d.channel) }}
                </span>
              </td>
              <td class="p-2">
                <CommonStatusBadge :label="statusLabel(d.status)" :tone="statusTone(d.status)" />
                <p v-if="d.error" class="mt-1 text-[11px] text-danger-600">{{ d.error }}</p>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <template #footer>
      <!--
        Duplicating only makes sense for a hand-written message: an automatic notification's text is
        rendered from its template and its recipients follow from the shift/task it belongs to, so a
        copy would be an unrelated custom message that merely looks like the original.
      -->
      <button
        v-if="canDuplicate"
        type="button"
        class="btn-secondary inline-flex items-center gap-2"
        @click="duplicateDetail"
      >
        <Icon name="material-symbols:content-copy-outline-rounded" class="h-4 w-4" aria-hidden="true" />
        {{ t('notifications.duplicate') }}
      </button>
      <button
        v-if="detail?.status === 'scheduled' && canSend"
        type="button"
        class="btn-secondary inline-flex items-center gap-2 text-danger-600!"
        :title="t('notifications.cancelSendingHelp')"
        @click="cancelDetail"
      >
        <Icon name="material-symbols:cancel-schedule-send-rounded" class="h-4 w-4" aria-hidden="true" />
        {{ t('notifications.cancelSending') }}
      </button>
      <button type="button" class="btn-primary" @click="detailOpen = false">{{ t('actions.close') }}</button>
    </template>
  </CommonModal>
</template>

<script setup lang="ts">
import { useI18n } from '~/composables/useI18n'
import { useToast } from '~/composables/useToast'
import { useAuth } from '~/composables/useAuth'
import { useNotifications } from '~/composables/useNotifications'
import { useNotificationDisplay } from '~/composables/useNotificationDisplay'
import { usePage } from '~/composables/usePage'
import { buildReturnTarget } from '~/composables/useReturnTarget'
import { renderNotificationBodyHtml, renderNotificationInlineHtml } from '~/utils/notificationFormatting'
import type { PageTarget } from '~/types/page'
import type { CustomNotificationDraft, NotificationInboxItem, NotificationOutboxItem, NotificationOutboxDetail } from '~/types/notification'
import type { AdvancedTableColumn } from '~/composables/useAdvancedTable'
import type { GetNotificationOutboxResponse } from '~/server/api/notifications/index.get'
import type { GetNotificationDetailResponse } from '~/server/api/notifications/[id].get'
import type { CancelNotificationResponse } from '~/server/api/notifications/[id].delete'

const props = defineProps<{
  returnTarget: PageTarget
}>()

const { t } = useI18n()
const toast = useToast()
const { hasPermission } = useAuth()
const { setPage, pageMeta } = usePage()
const { items: inboxItems, unreadCount, loading, fetchInbox, markRead, markAllRead } = useNotifications()
const {
  typeIcon,
  typeColorClass,
  typeLabel,
  channelIcon,
  channelLabel,
  statusLabel,
  statusTone,
  relativeTime,
  absoluteTime,
  receivedAt,
  scheduledTime,
} = useNotificationDisplay()

const search = ref('')
// Coming back from the editor (or any other deep link) reopens the tab it was left on.
const tab = ref<'inbox' | 'outbox'>(pageMeta.value?.tab === 'outbox' ? 'outbox' : 'inbox')
const unreadOnly = ref(false)
const outboxRows = ref<NotificationOutboxItem[]>([])
const outboxLoading = ref(false)
const detailOpen = ref(false)
const detail = ref<NotificationOutboxDetail | null>(null)

const canViewOutbox = computed(() => hasPermission(['notifications.view']))
const canSend = computed(() => hasPermission(['notifications.send']))
const canDuplicate = computed(() => canSend.value && detail.value?.typeKey === 'custom.message')

const expanded = ref<number[]>([])

function openDelivery(deliveryId: number) {
  if (!deliveryId) return

  tab.value = 'inbox'
  search.value = ''
  unreadOnly.value = false
  if (!expanded.value.includes(deliveryId)) expanded.value = [...expanded.value, deliveryId]

  nextTick(() => {
    const entry = document.querySelector(`[data-delivery-id="${deliveryId}"]`)
    entry?.scrollIntoView({ block: 'start', behavior: 'smooth' })
  })
}

/** Roughly the six lines the card shows before clamping — long enough to justify an expander. */
function isLongBody(body: string) {
  return body.length > 240 || body.split('\n').length > 6
}

function toggleExpanded(deliveryId: number) {
  expanded.value = expanded.value.includes(deliveryId)
    ? expanded.value.filter(id => id !== deliveryId)
    : [...expanded.value, deliveryId]
}

const tabs = computed(() => [
  { key: 'inbox' as const, label: t('notifications.inbox'), icon: 'material-symbols:inbox-rounded' },
  { key: 'outbox' as const, label: t('notifications.outbox'), icon: 'material-symbols:outbox-rounded' },
])

const filteredInbox = computed(() => {
  const q = search.value.trim().toLowerCase()
  return inboxItems.value.filter((item) => {
    if (unreadOnly.value && item.readAt) return false
    if (!q) return true
    return item.subject.toLowerCase().includes(q)
      || item.body.toLowerCase().includes(q)
      || typeLabel(item.typeKey).toLowerCase().includes(q)
  })
})

const detailCounts = computed(() => {
  const counts = detail.value?.deliveries.reduce((acc, delivery) => {
    acc[delivery.status] = (acc[delivery.status] || 0) + 1
    return acc
  }, {} as Record<string, number>) || {}

  return [
    { key: 'sent', label: t('notifications.status.sent'), value: counts.sent || 0, class: 'text-success-600' },
    { key: 'pending', label: t('notifications.status.pending'), value: counts.pending || 0, class: 'text-warning-600' },
    { key: 'failed', label: t('notifications.status.failed'), value: counts.failed || 0, class: 'text-danger-600' },
    { key: 'skipped', label: t('notifications.status.skipped'), value: counts.skipped || 0, class: 'text-base-500' },
  ]
})

function totalDeliveries(row: NotificationOutboxItem) {
  return row.counts.sent + row.counts.failed + row.counts.pending + row.counts.skipped
}

const columns = computed<AdvancedTableColumn<NotificationOutboxItem>[]>(() => [
  {
    key: 'subject',
    label: t('notifications.compose.subject'),
    filterType: 'text',
    globalSearchable: true,
    getValue: row => row.subject || typeLabel(row.typeKey),
    mobile: 'title',
  },
  {
    key: 'typeKey',
    label: t('notifications.typeColumn'),
    filterType: 'text',
    globalSearchable: true,
    getValue: row => typeLabel(row.typeKey),
    mobileLabel: true,
  },
  {
    key: 'status',
    label: t('notifications.statusColumn'),
    filterType: 'text',
    globalSearchable: true,
    getValue: row => statusLabel(row.status),
    mobileLabel: true,
  },
  {
    key: 'scheduledFor',
    label: t('notifications.compose.timing'),
    filterType: 'date',
    globalSearchable: true,
    getValue: row => row.scheduledFor,
    format: row => scheduledTime(row.scheduledFor),
    mobileLabel: true,
  },
  {
    key: 'counts',
    label: t('notifications.recipientsColumn'),
    getValue: row => `${row.counts.sent}/${totalDeliveries(row)}`,
    mobileLabel: true,
  },
  {
    key: 'createdByUsername',
    label: t('notifications.createdBy'),
    filterType: 'text',
    globalSearchable: true,
    getValue: row => row.createdByUsername ?? '',
    format: row => row.createdByUsername || t('common.notAvailable'),
    mobileMinBreakpoint: 'lg',
  },
])

async function loadOutbox() {
  if (!canViewOutbox.value) return
  outboxLoading.value = true
  try {
    const res = await $fetch<GetNotificationOutboxResponse>('/api/notifications')
    if (res.ok) outboxRows.value = res.items
    else toast.error(res.error)
  } finally {
    outboxLoading.value = false
  }
}

function openInboxItem(item: NotificationInboxItem) {
  if (!item.readAt) markRead([item.deliveryId])
  if (item.linkPage) setPage(item.linkPage as any, item.linkMeta || undefined)
}

async function openOutboxItem(id: number) {
  const res = await $fetch<GetNotificationDetailResponse>(`/api/notifications/${id}`)
  if (res.ok) {
    detail.value = res.notification
    detailOpen.value = true
  } else {
    toast.error(res.error)
  }
}

async function cancelDetail() {
  if (!detail.value) return
  const res = await $fetch<CancelNotificationResponse>(`/api/notifications/${detail.value.id}`, { method: 'DELETE' })
  if (res.ok) {
    toast.success(t('actions.saved'))
    detailOpen.value = false
    await loadOutbox()
  } else {
    toast.error(res.error)
  }
}

/**
 * The editor is only ever opened from the outbox, so it must lead back there — returning to the
 * inbox would hide the notification that was just written.
 */
const editorReturnTarget = computed(() => buildReturnTarget(props.returnTarget.page, {
  ...(props.returnTarget.meta || {}),
  tab: 'outbox',
}))

/**
 * Reopens a custom message as a new draft: text, audience and channel selection are all restored,
 * so duplicating is a real starting point instead of an empty form with a familiar subject. The send
 * time is deliberately left at "now" — a copy of a past schedule is never what is wanted.
 */
function duplicateDetail() {
  if (!detail.value) return

  const rule = detail.value.recipientRule
  const rules: Array<Record<string, any>> = rule?.kind === 'composite' ? (rule.rules || []) : (rule ? [rule] : [])
  const collect = (kind: string, field: string) => rules
    .filter(entry => entry.kind === kind)
    .flatMap(entry => (entry[field] || []) as number[])

  const prefill: Partial<CustomNotificationDraft> = {
    subject: detail.value.subject,
    body: detail.value.body,
    memberIds: collect('members', 'memberIds'),
    subdivisionIds: collect('subdivisions', 'subdivisionIds'),
    userIds: collect('users', 'userIds'),
    allActiveMembers: rules.some(entry => entry.kind === 'allActiveMembers'),
    channels: detail.value.channels || undefined,
    attachments: {
      documentIds: detail.value.attachments.filter(entry => entry.documentId !== null).map(entry => entry.documentId!),
      fileIds: detail.value.attachments.filter(entry => entry.fileId !== null && entry.kind === 'file').map(entry => entry.fileId!),
    },
  }

  detailOpen.value = false
  setPage('NotificationCreate' as any, { returnTarget: editorReturnTarget.value, prefill })
}

function create() {
  setPage('NotificationCreate' as any, { returnTarget: editorReturnTarget.value })
}

// Each tab filters a different data set, so the shared search box starts empty on a switch.
watch(tab, (value) => {
  search.value = ''
  if (value === 'outbox') loadOutbox()
})

onMounted(async () => {
  await fetchInbox({ limit: 100 })
  if (tab.value === 'outbox') loadOutbox()
  openDelivery(Number(pageMeta.value?.deliveryId ?? 0))
})

watch(pageMeta, meta => openDelivery(Number(meta?.deliveryId ?? 0)))
</script>
