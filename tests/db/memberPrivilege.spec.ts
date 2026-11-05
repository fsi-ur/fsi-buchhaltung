import { beforeEach, describe, expect, it } from 'vitest'
import { query } from '~/server/utils/db'
import updateMember from '~/server/api/members/[id].put'
import createMemberHandler from '~/server/api/members/create.post'
import savePosition from '~/server/api/positions/save.post'
import { getEffectivePermissions } from '~/server/utils/permissions'
import { POSITION_ASSIGN_EXCEEDS_OWN, POSITION_ASSIGN_FORBIDDEN } from '~/server/utils/positions'
import { ACCOUNT_ALREADY_LINKED, ACCOUNT_LINK_FORBIDDEN } from '~/server/utils/userAccounts'
import { resetDatabase } from '../helpers/db'
import { assignPosition, createMember, createPosition, createUser, resetFixtureCounter } from '../helpers/fixtures'
import { signIn } from '../helpers/auth'
import { callHandler } from '../helpers/handler'

async function memberBody(memberId: number, overrides: Record<string, unknown> = {}) {
  const [member] = await query<any[]>(
    `SELECT m.*, s.name AS subject_name FROM members m JOIN subjects s ON s.id = m.subject WHERE m.id = ?`,
    [memberId],
  )
  const positions = await query<any[]>(
    'SELECT id, member_id, position_id, since, until FROM member_positions WHERE member_id = ?',
    [memberId],
  )
  return {
    account: member.account,
    first_name: member.first_name,
    last_name: member.last_name,
    birthdate: member.birthdate,
    street: member.street,
    street_number: member.street_number,
    postal_code: member.postal_code,
    city: member.city,
    subject_name: member.subject_name,
    phone: member.phone,
    email: member.email,
    notes: member.notes,
    status: member.status,
    honorary: false,
    applied_at: member.applied_at,
    joined_at: member.joined_at,
    left_at: member.left_at,
    positions,
    ...overrides,
  }
}

// SEC-01: position assignments and account links grant permissions.
describe('member privilege escalation guards', () => {
  beforeEach(async () => {
    await resetDatabase()
    resetFixtureCounter()
  })

  it('a members.edit-only user cannot give themselves a privileged position', async () => {
    const editor = await signIn({ permissions: ['members.edit'] })
    const ownMember = await createMember({ accountId: editor.id })
    const adminPosition = await createPosition({ permissions: ['permissions.manage'] })

    const body = await memberBody(ownMember, {
      positions: [{ member_id: ownMember, position_id: adminPosition, since: '2024-01-01', until: null }],
    })
    const { result } = await callHandler(updateMember, { token: editor.token, method: 'PUT', params: { id: ownMember }, body })

    expect(result).toEqual({ ok: false, error: POSITION_ASSIGN_FORBIDDEN })
    expect(await query<any[]>('SELECT id FROM member_positions WHERE member_id = ?', [ownMember])).toHaveLength(0)
    expect(await getEffectivePermissions(editor.id)).not.toContain('permissions.manage')
  })

  it('a members.edit-only user can still edit other fields of a member holding positions', async () => {
    const editor = await signIn({ permissions: ['members.edit'] })
    const member = await createMember()
    const position = await createPosition({ permissions: ['receipts.view'] })
    await assignPosition(member, position)

    const body = await memberBody(member, { city: 'Neustadt' })
    const { result } = await callHandler(updateMember, { token: editor.token, method: 'PUT', params: { id: member }, body })

    expect(result).toMatchObject({ ok: true })
    const [after] = await query<any[]>('SELECT city FROM members WHERE id = ?', [member])
    expect(after.city).toBe('Neustadt')
    expect(await query<any[]>('SELECT id FROM member_positions WHERE member_id = ?', [member])).toHaveLength(1)
  })

  it('positions.assign may hand out positions within the caller\'s own rights only', async () => {
    const assigner = await signIn({ permissions: ['members.edit', 'positions.assign', 'receipts.view'] })
    const member = await createMember()
    const harmless = await createPosition({ permissions: ['receipts.view'] })
    const privileged = await createPosition({ permissions: ['users.manage'] })

    const allowed = await callHandler(updateMember, {
      token: assigner.token,
      method: 'PUT',
      params: { id: member },
      body: await memberBody(member, { positions: [{ member_id: member, position_id: harmless, since: '2024-01-01', until: null }] }),
    })
    expect(allowed.result).toMatchObject({ ok: true })

    const refused = await callHandler(updateMember, {
      token: assigner.token,
      method: 'PUT',
      params: { id: member },
      body: await memberBody(member, {
        positions: [
          ...(await memberBody(member)).positions,
          { member_id: member, position_id: privileged, since: '2024-01-01', until: null },
        ],
      }),
    })
    expect(refused.result).toEqual({ ok: false, error: POSITION_ASSIGN_EXCEEDS_OWN })
  })

  it('permissions.manage alone does not allow assigning positions', async () => {
    const admin = await signIn({ permissions: ['members.edit', 'permissions.manage'] })
    const member = await createMember()
    const position = await createPosition({ permissions: ['receipts.view'] })

    const { result } = await callHandler(updateMember, {
      token: admin.token,
      method: 'PUT',
      params: { id: member },
      body: await memberBody(member, { positions: [{ member_id: member, position_id: position, since: '2024-01-01', until: null }] }),
    })
    expect(result).toEqual({ ok: false, error: POSITION_ASSIGN_FORBIDDEN })
  })

  it('settings.positions.manage cannot add members to a position without positions.assign', async () => {
    const manager = await signIn({ permissions: ['settings.positions.manage'] })
    const ownMember = await createMember({ accountId: manager.id })
    const position = await createPosition({ permissions: ['permissions.manage'] })

    const { result } = await callHandler(savePosition, {
      token: manager.token,
      body: {
        id: position,
        code: 'ADM',
        name: 'Admin',
        description: null,
        assignments: [{ member_id: ownMember, since: '2024-01-01', until: null }],
      },
    })

    expect(result).toEqual({ ok: false, error: POSITION_ASSIGN_FORBIDDEN })
    expect(await query<any[]>('SELECT id FROM member_positions WHERE position_id = ?', [position])).toHaveLength(0)
  })

  it('members.edit cannot change the account link, and omitting it keeps the link', async () => {
    const editor = await signIn({ permissions: ['members.edit'] })
    const treasurer = await createUser()
    const member = await createMember({ accountId: treasurer.id })

    const hijack = await callHandler(updateMember, {
      token: editor.token,
      method: 'PUT',
      params: { id: member },
      body: await memberBody(member, { account: editor.id }),
    })
    expect(hijack.result).toEqual({ ok: false, error: ACCOUNT_LINK_FORBIDDEN })

    const { account: _omit, ...withoutAccount } = await memberBody(member, { city: 'Altstadt' })
    const keep = await callHandler(updateMember, { token: editor.token, method: 'PUT', params: { id: member }, body: withoutAccount })
    expect(keep.result).toMatchObject({ ok: true })

    const [after] = await query<any[]>('SELECT account, city FROM members WHERE id = ?', [member])
    expect(Number(after.account)).toBe(treasurer.id)
    expect(after.city).toBe('Altstadt')
  })

  it('members.edit cannot create a member linked to an existing account', async () => {
    const editor = await signIn({ permissions: ['members.edit'] })
    const body = await memberBody(await createMember(), { account: editor.id, positions: [], email: 'neu@test.invalid' })

    const { result } = await callHandler(createMemberHandler, { token: editor.token, body })
    expect(result).toEqual({ ok: false, error: ACCOUNT_LINK_FORBIDDEN })
  })

  it('users.manage cannot link an account that is already linked to another member', async () => {
    const manager = await signIn({ permissions: ['members.edit', 'users.manage'] })
    const target = await createUser()
    await createMember({ accountId: target.id })
    const other = await createMember()

    const { result } = await callHandler(updateMember, {
      token: manager.token,
      method: 'PUT',
      params: { id: other },
      body: await memberBody(other, { account: target.id }),
    })
    expect(result).toEqual({ ok: false, error: ACCOUNT_ALREADY_LINKED })
  })
})
