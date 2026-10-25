import { defineEventHandler, readBody } from 'h3'
import { requirePermission } from '~/server/utils/api/guards'
import { getNumericRouteParam } from '~/server/utils/api/request'
import { withAuditTransaction } from '~/server/utils/db'
import {
  parseCashDiscrepancyBookingBody,
  upsertCashDiscrepancyBooking,
  validateSphereCostCentrePair,
} from '~/server/utils/cashDiscrepancies'
import {
  loadCashCountDiscrepancies,
  type CashCountDiscrepancyView,
} from '~/server/utils/financeAnalysis/cashDiscrepancies'

interface SaveCashCountDiscrepancySuccess extends CashCountDiscrepancyView {
  ok: true
}

interface SaveCashCountDiscrepancyError {
  ok: false
  error: string
}

export type SaveCashCountDiscrepancyResponse = SaveCashCountDiscrepancySuccess | SaveCashCountDiscrepancyError

/** Confirms (accepts) the net cash difference of a count, optionally moving it to another sphere/cost centre. */
export default defineEventHandler(async (event): Promise<SaveCashCountDiscrepancyResponse> => {
  const current = await requirePermission(event, 'cash_counts.edit')
  if (!current.ok) return current

  const id = getNumericRouteParam(event)
  if (!id) return { ok: false, error: 'Invalid cash count id' }

  const body = parseCashDiscrepancyBookingBody(await readBody(event))

  const pairError = await validateSphereCostCentrePair(body.sphere_id, body.cost_centre_id)
  if (pairError) return { ok: false, error: pairError }

  // The accepted amount is whatever the books show right now, never a client-supplied value.
  const view = await loadCashCountDiscrepancies(id)
  if (!view) return { ok: false, error: 'Cash count not found' }
  const item = view.item
  if (!item) return { ok: false, error: 'Diese Zählung hat keine Kassendifferenz – die Abweichungen der Kassen gleichen sich aus.' }

  await withAuditTransaction(current.user, async conn => upsertCashDiscrepancyBooking(id, item.amount, body, current.user.id, conn))

  const refreshed = await loadCashCountDiscrepancies(id)
  if (!refreshed) return { ok: false, error: 'Cash count not found' }
  return { ok: true, ...refreshed }
})
