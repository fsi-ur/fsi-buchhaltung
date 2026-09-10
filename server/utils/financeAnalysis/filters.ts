import { query } from '~/server/utils/db'
import { InvoiceStatus } from '~/types/invoice'
import { ReceiptStatus } from '~/types/receipt'

export type FinanceAnalysisReceiptDateField = 'receipt_date' | 'reimbursement_submitted_at'
export type FinanceAnalysisInvoiceDateField = 'invoice_date' | 'due_date' | 'service_date' | 'paid_at'

export interface FinanceAnalysisFilters {
  startDate: string
  endDate: string
  statuses: ReceiptStatus[]
  receiptDateField: FinanceAnalysisReceiptDateField
  invoiceStatuses: InvoiceStatus[]
  invoiceDateField: FinanceAnalysisInvoiceDateField
  costCentreId: number | null
  includeChildCostCentres: boolean
}

function isDateOnly(value: unknown): value is string {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
}

function defaultDateRange() {
  const now = new Date()
  const year = now.getFullYear()
  return {
    start: `${year}-01-01`,
    end: `${year}-12-31`,
  }
}

function isReceiptStatus(value: unknown): value is ReceiptStatus {
  return Object.values(ReceiptStatus).includes(value as ReceiptStatus)
}

function getRequestedStatuses(value: unknown) {
  if (Array.isArray(value)) return value.filter(isReceiptStatus)
  if (typeof value === 'string') return [value].filter(isReceiptStatus)
  return []
}

function isInvoiceStatus(value: unknown): value is InvoiceStatus {
  return Object.values(InvoiceStatus).includes(value as InvoiceStatus)
}

function getRequestedInvoiceStatuses(value: unknown) {
  if (Array.isArray(value)) return value.filter(isInvoiceStatus)
  if (typeof value === 'string') return [value].filter(isInvoiceStatus)
  return []
}

function parseReceiptDateField(value: unknown): FinanceAnalysisReceiptDateField {
  return value === 'reimbursement_submitted_at' ? 'reimbursement_submitted_at' : 'receipt_date'
}

function parseInvoiceDateField(value: unknown): FinanceAnalysisInvoiceDateField {
  if (value === 'due_date' || value === 'service_date' || value === 'paid_at') return value
  return 'invoice_date'
}

export function getInvoiceDateColumn(field: FinanceAnalysisInvoiceDateField) {
  if (field === 'due_date') return 'i.due_date'
  if (field === 'service_date') return 'i.service_date'
  if (field === 'paid_at') return 'i.paid_at'
  return 'i.invoice_date'
}

export function getReceiptDateExpression(field: FinanceAnalysisReceiptDateField) {
  if (field === 'reimbursement_submitted_at') return 'COALESCE(DATE(reimb.submitted_at), r.receipt_date)'
  return 'r.receipt_date'
}

export function parsePositiveInteger(value: unknown) {
  if (typeof value === 'number' && Number.isInteger(value) && value > 0) return value
  if (typeof value !== 'string' || !/^\d+$/.test(value)) return null

  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null
}

export function parseBooleanFlag(value: unknown) {
  return value === true || value === 'true' || value === '1' || value === 1
}

export function parseFinanceAnalysisFilters(input: Record<string, unknown>): FinanceAnalysisFilters {
  const fallback = defaultDateRange()

  return {
    startDate: isDateOnly(input.startDate) ? input.startDate : fallback.start,
    endDate: isDateOnly(input.endDate) ? input.endDate : fallback.end,
    statuses: getRequestedStatuses(input.statuses),
    receiptDateField: parseReceiptDateField(input.receiptDateField),
    invoiceStatuses: getRequestedInvoiceStatuses(input.invoiceStatuses),
    invoiceDateField: parseInvoiceDateField(input.invoiceDateField),
    costCentreId: parsePositiveInteger(input.costCentreId),
    includeChildCostCentres: parseBooleanFlag(input.includeChildCostCentres),
  }
}

export async function resolveSelectedCostCentreIds(costCentreId: number | null, includeChildCostCentres: boolean) {
  if (!costCentreId) return []
  if (!includeChildCostCentres) return [costCentreId]

  const rows: any[] = await query(`
    SELECT id, parent_id
    FROM cost_centres
  `)

  const childrenByParentId = new Map<number | null, number[]>()
  for (const row of rows) {
    const parentId = row.parent_id === null || row.parent_id === undefined ? null : Number(row.parent_id)
    const current = childrenByParentId.get(parentId) ?? []
    current.push(Number(row.id))
    childrenByParentId.set(parentId, current)
  }

  const selectedIds = new Set<number>()
  const queue = [costCentreId]

  while (queue.length) {
    const currentId = queue.shift()
    if (!currentId || selectedIds.has(currentId)) continue
    selectedIds.add(currentId)

    for (const childId of childrenByParentId.get(currentId) ?? []) {
      if (!selectedIds.has(childId)) queue.push(childId)
    }
  }

  return Array.from(selectedIds)
}

export function roundFinanceCurrency(value: number) {
  return Number(value.toFixed(2))
}
