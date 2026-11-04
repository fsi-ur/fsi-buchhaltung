import { beforeEach, describe, expect, it } from 'vitest'
import { getUserPermissions, getUserPositionIds, getUserRoleIds } from '~/server/utils/permissions'
import { query } from '~/server/utils/db'
import { resetDatabase } from '../helpers/db'
import {
  assignPosition,
  assignRole,
  createMember,
  createPosition,
  createRole,
  createUser,
  grantUserPermissions,
  resetFixtureCounter,
} from '../helpers/fixtures'

describe('permission resolution', () => {
  beforeEach(async () => {
    await resetDatabase()
    resetFixtureCounter()
  })

  async function permissionsOf(userId: number) {
    const roles = await getUserRoleIds(userId)
    const positions = await getUserPositionIds(userId)
    return getUserPermissions(userId, roles, positions)
  }

  it('grants nothing to a user with no roles, positions or grants', async () => {
    const user = await createUser()
    expect(await permissionsOf(user.id)).toEqual([])
  })

  it('grants a role permission', async () => {
    const user = await createUser()
    const role = await createRole({ permissions: ['members.view'] })
    await assignRole(user.id, role)

    expect(await permissionsOf(user.id)).toContain('members.view')
  })

  it('ignores an inactive role', async () => {
    const user = await createUser()
    const role = await createRole({ permissions: ['members.view'], isActive: false })
    await assignRole(user.id, role)

    expect(await getUserRoleIds(user.id)).toEqual([])
    expect(await permissionsOf(user.id)).toEqual([])
  })

  it('grants a permission through an active position held by the linked member', async () => {
    const user = await createUser()
    const position = await createPosition({ permissions: ['receipts.view'] })
    const member = await createMember({ accountId: user.id })
    await assignPosition(member, position)

    expect(await permissionsOf(user.id)).toContain('receipts.view')
  })

  it('ignores a position whose term has ended', async () => {
    const user = await createUser()
    const position = await createPosition({ permissions: ['receipts.view'] })
    const member = await createMember({ accountId: user.id })
    await assignPosition(member, position, { since: '2020-01-01', until: '2020-12-31' })

    expect(await getUserPositionIds(user.id)).toEqual([])
    expect(await permissionsOf(user.id)).toEqual([])
  })

  it('ignores a position whose term has not started yet', async () => {
    const user = await createUser()
    const position = await createPosition({ permissions: ['receipts.view'] })
    const member = await createMember({ accountId: user.id })
    await assignPosition(member, position, { since: '2999-01-01' })

    expect(await getUserPositionIds(user.id)).toEqual([])
  })

  it('ignores a deactivated position', async () => {
    const user = await createUser()
    const position = await createPosition({ permissions: ['receipts.view'], isActive: false })
    const member = await createMember({ accountId: user.id })
    await assignPosition(member, position)

    expect(await permissionsOf(user.id)).toEqual([])
  })

  it('grants a direct user permission', async () => {
    const user = await createUser({ permissions: ['invoices.view'] })
    expect(await permissionsOf(user.id)).toContain('invoices.view')
  })

  it('unions all three sources without duplicates', async () => {
    const user = await createUser({ permissions: ['invoices.view'] })
    const role = await createRole({ permissions: ['members.view', 'invoices.view'] })
    await assignRole(user.id, role)
    const position = await createPosition({ permissions: ['receipts.view'] })
    const member = await createMember({ accountId: user.id })
    await assignPosition(member, position)

    const permissions = await permissionsOf(user.id)

    expect(new Set(permissions).size).toBe(permissions.length)
    expect(permissions).toEqual(expect.arrayContaining(['invoices.view', 'members.view', 'receipts.view']))
  })

  // `implied` is expanded to a fixpoint, so a chain must resolve fully in one pass:
  // wiki.manage -> wiki.review -> wiki.edit -> wiki.view.
  it('expands the implied closure transitively', async () => {
    const user = await createUser({ permissions: ['wiki.manage'] })
    const permissions = await permissionsOf(user.id)

    expect(permissions).toEqual(expect.arrayContaining(['wiki.manage', 'wiki.review', 'wiki.edit', 'wiki.view']))
  })

  // Viewing a record must include the lookups needed to label it (e.g. an auditor reading receipts).
  it('grants the lookup permissions a record view needs to show labels', async () => {
    const auditor = await createUser({ permissions: ['receipts.view', 'invoices.view', 'cash_counts.view'] })
    const memberViewer = await createUser({ permissions: ['members.view'] })

    expect(await permissionsOf(auditor.id)).toEqual(expect.arrayContaining(['companies.view', 'spheres.view', 'cost_centres.view']))
    expect(await permissionsOf(memberViewer.id)).toEqual(expect.arrayContaining(['positions.view']))
  })

  it('drops a permission key that is no longer valid', async () => {
    const user = await createUser()
    // A key left behind by a rename must not leak through as an unknown capability.
    await query('INSERT INTO user_permissions (user_id, permission_key) VALUES (?, ?)', [user.id, 'legacy.key'])
    await grantUserPermissions(user.id, ['files.view'])

    expect(await permissionsOf(user.id)).toEqual(['files.view'])
  })

  it('keeps users isolated from one another', async () => {
    const first = await createUser({ permissions: ['files.view'] })
    const second = await createUser({ permissions: ['audit.view'] })

    expect(await permissionsOf(first.id)).toEqual(['files.view'])
    expect(await permissionsOf(second.id)).toEqual(['audit.view'])
  })
})
