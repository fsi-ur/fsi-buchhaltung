import crypto from 'crypto'
import { hmacToken } from '~/server/utils/auth'
import type { NotificationTypeKey } from '~/config/notificationTypes'

/**
 * Answer buttons ("Zusage" / "Absage" / "Vielleicht") on appointment push notifications.
 *
 * The service worker answers in the background, without the app being open — and possibly long
 * after the session cookie expired. So every push that carries buttons also carries a token,
 * signed for exactly one member, one appointment and one occurrence. It can only ever answer that
 * single date; the endpoint re-checks everything else (account active, permission, audience).
 */

/** How long the buttons of a delivered notification keep working. */
export const PUSH_RESPONSE_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000
const TOKEN_PURPOSE = 'push-response:'

export interface PushResponseTarget {
  appointmentId: number
  /** Original start of the occurrence as produced by the recurrence rule ("YYYY-MM-DD HH:mm:ss"). */
  occurrenceDate: string
}

export interface PushResponseTokenClaims extends PushResponseTarget {
  userId: number
  memberId: number
  expiresAt: number
}

/**
 * The single date a notification lets the recipient answer, or null when it gets no buttons:
 * cancellations, and invitations/changes that concern a whole series. Reminders are always about
 * one occurrence (older queued rows predate `response_occurrence_date`, hence the fallback).
 */
export function pushResponseTarget(type: NotificationTypeKey, payload: Record<string, any> | null | undefined): PushResponseTarget | null {
  if (!payload) return null
  let occurrenceDate: unknown = null
  if (type === 'appointment.reminder') occurrenceDate = payload.response_occurrence_date ?? payload.occurrence_date
  else if (type === 'appointment.invited' || type === 'appointment.changed') occurrenceDate = payload.response_occurrence_date

  const appointmentId = Number(payload.appointment_id)
  if (!Number.isInteger(appointmentId) || appointmentId <= 0) return null
  if (typeof occurrenceDate !== 'string' || !/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}(:\d{2})?$/.test(occurrenceDate)) return null

  return { appointmentId, occurrenceDate: occurrenceDate.length === 16 ? `${occurrenceDate}:00` : occurrenceDate }
}

function sign(encodedClaims: string): string {
  return hmacToken(TOKEN_PURPOSE + encodedClaims)
}

export function createPushResponseToken(claims: Omit<PushResponseTokenClaims, 'expiresAt'>, now = Date.now()): string {
  const body: PushResponseTokenClaims = { ...claims, expiresAt: now + PUSH_RESPONSE_TOKEN_TTL_MS }
  const encoded = Buffer.from(JSON.stringify([body.userId, body.memberId, body.appointmentId, body.occurrenceDate, body.expiresAt])).toString('base64url')
  return `${encoded}.${sign(encoded)}`
}

export function verifyPushResponseToken(token: unknown, now = Date.now()): PushResponseTokenClaims | null {
  if (typeof token !== 'string' || token.length > 512) return null
  const [encoded, signature, ...rest] = token.split('.')
  if (!encoded || !signature || rest.length) return null

  const expected = Buffer.from(sign(encoded), 'hex')
  const given = Buffer.from(signature, 'hex')
  if (given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) return null

  let decoded: unknown
  try {
    decoded = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'))
  } catch {
    return null
  }
  if (!Array.isArray(decoded) || decoded.length !== 5) return null

  const [userId, memberId, appointmentId, occurrenceDate, expiresAt] = decoded
  if (![userId, memberId, appointmentId, expiresAt].every(value => Number.isInteger(value) && value > 0)) return null
  if (typeof occurrenceDate !== 'string') return null
  if (expiresAt < now) return null

  return { userId, memberId, appointmentId, occurrenceDate, expiresAt }
}
