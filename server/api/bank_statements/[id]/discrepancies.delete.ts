import { defineEventHandler, getQuery } from 'h3'
import { requirePermission } from '~/server/utils/api/guards'
import { getNumericRouteParam } from '~/server/utils/api/request'
import { query, withAuditTransaction } from '~/server/utils/db'
import { internalError } from '~/server/utils/api/errors'
import { isUnlockRequested, lockError } from '~/server/utils/recordLocks'
import {
  loadBankStatementDiscrepancies,
  type BankStatementDiscrepancyView,
} from '~/server/utils/financeAnalysis/bankDiscrepancies'

interface DeleteBankDiscrepancySuccess extends BankStatementDiscrepancyView {
  ok: true
}

interface DeleteBankDiscrepancyError {
  ok: false
  error: string
}

export type DeleteBankDiscrepancyResponse = DeleteBankDiscrepancySuccess | DeleteBankDiscrepancyError

/** Withdraws the confirmation of a bank difference. The difference stays in every report — only unconfirmed again. */
export default defineEventHandler(async (event): Promise<DeleteBankDiscrepancyResponse> => {
  const current = await requirePermission(event, 'bank_statements.edit')
  if (!current.ok) return current

  const id = getNumericRouteParam(event)
  if (!id) return { ok: false, error: 'Invalid bank statement id' }

  const params = getQuery(event)
  const positionId = Number(params.position_id)
  if (!Number.isInteger(positionId) || positionId <= 0) return { ok: false, error: 'Invalid position id' }

  // Withdrawing a confirmation changes a booked record: it needs the unlock (SEC-22).
  const locked = lockError(true, current.user.permissions, 'bank_statements.unlock', isUnlockRequested(params.unlock))
  if (locked) return { ok: false, error: locked }

  try {
    await withAuditTransaction(current.user, async conn => query(
      `DELETE b FROM bank_discrepancy_bookings b
       INNER JOIN bank_statement_positions bsp ON bsp.id = b.bank_statement_position_id
       WHERE b.bank_statement_position_id = ? AND bsp.bank_statement_id = ?`,
      [positionId, id],
      conn,
    ))
    return { ok: true, ...await loadBankStatementDiscrepancies(id) }
  } catch (err) {
    return internalError('Failed to withdraw bank difference', err)
  }
})
