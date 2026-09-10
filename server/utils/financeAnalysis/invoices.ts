import { query } from '~/server/utils/db'
import { getInvoiceDateColumn, type FinanceAnalysisFilters } from '~/server/utils/financeAnalysis/filters'
import type {
  FinanceAnalysisInvoiceBreakdownItem,
  FinanceAnalysisInvoiceItem,
} from '~/types/financeAnalysis'
import type { InvoiceStatus } from '~/types/invoice'

interface InvoiceQueryContext {
  filters: FinanceAnalysisFilters
  costCentreIds: number[]
}

const INVOICE_POSITION_GROSS = 'ip.quantity * ip.unit_price * (1 + (ip.tax / 100))'

function buildParams({ filters, costCentreIds }: InvoiceQueryContext) {
  return costCentreIds.length
    ? [filters.startDate, filters.endDate, ...filters.invoiceStatuses, ...costCentreIds]
    : [filters.startDate, filters.endDate, ...filters.invoiceStatuses]
}

export async function loadFinanceAnalysisInvoices(context: InvoiceQueryContext): Promise<FinanceAnalysisInvoiceItem[]> {
  const { filters, costCentreIds } = context
  if (!filters.invoiceStatuses.length) return []

  const dateColumn = getInvoiceDateColumn(filters.invoiceDateField)
  const statusPlaceholders = filters.invoiceStatuses.map(() => '?').join(', ')
  const costCentrePlaceholders = costCentreIds.map(() => '?').join(', ')

  const rows: any[] = await query(
    `
    SELECT
      i.id,
      i.invoice_date,
      i.due_date,
      i.paid_at,
      i.service_date,
      i.invoice_number,
      i.status,
      c.name AS company_name,
      IFNULL(SUM(${INVOICE_POSITION_GROSS}), 0) AS total_amount
    FROM invoices i
    LEFT JOIN companies c ON c.id = i.company_id
    LEFT JOIN invoice_positions ip ON ip.invoice_id = i.id
    WHERE ${dateColumn} BETWEEN ? AND ?
      AND i.status IN (${statusPlaceholders})
      ${costCentreIds.length ? `AND ip.cost_centre IN (${costCentrePlaceholders})` : ''}
    GROUP BY i.id
    ORDER BY ${dateColumn} DESC, i.id DESC
    `,
    buildParams(context),
  )

  return rows.map(row => ({
    id: Number(row.id),
    invoice_date: String(row.invoice_date),
    due_date: row.due_date ? String(row.due_date) : null,
    paid_at: row.paid_at ? String(row.paid_at) : null,
    service_date: row.service_date ? String(row.service_date) : null,
    invoice_number: String(row.invoice_number || ''),
    company_name: row.company_name ? String(row.company_name) : null,
    status: row.status as InvoiceStatus,
    total_amount: Number(row.total_amount || 0),
  }))
}

export async function loadFinanceAnalysisInvoiceBreakdown(context: InvoiceQueryContext): Promise<FinanceAnalysisInvoiceBreakdownItem[]> {
  const { filters, costCentreIds } = context
  if (!filters.invoiceStatuses.length) return []

  const dateColumn = getInvoiceDateColumn(filters.invoiceDateField)
  const statusPlaceholders = filters.invoiceStatuses.map(() => '?').join(', ')
  const costCentrePlaceholders = costCentreIds.map(() => '?').join(', ')
  const costCentreCondition = costCentreIds.length ? `AND ip.cost_centre IN (${costCentrePlaceholders})` : ''
  const params = buildParams(context)

  const rows: any[] = await query(
    `
    SELECT *
    FROM (
      SELECT
        'costCentre' AS group_type,
        cc.id AS group_id,
        cc.code AS group_code,
        cc.name AS group_name,
        DATE_FORMAT(${dateColumn}, '%Y-%m') AS month_key,
        i.status,
        COUNT(DISTINCT i.id) AS invoice_count,
        IFNULL(SUM(${INVOICE_POSITION_GROSS}), 0) AS total_amount
      FROM invoices i
      INNER JOIN invoice_positions ip ON ip.invoice_id = i.id
      INNER JOIN cost_centres cc ON cc.id = ip.cost_centre
      WHERE ${dateColumn} BETWEEN ? AND ?
        AND i.status IN (${statusPlaceholders})
        ${costCentreCondition}
      GROUP BY cc.id, cc.code, cc.name, month_key, i.status

      UNION ALL

      SELECT
        'sphere' AS group_type,
        s.id AS group_id,
        s.code AS group_code,
        s.name AS group_name,
        DATE_FORMAT(${dateColumn}, '%Y-%m') AS month_key,
        i.status,
        COUNT(DISTINCT i.id) AS invoice_count,
        IFNULL(SUM(${INVOICE_POSITION_GROSS}), 0) AS total_amount
      FROM invoices i
      INNER JOIN invoice_positions ip ON ip.invoice_id = i.id
      INNER JOIN spheres s ON s.id = ip.sphere
      WHERE ${dateColumn} BETWEEN ? AND ?
        AND i.status IN (${statusPlaceholders})
        ${costCentreCondition}
      GROUP BY s.id, s.code, s.name, month_key, i.status
    ) breakdown
    ORDER BY breakdown.group_type, breakdown.group_code, breakdown.group_name, breakdown.month_key, breakdown.status
    `,
    [...params, ...params],
  )

  return rows.map(row => ({
    group_type: row.group_type === 'sphere' ? 'sphere' : 'costCentre',
    group_id: row.group_id === null || row.group_id === undefined ? null : Number(row.group_id),
    group_code: String(row.group_code || ''),
    group_name: String(row.group_name || ''),
    month_key: String(row.month_key || ''),
    status: row.status as InvoiceStatus,
    invoice_count: Number(row.invoice_count || 0),
    total_amount: Number(row.total_amount || 0),
  }))
}
