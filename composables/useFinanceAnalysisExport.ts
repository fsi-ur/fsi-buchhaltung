import { computed, ref, watch } from 'vue'
import { useAuth } from '~/composables/useAuth'
import { useI18n } from '~/composables/useI18n'
import { useLocaleFormatters } from '~/composables/useLocaleFormatters'
import type { GetBudgetResponse } from '~/server/api/finances/budgets/[id].get'
import type { BudgetDetail, BudgetListItem } from '~/types/budget'
import type { CostCentreRow } from '~/types/costCentre'
import type { FinanceAnalysisData } from '~/types/financeAnalysis'
import type { FinanceAnalysisExportGrouping } from '~/shared/financeAnalysisGrouping'
import { loadImageAsset } from '~/utils/imageDimensions'
import { downloadFinanceAnalysisReport } from '~/utils/excel/financeAnalysisReport'
import { downloadFinanceAnalysisPdf } from '~/utils/financeAnalysisPdfDownload'
import type { InvoiceStatus } from '~/types/invoice'
import type { ReceiptStatus } from '~/types/receipt'

export type FinanceAnalysisExportFormat = 'pdf' | 'excel'
export type ReportPagesExportMode = 'none' | 'reportOnly' | 'comparisonOnly' | 'both'

export interface PersistedFinanceAnalysisExportState {
  exportFormat?: FinanceAnalysisExportFormat
  exportGrouping?: FinanceAnalysisExportGrouping
  exportSplitByMonth?: boolean
  exportSplitByPaymentStatus?: boolean
  reportPagesExportMode?: ReportPagesExportMode
  includeTableOfContents?: boolean
  includeBalanceSheet?: boolean
  exportIncludeOverview?: boolean
  exportIncludeReceiptList?: boolean
  exportIncludeCashCountList?: boolean
  exportIncludeBankStatementList?: boolean
  exportIncludeInvoiceList?: boolean
}

export interface FinanceAnalysisExportContext {
  analysis: () => FinanceAnalysisData | null
  comparisonAnalysis: () => FinanceAnalysisData | null
  startDate: () => string
  endDate: () => string
  includeComparison: () => boolean
  statuses: () => ReceiptStatus[]
  receiptStatusLabels: () => Record<ReceiptStatus, string>
  receiptDateField: () => 'receipt_date' | 'reimbursement_submitted_at'
  invoiceStatuses: () => InvoiceStatus[]
  invoiceDateField: () => 'invoice_date' | 'due_date' | 'service_date' | 'paid_at'
  costCentres: () => CostCentreRow[]
  selectedCostCentre: () => CostCentreRow | null
  includeChildCostCentres: () => boolean
}

function addOneDay(dateString: string) {
  const parts = dateString.split('-').map(Number)
  if (parts.length !== 3 || parts.some(value => Number.isNaN(value))) return dateString

  const [year, month, day] = parts as [number, number, number]
  const date = new Date(year, month - 1, day)
  date.setDate(date.getDate() + 1)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

function findCoveringBudgets(periodStartDate: string, periodEndDate: string, items: BudgetListItem[]) {
  const budgetsByStart = new Map<string, BudgetListItem>()
  for (const budget of items) budgetsByStart.set(budget.start_date, budget)

  const matched: BudgetListItem[] = []
  let cursor = periodStartDate

  while (cursor <= periodEndDate) {
    const budget = budgetsByStart.get(cursor)
    if (!budget) return null
    matched.push(budget)

    if (budget.end_date === periodEndDate) return matched
    if (budget.end_date > periodEndDate) return null
    cursor = addOneDay(budget.end_date)
  }

  return null
}

export function useFinanceAnalysisExport(context: FinanceAnalysisExportContext) {
  const { t, locale } = useI18n()
  const { hasPermission } = useAuth()
  const { formatCurrency, formatDate, formatDateTime } = useLocaleFormatters()

  const isExporting = ref(false)
  const exportError = ref('')
  const exportFormat = ref<FinanceAnalysisExportFormat>('pdf')
  const exportGrouping = ref<FinanceAnalysisExportGrouping>('none')
  const exportSplitByMonth = ref(false)
  const exportSplitByPaymentStatus = ref(false)
  const includeBalanceSheet = ref(false)
  const includeTableOfContents = ref(true)
  const exportIncludeOverview = ref(true)
  const exportIncludeReceiptList = ref(true)
  const exportIncludeCashCountList = ref(true)
  const exportIncludeBankStatementList = ref(true)
  const exportIncludeInvoiceList = ref(true)
  const reportPagesExportMode = ref<ReportPagesExportMode>('none')
  const budgets = ref<BudgetListItem[]>([])

  const hasBudgetAccess = computed(() => hasPermission('budgets.view'))

  const coveringBudgets = computed(() => findCoveringBudgets(context.startDate(), context.endDate(), budgets.value))
  const canCompareToBudget = computed(() => hasBudgetAccess.value && Boolean(coveringBudgets.value?.length))
  const comparisonBudgetLabel = computed(() => (coveringBudgets.value ?? [])
    .map(budget => `${budget.year} · ${budget.semester === 'summer' ? t('budget.semesters.summer') : t('budget.semesters.winter')}`)
    .join(', '))

  const hasSingleSelectedCostCentre = computed(() => (
    Boolean(context.selectedCostCentre()) && !context.includeChildCostCentres()
  ))
  const showReportPagesExportOptions = computed(() => !hasSingleSelectedCostCentre.value)
  const showCostCentreGroupingOption = computed(() => !hasSingleSelectedCostCentre.value)

  const reportPagesExportOptions = computed<Array<{ value: ReportPagesExportMode, label: string, disabled: boolean }>>(() => [
    { value: 'none', label: t('financeAnalysis.exportReportPageModes.none'), disabled: false },
    { value: 'reportOnly', label: t('financeAnalysis.exportReportPageModes.reportOnly'), disabled: false },
    { value: 'comparisonOnly', label: t('financeAnalysis.exportReportPageModes.comparisonOnly'), disabled: !canCompareToBudget.value },
    { value: 'both', label: t('financeAnalysis.exportReportPageModes.both'), disabled: !canCompareToBudget.value },
  ])

  const selectedReportPagesExportLabel = computed(() => (
    reportPagesExportOptions.value.find(option => option.value === reportPagesExportMode.value)?.label
    ?? t('financeAnalysis.exportReportPageModes.none')
  ))

  const exportIncludesAnnualClosing = computed(() => (
    reportPagesExportMode.value === 'reportOnly' || reportPagesExportMode.value === 'both'
  ))

  const exportIncludesBudgetComparison = computed(() => (
    (reportPagesExportMode.value === 'comparisonOnly' || reportPagesExportMode.value === 'both')
    && canCompareToBudget.value
  ))

  const compareToBudgetHint = computed(() => {
    if (!hasBudgetAccess.value) return t('financeAnalysis.exportCompareToBudgetNeedsBudgetPermission')
    if (!coveringBudgets.value?.length) return t('financeAnalysis.exportCompareToBudgetUnavailable')
    return t('financeAnalysis.exportCompareToBudgetAvailable', { budgets: comparisonBudgetLabel.value })
  })

  const hasSelectedExportContent = computed(() => (
    exportIncludeOverview.value
    || exportIncludeReceiptList.value
    || exportIncludeCashCountList.value
    || exportIncludeBankStatementList.value
    || exportIncludeInvoiceList.value
    || exportIncludesAnnualClosing.value
    || exportIncludesBudgetComparison.value
    || includeBalanceSheet.value
    || exportGrouping.value !== 'none'
    || exportSplitByMonth.value
    || exportSplitByPaymentStatus.value
  ))

  async function loadBudgets() {
    if (!hasBudgetAccess.value) return

    try {
      const response = await $fetch<{ ok: true, budgets: BudgetListItem[] } | { ok: false, error: string }>('/api/finances/budgets')
      budgets.value = response.ok ? response.budgets : []
    } catch {
      budgets.value = []
    }
  }

  async function loadComparisonBudgetDetails(): Promise<BudgetDetail[]> {
    if (!exportIncludesBudgetComparison.value || !coveringBudgets.value?.length) return []

    const responses = await Promise.all(
      coveringBudgets.value.map(budget => $fetch<GetBudgetResponse>(`/api/finances/budgets/${budget.id}`)),
    )

    return responses
      .filter((response): response is { ok: true, budget: BudgetDetail } => response.ok)
      .map(response => response.budget)
  }

  function commonExportOptions() {
    return {
      startDate: context.startDate(),
      endDate: context.endDate(),
      exportGrouping: exportGrouping.value,
      exportSplitByMonth: exportSplitByMonth.value,
      exportSplitByPaymentStatus: exportSplitByPaymentStatus.value,
      includeBalanceSheet: includeBalanceSheet.value,
      includeOverview: exportIncludeOverview.value,
      includeReceiptList: exportIncludeReceiptList.value,
      includeCashCountList: exportIncludeCashCountList.value,
      includeBankStatementList: exportIncludeBankStatementList.value,
      includeInvoiceList: exportIncludeInvoiceList.value,
    }
  }

  async function runExport() {
    const analysis = context.analysis()
    if (!analysis || isExporting.value || !hasSelectedExportContent.value) return false

    isExporting.value = true
    exportError.value = ''

    try {
      if (exportFormat.value === 'pdf') {
        const result = await downloadFinanceAnalysisPdf({
          ...commonExportOptions(),
          includeTableOfContents: includeTableOfContents.value,
          statuses: context.statuses(),
          receiptDateField: context.receiptDateField(),
          invoiceStatuses: context.invoiceStatuses(),
          invoiceDateField: context.invoiceDateField(),
          costCentreId: context.selectedCostCentre()?.id ?? null,
          includeChildCostCentres: context.selectedCostCentre() ? context.includeChildCostCentres() : false,
          includeComparison: context.includeComparison(),
          annualClosing: exportIncludesAnnualClosing.value,
          compareToBudget: exportIncludesBudgetComparison.value,
          budgetIds: exportIncludesBudgetComparison.value ? (coveringBudgets.value ?? []).map(budget => budget.id) : [],
        })

        if (!result.ok) throw new Error(result.error || 'export failed')
        return true
      }

      const [comparisonBudget, logo] = await Promise.all([
        loadComparisonBudgetDetails(),
        loadImageAsset('/api/settings/association/logo'),
      ])

      downloadFinanceAnalysisReport({
        ...commonExportOptions(),
        t,
        locale: locale.value,
        analysis,
        comparisonAnalysis: context.comparisonAnalysis(),
        includeComparison: context.includeComparison(),
        selectedStatuses: context.statuses(),
        receiptDateField: context.receiptDateField(),
        selectedInvoiceStatuses: context.invoiceStatuses(),
        receiptStatusLabels: context.receiptStatusLabels(),
        invoiceDateField: context.invoiceDateField(),
        costCentres: context.costCentres(),
        selectedCostCentre: context.selectedCostCentre(),
        includeChildCostCentres: context.includeChildCostCentres(),
        annualClosing: exportIncludesAnnualClosing.value,
        compareToBudget: exportIncludesBudgetComparison.value && comparisonBudget.length > 0,
        budgetComparisonExportMode: reportPagesExportMode.value === 'both' ? 'annualAndComparison' : 'comparisonOnly',
        comparisonBudgetLabel: comparisonBudgetLabel.value || null,
        comparisonBudgetLines: comparisonBudget.flatMap(budget => budget.lines),
        logo,
        formatCurrency,
        formatDate,
        formatDateTime,
      })

      return true
    } catch {
      exportError.value = t('financeAnalysis.exportFailed')
      return false
    } finally {
      isExporting.value = false
    }
  }

  function toPersistedState(): PersistedFinanceAnalysisExportState {
    return {
      exportFormat: exportFormat.value,
      exportGrouping: exportGrouping.value,
      exportSplitByMonth: exportSplitByMonth.value,
      exportSplitByPaymentStatus: exportSplitByPaymentStatus.value,
      reportPagesExportMode: reportPagesExportMode.value,
      includeTableOfContents: includeTableOfContents.value,
      includeBalanceSheet: includeBalanceSheet.value,
      exportIncludeOverview: exportIncludeOverview.value,
      exportIncludeReceiptList: exportIncludeReceiptList.value,
      exportIncludeCashCountList: exportIncludeCashCountList.value,
      exportIncludeBankStatementList: exportIncludeBankStatementList.value,
      exportIncludeInvoiceList: exportIncludeInvoiceList.value,
    }
  }

  function applyPersistedState(state?: PersistedFinanceAnalysisExportState | null) {
    if (!state) return

    if (state.exportFormat === 'pdf' || state.exportFormat === 'excel') exportFormat.value = state.exportFormat
    if (state.exportGrouping === 'none' || state.exportGrouping === 'costCentres' || state.exportGrouping === 'spheres') {
      exportGrouping.value = state.exportGrouping
    }
    if (typeof state.exportSplitByMonth === 'boolean') exportSplitByMonth.value = state.exportSplitByMonth
    if (typeof state.exportSplitByPaymentStatus === 'boolean') exportSplitByPaymentStatus.value = state.exportSplitByPaymentStatus
    if (
      state.reportPagesExportMode === 'none'
      || state.reportPagesExportMode === 'reportOnly'
      || state.reportPagesExportMode === 'comparisonOnly'
      || state.reportPagesExportMode === 'both'
    ) {
      reportPagesExportMode.value = state.reportPagesExportMode
    }
    if (typeof state.includeTableOfContents === 'boolean') includeTableOfContents.value = state.includeTableOfContents
    if (typeof state.includeBalanceSheet === 'boolean') includeBalanceSheet.value = state.includeBalanceSheet
    if (typeof state.exportIncludeOverview === 'boolean') exportIncludeOverview.value = state.exportIncludeOverview
    if (typeof state.exportIncludeReceiptList === 'boolean') exportIncludeReceiptList.value = state.exportIncludeReceiptList
    if (typeof state.exportIncludeCashCountList === 'boolean') exportIncludeCashCountList.value = state.exportIncludeCashCountList
    if (typeof state.exportIncludeBankStatementList === 'boolean') exportIncludeBankStatementList.value = state.exportIncludeBankStatementList
    if (typeof state.exportIncludeInvoiceList === 'boolean') exportIncludeInvoiceList.value = state.exportIncludeInvoiceList
  }

  watch(canCompareToBudget, (value) => {
    if (!value && (reportPagesExportMode.value === 'comparisonOnly' || reportPagesExportMode.value === 'both')) {
      reportPagesExportMode.value = exportIncludesAnnualClosing.value ? 'reportOnly' : 'none'
    }
  })

  watch(showReportPagesExportOptions, (value) => {
    if (!value) reportPagesExportMode.value = 'none'
  })

  watch(showCostCentreGroupingOption, (value) => {
    if (!value && exportGrouping.value === 'costCentres') exportGrouping.value = 'none'
  })

  return {
    isExporting,
    exportError,
    exportFormat,
    exportGrouping,
    exportSplitByMonth,
    exportSplitByPaymentStatus,
    includeBalanceSheet,
    includeTableOfContents,
    exportIncludeOverview,
    exportIncludeReceiptList,
    exportIncludeCashCountList,
    exportIncludeBankStatementList,
    exportIncludeInvoiceList,
    reportPagesExportMode,
    reportPagesExportOptions,
    selectedReportPagesExportLabel,
    showReportPagesExportOptions,
    showCostCentreGroupingOption,
    canCompareToBudget,
    compareToBudgetHint,
    hasSelectedExportContent,
    loadBudgets,
    runExport,
    toPersistedState,
    applyPersistedState,
  }
}
