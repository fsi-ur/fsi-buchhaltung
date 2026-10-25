import { defineEventHandler, readBody } from 'h3'
import { requirePermission } from '~/server/utils/api/guards'
import { withAuditTransaction } from '~/server/utils/db'
import {
  normalizeCashDiscrepancyDefaults,
  saveCashDiscrepancyDefaults,
  validateSphereCostCentrePair,
} from '~/server/utils/cashDiscrepancies'
import type { CashDiscrepancyDefaults } from '~/types/cashCount'

interface SaveCashDiscrepancyDefaultsSuccess {
  ok: true
  defaults: CashDiscrepancyDefaults
}

interface SaveCashDiscrepancyDefaultsError {
  ok: false
  error: string
}

export type SaveCashDiscrepancyDefaultsResponse = SaveCashDiscrepancyDefaultsSuccess | SaveCashDiscrepancyDefaultsError

export default defineEventHandler(async (event): Promise<SaveCashDiscrepancyDefaultsResponse> => {
  const current = await requirePermission(event, 'settings.cost_centres.manage')
  if (!current.ok) return current

  const defaults = normalizeCashDiscrepancyDefaults(await readBody(event))
  const error = await validateSphereCostCentrePair(defaults.sphere_id, defaults.cost_centre_id)
  if (error) return { ok: false, error }

  await withAuditTransaction(current.user, async conn => saveCashDiscrepancyDefaults(defaults, conn))
  return { ok: true, defaults }
})
