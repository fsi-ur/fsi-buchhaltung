<template>
  <div class="space-y-2">
    <div v-if="label || $slots.label" class="flex items-center justify-between gap-2">
      <p class="text-xs font-medium text-base-600"><slot name="label">{{ label }}</slot></p>
      <p v-if="max" class="text-[11px] text-base-400">{{ t('attachments.counter', { count: items.length, max }) }}</p>
    </div>

    <ul v-if="items.length" class="flex flex-wrap gap-1.5">
      <li
        v-for="item in items"
        :key="item.key"
        class="inline-flex max-w-full items-center gap-1.5 rounded-md border px-2 py-1 text-xs"
        :class="item.unavailable
          ? 'border-warning-200 bg-warning-50 text-warning-700'
          : 'border-base-200 bg-base-50 text-base-700'"
        :title="itemTitle(item)"
      >
        <Icon
          :name="item.unavailable
            ? 'material-symbols:error-outline-rounded'
            : (item.kind === 'document' ? 'material-symbols:library-books-outline-rounded' : 'material-symbols:attach-file-rounded')"
          class="h-3.5 w-3.5 shrink-0"
          aria-hidden="true"
        />

        <a
          v-if="item.fileId && canOpenFiles && !item.unavailable"
          :href="`/api/files/${item.fileId}`"
          target="_blank"
          rel="noopener noreferrer"
          class="min-w-0 truncate hover:underline"
        >{{ item.title }}</a>
        <span v-else class="min-w-0 truncate">{{ item.title }}</span>

        <button
          v-if="!readOnly"
          type="button"
          class="shrink-0 cursor-pointer text-base-400 transition-colors hover:text-danger-600"
          :disabled="disabled"
          :title="t('attachments.remove')"
          :aria-label="t('attachments.remove')"
          @click="removeItem(item)"
        >
          <Icon name="material-symbols:close-rounded" class="h-3.5 w-3.5" aria-hidden="true" />
        </button>
      </li>
    </ul>

    <p v-else class="text-xs text-base-400">{{ t('attachments.none') }}</p>

    <div v-if="!readOnly" class="flex flex-wrap items-center gap-2">
      <button
        type="button"
        class="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-base-200 px-2.5 py-1.5 text-xs font-medium text-base-700 transition-colors hover:bg-base-50 disabled:cursor-not-allowed disabled:opacity-50"
        :disabled="disabled || full"
        @click="openPicker"
      >
        <Icon name="material-symbols:library-books-outline-rounded" class="h-4 w-4" aria-hidden="true" />
        {{ t('attachments.addDocument') }}
      </button>

      <button
        type="button"
        class="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-base-200 px-2.5 py-1.5 text-xs font-medium text-base-700 transition-colors hover:bg-base-50 disabled:cursor-not-allowed disabled:opacity-50"
        :disabled="disabled || full || uploading"
        @click="fileInputRef?.click()"
      >
        <Icon name="material-symbols:upload-rounded" class="h-4 w-4" aria-hidden="true" />
        {{ uploading ? t('attachments.uploading') : t('attachments.upload') }}
      </button>

      <span v-if="full" class="text-[11px] text-warning-600">{{ t('attachments.maxReached', { max }) }}</span>

      <input
        ref="fileInputRef"
        type="file"
        class="hidden"
        accept="application/pdf,image/png,image/jpeg"
        @change="uploadFile"
      >
    </div>
  </div>

  <CommonModal v-model="pickerOpen" :title="t('attachments.modalTitle')" width-class="max-w-lg">
    <input
      v-model="search"
      type="search"
      class="input w-full"
      :placeholder="t('attachments.searchPlaceholder')"
    >

    <div v-if="!documents.length" class="rounded-lg border border-dashed border-base-300 px-3 py-6 text-center text-sm text-base-500">
      {{ t('attachments.libraryEmpty') }}
    </div>

    <div v-else-if="!filteredDocuments.length" class="rounded-lg border border-dashed border-base-300 px-3 py-6 text-center text-sm text-base-500">
      {{ t('attachments.searchEmpty') }}
    </div>

    <ul v-else class="max-h-[min(50vh,24rem)] space-y-1 overflow-y-auto pr-1">
      <li v-for="document in filteredDocuments" :key="document.id">
        <button
          type="button"
          class="flex w-full cursor-pointer items-start gap-3 rounded-lg border px-3 py-2 text-left transition-colors"
          :class="draftDocumentIds.includes(document.id)
            ? 'border-accent-300 bg-accent-50'
            : 'border-base-200 hover:bg-base-50'"
          :disabled="!draftDocumentIds.includes(document.id) && draftFull"
          @click="toggleDraftDocument(document.id)"
        >
          <Icon
            :name="draftDocumentIds.includes(document.id) ? 'material-symbols:check-circle-rounded' : 'material-symbols:circle-outline'"
            class="mt-0.5 h-4 w-4 shrink-0"
            :class="draftDocumentIds.includes(document.id) ? 'text-accent-600' : 'text-base-300'"
            aria-hidden="true"
          />
          <span class="min-w-0 flex-1">
            <span class="block truncate text-sm font-medium text-base-800">{{ document.title }}</span>
            <span v-if="document.description" class="block truncate text-xs text-base-500">{{ document.description }}</span>
          </span>
          <span class="shrink-0 text-[11px] text-base-400">{{ formatBytes(document.file_size ?? 0) }}</span>
        </button>
      </li>
    </ul>

    <template #footer>
      <button class="btn-secondary" type="button" @click="pickerOpen = false">{{ t('actions.cancel') }}</button>
      <button class="btn-primary" type="button" @click="applyPicker">{{ t('attachments.apply') }}</button>
    </template>
  </CommonModal>
</template>

<script setup lang="ts">
import { useI18n } from '~/composables/useI18n'
import { useToast } from '~/composables/useToast'
import { useAuth } from '~/composables/useAuth'
import { useAssociationDocuments } from '~/composables/useAssociationDocuments'
import { useAppRefresh } from '~/composables/useAppRefresh'
import type { UploadAttachmentResponse } from '~/server/api/attachments/upload.post'
import type { ResolveAttachmentFilesResponse } from '~/server/api/attachments/files.post'
import type { AttachmentFileInfo, AttachmentItem, AttachmentScope, AttachmentSelection } from '~/types/attachment'

const props = withDefaults(defineProps<{
  modelValue: AttachmentSelection
  /** Decides which permission the upload is checked against. */
  scope: AttachmentScope
  /** The record the upload belongs to, when it already exists. */
  entityId?: number | null
  knownFiles?: AttachmentItem[]
  label?: string
  disabled?: boolean
  readOnly?: boolean
  max?: number
}>(), {
  entityId: null,
  knownFiles: () => [],
  label: '',
  max: 10,
})

const emit = defineEmits<{
  (e: 'update:modelValue', value: AttachmentSelection): void
}>()

const { t } = useI18n()
const toast = useToast()
const { hasPermission } = useAuth()
const { documents, ensureLoaded, refresh: refreshDocuments } = useAssociationDocuments()

const fileInputRef = ref<HTMLInputElement | null>(null)
const uploading = ref(false)
const pickerOpen = ref(false)
const search = ref('')
const draftDocumentIds = ref<number[]>([])

const uploadedFiles = ref(new Map<number, AttachmentFileInfo>())

const canOpenFiles = computed(() => hasPermission(['files.view']))

const selectionSize = computed(() => props.modelValue.documentIds.length + props.modelValue.fileIds.length)
const full = computed(() => selectionSize.value >= props.max)
const draftFull = computed(() => draftDocumentIds.value.length + props.modelValue.fileIds.length >= props.max)

function fileInfo(fileId: number): AttachmentFileInfo | null {
  const uploaded = uploadedFiles.value.get(fileId)
  if (uploaded) return uploaded

  const known = props.knownFiles.find(entry => entry.kind === 'file' && entry.fileId === fileId)
  if (!known?.fileName) return null
  return {
    fileId,
    fileName: known.fileName,
    fileSize: Number(known.fileSize ?? 0),
    mimeType: known.mimeType ?? '',
  }
}

const items = computed<AttachmentItem[]>(() => [
  ...props.modelValue.documentIds.map((documentId) => {
    const document = documents.value.find(entry => entry.id === documentId)
    return {
      key: `document:${documentId}`,
      kind: 'document' as const,
      documentId,
      fileId: document?.file_id ?? null,
      title: document?.title ?? t('attachments.unknownDocument'),
      fileName: document?.file_name ?? null,
      fileSize: document?.file_size ?? null,
      mimeType: document?.mime_type ?? null,
      unavailable: documents.value.length > 0 && !document,
    }
  }),
  ...props.modelValue.fileIds.map((fileId) => {
    const info = fileInfo(fileId)
    return {
      key: `file:${fileId}`,
      kind: 'file' as const,
      documentId: null,
      fileId,
      title: info?.fileName ?? t('attachments.unknownFile'),
      fileName: info?.fileName ?? null,
      fileSize: info?.fileSize ?? null,
      mimeType: info?.mimeType ?? null,
      unavailable: false,
    }
  }),
])

const filteredDocuments = computed(() => {
  const needle = search.value.trim().toLowerCase()
  if (!needle) return documents.value
  return documents.value.filter(document =>
    document.title.toLowerCase().includes(needle) || document.description.toLowerCase().includes(needle))
})

function itemTitle(item: AttachmentItem) {
  if (item.unavailable) return t('attachments.unavailable')
  const size = item.fileSize ? ` · ${formatBytes(item.fileSize)}` : ''
  return `${item.kind === 'document' ? t('attachments.documentBadge') : t('attachments.fileBadge')}: ${item.title}${size}`
}

function formatBytes(bytes: number) {
  if (!bytes) return '—'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function update(selection: AttachmentSelection) {
  emit('update:modelValue', selection)
}

function removeItem(item: AttachmentItem) {
  if (props.disabled) return
  update(item.kind === 'document'
    ? { ...props.modelValue, documentIds: props.modelValue.documentIds.filter(id => id !== item.documentId) }
    : { ...props.modelValue, fileIds: props.modelValue.fileIds.filter(id => id !== item.fileId) })
}

async function openPicker() {
  draftDocumentIds.value = [...props.modelValue.documentIds]
  search.value = ''
  pickerOpen.value = true
  await ensureLoaded()
}

function toggleDraftDocument(documentId: number) {
  draftDocumentIds.value = draftDocumentIds.value.includes(documentId)
    ? draftDocumentIds.value.filter(id => id !== documentId)
    : [...draftDocumentIds.value, documentId]
}

function applyPicker() {
  update({ ...props.modelValue, documentIds: [...draftDocumentIds.value] })
  pickerOpen.value = false
}

async function uploadFile(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return

  const body = new FormData()
  body.append('file', file)
  body.append('scope', props.scope)
  if (props.entityId) body.append('entityId', String(props.entityId))

  uploading.value = true
  try {
    const res = await $fetch<UploadAttachmentResponse>('/api/attachments/upload', { method: 'POST', body })
    if (!res.ok) {
      toast.error(res.error)
      return
    }

    uploadedFiles.value.set(res.file.fileId, res.file)
    update({ ...props.modelValue, fileIds: [...props.modelValue.fileIds, res.file.fileId] })
  } catch {
    toast.error(t('attachments.uploadFailed'))
  } finally {
    uploading.value = false
    input.value = ''
  }
}

async function resolveUnknownFiles() {
  const missing = props.modelValue.fileIds.filter(fileId => !fileInfo(fileId))
  if (!missing.length) return

  try {
    const res = await $fetch<ResolveAttachmentFilesResponse>('/api/attachments/files', {
      method: 'POST',
      body: { fileIds: missing },
    })
    if (!res.ok) return
    for (const file of res.files) uploadedFiles.value.set(file.fileId, file)
  } catch {
    // Leaving the placeholder title in place is enough — the selection itself is unaffected.
  }
}

onMounted(() => {
  if (props.modelValue.documentIds.length || !props.readOnly) ensureLoaded()
  resolveUnknownFiles()
})

watch(() => props.modelValue.fileIds, resolveUnknownFiles)

useAppRefresh().onRefresh(() => {
  resolveUnknownFiles()
  return refreshDocuments()
})
</script>
