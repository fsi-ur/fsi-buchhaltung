import { estimateTextWidth, wrapTextByWidth, type PdfColor } from '~/server/utils/pdf'
import { createPdfDocumentLayout, PDF_LAYOUT, type PdfDocumentLayout } from '~/server/utils/pdfLayout'
import { PDF_COLORS } from '~/config/pdfColors'
import type { FinanceAnalysisFilters } from '~/server/utils/financeAnalysis/filters'
import { aggregateCashCountBreakdown, allocateBankEventRevenue } from '~/shared/financeAnalysisGrouping'
import type { AssociationProfileRow } from '~/types/association'
import type { BudgetCostCentreLine } from '~/types/budget'
import type { CostCentreRow } from '~/types/costCentre'
import type {
  FinanceAnalysisBankStatementPosition,
  FinanceAnalysisCostCentreSplit,
  FinanceAnalysisData,
  FinanceAnalysisInvoiceItem,
  FinanceAnalysisReceiptItem,
  FinanceLiquidityRow,
} from '~/types/financeAnalysis'
import { InvoiceStatus } from '~/types/invoice'
import { ReceiptStatus } from '~/types/receipt'

export type FinanceAnalysisExportGrouping = 'none' | 'costCentres' | 'spheres'

export interface FinanceAnalysisPdfOptions {
  analysis: FinanceAnalysisData
  comparisonAnalysis: FinanceAnalysisData | null
  filters: FinanceAnalysisFilters
  costCentres: CostCentreRow[]
  annualClosing: boolean
  compareToBudget: boolean
  comparisonBudgetLabel: string | null
  comparisonBudgetLines: BudgetCostCentreLine[]
  exportGrouping: FinanceAnalysisExportGrouping
  exportSplitByMonth: boolean
  exportSplitByPaymentStatus: boolean
  includeTableOfContents: boolean
  includeBalanceSheet: boolean
  includeOverview: boolean
  includeReceiptList: boolean
  includeCashCountList: boolean
  includeBankStatementList: boolean
  includeInvoiceList: boolean
  association: AssociationProfileRow | null
  logo?: { mimeType: string, data: Buffer } | null
}

const RECEIPT_STATUS_LABELS: Record<ReceiptStatus, string> = {
  [ReceiptStatus.Draft]: 'Entwurf',
  [ReceiptStatus.Open]: 'Offen',
  [ReceiptStatus.Paid]: 'Bezahlt',
  [ReceiptStatus.Cancelled]: 'Storniert',
}

const INVOICE_STATUS_LABELS: Record<InvoiceStatus, string> = {
  [InvoiceStatus.Draft]: 'Entwurf',
  [InvoiceStatus.Open]: 'Offen',
  [InvoiceStatus.Paid]: 'Bezahlt',
  [InvoiceStatus.Cancelled]: 'Storniert',
}

const RECEIPT_STATUS_ORDER: ReceiptStatus[] = [ReceiptStatus.Draft, ReceiptStatus.Open, ReceiptStatus.Paid, ReceiptStatus.Cancelled]
const INVOICE_STATUS_ORDER: InvoiceStatus[] = [InvoiceStatus.Draft, InvoiceStatus.Open, InvoiceStatus.Paid, InvoiceStatus.Cancelled]

/** Cell for a signed figure: red when it takes money out, green when it brings money in. */
function signedMoneyCell(value: number, bold = false): TableCell {
  const rounded = roundCurrency(value)
  return {
    text: formatMoney(rounded),
    color: rounded < 0 ? PDF_COLORS.negative : rounded > 0 ? PDF_COLORS.positive : undefined,
    bold,
  }
}

/**
 * Variance on an expense line, where the sign reads the other way round: spending above the
 * budget is the bad direction, so a positive difference is the red one.
 */
function expenseVarianceCell(value: number): TableCell {
  const rounded = roundCurrency(value)
  return {
    text: formatMoney(rounded),
    color: rounded > 0 ? PDF_COLORS.negative : rounded < 0 ? PDF_COLORS.positive : undefined,
  }
}

const MONTH_NAMES_SHORT = ['Jan.', 'Feb.', 'März', 'Apr.', 'Mai', 'Juni', 'Juli', 'Aug.', 'Sep.', 'Okt.', 'Nov.', 'Dez.']

const LIQUIDITY_TYPE_LABELS: Record<FinanceLiquidityRow['type'], string> = {
  opening: 'Anfangsbestand',
  closing: 'Endbestand',
  cashReceipt: 'Barzahlung (Beleg)',
  cashInvoice: 'Einnahme (Rechnung)',
  reimbursementReceipt: 'Erstattung',
  bankReceipt: 'Bankabbuchung (Beleg)',
  bankInvoice: 'Bankeingang (Rechnung)',
  bankEvent: 'Kontoauszug (Veranstaltung)',
  bankStatementCheckpoint: 'Kontoauszug geprüft',
  cashCountRegister: 'Kassenzählung',
  cashCountRevenue: 'Kasseneinnahmen',
  registerCheck: 'Kassenbestandsprüfung',
}

function roundCurrency(value: number) {
  return Number(value.toFixed(2))
}

function formatMoney(value: number) {
  const sign = value < 0 ? '-' : ''
  const [integer, decimals] = Math.abs(value).toFixed(2).split('.')
  const grouped = integer!.replace(/\B(?=(\d{3})+(?!\d))/g, '.')
  return `${sign}${grouped},${decimals} €`
}

function formatCount(value: number) {
  return String(value)
}

function formatDate(value: string | null | undefined) {
  if (!value) return '-'
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (!match) return value
  return `${match[3]}.${match[2]}.${match[1]}`
}

function formatDateTime(value: string | null | undefined) {
  if (!value) return '-'
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/)
  if (!match) return formatDate(value)
  return `${match[3]}.${match[2]}.${match[1]} ${match[4]}:${match[5]}`
}

function formatMonthKey(monthKey: string) {
  const match = monthKey.match(/^(\d{4})-(\d{2})$/)
  if (!match) return monthKey
  const monthIndex = Number(match[2]) - 1
  if (monthIndex < 0 || monthIndex > 11) return monthKey
  return `${MONTH_NAMES_SHORT[monthIndex]} ${match[1]}`
}

function getReceiptDateValue(receipt: FinanceAnalysisReceiptItem, field: FinanceAnalysisFilters['receiptDateField']) {
  if (field === 'reimbursement_submitted_at') return receipt.reimbursement_submitted_at || receipt.receipt_date
  return receipt.receipt_date
}

function getInvoiceDateValue(invoice: FinanceAnalysisInvoiceItem, field: FinanceAnalysisFilters['invoiceDateField']) {
  if (field === 'due_date') return invoice.due_date
  if (field === 'service_date') return invoice.service_date
  if (field === 'paid_at') return invoice.paid_at
  return invoice.invoice_date
}

// ---------------------------------------------------------------------------
// Statement tree (Rechnungsabschluss / Haushaltsplanvergleich), mirrors the
// aggregation used by the Excel export in utils/excel/financeAnalysisReport.ts.
// ---------------------------------------------------------------------------

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

function buildVisibleStatementCostCentres(
  params: {
    costCentres: CostCentreRow[]
    selectedCostCentre: CostCentreRow | null
    includeChildCostCentres: boolean
  },
  actualOwnAmountsByCostCentreId: StatementAmountMap,
  budgetOwnAmountsByCostCentreId: StatementAmountMap = new Map(),
) {
  const { costCentres, selectedCostCentre, includeChildCostCentres } = params
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
  ownAmountsByCostCentreId: StatementAmountMap,
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

function buildActualOwnAmountsByCostCentreId(analysis: FinanceAnalysisData) {
  const amounts: StatementAmountMap = new Map()
  const add = (costCentreId: number, expense: number, income: number) => {
    const current = amounts.get(costCentreId) ?? { expense: 0, income: 0 }
    current.expense = roundCurrency(current.expense + expense)
    current.income = roundCurrency(current.income + income)
    amounts.set(costCentreId, current)
  }

  analysis.receiptBreakdown
    .filter(item => item.group_type === 'costCentre')
    .forEach((item) => {
      if (item.group_id !== null) add(item.group_id, item.total_amount, 0)
    })

  analysis.invoiceBreakdown
    .filter(item => item.group_type === 'costCentre')
    .forEach((item) => {
      if (item.group_id !== null) add(item.group_id, 0, item.total_amount)
    })

  analysis.cashCounts.forEach((cashCount) => {
    cashCount.cost_centres.forEach((costCentre) => {
      const factor = Number(costCentre.allocation_percentage || 0) / 100
      add(costCentre.cost_centre_id, 0, roundCurrency(cashCount.total_difference * factor))
    })
  })

  allocateBankEventRevenue(analysis.bankStatementPositions, (costCentreId, income) => add(costCentreId, 0, income))

  return amounts
}

function buildBudgetOwnAmountsByCostCentreId(lines: BudgetCostCentreLine[]) {
  const amounts: StatementAmountMap = new Map()
  for (const line of lines) {
    const costCentreId = Number(line.cost_centre_id)
    const current = amounts.get(costCentreId) ?? { expense: 0, income: 0 }
    current.expense = roundCurrency(current.expense + Number(line.expense_amount || 0))
    current.income = roundCurrency(current.income + Number(line.income_amount || 0))
    amounts.set(costCentreId, current)
  }
  return amounts
}

// ---------------------------------------------------------------------------
// Grouped overview aggregates (Belegübersicht / Rechnungsübersicht / Kassenzählungsübersicht)
// ---------------------------------------------------------------------------

interface OverviewAggregate {
  groupLabel: string
  monthKey: string
  status: string
  count: number
  totalAmount: number
}

interface CashCountOverviewAggregate {
  groupLabel: string
  monthKey: string
  cashCountCount: number
  registerCount: number
  totalBeforeAmount: number
  totalAfterAmount: number
  totalDifference: number
}

function buildReceiptOverviewAggregates(options: FinanceAnalysisPdfOptions): OverviewAggregate[] {
  const groups = new Map<string, OverviewAggregate>()

  const pushAggregate = (groupLabel: string, monthKey: string, status: string, count: number, totalAmount: number) => {
    const key = [groupLabel, monthKey, status].join('|')
    const current = groups.get(key)
    if (current) {
      current.count += count
      current.totalAmount += totalAmount
      return
    }
    groups.set(key, { groupLabel, monthKey, status, count, totalAmount })
  }

  if (options.exportGrouping === 'none') {
    options.analysis.receipts.forEach((receipt) => {
      pushAggregate(
        '',
        options.exportSplitByMonth ? getReceiptDateValue(receipt, options.filters.receiptDateField).slice(0, 7) : '',
        options.exportSplitByPaymentStatus ? receipt.status : '',
        1,
        receipt.total_amount,
      )
    })
  } else {
    const targetGroupType = options.exportGrouping === 'costCentres' ? 'costCentre' : 'sphere'

    options.analysis.receiptBreakdown
      .filter(item => item.group_type === targetGroupType)
      .forEach((item) => {
        const groupLabel = [item.group_code, item.group_name].filter(Boolean).join(' - ') || 'Nicht ausgewählt'
        pushAggregate(
          groupLabel,
          options.exportSplitByMonth ? item.month_key : '',
          options.exportSplitByPaymentStatus ? item.status : '',
          item.receipt_count,
          item.total_amount,
        )
      })
  }

  return sortOverviewAggregates(groups, RECEIPT_STATUS_ORDER as string[])
}

function buildInvoiceOverviewAggregates(options: FinanceAnalysisPdfOptions): OverviewAggregate[] {
  const groups = new Map<string, OverviewAggregate>()

  const pushAggregate = (groupLabel: string, monthKey: string, status: string, count: number, totalAmount: number) => {
    const key = [groupLabel, monthKey, status].join('|')
    const current = groups.get(key)
    if (current) {
      current.count += count
      current.totalAmount += totalAmount
      return
    }
    groups.set(key, { groupLabel, monthKey, status, count, totalAmount })
  }

  if (options.exportGrouping === 'none') {
    options.analysis.invoices.forEach((invoice) => {
      const invoiceDate = getInvoiceDateValue(invoice, options.filters.invoiceDateField) || invoice.invoice_date
      pushAggregate(
        '',
        options.exportSplitByMonth ? invoiceDate.slice(0, 7) : '',
        options.exportSplitByPaymentStatus ? invoice.status : '',
        1,
        invoice.total_amount,
      )
    })
  } else {
    const targetGroupType = options.exportGrouping === 'costCentres' ? 'costCentre' : 'sphere'

    options.analysis.invoiceBreakdown
      .filter(item => item.group_type === targetGroupType)
      .forEach((item) => {
        const groupLabel = [item.group_code, item.group_name].filter(Boolean).join(' - ') || 'Nicht ausgewählt'
        pushAggregate(
          groupLabel,
          options.exportSplitByMonth ? item.month_key : '',
          options.exportSplitByPaymentStatus ? item.status : '',
          item.invoice_count,
          item.total_amount,
        )
      })
  }

  return sortOverviewAggregates(groups, INVOICE_STATUS_ORDER as string[])
}

function sortOverviewAggregates(groups: Map<string, OverviewAggregate>, statusOrder: string[]) {
  return Array.from(groups.values())
    .map(group => ({
      ...group,
      count: Number(group.count.toFixed(0)),
      totalAmount: roundCurrency(group.totalAmount),
    }))
    .sort((left, right) => {
      if (left.groupLabel !== right.groupLabel) return left.groupLabel.localeCompare(right.groupLabel)
      if (left.monthKey !== right.monthKey) return left.monthKey.localeCompare(right.monthKey)
      return statusOrder.indexOf(left.status) - statusOrder.indexOf(right.status)
    })
}

/** "SP - Sphäre / KST - Kostenstelle (40,00%)" for every share of an event's split. */
function formatCostCentreSplits(splits: FinanceAnalysisCostCentreSplit[]) {
  if (!splits.length) return '-'

  return splits
    .map((split) => {
      const sphereLabel = [split.sphere_code, split.sphere_name].filter(Boolean).join(' - ')
      const costCentreLabel = [split.code, split.name].filter(Boolean).join(' - ')
      const label = sphereLabel ? `${sphereLabel} / ${costCentreLabel}` : costCentreLabel
      return splits.length > 1 ? `${label} (${split.allocation_percentage.toFixed(2)}%)` : label
    })
    .join(', ')
}

const BANK_POSITION_TYPE_LABELS: Record<FinanceAnalysisBankStatementPosition['position_type'], string> = {
  receipt: 'Beleg',
  invoice: 'Rechnung',
  event: 'Veranstaltung',
}

interface BankStatementOverviewAggregate {
  typeLabel: string
  monthKey: string
  count: number
  inflow: number
  outflow: number
}

/**
 * Statement positions summarised by what they settle. Only event positions carry a cost centre,
 * so the report groups by position type instead — the one axis every position actually has.
 */
function buildBankStatementOverviewAggregates(options: FinanceAnalysisPdfOptions): BankStatementOverviewAggregate[] {
  const groups = new Map<string, BankStatementOverviewAggregate>()

  for (const position of options.analysis.bankStatementPositions) {
    const typeLabel = BANK_POSITION_TYPE_LABELS[position.position_type]
    const monthKey = options.exportSplitByMonth ? position.position_date.slice(0, 7) : ''
    const key = `${typeLabel}|${monthKey}`

    const current = groups.get(key) ?? { typeLabel, monthKey, count: 0, inflow: 0, outflow: 0 }
    current.count += 1
    if (position.direction === 'in') current.inflow += position.amount
    else current.outflow += position.amount
    groups.set(key, current)
  }

  return Array.from(groups.values())
    .map(group => ({
      ...group,
      inflow: roundCurrency(group.inflow),
      outflow: roundCurrency(group.outflow),
    }))
    .sort((left, right) => (
      left.typeLabel.localeCompare(right.typeLabel) || left.monthKey.localeCompare(right.monthKey)
    ))
}

function buildCashCountOverviewAggregates(options: FinanceAnalysisPdfOptions): CashCountOverviewAggregate[] {
  return aggregateCashCountBreakdown(
    options.analysis.cashCountBreakdown,
    options.exportGrouping,
    options.exportSplitByMonth,
    {
      unassigned: '-',
      formatGroup: (code, name) => [code, name].filter(Boolean).join(' - '),
    },
  )
}

// ---------------------------------------------------------------------------
// Liquidity row labels
// ---------------------------------------------------------------------------

function liquidityRowLabel(row: FinanceLiquidityRow) {
  const typeLabel = LIQUIDITY_TYPE_LABELS[row.type]

  if (row.type === 'opening' || row.type === 'closing') return typeLabel
  if (row.type === 'bankStatementCheckpoint') return row.label ? `${typeLabel}: ${row.label}` : typeLabel

  // Reimbursement labels start with the receipt number, which the export already shows as reference.
  let label = row.label
  if (row.type === 'reimbursementReceipt' && row.reference && label.startsWith(row.reference)) {
    label = label.slice(row.reference.length).trim()
  }

  const base = label ? `${typeLabel}: ${label}` : typeLabel
  if ((row.type === 'cashCountRegister' || row.type === 'cashCountRevenue' || row.type === 'registerCheck') && row.register_number !== null) {
    return `${base} (Kasse ${row.register_number})`
  }
  return base
}

function liquidityRowNote(row: FinanceLiquidityRow) {
  const note = row.note ?? ''

  if (note === 'firstCountNote') return 'Erste Zählung dieser Kasse (Anfangsbestand)'
  if (note === 'eventRevenueNote') return 'Veranstaltungseinnahmen'
  if (note === 'unfilteredNote') return 'Liquidität wird ungefiltert dargestellt (Kostenstellenfilter gilt nicht für Kassenbuch)'
  if (note === 'discrepancyFound' || row.has_discrepancy) return 'Abweichung zum Buchbestand'

  if (note.startsWith('reimbursementNote:')) {
    const member = note.slice('reimbursementNote:'.length)
    return `Erstattung, Auszahlung an ${member}`
  }
  if (note.startsWith('bankCheckedNote:')) {
    // The check date matches the row date shown in the Datum column, so only name the checker.
    const checkedBy = note.split(':').slice(2).join(':')
    return checkedBy ? `Bank geprüft von ${checkedBy}` : ''
  }

  return ''
}

// ---------------------------------------------------------------------------
// Generic section table renderer
// ---------------------------------------------------------------------------

interface TableColumn {
  label: string
  width: number
  align?: 'left' | 'right'
}

interface TableCell {
  text: string
  subLines?: string[]
  color?: PdfColor
  bold?: boolean
}

/** Row background, matching how the app tints a list row. `band` is the plain accent emphasis. */
type TableRowTone = 'warning' | 'success' | 'neutral'

interface TableRowDef {
  cells: Array<string | TableCell>
  bold?: boolean
  band?: boolean
  spacerBefore?: boolean
  tone?: TableRowTone
}

const ROW_TONE_FILLS: Record<TableRowTone, PdfColor> = {
  warning: PDF_COLORS.warningWash,
  success: PDF_COLORS.positiveWash,
  neutral: PDF_COLORS.neutralWash,
}

interface TocEntry {
  label: string
  group: string
  pageIndex: number
}

const CELL_PADDING = 4
const LINE_HEIGHT = 11
const SUB_LINE_HEIGHT = 10
const SECTION_GAP = 20

function renderSectionTable(layout: PdfDocumentLayout, params: {
  title?: string
  metaLine?: string
  columns: TableColumn[]
  rows: TableRowDef[]
  emptyText?: string
  headerless?: boolean
  toc?: { entries: TocEntry[], group: string }
}) {
  const { title, metaLine, columns, rows, emptyText, headerless = false, toc } = params
  const { contentLeft, contentRight } = PDF_LAYOUT
  const tableWidth = contentRight - contentLeft

  const totalWeight = columns.reduce((sum, column) => sum + column.width, 0)
  const bounds: number[] = [contentLeft]
  let cursor = contentLeft
  for (const column of columns) {
    cursor += (tableWidth * column.width) / totalWeight
    bounds.push(cursor)
  }
  bounds[bounds.length - 1] = contentRight

  const columnTextWidth = (index: number) => bounds[index + 1]! - bounds[index]! - (2 * CELL_PADDING)
  const cellTextPosition = (index: number) => {
    const column = columns[index]!
    return column.align === 'right'
      ? { x: bounds[index + 1]! - CELL_PADDING, align: 'right' as const }
      : { x: bounds[index]! + CELL_PADDING, align: 'left' as const }
  }

  const drawTableHeader = () => {
    if (headerless) return
    const labelLines = columns.map((column, index) => (column.label
      ? wrapTextByWidth(column.label, columnTextWidth(index), 9)
      : []))
    const headerHeight = labelLines.reduce((height, lines) => Math.max(height, lines.length * LINE_HEIGHT), LINE_HEIGHT) + 6

    layout.page.rects.push({
      x: contentLeft,
      y: layout.y - headerHeight,
      width: tableWidth,
      height: headerHeight,
      fill: true,
      color: PDF_COLORS.accentTint,
    })
    layout.page.lines.push({
      x1: contentLeft,
      y1: layout.y - headerHeight,
      x2: contentRight,
      y2: layout.y - headerHeight,
      width: 1,
      color: PDF_COLORS.accent,
    })
    columns.forEach((column, index) => {
      const { x, align } = cellTextPosition(index)
      labelLines[index]!.forEach((line, lineIndex) => {
        if (!line) return
        layout.page.texts.push({
          x,
          y: layout.y - 11 - (lineIndex * LINE_HEIGHT),
          size: 9,
          text: line,
          font: 'F2',
          align,
          color: PDF_COLORS.accent,
        })
      })
    })
    layout.y -= headerHeight + 5
  }

  // Keep the section title, table header and at least one row together.
  layout.ensureSpace((title ? 24 : 0) + (metaLine ? 16 : 0) + (headerless ? 0 : 22) + 30)

  if (title) {
    toc?.entries.push({ label: title, group: toc.group, pageIndex: layout.pageIndex })
    layout.page.texts.push({ x: contentLeft, y: layout.y - 12, size: 12.5, text: title, font: 'F2', color: PDF_COLORS.accent })
    layout.page.rects.push({
      x: contentLeft,
      y: layout.y - 19,
      width: 34,
      height: 2,
      fill: true,
      color: PDF_COLORS.accent,
    })
    layout.y -= metaLine ? 22 : 24
  }
  if (metaLine) {
    layout.page.texts.push({ x: contentLeft, y: layout.y - 9, size: 8.5, text: metaLine, gray: 0.35 })
    layout.y -= 16
  }

  drawTableHeader()
  layout.onContinuationPage(drawTableHeader)

  if (!rows.length) {
    if (emptyText) {
      layout.page.texts.push({ x: contentLeft + CELL_PADDING, y: layout.y - 13, size: 9.5, text: emptyText, gray: 0.35 })
      layout.y -= 22
    }
    layout.onContinuationPage(() => {})
    layout.y -= SECTION_GAP
    return
  }

  rows.forEach((row, rowIndex) => {
    if (row.spacerBefore && rowIndex > 0) layout.y -= 6

    const cells = row.cells.map(cell => (typeof cell === 'string' ? { text: cell } : cell))
    const cellLines = cells.map((cell, index) => {
      const column = columns[index]!
      const mainLines = cell.text
        ? (column.align === 'right' ? [cell.text] : wrapTextByWidth(cell.text, columnTextWidth(index), 9))
        : []
      const subLines = (cell.subLines ?? [])
        .filter(line => line.trim())
        .flatMap(line => wrapTextByWidth(line, columnTextWidth(index), 7.5))
      return { mainLines, subLines }
    })

    const contentHeight = cellLines.reduce((height, lines) => {
      const cellHeight = (lines.mainLines.length * LINE_HEIGHT)
        + (lines.subLines.length ? 1 + (lines.subLines.length * SUB_LINE_HEIGHT) : 0)
      return Math.max(height, cellHeight)
    }, LINE_HEIGHT)
    const rowHeight = contentHeight + 7

    layout.ensureSpace(rowHeight)

    if (row.band || row.tone) {
      layout.page.rects.push({
        x: contentLeft,
        y: layout.y - rowHeight,
        width: tableWidth,
        height: rowHeight,
        fill: true,
        color: row.tone ? ROW_TONE_FILLS[row.tone] : PDF_COLORS.accentWash,
      })
    }

    const firstBaseline = layout.y - 12
    cellLines.forEach((lines, index) => {
      const { x, align } = cellTextPosition(index)

      lines.mainLines.forEach((line, lineIndex) => {
        if (!line) return
        layout.page.texts.push({
          x,
          y: firstBaseline - (lineIndex * LINE_HEIGHT),
          size: 9,
          text: line,
          font: row.bold || cells[index]!.bold ? 'F2' : 'F1',
          align,
          color: cells[index]!.color,
        })
      })

      const subStart = firstBaseline - (lines.mainLines.length * LINE_HEIGHT)
      lines.subLines.forEach((line, lineIndex) => {
        if (!line) return
        layout.page.texts.push({
          x,
          y: subStart - (lineIndex * SUB_LINE_HEIGHT),
          size: 7.5,
          text: line,
          gray: 0.35,
          align,
        })
      })
    })

    const isLast = rowIndex === rows.length - 1
    layout.page.lines.push({
      x1: contentLeft,
      y1: layout.y - rowHeight,
      x2: contentRight,
      y2: layout.y - rowHeight,
      width: isLast ? 1 : 0.5,
      gray: isLast ? undefined : 0.82,
      color: isLast ? PDF_COLORS.accent : undefined,
    })

    layout.y -= rowHeight
  })

  layout.onContinuationPage(() => {})
  layout.y -= SECTION_GAP
}

// ---------------------------------------------------------------------------
// Table of contents
// ---------------------------------------------------------------------------

const TOC_GROUP_HEIGHT = 26
const TOC_ENTRY_HEIGHT = 19
const TOC_TITLE_HEIGHT = 52

interface TocItem {
  kind: 'group' | 'entry'
  label: string
  pageIndex: number
}

/**
 * Renders the contents listing into pages spliced in at `insertAtIndex`. Runs after the body so
 * every section's page is known; the listed numbers account for the pages this insert adds.
 */
function renderTableOfContents(layout: PdfDocumentLayout, entries: TocEntry[], insertAtIndex: number) {
  if (!entries.length) return

  const items: TocItem[] = []
  let lastGroup: string | null = null
  for (const entry of entries) {
    if (entry.group && entry.group !== lastGroup) {
      items.push({ kind: 'group', label: entry.group, pageIndex: entry.pageIndex })
      lastGroup = entry.group
    }
    items.push({ kind: 'entry', label: entry.label, pageIndex: entry.pageIndex })
  }

  const { contentLeft, contentRight, continuationTop, bottomLimit } = PDF_LAYOUT

  const pages: TocItem[][] = []
  let currentPage: TocItem[] = []
  let remainingY = continuationTop - TOC_TITLE_HEIGHT
  for (const item of items) {
    const height = item.kind === 'group' ? TOC_GROUP_HEIGHT : TOC_ENTRY_HEIGHT
    if (remainingY - height < bottomLimit && currentPage.length) {
      pages.push(currentPage)
      currentPage = []
      remainingY = continuationTop
    }
    currentPage.push(item)
    remainingY -= height
  }
  pages.push(currentPage)

  const buffers = layout.insertPages(insertAtIndex, pages.length)
  const pageNumber = (bodyPageIndex: number) => (
    (bodyPageIndex >= insertAtIndex ? bodyPageIndex + pages.length : bodyPageIndex) + 1
  )

  pages.forEach((pageItems, pageIndex) => {
    const buffer = buffers[pageIndex]!
    let cursor = continuationTop

    if (pageIndex === 0) {
      buffer.texts.push({ x: contentLeft, y: cursor - 18, size: 16, text: 'Inhaltsverzeichnis', font: 'F2', color: PDF_COLORS.accent })
      buffer.rects.push({
        x: contentLeft,
        y: cursor - 30,
        width: contentRight - contentLeft,
        height: 2,
        fill: true,
        color: PDF_COLORS.accent,
      })
      cursor -= TOC_TITLE_HEIGHT
    }

    for (const item of pageItems) {
      if (item.kind === 'group') {
        buffer.texts.push({
          x: contentLeft,
          y: cursor - 14,
          size: 8.5,
          text: item.label.toUpperCase(),
          font: 'F2',
          color: PDF_COLORS.neutral,
        })
        cursor -= TOC_GROUP_HEIGHT
        continue
      }

      const baseline = cursor - 13
      const targetPage = pageNumber(item.pageIndex) - 1
      const numberText = String(targetPage + 1)
      const labelX = contentLeft + 12

      buffer.links.push({
        x: contentLeft,
        y: baseline - 4,
        width: contentRight - contentLeft,
        height: TOC_ENTRY_HEIGHT,
        targetPage,
      })

      const leaderStart = labelX + estimateTextWidth(item.label, 10.5, false) + 6
      const leaderEnd = contentRight - estimateTextWidth(numberText, 10.5, true) - 6

      buffer.texts.push({ x: labelX, y: baseline, size: 10.5, text: item.label })
      if (leaderEnd > leaderStart) {
        buffer.lines.push({ x1: leaderStart, y1: baseline + 3, x2: leaderEnd, y2: baseline + 3, width: 0.5, gray: 0.8 })
      }
      buffer.texts.push({ x: contentRight, y: baseline, size: 10.5, text: numberText, font: 'F2', align: 'right', color: PDF_COLORS.accent })

      cursor -= TOC_ENTRY_HEIGHT
    }
  })
}

// ---------------------------------------------------------------------------
// Document
// ---------------------------------------------------------------------------

export function buildFinanceAnalysisPdf(options: FinanceAnalysisPdfOptions) {
  const { analysis, comparisonAnalysis, filters, association, logo = null } = options
  const summary = analysis.summary
  const layout = createPdfDocumentLayout({ logo })
  const { contentLeft } = PDF_LAYOUT

  const selectedCostCentre = filters.costCentreId
    ? options.costCentres.find(costCentre => costCentre.id === filters.costCentreId) ?? null
    : null

  const receiptDateFieldLabel = filters.receiptDateField === 'reimbursement_submitted_at'
    ? 'Eingangsdatum Erstattung'
    : 'Belegdatum'
  const invoiceDateFieldLabel = filters.invoiceDateField === 'due_date'
    ? 'Fälligkeitsdatum'
    : filters.invoiceDateField === 'service_date'
      ? 'Leistungsdatum'
      : filters.invoiceDateField === 'paid_at'
        ? 'Zahlungsdatum'
        : 'Rechnungsdatum'

  const orderedStatuses = RECEIPT_STATUS_ORDER.filter(status => filters.statuses.includes(status))
  const orderedInvoiceStatuses = INVOICE_STATUS_ORDER.filter(status => filters.invoiceStatuses.includes(status))

  // --- Header ---
  const hasLogo = layout.drawCenteredBrand(association)
  const titleY = hasLogo ? 722 : 738
  layout.centeredText('Finanzanalyse', { y: titleY, size: 18, font: 'F2', color: PDF_COLORS.accent })
  layout.centeredText(`Zeitraum: ${formatDate(filters.startDate)} bis ${formatDate(filters.endDate)}`, { y: titleY - 20, size: 13, gray: 0.25 })
  layout.page.rects.push({
    x: PDF_LAYOUT.headingCenterX - 40,
    y: titleY - 32,
    width: 80,
    height: 2,
    fill: true,
    color: PDF_COLORS.accent,
  })

  layout.y = hasLogo ? 672 : 688

  const today = new Date()
  const createdAt = `${String(today.getDate()).padStart(2, '0')}.${String(today.getMonth() + 1).padStart(2, '0')}.${today.getFullYear()}`

  const metaRows: Array<[string, string]> = [
    ['Erstellt am:', createdAt],
  ]
  if (selectedCostCentre) {
    metaRows.push([
      'Kostenstelle:',
      `${selectedCostCentre.code} - ${selectedCostCentre.name}${filters.includeChildCostCentres ? ' (inkl. untergeordneter Kostenstellen)' : ''}`,
    ])
  }
  metaRows.push(
    ['Belegdatum:', receiptDateFieldLabel],
    ['Belegstatus:', orderedStatuses.map(status => RECEIPT_STATUS_LABELS[status]).join(', ') || 'Nicht ausgewählt'],
    ['Rechnungsdatum:', invoiceDateFieldLabel],
    ['Rechnungsstatus:', orderedInvoiceStatuses.map(status => INVOICE_STATUS_LABELS[status]).join(', ') || 'Nicht ausgewählt'],
  )
  if (comparisonAnalysis) {
    metaRows.push(['Vergleichszeitraum:', `${formatDate(comparisonAnalysis.summary.start_date)} bis ${formatDate(comparisonAnalysis.summary.end_date)}`])
  }
  if (options.compareToBudget && options.comparisonBudgetLabel) {
    metaRows.push(['Vergleichshaushalt:', options.comparisonBudgetLabel])
  }

  metaRows.forEach(([label, value]) => {
    const valueLines = wrapTextByWidth(value, PDF_LAYOUT.contentRight - (contentLeft + 110), 10)
    layout.page.texts.push({ x: contentLeft, y: layout.y, size: 10, text: label, font: 'F2', color: PDF_COLORS.neutral })
    valueLines.forEach((line, index) => {
      if (!line) return
      layout.page.texts.push({ x: contentLeft + 110, y: layout.y - (index * 13), size: 10, text: line })
    })
    layout.y -= 15 + ((valueLines.length - 1) * 13)
  })
  layout.y -= 12

  const tocEntries: TocEntry[] = []
  const toc = (group: string) => (options.includeTableOfContents ? { entries: tocEntries, group } : undefined)

  // Every part after the overview page starts on a fresh page; the first rendered
  // part stays on page 1 below the document header when the overview is skipped.
  // With a contents listing the body always starts on its own page, so the listing
  // can be spliced in as page 2 without splitting a section.
  let hasSectionContent = options.includeTableOfContents
  const startSectionOnNewPage = () => {
    if (!hasSectionContent) {
      hasSectionContent = true
      return
    }
    layout.onContinuationPage(() => {})
    layout.startContinuationPage()
  }

  // --- Key figures ---
  const totalEntries = summary.receipt_count + summary.cash_count_count + summary.invoice_count

  if (options.includeOverview) startSectionOnNewPage()

  if (options.includeOverview && comparisonAnalysis) {
    const comparison = comparisonAnalysis.summary
    const comparisonEntries = comparison.receipt_count + comparison.cash_count_count + comparison.invoice_count
    const currencyRow = (label: string, current: number, previous: number, bold = false, band = false): TableRowDef => ({
      cells: [label, formatMoney(current), formatMoney(previous), signedMoneyCell(current - previous)],
      bold,
      band,
    })

    renderSectionTable(layout, {
      title: 'Auswertung',
      toc: toc('Überblick'),
      columns: [
        { label: 'Kennzahl', width: 175 },
        { label: 'Aktuell', width: 103, align: 'right' },
        { label: 'Vorjahr', width: 103, align: 'right' },
        { label: 'Differenz', width: 104, align: 'right' },
      ],
      rows: [
        currencyRow('Belege gesamt', summary.receipt_total, comparison.receipt_total),
        currencyRow('Kassenerlös', summary.cash_count_total_difference, comparison.cash_count_total_difference),
        currencyRow('Rechnungen gesamt', summary.invoice_total, comparison.invoice_total),
        {
          cells: [
            'Saldo',
            signedMoneyCell(summary.net_result),
            signedMoneyCell(comparison.net_result),
            signedMoneyCell(summary.net_result - comparison.net_result),
          ],
          bold: true,
        },
        {
          cells: [
            'Geprüfte Vorgänge',
            formatCount(totalEntries),
            formatCount(comparisonEntries),
            formatCount(totalEntries - comparisonEntries),
          ],
        },
      ],
    })
  } else if (options.includeOverview) {
    renderSectionTable(layout, {
      title: 'Auswertung',
      toc: toc('Überblick'),
      columns: [
        { label: 'Kennzahl', width: 265 },
        { label: 'Anzahl', width: 90, align: 'right' },
        { label: 'Betrag', width: 130, align: 'right' },
      ],
      rows: [
        { cells: ['Belege gesamt', formatCount(summary.receipt_count), formatMoney(summary.receipt_total)] },
        { cells: ['Kassenerlös', formatCount(summary.cash_count_count), formatMoney(summary.cash_count_total_difference)] },
        { cells: ['Rechnungen gesamt', formatCount(summary.invoice_count), formatMoney(summary.invoice_total)] },
        { cells: ['Saldo', '', signedMoneyCell(summary.net_result)], bold: true },
        { cells: ['Geprüfte Vorgänge', formatCount(totalEntries), ''] },
      ],
    })
  }

  // --- Receipt states ---
  const receiptStateRows: TableRowDef[] = [
    { status: ReceiptStatus.Draft, count: summary.receipt_draft_count, total: summary.receipt_draft_total },
    { status: ReceiptStatus.Open, count: summary.receipt_open_count, total: summary.receipt_open_total },
    { status: ReceiptStatus.Paid, count: summary.receipt_paid_count, total: summary.receipt_paid_total },
    { status: ReceiptStatus.Cancelled, count: summary.receipt_cancelled_count, total: summary.receipt_cancelled_total },
  ]
    .filter(row => orderedStatuses.includes(row.status))
    .map(row => ({
      cells: [RECEIPT_STATUS_LABELS[row.status], formatCount(row.count), formatMoney(row.total)],
    } satisfies TableRowDef))

  if (options.includeOverview) {
    renderSectionTable(layout, {
      title: 'Belegüberblick',
      toc: toc('Überblick'),
      columns: [
        { label: 'Belegstatus', width: 265 },
        { label: 'Anzahl', width: 90, align: 'right' },
        { label: 'Summe', width: 130, align: 'right' },
      ],
      rows: receiptStateRows,
      emptyText: 'Derzeit ist kein Belegstatus ausgewählt.',
    })

    // --- Cash overview ---
    renderSectionTable(layout, {
      title: 'Kassenüberblick',
      toc: toc('Überblick'),
      headerless: true,
      columns: [
        { label: '', width: 355 },
        { label: '', width: 130, align: 'right' },
      ],
      rows: [
        { cells: ['Gesamtvermögen zu Periodenbeginn', formatMoney(summary.money_before)] },
        { cells: ['Gesamtvermögen am Periodenende', formatMoney(summary.money_after)] },
        { cells: ['Kassen insgesamt', formatCount(summary.cash_count_register_total)] },
        { cells: ['Ungeklärte Kassenabweichungen', formatMoney(summary.period_discrepancy_total)] },
      ],
    })

    // --- Invoice states ---
    const invoiceStateRows: TableRowDef[] = orderedInvoiceStatuses.map((status) => {
      const invoices = analysis.invoices.filter(invoice => invoice.status === status)
      const total = roundCurrency(invoices.reduce((sum, invoice) => sum + invoice.total_amount, 0))
      return { cells: [INVOICE_STATUS_LABELS[status], formatCount(invoices.length), formatMoney(total)] }
    })

    renderSectionTable(layout, {
      title: 'Rechnungsüberblick',
      toc: toc('Überblick'),
      columns: [
        { label: 'Rechnungsstatus', width: 265 },
        { label: 'Anzahl', width: 90, align: 'right' },
        { label: 'Summe', width: 130, align: 'right' },
      ],
      rows: invoiceStateRows,
      emptyText: 'Derzeit ist kein Rechnungsstatus ausgewählt.',
    })

    hasSectionContent = true
  }

  // --- Annual closing / budget comparison ---
  const actualOwnAmounts = buildActualOwnAmountsByCostCentreId(analysis)
  const budgetOwnAmounts = buildBudgetOwnAmountsByCostCentreId(options.comparisonBudgetLines)
  const treeParams = {
    costCentres: options.costCentres,
    selectedCostCentre,
    includeChildCostCentres: filters.includeChildCostCentres,
  }

  if (options.annualClosing) {
    startSectionOnNewPage()
    const visibleRows = buildVisibleStatementCostCentres(treeParams, actualOwnAmounts)
    const summaryByCostCentre = buildStatementSummaryMap(visibleRows, actualOwnAmounts)
    const totals = visibleRows
      .filter(row => row.depth === 0)
      .reduce((sums, row) => {
        const rowSummary = summaryByCostCentre.get(row.id)
        if (!rowSummary) return sums
        sums.expense += rowSummary.totalExpense
        sums.income += rowSummary.totalIncome
        return sums
      }, { expense: 0, income: 0 })
    const totalExpense = roundCurrency(totals.expense)
    const totalIncome = roundCurrency(totals.income)

    const rows: TableRowDef[] = [
      {
        cells: ['Gesamt', '', formatMoney(totalExpense), formatMoney(totalIncome), formatMoney(roundCurrency(totalIncome - totalExpense))],
        bold: true,
        band: true,
      },
    ]

    visibleRows.forEach((row) => {
      const rowSummary = summaryByCostCentre.get(row.id)
      if (!rowSummary) return

      const label = `${row.depth > 0 ? `${'  '.repeat(row.depth)}|- ` : ''}${row.code} - ${row.name}`
      const isGroupRow = row.depth === 0

      if (row.hasChildren) {
        rows.push(
          {
            cells: [label, 'Gesamtwerte', formatMoney(rowSummary.totalExpense), formatMoney(rowSummary.totalIncome), formatMoney(rowSummary.totalSaldo)],
            bold: isGroupRow,
            band: isGroupRow,
            spacerBefore: isGroupRow,
          },
          { cells: ['', 'Direkte Werte', formatMoney(rowSummary.ownExpense), formatMoney(rowSummary.ownIncome), formatMoney(rowSummary.ownSaldo)] },
          { cells: ['', 'Untergeordnete Werte', formatMoney(rowSummary.childExpense), formatMoney(rowSummary.childIncome), formatMoney(rowSummary.childSaldo)] },
        )
        return
      }

      rows.push({
        cells: [label, '', formatMoney(rowSummary.ownExpense), formatMoney(rowSummary.ownIncome), formatMoney(rowSummary.ownSaldo)],
        bold: isGroupRow,
        band: isGroupRow,
        spacerBefore: isGroupRow,
      })
    })

    renderSectionTable(layout, {
      title: 'Rechnungsabschluss',
      toc: toc('Abschluss'),
      columns: [
        { label: 'Kostenstelle', width: 165 },
        { label: 'Kategorie', width: 95 },
        { label: 'Ausgaben', width: 75, align: 'right' },
        { label: 'Einnahmen', width: 75, align: 'right' },
        { label: 'Saldo', width: 75, align: 'right' },
      ],
      rows: visibleRows.length ? rows : [],
      emptyText: 'Keine Kostenstellen gefunden.',
    })
  }

  if (options.compareToBudget && options.comparisonBudgetLines.length) {
    startSectionOnNewPage()
    const visibleRows = buildVisibleStatementCostCentres(treeParams, actualOwnAmounts, budgetOwnAmounts)
    const actualSummaryByCostCentre = buildStatementSummaryMap(visibleRows, actualOwnAmounts)
    const budgetSummaryByCostCentre = buildStatementSummaryMap(visibleRows, budgetOwnAmounts)

    const sumRootTotals = (summaryMap: Map<number, StatementSummary>) => visibleRows
      .filter(row => row.depth === 0)
      .reduce((sums, row) => {
        const rowSummary = summaryMap.get(row.id)
        if (!rowSummary) return sums
        sums.expense += rowSummary.totalExpense
        sums.income += rowSummary.totalIncome
        return sums
      }, { expense: 0, income: 0 })

    const actualTotals = sumRootTotals(actualSummaryByCostCentre)
    const budgetTotals = sumRootTotals(budgetSummaryByCostCentre)

    const comparisonBlock = (
      label: string,
      actual: { expense: number, income: number },
      budget: { expense: number, income: number },
      bold: boolean,
      band: boolean,
      spacerBefore = false,
    ): TableRowDef[] => {
      const actualSaldo = roundCurrency(actual.income - actual.expense)
      const budgetSaldo = roundCurrency(budget.income - budget.expense)
      return [
        {
          cells: [label, 'Ist', formatMoney(roundCurrency(actual.expense)), formatMoney(roundCurrency(actual.income)), signedMoneyCell(actualSaldo)],
          bold,
          band,
          spacerBefore,
        },
        { cells: ['', 'Haushaltsplan', formatMoney(roundCurrency(budget.expense)), formatMoney(roundCurrency(budget.income)), signedMoneyCell(budgetSaldo)] },
        {
          cells: [
            '',
            'Differenz',
            expenseVarianceCell(actual.expense - budget.expense),
            signedMoneyCell(actual.income - budget.income),
            signedMoneyCell(actualSaldo - budgetSaldo),
          ],
        },
      ]
    }

    const rows: TableRowDef[] = comparisonBlock('Gesamt', actualTotals, budgetTotals, true, true)

    visibleRows.forEach((row) => {
      const actual = actualSummaryByCostCentre.get(row.id)
      const budget = budgetSummaryByCostCentre.get(row.id)
      if (!actual || !budget) return

      const label = `${row.depth > 0 ? `${'  '.repeat(row.depth)}|- ` : ''}${row.code} - ${row.name}`
      const isGroupRow = row.depth === 0

      rows.push(...comparisonBlock(
        label,
        { expense: actual.totalExpense, income: actual.totalIncome },
        { expense: budget.totalExpense, income: budget.totalIncome },
        isGroupRow,
        isGroupRow,
        true,
      ))
    })

    renderSectionTable(layout, {
      title: 'Haushaltsplanvergleich',
      toc: toc('Abschluss'),
      metaLine: options.comparisonBudgetLabel ? `Vergleichshaushalt: ${options.comparisonBudgetLabel}` : undefined,
      columns: [
        { label: 'Kostenstelle', width: 155 },
        { label: 'Kategorie', width: 80 },
        { label: 'Ausgaben', width: 82, align: 'right' },
        { label: 'Einnahmen', width: 84, align: 'right' },
        { label: 'Saldo', width: 84, align: 'right' },
      ],
      rows: visibleRows.length ? rows : [],
      emptyText: 'Keine Kostenstellen gefunden.',
    })
  }

  // --- Grouped overviews ---
  const hasReceiptOverview = options.exportGrouping !== 'none' || options.exportSplitByMonth || options.exportSplitByPaymentStatus
  const hasCashCountOverview = options.exportGrouping !== 'none' || options.exportSplitByMonth
  const groupColumnLabel = options.exportGrouping === 'costCentres' ? 'Kostenstellen' : 'Sphären'

  const overviewColumns = (statusLabel: string, sumLabel: string) => {
    const columns: TableColumn[] = []
    if (options.exportGrouping !== 'none') columns.push({ label: groupColumnLabel, width: 165 })
    if (options.exportSplitByMonth) columns.push({ label: 'Monat', width: 70 })
    if (options.exportSplitByPaymentStatus) columns.push({ label: statusLabel, width: 70 })
    columns.push({ label: 'Anzahl', width: 60, align: 'right' })
    columns.push({ label: sumLabel, width: 95, align: 'right' })
    return columns
  }

  const overviewRow = (aggregate: OverviewAggregate, statusLabels: Record<string, string>): TableRowDef => {
    const cells: Array<string | TableCell> = []
    if (options.exportGrouping !== 'none') cells.push(aggregate.groupLabel)
    if (options.exportSplitByMonth) cells.push(formatMonthKey(aggregate.monthKey))
    if (options.exportSplitByPaymentStatus) cells.push(statusLabels[aggregate.status] ?? aggregate.status)
    cells.push(formatCount(aggregate.count))
    cells.push(formatMoney(aggregate.totalAmount))
    return { cells }
  }

  if (hasReceiptOverview) {
    const aggregates = buildReceiptOverviewAggregates(options)
    startSectionOnNewPage()
    renderSectionTable(layout, {
      title: 'Belegübersicht',
      toc: toc('Übersichten'),
      metaLine: `${aggregates.length} Einträge`,
      columns: overviewColumns('Zahlstatus', 'Summe'),
      rows: aggregates.map(aggregate => overviewRow(aggregate, RECEIPT_STATUS_LABELS)),
      emptyText: 'Keine Belege im gewählten Zeitraum.',
    })

    const invoiceAggregates = buildInvoiceOverviewAggregates(options)
    startSectionOnNewPage()
    renderSectionTable(layout, {
      title: 'Rechnungsübersicht',
      toc: toc('Übersichten'),
      metaLine: `${invoiceAggregates.length} Einträge`,
      columns: overviewColumns('Zahlstatus', 'Summe'),
      rows: invoiceAggregates.map(aggregate => overviewRow(aggregate, INVOICE_STATUS_LABELS)),
      emptyText: 'Keine Rechnungen im gewählten Zeitraum.',
    })
  }

  if (hasCashCountOverview) {
    const aggregates = buildCashCountOverviewAggregates(options)
    // Allocated shares are not meaningful as an opening/closing register balance, so the
    // before/after columns only survive an ungrouped sheet.
    const hideBalances = options.exportGrouping !== 'none'
    const groupColumnLabel = options.exportGrouping === 'spheres' ? 'Sphäre' : 'Kostenstelle'

    const columns: TableColumn[] = []
    if (options.exportGrouping !== 'none') columns.push({ label: groupColumnLabel, width: 165 })
    if (options.exportSplitByMonth) columns.push({ label: 'Monat', width: 70 })
    columns.push({ label: 'Anzahl', width: 55, align: 'right' })
    columns.push({ label: 'Kassen', width: 55, align: 'right' })
    if (!hideBalances) {
      columns.push({ label: 'Vorher', width: 80, align: 'right' })
      columns.push({ label: 'Nachher', width: 80, align: 'right' })
    }
    columns.push({ label: 'Erlös', width: 90, align: 'right' })

    startSectionOnNewPage()
    renderSectionTable(layout, {
      title: 'Kassenzählungsübersicht',
      toc: toc('Übersichten'),
      metaLine: `${aggregates.length} Einträge`,
      columns,
      rows: aggregates.map((aggregate) => {
        const cells: Array<string | TableCell> = []
        if (options.exportGrouping !== 'none') cells.push(aggregate.groupLabel)
        if (options.exportSplitByMonth) cells.push(formatMonthKey(aggregate.monthKey))
        cells.push(formatCount(aggregate.cashCountCount))
        cells.push(formatCount(aggregate.registerCount))
        if (!hideBalances) {
          cells.push(formatMoney(aggregate.totalBeforeAmount))
          cells.push(formatMoney(aggregate.totalAfterAmount))
        }
        cells.push(formatMoney(aggregate.totalDifference))
        return { cells }
      }),
      emptyText: 'Keine Kassenzählungen im gewählten Zeitraum.',
    })
  }

  if (hasCashCountOverview) {
    const aggregates = buildBankStatementOverviewAggregates(options)

    const columns: TableColumn[] = [{ label: 'Art', width: 120 }]
    if (options.exportSplitByMonth) columns.push({ label: 'Monat', width: 70 })
    columns.push(
      { label: 'Anzahl', width: 55, align: 'right' },
      { label: 'Eingang', width: 85, align: 'right' },
      { label: 'Ausgang', width: 85, align: 'right' },
      { label: 'Saldo', width: 90, align: 'right' },
    )

    startSectionOnNewPage()
    renderSectionTable(layout, {
      title: 'Kontoauszugsübersicht',
      toc: toc('Übersichten'),
      metaLine: `${aggregates.length} Einträge · Nach Art der Position`,
      columns,
      rows: aggregates.map((aggregate) => {
        const cells: Array<string | TableCell> = [aggregate.typeLabel]
        if (options.exportSplitByMonth) cells.push(formatMonthKey(aggregate.monthKey))
        cells.push(
          formatCount(aggregate.count),
          formatMoney(aggregate.inflow),
          formatMoney(aggregate.outflow),
          formatMoney(roundCurrency(aggregate.inflow - aggregate.outflow)),
        )
        return { cells }
      }),
      emptyText: 'Keine Kontoauszugspositionen im gewählten Zeitraum.',
    })
  }

  // --- Liquidity ledger ---
  if (options.includeBalanceSheet) {
    const liquidityRows = analysis.liquidityRows ?? []
    const dataCount = liquidityRows.filter(row => row.type !== 'opening' && row.type !== 'closing').length

    startSectionOnNewPage()
    renderSectionTable(layout, {
      title: 'Liquiditätsübersicht',
      toc: toc('Übersichten'),
      metaLine: `${dataCount} Einträge · Chronologisches Kassenbuch mit laufenden Salden`,
      columns: [
        { label: 'Datum', width: 54 },
        { label: 'Vorgang', width: 173 },
        { label: 'Bewegung', width: 62, align: 'right' },
        { label: 'Bank', width: 64, align: 'right' },
        { label: 'Kasse', width: 64, align: 'right' },
        { label: 'Gesamt', width: 68, align: 'right' },
      ],
      rows: liquidityRows.map((row) => {
        const isSpecialRow = row.type === 'opening' || row.type === 'closing' || row.type === 'bankStatementCheckpoint'
        const subLines = [row.reference || '', liquidityRowNote(row)]
        if (row.discrepancy_amount !== null) {
          subLines.push(`Soll ${formatMoney(row.expected_amount ?? 0)} · Ist ${formatMoney(row.measured_amount ?? 0)} · Differenz ${formatMoney(row.discrepancy_amount)}`)
        }

        const isBoundaryRow = row.type === 'opening' || row.type === 'closing'
        // Same tinting as the on-screen ledger: a checked balance is green, a deviating one amber.
        const isCheckpoint = row.discrepancy_amount !== null
        const tone: TableRowTone | undefined = isBoundaryRow
          ? 'neutral'
          : row.has_discrepancy
            ? 'warning'
            : isCheckpoint ? 'success' : undefined

        return {
          cells: [
            formatDate(row.date),
            { text: liquidityRowLabel(row), subLines },
            isSpecialRow ? '' : signedMoneyCell(row.delta_amount, true),
            formatMoney(row.bank_balance),
            formatMoney(row.cash_balance),
            formatMoney(row.total_balance),
          ],
          bold: isBoundaryRow,
          tone,
        }
      }),
      emptyText: 'Keine Liquiditätsvorgänge im gewählten Zeitraum.',
    })
  }

  // --- Detail tables ---
  if (options.includeReceiptList) {
    startSectionOnNewPage()
    renderSectionTable(layout, {
      title: 'Belege im Zeitraum',
      toc: toc('Detaillisten'),
      metaLine: `${analysis.receipts.length} Einträge · Datum: ${receiptDateFieldLabel}`,
      columns: [
        { label: 'Datum', width: 62 },
        { label: 'Belegnummer', width: 103 },
        { label: 'Firma', width: 140 },
        { label: 'Status', width: 60 },
        { label: 'Betrag', width: 90, align: 'right' },
      ],
      rows: analysis.receipts.map(receipt => ({
        cells: [
          formatDate(getReceiptDateValue(receipt, filters.receiptDateField)),
          receipt.receipt_number || 'ohne Nr.',
          receipt.company_name || '-',
          RECEIPT_STATUS_LABELS[receipt.status],
          formatMoney(receipt.total_amount),
        ],
      })),
      emptyText: 'Keine Belege im gewählten Zeitraum.',
    })
  }

  if (options.includeCashCountList) {
    startSectionOnNewPage()
    renderSectionTable(layout, {
      title: 'Kassenzählungen im Zeitraum',
      toc: toc('Detaillisten'),
      metaLine: `${analysis.cashCounts.length} Einträge`,
      columns: [
        { label: 'Gezählt am', width: 85 },
        { label: 'Veranstaltung', width: 110 },
        { label: 'Sphäre / Kostenstelle', width: 120 },
        { label: 'Kassen', width: 40, align: 'right' },
        { label: 'Vorher', width: 60, align: 'right' },
        { label: 'Nachher', width: 60, align: 'right' },
        { label: 'Differenz', width: 60, align: 'right' },
      ],
      rows: analysis.cashCounts.map(cashCount => ({
        cells: [
          formatDateTime(cashCount.counted_after_at),
          cashCount.event_name,
          formatCostCentreSplits(cashCount.cost_centres),
          formatCount(cashCount.register_count),
          formatMoney(cashCount.total_before_amount),
          formatMoney(cashCount.total_after_amount),
          formatMoney(cashCount.total_difference),
        ],
      })),
      emptyText: 'Keine Kassenzählungen im gewählten Zeitraum.',
    })
  }

  if (options.includeBankStatementList) {
    const positions = analysis.bankStatementPositions
    startSectionOnNewPage()
    renderSectionTable(layout, {
      title: 'Kontoauszugspositionen im Zeitraum',
      toc: toc('Detaillisten'),
      metaLine: `${positions.length} Positionen aus ${analysis.summary.bank_statement_count} Kontoauszügen`,
      columns: [
        { label: 'Datum', width: 62 },
        { label: 'Auszug', width: 60 },
        { label: 'Art', width: 70 },
        { label: 'Referenz', width: 90 },
        { label: 'Beteiligte', width: 128 },
        { label: 'Betrag', width: 90, align: 'right' },
      ],
      rows: positions.map(position => ({
        cells: [
          formatDate(position.position_date),
          position.statement_number || '-',
          BANK_POSITION_TYPE_LABELS[position.position_type],
          position.reference || '-',
          position.counterparty || '-',
          // Signed so a statement reads like an account: outgoing money is negative.
          formatMoney(position.direction === 'out' ? -position.amount : position.amount),
        ],
      })),
      emptyText: 'Keine Kontoauszugspositionen im gewählten Zeitraum.',
    })
  }

  if (options.includeInvoiceList) {
    startSectionOnNewPage()
    renderSectionTable(layout, {
      title: 'Rechnungen im Zeitraum',
      toc: toc('Detaillisten'),
      metaLine: `${analysis.invoices.length} Einträge · Datum: ${invoiceDateFieldLabel}`,
      columns: [
        { label: 'Datum', width: 62 },
        { label: 'Rechnungsnummer', width: 103 },
        { label: 'Firma', width: 140 },
        { label: 'Status', width: 60 },
        { label: 'Betrag', width: 90, align: 'right' },
      ],
      rows: analysis.invoices.map(invoice => ({
        cells: [
          formatDate(getInvoiceDateValue(invoice, filters.invoiceDateField) || invoice.invoice_date),
          invoice.invoice_number,
          invoice.company_name || '-',
          INVOICE_STATUS_LABELS[invoice.status],
          formatMoney(invoice.total_amount),
        ],
      })),
      emptyText: 'Keine Rechnungen im gewählten Zeitraum.',
    })
  }

  // The body always begins on page 2 when a listing was requested, so it slots in right after the cover.
  if (options.includeTableOfContents) renderTableOfContents(layout, tocEntries, 1)

  const footerLabel = [
    association?.short_name || association?.name,
    `Finanzanalyse ${formatDate(filters.startDate)} - ${formatDate(filters.endDate)}`,
  ]
    .filter(Boolean)
    .join(' · ')

  return layout.finish(footerLabel)
}
