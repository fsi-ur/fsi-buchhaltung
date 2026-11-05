import { sessionCookieOptions } from '~/server/utils/sessionCookie'
import { defineEventHandler, getCookie, setCookie } from 'h3'
import { deleteSessionByToken, cleanupExpiredSessions } from '~/server/utils/auth'

interface LogoutResponse {
  ok: boolean
}

export default defineEventHandler(async (event): Promise<LogoutResponse> => {
  const cookieName = process.env.SESSION_COOKIE_NAME || 'app_session'
  const token = getCookie(event, cookieName)
  if (token) {
    await deleteSessionByToken(token)
    setCookie(event, cookieName, '', sessionCookieOptions(0))
    await cleanupExpiredSessions() 
    return { ok: true }
  }

  return { ok: false }
})