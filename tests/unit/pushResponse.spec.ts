import { describe, expect, it } from 'vitest'
import {
  createPushResponseToken,
  PUSH_RESPONSE_TOKEN_TTL_MS,
  pushResponseTarget,
  verifyPushResponseToken,
} from '~/server/utils/notifications/pushResponse'

const claims = { userId: 7, memberId: 42, appointmentId: 3, occurrenceDate: '2026-12-01 18:00:00' }

describe('push answer token', () => {
  it('round-trips its claims', () => {
    const now = 1_700_000_000_000
    const token = createPushResponseToken(claims, now)
    expect(verifyPushResponseToken(token, now)).toEqual({ ...claims, expiresAt: now + PUSH_RESPONSE_TOKEN_TTL_MS })
  })

  it('refuses expired, tampered or malformed tokens', () => {
    const now = 1_700_000_000_000
    const token = createPushResponseToken(claims, now)
    expect(verifyPushResponseToken(token, now + PUSH_RESPONSE_TOKEN_TTL_MS + 1)).toBeNull()

    const [encoded, signature] = token.split('.')
    const forged = Buffer.from(JSON.stringify([7, 43, 3, claims.occurrenceDate, now + 1000])).toString('base64url')
    expect(verifyPushResponseToken(`${forged}.${signature}`, now)).toBeNull()
    expect(verifyPushResponseToken(`${encoded}.${signature!.replace(/^./, c => (c === 'a' ? 'b' : 'a'))}`, now)).toBeNull()
    for (const bad of [undefined, null, 42, '', 'abc', `${encoded}`, `${encoded}.${signature}.x`]) {
      expect(verifyPushResponseToken(bad, now)).toBeNull()
    }
  })
})

describe('which notifications get answer buttons', () => {
  const base = { appointment_id: 3, occurrence_date: '2026-12-01 18:00:00' }

  it('offers them for reminders, including rows queued before the field existed', () => {
    expect(pushResponseTarget('appointment.reminder', base)).toEqual({ appointmentId: 3, occurrenceDate: '2026-12-01 18:00:00' })
  })

  it('offers them for invitations and changes of a single date only', () => {
    expect(pushResponseTarget('appointment.invited', { ...base, response_occurrence_date: '2026-12-01 18:00:00' })).not.toBeNull()
    expect(pushResponseTarget('appointment.changed', { ...base, response_occurrence_date: '2026-12-01 18:00' }))
      .toEqual({ appointmentId: 3, occurrenceDate: '2026-12-01 18:00:00' })
    // A whole series: no single date to answer.
    expect(pushResponseTarget('appointment.invited', { ...base, response_occurrence_date: null })).toBeNull()
    expect(pushResponseTarget('appointment.changed', base)).toBeNull()
  })

  it('never offers them for cancellations or other types', () => {
    expect(pushResponseTarget('appointment.cancelled', { ...base, response_occurrence_date: base.occurrence_date })).toBeNull()
    expect(pushResponseTarget('shift.reminder' as any, { ...base, response_occurrence_date: base.occurrence_date })).toBeNull()
  })
})
