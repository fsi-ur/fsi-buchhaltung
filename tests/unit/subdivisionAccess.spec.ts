import { describe, expect, it } from 'vitest'
import { expandSubdivisionPermissions, SUBDIVISION_PERMISSIONS } from '~/config/subdivisionPermissions'
import { PERMISSIONS } from '~/config/permissions'
import {
  canOpenLeadershipPage,
  resolveSubdivisionAccess,
  subdivisionPermissionsBeyond,
} from '~/shared/subdivisionAccess'

describe('subdivision permission coverage', () => {
  it('names only existing global permissions for every scoped key', () => {
    const globalKeys = new Set(PERMISSIONS.map(permission => permission.key))
    for (const definition of SUBDIVISION_PERMISSIONS) {
      expect(definition.coveredBy.length, `${definition.key} declares no coverage`).toBeGreaterThan(0)
      for (const key of definition.coveredBy) expect(globalKeys.has(key), `${definition.key} → ${key}`).toBe(true)
    }
  })

  it('counts a scoped key as covered only when every covering permission is held', () => {
    expect(subdivisionPermissionsBeyond(['subdivision.members.manage'], ['settings.subdivisions.manage', 'members.view', 'subdivisions.view'])).toEqual([])
    expect(subdivisionPermissionsBeyond(['subdivision.history.view'], ['audit.view'])).toEqual(['subdivision.history.view'])
    expect(subdivisionPermissionsBeyond(['subdivision.history.view'], ['audit.view', 'subdivisions.view'])).toEqual([])
  })

  it('reports exactly the uncovered keys', () => {
    expect(subdivisionPermissionsBeyond(
      ['subdivision.members.manage', 'subdivision.positions.assign'],
      ['positions.assign'],
    )).toEqual(['subdivision.members.manage', 'subdivision.members.view'])
  })

  it('requires coverage for implied keys too', () => {
    // members.manage includes members.view, which needs members.view + subdivisions.view.
    expect(subdivisionPermissionsBeyond(['subdivision.members.manage'], ['settings.subdivisions.manage', 'subdivisions.view']))
      .toEqual(['subdivision.members.view'])
    expect(subdivisionPermissionsBeyond(['subdivision.members.manage'], ['settings.subdivisions.manage', 'subdivisions.view', 'members.view']))
      .toEqual([])
  })

  it('needs no coverage for keys already held in the subdivision', () => {
    expect(subdivisionPermissionsBeyond(['subdivision.members.view'], [], ['subdivision.members.view'])).toEqual([])
  })

  it('treats subdivisions.leadership.edit as covering everything', () => {
    expect(subdivisionPermissionsBeyond(SUBDIVISION_PERMISSIONS.map(entry => entry.key), ['subdivisions.leadership.edit'])).toEqual([])
  })
})

describe('subdivision permission implications', () => {
  it('lets managing members and assigning positions include viewing the members', () => {
    expect(expandSubdivisionPermissions(['subdivision.members.manage']).sort()).toEqual(['subdivision.members.manage', 'subdivision.members.view'])
    expect(expandSubdivisionPermissions(['subdivision.positions.assign'])).toContain('subdivision.members.view')
    expect(expandSubdivisionPermissions(['subdivision.history.view'])).toEqual(['subdivision.history.view'])
  })
})

describe('subdivision access', () => {
  it('grants scoped keys only in their own subdivision', () => {
    const scoped = { 3: ['subdivision.members.manage' as const] }
    expect(resolveSubdivisionAccess([], scoped, 3)).toEqual({ canView: true, permissions: ['subdivision.members.manage', 'subdivision.members.view'] })
    expect(resolveSubdivisionAccess([], scoped, 4)).toEqual({ canView: false, permissions: [] })
  })

  it('never derives scoped keys from other global permissions', () => {
    expect(resolveSubdivisionAccess(['settings.subdivisions.manage', 'events.edit'], {}, 1).permissions).toEqual([])
    expect(canOpenLeadershipPage(['settings.subdivisions.manage'], {})).toBe(false)
  })

  it('lets leadership.view see every subdivision without any scoped key', () => {
    expect(resolveSubdivisionAccess(['subdivisions.leadership.view'], {}, 9)).toEqual({ canView: true, permissions: [] })
    expect(canOpenLeadershipPage(['subdivisions.leadership.view'], {})).toBe(true)
  })
})
