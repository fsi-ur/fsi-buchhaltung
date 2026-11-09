<template>
  <div class="space-y-6">
    <section class="-mx-6 bg-white shadow-sm sm:mx-0 sm:rounded-xl sm:shadow-lg p-4 space-y-4">
      <h2 class="text-lg font-semibold">{{ t('bankStatement.title') }}</h2>

      <div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div class="field min-w-0">
          <label class="text-sm font-medium text-base-600">{{ t('bankStatement.account') }}</label>
          <PageFinancesAccountSelect
            v-model="accountIdInput"
            :accounts="statementAccountOptions"
            :placeholder="t('bankStatement.accountPlaceholder')"
            :disabled="disabled"
          />
        </div>

        <div class="field min-w-0">
          <label class="text-sm font-medium text-base-600">{{ t('bankStatement.statementNumber') }}</label>
          <input
            v-model="form.statement_number"
            class="input"
            :disabled="disabled"
          >
        </div>

        <div class="field min-w-0">
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

        <div class="field min-w-0">
          <label class="text-sm font-medium text-base-600">{{ t('bankStatement.statementDate') }}</label>
          <CommonDateInput
            v-model="statementDateInput"
            mode="datetime"
            :disabled="disabled"
          />
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
          <!-- Type: fixed for a confirmation, otherwise a dropdown -->
          <div v-if="isConfirmation(position)" class="self-end">
            <div class="input flex items-center whitespace-nowrap bg-base-100 text-base-700">
              {{ t(`bankStatement.types.${position.position_type}`) }}
            </div>
          </div>
          <div v-else class="self-end">
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
                <button v-if="transferTargets(i).length" :class="styling" type="button" @click="setPositionType(i, 'transfer')">{{ t('bankStatement.types.transfer') }}</button>
              </template>
            </MenuDropdown>
          </div>

          <!-- Confirmation: what it confirms (read-only) -->
          <div v-if="isConfirmation(position)" class="field min-w-0">
            <div class="input flex min-w-0 items-center bg-base-100 text-base-700" :title="confirmationLabel(position)">
              <span class="truncate">{{ confirmationLabel(position) }}</span>
            </div>
          </div>

          <!-- Transfer: direction + counter account -->
          <div v-else-if="position.position_type === 'transfer'" class="field min-w-0">
            <div class="flex min-w-0 gap-2">
              <!-- Compact trigger ("An"/"Von"), so the counter account keeps the room it needs. -->
              <MenuDropdown
                v-model="openDirectionIndex"
                :id="i"
                :disabled="disabled"
                wrapper-class="relative w-auto shrink-0"
              >
                <template #trigger="{ styling }">
                  <button
                    :class="[styling, !disabled ? 'cursor-pointer' : '']"
                    :disabled="disabled"
                    :title="isOutgoing(position) ? t('bankStatement.transferTo') : t('bankStatement.transferFrom')"
                    type="button"
                  >
                    <span class="whitespace-nowrap">{{ isOutgoing(position) ? t('bankStatement.transferToShort') : t('bankStatement.transferFromShort') }}</span>
                    <Icon v-if="!disabled" name="material-symbols:keyboard-arrow-down-rounded" class="shrink-0" />
                  </button>
                </template>
                <template #default="{ styling }">
                  <button :class="styling" type="button" @click="setTransferDirection(i, true)">{{ t('bankStatement.transferTo') }}</button>
                  <button :class="styling" type="button" @click="setTransferDirection(i, false)">{{ t('bankStatement.transferFrom') }}</button>
                </template>
              </MenuDropdown>
              <PageFinancesAccountSelect
                v-model="position.counter_account_id"
                :accounts="transferTargets(i)"
                :placeholder="t('bankStatement.counterAccountPlaceholder')"
                :disabled="disabled"
                wrapper-class="relative min-w-0 flex-1 basis-0"
              />
            </div>
          </div>

          <!-- Entity search select -->
          <div v-else class="field min-w-0">
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
                  class="inline-flex items-center justify-center self-stretch w-9.5 rounded-md hover:bg-base-100 text-accent-500 cursor-pointer shrink-0"
                  :title="t('actions.edit')"
                  @click.stop.prevent="editSelectedReceipt(i)"
                >
                  <Icon name="material-symbols:edit-square-outline-rounded" class="text-xl" />
                </button>
                <button
                  v-else-if="canViewSelectedReceipt(i)"
                  type="button"
                  class="inline-flex items-center justify-center self-stretch w-9.5 rounded-md hover:bg-base-100 text-accent-500 cursor-pointer shrink-0"
                  :title="t('actions.view')"
                  @click.stop.prevent="viewSelectedReceipt(i)"
                >
                  <Icon name="material-symbols:visibility-outline-rounded" class="text-xl" />
                </button>
                <button
                  v-if="!disabled && canEditSelectedInvoice(i)"
                  type="button"
                  class="inline-flex items-center justify-center self-stretch w-9.5 rounded-md hover:bg-base-100 text-accent-500 cursor-pointer shrink-0"
                  :title="t('actions.edit')"
                  @click.stop.prevent="editSelectedInvoice(i)"
                >
                  <Icon name="material-symbols:edit-square-outline-rounded" class="text-xl" />
                </button>
                <button
                  v-else-if="canViewSelectedInvoice(i)"
                  type="button"
                  class="inline-flex items-center justify-center self-stretch w-9.5 rounded-md hover:bg-base-100 text-accent-500 cursor-pointer shrink-0"
                  :title="t('actions.view')"
                  @click.stop.prevent="viewSelectedInvoice(i)"
                >
                  <Icon name="material-symbols:visibility-outline-rounded" class="text-xl" />
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
              v-if="!hasAmountInput(position)"
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

        <p
          v-if="isConfirmation(position) && position.link && confirmationDifference(position) !== 0"
          class="mt-2 text-xs text-warning-800"
        >
          {{ t('bankStatement.confirmationDifference', {
            expected: formatCurrency(position.link.expected_amount),
            difference: formatSigned(confirmationDifference(position)),
          }) }}
        </p>
        <p
          v-else-if="isConfirmation(position) && position.link"
          class="mt-2 text-xs text-base-500"
        >
          {{ t('bankStatement.confirmationExpected', {
            expected: formatCurrency(position.link.expected_amount),
            date: formatDate(position.link.expected_date),
          }) }}
        </p>
        <p
          v-else-if="position.position_type === 'transfer' && position.id && position.link"
          class="mt-2 text-xs"
          :class="position.link.confirmed_date ? 'text-base-500' : 'text-warning-800'"
        >
          <template v-if="position.link.confirmed_date">
            {{ t('bankStatement.transferConfirmed', {
              account: position.link.account_name || '',
              number: position.link.statement_number || '',
              date: formatDate(position.link.confirmed_date),
              amount: formatCurrency(position.link.confirmed_amount ?? 0),
            }) }}
          </template>
          <template v-else>{{ t('bankStatement.transferUnconfirmed') }}</template>
        </p>
      </div>
    </section>

    <section
      v-if="!disabled && availableOpenItems.length"
      class="-mx-6 bg-white shadow-sm sm:mx-0 sm:rounded-xl sm:shadow-lg p-4 space-y-3"
    >
      <div>
        <h3 class="font-semibold">{{ t('bankStatement.openItemsTitle') }}</h3>
        <p class="text-sm text-base-500">{{ t('bankStatement.openItemsDescription') }}</p>
      </div>
      <ul class="divide-y divide-base-200 rounded-xl border border-base-200">
        <li v-for="item in availableOpenItems" :key="item.key" class="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-sm">
          <span class="w-24 shrink-0 text-base-500 tabular-nums">{{ formatDate(item.date) }}</span>
          <span class="min-w-0 flex-1">
            <span class="block truncate">{{ openItemLabel(item) }}</span>
            <span v-if="item.notes" class="block truncate text-xs text-base-500">{{ item.notes }}</span>
          </span>
          <CommonStatusBadge v-if="item.overdue" tone="warning" :label="t('bankStatement.openItemOverdue')" />
          <span class="shrink-0 tabular-nums" :class="item.expected_amount < 0 ? 'text-danger-700' : 'text-success-700'">
            {{ formatCurrency(item.expected_amount) }}
          </span>
          <button type="button" class="shrink-0 font-medium text-accent-500 hover:underline cursor-pointer" @click="takeOver(item)">
            {{ t('bankStatement.openItemTakeOver') }}
          </button>
        </li>
      </ul>
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
import type { FinanceMemberOption } from '~/types/member'
import type {
  CreateBankStatementBody,
  CreateBankStatementPositionBody,
  BankStatementPositionType,
  BankStatementReceiptOption,
  BankStatementInvoiceOption,
  BankStatementEventOption,
  BankOpenItem,
} from '~/types/bankStatement'
import { useFinanceAccounts } from '~/composables/useFinanceAccounts'

const props = defineProps<{
  modelValue: CreateBankStatementBody
  disabled?: boolean
  saving?: boolean
  openingBalance: number
  /** Transfers and reimbursements of the account that no statement has taken over yet */
  openItems?: BankOpenItem[]
  hasFile?: boolean
  file?: File | null
  removeExistingFile?: boolean
  /** A booked record the user has unlocked (SEC-22) — kept across the receipt/invoice detour. */
  recordUnlocked?: boolean
  canCreateReceipt?: boolean
  canCreateInvoice?: boolean
  canEditReceipt?: boolean
  canEditInvoice?: boolean
  canViewReceipt?: boolean
  canViewInvoice?: boolean
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
const financeAccounts = useFinanceAccounts()

const accountIdInput = computed({
  get: () => form.value.account_id || null,
  set: (value: number | null) => { form.value.account_id = Number(value) || 0 },
})
const openDirectionIndex = ref<string | number | null>(null)

/** Active accounts plus the archived one an existing statement may still be on. */
const statementAccountOptions = computed(() => financeAccounts.selectableAccounts(form.value.account_id))

/** Any other account the statement's account can transfer to/from (an archived one only if already chosen). */
function transferTargets(index: number) {
  const current = form.value.positions[index]?.counter_account_id ?? null
  return financeAccounts.selectableAccounts(current).filter(account => account.id !== form.value.account_id)
}

// The direction of a transfer is the sign of its amount; while the amount is still 0 it is kept here.
const pendingOutgoing = reactive(new WeakMap<object, boolean>())

/** Confirms a transfer entered on the other account, or a bank reimbursement — date and amount only. */
function isConfirmation(position: CreateBankStatementPositionBody) {
  return Boolean(position.linked_position_id) || position.position_type === 'reimbursement'
}

function hasAmountInput(position: CreateBankStatementPositionBody) {
  return position.position_type === 'event' || position.position_type === 'transfer' || position.position_type === 'reimbursement'
}

/** Amounts typed as absolute values, the sign follows the direction (transfers, confirmations). */
function hasDirectedAmount(position: CreateBankStatementPositionBody) {
  return position.position_type === 'transfer' || position.position_type === 'reimbursement'
}

function isOutgoing(position: CreateBankStatementPositionBody) {
  // A confirmation goes the way the other side / the reimbursement says.
  if (isConfirmation(position) && position.link) return position.link.expected_amount < 0
  if (position.position_type === 'reimbursement') return true
  if (position.amount && position.amount !== 0) return position.amount < 0
  return pendingOutgoing.get(position) ?? true
}

function confirmationDifference(position: CreateBankStatementPositionBody) {
  if (!position.link) return 0
  return Number((Number(position.amount ?? 0) - position.link.expected_amount).toFixed(2))
}

function confirmationLabel(position: CreateBankStatementPositionBody) {
  const link = position.link
  if (position.position_type === 'reimbursement') {
    return t('bankStatement.confirmsReimbursement', { member: link?.member_name || '' })
  }
  const statement = link?.statement_number ? ` · ${t('bankStatement.statementShort', { number: link.statement_number })}` : ''
  return t(isOutgoing(position) ? 'bankStatement.confirmsTransferTo' : 'bankStatement.confirmsTransferFrom', {
    account: link?.account_name || financeAccounts.accountName(position.counter_account_id),
  }) + statement
}

function formatSigned(value: number) {
  return `${value > 0 ? '+' : ''}${formatCurrency(value)}`
}

/** Open items not yet taken over in this (unsaved) form. */
const availableOpenItems = computed(() => {
  const linked = new Set(form.value.positions.map(p => p.linked_position_id).filter(Boolean))
  const reimbursements = new Set(form.value.positions.map(p => p.reimbursement_id).filter(Boolean))
  return (props.openItems ?? []).filter(item => item.kind === 'transfer'
    ? !linked.has(item.source_position_id)
    : !reimbursements.has(item.reimbursement_id))
})

function openItemLabel(item: BankOpenItem) {
  if (item.kind === 'reimbursement') return t('bankStatement.openReimbursement', { member: item.member_name || '' })
  return t(item.expected_amount < 0 ? 'bankStatement.openTransferTo' : 'bankStatement.openTransferFrom', {
    account: item.counter_account_name || '',
    number: item.source_statement_number || '',
  })
}

/** Takes an open item over with the expected date and amount — adjust both to the paper statement. */
function takeOver(item: BankOpenItem) {
  const position: CreateBankStatementPositionBody = {
    position_type: item.kind,
    position_date: item.date,
    receipt_id: null,
    invoice_id: null,
    event_id: null,
    counter_account_id: item.counter_account_id,
    linked_position_id: item.source_position_id,
    reimbursement_id: item.reimbursement_id,
    amount: item.expected_amount,
    notes: null,
    link: {
      expected_amount: item.expected_amount,
      expected_date: item.date,
      statement_id: item.source_statement_id,
      statement_number: item.source_statement_number,
      account_name: item.counter_account_name,
      confirmed_date: null,
      confirmed_amount: null,
      member_name: item.member_name,
    },
  }
  // Replace a still empty first position instead of leaving it dangling.
  const [first] = form.value.positions
  const firstIsEmpty = form.value.positions.length === 1 && first
    && !first.id && !first.receipt_id && !first.invoice_id && !first.event_id && !first.counter_account_id && !first.amount
  if (firstIsEmpty) form.value.positions.splice(0, 1, position)
  else form.value.positions.push(position)
}

function setTransferDirection(index: number, outgoing: boolean) {
  openDirectionIndex.value = null
  const position = form.value.positions[index]
  if (!position) return
  pendingOutgoing.set(position, outgoing)
  const absolute = Math.abs(Number(position.amount || 0))
  position.amount = outgoing ? -absolute : absolute
}
const canCreateReceipt = computed(() => props.canCreateReceipt === true)
const canCreateInvoice = computed(() => props.canCreateInvoice === true)
const canEditReceipt = computed(() => props.canEditReceipt === true)
const canEditInvoice = computed(() => props.canEditInvoice === true)
const canViewReceipt = computed(() => props.canViewReceipt === true)
const canViewInvoice = computed(() => props.canViewInvoice === true)

const members = ref<FinanceMemberOption[]>([])
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

const memberOptions = computed<SearchSelectOption<FinanceMemberOption>[]>(() =>
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
  if (hasAmountInput(position)) return position.amount ?? 0
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
  if (!form.value.account_id) errors.push(t('bankStatement.required.account'))
  if (!form.value.statement_number.trim()) errors.push(t('bankStatement.required.statementNumber'))
  if (!form.value.checked_by) errors.push(t('bankStatement.required.checkedBy'))
  if (!form.value.statement_date) errors.push(t('bankStatement.required.statementDate'))
  if (!form.value.positions.length) errors.push(t('bankStatement.required.positions'))
  if (form.value.positions.some(p =>
    (p.position_type === 'receipt' && !p.receipt_id) ||
    (p.position_type === 'invoice' && !p.invoice_id) ||
    (p.position_type === 'event' && !p.event_id)
  )) errors.push(t('bankStatement.required.eachPositionEntity'))
  if (form.value.positions.some(p => p.position_type === 'transfer' && !p.linked_position_id && (!p.counter_account_id || p.counter_account_id === form.value.account_id))) {
    errors.push(t('bankStatement.required.eachTransferAccount'))
  }
  if (form.value.positions.some(p => (p.position_type === 'transfer' || p.position_type === 'reimbursement') && !p.amount)) {
    errors.push(t('bankStatement.required.eachTransferAmount'))
  }
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

function memberLabel(m: FinanceMemberOption) {
  return m.full_name
}

function selectedMemberLabel(id: number) {
  const m = members.value.find(entry => entry.id === id)
  return m ? memberLabel(m) : ''
}

function onCheckedBySelect(value: unknown) {
  const m = value as FinanceMemberOption
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
  position.counter_account_id = null
  position.linked_position_id = null
  position.reimbursement_id = null
  position.link = null
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
    counter_account_id: null,
    linked_position_id: null,
    reimbursement_id: null,
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
  const value = hasDirectedAmount(position) && position.amount !== null && position.amount !== undefined
    ? Math.abs(position.amount)
    : position.amount
  if (focusedAmountIndex.value === index) return value !== null && value !== undefined ? String(value) : ''
  if (value === null || value === undefined) return ''
  return formatCurrency(Number(value))
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
  const amount = Number.isNaN(parsed) ? 0 : parsed
  position.amount = hasDirectedAmount(position)
    ? (isOutgoing(position) ? -Math.abs(amount) : Math.abs(amount))
    : amount
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
  if (props.recordUnlocked) meta.recordUnlocked = true
  if (pageMeta.value?.forceReadonly) meta.forceReadonly = true
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

function canViewSelectedReceipt(index: number) {
  return canViewReceipt.value && Boolean(form.value.positions[index]?.receipt_id)
}

function canViewSelectedInvoice(index: number) {
  return canViewInvoice.value && Boolean(form.value.positions[index]?.invoice_id)
}

function openSelectedReceipt(index: number, readonly: boolean) {
  const position = form.value.positions[index]
  if (!position?.receipt_id) return
  setPageWithReturnTarget(
    'ReceiptCreate',
    readonly ? { receiptId: position.receipt_id, forceReadonly: true } : { receiptId: position.receipt_id },
    buildReturnTarget('BankStatementCreate', buildEntityReturnMeta(index)),
  )
}

function openSelectedInvoice(index: number, readonly: boolean) {
  const position = form.value.positions[index]
  if (!position?.invoice_id) return
  setPageWithReturnTarget(
    'InvoiceCreate',
    readonly ? { invoiceId: position.invoice_id, forceReadonly: true } : { invoiceId: position.invoice_id },
    buildReturnTarget('BankStatementCreate', buildEntityReturnMeta(index)),
  )
}

function editSelectedReceipt(index: number) {
  openSelectedReceipt(index, false)
}

function viewSelectedReceipt(index: number) {
  openSelectedReceipt(index, true)
}

function editSelectedInvoice(index: number) {
  openSelectedInvoice(index, false)
}

function viewSelectedInvoice(index: number) {
  openSelectedInvoice(index, true)
}

async function loadSupportData() {
  const currentStatementId = pageMeta.value?.bankStatementId || undefined
  const [membersRes, optionsRes] = await Promise.all([
    apiFetch<ApiResponse<'/api/finances/member-options'>>('/api/finances/member-options', { method: 'GET' }),
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
