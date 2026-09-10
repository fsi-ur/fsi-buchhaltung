import { query } from '~/server/utils/db'
import { roundFinanceCurrency, type FinanceAnalysisFilters } from '~/server/utils/financeAnalysis/filters'
import { loadEventCostCentreSplits } from '~/server/utils/financeAnalysis/eventSplits'
import type {
  FinanceAnalysisBankPositionType,
  FinanceAnalysisBankStatementPosition,
} from '~/types/financeAnalysis'

interface BankStatementQueryContext {
  filters: FinanceAnalysisFilters
  costCentreIds: number[]
}

export async function loadFinanceAnalysisBankStatementPositions(
  context: BankStatementQueryContext,
): Promise<FinanceAnalysisBankStatementPosition[]> {
  const { filters, costCentreIds } = context
  const params: unknown[] = [filters.startDate, filters.endDate]

  let costCentreCondition = ''
  if (costCentreIds.length) {
    const placeholders = costCentreIds.map(() => '?').join(', ')
    costCentreCondition = `
      AND (
        (bsp.position_type = 'receipt' AND EXISTS (
          SELECT 1 FROM receipt_positions rp WHERE rp.receipt_id = bsp.receipt_id AND rp.cost_centre IN (${placeholders})
        ))
        OR (bsp.position_type = 'invoice' AND EXISTS (
          SELECT 1 FROM invoice_positions ip WHERE ip.invoice_id = bsp.invoice_id AND ip.cost_centre IN (${placeholders})
        ))
        OR (bsp.position_type = 'event' AND EXISTS (
          SELECT 1 FROM event_cost_centre_splits eccs WHERE eccs.event_id = bsp.event_id AND eccs.cost_centre_id IN (${placeholders})
        ))
      )`
    params.push(...costCentreIds, ...costCentreIds, ...costCentreIds)
  }

  const rows: any[] = await query(
    `
    SELECT
      bsp.id,
      bsp.bank_statement_id,
      bsp.position_type,
      bsp.position_date,
      bsp.amount AS event_amount,
      bsp.notes,
      bsp.receipt_id,
      bsp.invoice_id,
      bsp.event_id,
      bs.statement_number,
      bs.statement_date,
      CONCAT(m.first_name, ' ', m.last_name) AS checked_by_name,
      r.receipt_number,
      rc.name AS receipt_company,
      i.invoice_number,
      ic.name AS invoice_company,
      e.name AS event_name,
      (SELECT IFNULL(SUM(rp.amount), 0) FROM receipt_positions rp WHERE rp.receipt_id = bsp.receipt_id) AS receipt_amount,
      (SELECT IFNULL(SUM(ip.quantity * ip.unit_price * (1 + (ip.tax / 100))), 0) FROM invoice_positions ip WHERE ip.invoice_id = bsp.invoice_id) AS invoice_amount
    FROM bank_statement_positions bsp
    INNER JOIN bank_statements bs ON bs.id = bsp.bank_statement_id
    LEFT JOIN members m ON m.id = bs.checked_by
    LEFT JOIN receipts r ON r.id = bsp.receipt_id
    LEFT JOIN companies rc ON rc.id = r.company_id
    LEFT JOIN invoices i ON i.id = bsp.invoice_id
    LEFT JOIN companies ic ON ic.id = i.company_id
    LEFT JOIN events e ON e.id = bsp.event_id
    WHERE bsp.position_date BETWEEN ? AND ?
      ${costCentreCondition}
    ORDER BY bsp.position_date DESC, bsp.id DESC
    `,
    params,
  )

  const splitsByEventId = await loadEventCostCentreSplits(
    rows.filter(row => row.position_type === 'event').map(row => Number(row.event_id)),
  )

  return rows.map((row) => {
    const positionType = String(row.position_type) as FinanceAnalysisBankPositionType
    const eventId = row.event_id === null || row.event_id === undefined ? null : Number(row.event_id)

    const signedAmount = positionType === 'receipt'
      ? -Number(row.receipt_amount || 0)
      : positionType === 'invoice'
        ? Number(row.invoice_amount || 0)
        : Number(row.event_amount || 0)

    const reference = positionType === 'receipt'
      ? String(row.receipt_number || '')
      : positionType === 'invoice'
        ? String(row.invoice_number || '')
        : String(row.statement_number || '')

    const counterparty = positionType === 'receipt'
      ? String(row.receipt_company || '')
      : positionType === 'invoice'
        ? String(row.invoice_company || '')
        : String(row.event_name || '')

    return {
      id: Number(row.id),
      bank_statement_id: Number(row.bank_statement_id),
      statement_number: String(row.statement_number || ''),
      statement_date: String(row.statement_date || ''),
      checked_by_name: String(row.checked_by_name || ''),
      position_type: positionType,
      position_date: String(row.position_date).slice(0, 10),
      amount: roundFinanceCurrency(Math.abs(signedAmount)),
      direction: signedAmount < 0 ? 'out' : 'in',
      reference,
      counterparty,
      receipt_id: row.receipt_id === null || row.receipt_id === undefined ? null : Number(row.receipt_id),
      invoice_id: row.invoice_id === null || row.invoice_id === undefined ? null : Number(row.invoice_id),
      event_id: eventId,
      cost_centres: eventId === null ? [] : splitsByEventId.get(eventId) ?? [],
      notes: row.notes ? String(row.notes) : null,
    } satisfies FinanceAnalysisBankStatementPosition
  })
}

export function summarizeBankStatementPositions(positions: FinanceAnalysisBankStatementPosition[]) {
  const statementIds = new Set<number>()
  let inflow = 0
  let outflow = 0
  let eventRevenue = 0
  let eventCount = 0

  for (const position of positions) {
    statementIds.add(position.bank_statement_id)
    if (position.direction === 'in') inflow += position.amount
    else outflow += position.amount

    if (position.position_type === 'event') {
      eventCount += 1
      eventRevenue += position.direction === 'in' ? position.amount : -position.amount
    }
  }

  return {
    statementCount: statementIds.size,
    positionCount: positions.length,
    inflowTotal: roundFinanceCurrency(inflow),
    outflowTotal: roundFinanceCurrency(outflow),
    eventRevenueTotal: roundFinanceCurrency(eventRevenue),
    eventRevenueCount: eventCount,
  }
}
