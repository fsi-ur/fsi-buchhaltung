import { defineEventHandler } from 'h3'
import { requirePermission } from '~/server/utils/api/guards'
import { getCashDiscrepancyDefaults } from '~/server/utils/cashDiscrepancies'
import type { CashDiscrepancyDefaults } from '~/types/cashCount'

interface GetCashDiscrepancyDefaultsSuccess {
  ok: true
  defaults: CashDiscrepancyDefaults
}

interface GetCashDiscrepancyDefaultsError {
  ok: false
  error: string
}

export type GetCashDiscrepancyDefaultsResponse = GetCashDiscrepancyDefaultsSuccess | GetCashDiscrepancyDefaultsError

export default defineEventHandler(async (event): Promise<GetCashDiscrepancyDefaultsResponse> => {
  const current = await requirePermission(event, 'settings.cost_centres.manage')
  if (!current.ok) return current

  return { ok: true, defaults: await getCashDiscrepancyDefaults() }
})
