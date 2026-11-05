import { defineEventHandler, readBody } from 'h3'
import { query, withAuditTransaction } from '~/server/utils/db'
import { requirePermission } from '~/server/utils/api/guards'
import { internalError } from '~/server/utils/api/errors'

interface RequirePasswordChangeBody {
  user_id?: number
}

interface RequirePasswordChangeSuccess {
  ok: true
}

interface RequirePasswordChangeError {
  ok: false
  error: string
}

type RequirePasswordChangeResponse = RequirePasswordChangeSuccess | RequirePasswordChangeError

export default defineEventHandler(async (event): Promise<RequirePasswordChangeResponse> => {
  const current = await requirePermission(event, 'users.manage', { touch: false })
  if (!current.ok) return current

  const body = await readBody<RequirePasswordChangeBody | null>(event)
  const userId = Number(body?.user_id)
  if (!Number.isInteger(userId) || userId <= 0) return { ok: false, error: 'Missing fields' }

  try {
    await withAuditTransaction(current.user, async (conn) => {
      const result = await query<any>(
        'UPDATE users SET must_change_password = 1 WHERE id = ?',
        [userId],
        conn,
      )

      if (Number(result.affectedRows ?? 0) === 0) {
        throw new Error('User not found')
      }
    })
  } catch (err: any) {
    if (err?.message === 'User not found') return { ok: false, error: 'User not found' }
    return internalError('Failed to flag user', err)
  }

  return { ok: true }
})
