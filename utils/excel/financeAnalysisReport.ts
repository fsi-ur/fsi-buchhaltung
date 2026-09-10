import type { CostCentreRow } from '~/types/costCentre'
import type { BudgetCostCentreLine } from '~/types/budget'
import type {
  FinanceLiquidityRow,
  FinanceAnalysisCashCountItem,
  FinanceAnalysisData,
  FinanceAnalysisInvoiceBreakdownItem,
  FinanceAnalysisInvoiceItem,
  FinanceAnalysisReceiptItem,
  FinanceAnalysisReceiptBreakdownItem,
} from '~/types/financeAnalysis'
import { InvoiceStatus } from '~/types/invoice'
import { ReceiptStatus } from '~/types/receipt'
import {
  aggregateCashCountBreakdown,
  allocateBankEventRevenue,
  type FinanceAnalysisExportGrouping,
} from '~/shared/financeAnalysisGrouping'
import { liquidityRowLabel, liquidityRowNote } from '~/shared/financeLiquidityLabels'
import {
  createSpreadsheetRow,
  createSpreadsheetWorkbook,
  downloadExcelWorkbook,
  sanitizeFileNamePart,
  type SpreadsheetCell,
  type SpreadsheetImageDefinition,
  type SpreadsheetWorksheetDefinition,
} from '~/utils/excel/workbook'

interface TranslateFunction {
  (key: string, params?: Record<string, string | number>): string
}

interface FinanceAnalysisReportFormatters {
  formatCurrency: (value: number) => string
  formatDate: (value: string) => string
  formatDateTime: (value: string) => string
}

export type { FinanceAnalysisExportGrouping }
export type FinanceAnalysisReceiptDateField = 'receipt_date' | 'reimbursement_submitted_at'
export type FinanceAnalysisInvoiceDateField = 'invoice_date' | 'due_date' | 'service_date' | 'paid_at'
export type FinanceAnalysisBudgetComparisonExportMode = 'comparisonOnly' | 'annualAndComparison'

interface FinanceAnalysisReportLogo {
  data: Uint8Array
  extension: 'png' | 'jpeg' | 'jpg'
  mimeType: string
  width: number
  height: number
}

export interface FinanceAnalysisReportOptions extends FinanceAnalysisReportFormatters {
  t: TranslateFunction
  locale: string
  analysis: FinanceAnalysisData
  comparisonAnalysis: FinanceAnalysisData | null
  startDate: string
  endDate: string
  includeComparison: boolean
  selectedStatuses: ReceiptStatus[]
  receiptDateField: FinanceAnalysisReceiptDateField
  selectedInvoiceStatuses: InvoiceStatus[]
  receiptStatusLabels: Record<ReceiptStatus, string>
  invoiceDateField: FinanceAnalysisInvoiceDateField
  costCentres: CostCentreRow[]
  selectedCostCentre: CostCentreRow | null
  includeChildCostCentres: boolean
  annualClosing: boolean
  compareToBudget: boolean
  budgetComparisonExportMode: FinanceAnalysisBudgetComparisonExportMode
  comparisonBudgetLabel?: string | null
  comparisonBudgetLines?: BudgetCostCentreLine[] | null
  exportGrouping: FinanceAnalysisExportGrouping
  exportSplitByMonth: boolean
  exportSplitByPaymentStatus: boolean
  includeBalanceSheet: boolean
  includeOverview: boolean
  includeReceiptList: boolean
  includeCashCountList: boolean
  includeBankStatementList: boolean
  includeInvoiceList: boolean
  logo?: FinanceAnalysisReportLogo | null
}

interface ReceiptOverviewAggregate {
  groupLabel: string
  monthKey: string
  status: ReceiptStatus | ''
  receiptCount: number
  totalAmount: number
}

interface InvoiceOverviewAggregate {
  groupLabel: string
  monthKey: string
  status: InvoiceStatus | ''
  invoiceCount: number
  totalAmount: number
}


interface StatementCostCentreRow extends CostCentreRow {
  depth: number
  hasChildren: boolean
}

interface StatementSummary {
  ownExpense: number
  ownIncome: number
  ownSaldo: number
  childExpense: number
  childIncome: number
  childSaldo: number
  totalExpense: number
  totalIncome: number
  totalSaldo: number
}

type StatementAmountMap = Map<number, { expense: number, income: number }>

const receiptStatusOrder: ReceiptStatus[] = [
  ReceiptStatus.Draft,
  ReceiptStatus.Open,
  ReceiptStatus.Paid,
  ReceiptStatus.Cancelled,
]

const invoiceStatusOrder: InvoiceStatus[] = [
  InvoiceStatus.Draft,
  InvoiceStatus.Open,
  InvoiceStatus.Paid,
  InvoiceStatus.Cancelled,
]

const WORKSHEET_MARGIN = 0.35
const BRANDING_ROW_HEIGHT = 28
const OVERVIEW_SPACER_ROW_HEIGHT = 12
const EMU_PER_PIXEL = 9525

function exportFileName(startDate: string, endDate: string, selectedCostCentre: CostCentreRow | null) {
  const parts = ['finance-analysis', startDate, endDate]
  if (selectedCostCentre?.code) parts.push(sanitizeFileNamePart(selectedCostCentre.code))
  return `${parts.filter(Boolean).join('_')}.xlsx`
}

function currencyCell(value: number, styleId = 'CurrencyCell', mergeAcross = 0): SpreadsheetCell {
  return { value, styleId, type: 'Number', mergeAcross }
}

function countCell(value: number, styleId = 'CountCell', mergeAcross = 0): SpreadsheetCell {
  return { value, styleId, type: 'Number', mergeAcross }
}

function createBandRow(totalColumns: number, value: string, styleId: string, height?: number) {
  return createSpreadsheetRow([
    {
      value,
      styleId,
      mergeAcross: Math.max(totalColumns - 1, 0),
    },
  ], height)
}

function signedCurrencyStyle(value: number) {
  if (value > 0) return 'PositiveCurrencyCell'
  if (value < 0) return 'NegativeCurrencyCell'
  return 'CurrencyCell'
}

function signedCountStyle(value: number) {
  if (value > 0) return 'PositiveCountCell'
  if (value < 0) return 'NegativeCountCell'
  return 'CountCell'
}

function groupSignedCurrencyStyle(value: number) {
  if (value > 0) return 'GroupPositiveCurrencyCell'
  if (value < 0) return 'GroupNegativeCurrencyCell'
  return 'GroupCurrencyCell'
}

function hasExportOptionsSummary(options: FinanceAnalysisReportOptions) {
  return options.exportGrouping !== 'none'
    || options.exportSplitByMonth
    || options.exportSplitByPaymentStatus
    || options.annualClosing
    || options.compareToBudget
    || options.includeBalanceSheet
}

function hasReceiptOverviewExport(options: FinanceAnalysisReportOptions) {
  return options.exportGrouping !== 'none' || options.exportSplitByMonth || options.exportSplitByPaymentStatus
}

function hasCashCountOverviewExport(options: FinanceAnalysisReportOptions) {
  return options.exportGrouping !== 'none' || options.exportSplitByMonth
}

function exportGroupingLabel(options: FinanceAnalysisReportOptions) {
  switch (options.exportGrouping) {
    case 'costCentres':
      return options.t('financeAnalysis.exportGroupingCostCentres')
    case 'spheres':
      return options.t('financeAnalysis.exportGroupingSpheres')
    default:
      return options.t('financeAnalysis.exportGroupingNone')
  }
}

function reportPagesModeLabel(options: FinanceAnalysisReportOptions) {
  if (options.annualClosing && options.compareToBudget) return options.t('financeAnalysis.exportReportPageModes.both')
  if (options.annualClosing) return options.t('financeAnalysis.exportReportPageModes.reportOnly')
  if (options.compareToBudget) return options.t('financeAnalysis.exportReportPageModes.comparisonOnly')
  return options.t('financeAnalysis.exportReportPageModes.none')
}

function formatMonthKey(monthKey: string, locale: string) {
  if (!/^\d{4}-\d{2}$/.test(monthKey)) return monthKey

  const [yearString, monthString] = monthKey.split('-')
  const year = Number(yearString)
  const monthIndex = Number(monthString) - 1
  if (!Number.isFinite(year) || !Number.isFinite(monthIndex) || monthIndex < 0 || monthIndex > 11) return monthKey

  return new Intl.DateTimeFormat(locale, { month: 'short', year: 'numeric' }).format(new Date(year, monthIndex, 1))
}

function formatCashCountCostCentres(costCentres: FinanceAnalysisCashCountItem['cost_centres'], t: TranslateFunction) {
  if (!costCentres.length) return t('common.notAvailable')

  return costCentres
    .map(costCentre => {
      const costCentreLabel = [costCentre.code, costCentre.name].filter(Boolean).join(' - ')
      const label = [costCentre.sphere_code, costCentre.sphere_name].filter(Boolean).join(' - ')
        ? `${[costCentre.sphere_code, costCentre.sphere_name].filter(Boolean).join(' - ')} / ${costCentreLabel}`
        : costCentreLabel
      return costCentres.length > 1
        ? `${label} (${costCentre.allocation_percentage.toFixed(2)}%)`
        : label
    })
    .join(', ')
}

function roundCurrency(value: number) {
  return Number(value.toFixed(2))
}

function addOneDay(dateString: string) {
  const parts = dateString.split('-').map(Number)
  if (parts.length !== 3 || parts.some(value => Number.isNaN(value))) return dateString

  const [year, month, day] = parts as [number, number, number]
  const next = new Date(year, month - 1, day)
  next.setDate(next.getDate() + 1)
  return `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, '0')}-${String(next.getDate()).padStart(2, '0')}`
}

function buildVisibleStatementCostCentres(
  options: FinanceAnalysisReportOptions,
  actualOwnAmountsByCostCentreId: StatementAmountMap,
  budgetOwnAmountsByCostCentreId: StatementAmountMap = new Map(),
) {
  const { costCentres, selectedCostCentre, includeChildCostCentres } = options
  const lineMap = new Map(costCentres.map(item => [item.id, item]))
  const childrenByParent = new Map<number | null, CostCentreRow[]>()
  const parentById = new Map<number, number | null>()

  for (const item of costCentres) {
    const parentId = item.parent_id !== null && item.parent_id !== item.id && lineMap.has(item.parent_id)
      ? item.parent_id
      : null
    parentById.set(item.id, parentId)
    const bucket = childrenByParent.get(parentId) ?? []
    bucket.push(item)
    childrenByParent.set(parentId, bucket)
  }

  const hasDirectValues = (costCentreId: number) => {
    const actual = actualOwnAmountsByCostCentreId.get(costCentreId)
    if (actual && (actual.expense !== 0 || actual.income !== 0)) return true
    const budget = budgetOwnAmountsByCostCentreId.get(costCentreId)
    return Boolean(budget && (budget.expense !== 0 || budget.income !== 0))
  }

  const shouldDisplay = (costCentreId: number): boolean => {
    const costCentre = lineMap.get(costCentreId)
    if (!costCentre) return false
    if ((parentById.get(costCentreId) ?? null) === null) return true
    return hasDirectValues(costCentreId)
  }

  const ordered: StatementCostCentreRow[] = []
  const visited = new Set<number>()
  const visit = (parentId: number | null, depth: number) => {
    const children = [...(childrenByParent.get(parentId) ?? [])].sort((left, right) => (
      left.code.localeCompare(right.code, undefined, { numeric: true, sensitivity: 'base' })
      || left.name.localeCompare(right.name, undefined, { sensitivity: 'base' })
    ))

    for (const child of children) {
      if (visited.has(child.id)) continue

      const displayChild = shouldDisplay(child.id)
      if (displayChild) {
        visited.add(child.id)
        ordered.push({
          ...child,
          depth,
          hasChildren: false,
        })
      }

      if (includeChildCostCentres || !selectedCostCentre || child.id !== selectedCostCentre.id) {
        const beforeChildCount = ordered.length
        visit(child.id, displayChild ? depth + 1 : depth)
        if (displayChild) {
          ordered[beforeChildCount - 1]!.hasChildren = ordered
            .slice(beforeChildCount)
            .some(row => row.depth === depth + 1)
        }
      }
    }
  }

  if (selectedCostCentre) {
    const selected = lineMap.get(selectedCostCentre.id)
    if (selected && shouldDisplay(selected.id)) {
      const selectedIndex = ordered.length
      ordered.push({
        ...selected,
        depth: 0,
        hasChildren: false,
      })
      if (includeChildCostCentres) {
        visit(selected.id, 1)
        ordered[selectedIndex]!.hasChildren = ordered
          .slice(selectedIndex + 1)
          .some(row => row.depth === 1)
      }
    } else if (selected && includeChildCostCentres) {
      visit(selected.id, 0)
    }
    return ordered
  }

  visit(null, 0)
  return ordered
}

function buildStatementSummaryMap(
  visibleCostCentres: StatementCostCentreRow[],
  ownAmountsByCostCentreId: Map<number, { expense: number, income: number }>,
) {
  const childrenByParent = new Map<number | null, number[]>()
  const parentStack: StatementCostCentreRow[] = []

  for (const costCentre of visibleCostCentres) {
    while (parentStack.length && parentStack[parentStack.length - 1]!.depth >= costCentre.depth) {
      parentStack.pop()
    }

    const parent = parentStack[parentStack.length - 1] ?? null
    const parentId = parent?.id ?? null
    const bucket = childrenByParent.get(parentId) ?? []
    bucket.push(costCentre.id)
    childrenByParent.set(parentId, bucket)
    parentStack.push(costCentre)
  }

  const cache = new Map<number, StatementSummary>()
  const compute = (costCentreId: number): StatementSummary => {
    if (cache.has(costCentreId)) return cache.get(costCentreId)!

    const own = ownAmountsByCostCentreId.get(costCentreId) ?? { expense: 0, income: 0 }
    let childExpense = 0
    let childIncome = 0

    for (const childId of childrenByParent.get(costCentreId) ?? []) {
      const childSummary = compute(childId)
      childExpense += childSummary.totalExpense
      childIncome += childSummary.totalIncome
    }

    const summary = {
      ownExpense: roundCurrency(own.expense),
      ownIncome: roundCurrency(own.income),
      ownSaldo: roundCurrency(own.income - own.expense),
      childExpense: roundCurrency(childExpense),
      childIncome: roundCurrency(childIncome),
      childSaldo: roundCurrency(childIncome - childExpense),
      totalExpense: roundCurrency(own.expense + childExpense),
      totalIncome: roundCurrency(own.income + childIncome),
      totalSaldo: roundCurrency((own.income + childIncome) - (own.expense + childExpense)),
    }

    cache.set(costCentreId, summary)
    return summary
  }

  const result = new Map<number, StatementSummary>()
  for (const row of visibleCostCentres) result.set(row.id, compute(row.id))
  return result
}

function buildActualOwnAmountsByCostCentreId(options: FinanceAnalysisReportOptions) {
  const amounts = new Map<number, { expense: number, income: number }>()
  const add = (costCentreId: number, expense: number, income: number) => {
    const current = amounts.get(costCentreId) ?? { expense: 0, income: 0 }
    current.expense = roundCurrency(current.expense + expense)
    current.income = roundCurrency(current.income + income)
    amounts.set(costCentreId, current)
  }

  options.analysis.receiptBreakdown
    .filter(item => item.group_type === 'costCentre')
    .forEach((item) => {
      if (item.group_id !== null) add(item.group_id, item.total_amount, 0)
    })

  options.analysis.invoiceBreakdown
    .filter(item => item.group_type === 'costCentre')
    .forEach((item) => {
      if (item.group_id !== null) add(item.group_id, 0, item.total_amount)
    })

  options.analysis.cashCounts.forEach((cashCount) => {
    cashCount.cost_centres.forEach((costCentre) => {
      const factor = Number(costCentre.allocation_percentage || 0) / 100
      add(costCentre.cost_centre_id, 0, roundCurrency(cashCount.total_difference * factor))
    })
  })

  allocateBankEventRevenue(options.analysis.bankStatementPositions, (costCentreId, income) => add(costCentreId, 0, income))

  return amounts
}

function buildBudgetOwnAmountsByCostCentreId(lines: BudgetCostCentreLine[] | null | undefined) {
  const amounts = new Map<number, { expense: number, income: number }>()
  for (const line of lines ?? []) {
    const costCentreId = Number(line.cost_centre_id)
    const current = amounts.get(costCentreId) ?? { expense: 0, income: 0 }
    current.expense = roundCurrency(current.expense + Number(line.expense_amount || 0))
    current.income = roundCurrency(current.income + Number(line.income_amount || 0))
    amounts.set(costCentreId, current)
  }
  return amounts
}


function buildOverviewRows(options: FinanceAnalysisReportOptions) {
  const {
    t,
    analysis,
    comparisonAnalysis,
    includeComparison,
    startDate,
    endDate,
    selectedStatuses,
    receiptStatusLabels,
    selectedCostCentre,
    exportSplitByMonth,
    exportSplitByPaymentStatus,
    formatDate,
    formatDateTime,
  } = options

  const summary = analysis.summary
  const hasComparison = includeComparison && Boolean(comparisonAnalysis)
  const totalColumns = hasComparison ? 4 : 3
  const rowMergeAcross = totalColumns - 1
  const valueMergeAcross = totalColumns - 2
  const singleValueMergeAcross = totalColumns - 2
  const orderedSelectedStatuses = receiptStatusOrder.filter(status => selectedStatuses.includes(status))
  const orderedSelectedInvoiceStatuses = invoiceStatusOrder.filter(status => options.selectedInvoiceStatuses.includes(status))
  const receiptStateRows = [
    { status: ReceiptStatus.Draft, label: receiptStatusLabels.draft, count: summary.receipt_draft_count, total: summary.receipt_draft_total },
    { status: ReceiptStatus.Open, label: receiptStatusLabels.open, count: summary.receipt_open_count, total: summary.receipt_open_total },
    { status: ReceiptStatus.Paid, label: receiptStatusLabels.paid, count: summary.receipt_paid_count, total: summary.receipt_paid_total },
    { status: ReceiptStatus.Cancelled, label: receiptStatusLabels.cancelled, count: summary.receipt_cancelled_count, total: summary.receipt_cancelled_total },
  ].filter(row => orderedSelectedStatuses.includes(row.status))
  const invoiceStateRows = orderedSelectedInvoiceStatuses
    .map((status) => {
    const invoices = analysis.invoices.filter(invoice => invoice.status === status)
    return {
      label: t(`invoice.states.${status}`),
      count: invoices.length,
      total: Number(invoices.reduce((sum, invoice) => sum + invoice.total_amount, 0).toFixed(2)),
    }
  })

  const createThreeValueHeaderRow = (first: string, second: string, third: string) => (
    createSpreadsheetRow([
      { value: first, styleId: 'Header' },
      { value: second, styleId: 'Header' },
      { value: third, styleId: 'Header', mergeAcross: hasComparison ? 1 : 0 },
    ])
  )

  const rows = [
    createBandRow(totalColumns, t('financeAnalysis.title'), 'Title', 22),
    createBandRow(totalColumns, t('financeAnalysis.periodLabel', { start: formatDate(startDate), end: formatDate(endDate) }), 'Subtitle'),
    createSpreadsheetRow([
      { value: t('financeAnalysis.reportGeneratedAt'), styleId: 'Label' },
      { value: formatDateTime(new Date().toISOString()), styleId: 'Body', mergeAcross: valueMergeAcross },
    ]),
    createBandRow(totalColumns, '', 'BodyMuted', OVERVIEW_SPACER_ROW_HEIGHT),
    createBandRow(totalColumns, t('financeAnalysis.menuTitle'), 'Section', 19),
  ]

  if (selectedCostCentre) {
    rows.push(createSpreadsheetRow([
      { value: t('financeAnalysis.costCentre'), styleId: 'Label' },
      {
        value: options.includeChildCostCentres
          ? `${selectedCostCentre.code} - ${selectedCostCentre.name} (${t('financeAnalysis.includeChildCostCentres')})`
          : `${selectedCostCentre.code} - ${selectedCostCentre.name}`,
        styleId: 'Body',
        mergeAcross: valueMergeAcross,
      },
    ]))
  }

  rows.push(
    createSpreadsheetRow([
      { value: t('financeAnalysis.receiptDateField'), styleId: 'Label' },
      {
        value: options.receiptDateField === 'reimbursement_submitted_at'
          ? t('financeAnalysis.receiptDateFieldOptions.reimbursementSubmittedAt')
          : t('financeAnalysis.receiptDateFieldOptions.receiptDate'),
        styleId: 'Body',
        mergeAcross: valueMergeAcross,
      },
    ]),
    createSpreadsheetRow([
      { value: t('financeAnalysis.receiptStateFilters'), styleId: 'Label' },
      {
        value: orderedSelectedStatuses.map(status => receiptStatusLabels[status]).join(', ') || t('financeAnalysis.noneSelected'),
        styleId: 'Body',
        mergeAcross: valueMergeAcross,
      },
    ]),
    createSpreadsheetRow([
      { value: t('financeAnalysis.invoiceDateField'), styleId: 'Label' },
      {
        value: options.invoiceDateField === 'due_date'
          ? t('financeAnalysis.invoiceDateFieldOptions.dueDate')
          : options.invoiceDateField === 'service_date'
            ? t('financeAnalysis.invoiceDateFieldOptions.serviceDate')
            : options.invoiceDateField === 'paid_at'
              ? t('financeAnalysis.invoiceDateFieldOptions.paidAt')
              : t('financeAnalysis.invoiceDateFieldOptions.invoiceDate'),
        styleId: 'Body',
        mergeAcross: valueMergeAcross,
      },
    ]),
    createSpreadsheetRow([
      { value: t('financeAnalysis.invoiceStateFilters'), styleId: 'Label' },
      {
        value: orderedSelectedInvoiceStatuses.map(status => t(`invoice.states.${status}`)).join(', ') || t('financeAnalysis.noneSelected'),
        styleId: 'Body',
        mergeAcross: valueMergeAcross,
      },
    ]),
  )

  if (hasComparison && comparisonAnalysis) {
    rows.push(createSpreadsheetRow([
      { value: t('financeAnalysis.compareWithPreviousYear'), styleId: 'Label' },
      {
        value: t('financeAnalysis.previousYearRange', { start: formatDate(comparisonAnalysis.summary.start_date), end: formatDate(comparisonAnalysis.summary.end_date) }),
        styleId: 'Body',
        mergeAcross: valueMergeAcross,
      },
    ]))
  }

  if (hasExportOptionsSummary(options)) {
    rows.push(
      createBandRow(totalColumns, '', 'BodyMuted', OVERVIEW_SPACER_ROW_HEIGHT),
      createBandRow(totalColumns, t('financeAnalysis.exportOptionsTitle'), 'Section', 19),
      createSpreadsheetRow([
        { value: t('financeAnalysis.exportReportPagesTitle'), styleId: 'Label' },
        { value: reportPagesModeLabel(options), styleId: 'Body', mergeAcross: valueMergeAcross },
      ]),
      createSpreadsheetRow([
        { value: t('financeAnalysis.exportGroupingLabel'), styleId: 'Label' },
        { value: exportGroupingLabel(options), styleId: 'Body', mergeAcross: valueMergeAcross },
      ]),
      createSpreadsheetRow([
        { value: t('financeAnalysis.exportSplitByMonth'), styleId: 'Label' },
        { value: exportSplitByMonth ? t('common.yes') : t('common.no'), styleId: 'Body', mergeAcross: valueMergeAcross },
      ]),
      createSpreadsheetRow([
        { value: t('financeAnalysis.exportSplitByPaymentStatus'), styleId: 'Label' },
        { value: exportSplitByPaymentStatus ? t('common.yes') : t('common.no'), styleId: 'Body', mergeAcross: valueMergeAcross },
      ]),
      createSpreadsheetRow([
        { value: t('financeAnalysis.liquidity.exportInclude'), styleId: 'Label' },
        { value: options.includeBalanceSheet ? t('common.yes') : t('common.no'), styleId: 'Body', mergeAcross: valueMergeAcross },
      ]),
    )
  }

  rows.push(
    createBandRow(totalColumns, '', 'BodyMuted', OVERVIEW_SPACER_ROW_HEIGHT),
    createBandRow(totalColumns, t('financeAnalysis.analysisTitle'), 'Section', 19),
  )

  if (hasComparison && comparisonAnalysis) {
    const receiptDifference = Number((summary.receipt_total - comparisonAnalysis.summary.receipt_total).toFixed(2))
    const cashDifference = Number((summary.cash_count_total_difference - comparisonAnalysis.summary.cash_count_total_difference).toFixed(2))
    const invoiceDifference = Number((summary.invoice_total - comparisonAnalysis.summary.invoice_total).toFixed(2))
    const netDifference = Number((summary.net_result - comparisonAnalysis.summary.net_result).toFixed(2))
    const entryDifference = (summary.receipt_count + summary.cash_count_count + summary.invoice_count) - (comparisonAnalysis.summary.receipt_count + comparisonAnalysis.summary.cash_count_count + comparisonAnalysis.summary.invoice_count)

    rows.push(createSpreadsheetRow([
      { value: '', styleId: 'Header' },
      { value: t('financeAnalysis.currentValue'), styleId: 'Header' },
      { value: t('financeAnalysis.previousValue'), styleId: 'Header' },
      { value: t('financeAnalysis.differenceHeader'), styleId: 'Header' },
    ]))

    rows.push(
      createSpreadsheetRow([
        { value: t('financeAnalysis.cards.receiptTotal'), styleId: 'TextCell' },
        currencyCell(summary.receipt_total),
        currencyCell(comparisonAnalysis.summary.receipt_total),
        currencyCell(receiptDifference, signedCurrencyStyle(receiptDifference)),
      ]),
      createSpreadsheetRow([
        { value: t('financeAnalysis.cards.cashCountRevenue'), styleId: 'TextCell' },
        currencyCell(summary.cash_count_total_difference),
        currencyCell(comparisonAnalysis.summary.cash_count_total_difference),
        currencyCell(cashDifference, signedCurrencyStyle(cashDifference)),
      ]),
      createSpreadsheetRow([
        { value: t('financeAnalysis.cards.invoiceRevenue'), styleId: 'TextCell' },
        currencyCell(summary.invoice_total),
        currencyCell(comparisonAnalysis.summary.invoice_total),
        currencyCell(invoiceDifference, signedCurrencyStyle(invoiceDifference)),
      ]),
      createSpreadsheetRow([
        { value: t('financeAnalysis.cards.netResult'), styleId: 'TextCell' },
        currencyCell(summary.net_result, signedCurrencyStyle(summary.net_result)),
        currencyCell(comparisonAnalysis.summary.net_result, signedCurrencyStyle(comparisonAnalysis.summary.net_result)),
        currencyCell(netDifference, signedCurrencyStyle(netDifference)),
      ]),
      createSpreadsheetRow([
        { value: t('financeAnalysis.cards.entriesReviewed'), styleId: 'TextCell' },
        countCell(summary.receipt_count + summary.cash_count_count + summary.invoice_count),
        countCell(comparisonAnalysis.summary.receipt_count + comparisonAnalysis.summary.cash_count_count + comparisonAnalysis.summary.invoice_count),
        countCell(entryDifference, signedCountStyle(entryDifference)),
      ]),
    )
  } else {
    rows.push(
      createSpreadsheetRow([{ value: t('financeAnalysis.cards.receiptTotal'), styleId: 'TextCell' }, currencyCell(summary.receipt_total, 'CurrencyCell', singleValueMergeAcross)]),
      createSpreadsheetRow([{ value: t('financeAnalysis.cards.cashCountRevenue'), styleId: 'TextCell' }, currencyCell(summary.cash_count_total_difference, 'CurrencyCell', singleValueMergeAcross)]),
      createSpreadsheetRow([{ value: t('financeAnalysis.cards.invoiceRevenue'), styleId: 'TextCell' }, currencyCell(summary.invoice_total, 'CurrencyCell', singleValueMergeAcross)]),
      createSpreadsheetRow([{ value: t('financeAnalysis.cards.netResult'), styleId: 'TextCell' }, currencyCell(summary.net_result, signedCurrencyStyle(summary.net_result), singleValueMergeAcross)]),
      createSpreadsheetRow([{ value: t('financeAnalysis.cards.entriesReviewed'), styleId: 'TextCell' }, countCell(summary.receipt_count + summary.cash_count_count + summary.invoice_count, 'CountCell', singleValueMergeAcross)]),
    )
  }

  rows.push(
    createBandRow(totalColumns, '', 'BodyMuted', OVERVIEW_SPACER_ROW_HEIGHT),
    createBandRow(totalColumns, t('financeAnalysis.receiptsSectionTitle'), 'Section', 19),
    createThreeValueHeaderRow(
      t('financeAnalysis.receiptStatusLabel'),
      t('financeAnalysis.countHeader'),
      t('financeAnalysis.cards.receiptTotal'),
    ),
  )

  rows.push(...receiptStateRows.map(row => createSpreadsheetRow([
    { value: row.label, styleId: 'TextCell' },
    countCell(row.count),
    currencyCell(row.total, 'CurrencyCell', hasComparison ? 1 : 0),
  ])))

  rows.push(
    createBandRow(totalColumns, '', 'BodyMuted', OVERVIEW_SPACER_ROW_HEIGHT),
    createBandRow(totalColumns, t('financeAnalysis.cashCountsSectionTitle'), 'Section', 19),
    createSpreadsheetRow([{ value: t('financeAnalysis.cashCards.totalBefore'), styleId: 'TextCell' }, currencyCell(summary.money_before, 'CurrencyCell', singleValueMergeAcross)]),
    createSpreadsheetRow([{ value: t('financeAnalysis.cashCards.totalAfter'), styleId: 'TextCell' }, currencyCell(summary.money_after, 'CurrencyCell', singleValueMergeAcross)]),
    createSpreadsheetRow([{ value: t('financeAnalysis.cashCards.registers'), styleId: 'TextCell' }, countCell(summary.cash_count_register_total, 'CountCell', singleValueMergeAcross)]),
    createSpreadsheetRow([{ value: t('financeAnalysis.cashCards.periodDiscrepancyTotal'), styleId: 'TextCell' }, currencyCell(summary.period_discrepancy_total, signedCurrencyStyle(summary.period_discrepancy_total), singleValueMergeAcross)]),
  )

  rows.push(
    createBandRow(totalColumns, '', 'BodyMuted', OVERVIEW_SPACER_ROW_HEIGHT),
    createBandRow(totalColumns, t('financeAnalysis.invoicesSectionTitle'), 'Section', 19),
    createThreeValueHeaderRow(
      t('financeAnalysis.invoiceStatusLabel'),
      t('financeAnalysis.countHeader'),
      t('financeAnalysis.cards.invoiceRevenue'),
    ),
  )

  rows.push(...invoiceStateRows.map(row => createSpreadsheetRow([
    { value: row.label, styleId: 'TextCell' },
    countCell(row.count),
    currencyCell(row.total, 'CurrencyCell', hasComparison ? 1 : 0),
  ])))

  return rows
}

function buildReceiptRows(options: FinanceAnalysisReportOptions) {
  const { t, analysis, startDate, endDate, formatDate, receiptStatusLabels, receiptDateField } = options
  const receiptDateLabel = receiptDateField === 'reimbursement_submitted_at'
    ? t('financeAnalysis.receiptDateFieldOptions.reimbursementSubmittedAt')
    : t('financeAnalysis.receiptDateFieldOptions.receiptDate')
  const useExpandedAmountColumn = options.includeComparison
  const totalColumns = useExpandedAmountColumn ? 6 : 5
  const amountMergeAcross = useExpandedAmountColumn ? 1 : 0

  const rows = [
    createBandRow(totalColumns, t('financeAnalysis.receiptsTableTitle'), 'Title', 20),
    createBandRow(totalColumns, t('financeAnalysis.periodLabel', { start: formatDate(startDate), end: formatDate(endDate) }), 'Subtitle'),
    createBandRow(totalColumns, t('financeAnalysis.countLabel', { count: analysis.receipts.length }), 'BodyMuted'),
    createSpreadsheetRow([
      { value: receiptDateLabel, styleId: 'Header' },
      { value: t('receipt.receiptNumber'), styleId: 'Header' },
      { value: t('receipt.company'), styleId: 'Header' },
      { value: t('receipt.paymentStatus'), styleId: 'Header' },
      { value: t('receipt.grossAmount'), styleId: 'Header', mergeAcross: amountMergeAcross },
    ]),
  ]

  if (analysis.receipts.length === 0) {
    rows.push(createSpreadsheetRow([{ value: t('financeAnalysis.noReceipts'), styleId: 'Body', mergeAcross: totalColumns - 1 }]))
    return rows
  }

  rows.push(...analysis.receipts.map(receipt => createSpreadsheetRow([
    { value: formatDate(getReceiptDateValue(receipt, receiptDateField)), styleId: 'TextCell' },
    { value: receipt.receipt_number || t('receipt.noNumber'), styleId: 'TextCell' },
    { value: receipt.company_name || t('receipt.noCompany'), styleId: 'TextCell' },
    { value: receiptStatusLabels[receipt.status], styleId: 'TextCell' },
    currencyCell(receipt.total_amount, 'CurrencyCell', amountMergeAcross),
  ])))

  return rows
}

function buildCashCountRows(options: FinanceAnalysisReportOptions) {
  const { t, analysis, startDate, endDate, formatDate, formatDateTime } = options
  const mergeAcross = 9
  const headerCells: SpreadsheetCell[] = [
    { value: t('cashCount.countedAfterAt'), styleId: 'Header' },
    { value: t('cashCount.event'), styleId: 'Header' },
    { value: t('financeAnalysis.sphereAndCostCentre'), styleId: 'Header' },
    { value: t('cashCount.countedByFirst'), styleId: 'Header' },
    { value: t('cashCount.countedBySecond'), styleId: 'Header' },
    { value: t('cashCount.checkedBy'), styleId: 'Header' },
    { value: t('cashCount.registerCount'), styleId: 'Header' },
    { value: t('financeAnalysis.cashCards.totalBefore'), styleId: 'Header' },
    { value: t('cashCount.totalAfter'), styleId: 'Header' },
    { value: t('cashCount.totalDifference'), styleId: 'Header' },
  ]

  const rows = [
    createBandRow(mergeAcross + 1, t('financeAnalysis.cashCountsTableTitle'), 'Title', 20),
    createBandRow(mergeAcross + 1, t('financeAnalysis.periodLabel', { start: formatDate(startDate), end: formatDate(endDate) }), 'Subtitle'),
    createBandRow(mergeAcross + 1, t('financeAnalysis.countLabel', { count: analysis.cashCounts.length }), 'BodyMuted'),
    createSpreadsheetRow(headerCells),
  ]

  if (analysis.cashCounts.length === 0) {
    rows.push(createSpreadsheetRow([{ value: t('financeAnalysis.noCashCounts'), styleId: 'Body', mergeAcross }]))
    return rows
  }

  rows.push(...analysis.cashCounts.map(cashCount => {
    const cells: SpreadsheetCell[] = [
      { value: formatDateTime(cashCount.counted_after_at), styleId: 'TextCell' },
      { value: cashCount.event_name, styleId: 'TextCell' },
      { value: formatCashCountCostCentres(cashCount.cost_centres, t), styleId: 'TextCell' },
      { value: cashCount.counted_by_first_name || t('common.notAvailable'), styleId: 'TextCell' },
      { value: cashCount.counted_by_second_name || t('common.notAvailable'), styleId: 'TextCell' },
      { value: cashCount.checked_by_name || t('common.notAvailable'), styleId: 'TextCell' },
      countCell(cashCount.register_count),
      currencyCell(cashCount.total_before_amount),
      currencyCell(cashCount.total_after_amount),
      currencyCell(cashCount.total_difference, signedCurrencyStyle(cashCount.total_difference)),
    ]
    return createSpreadsheetRow(cells)
  }))

  return rows
}

function buildBankStatementRows(options: FinanceAnalysisReportOptions) {
  const { t, analysis, startDate, endDate, formatDate } = options
  const headerCells: SpreadsheetCell[] = [
    { value: t('financeAnalysis.bankStatements.positionDate'), styleId: 'Header' },
    { value: t('financeAnalysis.bankStatements.statementNumber'), styleId: 'Header' },
    { value: t('financeAnalysis.bankStatements.positionType'), styleId: 'Header' },
    { value: t('financeAnalysis.bankStatements.reference'), styleId: 'Header' },
    { value: t('financeAnalysis.bankStatements.counterparty'), styleId: 'Header' },
    { value: t('financeAnalysis.sphereAndCostCentre'), styleId: 'Header' },
    { value: t('financeAnalysis.bankStatements.checkedBy'), styleId: 'Header' },
    { value: t('receipt.grossAmount'), styleId: 'Header' },
  ]
  const mergeAcross = headerCells.length - 1

  const rows = [
    createBandRow(mergeAcross + 1, t('financeAnalysis.bankStatementsTableTitle'), 'Title', 20),
    createBandRow(mergeAcross + 1, t('financeAnalysis.periodLabel', { start: formatDate(startDate), end: formatDate(endDate) }), 'Subtitle'),
    createBandRow(mergeAcross + 1, t('financeAnalysis.countLabel', { count: analysis.bankStatementPositions.length }), 'BodyMuted'),
    createSpreadsheetRow(headerCells),
  ]

  if (analysis.bankStatementPositions.length === 0) {
    rows.push(createSpreadsheetRow([{ value: t('financeAnalysis.noBankStatementPositions'), styleId: 'Body', mergeAcross }]))
    return rows
  }

  rows.push(...analysis.bankStatementPositions.map((position) => {
    // Signed so the sheet reads like an account statement: money leaving is negative.
    const signedAmount = position.direction === 'out' ? -position.amount : position.amount
    return createSpreadsheetRow([
      { value: formatDate(position.position_date), styleId: 'TextCell' },
      { value: position.statement_number || t('common.notAvailable'), styleId: 'TextCell' },
      { value: t(`financeAnalysis.bankStatements.types.${position.position_type}`), styleId: 'TextCell' },
      { value: position.reference || t('common.notAvailable'), styleId: 'TextCell' },
      { value: position.counterparty || t('common.notAvailable'), styleId: 'TextCell' },
      { value: formatCashCountCostCentres(position.cost_centres, t), styleId: 'TextCell' },
      { value: position.checked_by_name || t('common.notAvailable'), styleId: 'TextCell' },
      currencyCell(signedAmount, signedCurrencyStyle(signedAmount)),
    ])
  }))

  return rows
}

function buildInvoiceRows(options: FinanceAnalysisReportOptions) {
  const { t, analysis, startDate, endDate, formatDate, invoiceDateField } = options
  const invoiceDateLabelByField: Record<FinanceAnalysisInvoiceDateField, string> = {
    invoice_date: t('financeAnalysis.invoiceDateFieldOptions.invoiceDate'),
    due_date: t('financeAnalysis.invoiceDateFieldOptions.dueDate'),
    service_date: t('financeAnalysis.invoiceDateFieldOptions.serviceDate'),
    paid_at: t('financeAnalysis.invoiceDateFieldOptions.paidAt'),
  }
  const useExpandedAmountColumn = options.includeComparison
  const totalColumns = useExpandedAmountColumn ? 6 : 5
  const amountMergeAcross = useExpandedAmountColumn ? 1 : 0

  const rows = [
    createBandRow(totalColumns, t('financeAnalysis.invoicesTableTitle'), 'Title', 20),
    createBandRow(totalColumns, t('financeAnalysis.periodLabel', { start: formatDate(startDate), end: formatDate(endDate) }), 'Subtitle'),
    createBandRow(totalColumns, t('financeAnalysis.countLabel', { count: analysis.invoices.length }), 'BodyMuted'),
    createSpreadsheetRow([
      { value: invoiceDateLabelByField[invoiceDateField], styleId: 'Header' },
      { value: t('invoice.invoiceNumber'), styleId: 'Header' },
      { value: t('receipt.company'), styleId: 'Header' },
      { value: t('receipt.paymentStatus'), styleId: 'Header' },
      { value: t('receipt.grossAmount'), styleId: 'Header', mergeAcross: amountMergeAcross },
    ]),
  ]

  if (analysis.invoices.length === 0) {
    rows.push(createSpreadsheetRow([{ value: t('financeAnalysis.noInvoices'), styleId: 'Body', mergeAcross: totalColumns - 1 }]))
    return rows
  }

  rows.push(...analysis.invoices.map(invoice => createSpreadsheetRow([
    { value: formatDate(getInvoiceDateValue(invoice, invoiceDateField) || invoice.invoice_date), styleId: 'TextCell' },
    { value: invoice.invoice_number, styleId: 'TextCell' },
    { value: invoice.company_name || t('receipt.noCompany'), styleId: 'TextCell' },
    { value: t(`invoice.states.${invoice.status}`), styleId: 'TextCell' },
    currencyCell(invoice.total_amount, 'CurrencyCell', amountMergeAcross),
  ])))

  return rows
}

function getReceiptDateValue(receipt: FinanceAnalysisReceiptItem, receiptDateField: FinanceAnalysisReceiptDateField) {
  if (receiptDateField === 'reimbursement_submitted_at') return receipt.reimbursement_submitted_at || receipt.receipt_date
  return receipt.receipt_date
}

function getInvoiceDateValue(invoice: FinanceAnalysisInvoiceItem, invoiceDateField: FinanceAnalysisInvoiceDateField) {
  if (invoiceDateField === 'due_date') return invoice.due_date
  if (invoiceDateField === 'service_date') return invoice.service_date
  if (invoiceDateField === 'paid_at') return invoice.paid_at
  return invoice.invoice_date
}


function buildBalanceRows(options: FinanceAnalysisReportOptions) {
  const { t, analysis, startDate, endDate, formatDate } = options
  const totalColumns = 11
  const mergeAcross = totalColumns - 1
  const rows = analysis.liquidityRows ?? []
  const dataCount = rows.filter(r => r.type !== 'opening' && r.type !== 'closing').length

  const headerRows = [
    createBandRow(totalColumns, t('financeAnalysis.liquidity.title'), 'Title', 20),
    createBandRow(totalColumns, t('financeAnalysis.periodLabel', { start: formatDate(startDate), end: formatDate(endDate) }), 'Subtitle'),
    createBandRow(totalColumns, t('financeAnalysis.countLabel', { count: dataCount }), 'BodyMuted'),
    createSpreadsheetRow([
      { value: t('financeAnalysis.liquidity.date'), styleId: 'Header' },
      { value: t('financeAnalysis.liquidity.operation'), styleId: 'Header' },
      { value: t('financeAnalysis.liquidity.reference'), styleId: 'Header' },
      { value: t('financeAnalysis.liquidity.movement'), styleId: 'Header' },
      { value: t('financeAnalysis.liquidity.bank'), styleId: 'Header' },
      { value: t('financeAnalysis.liquidity.cash'), styleId: 'Header' },
      { value: t('financeAnalysis.liquidity.total'), styleId: 'Header' },
      { value: t('financeAnalysis.liquidity.expected'), styleId: 'Header' },
      { value: t('financeAnalysis.liquidity.measured'), styleId: 'Header' },
      { value: t('financeAnalysis.liquidity.discrepancy'), styleId: 'Header' },
      { value: t('financeAnalysis.liquidity.note'), styleId: 'Header' },
    ]),
  ]

  if (rows.length === 0) {
    return [
      ...headerRows,
      createSpreadsheetRow([{ value: t('financeAnalysis.liquidity.noRows'), styleId: 'Body', mergeAcross }]),
    ]
  }

  const dataRows = rows.map(row => {
    const isSpecialRow = row.type === 'opening' || row.type === 'closing' || row.type === 'bankStatementCheckpoint'
    const movementCell = isSpecialRow
      ? { value: '', styleId: 'TextCell' }
      : currencyCell(row.delta_amount, signedCurrencyStyle(row.delta_amount))

    return createSpreadsheetRow([
      { value: formatDate(row.date), styleId: 'TextCell' },
      { value: liquidityRowLabel(row, t), styleId: 'TextCell' },
      { value: row.reference || '', styleId: 'TextCell' },
      movementCell,
      currencyCell(row.bank_balance, signedCurrencyStyle(row.bank_balance)),
      currencyCell(row.cash_balance, signedCurrencyStyle(row.cash_balance)),
      currencyCell(row.total_balance, signedCurrencyStyle(row.total_balance)),
      row.expected_amount === null ? { value: '', styleId: 'TextCell' } : currencyCell(row.expected_amount),
      row.measured_amount === null ? { value: '', styleId: 'TextCell' } : currencyCell(row.measured_amount),
      row.discrepancy_amount === null
        ? { value: '', styleId: 'TextCell' }
        : currencyCell(row.discrepancy_amount, signedCurrencyStyle(row.discrepancy_amount)),
      { value: liquidityRowNote(row, t), styleId: 'TextCell' },
    ])
  })

  return [...headerRows, ...dataRows]
}

function buildReceiptOverviewAggregates(options: FinanceAnalysisReportOptions) {
  const groups = new Map<string, ReceiptOverviewAggregate>()

  const pushAggregate = (groupLabel: string, monthKey: string, status: ReceiptStatus | '', receiptCount: number, totalAmount: number) => {
    const key = [groupLabel, monthKey, status].join('|')
    const current = groups.get(key)
    if (current) {
      current.receiptCount += receiptCount
      current.totalAmount += totalAmount
      return
    }

    groups.set(key, {
      groupLabel,
      monthKey,
      status,
      receiptCount,
      totalAmount,
    })
  }

  if (options.exportGrouping === 'none') {
    options.analysis.receipts.forEach((receipt) => {
      pushAggregate(
        '',
        options.exportSplitByMonth ? getReceiptDateValue(receipt, options.receiptDateField).slice(0, 7) : '',
        options.exportSplitByPaymentStatus ? receipt.status : '',
        1,
        receipt.total_amount,
      )
    })
  } else {
    const targetGroupType: FinanceAnalysisReceiptBreakdownItem['group_type'] = options.exportGrouping === 'costCentres' ? 'costCentre' : 'sphere'

    options.analysis.receiptBreakdown
      .filter(item => item.group_type === targetGroupType)
      .forEach((item) => {
        const groupLabel = [item.group_code, item.group_name].filter(Boolean).join(' - ') || options.t('financeAnalysis.noneSelected')
        pushAggregate(
          groupLabel,
          options.exportSplitByMonth ? item.month_key : '',
          options.exportSplitByPaymentStatus ? item.status : '',
          item.receipt_count,
          item.total_amount,
        )
      })
  }

  return Array.from(groups.values())
    .map(group => ({
      ...group,
      receiptCount: Number(group.receiptCount.toFixed(0)),
      totalAmount: Number(group.totalAmount.toFixed(2)),
    }))
    .sort((left, right) => {
      if (left.groupLabel !== right.groupLabel) return left.groupLabel.localeCompare(right.groupLabel)
      if (left.monthKey !== right.monthKey) return left.monthKey.localeCompare(right.monthKey)
      return receiptStatusOrder.indexOf(left.status as ReceiptStatus) - receiptStatusOrder.indexOf(right.status as ReceiptStatus)
    })
}

function buildReceiptOverviewRows(options: FinanceAnalysisReportOptions) {
  const { t, locale, startDate, endDate, formatDate, receiptStatusLabels } = options
  const groupedRows = buildReceiptOverviewAggregates(options)
  const hasGroupingColumn = options.exportGrouping !== 'none'
  const hasMonthColumn = options.exportSplitByMonth
  const hasStatusColumn = options.exportSplitByPaymentStatus
  const headerCells: SpreadsheetCell[] = []

  if (hasGroupingColumn) {
    headerCells.push({
      value: options.exportGrouping === 'costCentres' ? t('financeAnalysis.exportGroupingCostCentres') : t('financeAnalysis.exportGroupingSpheres'),
      styleId: 'Header',
    })
  }
  if (hasMonthColumn) headerCells.push({ value: t('financeAnalysis.quickMonth'), styleId: 'Header' })
  if (hasStatusColumn) headerCells.push({ value: t('receipt.paymentStatus'), styleId: 'Header' })
  headerCells.push({ value: t('financeAnalysis.countHeader'), styleId: 'Header' })
  headerCells.push({ value: t('financeAnalysis.cards.receiptTotal'), styleId: 'Header' })

  const mergeAcross = Math.max(headerCells.length - 1, 0)
  const rows = [
    createBandRow(mergeAcross + 1, t('financeAnalysis.receiptOverviewExportTitle'), 'Title', 20),
    createBandRow(mergeAcross + 1, t('financeAnalysis.periodLabel', { start: formatDate(startDate), end: formatDate(endDate) }), 'Subtitle'),
    createBandRow(mergeAcross + 1, t('financeAnalysis.countLabel', { count: groupedRows.length }), 'BodyMuted'),
    createSpreadsheetRow(headerCells),
  ]

  if (groupedRows.length === 0) {
    rows.push(createSpreadsheetRow([{ value: t('financeAnalysis.noReceipts'), styleId: 'Body', mergeAcross }]))
    return rows
  }

  rows.push(...groupedRows.map(group => {
    const cells: SpreadsheetCell[] = []
    if (hasGroupingColumn) cells.push({ value: group.groupLabel, styleId: 'TextCell' })
    if (hasMonthColumn) cells.push({ value: formatMonthKey(group.monthKey, locale), styleId: 'TextCell' })
    if (hasStatusColumn) cells.push({ value: receiptStatusLabels[group.status as ReceiptStatus], styleId: 'TextCell' })
    cells.push(countCell(group.receiptCount))
    cells.push(currencyCell(group.totalAmount))
    return createSpreadsheetRow(cells)
  }))

  return rows
}

function buildInvoiceOverviewAggregates(options: FinanceAnalysisReportOptions) {
  const groups = new Map<string, InvoiceOverviewAggregate>()

  const pushAggregate = (groupLabel: string, monthKey: string, status: InvoiceStatus | '', invoiceCount: number, totalAmount: number) => {
    const key = [groupLabel, monthKey, status].join('|')
    const current = groups.get(key)
    if (current) {
      current.invoiceCount += invoiceCount
      current.totalAmount += totalAmount
      return
    }

    groups.set(key, {
      groupLabel,
      monthKey,
      status,
      invoiceCount,
      totalAmount,
    })
  }

  if (options.exportGrouping === 'none') {
    options.analysis.invoices.forEach((invoice) => {
      const invoiceDate = getInvoiceDateValue(invoice, options.invoiceDateField) || invoice.invoice_date
      pushAggregate(
        '',
        options.exportSplitByMonth ? invoiceDate.slice(0, 7) : '',
        options.exportSplitByPaymentStatus ? invoice.status : '',
        1,
        invoice.total_amount,
      )
    })
  } else {
    const targetGroupType: FinanceAnalysisInvoiceBreakdownItem['group_type'] = options.exportGrouping === 'costCentres' ? 'costCentre' : 'sphere'

    options.analysis.invoiceBreakdown
      .filter(item => item.group_type === targetGroupType)
      .forEach((item) => {
        const groupLabel = [item.group_code, item.group_name].filter(Boolean).join(' - ') || options.t('financeAnalysis.noneSelected')
        pushAggregate(
          groupLabel,
          options.exportSplitByMonth ? item.month_key : '',
          options.exportSplitByPaymentStatus ? item.status : '',
          item.invoice_count,
          item.total_amount,
        )
      })
  }

  return Array.from(groups.values())
    .map(group => ({
      ...group,
      invoiceCount: Number(group.invoiceCount.toFixed(0)),
      totalAmount: Number(group.totalAmount.toFixed(2)),
    }))
    .sort((left, right) => {
      if (left.groupLabel !== right.groupLabel) return left.groupLabel.localeCompare(right.groupLabel)
      if (left.monthKey !== right.monthKey) return left.monthKey.localeCompare(right.monthKey)
      return invoiceStatusOrder.indexOf(left.status as InvoiceStatus) - invoiceStatusOrder.indexOf(right.status as InvoiceStatus)
    })
}

function buildInvoiceOverviewRows(options: FinanceAnalysisReportOptions) {
  const { t, locale, startDate, endDate, formatDate } = options
  const groupedRows = buildInvoiceOverviewAggregates(options)
  const hasGroupingColumn = options.exportGrouping !== 'none'
  const hasMonthColumn = options.exportSplitByMonth
  const hasStatusColumn = options.exportSplitByPaymentStatus
  const headerCells: SpreadsheetCell[] = []

  if (hasGroupingColumn) {
    headerCells.push({
      value: options.exportGrouping === 'costCentres' ? t('financeAnalysis.exportGroupingCostCentres') : t('financeAnalysis.exportGroupingSpheres'),
      styleId: 'Header',
    })
  }
  if (hasMonthColumn) headerCells.push({ value: t('financeAnalysis.quickMonth'), styleId: 'Header' })
  if (hasStatusColumn) headerCells.push({ value: t('receipt.paymentStatus'), styleId: 'Header' })
  headerCells.push({ value: t('financeAnalysis.countHeader'), styleId: 'Header' })
  headerCells.push({ value: t('financeAnalysis.cards.invoiceRevenue'), styleId: 'Header' })

  const mergeAcross = Math.max(headerCells.length - 1, 0)
  const rows = [
    createBandRow(mergeAcross + 1, t('financeAnalysis.invoiceOverviewExportTitle'), 'Title', 20),
    createBandRow(mergeAcross + 1, t('financeAnalysis.periodLabel', { start: formatDate(startDate), end: formatDate(endDate) }), 'Subtitle'),
    createBandRow(mergeAcross + 1, t('financeAnalysis.countLabel', { count: groupedRows.length }), 'BodyMuted'),
    createSpreadsheetRow(headerCells),
  ]

  if (groupedRows.length === 0) {
    rows.push(createSpreadsheetRow([{ value: t('financeAnalysis.noInvoices'), styleId: 'Body', mergeAcross }]))
    return rows
  }

  rows.push(...groupedRows.map(group => {
    const cells: SpreadsheetCell[] = []
    if (hasGroupingColumn) cells.push({ value: group.groupLabel, styleId: 'TextCell' })
    if (hasMonthColumn) cells.push({ value: formatMonthKey(group.monthKey, locale), styleId: 'TextCell' })
    if (hasStatusColumn) cells.push({ value: t(`invoice.states.${group.status}`), styleId: 'TextCell' })
    cells.push(countCell(group.invoiceCount))
    cells.push(currencyCell(group.totalAmount))
    return createSpreadsheetRow(cells)
  }))

  return rows
}

function buildCashCountOverviewAggregates(options: FinanceAnalysisReportOptions) {
  return aggregateCashCountBreakdown(
    options.analysis.cashCountBreakdown,
    options.exportGrouping,
    options.exportSplitByMonth,
    {
      unassigned: options.t('common.notAvailable'),
      formatGroup: (code, name) => [code, name].filter(Boolean).join(' - '),
    },
  )
}

function buildCashCountOverviewRows(options: FinanceAnalysisReportOptions) {
  const { t, locale, startDate, endDate, formatDate } = options
  const groupedRows = buildCashCountOverviewAggregates(options)
  const hideBalances = options.exportGrouping !== 'none'
  const headerCells: SpreadsheetCell[] = []

  if (options.exportGrouping !== 'none') {
    headerCells.push({
      value: options.exportGrouping === 'spheres'
        ? t('financeAnalysis.exportGroupingSpheres')
        : t('financeAnalysis.exportGroupingCostCentres'),
      styleId: 'Header',
    })
  }
  if (options.exportSplitByMonth) headerCells.push({ value: t('financeAnalysis.quickMonth'), styleId: 'Header' })
  headerCells.push({ value: t('financeAnalysis.countHeader'), styleId: 'Header' })
  headerCells.push({ value: t('financeAnalysis.cashCards.registers'), styleId: 'Header' })
  if (!hideBalances) {
    headerCells.push({ value: t('financeAnalysis.cashCards.totalBefore'), styleId: 'Header' })
    headerCells.push({ value: t('financeAnalysis.cashCards.totalAfter'), styleId: 'Header' })
  }
  headerCells.push({ value: t('financeAnalysis.cards.cashCountRevenue'), styleId: 'Header' })

  const mergeAcross = Math.max(headerCells.length - 1, 0)
  const rows = [
    createBandRow(mergeAcross + 1, t('financeAnalysis.cashCountOverviewExportTitle'), 'Title', 20),
    createBandRow(mergeAcross + 1, t('financeAnalysis.periodLabel', { start: formatDate(startDate), end: formatDate(endDate) }), 'Subtitle'),
    createBandRow(mergeAcross + 1, t('financeAnalysis.countLabel', { count: groupedRows.length }), 'BodyMuted'),
    createSpreadsheetRow(headerCells),
  ]

  if (groupedRows.length === 0) {
    rows.push(createSpreadsheetRow([{ value: t('financeAnalysis.noCashCounts'), styleId: 'Body', mergeAcross }]))
    return rows
  }

  rows.push(...groupedRows.map(group => {
    const cells: SpreadsheetCell[] = []
    if (options.exportGrouping !== 'none') cells.push({ value: group.groupLabel, styleId: 'TextCell' })
    if (options.exportSplitByMonth) cells.push({ value: formatMonthKey(group.monthKey, locale), styleId: 'TextCell' })
    cells.push(countCell(group.cashCountCount))
    cells.push(countCell(group.registerCount))
    if (!hideBalances) {
      cells.push(currencyCell(group.totalBeforeAmount))
      cells.push(currencyCell(group.totalAfterAmount))
    }
    cells.push(currencyCell(group.totalDifference, signedCurrencyStyle(group.totalDifference)))
    return createSpreadsheetRow(cells)
  }))

  return rows
}

function buildAnnualClosingRows(options: FinanceAnalysisReportOptions, includeBudgetComparison: boolean) {
  const { t, startDate, endDate, formatDate, costCentres, comparisonBudgetLines, comparisonBudgetLabel } = options
  const actualOwnAmounts = buildActualOwnAmountsByCostCentreId(options)
  const budgetOwnAmounts = buildBudgetOwnAmountsByCostCentreId(comparisonBudgetLines)
  const compareBudget = includeBudgetComparison && options.compareToBudget && Boolean(comparisonBudgetLines?.length)
  const visibleCostCentres = buildVisibleStatementCostCentres(
    options,
    actualOwnAmounts,
    compareBudget ? budgetOwnAmounts : undefined,
  )
  const actualSummaryByCostCentre = buildStatementSummaryMap(visibleCostCentres, actualOwnAmounts)
  const budgetSummaryByCostCentre = buildStatementSummaryMap(visibleCostCentres, budgetOwnAmounts)

  const actualTotals = visibleCostCentres
    .filter(row => row.depth === 0)
    .reduce((totals, row) => {
      const summary = actualSummaryByCostCentre.get(row.id)
      if (!summary) return totals
      totals.expense += summary.totalExpense
      totals.income += summary.totalIncome
      return totals
    }, { expense: 0, income: 0 })

  const budgetTotals = visibleCostCentres
    .filter(row => row.depth === 0)
    .reduce((totals, row) => {
      const summary = budgetSummaryByCostCentre.get(row.id)
      if (!summary) return totals
      totals.expense += summary.totalExpense
      totals.income += summary.totalIncome
      return totals
    }, { expense: 0, income: 0 })

  const actualSaldo = roundCurrency(actualTotals.income - actualTotals.expense)
  const budgetSaldo = roundCurrency(budgetTotals.income - budgetTotals.expense)
  const totalColumns = compareBudget ? 11 : 5
  const rowMergeAcross = totalColumns - 1

  const rows = [
    createBandRow(totalColumns, compareBudget ? t('financeAnalysis.annualClosingComparisonTitle') : t('financeAnalysis.annualClosingTitle'), 'Title', 22),
    createBandRow(totalColumns, t('financeAnalysis.periodLabel', { start: formatDate(startDate), end: formatDate(endDate) }), 'Subtitle'),
  ]

  if (compareBudget && comparisonBudgetLabel) {
    rows.push(createSpreadsheetRow([
      { value: t('financeAnalysis.compareBudgetLabel'), styleId: 'Label' },
      { value: comparisonBudgetLabel, styleId: 'Body', mergeAcross: totalColumns - 2 },
    ]))
  }

  rows.push(
    createBandRow(totalColumns, '', 'BodyMuted', 7),
    createBandRow(totalColumns, t('financeAnalysis.analysisTitle'), 'Section', 19),
    createSpreadsheetRow([
      { value: '', styleId: 'Header' },
      { value: '', styleId: 'Header' },
      { value: t('financeAnalysis.annualClosingActual'), styleId: 'Header', mergeAcross: 2 },
      ...(compareBudget ? [
        { value: t('financeAnalysis.annualClosingBudget'), styleId: 'Header', mergeAcross: 2 },
        { value: t('financeAnalysis.differenceHeader'), styleId: 'Header', mergeAcross: 2 },
      ] : []),
    ]),
    createSpreadsheetRow([
      { value: t('financeAnalysis.annualClosingCombinedAmounts'), styleId: 'GroupTextCell', mergeAcross: 1 },
      currencyCell(roundCurrency(actualTotals.expense), 'GroupCurrencyCell'),
      currencyCell(roundCurrency(actualTotals.income), 'GroupCurrencyCell'),
      currencyCell(actualSaldo, groupSignedCurrencyStyle(actualSaldo)),
      ...(compareBudget ? [
        currencyCell(roundCurrency(budgetTotals.expense), 'GroupCurrencyCell'),
        currencyCell(roundCurrency(budgetTotals.income), 'GroupCurrencyCell'),
        currencyCell(budgetSaldo, groupSignedCurrencyStyle(budgetSaldo)),
        currencyCell(roundCurrency(actualTotals.expense - budgetTotals.expense), groupSignedCurrencyStyle(actualTotals.expense - budgetTotals.expense)),
        currencyCell(roundCurrency(actualTotals.income - budgetTotals.income), groupSignedCurrencyStyle(actualTotals.income - budgetTotals.income)),
        currencyCell(roundCurrency(actualSaldo - budgetSaldo), groupSignedCurrencyStyle(actualSaldo - budgetSaldo)),
      ] : []),
    ]),
    createBandRow(totalColumns, '', 'BodyMuted', 7),
  )

  const headerCells: SpreadsheetCell[] = [
    { value: t('budget.costCentre'), styleId: 'Header' },
    { value: t('financeAnalysis.annualClosingCategoryLabel'), styleId: 'Header' },
    { value: t('financeAnalysis.annualClosingActual'), styleId: 'Header', mergeAcross: 2 },
  ]

  if (compareBudget) {
    headerCells.push(
      { value: t('financeAnalysis.annualClosingBudget'), styleId: 'Header', mergeAcross: 2 },
      { value: t('financeAnalysis.differenceHeader'), styleId: 'Header', mergeAcross: 2 },
    )
  }

  rows.push(createSpreadsheetRow(headerCells))
  rows.push(createSpreadsheetRow([
    { value: '', styleId: 'Header' },
    { value: '', styleId: 'Header' },
    { value: t('budget.expenses'), styleId: 'Header' },
    { value: t('budget.income'), styleId: 'Header' },
    { value: t('budget.saldo'), styleId: 'Header' },
    ...(compareBudget ? [
      { value: t('budget.expenses'), styleId: 'Header' },
      { value: t('budget.income'), styleId: 'Header' },
      { value: t('budget.saldo'), styleId: 'Header' },
      { value: t('budget.expenses'), styleId: 'Header' },
      { value: t('budget.income'), styleId: 'Header' },
      { value: t('budget.saldo'), styleId: 'Header' },
    ] : []),
  ]))

  if (visibleCostCentres.length === 0) {
    rows.push(createSpreadsheetRow([{ value: t('financeAnalysis.noCostCentres'), styleId: 'Body', mergeAcross: rowMergeAcross }]))
    return rows
  }

  visibleCostCentres.forEach((costCentre, index) => {
    const actual = actualSummaryByCostCentre.get(costCentre.id) ?? {
      ownExpense: 0, ownIncome: 0, ownSaldo: 0,
      childExpense: 0, childIncome: 0, childSaldo: 0,
      totalExpense: 0, totalIncome: 0, totalSaldo: 0,
    }
    const budget = budgetSummaryByCostCentre.get(costCentre.id) ?? {
      ownExpense: 0, ownIncome: 0, ownSaldo: 0,
      childExpense: 0, childIncome: 0, childSaldo: 0,
      totalExpense: 0, totalIncome: 0, totalSaldo: 0,
    }

    if (costCentre.depth === 0 && index > 0) {
      rows.push(createBandRow(totalColumns, '', 'BodyMuted', 6))
    }

    const labelPrefix = costCentre.depth > 0 ? `${'  '.repeat(costCentre.depth)}|- ` : ''
    const label = `${labelPrefix}${costCentre.code} - ${costCentre.name}`
    const isGroupRow = costCentre.depth === 0
    const textStyle = isGroupRow ? 'GroupTextCell' : 'TextCell'
    const currencyStyle = isGroupRow ? 'GroupCurrencyCell' : 'CurrencyCell'
    const saldoStyle = isGroupRow ? groupSignedCurrencyStyle : signedCurrencyStyle

    const buildAnnualClosingValueRow = (
      costCentreLabel: string,
      categoryLabel: string,
      categoryStyle: string,
      amountExpense: number,
      amountIncome: number,
      amountSaldo: number,
      budgetExpense: number,
      budgetIncome: number,
      budgetSaldoValue: number,
    ) => {
      const rowCells: SpreadsheetCell[] = [
        { value: costCentreLabel, styleId: textStyle },
        { value: categoryLabel, styleId: categoryStyle },
        currencyCell(amountExpense, currencyStyle),
        currencyCell(amountIncome, currencyStyle),
        currencyCell(amountSaldo, saldoStyle(amountSaldo)),
      ]

      if (compareBudget) {
        rowCells.push(
          currencyCell(budgetExpense, currencyStyle),
          currencyCell(budgetIncome, currencyStyle),
          currencyCell(budgetSaldoValue, saldoStyle(budgetSaldoValue)),
          currencyCell(roundCurrency(amountExpense - budgetExpense), saldoStyle(amountExpense - budgetExpense)),
          currencyCell(roundCurrency(amountIncome - budgetIncome), saldoStyle(amountIncome - budgetIncome)),
          currencyCell(roundCurrency(amountSaldo - budgetSaldoValue), saldoStyle(amountSaldo - budgetSaldoValue)),
        )
      }

      rows.push(createSpreadsheetRow(rowCells, isGroupRow ? 18 : undefined))
    }

    if (costCentre.hasChildren) {
      buildAnnualClosingValueRow(
        label,
        t('financeAnalysis.annualClosingCombinedAmounts'),
        textStyle,
        actual.totalExpense,
        actual.totalIncome,
        actual.totalSaldo,
        budget.totalExpense,
        budget.totalIncome,
        budget.totalSaldo,
      )
      buildAnnualClosingValueRow(
        '',
        t('financeAnalysis.annualClosingOwnAmounts'),
        textStyle,
        actual.ownExpense,
        actual.ownIncome,
        actual.ownSaldo,
        0,
        0,
        0,
      )
      buildAnnualClosingValueRow(
        '',
        t('financeAnalysis.annualClosingChildAmounts'),
        textStyle,
        actual.childExpense,
        actual.childIncome,
        actual.childSaldo,
        0,
        0,
        0,
      )
      return
    }

    buildAnnualClosingValueRow(
      label,
      '',
      textStyle,
      actual.ownExpense,
      actual.ownIncome,
      actual.ownSaldo,
      budget.totalExpense,
      budget.totalIncome,
      budget.totalSaldo,
    )
  })

  return rows
}

function buildAnnualClosingColumnWidths(options: FinanceAnalysisReportOptions) {
  return options.compareToBudget && options.comparisonBudgetLines?.length
    ? [200, 145, 54, 54, 54, 54, 54, 54, 54, 54, 54]
    : [220, 155, 62, 62, 62]
}

function hasBudgetComparisonSheet(options: FinanceAnalysisReportOptions) {
  return options.compareToBudget && Boolean(options.comparisonBudgetLines?.length)
}

function buildReceiptOverviewColumnWidths(options: FinanceAnalysisReportOptions) {
  const widths: number[] = []
  if (options.exportGrouping !== 'none') widths.push(185)
  if (options.exportSplitByMonth) widths.push(92)
  if (options.exportSplitByPaymentStatus) widths.push(112)
  widths.push(72, 100)
  return widths
}

function buildCashCountOverviewColumnWidths(options: FinanceAnalysisReportOptions) {
  const widths: number[] = []
  if (options.exportGrouping !== 'none') widths.push(190)
  if (options.exportSplitByMonth) widths.push(92)
  widths.push(70, 70)
  if (options.exportGrouping === 'none') widths.push(98, 98)
  widths.push(100)
  return widths
}

function scaleColumnWidthsToTotal(widths: number[], targetTotal: number) {
  if (widths.length === 0) return []

  const currentTotal = widths.reduce((sum, width) => sum + width, 0)
  if (currentTotal === targetTotal) return [...widths]

  const scale = targetTotal / currentTotal
  const scaledWidths = widths.map(width => Math.max(40, Math.round(width * scale)))
  const difference = targetTotal - scaledWidths.reduce((sum, width) => sum + width, 0)
  const lastIndex = scaledWidths.length - 1
  scaledWidths[lastIndex] = (scaledWidths[lastIndex] || 0) + difference

  return scaledWidths
}

function prependWorksheetBranding(
  sheet: SpreadsheetWorksheetDefinition,
  logo?: FinanceAnalysisReportLogo | null,
): SpreadsheetWorksheetDefinition {
  if (!logo) {
    return {
      ...sheet,
      marginLeft: WORKSHEET_MARGIN,
      marginRight: WORKSHEET_MARGIN,
      marginTop: WORKSHEET_MARGIN,
      marginBottom: WORKSHEET_MARGIN,
    }
  }

  const lastColumnIndex = Math.max(sheet.columnWidths.length - 1, 0)
  const logoWidth = sheet.columnWidths.length <= 4 ? 2 : 3
  const firstLogoColumn = Math.max(lastColumnIndex - (logoWidth - 1), 0)
  const availableWidthUnits = sheet.columnWidths
    .slice(firstLogoColumn, lastColumnIndex + 1)
    .reduce((sum, width) => sum + width, 0)
  const lastColumnWidthUnits = sheet.columnWidths[lastColumnIndex] ?? 40
  const sourceRatio = logo.width > 0 && logo.height > 0 ? logo.width / logo.height : 1
  const maxWidthPx = Math.max(availableWidthUnits * 0.72, 48)
  const maxHeightPx = 24
  let displayHeightPx = maxHeightPx
  let displayWidthPx = displayHeightPx * sourceRatio

  if (displayWidthPx > maxWidthPx) {
    displayWidthPx = maxWidthPx
    displayHeightPx = displayWidthPx / Math.max(sourceRatio, 0.1)
  }

  const lastColumnWidthPx = Math.max(lastColumnWidthUnits, displayWidthPx)
  const rightPaddingPx = 6
  const columnOffsetPx = Math.max(lastColumnWidthPx - displayWidthPx - rightPaddingPx, 0)

  const images: SpreadsheetImageDefinition[] = [{
    data: logo.data,
    extension: logo.extension,
    mimeType: logo.mimeType,
    fileName: 'association-logo',
    altText: 'Association logo',
    anchor: {
      fromColumn: lastColumnIndex,
      fromRow: 0,
      fromColumnOffset: Math.round(columnOffsetPx * EMU_PER_PIXEL),
      fromRowOffset: 20000,
      widthEmu: Math.round(displayWidthPx * EMU_PER_PIXEL),
      heightEmu: Math.round(displayHeightPx * EMU_PER_PIXEL),
    },
  }]

  return {
    ...sheet,
    marginLeft: WORKSHEET_MARGIN,
    marginRight: WORKSHEET_MARGIN,
    marginTop: WORKSHEET_MARGIN,
    marginBottom: WORKSHEET_MARGIN,
    rows: [
      createSpreadsheetRow([{ value: '', styleId: 'BodyMuted', mergeAcross: Math.max(sheet.columnWidths.length - 1, 0) }], BRANDING_ROW_HEIGHT),
      ...sheet.rows,
    ],
    images,
  }
}

function buildWorkbook(options: FinanceAnalysisReportOptions) {
  const overviewColumnWidths = options.includeComparison && options.comparisonAnalysis
    ? [190, 92, 118, 118]
    : [220, 156, 156]
  const overviewSheetTargetWidth = 760
  const receiptColumnWidths = options.includeComparison
    ? [86, 138, 172, 90, 70, 70]
    : [86, 138, 172, 90, 82]
  const cashCountColumnWidths = [104, 140, 168, 92, 92, 92, 60, 78, 78, 78]
  const bankStatementColumnWidths = [86, 84, 96, 132, 190, 96, 132, 160]
  const invoiceColumnWidths = options.includeComparison
    ? [86, 132, 186, 94, 70, 70]
    : [86, 132, 186, 94, 82]
  const balanceColumnWidths = [80, 180, 100, 80, 82, 82, 82, 72, 72, 82, 160]
  const annualClosingColumnWidths = buildAnnualClosingColumnWidths(options)
  const receiptOverviewColumnWidths = buildReceiptOverviewColumnWidths(options)
  const cashCountOverviewColumnWidths = buildCashCountOverviewColumnWidths(options)
  const annualClosingSheetTargetWidth = 720
  const detailSheetTargetWidth = 1380
  const detailSheetWidth = Math.max(
    detailSheetTargetWidth,
    annualClosingColumnWidths.reduce((sum, width) => sum + width, 0),
    receiptColumnWidths.reduce((sum, width) => sum + width, 0),
    cashCountColumnWidths.reduce((sum, width) => sum + width, 0),
    bankStatementColumnWidths.reduce((sum, width) => sum + width, 0),
    invoiceColumnWidths.reduce((sum, width) => sum + width, 0),
    balanceColumnWidths.reduce((sum, width) => sum + width, 0),
    receiptOverviewColumnWidths.reduce((sum, width) => sum + width, 0),
    cashCountOverviewColumnWidths.reduce((sum, width) => sum + width, 0),
  )

  const sheets: SpreadsheetWorksheetDefinition[] = []

  if (options.includeOverview) {
    sheets.push({
      name: options.t('financeAnalysis.analysisTitle'),
      columnWidths: scaleColumnWidthsToTotal(overviewColumnWidths, overviewSheetTargetWidth),
      rows: buildOverviewRows(options),
      orientation: 'portrait',
      fitToHeight: 1,
    })
  }

  if (options.annualClosing) {
    sheets.push({
      name: options.t('financeAnalysis.annualClosingTitle'),
      columnWidths: scaleColumnWidthsToTotal(buildAnnualClosingColumnWidths({ ...options, compareToBudget: false }), annualClosingSheetTargetWidth),
      rows: buildAnnualClosingRows({ ...options, compareToBudget: false }, false),
      orientation: 'portrait',
      fitToHeight: 1,
    })
  }

  if (hasBudgetComparisonSheet(options)) {
    sheets.push({
      name: options.t('financeAnalysis.annualClosingComparisonTitle'),
      columnWidths: scaleColumnWidthsToTotal(annualClosingColumnWidths, detailSheetWidth),
      rows: buildAnnualClosingRows(options, true),
      orientation: 'landscape',
      fitToHeight: 1,
    })
  }

  if (hasReceiptOverviewExport(options)) {
    sheets.push({
      name: options.t('financeAnalysis.receiptOverviewExportTitle'),
      columnWidths: scaleColumnWidthsToTotal(receiptOverviewColumnWidths, detailSheetWidth),
      rows: buildReceiptOverviewRows(options),
      orientation: 'landscape',
    })
  }

  if (hasCashCountOverviewExport(options)) {
    sheets.push({
      name: options.t('financeAnalysis.cashCountOverviewExportTitle'),
      columnWidths: scaleColumnWidthsToTotal(cashCountOverviewColumnWidths, detailSheetWidth),
      rows: buildCashCountOverviewRows(options),
      orientation: 'landscape',
    })
  }

  if (options.includeBalanceSheet) {
    sheets.push({
      name: options.t('financeAnalysis.liquidity.title'),
      columnWidths: scaleColumnWidthsToTotal(balanceColumnWidths, detailSheetWidth),
      rows: buildBalanceRows(options),
      orientation: 'landscape',
    })
  }

  if (hasReceiptOverviewExport(options)) {
    sheets.push({
      name: options.t('financeAnalysis.invoiceOverviewExportTitle'),
      columnWidths: scaleColumnWidthsToTotal(receiptOverviewColumnWidths, detailSheetWidth),
      rows: buildInvoiceOverviewRows(options),
      orientation: 'landscape',
    })
  }

  if (options.includeReceiptList) {
    sheets.push({
      name: options.t('financeAnalysis.receiptsTableTitle'),
      columnWidths: scaleColumnWidthsToTotal(receiptColumnWidths, detailSheetWidth),
      rows: buildReceiptRows(options),
      orientation: 'landscape',
    })
  }

  if (options.includeCashCountList) {
    sheets.push({
      name: options.t('financeAnalysis.cashCountsTableTitle'),
      columnWidths: scaleColumnWidthsToTotal(cashCountColumnWidths, detailSheetWidth),
      rows: buildCashCountRows(options),
      orientation: 'landscape',
    })
  }

  if (options.includeBankStatementList) {
    sheets.push({
      name: options.t('financeAnalysis.bankStatementsTableTitle'),
      columnWidths: scaleColumnWidthsToTotal(bankStatementColumnWidths, detailSheetWidth),
      rows: buildBankStatementRows(options),
      orientation: 'landscape',
    })
  }

  if (options.includeInvoiceList) {
    sheets.push({
      name: options.t('financeAnalysis.invoicesTableTitle'),
      columnWidths: scaleColumnWidthsToTotal(invoiceColumnWidths, detailSheetWidth),
      rows: buildInvoiceRows(options),
      orientation: 'landscape',
    })
  }

  // A workbook needs at least one sheet — fall back to the overview if everything was deselected.
  if (!sheets.length) {
    sheets.push({
      name: options.t('financeAnalysis.analysisTitle'),
      columnWidths: scaleColumnWidthsToTotal(overviewColumnWidths, overviewSheetTargetWidth),
      rows: buildOverviewRows(options),
      orientation: 'portrait',
      fitToHeight: 1,
    })
  }

  return createSpreadsheetWorkbook({
    sheets: sheets.map(sheet => prependWorksheetBranding(sheet, options.logo)),
  })
}

export function downloadFinanceAnalysisReport(options: FinanceAnalysisReportOptions) {
  const workbook = buildWorkbook(options)
  downloadExcelWorkbook(workbook, exportFileName(options.startDate, options.endDate, options.selectedCostCentre))
}
