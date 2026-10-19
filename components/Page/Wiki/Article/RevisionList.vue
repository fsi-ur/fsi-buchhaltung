<template>
  <div class="space-y-3">
    <p v-if="!revisions.length" class="text-sm text-base-500">{{ t('wiki.revisions.empty') }}</p>

    <ul v-else class="space-y-2">
      <li
        v-for="revision in revisions"
        :key="revision.id"
        class="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-base-200 p-3 text-sm"
      >
        <div class="min-w-0">
          <p class="font-medium text-base-800">
            {{ t('wiki.revisions.version', { number: revision.revisionNumber }) }} — {{ revision.title }}
          </p>
          <p class="text-xs text-base-500">
            {{ formatDateTime(revision.createdAt) }}
            <template v-if="revision.createdBy"> · {{ t('wiki.revisions.by', { name: revision.createdBy }) }}</template>
          </p>
          <p v-if="revision.changeNote" class="text-xs text-base-600">{{ revision.changeNote }}</p>
        </div>

        <div class="flex gap-2">
          <button type="button" class="btn-secondary" @click="show(revision.id)">{{ t('wiki.revisions.show') }}</button>
          <button v-if="canWrite" type="button" class="btn-secondary" @click="confirmRestore = revision.id">
            {{ t('wiki.revisions.restore') }}
          </button>
        </div>
      </li>
    </ul>

    <CommonModal
      :model-value="detail !== null"
      :title="detail ? t('wiki.revisions.version', { number: detail.revisionNumber }) : ''"
      width-class="max-w-3xl"
      @update:model-value="detail = null"
    >
      <pre class="max-h-[60vh] overflow-auto whitespace-pre-wrap rounded-lg bg-base-50 p-3 font-mono text-xs">{{ detail?.contentMd }}</pre>
      <template #footer>
        <div class="flex justify-end">
          <button type="button" class="btn-secondary" @click="detail = null">{{ t('wiki.revisions.close') }}</button>
        </div>
      </template>
    </CommonModal>

    <CommonModal
      :model-value="confirmRestore !== null"
      :title="t('wiki.revisions.restoreConfirmTitle')"
      @update:model-value="confirmRestore = null"
    >
      <p class="text-sm text-base-700">{{ t('wiki.revisions.restoreConfirmText') }}</p>
      <template #footer>
        <div class="flex justify-end gap-2">
          <button type="button" class="btn-secondary" @click="confirmRestore = null">{{ t('wiki.editor.cancel') }}</button>
          <button type="button" class="btn-primary" @click="restore">{{ t('wiki.revisions.restore') }}</button>
        </div>
      </template>
    </CommonModal>
  </div>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue'
import { useI18n } from '~/composables/useI18n'
import { useLocaleFormatters } from '~/composables/useLocaleFormatters'
import { useToast } from '~/composables/useToast'
import type { WikiRevisionListResponse, WikiRevisionSummary } from '~/server/api/wiki/articles/[id]/revisions.get'
import type { WikiRevisionDetailResponse } from '~/server/api/wiki/revisions/[revisionId].get'

const props = defineProps<{
  articleId: number
  canWrite: boolean
}>()

const emit = defineEmits<{
  (e: 'restored'): void
}>()

const { t } = useI18n()
const { formatDateTime } = useLocaleFormatters()
const toast = useToast()

const revisions = ref<WikiRevisionSummary[]>([])
const detail = ref<{ revisionNumber: number, contentMd: string } | null>(null)
const confirmRestore = ref<number | null>(null)

async function load() {
  if (!props.articleId) return
  const res = await apiFetch<WikiRevisionListResponse>(`/api/wiki/articles/${props.articleId}/revisions`)
  revisions.value = res.ok ? res.revisions : []
}

async function show(revisionId: number) {
  const res = await apiFetch<WikiRevisionDetailResponse>(`/api/wiki/revisions/${revisionId}`)
  if (!res.ok) {
    toast.error(res.error)
    return
  }
  detail.value = { revisionNumber: res.revision.revisionNumber, contentMd: res.revision.contentMd }
}

async function restore() {
  const revisionId = confirmRestore.value
  confirmRestore.value = null
  if (!revisionId) return

  const res = await apiFetch<{ ok: boolean, error?: string }>(`/api/wiki/articles/${props.articleId}/restore`, {
    method: 'POST',
    body: { revisionId },
  })

  if (!res.ok) {
    toast.error(res.error ?? t('wiki.errors.saveFailed'))
    return
  }

  toast.success(t('wiki.editor.restoredToast'))
  emit('restored')
}

watch(() => props.articleId, load, { immediate: true })
defineExpose({ reload: load })
</script>
