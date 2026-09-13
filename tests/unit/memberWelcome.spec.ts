import { describe, expect, it } from 'vitest'
import { welcomeSendTime, welcomeTypeForStatus } from '~/server/utils/memberWelcome'
import { normalizeMemberWelcome } from '~/server/utils/notifications/settings'
import { validateAssociationDocument } from '~/server/utils/associationDocuments'
import { MemberStatus } from '~/types/member'

describe('welcomeTypeForStatus', () => {
  it('maps the two joining statuses to their own template', () => {
    expect(welcomeTypeForStatus(MemberStatus.Active)).toBe('member.welcome_active')
    expect(welcomeTypeForStatus(MemberStatus.Passive)).toBe('member.welcome_passive')
  })

  it('has no greeting for statuses that are not a start of membership', () => {
    expect(welcomeTypeForStatus(MemberStatus.Hold)).toBeNull()
    expect(welcomeTypeForStatus(MemberStatus.Left)).toBeNull()
    expect(welcomeTypeForStatus('nonsense')).toBeNull()
  })
})

describe('welcomeSendTime', () => {
  it('sends on the joining day itself with no delay', () => {
    expect(welcomeSendTime('2026-03-05', 0, '09:00')).toBe('2026-03-05 09:00:00')
  })

  it('adds the delay in whole days', () => {
    expect(welcomeSendTime('2026-03-05', 7, '18:30')).toBe('2026-03-12 18:30:00')
  })

  it('rolls over month and year boundaries', () => {
    expect(welcomeSendTime('2026-12-28', 5, '09:00')).toBe('2027-01-02 09:00:00')
  })

  it('ignores a time part on the joining date', () => {
    expect(welcomeSendTime('2026-03-05 13:45:00', 1, '09:00')).toBe('2026-03-06 09:00:00')
  })

  it('accepts a send time that already carries seconds', () => {
    expect(welcomeSendTime('2026-03-05', 0, '09:00:30')).toBe('2026-03-05 09:00:30')
  })

  it('falls back to now when the joining date is unusable', () => {
    expect(welcomeSendTime('', 3, '09:00')).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/)
  })
})

describe('normalizeMemberWelcome', () => {
  it('defaults to the joining day at 09:00', () => {
    const result = normalizeMemberWelcome(undefined)
    expect(result).toEqual({ ok: true, value: { delay_days: 0, send_time: '09:00' } })
  })

  it('accepts a delay within a year', () => {
    expect(normalizeMemberWelcome({ delay_days: 14, send_time: '07:30' }))
      .toEqual({ ok: true, value: { delay_days: 14, send_time: '07:30' } })
  })

  it.each([-1, 366, 1.5, Number.NaN])('rejects the delay %s', (delayDays) => {
    expect(normalizeMemberWelcome({ delay_days: delayDays, send_time: '09:00' }).ok).toBe(false)
  })

  it.each(['9:00', '25:00', '09:70', 'morgens'])('rejects the time %s', (sendTime) => {
    expect(normalizeMemberWelcome({ delay_days: 0, send_time: sendTime }).ok).toBe(false)
  })
})

describe('validateAssociationDocument', () => {
  it('accepts a document with just a title', () => {
    expect(validateAssociationDocument({ title: 'Satzung' })).toBeNull()
  })

  it('requires a title', () => {
    expect(validateAssociationDocument({ title: '   ' })).toBe('Bitte einen Titel angeben.')
  })

  it('rejects an over-long title or description', () => {
    expect(validateAssociationDocument({ title: 'x'.repeat(192) })).toContain('191')
    expect(validateAssociationDocument({ title: 'Satzung', description: 'x'.repeat(501) })).toContain('500')
  })
})
