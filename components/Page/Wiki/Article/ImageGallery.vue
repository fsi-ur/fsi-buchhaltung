<template>
  <section v-if="images.length" class="space-y-2">
    <div class="flex flex-wrap items-baseline justify-between gap-2">
      <p class="section-title">{{ t('wiki.editor.images.title', { count: images.length }) }}</p>
      <p class="text-xs text-base-400">{{ t('wiki.editor.images.totalSize', { size: formatBytes(totalSize) }) }}</p>
    </div>

    <ul class="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
      <li
        v-for="image in images"
        :key="image.fileId"
        class="flex flex-col overflow-hidden rounded-lg border border-base-200 bg-white"
      >
        <button
          type="button"
          class="flex aspect-video cursor-zoom-in items-center justify-center bg-base-50"
          :title="t('wiki.editor.images.open')"
          @click="openImage(image)"
        >
          <img :src="fileUrl(image.fileId)" :alt="image.fileName" loading="lazy" class="max-h-full max-w-full object-contain" />
        </button>

        <div class="flex flex-1 flex-col gap-1.5 p-2">
          <p class="truncate text-xs font-medium text-base-700" :title="image.fileName">{{ image.fileName }}</p>
          <p class="text-[11px] text-base-400">{{ formatBytes(image.fileSize) }} · bild:{{ image.fileId }}</p>
          <span class="w-fit rounded-full px-2 py-0.5 text-[11px] font-medium" :class="statusOf(image).class">
            {{ statusOf(image).label }}
          </span>

          <div class="mt-auto flex justify-end gap-1 pt-1">
            <button
              type="button"
              class="icon-btn"
              :title="t('wiki.editor.images.insert')"
              :aria-label="t('wiki.editor.images.insert')"
              :disabled="disabled"
              @click="$emit('insert', image)"
            >
              <Icon name="material-symbols:add-photo-alternate-outline-rounded" class="h-4 w-4" aria-hidden="true" />
            </button>
            <button
              type="button"
              class="icon-btn icon-btn-danger"
              :title="statusOf(image).deleteBlocked ?? t('wiki.editor.images.delete')"
              :aria-label="t('wiki.editor.images.delete')"
              :disabled="disabled || !!statusOf(image).deleteBlocked"
              @click="pendingDelete = image"
            >
              <Icon name="material-symbols:delete-outline-rounded" class="h-4 w-4" aria-hidden="true" />
            </button>
          </div>
        </div>
      </li>
    </ul>

    <CommonModal :model-value="pendingDelete !== null" :title="t('wiki.editor.images.confirmTitle')" @update:model-value="value => { if (!value) pendingDelete = null }">
      <div class="space-y-2 text-sm text-base-700">
        <p>{{ t('wiki.editor.images.confirmText', { name: pendingDelete?.fileName ?? '' }) }}</p>
        <p v-if="pendingDelete?.usage.revisions" class="text-warning-700">
          {{ t('wiki.editor.images.confirmRevisions', { count: pendingDelete.usage.revisions }) }}
        </p>
      </div>
      <template #footer>
        <div class="flex justify-end gap-2">
          <button type="button" class="btn-secondary" :disabled="deleting" @click="pendingDelete = null">
            {{ t('wiki.editor.cancel') }}
          </button>
          <button
            type="button"
            class="btn-primary bg-danger-600 hover:bg-danger-700 disabled:opacity-50"
            :disabled="deleting"
            @click="confirmDelete"
          >
            {{ t('wiki.editor.images.delete') }}
          </button>
        </div>
      </template>
    </CommonModal>
  </section>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from '~/composables/useI18n'
import { useToast } from '~/composables/useToast'
import { findImageReferencesInText } from '~/shared/wikiImages'
import type { DeleteWikiImageResponse } from '~/server/api/wiki/articles/[id]/images.delete'
import type { WikiImage } from '~/types/wiki'

const props = defineProps<{
  articleId: number
  images: WikiImage[]
  /** The text currently in the editor — an image used there must not be deleted, saved or not. */
  markdown: string
  disabled?: boolean
  /** Runs before a delete, so the server judges the image against the text as it is now (pending autosave). */
  beforeDelete?: () => Promise<void>
}>()

const emit = defineEmits<{
  (e: 'insert', image: WikiImage): void
  (e: 'deleted', fileId: number): void
}>()

const { t } = useI18n()
const toast = useToast()
const appBaseUrl = useRuntimeConfig().app.baseURL || '/'

const pendingDelete = ref<WikiImage | null>(null)
const deleting = ref(false)

const usedInText = computed(() => findImageReferencesInText(props.markdown))
const totalSize = computed(() => props.images.reduce((sum, image) => sum + image.fileSize, 0))

function fileUrl(fileId: number) {
  return `${appBaseUrl.replace(/\/+$/, '')}/api/files/${fileId}`
}

function openImage(image: WikiImage) {
  window.open(fileUrl(image.fileId), '_blank', 'noopener')
}

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function statusOf(image: WikiImage): { label: string, class: string, deleteBlocked?: string } {
  if (usedInText.value.has(image.fileId)) {
    return {
      label: t('wiki.editor.images.inText'),
      class: 'bg-accent-50 text-accent-700',
      deleteBlocked: t('wiki.editor.images.blockedInText'),
    }
  }
  if (image.usage.published) {
    return {
      label: t('wiki.editor.images.published'),
      class: 'bg-info-50 text-info-700',
      deleteBlocked: t('wiki.editor.images.blockedPublished'),
    }
  }
  if (image.usage.revisions) {
    return { label: t('wiki.editor.images.inRevisions', { count: image.usage.revisions }), class: 'bg-base-100 text-base-600' }
  }
  return { label: t('wiki.editor.images.unused'), class: 'bg-warning-50 text-warning-700' }
}

async function confirmDelete() {
  const image = pendingDelete.value
  if (!image) return

  deleting.value = true
  try {
    await props.beforeDelete?.()
    const res = await apiFetch<DeleteWikiImageResponse>(`/api/wiki/articles/${props.articleId}/images`, {
      method: 'DELETE',
      query: { fileId: image.fileId },
    })
    if (!res.ok) {
      toast.error(res.error)
      return
    }
    emit('deleted', image.fileId)
    toast.success(t('wiki.editor.images.deletedToast'))
    pendingDelete.value = null
  } catch {
    toast.error(t('wiki.editor.images.deleteFailed'))
  } finally {
    deleting.value = false
  }
}
</script>
