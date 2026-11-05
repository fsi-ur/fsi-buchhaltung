import { beforeEach, describe, expect, it } from 'vitest'
import { query } from '~/server/utils/db'
import updateMember from '~/server/api/members/[id].put'
import activateUser from '~/server/api/auth/activate.post'
import logoutAll from '~/server/api/auth/logout-all.post'
import changePassword from '~/server/api/auth/change-password.post'
import updateUserAccess from '~/server/api/permissions/users.update.post'
import { runMemberLeaveDispatch } from '~/server/utils/memberLeaveDispatch'
import { LAST_ADMIN_ERROR } from '~/server/utils/permissions'
import { resetDatabase } from '../helpers/db'
import { createMember, createUser, resetFixtureCounter } from '../helpers/fixtures'
import { signIn } from '../helpers/auth'
import { callHandler } from '../helpers/handler'

async function memberBody(memberId: number, overrides: Record<string, unknown> = {}) {
  const [member] = await query<any[]>(
    `SELECT m.*, s.name AS subject_name FROM members m JOIN subjects s ON s.id = m.subject WHERE m.id = ?`,
    [memberId],
  )
  const { id: _id, subject: _subject, account_deactivation_skipped: _flag, ...rest } = member
  return { ...rest, honorary: false, positions: [], ...overrides }
}

async function isActive(userId: number) {
  const [row] = await query<any[]>('SELECT is_active FROM users WHERE id = ?', [userId])
  return Number(row.is_active) === 1
}

async function addPushSubscription(userId: number) {
  await query(
    `INSERT INTO notification_push_subscriptions (user_id, endpoint, p256dh, auth, created_at)
     VALUES (?, ?, 'p', 'a', '2026-01-01 00:00:00')`,
    [userId, `https://fcm.googleapis.com/fcm/send/${userId}-${Math.random()}`],
  )
}

async function pushCount(userId: number) {
  const [row] = await query<any[]>('SELECT COUNT(*) AS c FROM notification_push_subscriptions WHERE user_id = ?', [userId])
  return Number(row.c)
}

describe('member "left" deactivation is gated (SEC-19)', () => {
  beforeEach(async () => {
    await resetDatabase()
    resetFixtureCounter()
  })

  it('members.edit alone cannot deactivate the admin by marking them as left', async () => {
    const editor = await signIn({ permissions: ['members.edit'] })
    const admin = await createUser({ permissions: ['permissions.manage'] })
    const member = await createMember({ accountId: admin.id })

    const { result } = await callHandler(updateMember, {
      token: editor.token,
      method: 'PUT',
      params: { id: member },
      body: await memberBody(member, { status: 'left', left_at: '2026-01-01' }),
    })

    expect(result.ok).toBe(true)
    expect(result.status_actions.account_deactivated).toBeNull()
    expect(result.status_actions.account_deactivation_skipped).toMatchObject({ id: admin.id })
    expect(await isActive(admin.id)).toBe(true)
  })

  it('a future left date does not deactivate the account later either', async () => {
    const editor = await signIn({ permissions: ['members.edit'] })
    const admin = await createUser({ permissions: ['permissions.manage'] })
    const member = await createMember({ accountId: admin.id })

    await callHandler(updateMember, {
      token: editor.token,
      method: 'PUT',
      params: { id: member },
      body: await memberBody(member, { status: 'left', left_at: '2099-01-01' }),
    })
    await query(`UPDATE members SET left_at = '2020-01-01' WHERE id = ?`, [member]) // the day has come
    await runMemberLeaveDispatch()

    expect(await isActive(admin.id)).toBe(true)
  })

  it('users.manage can deactivate a plain member account, which drops its push subscriptions', async () => {
    const manager = await signIn({ permissions: ['members.edit', 'users.manage'] })
    const plain = await createUser()
    await addPushSubscription(plain.id)
    const member = await createMember({ accountId: plain.id })

    const { result } = await callHandler(updateMember, {
      token: manager.token,
      method: 'PUT',
      params: { id: member },
      body: await memberBody(member, { status: 'left', left_at: '2026-01-01' }),
    })

    expect(result.status_actions.account_deactivated).toMatchObject({ id: plain.id })
    expect(await isActive(plain.id)).toBe(false)
    expect(await pushCount(plain.id)).toBe(0)
  })
})

describe('push subscriptions survive everything but deactivation (SEC-20)', () => {
  beforeEach(async () => {
    await resetDatabase()
    resetFixtureCounter()
  })

  it('deactivation via user management removes them', async () => {
    const manager = await signIn({ permissions: ['users.manage'] })
    const plain = await createUser()
    await addPushSubscription(plain.id)

    const { result } = await callHandler(activateUser, { token: manager.token, body: { id: plain.id, is_active: false } })
    expect(result).toEqual({ ok: true })
    expect(await pushCount(plain.id)).toBe(0)
  })

  it('logout-all and a password change keep them', async () => {
    const user = await signIn({ permissions: [], username: 'pushy' })
    await addPushSubscription(user.id)

    await callHandler(changePassword, {
      token: user.token,
      body: { currentPassword: user.password, newPassword: 'EinNeuesPasswort1', confirmPassword: 'EinNeuesPasswort1' },
    })
    await callHandler(logoutAll, { token: user.token, method: 'POST', body: {} })

    expect(await pushCount(user.id)).toBe(1)
  })
})

describe('last-admin guard (SEC-24)', () => {
  beforeEach(async () => {
    await resetDatabase()
    resetFixtureCounter()
  })

  it('the only admin cannot remove their own permissions.manage', async () => {
    const admin = await signIn({ permissions: ['permissions.manage'] })

    const { result } = await callHandler(updateUserAccess, {
      token: admin.token,
      body: { user_id: admin.id, roles: [], permissions: [] },
    })

    expect(result).toEqual({ ok: false, error: LAST_ADMIN_ERROR })
    const grants = await query<any[]>('SELECT permission_key FROM user_permissions WHERE user_id = ?', [admin.id])
    expect(grants.map(row => row.permission_key)).toContain('permissions.manage')
  })

  it('works when another admin remains', async () => {
    const admin = await signIn({ permissions: ['permissions.manage'] })
    await createUser({ permissions: ['permissions.manage'] })

    const { result } = await callHandler(updateUserAccess, {
      token: admin.token,
      body: { user_id: admin.id, roles: [], permissions: [] },
    })
    expect(result).toEqual({ ok: true })
  })

  it('users.manage cannot deactivate themselves', async () => {
    const manager = await signIn({ permissions: ['users.manage'] })
    const { result } = await callHandler(activateUser, { token: manager.token, body: { id: manager.id, is_active: false } })
    expect(result.ok).toBe(false)
  })
})

describe('push subscription re-binding needs the keys (SEC-20)', () => {
  beforeEach(async () => {
    await resetDatabase()
    resetFixtureCounter()
  })

  it('moves an endpoint to another user only with matching keys', async () => {
    const { default: subscribe } = await import('~/server/api/notifications/push-subscribe.post')
    const owner = await signIn({ permissions: [] })
    const attacker = await signIn({ permissions: [] })
    const endpoint = 'https://fcm.googleapis.com/fcm/send/device-1'

    expect((await callHandler(subscribe, { token: owner.token, body: { endpoint, keys: { p256dh: 'pk', auth: 'secret' } } })).result).toEqual({ ok: true })

    const hijack = await callHandler(subscribe, { token: attacker.token, body: { endpoint, keys: { p256dh: 'x', auth: 'y' } } })
    expect(hijack.result.ok).toBe(false)
    expect(await pushCount(owner.id)).toBe(1)

    const sameDevice = await callHandler(subscribe, { token: attacker.token, body: { endpoint, keys: { p256dh: 'pk', auth: 'secret' } } })
    expect(sameDevice.result).toEqual({ ok: true })
    expect(await pushCount(attacker.id)).toBe(1)
  })

  it('refuses endpoints outside the push services', async () => {
    const { default: subscribe } = await import('~/server/api/notifications/push-subscribe.post')
    const user = await signIn({ permissions: [] })
    const { result } = await callHandler(subscribe, { token: user.token, body: { endpoint: 'https://10.0.0.5/x', keys: { p256dh: 'a', auth: 'b' } } })
    expect(result.ok).toBe(false)
  })
})
