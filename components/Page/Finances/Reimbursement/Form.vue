<template>
  <div class="space-y-6">
    <section class="-mx-6 bg-white shadow-sm sm:mx-0 sm:rounded-xl sm:shadow-lg p-4 space-y-4">
      <h2 class="text-lg font-semibold">{{ t('reimbursement.data') }}</h2>

      <div class="grid grid-cols-2 gap-4">
        <div>
          <label class="text-sm font-medium text-base-600">{{ t('reimbursement.paidBy') }}</label>
          <CommonSearchSelect
            v-model="paidByQuery"
            :options="memberOptions"
            :selected-label="selectedMemberLabel(form.paid_by)"
            :placeholder="t('reimbursement.memberSearch')"
            :empty-text="t('reimbursement.noMatchingMembers')"
            :disabled="disabled"
            @select="onPaidBySelect"
            @clear-selection="form.paid_by = 0"
          />
        </div>

        <div>
          <label class="text-sm font-medium text-base-600">{{ t('reimbursement.submittedAt') }}</label>
          <CommonDateInput v-model="submittedAtDate" :disabled="disabled" />
        </div>
      </div>

      <div class="flex items-center justify-between">
        <h3 class="font-medium">{{ t('reimbursement.bankDetails') }}</h3>
        <label class="inline-flex items-center gap-2 text-sm text-base-700 cursor-pointer">
          <input v-model="form.cash" type="checkbox" class="checkbox" :disabled="disabled">
          {{ t('reimbursement.cash') }}
        </label>
      </div>

      <div class="grid grid-cols-2 gap-4 transition-opacity" :class="form.cash ? 'opacity-50' : 'opacity-100'">
        <div>
          <label class="text-sm font-medium text-base-600">{{ t('reimbursement.bankname') }}</label>
          <input v-model="form.bankname" class="input" :disabled="disabled || form.cash">
        </div>

        <div>
          <label class="text-sm font-medium text-base-600">{{ t('reimbursement.accountHolder') }}</label>
          <input v-model="form.account_holder" class="input" :disabled="disabled || form.cash">
        </div>

        <div>
          <label class="text-sm font-medium text-base-600">{{ t('reimbursement.iban') }}</label>
          <input v-model="form.iban" class="input" :disabled="disabled || form.cash">
        </div>

        <div>
          <label class="text-sm font-medium text-base-600">{{ t('reimbursement.bic') }}</label>
          <input v-model="form.bic" class="input" :disabled="disabled || form.cash">
        </div>
      </div>
    </section>

    <section class="-mx-6 bg-white shadow-sm sm:mx-0 sm:rounded-xl sm:shadow-lg p-4 space-y-3">
      <div class="flex items-center justify-between">
        <h3 class="font-semibold">{{ t('reimbursement.receiptsInReimbursement') }}</h3>
        <button v-if="!disabled && canCreateReceipt" type="button" class="btn-primary" @click="createNewReceipt">
          ＋ {{ t('reimbursement.createReceipt') }}
        </button>
      </div>

      <div
        v-for="(position, i) in form.positions"
        :key="i"
        class="grid gap-2 items-center"
        :class="form.positions.length > 1 ? 'grid-cols-[3fr_1fr_auto]' : 'grid-cols-[3fr_1fr]'"
      >
        <CommonSearchSelect
          v-model="receiptQueries[i]"
          :options="receiptOptions"
          :selected-label="selectedReceiptLabel(i)"
          :placeholder="t('reimbursement.receiptPlaceholder')"
          :empty-text="t('reimbursement.noMatchingReceipts')"
          :disabled="disabled"
          menu-width="wide"
          option-class="overflow-hidden text-ellipsis"
          @select="selectReceiptFromOption(i, $event)"
          @clear-selection="clearReceipt(i)"
        >
          <template #after-trigger>
            <button
              v-if="canEditSelectedReceipt(i)"
              type="button"
              class="p-2 h-10 w-10 rounded-md hover:bg-base-100 text-accent-500 cursor-pointer"
              :title="t('actions.edit')"
              @click.stop.prevent="editSelectedReceipt(i)"
            >
              <Icon name="material-symbols:edit-square-outline-rounded" class="text-xl" />
            </button>
          </template>
        </CommonSearchSelect>

        <div class="text-right text-sm text-base-600">
          {{ selectedReceiptAmount(i) }}
        </div>

        <button
          v-if="!disabled && form.positions.length > 1"
          type="button"
          class="text-danger-500 cursor-pointer p-2 w-10 rounded-md hover:bg-base-100"
          @click="removePosition(i)"
        >
          ✕
        </button>
      </div>

      <div class="flex pt-2 items-start gap-6" :class="disabled ? 'justify-end' : 'justify-between'">
        <button
          v-if="!disabled"
          type="button"
          class="flex items-center gap-2 text-accent-500 font-medium cursor-pointer"
          @click="addPosition"
        >
          <span class="text-xl">+</span> {{ t('actions.addPosition') }}
        </button>

        <div class="text-sm text-right space-y-1 pt-2 min-w-55 w-72">
          <div class="flex items-center justify-between gap-3">
            <span class="text-base-600">{{ t('reimbursement.advance') }}</span>
            <input
              type="text"
              class="input text-right w-42"
              :value="displayAdvance"
              inputmode="decimal"
              :disabled="disabled"
              @focus="onAdvanceFocus"
              @blur="onAdvanceBlur"
              @input="onAdvanceInput"
            >
          </div>
          <div class="flex justify-between text-base-500">
            <span>{{ t('reimbursement.receiptsTotal') }}</span>
            <span>{{ formatCurrency(receiptsTotal) }}</span>
          </div>
          <div class="flex justify-between text-base-500">
            <span>{{ t('reimbursement.advance') }}</span>
            <span>- {{ formatCurrency(Number(form.advance || 0)) }}</span>
          </div>
          <div class="flex justify-between font-semibold text-lg border-t pt-1">
            <span>{{ t('reimbursement.payout') }}</span>
            <span>{{ formatCurrency(payoutTotal) }}</span>
          </div>
        </div>
      </div>
    </section>

    <section class="-mx-6 bg-white shadow-sm sm:mx-0 sm:rounded-xl sm:shadow-lg p-4 space-y-4">
      <h2 class="text-lg font-semibold">{{ t('reimbursement.reviewAndPayout') }}</h2>

      <div class="grid grid-cols-2 gap-4">
        <div>
          <label class="text-sm font-medium text-base-600">{{ t('reimbursement.checkedBy') }}</label>
          <CommonSearchSelect
            v-model="checkedByQuery"
            :options="memberOptions"
            :selected-label="selectedMemberLabel(form.checked_by)"
            :placeholder="t('reimbursement.memberSearch')"
            :empty-text="t('reimbursement.noMatchingMembers')"
            :disabled="disabled"
            @select="onCheckedBySelect"
            @clear-selection="form.checked_by = null"
          />
        </div>

        <div>
          <label class="text-sm font-medium text-base-600">{{ t('reimbursement.checkedAt') }}</label>
          <CommonDateInput v-model="checkedAtDate" :disabled="disabled" :empty-value="null" />
        </div>

        <div>
          <label class="text-sm font-medium text-base-600">{{ t('reimbursement.disbursedBy') }}</label>
          <CommonSearchSelect
            v-model="disbursedByQuery"
            :options="memberOptions"
            :selected-label="selectedMemberLabel(form.disbursed_by)"
            :placeholder="t('reimbursement.memberSearch')"
            :empty-text="t('reimbursement.noMatchingMembers')"
            :disabled="disabled"
            @select="onDisbursedBySelect"
            @clear-selection="form.disbursed_by = null"
          />
        </div>

        <div>
          <label class="text-sm font-medium text-base-600">{{ t('reimbursement.disbursedAt') }}</label>
          <CommonDateInput v-model="disbursedAtDate" :disabled="disabled" :empty-value="null" />
        </div>
      </div>
    </section>

    <CommonFormActions
      :disabled="disabled"
      :save-disabled="saveDisabled"
      :saving="Boolean(props.saving)"
      :saving-label="t('actions.saving')"
      :cancel-label="t('actions.cancel')"
      :submit-label="t('actions.save')"
      :close-label="t('actions.close')"
      @cancel="emit('cancel')"
      @submit="emit('submit')"
    />

    <CommonValidationSummary :errors="validationErrors" :title="t('common.validationBlocked')" />
  </div>
</template>

<script setup lang="ts">
import type { SearchSelectOption } from '~/components/Common/SearchSelect.vue'
import { useI18n } from '~/composables/useI18n'
import { focusAndSelectInput, sanitizeCurrencyInput } from '~/composables/useCurrencyInput'
import { useLocaleFormatters } from '~/composables/useLocaleFormatters'
import type { Receipt, ReceiptRow } from '~/types/receipt'
import type { CreateReimbursementBody } from '~/types/reimbursement'
import type { MemberListItem } from '~/types/member'
import { buildReturnTarget, useReturnTarget } from '~/composables/useReturnTarget'
import { usePage } from '~/composables/usePage'
const { today: appToday } = useAppTimeZone()

type MemberField = 'paid_by' | 'checked_by' | 'disbursed_by'

const props = defineProps<{
  modelValue: CreateReimbursementBody
  disabled?: boolean
  saving?: boolean
  hasFile?: boolean
  file?: File | null
  removeExistingFile?: boolean
  canCreateReceipt?: boolean
  canEditReceipt?: boolean
  externalValidationErrors?: string[]
}>()

const emit = defineEmits<{
  (e: 'update:modelValue', v: CreateReimbursementBody): void
  (e: 'submit'): void
  (e: 'cancel'): void
}>()

const { pageMeta } = usePage()
const { returnTarget, setPageWithReturnTarget } = useReturnTarget('ReimbursementList')
const { t } = useI18n()
const { formatCurrency, formatDate } = useLocaleFormatters()

const form = computed({
  get: () => props.modelValue,
  set: v => emit('update:modelValue', v),
})

const disabled = computed(() => Boolean(props.disabled))
const canCreateReceipt = computed(() => props.canCreateReceipt !== false)
const canEditReceipt = computed(() => props.canEditReceipt === true)

const validationErrors = computed(() => {
  const errors: string[] = []
  if (!form.value.paid_by) errors.push(t('reimbursement.required.paidBy'))
  if (!form.value.submitted_at) errors.push(t('reimbursement.required.submittedAt'))
  if (!Array.isArray(form.value.positions) || form.value.positions.length === 0) errors.push(t('reimbursement.required.oneReceipt'))
  if (form.value.positions.some(position => !position.receipt_id && !position.receipt?.id)) errors.push(t('reimbursement.required.eachReceipt'))

  const receiptIds = form.value.positions
    .map(position => Number(position.receipt_id || position.receipt?.id || 0))
    .filter(id => Boolean(id))
  if (new Set(receiptIds).size !== receiptIds.length) errors.push(t('reimbursement.required.uniqueReceipt'))

  const currentReimbursementId = Number(pageMeta.value?.reimbursementId || 0)
  const assignmentMap = new Map(receiptAssignments.value.map(assignment => [assignment.receipt_id, assignment.reimbursement_id]))
  const assignedElsewhere = receiptIds.some(receiptId => {
    const assignedReimbursementId = assignmentMap.get(receiptId)
    return Boolean(assignedReimbursementId && assignedReimbursementId !== currentReimbursementId)
  })
  if (assignedElsewhere) errors.push(t('reimbursement.required.assignedElsewhere'))

  if (!props.hasFile) errors.push(t('reimbursement.required.file'))
  if (!form.value.cash) {
    if (!form.value.bankname?.trim()) errors.push(t('reimbursement.required.bankname'))
    if (!form.value.iban?.trim()) errors.push(t('reimbursement.required.iban'))
  }

  const hasCheckedBy = Boolean(form.value.checked_by)
  const hasCheckedAt = Boolean(form.value.checked_at)
  if (hasCheckedBy !== hasCheckedAt) errors.push(t('reimbursement.required.checkedPair'))

  const hasDisbursedBy = Boolean(form.value.disbursed_by)
  const hasDisbursedAt = Boolean(form.value.disbursed_at)
  if (hasDisbursedBy !== hasDisbursedAt) errors.push(t('reimbursement.required.disbursedPair'))

  if (Array.isArray(props.externalValidationErrors)) {
    errors.push(...props.externalValidationErrors.filter(error => typeof error === 'string' && error.trim().length > 0))
  }

  return errors
})

const saveDisabled = computed(() => disabled.value || Boolean(props.saving) || validationErrors.value.length > 0)
const members = ref<MemberListItem[]>([])
const receipts = ref<ReceiptRow[]>([])
const receiptAssignments = ref<{ receipt_id: number, reimbursement_id: number }[]>([])
const paidByQuery = ref('')
const checkedByQuery = ref('')
const disbursedByQuery = ref('')
const receiptQueries = ref<Record<number, string>>({})
const advanceFocused = ref(false)

const memberOptions = computed<SearchSelectOption<MemberListItem>[]>(() => members.value.map(member => ({
  key: member.id,
  label: memberLabel(member),
  value: member,
})))
const receiptOptions = computed<SearchSelectOption<ReceiptRow>[]>(() => receipts.value.map(receipt => ({
  key: receipt.id,
  label: receiptLabel(receipt),
  value: receipt,
  searchText: [receipt.id, receipt.receipt_number, receipt.company_name, receipt.description, receipt.receipt_date].filter(Boolean).join(' '),
})))

const submittedAtDate = computed({
  get: () => form.value.submitted_at,
  set: (v: string | null) => {
    form.value.submitted_at = v || ''
  },
})

const checkedAtDate = computed({
  get: () => form.value.checked_at,
  set: (v: string | null) => {
    form.value.checked_at = v || null
  },
})

const disbursedAtDate = computed({
  get: () => form.value.disbursed_at,
  set: (v: string | null) => {
    form.value.disbursed_at = v || null
  },
})

async function loadMembers() {
  const res = await $fetch('/api/members', { method: 'GET' })
  if (res.ok) members.value = res.members
}

async function loadReceipts() {
  const res = await $fetch('/api/receipts', { method: 'GET' })
  if (res.ok) receipts.value = res.receipts
}

async function loadReceiptAssignments() {
  const res = await $fetch('/api/reimbursements/receipt_assignments', { method: 'GET' })
  if (res.ok) receiptAssignments.value = res.assignments
}

async function loadSupportData() {
  await Promise.all([loadMembers(), loadReceipts(), loadReceiptAssignments()])
}

function memberLabel(member: MemberListItem) {
  return `${member.first_name} ${member.last_name}`
}

function selectedMemberLabel(memberId: number | null) {
  const member = members.value.find(m => m.id === memberId)
  return member ? memberLabel(member) : ''
}

function selectMember(field: MemberField, member: MemberListItem) {
  if (field === 'paid_by') {
    form.value.paid_by = member.id
    paidByQuery.value = memberLabel(member)
    return
  }
  if (field === 'checked_by') {
    form.value.checked_by = member.id
    checkedByQuery.value = memberLabel(member)
    return
  }
  form.value.disbursed_by = member.id
  disbursedByQuery.value = memberLabel(member)
}

function onPaidBySelect(value: unknown) {
  selectMember('paid_by', value as MemberListItem)
}

function onCheckedBySelect(value: unknown) {
  selectMember('checked_by', value as MemberListItem)
}

function onDisbursedBySelect(value: unknown) {
  selectMember('disbursed_by', value as MemberListItem)
}

function receiptLabel(receipt: Pick<ReceiptRow, 'receipt_date' | 'receipt_number' | 'company_name' | 'total_amount'>) {
  const number = receipt.receipt_number || t('receipt.noNumber')
  const company = receipt.company_name || t('receipt.noCompany')
  return `${formatDate(receipt.receipt_date)} - ${number} - ${company} (${formatCurrency(receipt.total_amount)})`
}

function selectReceipt(index: number, receipt: ReceiptRow) {
  const position = form.value.positions[index]
  if (!position) return

  position.receipt_id = receipt.id
  position.receipt = {
    id: receipt.id,
    receipt_date: receipt.receipt_date,
    receipt_number: receipt.receipt_number,
    description: receipt.description,
    company_id: receipt.company_id,
    company_name: receipt.company_name,
    status: receipt.status,
    has_file: receipt.has_file,
    positions: [],
  } as Receipt

  receiptQueries.value[index] = receiptLabel(receipt)
}

function selectReceiptFromOption(index: number, value: unknown) {
  selectReceipt(index, value as ReceiptRow)
}

function clearReceipt(index: number) {
  const position = form.value.positions[index]
  if (!position) return
  position.receipt_id = 0
  if ('receipt' in position) delete position.receipt
  receiptQueries.value[index] = ''
}

function selectedReceipt(index: number) {
  const position = form.value.positions[index]
  if (!position) return null
  const listed = receipts.value.find(receipt => receipt.id === position.receipt_id)
  if (listed) return listed
  const embedded = position.receipt
  if (!embedded) return null
  return {
    id: embedded.id,
    receipt_date: embedded.receipt_date,
    receipt_number: embedded.receipt_number,
    company_name: embedded.company_name,
    company_id: embedded.company_id,
    description: embedded.description,
    status: embedded.status,
    has_file: Boolean(embedded.has_file),
    total_amount: embedded.positions.reduce((sum, p) => sum + Number(p.amount || 0), 0),
  } as ReceiptRow
}

function selectedReceiptLabel(index: number) {
  const receipt = selectedReceipt(index)
  return receipt ? receiptLabel(receipt) : ''
}

function selectedReceiptAmount(index: number) {
  const receipt = selectedReceipt(index)
  if (!receipt) return '---'
  return formatCurrency(Number(receipt.total_amount || 0))
}

function addPosition() {
  form.value.positions.push({ receipt_id: 0 })
}

function removePosition(index: number) {
  form.value.positions.splice(index, 1)
  delete receiptQueries.value[index]
}

function onAdvanceFocus(event: FocusEvent) {
  advanceFocused.value = true
  focusAndSelectInput(event)
}

function onAdvanceInput(event: Event) {
  const value = sanitizeCurrencyInput((event.target as HTMLInputElement).value)
  const parsed = parseFloat(value)
  form.value.advance = Number.isNaN(parsed) ? 0 : parsed
  ;(event.target as HTMLInputElement).value = value
}

function onAdvanceBlur() {
  advanceFocused.value = false
  const value = form.value.advance
  form.value.advance = Number((value || 0).toFixed(2))
}

const displayAdvance = computed(() => {
  const value = form.value.advance ?? 0
  if (advanceFocused.value) return String(value)
  return formatCurrency(value)
})

function buildDraftMeta() {
  return JSON.parse(JSON.stringify(form.value))
}

function buildReceiptReturnMeta() {
  const nestedReturnTargetMeta: Record<string, any> = {
    reimbursementDraft: buildDraftMeta(),
  }
  if (pageMeta.value?.reimbursementId) nestedReturnTargetMeta.reimbursementId = pageMeta.value.reimbursementId
  if (props.file) nestedReturnTargetMeta.reimbursementFile = props.file
  if (props.removeExistingFile) nestedReturnTargetMeta.reimbursementRemoveExistingFile = true
  nestedReturnTargetMeta.returnTarget = returnTarget.value

  return nestedReturnTargetMeta
}

function createNewReceipt() {
  const nestedReturnTargetMeta = buildReceiptReturnMeta()

  setPageWithReturnTarget(
    'ReceiptCreate',
    undefined,
    buildReturnTarget('ReimbursementCreate', nestedReturnTargetMeta),
  )
}

function canEditSelectedReceipt(index: number) {
  return canEditReceipt.value && Boolean(selectedReceipt(index))
}

function editSelectedReceipt(index: number) {
  const receipt = selectedReceipt(index)
  if (!receipt) return

  const nestedReturnTargetMeta = buildReceiptReturnMeta()
  setPageWithReturnTarget(
    'ReceiptCreate',
    { receiptId: receipt.id },
    buildReturnTarget('ReimbursementCreate', nestedReturnTargetMeta),
  )
}

const receiptsTotal = computed(() => form.value.positions.reduce((sum, _, index) => {
  const receipt = selectedReceipt(index)
  return sum + Number(receipt?.total_amount || 0)
}, 0))

const payoutTotal = computed(() => receiptsTotal.value - Number(form.value.advance || 0))

watch([members, () => form.value.paid_by, () => form.value.checked_by, () => form.value.disbursed_by], () => {
  paidByQuery.value = selectedMemberLabel(form.value.paid_by)
  checkedByQuery.value = selectedMemberLabel(form.value.checked_by)
  disbursedByQuery.value = selectedMemberLabel(form.value.disbursed_by)
}, { immediate: true })

watch([receipts, () => form.value.positions], () => {
  form.value.positions.forEach((_, index) => {
    receiptQueries.value[index] = selectedReceiptLabel(index)
  })
}, { immediate: true, deep: true })

onMounted(() => {
  if (!form.value.submitted_at) form.value.submitted_at = appToday()
  if (!form.value.positions.length) form.value.positions.push({ receipt_id: 0 })
  loadSupportData()
})

useAppRefresh().onRefresh(loadSupportData)
</script>
