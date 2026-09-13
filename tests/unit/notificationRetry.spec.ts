import { describe, expect, it } from 'vitest'
import { reminderMomentHasPassed } from '~/server/utils/notifications/time'

const NOW = '2026-03-14 12:00:00'

describe('reminderMomentHasPassed', () => {
  it('stops retrying a reminder for a shift that has already started', () => {
    expect(reminderMomentHasPassed('shift.reminder', { shift_start: '2026-03-14 09:00:00' }, NOW)).toBe(true)
  })

  it('keeps retrying while the shift is still ahead', () => {
    expect(reminderMomentHasPassed('shift.reminder', { shift_start: '2026-03-14 18:00:00' }, NOW)).toBe(false)
  })

  it.each([
    ['event.reminder', 'event_start'],
    ['appointment.reminder', 'appointment_start'],
    ['task.deadline_reminder', 'task_deadline'],
  ] as const)('reads the anchor %s carries', (typeKey, variable) => {
    expect(reminderMomentHasPassed(typeKey, { [variable]: '2026-03-13 08:00:00' }, NOW)).toBe(true)
    expect(reminderMomentHasPassed(typeKey, { [variable]: '2026-03-15 08:00:00' }, NOW)).toBe(false)
  })

  it('accepts the ISO spelling of the same wall clock', () => {
    expect(reminderMomentHasPassed('shift.reminder', { shift_start: '2026-03-14T09:00:00.000Z' }, NOW)).toBe(true)
  })

  it('never suppresses a type that reminds of nothing', () => {
    expect(reminderMomentHasPassed('shift.assigned', { shift_start: '2020-01-01 09:00:00' }, NOW)).toBe(false)
    expect(reminderMomentHasPassed('custom.message', {}, NOW)).toBe(false)
    expect(reminderMomentHasPassed('member.welcome_active', {}, NOW)).toBe(false)
  })

  it.each([null, {}, { shift_start: null }, { shift_start: 'irgendwann' }])(
    'delivers late rather than swallowing a payload it cannot read (%j)',
    (payload) => {
      expect(reminderMomentHasPassed('shift.reminder', payload, NOW)).toBe(false)
    },
  )
})
