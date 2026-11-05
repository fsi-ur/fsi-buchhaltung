import { defineEventHandler, readBody } from 'h3'
import { query, withAuditTransaction } from '~/server/utils/db'
import { requirePermission } from '~/server/utils/api/guards'
import { canManageUser } from '~/server/utils/userAccounts'
import { internalError } from '~/server/utils/api/errors'

interface ChangeUsernameBody {
  user_id?: number
  username?: string
}

interface ChangeUsernameSuccess {
  ok: true
}

interface ChangeUsernameError {
  ok: false
  error: string
}

type ChangeUsernameResponse = ChangeUsernameSuccess | ChangeUsernameError

interface MysqlError extends Error {
  code?: string
}

export default defineEventHandler(async (event): Promise<ChangeUsernameResponse> => {
  const current = await requirePermission(event, 'users.manage', { touch: false })
  if (!current.ok) return current

  const body = await readBody<ChangeUsernameBody | null>(event)
  const userId = Number(body?.user_id)
  const username = String(body?.username || '').trim()

  if (!Number.isInteger(userId) || userId <= 0) return { ok: false, error: 'Missing fields' }
  if (!username) return { ok: false, error: 'Username required' }

  const manageError = await canManageUser(current.user.permissions, userId)
  if (manageError) return { ok: false, error: manageError }

  try {
    await withAuditTransaction(current.user, async (conn) => {
      const result = await query<any>(
        'UPDATE users SET username = ? WHERE id = ?',
        [username, userId],
        conn,
      )

      if (Number(result.affectedRows ?? 0) === 0) {
        throw new Error('User not found')
      }
    })
  } catch (err: unknown) {
    const error = err as MysqlError
    if (error.code === 'ER_DUP_ENTRY') return { ok: false, error: 'Username already exists' }
    if (error.message === 'User not found') return { ok: false, error: 'User not found' }
    return internalError('Failed to change username', error)
  }

  return { ok: true }
})
