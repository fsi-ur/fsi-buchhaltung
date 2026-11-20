import { beforeEach, describe, expect, it } from 'vitest'
import { query } from '~/server/utils/db'
import { inactivityMinutes, touchUserLastActive } from '~/server/utils/auth'
import { listUsersWithActivity } from '~/server/utils/userAccounts'
import { instantToSql } from '~/shared/time'
import { auditRowsFor, resetDatabase } from '../helpers/db'
import { createUser, resetFixtureCounter } from '../helpers/fixtures'

async function lastActiveOf(userId: number): Promise<string | null> {
  const rows = await query<Array<{ last_active_at: string | null }>>('SELECT last_active_at FROM users WHERE id = ?', [userId])
  return rows[0]?.last_active_at ?? null
}

describe('users.last_active_at', () => {
  let userId: number

  beforeEach(async () => {
    await resetDatabase()
    resetFixtureCounter()
    userId = (await createUser()).id
  })

  it('is set on the first touch and throttled afterwards', async () => {
    const start = new Date('2026-11-20T10:00:00Z')

    await touchUserLastActive(userId, start)
    expect(await lastActiveOf(userId)).toBe('2026-11-20T10:00:00Z')

    // Within the throttle window: unchanged.
    await touchUserLastActive(userId, new Date('2026-11-20T10:03:00Z'))
    expect(await lastActiveOf(userId)).toBe('2026-11-20T10:00:00Z')

    // After it: moves forward.
    await touchUserLastActive(userId, new Date('2026-11-20T10:06:00Z'))
    expect(await lastActiveOf(userId)).toBe('2026-11-20T10:06:00Z')
  })

  it('writes no audit row', async () => {
    const before = (await auditRowsFor('users', userId)).length

    await touchUserLastActive(userId, new Date('2026-11-20T10:00:00Z'))
    await touchUserLastActive(userId, new Date('2026-11-20T11:00:00Z'))

    expect((await auditRowsFor('users', userId)).length).toBe(before)
  })
})

describe('online state in the user list', () => {
  const now = new Date('2026-11-20T12:00:00Z')
  const minutesAgo = (minutes: number) => instantToSql(new Date(now.getTime() - minutes * 60 * 1000))
  const minutesAhead = (minutes: number) => instantToSql(new Date(now.getTime() + minutes * 60 * 1000))
  let tokenCounter = 0

  async function addSession(userId: number, lastActiveAt: string, expiresAt: string | null) {
    tokenCounter += 1
    await query(
      'INSERT INTO sessions (user_id, token_hash, created_at, last_active_at, expires_at) VALUES (?, ?, ?, ?, ?)',
      [userId, String(tokenCounter).padStart(64, '0'), lastActiveAt, lastActiveAt, expiresAt],
    )
  }

  async function onlineOf(userId: number) {
    const users = await listUsersWithActivity(now)
    return users.find(user => user.id === userId)?.is_online
  }

  beforeEach(async () => {
    await resetDatabase()
    resetFixtureCounter()
  })

  it('counts a session that is neither expired nor idle', async () => {
    const user = await createUser()
    await addSession(user.id, minutesAgo(1), minutesAhead(60))
    expect(await onlineOf(user.id)).toBe(1)
  })

  it('ignores idle, expired and missing sessions', async () => {
    const idle = await createUser()
    await addSession(idle.id, minutesAgo(inactivityMinutes + 1), minutesAhead(60))
    const expired = await createUser()
    await addSession(expired.id, minutesAgo(1), minutesAgo(0.5))
    const none = await createUser()

    expect(await onlineOf(idle.id)).toBe(0)
    expect(await onlineOf(expired.id)).toBe(0)
    expect(await onlineOf(none.id)).toBe(0)
  })

  it('never shows a deactivated user as online, even with a leftover session', async () => {
    const user = await createUser({ isActive: false })
    await addSession(user.id, minutesAgo(1), null)
    expect(await onlineOf(user.id)).toBe(0)
  })
})
