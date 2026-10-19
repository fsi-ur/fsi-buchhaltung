<template>
  <PageFinancesEditorLayout
    :headline1="t('receipt.title')"
    :can-view-files="canViewFiles"
    :model-value="file"
    :existing-file="existingFile"
    :can-edit="canEdit"
    @open-menu="$emit('openMenu')"
    @update:model-value="file = $event"
    @remove-existing="onRemoveFile"
  >
    <div v-if="isEditMode && receiptId" class="mb-3 flex justify-end">
      <PageAuditHistoryButton table="receipts" :record-id="receiptId" />
    </div>

    <ReceiptForm
      v-model="form"
      :has-file="!!file || (!!existingFile && !removeExistingFile)"
      :disabled="!canEdit"
      :status-disabled="statusLocked"
      :can-edit-company="canEditCompany"
      :external-validation-errors="externalValidationErrors"
      :saving="isSaving"
      @submit="submit"
      @cancel="cancel"
    />
  </PageFinancesEditorLayout>
</template>

<script setup lang="ts">
import { useI18n } from '~/composables/useI18n'
import { useToast } from '~/composables/useToast'
import { useReturnTarget } from '~/composables/useReturnTarget'
import ReceiptForm from './Form.vue'
import { ReceiptStatus, type CreateReceiptBody } from '~/types/receipt'
import { usePage } from '~/composables/usePage'
import type { GetReceiptResponse } from '~/server/api/receipts/[id].get'
import { useAuth } from '~/composables/useAuth'
import type { CreateReimbursementBody } from '~/types/reimbursement'

const emit = defineEmits<{
  (e: 'openMenu'): void
}>()

const { pageMeta } = usePage()
const { t } = useI18n()
const toast = useToast()
const { hasPermission } = useAuth()
const { returnTarget, goToReturnTarget } = useReturnTarget('ReceiptList')

const canEdit = computed(() => !pageMeta.value?.forceReadonly && hasPermission('receipts.edit'))
const canEditCompany = computed(() => canEdit.value && hasPermission('companies.edit'))
const canViewFiles = computed(() => hasPermission('files.view') && (canEdit.value || existingFile.value !== null))

const isEditMode = ref(false)
const receiptId = ref<number | null>(null)
const file = ref<File | null>(null)
const existingFile = ref<{ id: number, url: string, name: string, mime_type: string, size: number } | null>(null)
const removeExistingFile = ref(false)
const statusLockedFromAssociation = ref(false)
const isSaving = ref(false)

const form = ref<CreateReceiptBody>({
  receipt_date: '',
  receipt_number: null,
  description: null,
  status: ReceiptStatus.Open,
  company_id: null,
  positions: [{ sphere: 0, cost_centre: 0, amount: 0.0, tax: 19 }],
})

const reimbursementDraftContext = computed<Partial<CreateReimbursementBody> | null>(() => {
  if (returnTarget.value.page !== 'ReimbursementCreate') return null
  const draft = returnTarget.value.meta?.reimbursementDraft as Partial<CreateReimbursementBody> | undefined
  return draft ?? null
})

const statusLockedByDraft = computed(() => reimbursementDraftContext.value !== null)
const statusLocked = computed(() => statusLockedFromAssociation.value || statusLockedByDraft.value)
const fromBankStatement = computed(() => returnTarget.value.page === 'BankStatementCreate')
const hasReceiptFile = computed(() => Boolean(file.value) || (!!existingFile.value && !removeExistingFile.value))
const externalValidationErrors = computed(() => {
  const errors: string[] = []
  if (statusLocked.value && !hasReceiptFile.value) errors.push(t('receipt.required.fileForReimbursement'))
  if (fromBankStatement.value && !hasReceiptFile.value) errors.push(t('receipt.required.fileForBankStatement'))
  return errors
})

function statusFromReimbursementDraft(reimbursement: Partial<CreateReimbursementBody> | null) {
  if (reimbursement?.disbursed_at) return ReceiptStatus.Paid
  if (reimbursement?.checked_at) return ReceiptStatus.Open
  return ReceiptStatus.Draft
}

onMounted(async () => {
  receiptId.value = pageMeta.value?.receiptId
  if (!receiptId.value) {
    if (statusLockedByDraft.value) form.value.status = statusFromReimbursementDraft(reimbursementDraftContext.value)
    return
  }

  isEditMode.value = true

  const res = await apiFetch<GetReceiptResponse>(`/api/receipts/${receiptId.value}`, { method: 'GET' })

  if (!res.ok) {
    isEditMode.value = false
    return
  }

  form.value = {
    receipt_date: res.receipt.receipt_date,
    receipt_number: res.receipt.receipt_number,
    description: res.receipt.description,
    status: statusLockedByDraft.value ? statusFromReimbursementDraft(reimbursementDraftContext.value) : res.receipt.status,
    company_id: res.receipt.company_id,
    positions: res.receipt.positions,
  }
  statusLockedFromAssociation.value = Boolean(res.statusLocked)

  if (!res.file) return
  existingFile.value = {
    id: res.file.id,
    url: `/api/files/${res.file.id}`,
    name: res.file.original_name,
    mime_type: res.file.mime_type,
    size: res.file.file_size,
  }
  file.value = null
  removeExistingFile.value = false
})

function onRemoveFile() {
  existingFile.value = null
  removeExistingFile.value = true
}

async function submit() {
  if (isSaving.value) return
  if (!canEdit.value) {
    toast.error(t('common.notAuthorized'))
    return
  }
  if (statusLocked.value && !hasReceiptFile.value) {
    toast.error(t('receipt.required.fileForReimbursement'))
    return
  }
  if (fromBankStatement.value && !hasReceiptFile.value) {
    toast.error(t('receipt.required.fileForBankStatement'))
    return
  }
  if (statusLockedByDraft.value) {
    form.value.status = statusFromReimbursementDraft(reimbursementDraftContext.value)
  }
  if (!form.value.company_id) {
    toast.error(t('receipt.required.enterCompany'))
    return
  }

  if (!form.value.receipt_date) {
    toast.error(t('receipt.required.enterDate'))
    return
  }

  if (!form.value.positions.length) {
    toast.error(t('receipt.required.addPosition'))
    return
  }

  if (form.value.positions.some(p => !p.sphere || !p.cost_centre || p.amount === null || p.amount === undefined)) {
    toast.error(t('receipt.required.completePosition'))
    return
  }

  const hasFile = !!file.value || (!!existingFile.value && !removeExistingFile.value)
  const requiresFile = form.value.status === ReceiptStatus.Open || form.value.status === ReceiptStatus.Paid
  if (requiresFile && !hasFile) {
    toast.error(t('receipt.required.fileForStatus'))
    return
  }

  const body = new FormData()
  if (file.value) body.append('file', file.value)
  body.append('receipt', JSON.stringify(form.value))

  try {
    isSaving.value = true
    let createdReceiptId: number | null = null
    if (isEditMode.value) {
      body.append('removeExistingFile', String(removeExistingFile.value))
      const updateRes = await apiFetch<{ ok: boolean, error?: string }>(`/api/receipts/${receiptId.value}`, {
        method: 'PUT',
        body,
      })
      if (!updateRes.ok) throw new Error(updateRes.error || t('receipt.saved.failedUpdate'))
    } else {
      const createRes = await apiFetch<{ ok: boolean, receiptId?: number, error?: string }>('/api/receipts/create', {
        method: 'POST',
        body,
      })
      if (!createRes.ok) throw new Error(createRes.error || t('receipt.saved.failedCreate'))
      if (createRes.receiptId) createdReceiptId = createRes.receiptId
    }

    toast.success(isEditMode.value ? t('receipt.saved.updated') : t('receipt.saved.created'))
    if (createdReceiptId && (returnTarget.value.page === 'ReimbursementCreate' || returnTarget.value.page === 'BankStatementCreate')) {
      goToReturnTarget({ newReceiptId: createdReceiptId })
      return
    }

    goToReturnTarget()
  } catch (err: any) {
    toast.error(err?.message || t('receipt.saved.failedUpload'))
  } finally {
    isSaving.value = false
  }
}

function cancel() {
  goToReturnTarget()
}
</script>
