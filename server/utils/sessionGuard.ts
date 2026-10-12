import { getCookie } from 'h3'
import { getSessionByToken, touchSession, inactivityMinutes, deleteSessionByToken } from './auth'
import { getUserPermissions, getUserPositionIds, getUserRoleIds } from './permissions'
import { normalizeBigInt } from '~/server/utils/normalize'
import type { User } from '~/types/user'
import { parseInstant } from '~/shared/time'

interface SessionSuccess {
  ok: true
  user: User
}

interface SessionError {
  ok: false
  error: string
}

export type SessionResponse = SessionError | SessionSuccess

export async function getCurrentUserFromEvent(event: any, touch: boolean): Promise<SessionResponse> {
  const cookieName = process.env.SESSION_COOKIE_NAME || 'app_session'
  const token = getCookie(event, cookieName)

  if (!token) return { ok: false, error: "missing token" }

  const session = normalizeBigInt(await getSessionByToken(token))
  if (!session) return { ok: false, error: "error on getting session" }

  const isActive = session.is_active === 1 || session.is_active === '1'
  if (!isActive) {
    await deleteSessionByToken(token)
    return { ok: false, error: "user inactive" }
  }
  const mustChangePassword = session.must_change_password === 1 || session.must_change_password === '1'

  const now = new Date()
  const expiresAt = parseInstant(session.expires_at)
  if (expiresAt && expiresAt < now) {
    return { ok: false, error: "session expired" }
  }

  const lastActive = parseInstant(session.last_active_at) ?? new Date(0)
  const inactivityLimit = new Date(lastActive.getTime() + inactivityMinutes * 60 * 1000)

  if (inactivityLimit < now) {
    await deleteSessionByToken(token)
    return { ok: false, error: "user has been inactive for too long" }
  }
  
  if (touch) await touchSession(token)

  const roles = await getUserRoleIds(Number(session.user_id))
  const positionIds = await getUserPositionIds(Number(session.user_id))
  const permissions = await getUserPermissions(Number(session.user_id), roles, positionIds)

  return {
    ok: true,
    user: {
      id: session.user_id,
      username: session.username,
      roles,
      permissions,
      is_active: isActive,
      must_change_password: mustChangePassword
    }
  }
}
