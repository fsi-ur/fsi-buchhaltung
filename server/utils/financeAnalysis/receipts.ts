import { query } from '~/server/utils/db'
import { getReceiptDateExpression, type FinanceAnalysisFilters } from '~/server/utils/financeAnalysis/filters'
import type {
  FinanceAnalysisReceiptBreakdownItem,
  FinanceAnalysisReceiptItem,
} from '~/types/financeAnalysis'
import type { ReceiptStatus } from '~/types/receipt'

interface ReceiptQueryContext {
  filters: FinanceAnalysisFilters
  costCentreIds: number[]
}

function buildParams({ filters, costCentreIds }: ReceiptQueryContext) {
  return costCentreIds.length
    ? [filters.startDate, filters.endDate, ...filters.statuses, ...costCentreIds]
    : [filters.startDate, filters.endDate, ...filters.statuses]
}

export async function loadFinanceAnalysisReceipts(context: ReceiptQueryContext): Promise<FinanceAnalysisReceiptItem[]> {
  const { filters, costCentreIds } = context
  if (!filters.statuses.length) return []

  const dateExpression = getReceiptDateExpression(filters.receiptDateField)
  const statusPlaceholders = filters.statuses.map(() => '?').join(', ')
  const costCentrePlaceholders = costCentreIds.map(() => '?').join(', ')

  const rows: any[] = await query(
    `
    SELECT
      r.id,
      r.receipt_date,
      MAX(DATE(reimb.submitted_at)) AS reimbursement_submitted_at,
      r.receipt_number,
      r.status,
      c.name AS company_name,
      IFNULL(SUM(rp.amount), 0) AS total_amount
    FROM receipts r
    LEFT JOIN companies c ON c.id = r.company_id
    LEFT JOIN receipt_positions rp ON rp.receipt_id = r.id
    LEFT JOIN reimbursement_positions rlink ON rlink.receipt_id = r.id
    LEFT JOIN reimbursements reimb ON reimb.id = rlink.reimbursement_id
    WHERE ${dateExpression} BETWEEN ? AND ?
      AND r.status IN (${statusPlaceholders})
      ${costCentreIds.length ? `AND rp.cost_centre IN (${costCentrePlaceholders})` : ''}
    GROUP BY r.id
    ORDER BY ${dateExpression} DESC, r.id DESC
    `,
    buildParams(context),
  )

  return rows.map(row => ({
    id: Number(row.id),
    receipt_date: String(row.receipt_date),
    reimbursement_submitted_at: row.reimbursement_submitted_at ? String(row.reimbursement_submitted_at) : null,
    receipt_number: row.receipt_number ? String(row.receipt_number) : null,
    company_name: row.company_name ? String(row.company_name) : null,
    status: row.status as ReceiptStatus,
    total_amount: Number(row.total_amount || 0),
  }))
}

export async function loadFinanceAnalysisReceiptBreakdown(context: ReceiptQueryContext): Promise<FinanceAnalysisReceiptBreakdownItem[]> {
  const { filters, costCentreIds } = context
  if (!filters.statuses.length) return []

  const dateExpression = getReceiptDateExpression(filters.receiptDateField)
  const statusPlaceholders = filters.statuses.map(() => '?').join(', ')
  const costCentrePlaceholders = costCentreIds.map(() => '?').join(', ')
  const costCentreCondition = costCentreIds.length ? `AND rp.cost_centre IN (${costCentrePlaceholders})` : ''
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
        DATE_FORMAT(${dateExpression}, '%Y-%m') AS month_key,
        r.status,
        COUNT(DISTINCT r.id) AS receipt_count,
        IFNULL(SUM(rp.amount), 0) AS total_amount
      FROM receipts r
      INNER JOIN receipt_positions rp ON rp.receipt_id = r.id
      INNER JOIN cost_centres cc ON cc.id = rp.cost_centre
      LEFT JOIN reimbursement_positions rlink ON rlink.receipt_id = r.id
      LEFT JOIN reimbursements reimb ON reimb.id = rlink.reimbursement_id
      WHERE ${dateExpression} BETWEEN ? AND ?
        AND r.status IN (${statusPlaceholders})
        ${costCentreCondition}
      GROUP BY cc.id, cc.code, cc.name, month_key, r.status

      UNION ALL

      SELECT
        'sphere' AS group_type,
        s.id AS group_id,
        s.code AS group_code,
        s.name AS group_name,
        DATE_FORMAT(${dateExpression}, '%Y-%m') AS month_key,
        r.status,
        COUNT(DISTINCT r.id) AS receipt_count,
        IFNULL(SUM(rp.amount), 0) AS total_amount
      FROM receipts r
      INNER JOIN receipt_positions rp ON rp.receipt_id = r.id
      INNER JOIN spheres s ON s.id = rp.sphere
      LEFT JOIN reimbursement_positions rlink ON rlink.receipt_id = r.id
      LEFT JOIN reimbursements reimb ON reimb.id = rlink.reimbursement_id
      WHERE ${dateExpression} BETWEEN ? AND ?
        AND r.status IN (${statusPlaceholders})
        ${costCentreCondition}
      GROUP BY s.id, s.code, s.name, month_key, r.status
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
    status: row.status as ReceiptStatus,
    receipt_count: Number(row.receipt_count || 0),
    total_amount: Number(row.total_amount || 0),
  }))
}
