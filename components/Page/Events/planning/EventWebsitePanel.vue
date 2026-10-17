<template>
  <div class="space-y-6">
    <section class="space-y-4 -mx-6 bg-white p-4 shadow-sm sm:mx-0 sm:rounded-xl sm:shadow-lg">
      <div class="flex flex-wrap items-center justify-between gap-3">
        <div class="flex items-center gap-2">
          <span class="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-accent-50 text-accent-600">
            <Icon name="material-symbols:public" class="text-base" />
          </span>
          <h2 class="text-lg font-semibold">{{ t('event.website.title') }}</h2>
        </div>
        <span
          v-if="!loading"
          class="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold"
          :class="statusMeta.class"
        >
          <span class="h-1.5 w-1.5 shrink-0 rounded-full" :class="statusMeta.dot" />
          {{ statusMeta.label }}
        </span>
      </div>

      <p class="text-sm text-base-500">{{ t('event.website.intro') }}</p>

      <div v-if="loading" class="flex items-center justify-center p-6 text-base-400">
        <Icon name="material-symbols:progress-activity" class="animate-spin text-2xl" />
      </div>

      <template v-else>
        <div v-if="!canPublish" class="rounded-lg border border-base-200 bg-base-50 px-3 py-2 text-sm text-base-600">
          {{ t('event.website.readOnly') }}
        </div>

        <label class="flex items-start gap-3 rounded-lg border border-base-200 p-3" :class="canPublish ? 'cursor-pointer' : ''">
          <input v-model="form.published" type="checkbox" class="checkbox mt-0.5" :disabled="!canPublish">
          <span>
            <span class="block text-sm font-medium text-base-800">{{ t('event.website.published') }}</span>
            <span class="block text-xs text-base-500">{{ t('event.website.publishedHint') }}</span>
          </span>
        </label>

        <div class="grid gap-4 md:grid-cols-2">
          <div>
            <label class="text-sm font-medium text-base-600">{{ t('event.website.publicTitle') }}</label>
            <input
              :value="form.title ?? ''"
              class="input"
              :maxlength="TITLE_MAX"
              :placeholder="eventName"
              :disabled="!canPublish"
              @input="form.title = ($event.target as HTMLInputElement).value || null"
            >
            <p class="mt-1 text-xs text-base-400">{{ t('event.website.publicTitleHint') }}</p>
          </div>

          <div>
            <label class="text-sm font-medium text-base-600">{{ t('event.website.visibleFrom') }}</label>
            <CommonDateInput v-model="form.visible_from" mode="datetime" :disabled="!canPublish" />
            <p class="mt-1 text-xs text-base-400">{{ t('event.website.visibleFromHint') }}</p>
          </div>
        </div>

        <div>
          <div class="flex flex-wrap items-end justify-between gap-2">
            <label class="text-sm font-medium text-base-600">{{ t('event.website.publicDescription') }}</label>
            <div class="inline-flex rounded-lg bg-base-100 p-0.5 text-xs font-medium">
              <button
                type="button"
                class="cursor-pointer rounded-md px-2.5 py-1 transition"
                :class="!showPreview ? 'bg-white text-base-800 shadow-sm' : 'text-base-500 hover:text-base-700'"
                @click="showPreview = false"
              >
                {{ t('actions.edit') }}
              </button>
              <button
                type="button"
                class="cursor-pointer rounded-md px-2.5 py-1 transition"
                :class="showPreview ? 'bg-white text-base-800 shadow-sm' : 'text-base-500 hover:text-base-700'"
                @click="openPreview"
              >
                {{ t('event.website.preview') }}
              </button>
            </div>
          </div>

          <textarea
            v-if="!showPreview"
            :value="form.description ?? ''"
            rows="10"
            class="input mt-1 font-mono text-sm"
            :maxlength="DESCRIPTION_MAX"
            :disabled="!canPublish"
            @input="form.description = ($event.target as HTMLTextAreaElement).value || null"
          />
          <div v-else class="mt-1 min-h-40 rounded-lg border border-base-200 p-3">
            <h3 class="mb-2 text-lg font-semibold text-base-800">{{ form.title?.trim() || eventName }}</h3>
            <!-- markdown-it with html disabled escapes raw HTML and refuses javascript: links. -->
            <div v-if="previewHtml" class="website-preview text-sm text-base-700" v-html="previewHtml" />
            <p v-else class="text-sm text-base-400">{{ t('event.website.previewEmpty') }}</p>
          </div>

          <div class="mt-1 flex flex-wrap justify-between gap-2 text-xs text-base-400">
            <span>{{ t('event.website.publicDescriptionHint') }}</span>
            <span class="shrink-0">{{ t('event.website.charactersLeft', { count: DESCRIPTION_MAX - (form.description?.length ?? 0) }) }}</span>
          </div>
        </div>

        <div class="flex items-start gap-2 rounded-lg bg-base-50 px-3 py-2 text-xs text-base-500">
          <Icon name="material-symbols:info-outline-rounded" class="mt-0.5 shrink-0 text-sm" />
          <span>{{ t('event.website.sharedFields') }}</span>
        </div>
      </template>
    </section>

    <div v-if="canPublish && !loading" class="grid grid-cols-2 gap-4">
      <button type="button" class="btn-secondary" :disabled="!isDirty || saving" :class="{ 'cursor-not-allowed opacity-50': !isDirty || saving }" @click="reset">
        {{ t('actions.cancel') }}
      </button>
      <button type="button" class="btn-primary" :disabled="!isDirty || saving" :class="{ 'cursor-not-allowed opacity-50': !isDirty || saving }" @click="save">
        {{ t('actions.save') }}
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { useAuth } from '~/composables/useAuth'
import { useI18n } from '~/composables/useI18n'
import { useLocaleFormatters } from '~/composables/useLocaleFormatters'
import { useToast } from '~/composables/useToast'
import type { GetEventWebsiteResponse } from '~/server/api/events/[id]/website.get'
import type { UpdateEventWebsiteResponse } from '~/server/api/events/[id]/website.put'
import { normalizeLocalDateTime } from '~/shared/time'
import type { EventWebsiteSettings } from '~/types/event'

const TITLE_MAX = 255
const DESCRIPTION_MAX = 20000

const props = defineProps<{
  eventId: number
  eventName: string
  /** Saved end of the event (wall clock), to tell "live" from "over". */
  endsAt: string
}>()

const { t } = useI18n()
const { resolveFlag } = useAuth()
const { formatDateTime } = useLocaleFormatters()
const { nowLocal } = useAppTimeZone()
const toast = useToast()

const emptySettings = (): EventWebsiteSettings => ({ published: false, visible_from: null, title: null, description: null })

const loading = ref(true)
const saving = ref(false)
const canPublish = ref(false)
const form = ref<EventWebsiteSettings>(emptySettings())
const saved = ref<EventWebsiteSettings>(emptySettings())
const showPreview = ref(false)
const previewHtml = ref('')

function normalized(value: EventWebsiteSettings): EventWebsiteSettings {
  return {
    published: value.published,
    visible_from: value.visible_from ? normalizeLocalDateTime(value.visible_from) ?? value.visible_from : null,
    title: value.title?.trim() || null,
    description: value.description?.trim() || null,
  }
}

const isDirty = computed(() => JSON.stringify(normalized(form.value)) !== JSON.stringify(normalized(saved.value)))

/** What the website currently sees — based on the saved state, not unsaved edits. */
const statusMeta = computed(() => {
  const now = nowLocal()
  const state = normalized(saved.value)
  const endsAt = normalizeLocalDateTime(props.endsAt)
  if (!state.published) {
    return { label: t('event.website.statusHidden'), class: 'bg-base-100 text-base-500', dot: 'bg-base-400' }
  }
  if (endsAt && endsAt < now) {
    return { label: t('event.website.statusEnded'), class: 'bg-base-100 text-base-600', dot: 'bg-base-400' }
  }
  if (state.visible_from && state.visible_from > now) {
    return { label: t('event.website.statusScheduled', { date: formatDateTime(state.visible_from) }), class: 'bg-warning-100 text-warning-700', dot: 'bg-warning-500' }
  }
  return { label: t('event.website.statusLive'), class: 'bg-success-100 text-success-700', dot: 'bg-success-500' }
})

async function load() {
  loading.value = true
  try {
    const res = await $fetch<GetEventWebsiteResponse>(`/api/events/${props.eventId}/website`)
    if (!res.ok) {
      toast.error(t('event.website.loadFailed'))
      return
    }
    canPublish.value = resolveFlag(res.canPublish, 'events.publish')
    saved.value = { ...res.website }
    form.value = { ...res.website }
  } catch {
    toast.error(t('event.website.loadFailed'))
  } finally {
    loading.value = false
  }
}

function reset() {
  form.value = { ...saved.value }
}

async function save() {
  if (saving.value || !canPublish.value) return

  const body = normalized(form.value)
  if (body.title && body.title.length > TITLE_MAX) {
    toast.error(t('event.website.titleTooLong', { max: TITLE_MAX }))
    return
  }
  if (body.description && body.description.length > DESCRIPTION_MAX) {
    toast.error(t('event.website.descriptionTooLong', { max: DESCRIPTION_MAX }))
    return
  }

  saving.value = true
  try {
    const res = await $fetch<UpdateEventWebsiteResponse>(`/api/events/${props.eventId}/website`, {
      method: 'PUT',
      body,
    })
    if (!res.ok) throw new Error(res.error || t('event.website.saveFailed'))
    saved.value = { ...body }
    form.value = { ...body }
    toast.success(t('event.website.saved'))
  } catch (err: any) {
    toast.error(err?.message || t('event.website.saveFailed'))
  } finally {
    saving.value = false
  }
}

let markdown: { render: (src: string) => string } | null = null

async function openPreview() {
  showPreview.value = true
  const source = form.value.description?.trim() ?? ''
  if (!source) {
    previewHtml.value = ''
    return
  }
  if (!markdown) {
    const { default: MarkdownIt } = await import('markdown-it')
    markdown = new MarkdownIt({ html: false, linkify: true, breaks: true })
  }
  previewHtml.value = markdown.render(source)
}

watch(() => props.eventId, load)
onMounted(load)
</script>

<style scoped>
.website-preview :deep(p) { margin-bottom: 0.75rem; }
.website-preview :deep(ul) { list-style: disc; padding-left: 1.25rem; margin-bottom: 0.75rem; }
.website-preview :deep(ol) { list-style: decimal; padding-left: 1.25rem; margin-bottom: 0.75rem; }
.website-preview :deep(a) { color: var(--color-link-600, #2563eb); text-decoration: underline; }
.website-preview :deep(h1),
.website-preview :deep(h2),
.website-preview :deep(h3) { font-weight: 600; margin: 0.75rem 0 0.5rem; }
.website-preview :deep(strong) { font-weight: 600; }
.website-preview :deep(em) { font-style: italic; }
</style>
