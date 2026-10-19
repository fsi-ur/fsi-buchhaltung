<template>
  <PageFinancesEditorLayout
    :headline1="t('bankStatement.title')"
    :can-view-files="canViewFiles"
    :model-value="file"
    :existing-file="existingFile"
    :can-edit="canEdit"
    @open-menu="$emit('openMenu')"
    @update:model-value="file = $event"
    @remove-existing="onRemoveFile"
  >
    <div v-if="isEditMode && bankStatementId" class="mb-3 flex justify-end">
      <PageAuditHistoryButton table="bank_statements" :record-id="bankStatementId" />
    </div>

    <BankStatementForm
      v-model="form"
      :has-file="!!file || (!!existingFile && !removeExistingFile)"
      :file="file"
      :remove-existing-file="removeExistingFile"
      :disabled="!canEdit"
      :saving="isSaving"
      :opening-balance="openingBalance"
      :can-create-receipt="canCreateReceipt"
      :can-create-invoice="canCreateInvoice"
      :can-edit-receipt="canEditReceipt"
      :can-edit-invoice="canEditInvoice"
      @submit="submit"
      @cancel="cancel"
    />
  </PageFinancesEditorLayout>
</template>

<script setup lang="ts">
import { useI18n } from '~/composables/useI18n'
import { useToast } from '~/composables/useToast'
import { useReturnTarget } from '~/composables/useReturnTarget'
import { usePage } from '~/composables/usePage'
import { useAuth } from '~/composables/useAuth'
import BankStatementForm from './Form.vue'
import type { CreateBankStatementBody } from '~/types/bankStatement'
import type { GetBankStatementResponse } from '~/server/api/bank_statements/[id].get'
const { nowLocal } = useAppTimeZone()

defineEmits<{
  (e: 'openMenu'): void
}>()

const { pageMeta } = usePage()
const { t } = useI18n()
const toast = useToast()
const { hasPermission } = useAuth()
const { goToReturnTarget } = useReturnTarget('BankStatementList')

const canEdit = computed(() => !pageMeta.value?.forceReadonly && hasPermission('bank_statements.edit'))
const canViewFiles = computed(() => hasPermission('files.view') && (canEdit.value || existingFile.value !== null))
const canCreateReceipt = computed(() => hasPermission('receipts.edit'))
const canCreateInvoice = computed(() => hasPermission('invoices.edit'))
const canEditReceipt = computed(() => hasPermission('receipts.edit'))
const canEditInvoice = computed(() => hasPermission('invoices.edit'))

const isEditMode = ref(false)
const bankStatementId = ref<number | null>(null)
const file = ref<File | null>(null)
const existingFile = ref<{ id: number, url: string, name: string, mime_type: string, size: number } | null>(null)
const removeExistingFile = ref(false)
const isSaving = ref(false)
const openingBalance = ref(0)

const form = ref<CreateBankStatementBody>({
  statement_number: '',
  checked_by: 0,
  statement_date: nowLocal().slice(0, 16),
  positions: [{ position_type: 'receipt', position_date: '', receipt_id: null, invoice_id: null, event_id: null, amount: 0, notes: null }],
})

function applyDraft(draft: Partial<CreateBankStatementBody>) {
  form.value = {
    statement_number: draft.statement_number || '',
    checked_by: Number(draft.checked_by || 0),
    statement_date: draft.statement_date || nowLocal().slice(0, 16),
    positions: Array.isArray(draft.positions) ? draft.positions.map(p => ({
      id: p.id,
      position_type: p.position_type,
      position_date: p.position_date || '',
      receipt_id: p.receipt_id ?? null,
      invoice_id: p.invoice_id ?? null,
      event_id: p.event_id ?? null,
      amount: Number(p.amount || 0),
      notes: p.notes ?? null,
    })) : [],
  }
}

function mergeNewEntity(type: 'receipt' | 'invoice', entityId: number, positionIndex: number) {
  const position = form.value.positions[positionIndex]
  if (!position) return
  if (type === 'receipt') {
    position.position_type = 'receipt'
    position.receipt_id = entityId
    position.invoice_id = null
    position.event_id = null
  } else {
    position.position_type = 'invoice'
    position.invoice_id = entityId
    position.receipt_id = null
    position.event_id = null
  }
}

onMounted(async () => {
  bankStatementId.value = pageMeta.value?.bankStatementId || null

  if (pageMeta.value?.bankStatementDraft) {
    applyDraft(pageMeta.value.bankStatementDraft as Partial<CreateBankStatementBody>)

    if (pageMeta.value?.bankStatementFile instanceof File) file.value = pageMeta.value.bankStatementFile
    if (pageMeta.value?.bankStatementRemoveExistingFile) removeExistingFile.value = true

    if (bankStatementId.value) {
      isEditMode.value = true
      const res = await apiFetch<GetBankStatementResponse>(String(`/api/bank_statements/${bankStatementId.value}`), { method: 'GET' })
      if (res.ok) {
        openingBalance.value = res.bankStatement.opening_balance
        if (res.file && !removeExistingFile.value) {
          existingFile.value = {
            id: res.file.id,
            url: `/api/files/${res.file.id}`,
            name: res.file.original_name,
            mime_type: res.file.mime_type,
            size: res.file.file_size,
          }
        }
      }
    } else {
      const balanceRes = await apiFetch<ApiResponse<'/api/bank_statements/current-balance'>>('/api/bank_statements/current-balance', { method: 'GET' })
      if (balanceRes.ok) openingBalance.value = balanceRes.balance
    }

    const positionIndex = Number(pageMeta.value?.bankStatementPositionIndex ?? -1)
    const newReceiptId = pageMeta.value?.newReceiptId ? Number(pageMeta.value.newReceiptId) : null
    const newInvoiceId = pageMeta.value?.newInvoiceId ? Number(pageMeta.value.newInvoiceId) : null

    if (positionIndex >= 0 && (newReceiptId || newInvoiceId)) {
      const optionsRes = await apiFetch<ApiResponse<'/api/bank_statements/options'>>('/api/bank_statements/options', {
        method: 'GET',
        query: bankStatementId.value ? { currentStatementId: bankStatementId.value } : undefined,
      })

      if (newReceiptId) {
        mergeNewEntity('receipt', newReceiptId, positionIndex)
        if (optionsRes.ok) {
          const r = optionsRes.receipts.find(x => x.id === newReceiptId)
          const pos = form.value.positions[positionIndex]
          if (r && pos) pos.position_date = String(r.receipt_date).slice(0, 10)
        }
      } else if (newInvoiceId) {
        mergeNewEntity('invoice', newInvoiceId, positionIndex)
        if (optionsRes.ok) {
          const inv = optionsRes.invoices.find(x => x.id === newInvoiceId)
          const pos = form.value.positions[positionIndex]
          if (inv && pos) pos.position_date = String(inv.invoice_date).slice(0, 10)
        }
      }
    }
    return
  }

  if (bankStatementId.value) {
    isEditMode.value = true

    const res = await apiFetch<GetBankStatementResponse>(String(`/api/bank_statements/${bankStatementId.value}`), { method: 'GET' })

    if (!res.ok) {
      isEditMode.value = false
      return
    }

    form.value = {
      statement_number: res.bankStatement.statement_number,
      checked_by: res.bankStatement.checked_by,
      statement_date: res.bankStatement.statement_date,
      positions: res.positions.map(p => ({
        id: p.id,
        position_type: p.position_type,
        position_date: p.position_date,
        receipt_id: p.receipt_id,
        invoice_id: p.invoice_id,
        event_id: p.event_id,
        amount: p.amount,
        notes: p.notes,
      })),
    }

    openingBalance.value = res.bankStatement.opening_balance

    if (res.file) {
      existingFile.value = {
        id: res.file.id,
        url: `/api/files/${res.file.id}`,
        name: res.file.original_name,
        mime_type: res.file.mime_type,
        size: res.file.file_size,
      }
    }
  } else {
    const balanceRes = await apiFetch<ApiResponse<'/api/bank_statements/current-balance'>>('/api/bank_statements/current-balance', { method: 'GET' })
    if (balanceRes.ok) openingBalance.value = balanceRes.balance
  }
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

  const body = new FormData()
  if (file.value) body.append('file', file.value)
  body.append('bankStatement', JSON.stringify(form.value))

  try {
    isSaving.value = true

    if (isEditMode.value && bankStatementId.value) {
      body.append('removeExistingFile', String(removeExistingFile.value))
      const res = await apiFetch<{ ok: boolean, error?: string }>(String(`/api/bank_statements/${bankStatementId.value}`), {
        method: 'PUT',
        body,
      })
      if (!res.ok) throw new Error(res.error || t('bankStatement.saved.failedUpdate'))
    } else {
      const res = await apiFetch<{ ok: boolean, error?: string }>('/api/bank_statements/create', {
        method: 'POST',
        body,
      })
      if (!res.ok) throw new Error(res.error || t('bankStatement.saved.failedCreate'))
    }

    toast.success(isEditMode.value ? t('bankStatement.saved.updated') : t('bankStatement.saved.created'))
    goToReturnTarget()
  } catch (err: any) {
    toast.error(err?.message || t('bankStatement.saved.failedSave'))
  } finally {
    isSaving.value = false
  }
}

function cancel() {
  goToReturnTarget()
}
</script>
