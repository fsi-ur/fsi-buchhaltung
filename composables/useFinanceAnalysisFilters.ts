import { computed, ref, watch } from 'vue'
import { useI18n } from '~/composables/useI18n'
import { currentSemesterPeriod, detectPeriodShortcut, type QuickSemester } from '~/shared/financeAnalysisPeriod'
import type { CostCentreRow } from '~/types/costCentre'
import { InvoiceStatus } from '~/types/invoice'
import { ReceiptStatus } from '~/types/receipt'

export type { QuickSemester }
export type ReceiptDateField = 'receipt_date' | 'reimbursement_submitted_at'
export type InvoiceDateField = 'invoice_date' | 'due_date' | 'service_date' | 'paid_at'

export const RECEIPT_STATUS_ORDER: ReceiptStatus[] = [
  ReceiptStatus.Draft,
  ReceiptStatus.Open,
  ReceiptStatus.Paid,
  ReceiptStatus.Cancelled,
]

export const INVOICE_STATUS_ORDER: InvoiceStatus[] = [
  InvoiceStatus.Draft,
  InvoiceStatus.Open,
  InvoiceStatus.Paid,
  InvoiceStatus.Cancelled,
]

const DEFAULT_RECEIPT_STATUSES: ReceiptStatus[] = [ReceiptStatus.Draft, ReceiptStatus.Open, ReceiptStatus.Paid]
const DEFAULT_INVOICE_STATUSES: InvoiceStatus[] = [InvoiceStatus.Open, InvoiceStatus.Paid]

export interface PersistedFinanceAnalysisState {
  startDate?: string
  endDate?: string
  quickYear?: string
  quickSemester?: QuickSemester
  quickMonth?: string
  compareWithPreviousYear?: boolean
  selectedStatuses?: ReceiptStatus[]
  receiptDateField?: ReceiptDateField
  selectedInvoiceStatuses?: InvoiceStatus[]
  invoiceDateField?: InvoiceDateField
  selectedCostCentreId?: number | null
  includeChildCostCentres?: boolean
  activeDetailTab?: string
}

function pad(value: number) {
  return String(value).padStart(2, '0')
}

export function shiftDateByYears(value: string, years: number) {
  const [yearString, monthString, dayString] = value.split('-')
  const shiftedYear = Number(yearString) + years
  const month = Number(monthString)
  const day = Number(dayString)
  const lastDayOfMonth = new Date(shiftedYear, month, 0).getDate()
  return `${shiftedYear}-${pad(month)}-${pad(Math.min(day, lastDayOfMonth))}`
}

export function useFinanceAnalysisFilters() {
  const { t, locale } = useI18n()
  const currentYear = new Date().getFullYear()

  const defaultSemester = currentSemesterPeriod()

  const startDate = ref(defaultSemester.semester === 'summer'
    ? `${defaultSemester.year}-04-01`
    : `${defaultSemester.year}-10-01`)
  const endDate = ref(defaultSemester.semester === 'summer'
    ? `${defaultSemester.year}-09-30`
    : `${defaultSemester.year + 1}-03-31`)
  const quickYear = ref(String(defaultSemester.year))
  const quickSemester = ref<QuickSemester>(defaultSemester.semester)
  const quickMonth = ref('')
  const compareWithPreviousYear = ref(false)
  const selectedStatuses = ref<ReceiptStatus[]>([...DEFAULT_RECEIPT_STATUSES])
  const receiptDateField = ref<ReceiptDateField>('receipt_date')
  const selectedInvoiceStatuses = ref<InvoiceStatus[]>([...DEFAULT_INVOICE_STATUSES])
  const invoiceDateField = ref<InvoiceDateField>('invoice_date')
  const costCentres = ref<CostCentreRow[]>([])
  const costCentreQuery = ref('')
  const selectedCostCentre = ref<CostCentreRow | null>(null)
  const includeChildCostCentres = ref(false)

  const yearOptions = computed(() => Array.from({ length: 11 }, (_, index) => currentYear + 1 - index))

  const monthOptions = computed(() => Array.from({ length: 12 }, (_, index) => ({
    value: String(index + 1),
    label: new Intl.DateTimeFormat(locale.value, { month: 'long' }).format(new Date(2024, index, 1)),
    shortLabel: new Intl.DateTimeFormat(locale.value, { month: 'short' }).format(new Date(2024, index, 1)).slice(0, 3),
  })))

  const receiptStatusLabels = computed<Record<ReceiptStatus, string>>(() => ({
    draft: t('receipt.states.draft'),
    open: t('receipt.states.open'),
    paid: t('receipt.states.paid'),
    cancelled: t('receipt.states.cancelled'),
  }))

  const invoiceStatusLabels = computed<Record<InvoiceStatus, string>>(() => ({
    draft: t('invoice.states.draft'),
    open: t('invoice.states.open'),
    paid: t('invoice.states.paid'),
    cancelled: t('invoice.states.cancelled'),
  }))

  const receiptStatusOptions = computed(() => RECEIPT_STATUS_ORDER.map(status => ({
    value: status,
    label: receiptStatusLabels.value[status],
  })))

  const invoiceStatusOptions = computed(() => INVOICE_STATUS_ORDER.map(status => ({
    value: status,
    label: invoiceStatusLabels.value[status],
    disabled: invoiceDateField.value === 'paid_at' && status !== InvoiceStatus.Paid,
  })))

  const receiptDateFieldOptions = computed<Array<{ value: ReceiptDateField, label: string }>>(() => [
    { value: 'receipt_date', label: t('financeAnalysis.receiptDateFieldOptions.receiptDate') },
    { value: 'reimbursement_submitted_at', label: t('financeAnalysis.receiptDateFieldOptions.reimbursementSubmittedAt') },
  ])

  const invoiceDateFieldOptions = computed<Array<{ value: InvoiceDateField, label: string }>>(() => [
    { value: 'invoice_date', label: t('financeAnalysis.invoiceDateFieldOptions.invoiceDate') },
    { value: 'due_date', label: t('financeAnalysis.invoiceDateFieldOptions.dueDate') },
    { value: 'service_date', label: t('financeAnalysis.invoiceDateFieldOptions.serviceDate') },
    { value: 'paid_at', label: t('financeAnalysis.invoiceDateFieldOptions.paidAt') },
  ])

  const selectedReceiptDateFieldLabel = computed(() => (
    receiptDateFieldOptions.value.find(option => option.value === receiptDateField.value)?.label
    ?? t('financeAnalysis.receiptDateFieldOptions.receiptDate')
  ))

  const selectedInvoiceDateFieldLabel = computed(() => (
    invoiceDateFieldOptions.value.find(option => option.value === invoiceDateField.value)?.label
    ?? t('financeAnalysis.invoiceDateFieldOptions.invoiceDate')
  ))

  const hasValidDateRange = computed(() => Boolean(
    startDate.value && endDate.value && startDate.value <= endDate.value,
  ))

  function costCentreOptionLabel(costCentre: CostCentreRow) {
    const baseLabel = `${costCentre.code} - ${costCentre.name}`
    return costCentre.is_active ? baseLabel : `${baseLabel} (${t('common.inactive')})`
  }

  const selectedCostCentreLabel = computed(() => (
    selectedCostCentre.value ? costCentreOptionLabel(selectedCostCentre.value) : ''
  ))

  const selectedCostCentreHasChildren = computed(() => (
    Boolean(selectedCostCentre.value)
    && costCentres.value.some(costCentre => costCentre.parent_id === selectedCostCentre.value?.id)
  ))

  function setRange(nextStartDate: string, nextEndDate: string) {
    startDate.value = nextStartDate
    endDate.value = nextEndDate
  }

  function ensureQuickYear() {
    if (!quickYear.value) quickYear.value = String(currentYear)
    return Number(quickYear.value)
  }

  function applyQuickSelectionRange() {
    const year = ensureQuickYear()

    if (quickMonth.value) {
      const month = Number(quickMonth.value)
      const lastDay = new Date(year, month, 0).getDate()
      setRange(`${year}-${pad(month)}-01`, `${year}-${pad(month)}-${pad(lastDay)}`)
      return
    }

    if (quickSemester.value === 'summer') {
      setRange(`${year}-04-01`, `${year}-09-30`)
      return
    }

    if (quickSemester.value === 'winter') {
      setRange(`${year}-10-01`, `${year + 1}-03-31`)
      return
    }

    setRange(`${year}-01-01`, `${year}-12-31`)
  }

  function applyYearShortcut() {
    if (!quickYear.value) return
    applyQuickSelectionRange()
  }

  function toggleSemesterShortcut(value: Exclude<QuickSemester, ''>) {
    quickSemester.value = quickSemester.value === value ? '' : value
    quickMonth.value = ''
    applyQuickSelectionRange()
  }

  function toggleMonthShortcut(value: string) {
    quickMonth.value = quickMonth.value === value ? '' : value
    quickSemester.value = ''
    applyQuickSelectionRange()
  }

  function setManualDate(field: 'start' | 'end', value: string | null) {
    if (field === 'start') startDate.value = value || ''
    else endDate.value = value || ''

    const shortcut = detectPeriodShortcut(startDate.value, endDate.value, yearOptions.value)
    quickYear.value = shortcut.quickYear
    quickSemester.value = shortcut.quickSemester
    quickMonth.value = shortcut.quickMonth
  }

  function clearSelectedCostCentre() {
    selectedCostCentre.value = null
    costCentreQuery.value = ''
    includeChildCostCentres.value = false
  }

  function applyDefaultPeriod() {
    quickYear.value = String(defaultSemester.year)
    quickSemester.value = defaultSemester.semester
    quickMonth.value = ''
    applyQuickSelectionRange()
  }

  function resetFilters() {
    compareWithPreviousYear.value = false
    selectedStatuses.value = [...DEFAULT_RECEIPT_STATUSES]
    receiptDateField.value = 'receipt_date'
    selectedInvoiceStatuses.value = [...DEFAULT_INVOICE_STATUSES]
    invoiceDateField.value = 'invoice_date'
    clearSelectedCostCentre()
    applyDefaultPeriod()
  }

  function toggleReceiptStatus(status: ReceiptStatus) {
    selectedStatuses.value = selectedStatuses.value.includes(status)
      ? selectedStatuses.value.filter(value => value !== status)
      : [...selectedStatuses.value, status].sort(
          (left, right) => RECEIPT_STATUS_ORDER.indexOf(left) - RECEIPT_STATUS_ORDER.indexOf(right),
        )
  }

  function toggleInvoiceStatus(status: InvoiceStatus) {
    if (invoiceDateField.value === 'paid_at' && status !== InvoiceStatus.Paid) return

    selectedInvoiceStatuses.value = selectedInvoiceStatuses.value.includes(status)
      ? selectedInvoiceStatuses.value.filter(value => value !== status)
      : [...selectedInvoiceStatuses.value, status].sort(
          (left, right) => INVOICE_STATUS_ORDER.indexOf(left) - INVOICE_STATUS_ORDER.indexOf(right),
        )
  }

  function setInvoiceDateField(field: InvoiceDateField) {
    invoiceDateField.value = field
    if (field === 'paid_at') selectedInvoiceStatuses.value = [InvoiceStatus.Paid]
  }

  function selectCostCentre(costCentre: CostCentreRow) {
    selectedCostCentre.value = costCentre
    costCentreQuery.value = costCentreOptionLabel(costCentre)
  }

  watch(selectedCostCentreHasChildren, (value) => {
    if (!value) includeChildCostCentres.value = false
  })

  async function loadCostCentres() {
    try {
      const response = await $fetch<{ ok: true, costCentres: CostCentreRow[] } | { ok: false, error: string }>('/api/cost_centres')
      costCentres.value = response.ok ? response.costCentres : []
    } catch {
      costCentres.value = []
    }
  }

  function toPersistedState(): PersistedFinanceAnalysisState {
    return {
      startDate: startDate.value,
      endDate: endDate.value,
      quickYear: quickYear.value,
      quickSemester: quickSemester.value,
      quickMonth: quickMonth.value,
      compareWithPreviousYear: compareWithPreviousYear.value,
      selectedStatuses: [...selectedStatuses.value],
      receiptDateField: receiptDateField.value,
      selectedInvoiceStatuses: [...selectedInvoiceStatuses.value],
      invoiceDateField: invoiceDateField.value,
      selectedCostCentreId: selectedCostCentre.value?.id ?? null,
      includeChildCostCentres: includeChildCostCentres.value,
    }
  }

  function applyPersistedState(state?: PersistedFinanceAnalysisState | null) {
    if (!state) return

    if (typeof state.startDate === 'string') startDate.value = state.startDate
    if (typeof state.endDate === 'string') endDate.value = state.endDate
    if (typeof state.quickYear === 'string') quickYear.value = state.quickYear
    if (state.quickSemester === '' || state.quickSemester === 'summer' || state.quickSemester === 'winter') {
      quickSemester.value = state.quickSemester
    }
    if (typeof state.quickMonth === 'string') quickMonth.value = state.quickMonth
    if (typeof state.compareWithPreviousYear === 'boolean') compareWithPreviousYear.value = state.compareWithPreviousYear
    if (Array.isArray(state.selectedStatuses)) {
      selectedStatuses.value = state.selectedStatuses.filter(
        (status): status is ReceiptStatus => RECEIPT_STATUS_ORDER.includes(status as ReceiptStatus),
      )
    }
    if (state.receiptDateField === 'receipt_date' || state.receiptDateField === 'reimbursement_submitted_at') {
      receiptDateField.value = state.receiptDateField
    }
    if (Array.isArray(state.selectedInvoiceStatuses)) {
      selectedInvoiceStatuses.value = state.selectedInvoiceStatuses.filter(
        (status): status is InvoiceStatus => INVOICE_STATUS_ORDER.includes(status as InvoiceStatus),
      )
    }
    if (
      state.invoiceDateField === 'invoice_date'
      || state.invoiceDateField === 'due_date'
      || state.invoiceDateField === 'service_date'
      || state.invoiceDateField === 'paid_at'
    ) {
      invoiceDateField.value = state.invoiceDateField
    }

    if (invoiceDateField.value === 'paid_at') selectedInvoiceStatuses.value = [InvoiceStatus.Paid]

    const restored = typeof state.selectedCostCentreId === 'number'
      ? costCentres.value.find(costCentre => costCentre.id === state.selectedCostCentreId) ?? null
      : null

    if (restored) selectCostCentre(restored)
    else clearSelectedCostCentre()

    if (typeof state.includeChildCostCentres === 'boolean' && restored) {
      includeChildCostCentres.value = state.includeChildCostCentres
    }
  }

  const requestFilters = computed(() => ({
    statuses: selectedStatuses.value,
    receiptDateField: receiptDateField.value,
    invoiceStatuses: selectedInvoiceStatuses.value,
    invoiceDateField: invoiceDateField.value,
    costCentreId: selectedCostCentre.value?.id ?? null,
    includeChildCostCentres: selectedCostCentre.value ? includeChildCostCentres.value : false,
  }))

  return {
    currentYear,
    startDate,
    endDate,
    quickYear,
    quickSemester,
    quickMonth,
    compareWithPreviousYear,
    selectedStatuses,
    receiptDateField,
    selectedInvoiceStatuses,
    invoiceDateField,
    costCentres,
    costCentreQuery,
    selectedCostCentre,
    includeChildCostCentres,
    yearOptions,
    monthOptions,
    receiptStatusLabels,
    invoiceStatusLabels,
    receiptStatusOptions,
    invoiceStatusOptions,
    receiptDateFieldOptions,
    invoiceDateFieldOptions,
    selectedReceiptDateFieldLabel,
    selectedInvoiceDateFieldLabel,
    selectedCostCentreLabel,
    selectedCostCentreHasChildren,
    hasValidDateRange,
    requestFilters,
    costCentreOptionLabel,
    applyYearShortcut,
    toggleSemesterShortcut,
    toggleMonthShortcut,
    setManualDate,
    resetFilters,
    toggleReceiptStatus,
    toggleInvoiceStatus,
    setInvoiceDateField,
    selectCostCentre,
    clearSelectedCostCentre,
    loadCostCentres,
    toPersistedState,
    applyPersistedState,
  }
}
