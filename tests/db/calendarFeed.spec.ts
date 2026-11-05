import { beforeEach, describe, expect, it } from 'vitest'
import feed from '~/server/api/calendar/[token].get'
import createFeedToken from '~/server/api/user/calendar-feed.post'
import revokeFeedToken from '~/server/api/user/calendar-feed.delete'
import { generateCalendarToken, hasCalendarToken } from '~/server/utils/calendarToken'
import { resetDatabase } from '../helpers/db'
import { createEvent, createUser, resetFixtureCounter } from '../helpers/fixtures'
import { signIn } from '../helpers/auth'
import { callHandler } from '../helpers/handler'
import type { PermissionKey } from '~/config/permissions'

async function feedFor(permissions: PermissionKey[]) {
  const user = await createUser({ permissions })
  const token = await generateCalendarToken(user.id)
  const { result } = await callHandler<string>(feed, { params: { token: `${token}.ics` } })
  return String(result)
}

// SEC-17
describe('ICS calendar feed follows calendar permissions', () => {
  beforeEach(async () => {
    await resetDatabase()
    resetFixtureCounter()
    await createEvent({ name: 'Geheimes Vorstandstreffen', startsAt: '2030-06-01 18:00:00', endsAt: '2030-06-01 20:00:00' })
  })

  it('shows events with calendar.view and event access', async () => {
    expect(await feedFor(['calendar.view', 'events.view'])).toContain('Geheimes Vorstandstreffen')
  })

  it('hides events without event access', async () => {
    expect(await feedFor(['calendar.view'])).not.toContain('Geheimes Vorstandstreffen')
  })

  it('is empty without calendar.view', async () => {
    const ics = await feedFor(['events.view'])
    expect(ics).toContain('BEGIN:VCALENDAR')
    expect(ics).not.toContain('Geheimes Vorstandstreffen')
  })

  it('minting a feed token needs calendar.view; revoking always works', async () => {
    const without = await signIn({ permissions: [] })
    expect((await callHandler(createFeedToken, { token: without.token, method: 'POST' })).result.ok).toBe(false)

    const withPermission = await signIn({ permissions: ['calendar.view'] })
    expect((await callHandler(createFeedToken, { token: withPermission.token, method: 'POST' })).result.ok).toBe(true)
    expect(await hasCalendarToken(withPermission.id)).toBe(true)

    expect((await callHandler(revokeFeedToken, { token: withPermission.token, method: 'DELETE' })).result).toEqual({ ok: true })
    expect(await hasCalendarToken(withPermission.id)).toBe(false)
  })
})
