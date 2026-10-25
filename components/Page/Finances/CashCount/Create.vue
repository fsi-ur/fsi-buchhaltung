<template>
  <PageFinancesEditorLayout
    :headline1="t('cashCount.title')"
    :can-view-files="canViewFiles"
    :model-value="file"
    :existing-file="existingFile"
    :can-edit="canEdit"
    @open-menu="$emit('openMenu')"
    @update:model-value="file = $event"
    @remove-existing="onRemoveFile"
  >
    <div v-if="isEditMode && cashCountId" class="mb-3 flex justify-end">
      <PageAuditHistoryButton table="cash_counts" :record-id="cashCountId" />
    </div>

    <CashCountForm
      v-model="form"
      :has-file="!!file || (!!existingFile && !removeExistingFile)"
      :disabled="!canEdit"
      :saving="isSaving"
      @submit="submit"
      @cancel="cancel"
    />

    <CashCountDiscrepancyPanel
      v-if="isEditMode && cashCountId"
      class="mt-6"
      :cash-count-id="cashCountId"
      :can-edit="canEdit"
    />
  </PageFinancesEditorLayout>
</template>

<script setup lang="ts">
import { useI18n } from '~/composables/useI18n'
import { useToast } from '~/composables/useToast'
import { useReturnTarget } from '~/composables/useReturnTarget'
import CashCountForm from './Form.vue'
import CashCountDiscrepancyPanel from './DiscrepancyPanel.vue'
import { usePage } from '~/composables/usePage'
import { useAuth } from '~/composables/useAuth'
import type { CreateCashCountBody } from '~/types/cashCount'
import type { GetCashCountResponse } from '~/server/api/cash_counts/[id].get'
import { normalizeLocalDateTime } from '~/shared/time'

const emit = defineEmits<{
  (e: 'openMenu'): void
}>()

const { pageMeta } = usePage()
const { t } = useI18n()
const toast = useToast()
const { hasPermission } = useAuth()
const { goToReturnTarget } = useReturnTarget('CashCountList')

const canEdit = computed(() => !pageMeta.value?.forceReadonly && hasPermission('cash_counts.edit'))
const canViewFiles = computed(() => hasPermission('files.view') && (canEdit.value || existingFile.value !== null))

const isEditMode = ref(false)
const cashCountId = ref<number | null>(null)
const file = ref<File | null>(null)
const existingFile = ref<{ id: number, url: string, name: string, mime_type: string, size: number } | null>(null)
const removeExistingFile = ref(false)
const isSaving = ref(false)

const form = ref<CreateCashCountBody>({
  event_id: 0,
  counted_by_first: 0,
  counted_by_second: 0,
  checked_by: 0,
  counted_before_at: '',
  counted_after_at: '',
  positions: [{ register_number: 1, amount_before: 0, amount_after: 0, notes: null }],
})

onMounted(async () => {
  cashCountId.value = pageMeta.value?.cashCountId || null
  if (!cashCountId.value) return

  isEditMode.value = true

  const res = await apiFetch<GetCashCountResponse>(String(`/api/cash_counts/${cashCountId.value}`), { method: 'GET' })
  if (!res.ok) {
    isEditMode.value = false
    return
  }

  form.value = {
    event_id: res.cashCount.event_id,
    counted_by_first: res.cashCount.counted_by_first,
    counted_by_second: res.cashCount.counted_by_second,
    checked_by: res.cashCount.checked_by,
    counted_before_at: res.cashCount.counted_before_at,
    counted_after_at: res.cashCount.counted_after_at,
    positions: res.cashCount.positions.map(position => ({
      id: position.id,
      register_number: position.register_number,
      amount_before: position.amount_before,
      amount_after: position.amount_after,
      notes: position.notes,
    })),
  }

  if (!res.file) return
  existingFile.value = {
    id: res.file.id,
    url: `/api/files/${res.file.id}`,
    name: res.file.original_name,
    mime_type: res.file.mime_type,
    size: res.file.file_size,
  }
  removeExistingFile.value = false
})

function onRemoveFile() {
  existingFile.value = null
  removeExistingFile.value = true
}

function hasValidDateOrder() {
  if (form.value.event_id === null) return true
  if (!form.value.counted_before_at) return false
  const before = normalizeLocalDateTime(form.value.counted_before_at)
  const after = normalizeLocalDateTime(form.value.counted_after_at)
  return Boolean(before && after && after > before)
}

function hasCompletePositions() {
  return form.value.positions.every(position => {
    const registerNumber = Number(position.register_number)
    const beforeAmount = Number(position.amount_before)
    const afterAmount = Number(position.amount_after)
    return Number.isInteger(registerNumber)
      && registerNumber > 0
      && (form.value.event_id === null || Number.isFinite(beforeAmount))
      && Number.isFinite(afterAmount)
  })
}

function hasUniqueRegisterNumbers() {
  const registerNumbers = form.value.positions.map(position => Number(position.register_number))
  return new Set(registerNumbers).size === registerNumbers.length
}

async function submit() {
  if (isSaving.value) return
  if (!canEdit.value) {
    toast.error(t('common.notAuthorized'))
    return
  }
  if (form.value.event_id !== null && !form.value.event_id) {
    toast.error(t('cashCount.required.event'))
    return
  }
  if (!form.value.counted_by_first) {
    toast.error(t('cashCount.required.countedByFirst'))
    return
  }
  if (!form.value.counted_by_second) {
    toast.error(t('cashCount.required.countedBySecond'))
    return
  }
  if (!form.value.checked_by) {
    toast.error(t('cashCount.required.checkedBy'))
    return
  }
  if (form.value.event_id !== null && !form.value.counted_before_at) {
    toast.error(t('cashCount.required.countedBeforeAt'))
    return
  }
  if (!form.value.counted_after_at) {
    toast.error(t('cashCount.required.countedAfterAt'))
    return
  }
  if (!hasValidDateOrder()) {
    toast.error(t('cashCount.required.order'))
    return
  }
  if (!form.value.positions.length) {
    toast.error(t('cashCount.required.addPosition'))
    return
  }
  if (!hasCompletePositions()) {
    toast.error(t('cashCount.required.completePosition'))
    return
  }
  if (!hasUniqueRegisterNumbers()) {
    toast.error(t('cashCount.required.uniqueRegister'))
    return
  }
  if (!file.value && (!existingFile.value || removeExistingFile.value)) {
    toast.error(t('cashCount.required.file'))
    return
  }

  const body = new FormData()
  if (file.value) body.append('file', file.value)
  if (form.value.event_id === null) {
    form.value.counted_before_at = null
    form.value.positions.forEach(position => {
      position.amount_before = position.amount_after
    })
  }
  body.append('cashCount', JSON.stringify(form.value))

  try {
    isSaving.value = true
    if (isEditMode.value) {
      body.append('removeExistingFile', String(removeExistingFile.value))
      const updateRes = await apiFetch<{ ok: boolean, error?: string }>(String(`/api/cash_counts/${cashCountId.value}`), {
        method: 'PUT',
        body,
      })
      if (!updateRes.ok) throw new Error(updateRes.error || t('cashCount.saved.failedUpdate'))
    } else {
      const createRes = await apiFetch<{ ok: boolean, error?: string }>('/api/cash_counts/create', {
        method: 'POST',
        body,
      })
      if (!createRes.ok) throw new Error(createRes.error || t('cashCount.saved.failedCreate'))
    }

    toast.success(isEditMode.value ? t('cashCount.saved.updated') : t('cashCount.saved.created'))
    goToReturnTarget()
  } catch (err: any) {
    toast.error(err?.message || t('cashCount.saved.failedSave'))
  } finally {
    isSaving.value = false
  }
}

function cancel() {
  goToReturnTarget()
}
</script>
