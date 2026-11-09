import { defineEventHandler, readBody } from 'h3'
import { requirePermission } from '~/server/utils/api/guards'
import { getNumericRouteParam } from '~/server/utils/api/request'
import { withAuditTransaction } from '~/server/utils/db'
import { internalError } from '~/server/utils/api/errors'
import { isUnlockRequested, lockError } from '~/server/utils/recordLocks'
import { parseCashDiscrepancyBookingBody, validateSphereCostCentrePair } from '~/server/utils/cashDiscrepancies'
import {
  loadBankStatementDiscrepancies,
  upsertBankDiscrepancyBooking,
  type BankStatementDiscrepancyView,
} from '~/server/utils/financeAnalysis/bankDiscrepancies'

interface SaveBankDiscrepancySuccess extends BankStatementDiscrepancyView {
  ok: true
}

interface SaveBankDiscrepancyError {
  ok: false
  error: string
}

export type SaveBankDiscrepancyResponse = SaveBankDiscrepancySuccess | SaveBankDiscrepancyError

/** Confirms (accepts) the bank difference of one confirmation, optionally moving it to another sphere/cost centre. */
export default defineEventHandler(async (event): Promise<SaveBankDiscrepancyResponse> => {
  const current = await requirePermission(event, 'bank_statements.edit')
  if (!current.ok) return current

  const id = getNumericRouteParam(event)
  if (!id) return { ok: false, error: 'Invalid bank statement id' }

  const rawBody = await readBody(event).catch(() => null)
  const positionId = Number(rawBody?.position_id)
  if (!Number.isInteger(positionId) || positionId <= 0) return { ok: false, error: 'Invalid position id' }

  const body = parseCashDiscrepancyBookingBody(rawBody)
  const pairError = await validateSphereCostCentrePair(body.sphere_id, body.cost_centre_id)
  if (pairError) return { ok: false, error: pairError }

  try {
    // The accepted amount is whatever the books show right now, never a client-supplied value.
    const view = await loadBankStatementDiscrepancies(id)
    const item = view.items.find(entry => entry.bank?.bank_statement_position_id === positionId)
    if (!item) return { ok: false, error: 'Diese Position hat keine Kontodifferenz.' }

    // A confirmed difference is booked: changing it needs the unlock (SEC-22), like cash differences.
    const locked = lockError(item.status !== 'unconfirmed', current.user.permissions, 'bank_statements.unlock', isUnlockRequested(rawBody?.unlock))
    if (locked) return { ok: false, error: locked }

    await withAuditTransaction(current.user, async conn => upsertBankDiscrepancyBooking(positionId, item.amount, body, current.user.id, conn))
    return { ok: true, ...await loadBankStatementDiscrepancies(id) }
  } catch (err) {
    return internalError('Failed to confirm bank difference', err)
  }
})
