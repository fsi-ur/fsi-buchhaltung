<template>
  <CommonCard
    :title="t('home.widgets.calendarFeed.title')"
    :description="t('home.widgets.calendarFeed.description')"
  >

    <div v-if="loading" class="flex items-center justify-center p-6 text-base-400">
      <Icon name="material-symbols:progress-activity" class="animate-spin text-2xl" />
    </div>

    <template v-else>
      <div v-if="!url && !hasToken">
        <button
          type="button"
          class="btn-primary w-full justify-center sm:w-auto"
          :disabled="generating"
          @click="generate"
        >
          {{ t('home.widgets.calendarFeed.generate') }}
        </button>
      </div>

      <div v-else-if="!url" class="space-y-3">
        <p class="text-xs text-base-400">
          {{ t('home.widgets.calendarFeed.alreadyExists') }}
        </p>
        <button
          type="button"
          class="btn-secondary w-full justify-center sm:w-auto"
          :disabled="generating"
          @click="confirmingRegenerate = true"
        >
          {{ t('home.widgets.calendarFeed.regenerate') }}
        </button>
      </div>

      <div v-else class="space-y-3">
        <div class="flex items-center gap-2">
          <input
            type="text"
            readonly
            :value="url"
            class="input flex-1 truncate text-xs"
            @focus="($event.target as HTMLInputElement)?.select()"
          >
          <button
            type="button"
            class="btn-secondary shrink-0 px-3!"
            :title="t('home.widgets.calendarFeed.copy')"
            @click="copyUrl"
          >
            <Icon name="material-symbols:content-copy-outline-rounded" class="text-base" />
          </button>
        </div>

        <p class="text-xs text-base-400">
          {{ t('home.widgets.calendarFeed.helpText') }}
        </p>

        <button
          type="button"
          class="btn-secondary w-full justify-center sm:w-auto"
          :disabled="generating"
          @click="confirmingRegenerate = true"
        >
          {{ t('home.widgets.calendarFeed.regenerate') }}
        </button>
      </div>
    </template>
  </CommonCard>

  <CommonModal
    v-model="confirmingRegenerate"
    :title="t('home.widgets.calendarFeed.regenerateConfirmTitle')"
    footer-class="relative z-10 mt-4 flex justify-end gap-3 bg-white pt-2"
  >
    <p class="text-sm text-base-600">
      {{ t('home.widgets.calendarFeed.regenerateConfirmText') }}
    </p>

    <template #footer>
      <button class="btn-secondary" @click="confirmingRegenerate = false">
        {{ t('actions.cancel') }}
      </button>
      <button
        class="btn-primary"
        :disabled="generating"
        :class="{ 'opacity-50 cursor-not-allowed': generating }"
        @click="regenerate"
      >
        {{ t('home.widgets.calendarFeed.regenerate') }}
      </button>
    </template>
  </CommonModal>
</template>

<script setup lang="ts">
import { useI18n } from '~/composables/useI18n'
import { useToast } from '~/composables/useToast'
import type { GetCalendarFeedResponse } from '~/server/api/user/calendar-feed.get'
import type { PostCalendarFeedResponse } from '~/server/api/user/calendar-feed.post'

const { t } = useI18n()
const toast = useToast()

const loading = ref(true)
const generating = ref(false)
const hasToken = ref(false)
const url = ref('')
const confirmingRegenerate = ref(false)

async function load() {
  loading.value = true
  try {
    const res = await $fetch<GetCalendarFeedResponse>('/api/user/calendar-feed')
    if (res.ok) hasToken.value = res.hasToken
  } finally {
    loading.value = false
  }
}

async function generate() {
  generating.value = true
  try {
    const res = await $fetch<PostCalendarFeedResponse>('/api/user/calendar-feed', { method: 'POST' })
    if (res.ok) {
      url.value = res.url
      hasToken.value = true
    } else {
      toast.error(t('home.widgets.calendarFeed.generateError'))
    }
  } catch {
    toast.error(t('home.widgets.calendarFeed.generateError'))
  } finally {
    generating.value = false
  }
}

async function regenerate() {
  confirmingRegenerate.value = false
  await generate()
}

// iOS Safari's Clipboard API needs a secure context and still fails silently
// in some PWA/standalone cases, so fall back to the classic execCommand trick.
function copyWithExecCommand(text: string): boolean {
  const textarea = document.createElement('textarea')
  textarea.value = text
  textarea.style.position = 'fixed'
  textarea.style.top = '0'
  textarea.style.left = '-9999px'
  textarea.setAttribute('readonly', '')
  document.body.appendChild(textarea)

  const previousActiveElement = document.activeElement as HTMLElement | null
  textarea.focus()
  textarea.select()
  textarea.setSelectionRange(0, textarea.value.length)

  let copied = false
  try {
    copied = document.execCommand('copy')
  } catch {
    copied = false
  } finally {
    document.body.removeChild(textarea)
    previousActiveElement?.focus()
  }

  return copied
}

async function copyUrl() {
  if (!url.value) return

  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(url.value)
      toast.success(t('home.widgets.calendarFeed.copied'))
      return
    }
  } catch {
    // fall through to the execCommand fallback below
  }

  if (copyWithExecCommand(url.value)) {
    toast.success(t('home.widgets.calendarFeed.copied'))
  } else {
    toast.error(t('home.widgets.calendarFeed.copyError'))
  }
}

onMounted(load)
useAppRefresh().onRefresh(load)
</script>
