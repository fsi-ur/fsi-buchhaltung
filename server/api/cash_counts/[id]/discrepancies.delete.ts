import { defineEventHandler } from 'h3'
import { requirePermission } from '~/server/utils/api/guards'
import { getNumericRouteParam } from '~/server/utils/api/request'
import { withAuditTransaction } from '~/server/utils/db'
import { deleteCashDiscrepancyBooking } from '~/server/utils/cashDiscrepancies'
import {
  loadCashCountDiscrepancies,
  type CashCountDiscrepancyView,
} from '~/server/utils/financeAnalysis/cashDiscrepancies'

interface DeleteCashCountDiscrepancySuccess extends CashCountDiscrepancyView {
  ok: true
}

interface DeleteCashCountDiscrepancyError {
  ok: false
  error: string
}

export type DeleteCashCountDiscrepancyResponse = DeleteCashCountDiscrepancySuccess | DeleteCashCountDiscrepancyError

/** Withdraws a confirmation. The difference stays in every report — it is only unconfirmed again. */
export default defineEventHandler(async (event): Promise<DeleteCashCountDiscrepancyResponse> => {
  const current = await requirePermission(event, 'cash_counts.edit')
  if (!current.ok) return current

  const id = getNumericRouteParam(event)
  if (!id) return { ok: false, error: 'Invalid cash count id' }

  await withAuditTransaction(current.user, async conn => deleteCashDiscrepancyBooking(id, conn))

  const view = await loadCashCountDiscrepancies(id)
  if (!view) return { ok: false, error: 'Cash count not found' }
  return { ok: true, ...view }
})
