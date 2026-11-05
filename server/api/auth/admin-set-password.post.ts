import { defineEventHandler, readBody } from 'h3'
import { hashPassword } from '~/server/utils/auth'
import { query, withAuditTransaction } from '~/server/utils/db'
import { requirePermission } from '~/server/utils/api/guards'
import { passwordPolicyError } from '~/config/validation'
import { canManageUser } from '~/server/utils/userAccounts'
import { internalError } from '~/server/utils/api/errors'

interface AdminSetPasswordBody {
  user_id?: number
  newPassword?: string
  confirmPassword?: string
}

interface AdminSetPasswordSuccess {
  ok: true
}

interface AdminSetPasswordError {
  ok: false
  error: string
}

export type AdminSetPasswordResponse = AdminSetPasswordSuccess | AdminSetPasswordError

export default defineEventHandler(async (event): Promise<AdminSetPasswordResponse> => {
  const current = await requirePermission(event, 'users.manage', { touch: false })
  if (!current.ok) return current

  const body = await readBody<AdminSetPasswordBody | null>(event)
  const userId = Number(body?.user_id)
  const newPassword = String(body?.newPassword || '')
  const confirmPassword = String(body?.confirmPassword || '')

  if (!Number.isInteger(userId) || userId <= 0) return { ok: false, error: 'Missing fields' }
  if (!newPassword || !confirmPassword) return { ok: false, error: 'Missing fields' }
  const policyError = passwordPolicyError(newPassword)
  if (policyError) return { ok: false, error: policyError }
  if (newPassword !== confirmPassword) return { ok: false, error: 'Passwords do not match' }

  const manageError = await canManageUser(current.user.permissions, userId)
  if (manageError) return { ok: false, error: manageError }

  const newPasswordHash = await hashPassword(newPassword)

  try {
    await withAuditTransaction(current.user, async (conn) => {
      const result = await query<any>(
        'UPDATE users SET password_hash = ? WHERE id = ?',
        [newPasswordHash, userId],
        conn,
      )

      if (Number(result.affectedRows ?? 0) === 0) {
        throw new Error('User not found')
      }

      await query('DELETE FROM sessions WHERE user_id = ?', [userId], conn)
    })
  } catch (err: any) {
    if (err?.message === 'User not found') return { ok: false, error: 'User not found' }
    return internalError('Failed to set password', err)
  }

  return { ok: true }
})
