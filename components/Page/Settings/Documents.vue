<template>
  <CommonPageTableCard
    :title="t('settings.documents.title')"
    persist-key="settings-documents"
    :search-value="search"
    :can-create="canManage"
    :create-label="`+ ${t('settings.documents.add')}`"
    @update:search-value="search = $event"
    @create="addDocument"
  >
    <template #actions>
      <PageAuditTableHistoryButton :tables="['association_documents']" />
    </template>

    <CommonAdvancedTable
      v-model:search="search"
      :loading="loading"
      persist-key="settings-documents"
      :rows="documents"
      :columns="columns"
      :empty-text="t('settings.documents.none')"
      @row-open="canManage ? editDocument($event) : undefined"
    >
      <template #cell-file="{ row }">
        <span v-if="row.file_id" class="inline-flex items-center gap-1.5 text-base-700">
          <Icon :name="fileIcon(row.mime_type)" class="h-4 w-4 shrink-0 text-base-400" aria-hidden="true" />
          <span class="truncate">{{ row.file_name }}</span>
        </span>
        <span v-else class="text-warning-600">{{ t('settings.documents.fileMissing') }}</span>
      </template>

      <template #actions="{ row }">
        <button v-if="row.file_id" class="cursor-pointer text-link-600 hover:underline" @click="openFile(row.file_id)">
          {{ t('settings.documents.download') }}
        </button>

        <button v-if="canManage" class="cursor-pointer text-link-600 hover:underline" @click="editDocument(row)">
          {{ t('actions.edit') }}
        </button>

        <button v-if="canManage" class="cursor-pointer text-danger-500 hover:underline" @click="askDelete(row)">
          {{ t('actions.delete') }}
        </button>
      </template>
    </CommonAdvancedTable>
  </CommonPageTableCard>

  <CommonModal
    v-if="editing"
    v-model="showEditor"
    :title="editing.id ? t('settings.documents.edit') : t('settings.documents.add')"
    width-class="max-w-lg"
    @close="closeEditor"
  >
    <CommonValidationSummary v-if="errors.length" :errors="errors" :title="t('common.validationBlocked')" />

    <div class="field">
      <label for="document-title">{{ t('settings.documents.titleField') }}</label>
      <input id="document-title" v-model="editing.title" type="text" maxlength="191" class="input">
      <p class="mt-1 text-xs text-base-500">{{ t('settings.documents.titleHelp') }}</p>
    </div>

    <div class="field">
      <label for="document-description">{{ t('settings.documents.description') }}</label>
      <textarea id="document-description" v-model="editing.description" rows="2" maxlength="500" class="input resize-none"></textarea>
      <p class="mt-1 text-xs text-base-500">{{ t('settings.documents.descriptionHelp') }}</p>
    </div>

    <div class="field">
      <label for="document-file">{{ editing.id && editing.file_name ? t('settings.documents.fileReplace') : t('settings.documents.file') }}</label>
      <input
        id="document-file"
        ref="fileInput"
        type="file"
        accept="application/pdf,image/jpeg,image/png"
        class="input"
        @change="onFileChange"
      >
      <p class="mt-1 text-xs text-base-500">
        {{ t('settings.documents.fileHelp') }}
        <template v-if="editing.id && editing.file_name"> {{ t('settings.documents.fileKeep') }}</template>
      </p>
      <p v-if="editing.id && editing.file_name" class="mt-1 inline-flex items-center gap-1.5 text-xs text-base-600">
        <Icon name="material-symbols:attach-file-rounded" class="h-4 w-4 shrink-0" aria-hidden="true" />
        {{ editing.file_name }}
      </p>
    </div>

    <div class="field">
      <label class="mb-1">{{ t('settings.documents.active') }}</label>
      <CommonToggleSwitch v-model="editing.is_active" :label="t('settings.documents.active')" />
      <p class="mt-1 text-xs text-base-500">{{ t('settings.documents.activeHelp') }}</p>
    </div>

    <template #footer>
      <button class="btn-secondary" @click="closeEditor">{{ t('actions.cancel') }}</button>
      <button
        class="btn-primary"
        :disabled="saving"
        :class="{ 'cursor-not-allowed opacity-50': saving }"
        @click="saveDocument"
      >
        {{ saving ? t('actions.saving') : t('actions.save') }}
      </button>
    </template>
  </CommonModal>

  <CommonModal
    v-if="deleting"
    v-model="showDelete"
    :title="t('settings.documents.deleteConfirmTitle')"
    width-class="max-w-md"
    @close="deleting = null"
  >
    <p class="text-sm text-base-800">{{ t('settings.documents.deleteConfirm', { title: deleting.title }) }}</p>
    <p class="mt-2 text-xs text-base-500">{{ t('settings.documents.deleteConfirmHelp') }}</p>

    <template #footer>
      <button class="btn-secondary" @click="deleting = null">{{ t('actions.cancel') }}</button>
      <button
        class="btn-primary"
        :disabled="deletingBusy"
        :class="{ 'cursor-not-allowed opacity-50': deletingBusy }"
        @click="confirmDelete"
      >
        {{ t('actions.delete') }}
      </button>
    </template>
  </CommonModal>
</template>

<script setup lang="ts">
import { useI18n } from '~/composables/useI18n'
import { useToast } from '~/composables/useToast'
import { useAuth } from '~/composables/useAuth'
import type { AdvancedTableColumn } from '~/composables/useAdvancedTable'
import type { AssociationDocument } from '~/types/document'
import type { ListDocumentsResponse } from '~/server/api/documents/index.get'
import type { SaveDocumentResponse } from '~/server/api/documents/save.post'
import type { DeleteDocumentResponse } from '~/server/api/documents/[id].delete'

const { t } = useI18n()
const { refresh: refreshDocumentCache } = useAssociationDocuments()
const toast = useToast()
const { hasPermission } = useAuth()

const canManage = computed(() => hasPermission(['settings.documents.manage']))

const documents = ref<AssociationDocument[]>([])
const loading = ref(true)
const search = ref('')

const showEditor = ref(false)
const saving = ref(false)
const errors = ref<string[]>([])
type DocumentDraft = Omit<AssociationDocument, 'id'> & { id: number | null }

const editing = ref<DocumentDraft | null>(null)
const selectedFile = ref<File | null>(null)
const fileInput = ref<HTMLInputElement | null>(null)

const deleting = ref<AssociationDocument | null>(null)
const deletingBusy = ref(false)
const showDelete = computed({
  get: () => deleting.value !== null,
  set: (value: boolean) => {
    if (!value) deleting.value = null
  },
})

const columns = computed<AdvancedTableColumn<AssociationDocument>[]>(() => ([
  {
    key: 'title',
    label: t('settings.documents.columns.title'),
    globalSearchable: true,
    getValue: row => row.title,
    mobile: 'title',
  },
  {
    key: 'file',
    label: t('settings.documents.columns.file'),
    globalSearchable: true,
    filterable: false,
    getValue: row => row.file_name ?? '',
  },
  {
    key: 'file_size',
    label: t('settings.documents.columns.size'),
    filterable: false,
    getValue: row => row.file_size ?? 0,
    format: row => formatFileSize(row.file_size ?? 0),
    mobileLabel: true,
  },
  {
    key: 'is_active',
    label: t('settings.documents.columns.status'),
    getValue: row => (row.is_active ? t('settings.documents.active') : t('settings.documents.inactive')),
    mobileLabel: true,
  },
]))

function formatFileSize(bytes: number) {
  if (!bytes) return '—'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function fileIcon(mimeType: string | null) {
  return mimeType === 'application/pdf' ? 'material-symbols:picture-as-pdf-rounded' : 'material-symbols:image-outline-rounded'
}

function openFile(fileId: number) {
  window.open(`/api/files/${fileId}`, '_blank', 'noopener')
}

async function load() {
  loading.value = true
  try {
    const res = await $fetch<ListDocumentsResponse>('/api/documents')
    if (res.ok) documents.value = res.documents
    else toast.error(res.error)
  } catch {
    toast.error(t('settings.documents.loadFailed'))
  } finally {
    loading.value = false
  }
}

function addDocument() {
  editing.value = {
    id: null,
    title: '',
    description: '',
    is_active: true,
    created_at: '',
    file_id: null,
    file_name: null,
    file_size: null,
    mime_type: null,
  }
  resetFileInput()
  errors.value = []
  showEditor.value = true
}

function editDocument(document: AssociationDocument) {
  editing.value = { ...document }
  resetFileInput()
  errors.value = []
  showEditor.value = true
}

function resetFileInput() {
  selectedFile.value = null
  if (fileInput.value) fileInput.value.value = ''
}

function onFileChange(event: Event) {
  selectedFile.value = (event.target as HTMLInputElement).files?.[0] ?? null
}

function closeEditor() {
  showEditor.value = false
  editing.value = null
  resetFileInput()
}

async function saveDocument() {
  if (!editing.value || saving.value) return

  const list: string[] = []
  if (!editing.value.title.trim()) list.push(t('settings.documents.titleField'))
  if (!editing.value.id && !selectedFile.value) list.push(t('settings.documents.file'))
  errors.value = list
  if (list.length) return

  saving.value = true
  try {
    const formData = new FormData()
    formData.append('document', JSON.stringify({
      id: editing.value.id ?? undefined,
      title: editing.value.title.trim(),
      description: editing.value.description?.trim() || '',
      is_active: editing.value.is_active,
    }))
    if (selectedFile.value) formData.append('file', selectedFile.value)

    const res = await $fetch<SaveDocumentResponse>('/api/documents/save', { method: 'POST', body: formData })
    if (!res.ok) {
      errors.value = [res.error]
      return
    }

    toast.success(t('settings.documents.saved'))
    refreshDocumentCache()
    closeEditor()
    await load()
  } catch {
    errors.value = [t('settings.documents.saveFailed')]
  } finally {
    saving.value = false
  }
}

function askDelete(document: AssociationDocument) {
  deleting.value = document
}

async function confirmDelete() {
  if (!deleting.value || deletingBusy.value) return

  deletingBusy.value = true
  try {
    const res = await $fetch<DeleteDocumentResponse>(`/api/documents/${deleting.value.id}`, { method: 'DELETE' })
    if (!res.ok) {
      toast.error(res.error)
      return
    }

    toast.success(t('settings.documents.deleted'))
    refreshDocumentCache()
    deleting.value = null
    await load()
  } finally {
    deletingBusy.value = false
  }
}

onMounted(load)

useAppRefresh().onRefresh(load)
</script>
