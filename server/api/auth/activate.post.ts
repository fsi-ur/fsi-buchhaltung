import { defineEventHandler, readBody } from 'h3'
import { requirePermission } from '~/server/utils/api/guards'
import { query, withAuditTransaction } from '~/server/utils/db'
import type { ActivateBody, ActivateResponse } from '~/types/activate'
import { canManageUser } from '~/server/utils/userAccounts'
import { withLastAdminGuard } from '~/server/utils/permissions'
import { internalError } from '~/server/utils/api/errors'

export default defineEventHandler(async (event): Promise<ActivateResponse> => {
  const current = await requirePermission(event, 'users.manage')
  if (!current.ok) return current

  const { id, is_active } = await readBody<ActivateBody>(event)
  if (id === undefined || id === null || is_active === undefined || is_active === null) {
    return { ok: false, error: 'Missing fields' }
  }
  const userId = Number(id)

  if (!is_active && userId === Number(current.user.id)) {
    return { ok: false, error: 'Du kannst dein eigenes Benutzerkonto nicht deaktivieren.' }
  }

  const manageError = await canManageUser(current.user.permissions, userId)
  if (manageError) return { ok: false, error: manageError }

  try {
    return await withAuditTransaction(current.user, withLastAdminGuard(async (conn) => {
      const result = await query<any>('UPDATE users SET is_active = ? WHERE id = ?', [is_active ? 1 : 0, userId], conn)
      if (Number(result.affectedRows ?? 0) === 0) return { ok: false as const, error: 'No matching user in database' }

      // A deactivated account loses its push subscriptions — the only automatic removal (SEC-20).
      if (!is_active) await query('DELETE FROM notification_push_subscriptions WHERE user_id = ?', [userId], conn)

      return { ok: true as const }
    }))
  } catch (err: any) {
    return internalError('An error occured while activating/deactivating the user', err)
  }
})
