import { defineEventHandler } from 'h3'
import { requirePermission } from '~/server/utils/api/guards'
import { loadFinanceAccounts, toFinanceAccountOption } from '~/server/utils/financeAccounts'
import { internalError } from '~/server/utils/api/errors'
import type { FinanceAccountOption } from '~/types/financeAccount'

interface FinanceAccountOptionsSuccess {
  ok: true
  /** False without any active account: every bank feature is switched off. */
  bankEnabled: boolean
  /** All accounts including archived ones (needed for the labels of old records). */
  accounts: FinanceAccountOption[]
}

interface FinanceAccountOptionsError {
  ok: false
  error: string
}

export type FinanceAccountOptionsResponse = FinanceAccountOptionsSuccess | FinanceAccountOptionsError

export default defineEventHandler(async (event): Promise<FinanceAccountOptionsResponse> => {
  const current = await requirePermission(event, [
    'bank_statements.view',
    'reimbursements.view',
    'receipts.view',
    'invoices.view',
    'cash_counts.view',
    'budgets.view',
    'settings.association.manage',
  ])
  if (!current.ok) return current

  try {
    const accounts = await loadFinanceAccounts()
    return {
      ok: true,
      bankEnabled: accounts.some(account => !account.archived),
      accounts: accounts.map(toFinanceAccountOption),
    }
  } catch (err) {
    return internalError('Failed to load accounts', err)
  }
})
