<template>
  <button
    type="button"
    class="btn-secondary inline-flex items-center gap-2"
    :disabled="rows.length === 0"
    @click="open = true"
  >
    <Icon name="material-symbols:download-rounded" />
    {{ t('documentExport.button') }}
  </button>

  <CommonModal v-model="open" :title="t('documentExport.title', { nouns: nouns.many })" width-class="max-w-xl">
    <p class="text-sm text-base-600">
      {{ t('documentExport.summary', { count: rows.length, noun: rows.length === 1 ? nouns.one : nouns.many }) }}
      <template v-if="amount">· {{ t(costCentre ? 'documentExport.summaryShare' : 'documentExport.summaryTotal', { total: formatCurrency(totalAmount) }) }}</template>
      <span v-if="withoutDocumentCount > 0" class="text-base-500">
        · {{ t('documentExport.withoutDocument', { count: withoutDocumentCount }) }}
      </span>
    </p>

    <div v-if="costCentre" class="rounded-lg border border-base-200 bg-base-50 px-3 py-2 text-sm">
      <p class="font-medium text-base-800">
        {{ t('documentExport.costCentreScope', { label: costCentreLabel || '' }) }}
        <span v-if="costCentre.includeChildren" class="font-normal text-base-500">{{ t('documentExport.costCentreScopeChildren') }}</span>
      </p>
      <p class="mt-0.5 text-xs text-base-500">{{ t('documentExport.costCentreScopeHint', { nouns: nouns.many }) }}</p>
    </div>

    <div>
      <span class="block text-sm font-medium text-base-700">{{ t('documentExport.format') }}</span>
      <div class="mt-1.5 grid grid-cols-1 gap-2 sm:grid-cols-2">
        <button
          v-for="option in formatOptions"
          :key="option.value"
          type="button"
          :class="[
            'flex items-start gap-2.5 rounded-lg border p-3 text-left cursor-pointer',
            format === option.value ? 'border-base-800 bg-base-50' : 'border-base-200 hover:bg-base-50',
          ]"
          @click="format = option.value"
        >
          <Icon :name="option.icon" class="mt-0.5 shrink-0 text-lg text-base-700" />
          <span class="min-w-0">
            <span class="block text-sm font-semibold text-base-900">{{ option.label }}</span>
            <span class="mt-0.5 block text-xs text-base-500">{{ option.hint }}</span>
          </span>
        </button>
      </div>
    </div>

    <label v-if="format === 'pdf'" class="flex cursor-pointer items-start gap-2 text-sm text-base-700">
      <input v-model="includeCover" type="checkbox" class="checkbox mt-0.5">
      <span>
        {{ t('documentExport.includeCover') }}
        <span class="block text-xs text-base-500">{{ t('documentExport.includeCoverHint') }}</span>
      </span>
    </label>

    <label v-else class="flex cursor-pointer items-start gap-2 text-sm text-base-700">
      <input v-model="includeIndex" type="checkbox" class="checkbox mt-0.5">
      <span>
        {{ t('documentExport.includeIndex') }}
        <span class="block text-xs text-base-500">{{ t('documentExport.includeIndexHint') }}</span>
      </span>
    </label>

    <p v-if="withoutDocumentCount > 0" class="rounded-lg bg-base-50 px-3 py-2 text-xs text-base-600">
      {{ format === 'pdf'
        ? t('documentExport.withoutDocumentPdf', { nouns: nouns.many })
        : t('documentExport.withoutDocumentZip', { nouns: nouns.many }) }}
    </p>

    <template #footer>
      <button type="button" class="btn-secondary" :disabled="downloading" @click="open = false">
        {{ t('actions.cancel') }}
      </button>
      <button
        type="button"
        class="btn-primary inline-flex items-center gap-2"
        :disabled="downloading || rows.length === 0"
        @click="submit"
      >
        <Icon
          :name="downloading ? 'material-symbols:progress-activity' : 'material-symbols:download-rounded'"
          :class="{ 'animate-spin': downloading }"
        />
        {{ downloading ? t('documentExport.preparing') : t('documentExport.download') }}
      </button>
    </template>
  </CommonModal>
</template>

<script setup lang="ts" generic="T">
import { computed, ref } from 'vue'
import { useDocumentExport } from '~/composables/useDocumentExport'
import { useI18n } from '~/composables/useI18n'
import { useLocaleFormatters } from '~/composables/useLocaleFormatters'
import { useToast } from '~/composables/useToast'
import {
  MAX_DOCUMENT_EXPORT_COUNT,
  type DocumentExportCostCentreScope,
  type DocumentExportFormat,
  type DocumentExportSourceKey,
} from '~/shared/documentExport'

const props = defineProps<{
  source: DocumentExportSourceKey
  rows: T[]
  /** Record id per row; defaults to `row.id`. */
  rowId?: (row: T) => number
  /** Whether the row has a document attached, for the "without document" hints. */
  hasDocument?: (row: T) => boolean
  /** Amount per row; shows the selection's total in the dialog (within a cost-centre scope: the share). */
  amount?: (row: T) => number
  /**
   * Export in the context of one cost centre (e.g. from the finance analysis): records split over
   * several cost centres stay complete, but their share for it is shown and summed.
   */
  costCentre?: DocumentExportCostCentreScope | null
  costCentreLabel?: string
}>()

const emit = defineEmits<{
  (e: 'exported'): void
}>()

const { t } = useI18n()
const toast = useToast()
const { formatCurrency } = useLocaleFormatters()
const { download } = useDocumentExport(props.source)

const open = ref(false)
const format = ref<DocumentExportFormat>('pdf')
const includeCover = ref(true)
const includeIndex = ref(true)
const downloading = ref(false)

const nouns = computed(() => ({
  one: t(`documentExport.sources.${props.source}.one`),
  many: t(`documentExport.sources.${props.source}.many`),
}))

const totalAmount = computed(() => props.amount
  ? props.rows.reduce((sum, row) => sum + Number(props.amount!(row) || 0), 0)
  : 0)
const withoutDocumentCount = computed(() => props.hasDocument
  ? props.rows.filter(row => !props.hasDocument!(row)).length
  : 0)

const formatOptions = computed<Array<{ value: DocumentExportFormat, label: string, hint: string, icon: string }>>(() => [
  { value: 'pdf', label: t('documentExport.formatPdf'), hint: t('documentExport.formatPdfHint'), icon: 'material-symbols:picture-as-pdf-rounded' },
  { value: 'zip', label: t('documentExport.formatZip'), hint: t('documentExport.formatZipHint'), icon: 'material-symbols:folder-zip-rounded' },
])

function idOf(row: T) {
  return props.rowId ? props.rowId(row) : Number((row as { id?: number }).id)
}

async function submit() {
  if (!props.rows.length) {
    toast.error(t('documentExport.validation.noneSelected'))
    return
  }
  if (props.rows.length > MAX_DOCUMENT_EXPORT_COUNT) {
    toast.error(t('documentExport.validation.tooMany', { max: MAX_DOCUMENT_EXPORT_COUNT }))
    return
  }
  if (format.value === 'zip' && !includeIndex.value && withoutDocumentCount.value === props.rows.length) {
    toast.error(t('documentExport.validation.nothingToZip'))
    return
  }

  downloading.value = true
  try {
    const res = await download({
      ids: props.rows.map(idOf),
      format: format.value,
      includeCover: includeCover.value,
      includeIndex: includeIndex.value,
      costCentre: props.costCentre ?? null,
    })
    if (res.ok) {
      toast.success(t('documentExport.downloadSuccess'))
      open.value = false
      emit('exported')
    } else {
      toast.error(res.error || t('documentExport.downloadFailed'))
    }
  } catch {
    toast.error(t('documentExport.downloadFailed'))
  } finally {
    downloading.value = false
  }
}
</script>
