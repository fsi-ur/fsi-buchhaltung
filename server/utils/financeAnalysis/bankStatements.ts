import { query } from '~/server/utils/db'
import { roundFinanceCurrency, type FinanceAnalysisFilters } from '~/server/utils/financeAnalysis/filters'
import { loadEventCostCentreSplits } from '~/server/utils/financeAnalysis/eventSplits'
import { BANK_POSITION_AMOUNT_SQL } from '~/server/utils/bankBalances'
import type {
  FinanceAnalysisBankPositionType,
  FinanceAnalysisBankStatementPosition,
} from '~/types/financeAnalysis'

interface BankStatementQueryContext {
  filters: FinanceAnalysisFilters
  costCentreIds: number[]
}

/**
 * All bank statement positions in the period, one row per moved account: a transfer between own
 * accounts appears twice (sending and receiving side). Not filtered by account — see
 * {@link filterBankPositionsByAccount}; the event revenue in the result must not depend on it.
 */
export async function loadFinanceAnalysisBankStatementPositions(
  context: BankStatementQueryContext,
): Promise<FinanceAnalysisBankStatementPosition[]> {
  const { filters, costCentreIds } = context
  const params: unknown[] = [filters.startDate, filters.endDate]

  let costCentreCondition = ''
  if (costCentreIds.length) {
    // Transfers have no cost centre and drop out under a cost centre filter.
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
      bsp.notes,
      bsp.receipt_id,
      bsp.invoice_id,
      bsp.event_id,
      bsp.counter_account_id,
      bsp.linked_position_id,
      EXISTS (SELECT 1 FROM bank_statement_positions conf WHERE conf.linked_position_id = bsp.id) AS is_confirmed,
      CONCAT(rm.first_name, ' ', rm.last_name) AS reimbursement_member,
      bs.account_id,
      fa.name AS account_name,
      cfa.name AS counter_account_name,
      bs.statement_number,
      bs.statement_date,
      CONCAT(m.first_name, ' ', m.last_name) AS checked_by_name,
      r.receipt_number,
      rc.name AS receipt_company,
      i.invoice_number,
      ic.name AS invoice_company,
      e.name AS event_name,
      ${BANK_POSITION_AMOUNT_SQL} AS signed_amount
    FROM bank_statement_positions bsp
    INNER JOIN bank_statements bs ON bs.id = bsp.bank_statement_id
    LEFT JOIN finance_accounts fa ON fa.id = bs.account_id
    LEFT JOIN finance_accounts cfa ON cfa.id = bsp.counter_account_id
    LEFT JOIN members m ON m.id = bs.checked_by
    LEFT JOIN receipts r ON r.id = bsp.receipt_id
    LEFT JOIN companies rc ON rc.id = r.company_id
    LEFT JOIN invoices i ON i.id = bsp.invoice_id
    LEFT JOIN companies ic ON ic.id = i.company_id
    LEFT JOIN events e ON e.id = bsp.event_id
    LEFT JOIN reimbursements rreimb ON rreimb.id = bsp.reimbursement_id
    LEFT JOIN members rm ON rm.id = rreimb.paid_by
    WHERE bsp.position_date BETWEEN ? AND ?
      ${costCentreCondition}
    ORDER BY bsp.position_date DESC, bsp.id DESC
    `,
    params,
  )

  const splitsByEventId = await loadEventCostCentreSplits(
    rows.filter(row => row.position_type === 'event').map(row => Number(row.event_id)),
  )

  const result: FinanceAnalysisBankStatementPosition[] = []
  for (const row of rows) {
    const positionType = String(row.position_type) as FinanceAnalysisBankPositionType
    const eventId = row.event_id === null || row.event_id === undefined ? null : Number(row.event_id)
    const counterAccountId = row.counter_account_id === null || row.counter_account_id === undefined ? null : Number(row.counter_account_id)
    const signedAmount = Number(row.signed_amount || 0)
    const accountName = String(row.account_name || '')
    const counterAccountName = row.counter_account_name ? String(row.counter_account_name) : null

    const reference = positionType === 'receipt'
      ? String(row.receipt_number || '')
      : positionType === 'invoice'
        ? String(row.invoice_number || '')
        : String(row.statement_number || '')

    const counterparty = positionType === 'receipt'
      ? String(row.receipt_company || '')
      : positionType === 'invoice'
        ? String(row.invoice_company || '')
        : positionType === 'transfer'
          ? (counterAccountName ?? '')
          : positionType === 'reimbursement'
            ? String(row.reimbursement_member || '')
            : String(row.event_name || '')

    const base = {
      id: Number(row.id),
      bank_statement_id: Number(row.bank_statement_id),
      statement_number: String(row.statement_number || ''),
      statement_date: String(row.statement_date || ''),
      checked_by_name: String(row.checked_by_name || ''),
      position_type: positionType,
      position_date: String(row.position_date).slice(0, 10),
      reference,
      receipt_id: row.receipt_id === null || row.receipt_id === undefined ? null : Number(row.receipt_id),
      invoice_id: row.invoice_id === null || row.invoice_id === undefined ? null : Number(row.invoice_id),
      event_id: eventId,
      cost_centres: eventId === null ? [] : splitsByEventId.get(eventId) ?? [],
      notes: row.notes ? String(row.notes) : null,
    }

    result.push({
      ...base,
      row_key: String(row.id),
      account_id: Number(row.account_id),
      account_name: accountName,
      counter_account_id: counterAccountId,
      counter_account_name: counterAccountName,
      amount: roundFinanceCurrency(Math.abs(signedAmount)),
      direction: signedAmount < 0 ? 'out' : 'in',
      counterparty,
    } satisfies FinanceAnalysisBankStatementPosition)

    // Until the other account confirms an entered transfer, its side shows here too (expected amount).
    const isOpenTransfer = positionType === 'transfer' && row.linked_position_id == null && !Number(row.is_confirmed)
    if (isOpenTransfer && counterAccountId !== null) {
      result.push({
        ...base,
        row_key: `${row.id}-counter`,
        account_id: counterAccountId,
        account_name: counterAccountName ?? '',
        counter_account_id: Number(row.account_id),
        counter_account_name: accountName,
        amount: roundFinanceCurrency(Math.abs(signedAmount)),
        direction: signedAmount < 0 ? 'in' : 'out',
        counterparty: accountName,
      } satisfies FinanceAnalysisBankStatementPosition)
    }
  }

  return result
}

/** Rows moving one of the given accounts; an empty selection means all accounts. */
export function filterBankPositionsByAccount(
  positions: FinanceAnalysisBankStatementPosition[],
  accountIds: number[],
) {
  if (!accountIds.length) return positions
  const selected = new Set(accountIds)
  return positions.filter(position => selected.has(position.account_id))
}

/**
 * Totals of the given rows. Transfers between two accounts that are both in view are internal and
 * left out of inflow/outflow; a transfer to an account outside the selection counts as money moved.
 */
export function summarizeBankStatementPositions(
  positions: FinanceAnalysisBankStatementPosition[],
  accountIds: number[] = [],
) {
  const selected = new Set(accountIds)
  const isInternal = (position: FinanceAnalysisBankStatementPosition) =>
    position.position_type === 'transfer'
    && (selected.size === 0 || (position.counter_account_id !== null && selected.has(position.counter_account_id)))

  const statementIds = new Set<number>()
  const positionIds = new Set<number>()
  let inflow = 0
  let outflow = 0
  let eventRevenue = 0
  let eventCount = 0

  for (const position of positions) {
    // The counter side of a transfer sits on the other account's statement — not one of these.
    if (!position.row_key.endsWith('-counter')) statementIds.add(position.bank_statement_id)
    positionIds.add(position.id)
    if (!isInternal(position)) {
      if (position.direction === 'in') inflow += position.amount
      else outflow += position.amount
    }

    if (position.position_type === 'event') {
      eventCount += 1
      eventRevenue += position.direction === 'in' ? position.amount : -position.amount
    }
  }

  return {
    statementCount: statementIds.size,
    positionCount: positionIds.size,
    inflowTotal: roundFinanceCurrency(inflow),
    outflowTotal: roundFinanceCurrency(outflow),
    eventRevenueTotal: roundFinanceCurrency(eventRevenue),
    eventRevenueCount: eventCount,
  }
}
