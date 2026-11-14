<template>
  <PageFinancesEditorLayout
    :headline1="t('reimbursement.title')"
    :can-view-files="canViewFiles"
    :model-value="file"
    :existing-file="existingFile"
    :can-edit="canEdit"
    @open-menu="$emit('openMenu')"
    @update:model-value="file = $event"
    @remove-existing="onRemoveFile"
  >
    <div v-if="isEditMode && reimbursementId" class="mb-3 flex justify-end">
      <PageAuditHistoryButton table="reimbursements" :record-id="reimbursementId" />
    </div>

    <PageFinancesRecordLockBanner
      v-if="recordLocked && !pageMeta?.forceReadonly && hasPermission('reimbursements.edit')"
      v-model="unlocked"
      :can-unlock="hasPermission('reimbursements.unlock')"
    />

    <ReimbursementForm
      v-model="form"
      :has-file="!!file || (!!existingFile && !removeExistingFile)"
      :file="file"
      :remove-existing-file="removeExistingFile"
      :record-unlocked="recordLocked && unlocked"
      :disabled="!canEdit"
      :can-create-receipt="canCreateReceipt"
      :can-edit-receipt="canEditReceipt"
      :can-view-receipt="canViewReceipt"
      :external-validation-errors="externalValidationErrors"
      :bank-confirmation="bankConfirmation"
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
import ReimbursementForm from './Form.vue'
import { usePage } from '~/composables/usePage'
import type { CreateReimbursementBody, ReimbursementBankConfirmation } from '~/types/reimbursement'
import type { GetReimbursementResponse } from '~/server/api/reimbursements/[id].get'
import { useAuth } from '~/composables/useAuth'
import type { ReceiptRow } from '~/types/receipt'

const emit = defineEmits<{
  (e: 'openMenu'): void
}>()

const { pageMeta } = usePage()
const { t } = useI18n()
const toast = useToast()
const { hasPermission } = useAuth()
const { goToReturnTarget } = useReturnTarget('ReimbursementList')

// Booked records are read-only until an unlock holder deliberately unlocks them (SEC-22).
const recordLocked = ref(false)
const unlocked = ref(false)
const lockedForUser = computed(() => recordLocked.value && !(unlocked.value && hasPermission('reimbursements.unlock')))
const canEdit = computed(() => !pageMeta.value?.forceReadonly && hasPermission('reimbursements.edit') && !lockedForUser.value)
const canCreateReceipt = computed(() => hasPermission('receipts.edit'))
// Linked receipts are only editable from here while the reimbursement itself is editable (SEC-16).
const canEditReceipt = computed(() => canEdit.value && hasPermission('receipts.edit'))
const canViewReceipt = computed(() => hasPermission('receipts.view'))
const canViewFiles = computed(() => hasPermission(['files.view', 'reimbursements.view']) && (canEdit.value || existingFile.value !== null))

const isEditMode = ref(false)
const reimbursementId = ref<number | null>(null)
const file = ref<File | null>(null)
const existingFile = ref<{ id: number, url: string, name: string, mime_type: string, size: number } | null>(null)
const removeExistingFile = ref(false)
const receipts = ref<ReceiptRow[]>([])
const isSaving = ref(false)

/** Set once a bank statement confirmed the payout — shown read-only in the form. */
const bankConfirmation = ref<ReimbursementBankConfirmation | null>(null)

const form = ref<CreateReimbursementBody>({
  paid_by: 0,
  bankname: null,
  account_holder: null,
  iban: null,
  bic: null,
  advance: 0,
  cash: true,
  submitted_at: '',
  checked_at: null,
  checked_by: null,
  disbursed_at: null,
  disbursed_by: null,
  paid_from_account_id: null,
  positions: [],
})

const receiptFileStateById = computed(() => new Map(
  receipts.value.map(receipt => [receipt.id, Boolean(receipt.has_file)]),
))

const reimbursementReceiptsMissingFiles = computed(() => {
  const missingIds = new Set<number>()

  for (const position of form.value.positions) {
    const receiptId = Number(position.receipt_id || position.receipt?.id || 0)
    if (!receiptId) continue

    const hasFileFromEmbedded = position.receipt?.has_file
    const hasFile = typeof hasFileFromEmbedded === 'boolean'
      ? hasFileFromEmbedded
      : receiptFileStateById.value.get(receiptId)

    if (!hasFile) missingIds.add(receiptId)
  }

  return Array.from(missingIds)
})

const externalValidationErrors = computed(() => {
  const errors: string[] = []
  if (reimbursementReceiptsMissingFiles.value.length) errors.push(t('reimbursement.required.receiptFile'))
  return errors
})

function mergeNewReceiptIntoForm(newReceiptId: number) {
  const alreadyPresent = form.value.positions.some(position =>
    (position.receipt_id || position.receipt?.id) === newReceiptId,
  )
  if (!alreadyPresent) form.value.positions.push({ receipt_id: newReceiptId })
}

function applyDraft(draft: Partial<CreateReimbursementBody>) {
  form.value = {
    paid_by: Number(draft.paid_by || 0),
    bankname: draft.bankname ?? null,
    account_holder: draft.account_holder ?? null,
    iban: draft.iban ?? null,
    bic: draft.bic ?? null,
    advance: Number(draft.advance || 0),
    cash: draft.cash ?? true,
    submitted_at: draft.submitted_at || '',
    checked_at: draft.checked_at ?? null,
    checked_by: draft.checked_by ?? null,
    disbursed_at: draft.disbursed_at ?? null,
    disbursed_by: draft.disbursed_by ?? null,
    paid_from_account_id: draft.paid_from_account_id ?? null,
    positions: Array.isArray(draft.positions) ? draft.positions.map(position => ({
      receipt_id: Number(position.receipt_id || position.receipt?.id || 0),
      receipt: position.receipt,
    })) : [],
  }
}

onMounted(async () => {
  await loadReceipts()

  reimbursementId.value = pageMeta.value?.reimbursementId || null

  if (pageMeta.value?.reimbursementDraft) {
    applyDraft(pageMeta.value.reimbursementDraft as Partial<CreateReimbursementBody>)

    if (pageMeta.value?.reimbursementFile instanceof File) file.value = pageMeta.value.reimbursementFile
    if (pageMeta.value?.reimbursementRemoveExistingFile) removeExistingFile.value = true

    if (reimbursementId.value) {
      isEditMode.value = true
      const res = await apiFetch<GetReimbursementResponse>(`/api/reimbursements/${reimbursementId.value}`, { method: 'GET' })
      if (res.ok) {
        recordLocked.value = Boolean(res.locked)
        unlocked.value = pageMeta.value?.recordUnlocked === true
        bankConfirmation.value = res.reimbursement.bank_confirmation ?? null
      }
      if (res.ok && res.file && !removeExistingFile.value) {
        existingFile.value = {
          id: res.file.id,
          url: `/api/files/${res.file.id}`,
          name: res.file.original_name,
          mime_type: res.file.mime_type,
          size: res.file.file_size,
        }
      }
    }

    if (pageMeta.value?.newReceiptId) mergeNewReceiptIntoForm(Number(pageMeta.value.newReceiptId))
    return
  }

  if (!reimbursementId.value) {
    if (pageMeta.value?.newReceiptId) mergeNewReceiptIntoForm(Number(pageMeta.value.newReceiptId))
    return
  }

  isEditMode.value = true

  const res = await apiFetch<GetReimbursementResponse>(`/api/reimbursements/${reimbursementId.value}`, { method: 'GET' })

  if (!res.ok) {
    isEditMode.value = false
    return
  }

  recordLocked.value = Boolean(res.locked)
  bankConfirmation.value = res.reimbursement.bank_confirmation ?? null
  const { bank_confirmation: _confirmation, ...reimbursement } = res.reimbursement
  form.value = {
    ...reimbursement,
    positions: res.reimbursement.positions.map(position => ({
      receipt_id: position.receipt.id,
      receipt: position.receipt,
    })),
  }

  if (pageMeta.value?.newReceiptId) mergeNewReceiptIntoForm(Number(pageMeta.value.newReceiptId))

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

useAppRefresh().onRefresh(loadReceipts)

async function loadReceipts() {
  const receiptsRes = await apiFetch<ApiResponse<'/api/receipts'>>('/api/receipts', { method: 'GET' })
  if (receiptsRes.ok) receipts.value = receiptsRes.receipts
}

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
  if (reimbursementReceiptsMissingFiles.value.length) {
    toast.error(t('reimbursement.required.receiptFile'))
    return
  }
  if (!form.value.paid_by) {
    toast.error(t('reimbursement.required.selectPaidBy'))
    return
  }
  if (!form.value.submitted_at) {
    toast.error(t('reimbursement.required.enterSubmittedDate'))
    return
  }
  if (!form.value.positions.length) {
    toast.error(t('reimbursement.required.addReceipt'))
    return
  }

  const hasFile = !!file.value || (!!existingFile.value && !removeExistingFile.value)
  if (!hasFile) {
    toast.error(t('reimbursement.required.fileNeeded'))
    return
  }

  const hasCheckedPair = Boolean(form.value.checked_by) === Boolean(form.value.checked_at)
  if (!hasCheckedPair) {
    toast.error(t('reimbursement.required.checkedPair'))
    return
  }

  const hasDisbursedPair = Boolean(form.value.disbursed_by) === Boolean(form.value.disbursed_at)
  if (!hasDisbursedPair) {
    toast.error(t('reimbursement.required.disbursedPair'))
    return
  }

  if (!form.value.cash) {
    if (!form.value.bankname?.trim()) {
      toast.error(t('reimbursement.required.bankname'))
      return
    }
    if (!form.value.iban?.trim()) {
      toast.error(t('reimbursement.required.iban'))
      return
    }
  }

  const body = new FormData()
  if (file.value) body.append('file', file.value)

  if (form.value.positions.some(position => !position.receipt_id && !position.receipt?.id)) {
    toast.error(t('reimbursement.required.receiptId'))
    return
  }

  const payload: CreateReimbursementBody = {
    ...form.value,
    positions: form.value.positions.map(position => ({
      receipt_id: position.receipt_id || position.receipt!.id,
    })),
  }

  body.append('reimbursement', JSON.stringify(payload))

  try {
    isSaving.value = true
    if (isEditMode.value) {
      body.append('removeExistingFile', String(removeExistingFile.value))
      if (recordLocked.value && unlocked.value) body.append('unlock', 'true')
      const updateRes = await apiFetch<{ ok: boolean, error?: string }>(`/api/reimbursements/${reimbursementId.value}`, {
        method: 'PUT',
        body,
      })
      if (!updateRes.ok) throw new Error(updateRes.error || t('reimbursement.saved.failedUpdate'))
    } else {
      const createRes = await apiFetch<{ ok: boolean, error?: string }>('/api/reimbursements/create', {
        method: 'POST',
        body,
      })
      if (!createRes.ok) throw new Error(createRes.error || t('reimbursement.saved.failedCreate'))
    }

    toast.success(isEditMode.value ? t('reimbursement.saved.updated') : t('reimbursement.saved.created'))
    goToReturnTarget()
  } catch (err: any) {
    toast.error(err?.message || t('reimbursement.saved.failedSave'))
  } finally {
    isSaving.value = false
  }
}

function cancel() {
  goToReturnTarget()
}
</script>
