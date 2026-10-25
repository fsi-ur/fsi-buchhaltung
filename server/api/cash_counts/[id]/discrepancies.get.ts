import { defineEventHandler } from 'h3'
import { requirePermission } from '~/server/utils/api/guards'
import { getNumericRouteParam } from '~/server/utils/api/request'
import {
  loadCashCountDiscrepancies,
  type CashCountDiscrepancyView,
} from '~/server/utils/financeAnalysis/cashDiscrepancies'

interface GetCashCountDiscrepanciesSuccess extends CashCountDiscrepancyView {
  ok: true
}

interface GetCashCountDiscrepanciesError {
  ok: false
  error: string
}

export type GetCashCountDiscrepanciesResponse = GetCashCountDiscrepanciesSuccess | GetCashCountDiscrepanciesError

export default defineEventHandler(async (event): Promise<GetCashCountDiscrepanciesResponse> => {
  const current = await requirePermission(event, 'cash_counts.view')
  if (!current.ok) return current

  const id = getNumericRouteParam(event)
  if (!id) return { ok: false, error: 'Invalid cash count id' }

  const view = await loadCashCountDiscrepancies(id)
  if (!view) return { ok: false, error: 'Cash count not found' }
  return { ok: true, ...view }
})
