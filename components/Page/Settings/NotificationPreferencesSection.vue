<template>
  <CommonCard
    :id="NOTIFICATION_PREFERENCES_SECTION"
    class="transition-colors"
    :tone="highlighted ? 'success' : 'default'"
    :title="t('settings.notifications.preferencesTitle')"
    :description="t('settings.notifications.preferencesHelp')"
  >
    <template #actions>
      <button type="button" class="btn-secondary inline-flex items-center gap-2" @click="openNotificationCentre">
        <Icon name="material-symbols:notifications-rounded" class="h-4 w-4" aria-hidden="true" />
        {{ t('notifications.title') }}
      </button>
      <button type="button" class="btn-primary inline-flex items-center gap-2" @click="openMatrix">
        <Icon name="material-symbols:tune-rounded" class="h-4 w-4" aria-hidden="true" />
        {{ t('settings.notifications.preferencesOpen') }}
      </button>
    </template>

    <div v-if="push.configured" class="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-base-100 bg-base-50 p-3">
      <div class="flex min-w-0 items-start gap-3">
        <span class="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white text-base-600">
          <Icon name="material-symbols:phonelink-ring-rounded" class="h-5 w-5" aria-hidden="true" />
        </span>
        <div class="min-w-0">
          <p class="text-sm font-medium text-base-700">{{ t('settings.notifications.pushPreferenceTitle') }}</p>
          <p class="text-xs text-base-500">{{ t('settings.notifications.pushPreferenceHelp') }}</p>
          <p v-if="push.subscribed.value" class="mt-1 inline-flex items-center gap-1 text-xs text-success-700">
            <Icon name="material-symbols:check-circle-rounded" class="h-4 w-4" aria-hidden="true" />
            {{ t('settings.notifications.pushEnabled') }}
          </p>
        </div>
      </div>

      <button
        v-if="push.supported"
        type="button"
        class="btn-secondary shrink-0"
        :disabled="push.busy.value"
        :class="{ 'opacity-50 cursor-not-allowed': push.busy.value }"
        @click="togglePush"
      >
        {{ push.subscribed.value ? t('settings.notifications.pushDisable') : t('settings.notifications.pushEnable') }}
      </button>
      <span v-else class="min-w-0 text-xs text-warning-600 sm:text-right">{{ t('settings.notifications.pushUnsupported') }}</span>
    </div>

    <CommonModal
      v-model="matrixOpen"
      :title="t('settings.notifications.preferencesTitle')"
      width-class="max-w-3xl"
    >
      <div v-if="loading" class="flex items-center justify-center p-10 text-base-400">
        <Icon name="material-symbols:progress-activity" class="animate-spin text-2xl" aria-hidden="true" />
      </div>

      <div v-else-if="!categories.length" class="flex flex-col items-center gap-2 py-10 text-center">
        <Icon name="material-symbols:notifications-off-outline-rounded" class="h-8 w-8 text-base-300" aria-hidden="true" />
        <p class="text-sm text-base-500">{{ t('settings.notifications.preferencesNone') }}</p>
      </div>

      <div v-else class="space-y-4">
        <div class="rounded-lg bg-base-50 p-3 text-xs text-base-600 space-y-1">
          <p>{{ t('settings.notifications.preferencesModalHelp') }}</p>
          <p class="inline-flex items-start gap-1 text-base-500">
            <Icon name="material-symbols:info-outline-rounded" class="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            {{ t('settings.notifications.preferencesInAppHint') }}
          </p>
        </div>

        <div v-for="category in categories" :key="category.key" class="rounded-lg border border-base-100">
          <h4 class="border-b border-base-100 px-3 py-2 text-sm font-semibold text-base-700">
            {{ t(category.labelKey) }}
          </h4>

          <div
            v-for="typeKey in category.types"
            :key="typeKey"
            class="flex flex-wrap items-start justify-between gap-x-6 gap-y-3 border-b border-base-50 p-3 last:border-b-0"
          >
            <div class="min-w-45 flex-1">
              <div class="flex items-center gap-2">
                <Icon :name="typeIcon(typeKey)" class="h-4 w-4 shrink-0 text-base-400" aria-hidden="true" />
                <p class="text-sm font-medium text-base-700">{{ typeLabel(typeKey) }}</p>
              </div>
              <p class="mt-0.5 text-xs text-base-500">{{ typeDescription(typeKey) }}</p>
              <button
                v-if="isOverridden(typeKey)"
                type="button"
                class="mt-1 text-xs font-medium text-secondary-700 hover:underline cursor-pointer"
                @click="resetToDefault(typeKey)"
              >
                {{ t('settings.notifications.resetToDefault') }}
              </button>
              <p v-else class="mt-1 text-xs text-base-400">{{ t('settings.notifications.preferenceDefault') }}</p>
            </div>

            <div class="flex shrink-0 gap-4">
              <div v-for="channel in channels" :key="channel" class="flex w-16 flex-col items-center gap-1">
                <span class="text-[11px] font-medium text-base-500">{{ channelLabel(channel) }}</span>
                <template v-if="hasEntry(typeKey, channel)">
                  <CommonToggleSwitch
                    :model-value="effective(typeKey, channel)"
                    :disabled="isBlocked(typeKey, channel)"
                    :label="`${typeLabel(typeKey)} – ${channelLabel(channel)}`"
                    @update:model-value="toggle(typeKey, channel, $event)"
                  />
                  <span v-if="isBlocked(typeKey, channel)" class="text-center text-[10px] text-warning-600">
                    {{ t('settings.notifications.preferenceBlocked') }}
                  </span>
                </template>
                <span v-else class="text-base-300">—</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      <template #footer>
        <button type="button" class="btn-primary" @click="matrixOpen = false">{{ t('actions.close') }}</button>
      </template>
    </CommonModal>
  </CommonCard>
</template>

<script setup lang="ts">
import { useI18n } from '~/composables/useI18n'
import { useToast } from '~/composables/useToast'
import { usePage } from '~/composables/usePage'
import { usePushSubscription } from '~/composables/usePushSubscription'
import { useNotificationDisplay, NOTIFICATION_PREFERENCES_SECTION } from '~/composables/useNotificationDisplay'
import { NOTIFICATION_TYPES } from '~/config/notificationTypes'
import type { NotificationTypeKey } from '~/config/notificationTypes'
import type { NotificationChannelKey } from '~/config/notificationChannels'
import type { NotificationPreferenceEntry } from '~/types/notification'
import type { GetNotificationPreferencesResponse } from '~/server/api/notifications/preferences.get'
import type { SaveNotificationPreferencesResponse } from '~/server/api/notifications/preferences.put'

const { t } = useI18n()
const toast = useToast()
const { setPage, pageMeta } = usePage()
const push = usePushSubscription()
const { typeIcon, typeLabel, typeDescription, channelLabel } = useNotificationDisplay()

const loading = ref(true)
const entries = ref<NotificationPreferenceEntry[]>([])
const highlighted = ref(false)
const matrixOpen = ref(false)

let highlightTimeout: ReturnType<typeof setTimeout> | null = null
let handledSectionKey: unknown = null

/**
 * Deep link from the notification bell: scroll here, flash the border and open the matrix. Each
 * `sectionKey` is honoured exactly once — the bell sends a fresh one per click, so remounting this
 * section (switching settings tabs back and forth) must not replay the highlight.
 */
function revealSection() {
  if (pageMeta.value?.section !== NOTIFICATION_PREFERENCES_SECTION) return

  const key = pageMeta.value?.sectionKey ?? null
  if (key === handledSectionKey) return
  handledSectionKey = key

  nextTick(() => {
    document.getElementById(NOTIFICATION_PREFERENCES_SECTION)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    openMatrix()
    highlighted.value = true
    if (highlightTimeout) clearTimeout(highlightTimeout)
    highlightTimeout = setTimeout(() => { highlighted.value = false }, 2000)
  })
}

const channels = computed<NotificationChannelKey[]>(() => push.configured ? ['email', 'push'] : ['email'])

/**
 * Only automatic types appear — one row per type, grouped by category. Types the association
 * switched off entirely are not in `entries` at all, so an emptied category disappears with them.
 */
const categories = computed(() => {
  const available = new Set(entries.value.map(entry => entry.typeKey))
  const grouped = new Map<string, { key: string, labelKey: string, types: NotificationTypeKey[] }>()

  for (const type of NOTIFICATION_TYPES) {
    if (!type.userConfigurable || !available.has(type.key)) continue
    if (!grouped.has(type.categoryKey)) grouped.set(type.categoryKey, { key: type.categoryKey, labelKey: type.categoryKey, types: [] })
    grouped.get(type.categoryKey)!.types.push(type.key)
  }

  return Array.from(grouped.values())
})

function openNotificationCentre() {
  setPage('NotificationList' as any)
}

function openMatrix() {
  matrixOpen.value = true
  load()
}

async function togglePush() {
  const result = push.subscribed.value ? await push.unsubscribe() : await push.subscribe()
  if (!result.ok && result.error !== 'busy') {
    const key = result.error === 'permission_denied' ? 'pushPermissionDenied' : 'pushSubscribeFailed'
    toast.error(t(`settings.notifications.${key}`))
  }
}

function findEntry(typeKey: NotificationTypeKey, channel: NotificationChannelKey) {
  return entries.value.find(entry => entry.typeKey === typeKey && entry.channel === channel)
}

function hasEntry(typeKey: NotificationTypeKey, channel: NotificationChannelKey) {
  return Boolean(findEntry(typeKey, channel))
}

function effective(typeKey: NotificationTypeKey, channel: NotificationChannelKey) {
  return findEntry(typeKey, channel)?.effective ?? false
}

/** Switched off association-wide — the personal switch cannot turn it back on. */
function isBlocked(typeKey: NotificationTypeKey, channel: NotificationChannelKey) {
  return Boolean(findEntry(typeKey, channel)?.blocked)
}

/** True once any channel of this type deviates from the global default. */
function isOverridden(typeKey: NotificationTypeKey) {
  return entries.value.some(entry => entry.typeKey === typeKey && entry.isOverride)
}

async function load() {
  loading.value = true
  try {
    const res = await $fetch<GetNotificationPreferencesResponse>('/api/notifications/preferences')
    if (res.ok) entries.value = res.entries
    else toast.error(res.error)
  } finally {
    loading.value = false
  }
}

async function toggle(typeKey: NotificationTypeKey, channel: NotificationChannelKey, enabled: boolean) {
  const entry = findEntry(typeKey, channel)
  if (entry?.blocked) return
  if (entry) entry.effective = enabled

  try {
    const res = await $fetch<SaveNotificationPreferencesResponse>('/api/notifications/preferences', {
      method: 'PUT',
      body: { entries: [{ typeKey, channel, enabled }] },
    })
    if (res.ok) {
      if (entry) entry.isOverride = true
    } else {
      toast.error(res.error)
      await load()
    }
  } catch {
    toast.error(t('settings.notifications.saveFailed'))
    await load()
  }
}

/** `enabled: null` clears the per-user override so the global default applies again. */
async function resetToDefault(typeKey: NotificationTypeKey) {
  const affected = entries.value.filter(entry => entry.typeKey === typeKey && entry.isOverride)
  if (!affected.length) return

  try {
    const res = await $fetch<SaveNotificationPreferencesResponse>('/api/notifications/preferences', {
      method: 'PUT',
      body: { entries: affected.map(entry => ({ typeKey: entry.typeKey, channel: entry.channel, enabled: null })) },
    })
    if (!res.ok) toast.error(res.error)
  } catch {
    toast.error(t('settings.notifications.saveFailed'))
  } finally {
    await load()
  }
}

// Fires both when the section mounts through a tab switch and when the bell is used while the
// general settings tab is already open.
watch(() => [pageMeta.value?.section, pageMeta.value?.sectionKey], revealSection)

onMounted(() => {
  load()
  push.refreshStatus()
  revealSection()
})

useAppRefresh().onRefresh(load)

onBeforeUnmount(() => {
  if (highlightTimeout) clearTimeout(highlightTimeout)
})
</script>
