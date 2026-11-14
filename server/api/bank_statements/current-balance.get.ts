import { defineEventHandler } from 'h3'
import { requirePermission } from '~/server/utils/api/guards'
import { computeCurrentBankBalances } from '~/server/utils/cashPosition'
import { loadFinanceAccounts } from '~/server/utils/financeAccounts'
import { internalError } from '~/server/utils/api/errors'
import type { FinanceAccountBalance } from '~/types/financeAccount'

interface CurrentBalanceSuccess {
  ok: true
  balance: number
  /** Active accounts plus archived ones that still hold money */
  accounts: FinanceAccountBalance[]
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
    const [balances, accounts] = await Promise.all([computeCurrentBankBalances(), loadFinanceAccounts()])
    return {
      ok: true,
      balance: balances.total,
      accounts: accounts
        .map(account => ({
          account_id: account.id,
          name: account.name,
          archived: account.archived,
          balance: balances.byAccount.get(account.id) ?? 0,
        }))
        .filter(account => !account.archived || account.balance !== 0),
    }
  } catch (err: any) {
    return internalError('Failed to compute current balance', err)
  }
})
