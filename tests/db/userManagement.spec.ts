import { beforeEach, describe, expect, it } from 'vitest'
import { query } from '~/server/utils/db'
import adminSetPassword from '~/server/api/auth/admin-set-password.post'
import changeUsername from '~/server/api/auth/change-username.post'
import activateUser from '~/server/api/auth/activate.post'
import linkMember from '~/server/api/auth/link-member.post'
import { USER_EXCEEDS_OWN, ACCOUNT_LINK_EXCEEDS_OWN } from '~/server/utils/userAccounts'
import { resetDatabase } from '../helpers/db'
import { assignPosition, createMember, createPosition, createUser, resetFixtureCounter } from '../helpers/fixtures'
import { signIn } from '../helpers/auth'
import { callHandler } from '../helpers/handler'

// SEC-03: users.manage must not be a path to accounts with more rights than the caller.
describe('users.manage cannot take over higher-privileged accounts', () => {
  beforeEach(async () => {
    await resetDatabase()
    resetFixtureCounter()
  })

  it('cannot reset an admin password, but can reset a plain user', async () => {
    const secretary = await signIn({ permissions: ['users.manage'] })
    const admin = await createUser({ permissions: ['permissions.manage'] })
    const plain = await createUser()

    const refused = await callHandler(adminSetPassword, {
      token: secretary.token,
      body: { user_id: admin.id, newPassword: 'NeuesPasswort1', confirmPassword: 'NeuesPasswort1' },
    })
    expect(refused.result).toEqual({ ok: false, error: USER_EXCEEDS_OWN })

    const allowed = await callHandler(adminSetPassword, {
      token: secretary.token,
      body: { user_id: plain.id, newPassword: 'NeuesPasswort1', confirmPassword: 'NeuesPasswort1' },
    })
    expect(allowed.result).toEqual({ ok: true })
  })

  it('cannot rename or deactivate an account with more rights', async () => {
    const secretary = await signIn({ permissions: ['users.manage'] })
    const treasurer = await createUser({ permissions: ['receipts.edit'] })

    const rename = await callHandler(changeUsername, { token: secretary.token, body: { user_id: treasurer.id, username: 'x' } })
    expect(rename.result).toEqual({ ok: false, error: USER_EXCEEDS_OWN })

    const deactivate = await callHandler(activateUser, { token: secretary.token, body: { id: treasurer.id, is_active: false } })
    expect(deactivate.result).toEqual({ ok: false, error: USER_EXCEEDS_OWN })
    const [row] = await query<any[]>('SELECT is_active FROM users WHERE id = ?', [treasurer.id])
    expect(Number(row.is_active)).toBe(1)
  })

  it('cannot link itself to a member whose positions carry more rights', async () => {
    const secretary = await signIn({ permissions: ['users.manage'] })
    const chair = await createMember()
    await assignPosition(chair, await createPosition({ permissions: ['permissions.manage'] }))

    const { result } = await callHandler(linkMember, { token: secretary.token, body: { user_id: secretary.id, member_id: chair } })
    expect(result).toEqual({ ok: false, error: ACCOUNT_LINK_EXCEEDS_OWN })
  })
})
