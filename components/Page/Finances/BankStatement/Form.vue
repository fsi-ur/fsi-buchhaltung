<template>
  <div class="space-y-6">
    <section class="-mx-6 bg-white shadow-sm sm:mx-0 sm:rounded-xl sm:shadow-lg p-4 space-y-4">
      <h2 class="text-lg font-semibold">{{ t('bankStatement.title') }}</h2>

      <div class="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-1 xl:grid-cols-3 gap-4">
        <div class="field">
          <label class="text-sm font-medium text-base-600">{{ t('bankStatement.statementNumber') }}</label>
          <input
            v-model="form.statement_number"
            class="input"
            :disabled="disabled"
          >
        </div>

        <div class="grid grid-cols-2 gap-4 md:contents lg:grid lg:grid-cols-2 xl:contents">
          <div class="field">
            <label class="text-sm font-medium text-base-600">{{ t('bankStatement.checkedBy') }}</label>
            <CommonSearchSelect
              v-model="checkedByQuery"
              :options="memberOptions"
              :selected-label="selectedMemberLabel(form.checked_by)"
              :placeholder="t('bankStatement.memberSearch')"
              :empty-text="t('bankStatement.noMatchingMembers')"
              :disabled="disabled"
              @select="onCheckedBySelect"
              @clear-selection="form.checked_by = 0"
            />
          </div>

          <div class="field">
            <label class="text-sm font-medium text-base-600">{{ t('bankStatement.statementDate') }}</label>
            <CommonDateInput
              v-model="statementDateInput"
              mode="datetime"
              :disabled="disabled"
            />
          </div>
        </div>
      </div>
    </section>

    <section class="-mx-6 bg-white shadow-sm sm:mx-0 sm:rounded-xl sm:shadow-lg p-4 space-y-3">
      <div class="flex items-center justify-between gap-4">
        <h3 class="font-semibold">{{ t('bankStatement.positions') }}</h3>
        <button
          v-if="!disabled"
          type="button"
          class="flex items-center gap-2 text-accent-500 font-medium cursor-pointer"
          @click="addPosition"
        >
          <span class="text-xl">+</span> {{ t('actions.addPosition') }}
        </button>
      </div>

      <div
        v-for="(position, i) in form.positions"
        :key="i"
        class="rounded-xl border border-base-200 bg-base-50 p-3"
      >
        <div
          class="grid gap-3 items-start"
          :class="form.positions.length > 1 ? 'grid-cols-[auto_1fr_5.5rem_auto] 2xl:grid-cols-[auto_3fr_5.5rem_5.5rem_2fr_auto]' : 'grid-cols-[auto_1fr_5.5rem] 2xl:grid-cols-[auto_3fr_5.5rem_5.5rem_2fr]'"
        >
          <!-- Type dropdown -->
          <div class="self-end">
            <MenuDropdown v-model="openTypeIndex" :id="i" :disabled="disabled">
              <template #trigger="{ styling }">
                <button
                  :class="[styling, !disabled ? 'cursor-pointer' : '']"
                  :disabled="disabled"
                  type="button"
                >
                  {{ t(`bankStatement.types.${position.position_type}`) }}
                  <Icon v-if="!disabled" name="material-symbols:keyboard-arrow-down-rounded" />
                </button>
              </template>
              <template #default="{ styling }">
                <button :class="styling" type="button" @click="setPositionType(i, 'receipt')">{{ t('bankStatement.types.receipt') }}</button>
                <button :class="styling" type="button" @click="setPositionType(i, 'invoice')">{{ t('bankStatement.types.invoice') }}</button>
                <button :class="styling" type="button" @click="setPositionType(i, 'event')">{{ t('bankStatement.types.event') }}</button>
              </template>
            </MenuDropdown>
          </div>

          <!-- Entity search select -->
          <div class="field min-w-0">
            <CommonSearchSelect
              v-model="entityQueries[i]"
              :options="entityOptionsFor(i)"
              :selected-label="selectedEntityLabel(i)"
              :placeholder="entityPlaceholder(position.position_type)"
              :empty-text="entityEmptyText(position.position_type)"
              :disabled="disabled"
              :allow-create="!disabled && ((position.position_type === 'receipt' && canCreateReceipt) || (position.position_type === 'invoice' && canCreateInvoice))"
              :create-action-label="position.position_type === 'receipt' ? t('bankStatement.createReceipt') : t('bankStatement.createInvoice')"
              :hide-create-query="true"
              menu-width="wide"
              option-class="overflow-hidden text-ellipsis"
              @select="selectEntity(i, $event)"
              @clear-selection="clearEntity(i)"
              @create="position.position_type === 'receipt' ? createNewReceipt(i) : createNewInvoice(i)"
            >
              <template #after-trigger>
                <button
                  v-if="!disabled && canEditSelectedReceipt(i)"
                  type="button"
                  class="p-2 h-9.5 w-9.5 rounded-md hover:bg-base-100 text-accent-500 cursor-pointer shrink-0"
                  :title="t('actions.edit')"
                  @click.stop.prevent="editSelectedReceipt(i)"
                >
                  <Icon name="material-symbols:edit-square-outline-rounded" class="text-xl" />
                </button>
                <button
                  v-if="!disabled && canEditSelectedInvoice(i)"
                  type="button"
                  class="p-2 h-9.5 w-9.5 rounded-md hover:bg-base-100 text-accent-500 cursor-pointer shrink-0"
                  :title="t('actions.edit')"
                  @click.stop.prevent="editSelectedInvoice(i)"
                >
                  <Icon name="material-symbols:edit-square-outline-rounded" class="text-xl" />
                </button>
              </template>
            </CommonSearchSelect>
          </div>

          <!-- Position date -->
          <div class="field">
            <CommonDateInput
              :model-value="position.position_date"
              :disabled="disabled"
              @update:model-value="position.position_date = $event || ''"
            />
          </div>

          <!-- Remove button -->
          <button
            v-if="form.positions.length > 1 && !disabled"
            type="button"
            class="text-danger-500 cursor-pointer flex items-center justify-center h-9.5 w-9.5 rounded-md hover:bg-white self-end 2xl:order-6"
            @click="removePosition(i)"
          >✕</button>

          <!-- Row 2: notes + amount (flex at < 2xl, dissolves into grid at 2xl) -->
          <div class="col-span-full flex items-end gap-3 2xl:contents">
            <!-- Notes -->
            <div class="field min-w-0 flex-1 2xl:order-5">
              <input
                v-model="position.notes"
                class="input"
                :disabled="disabled"
                :placeholder="t('bankStatement.notes')"
              >
            </div>
            <!-- Amount: plain text for receipt/invoice, editable input for event -->
            <div
              v-if="position.position_type !== 'event'"
              class="shrink-0 w-24 2xl:w-auto 2xl:order-4 h-9.5 flex items-center justify-end self-end text-sm text-base-600 whitespace-nowrap"
            >
              {{ position.receipt_id || position.invoice_id ? formatCurrency(positionEffectiveAmount(position)) : '---' }}
            </div>
            <div v-else class="shrink-0 w-24 2xl:w-auto field 2xl:order-4">
              <input
                type="text"
                class="input text-right"
                :value="displayAmount(i)"
                inputmode="decimal"
                :disabled="disabled"
                @focus="onAmountFocus($event, i)"
                @blur="onAmountBlur(i)"
                @input="onAmountInput($event, i)"
              >
            </div>
          </div>
        </div>
      </div>
    </section>

    <section class="-mx-6 bg-white shadow-sm sm:mx-0 sm:rounded-xl sm:shadow-lg p-4 space-y-3">
      <h3 class="font-semibold">{{ t('bankStatement.overview') }}</h3>

      <div class="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-2 xl:grid-cols-4 gap-3 text-sm">
        <div class="rounded-xl bg-base-100 px-4 py-3">
          <div class="text-base-500">{{ t('bankStatement.openingBalance') }}</div>
          <div class="text-lg font-semibold">{{ formatCurrency(props.openingBalance) }}</div>
        </div>
        <div class="rounded-xl bg-success-50 px-4 py-3">
          <div class="text-success-700">{{ t('bankStatement.totalIncome') }}</div>
          <div class="text-lg font-semibold text-success-800">{{ formatCurrency(totalIncome) }}</div>
        </div>
        <div class="rounded-xl bg-danger-50 px-4 py-3">
          <div class="text-danger-700">{{ t('bankStatement.totalExpenses') }}</div>
          <div class="text-lg font-semibold text-danger-800">{{ formatCurrency(totalExpenses) }}</div>
        </div>
        <div class="rounded-xl bg-info-50 px-4 py-3">
          <div class="text-info-700">{{ t('bankStatement.closingBalance') }}</div>
          <div class="text-lg font-semibold text-info-800">{{ formatCurrency(closingBalance) }}</div>
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
import { buildReturnTarget, useReturnTarget } from '~/composables/useReturnTarget'
import { usePage } from '~/composables/usePage'
import type { MemberListItem } from '~/types/member'
import type {
  CreateBankStatementBody,
  CreateBankStatementPositionBody,
  BankStatementPositionType,
  BankStatementReceiptOption,
  BankStatementInvoiceOption,
  BankStatementEventOption,
} from '~/types/bankStatement'

const props = defineProps<{
  modelValue: CreateBankStatementBody
  disabled?: boolean
  saving?: boolean
  openingBalance: number
  hasFile?: boolean
  file?: File | null
  removeExistingFile?: boolean
  canCreateReceipt?: boolean
  canCreateInvoice?: boolean
  canEditReceipt?: boolean
  canEditInvoice?: boolean
}>()

const emit = defineEmits<{
  (e: 'update:modelValue', v: CreateBankStatementBody): void
  (e: 'submit'): void
  (e: 'cancel'): void
}>()

const { pageMeta } = usePage()
const { returnTarget, setPageWithReturnTarget } = useReturnTarget('BankStatementList')
const { t } = useI18n()
const { formatCurrency, formatDate, formatDateTime } = useLocaleFormatters()

const form = computed({
  get: () => props.modelValue,
  set: value => emit('update:modelValue', value),
})

const disabled = computed(() => Boolean(props.disabled))
const canCreateReceipt = computed(() => props.canCreateReceipt === true)
const canCreateInvoice = computed(() => props.canCreateInvoice === true)
const canEditReceipt = computed(() => props.canEditReceipt === true)
const canEditInvoice = computed(() => props.canEditInvoice === true)

const members = ref<MemberListItem[]>([])
const receipts = ref<BankStatementReceiptOption[]>([])
const invoices = ref<BankStatementInvoiceOption[]>([])
const events = ref<BankStatementEventOption[]>([])

const checkedByQuery = ref('')
const openTypeIndex = ref<number | null>(null)
const entityQueries = ref<Record<number, string>>({})
const focusedAmountIndex = ref<number | null>(null)

const statementDateInput = computed({
  get: () => form.value.statement_date || '',
  set: (value: string | null) => { form.value.statement_date = value || '' },
})

const memberOptions = computed<SearchSelectOption<MemberListItem>[]>(() =>
  members.value.map(m => ({
    key: m.id,
    label: memberLabel(m),
    value: m,
  }))
)

function positionEffectiveAmount(position: CreateBankStatementPositionBody): number {
  if (position.position_type === 'receipt' && position.receipt_id) {
    const r = receipts.value.find(x => x.id === position.receipt_id)
    if (r) return Number((-r.total_amount).toFixed(2))
  }
  if (position.position_type === 'invoice' && position.invoice_id) {
    const inv = invoices.value.find(x => x.id === position.invoice_id)
    if (inv) return Number(inv.total_amount.toFixed(2))
  }
  if (position.position_type === 'event') return position.amount ?? 0
  return 0
}

const totalIncome = computed(() =>
  form.value.positions.reduce((sum, p) => { const a = positionEffectiveAmount(p); return a > 0 ? sum + a : sum }, 0)
)
const totalExpenses = computed(() =>
  form.value.positions.reduce((sum, p) => { const a = positionEffectiveAmount(p); return a < 0 ? sum + a : sum }, 0)
)
const closingBalance = computed(() =>
  props.openingBalance + form.value.positions.reduce((sum, p) => sum + positionEffectiveAmount(p), 0)
)

const validationErrors = computed(() => {
  const errors: string[] = []
  if (!form.value.statement_number.trim()) errors.push(t('bankStatement.required.statementNumber'))
  if (!form.value.checked_by) errors.push(t('bankStatement.required.checkedBy'))
  if (!form.value.statement_date) errors.push(t('bankStatement.required.statementDate'))
  if (!form.value.positions.length) errors.push(t('bankStatement.required.positions'))
  if (form.value.positions.some(p =>
    (p.position_type === 'receipt' && !p.receipt_id) ||
    (p.position_type === 'invoice' && !p.invoice_id) ||
    (p.position_type === 'event' && !p.event_id)
  )) errors.push(t('bankStatement.required.eachPositionEntity'))
  if (form.value.positions.some(p => !p.position_date)) {
    errors.push(t('bankStatement.required.eachPositionDate'))
  }
  if (form.value.positions.some(p => p.position_type === 'event' && !Number.isFinite(p.amount))) {
    errors.push(t('bankStatement.required.eachPositionAmount'))
  }
  if (!props.hasFile) errors.push(t('bankStatement.required.file'))
  return errors
})

const saveDisabled = computed(() => disabled.value || Boolean(props.saving) || validationErrors.value.length > 0)

function memberLabel(m: MemberListItem) {
  return `${m.first_name} ${m.last_name}`
}

function selectedMemberLabel(id: number) {
  const m = members.value.find(entry => entry.id === id)
  return m ? memberLabel(m) : ''
}

function onCheckedBySelect(value: unknown) {
  const m = value as MemberListItem
  form.value.checked_by = m.id
  checkedByQuery.value = memberLabel(m)
}

function receiptLabel(r: BankStatementReceiptOption) {
  const number = r.receipt_number || t('receipt.noNumber')
  const company = r.company_name || t('receipt.noCompany')
  return `${formatDate(r.receipt_date)} - ${number} - ${company} (${formatCurrency(-r.total_amount)})`
}

function invoiceLabel(inv: BankStatementInvoiceOption) {
  const number = inv.invoice_number || '-'
  const company = inv.company_name || t('invoice.noCompany')
  return `${formatDate(inv.invoice_date)} - ${number} - ${company} (${formatCurrency(inv.total_amount)})`
}

function entityPlaceholder(type: BankStatementPositionType) {
  if (type === 'receipt') return t('bankStatement.receiptPlaceholder')
  if (type === 'invoice') return t('bankStatement.invoicePlaceholder')
  return t('bankStatement.eventPlaceholder')
}

function entityEmptyText(type: BankStatementPositionType) {
  if (type === 'receipt') return t('bankStatement.noReceipts')
  if (type === 'invoice') return t('bankStatement.noInvoices')
  return t('bankStatement.noEvents')
}

function entityOptionsFor(index: number): SearchSelectOption<unknown>[] {
  const position = form.value.positions[index]
  if (!position) return []

  if (position.position_type === 'receipt') {
    return receipts.value.map(r => ({
      key: r.id,
      label: receiptLabel(r),
      searchText: [r.receipt_number, r.company_name].filter(Boolean).join(' '),
      value: r,
    }))
  }
  if (position.position_type === 'invoice') {
    return invoices.value.map(inv => ({
      key: inv.id,
      label: invoiceLabel(inv),
      searchText: [inv.invoice_number, inv.company_name, inv.subject].filter(Boolean).join(' '),
      value: inv,
    }))
  }
  return events.value.map(e => ({
    key: e.id,
    label: `${e.name} | ${formatDateTime(e.starts_at)}`,
    searchText: e.name,
    value: e,
  }))
}

function selectedEntityLabel(index: number) {
  if (entityQueries.value[index]) return entityQueries.value[index]

  const position = form.value.positions[index]
  if (!position) return ''
  if (position.position_type === 'receipt' && position.receipt_id) {
    const r = receipts.value.find(x => x.id === position.receipt_id)
    if (r) return receiptLabel(r)
  } else if (position.position_type === 'invoice' && position.invoice_id) {
    const inv = invoices.value.find(x => x.id === position.invoice_id)
    if (inv) return invoiceLabel(inv)
  } else if (position.position_type === 'event' && position.event_id) {
    const e = events.value.find(x => x.id === position.event_id)
    if (e) return `${e.name} | ${formatDateTime(e.starts_at)}`
  }
  return ''
}

function setPositionType(index: number, type: BankStatementPositionType) {
  openTypeIndex.value = null
  const position = form.value.positions[index]
  if (!position || position.position_type === type) return
  position.position_type = type
  position.receipt_id = null
  position.invoice_id = null
  position.event_id = null
  position.amount = 0
  entityQueries.value[index] = ''
}

function selectEntity(index: number, value: unknown) {
  const position = form.value.positions[index]
  if (!position) return

  if (position.position_type === 'receipt') {
    const r = value as BankStatementReceiptOption
    position.receipt_id = r.id
    position.position_date = String(r.receipt_date).slice(0, 10)
    entityQueries.value[index] = receiptLabel(r)
    return
  }
  if (position.position_type === 'invoice') {
    const inv = value as BankStatementInvoiceOption
    position.invoice_id = inv.id
    position.position_date = String(inv.invoice_date).slice(0, 10)
    entityQueries.value[index] = invoiceLabel(inv)
    return
  }
  const e = value as BankStatementEventOption
  position.event_id = e.id
  entityQueries.value[index] = `${e.name} | ${formatDateTime(e.starts_at)}`
}

function clearEntity(index: number) {
  const position = form.value.positions[index]
  if (!position) return
  position.receipt_id = null
  position.invoice_id = null
  position.event_id = null
  if (position.position_type === 'event') position.amount = 0
  entityQueries.value[index] = ''
}

function addPosition() {
  form.value.positions.push({
    position_type: 'receipt',
    position_date: '',
    receipt_id: null,
    invoice_id: null,
    event_id: null,
    amount: 0,
    notes: null,
  })
}

function removePosition(index: number) {
  form.value.positions.splice(index, 1)
  if (focusedAmountIndex.value === index) focusedAmountIndex.value = null
  else if (focusedAmountIndex.value !== null && focusedAmountIndex.value > index) {
    focusedAmountIndex.value -= 1
  }
}

function displayAmount(index: number) {
  const position = form.value.positions[index]
  if (!position) return ''
  if (focusedAmountIndex.value === index) return position.amount !== null && position.amount !== undefined ? String(position.amount) : ''
  if (position.amount === null || position.amount === undefined) return ''
  return formatCurrency(Number(position.amount))
}

function onAmountFocus(event: FocusEvent, index: number) {
  focusedAmountIndex.value = index
  focusAndSelectInput(event)
}

function onAmountInput(event: Event, index: number) {
  const value = sanitizeCurrencyInput((event.target as HTMLInputElement).value)
  const parsed = parseFloat(value)
  const position = form.value.positions[index]
  if (!position) return
  position.amount = Number.isNaN(parsed) ? 0 : parsed
  ;(event.target as HTMLInputElement).value = value
}

function onAmountBlur(index: number) {
  if (focusedAmountIndex.value === index) focusedAmountIndex.value = null
  const position = form.value.positions[index]
  if (!position) return
  if (position.amount !== null && position.amount !== undefined) {
    position.amount = Number(Number(position.amount).toFixed(2))
  }
}

function buildDraftMeta() {
  return JSON.parse(JSON.stringify(form.value))
}

function buildEntityReturnMeta(positionIndex: number) {
  const meta: Record<string, any> = {
    bankStatementDraft: buildDraftMeta(),
    bankStatementPositionIndex: positionIndex,
  }
  if (pageMeta.value?.bankStatementId) meta.bankStatementId = pageMeta.value.bankStatementId
  if (props.file) meta.bankStatementFile = props.file
  if (props.removeExistingFile) meta.bankStatementRemoveExistingFile = true
  meta.returnTarget = returnTarget.value
  return meta
}

function createNewReceipt(positionIndex: number) {
  setPageWithReturnTarget(
    'ReceiptCreate',
    undefined,
    buildReturnTarget('BankStatementCreate', buildEntityReturnMeta(positionIndex)),
  )
}

function createNewInvoice(positionIndex: number) {
  setPageWithReturnTarget(
    'InvoiceCreate',
    undefined,
    buildReturnTarget('BankStatementCreate', buildEntityReturnMeta(positionIndex)),
  )
}

function canEditSelectedReceipt(index: number) {
  return canEditReceipt.value && Boolean(form.value.positions[index]?.receipt_id)
}

function canEditSelectedInvoice(index: number) {
  return canEditInvoice.value && Boolean(form.value.positions[index]?.invoice_id)
}

function editSelectedReceipt(index: number) {
  const position = form.value.positions[index]
  if (!position?.receipt_id) return
  setPageWithReturnTarget(
    'ReceiptCreate',
    { receiptId: position.receipt_id },
    buildReturnTarget('BankStatementCreate', buildEntityReturnMeta(index)),
  )
}

function editSelectedInvoice(index: number) {
  const position = form.value.positions[index]
  if (!position?.invoice_id) return
  setPageWithReturnTarget(
    'InvoiceCreate',
    { invoiceId: position.invoice_id },
    buildReturnTarget('BankStatementCreate', buildEntityReturnMeta(index)),
  )
}

async function loadSupportData() {
  const currentStatementId = pageMeta.value?.bankStatementId || undefined
  const [membersRes, optionsRes] = await Promise.all([
    apiFetch<ApiResponse<'/api/members'>>('/api/members', { method: 'GET' }),
    apiFetch<ApiResponse<'/api/bank_statements/options'>>('/api/bank_statements/options', {
      method: 'GET',
      query: currentStatementId ? { currentStatementId } : undefined,
    }),
  ])

  if (membersRes.ok) members.value = membersRes.members
  if (optionsRes.ok) {
    receipts.value = optionsRes.receipts
    invoices.value = optionsRes.invoices
    events.value = optionsRes.events
  }
}

function syncEntityQueryLabels() {
  form.value.positions.forEach((position, index) => {
    if (entityQueries.value[index]) return

    if (position.position_type === 'receipt' && position.receipt_id) {
      const r = receipts.value.find(x => x.id === position.receipt_id)
      if (r) entityQueries.value[index] = receiptLabel(r)
    } else if (position.position_type === 'invoice' && position.invoice_id) {
      const inv = invoices.value.find(x => x.id === position.invoice_id)
      if (inv) entityQueries.value[index] = invoiceLabel(inv)
    } else if (position.position_type === 'event' && position.event_id) {
      const e = events.value.find(x => x.id === position.event_id)
      if (e) entityQueries.value[index] = `${e.name} | ${formatDateTime(e.starts_at)}`
    }
  })
}

watch([members, () => form.value.checked_by], () => {
  checkedByQuery.value = selectedMemberLabel(Number(form.value.checked_by || 0))
}, { immediate: true })

watch([receipts, invoices, events, () => form.value.positions], syncEntityQueryLabels, { immediate: true })

onMounted(() => {
  if (!form.value.positions.length) addPosition()
  loadSupportData()
})

useAppRefresh().onRefresh(loadSupportData)
</script>
