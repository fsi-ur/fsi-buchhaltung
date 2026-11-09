import { defineEventHandler } from 'h3'
import { requirePermission } from '~/server/utils/api/guards'
import { loadFinanceAccountIdsInUse, loadFinanceAccounts } from '~/server/utils/financeAccounts'
import { internalError } from '~/server/utils/api/errors'
import type { FinanceAccountSettingsRow } from '~/types/financeAccount'

interface GetFinanceAccountsSuccess {
  ok: true
  accounts: FinanceAccountSettingsRow[]
}

interface GetFinanceAccountsError {
  ok: false
  error: string
}

export type GetFinanceAccountsResponse = GetFinanceAccountsSuccess | GetFinanceAccountsError

export default defineEventHandler(async (event): Promise<GetFinanceAccountsResponse> => {
  const current = await requirePermission(event, 'settings.association.manage')
  if (!current.ok) return current

  try {
    const [accounts, inUse] = await Promise.all([loadFinanceAccounts(), loadFinanceAccountIdsInUse()])
    return {
      ok: true,
      accounts: accounts.map(account => ({ ...account, in_use: inUse.has(account.id) })),
    }
  } catch (err) {
    return internalError('Failed to load accounts', err)
  }
})
