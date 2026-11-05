import { defineEventHandler } from 'h3'
import { requirePermission } from '~/server/utils/api/guards'
import { computeCurrentBankBalance } from '~/server/utils/cashPosition'
import { internalError } from '~/server/utils/api/errors'

interface CurrentBalanceSuccess {
  ok: true
  balance: number
}

interface CurrentBalanceError {
  ok: false
  error: string
}

type CurrentBalanceResponse = CurrentBalanceSuccess | CurrentBalanceError

export default defineEventHandler(async (event): Promise<CurrentBalanceResponse> => {
  const current = await requirePermission(event, 'bank_statements.view')
  if (!current.ok) return current

  try {
    const balance = await computeCurrentBankBalance()
    return { ok: true, balance }
  } catch (err: any) {
    return internalError('Failed to compute current balance', err)
  }
})
