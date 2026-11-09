import { defineEventHandler, readBody } from 'h3'
import { query, withAuditTransaction } from '~/server/utils/db'
import { requirePermission } from '~/server/utils/api/guards'
import { ensureDefaultFinanceAccount, isFinanceAccountInUse, loadFinanceAccount } from '~/server/utils/financeAccounts'
import { internalError } from '~/server/utils/api/errors'

interface DeleteFinanceAccountSuccess {
  ok: true
}

interface DeleteFinanceAccountError {
  ok: false
  error: string
}

export type DeleteFinanceAccountResponse = DeleteFinanceAccountSuccess | DeleteFinanceAccountError

export default defineEventHandler(async (event): Promise<DeleteFinanceAccountResponse> => {
  const current = await requirePermission(event, 'settings.association.manage', { touch: false })
  if (!current.ok) return current

  const body = await readBody<{ id?: unknown }>(event).catch(() => null)
  const id = Number(body?.id)
  if (!Number.isInteger(id) || id <= 0) return { ok: false, error: 'Invalid account id' }

  try {
    return await withAuditTransaction(current.user, async (conn) => {
      await query(`SELECT id FROM finance_accounts FOR UPDATE`, [], conn)
      const account = await loadFinanceAccount(id, conn)
      if (!account) return { ok: false as const, error: 'Das Konto wurde nicht gefunden.' }
      if (await isFinanceAccountInUse(id, conn)) {
        return { ok: false as const, error: 'Auf diesem Konto sind bereits Buchungen erfasst. Es kann nur archiviert werden.' }
      }

      await query(`DELETE FROM finance_accounts WHERE id = ?`, [id], conn)
      await ensureDefaultFinanceAccount(conn)
      return { ok: true as const }
    })
  } catch (err) {
    return internalError('Das Konto konnte nicht gelöscht werden', err)
  }
})
