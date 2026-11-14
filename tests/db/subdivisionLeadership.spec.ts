import { beforeEach, describe, expect, it } from 'vitest'
import { query } from '~/server/utils/db'
import { appTodayLocalDate } from '~/server/utils/time'
import { addDaysToLocalDate } from '~/shared/time'
import { getUserSubdivisionPermissions, LEADERSHIP_ERRORS, LEADERSHIP_SELF_FORBIDDEN } from '~/server/utils/subdivisionLeadership'
import { POSITION_ASSIGN_EXCEEDS_OWN } from '~/server/utils/positions'
import getLeadership from '~/server/api/subdivision-leadership/index.get'
import addMember from '~/server/api/subdivision-leadership/add-member.post'
import removeMember from '~/server/api/subdivision-leadership/remove-member.post'
import saveAssignment from '~/server/api/subdivision-leadership/save-assignment.post'
import endAssignment from '~/server/api/subdivision-leadership/end-assignment.post'
import leadershipHistory from '~/server/api/subdivision-leadership/history.get'
import savePosition from '~/server/api/positions/save.post'
import saveSubdivision from '~/server/api/subdivisions/save.post'
import { resetDatabase } from '../helpers/db'
import {
  addSubdivisionMember,
  assignPosition,
  createMember,
  createPosition,
  createSubdivision,
  resetFixtureCounter,
} from '../helpers/fixtures'
import { signIn, type SignedInUser } from '../helpers/auth'
import { callHandler } from '../helpers/handler'
import type { PermissionKey } from '~/config/permissions'

const LEAD_PERMISSIONS = ['subdivision.members.manage', 'subdivision.positions.assign', 'subdivision.history.view'] as const

interface LeaderSetup {
  leader: SignedInUser
  leaderMember: number
  subdivision: number
  leadPosition: number
}

/** A signed-in user holding the "Leitung" position in a fresh subdivision. */
async function setupLeader(permissions: PermissionKey[] = []): Promise<LeaderSetup> {
  const leader = await signIn({ permissions })
  const leaderMember = await createMember({ accountId: leader.id })
  const subdivision = await createSubdivision()
  const leadPosition = await createPosition({ subdivisionBound: true, subdivisionPermissions: [...LEAD_PERMISSIONS] })
  await addSubdivisionMember(subdivision, leaderMember)
  await assignPosition(leaderMember, leadPosition, { subdivisionId: subdivision })
  return { leader, leaderMember, subdivision, leadPosition }
}

async function enableNotifications(settings: Record<string, string> = {}) {
  const pairs: Array<[string, string]> = [['notifications_enabled', 'true'], ...Object.entries(settings)]
  await query(
    `INSERT INTO app_settings (setting_key, setting_value)
     VALUES ${pairs.map(() => '(?, ?)').join(', ')}
     ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value)`,
    pairs.flat(),
  )
}

async function notificationTypes() {
  const rows = await query<Array<{ type_key: string }>>('SELECT type_key FROM notifications ORDER BY id')
  return rows.map(row => row.type_key)
}

async function isMember(subdivisionId: number, memberId: number) {
  const rows = await query<any[]>('SELECT 1 FROM subdivision_members WHERE subdivision_id = ? AND member_id = ?', [subdivisionId, memberId])
  return rows.length > 0
}

describe('subdivision leadership', () => {
  beforeEach(async () => {
    await resetDatabase()
    resetFixtureCounter()
  })

  describe('scoped permissions', () => {
    it('come from current subdivision-bound positions and only for their subdivision', async () => {
      const { leader, subdivision } = await setupLeader()
      const other = await createSubdivision()

      const map = await getUserSubdivisionPermissions(leader.id)
      // members.manage and positions.assign include viewing the members.
      expect(map[subdivision]?.sort()).toEqual([...LEAD_PERMISSIONS, 'subdivision.members.view'].sort())
      expect(map[other]).toBeUndefined()
    })

    it('ignore ended assignments and inactive subdivisions', async () => {
      const leader = await signIn()
      const member = await createMember({ accountId: leader.id })
      const ended = await createSubdivision()
      const inactive = await createSubdivision({ isActive: false })
      const position = await createPosition({ subdivisionBound: true, subdivisionPermissions: ['subdivision.members.manage'] })
      await assignPosition(member, position, { subdivisionId: ended, until: '2024-06-30' })
      await assignPosition(member, position, { subdivisionId: inactive })

      expect(await getUserSubdivisionPermissions(leader.id)).toEqual({})
    })

    it('are never treated as global permissions', async () => {
      const { leader, subdivision } = await setupLeader()
      const member = await createMember()
      // The leader is no settings.subdivisions.manage holder anywhere else.
      const { result } = await callHandler(saveSubdivision, {
        token: leader.token,
        body: { id: subdivision, code: 'X', name: 'X', member_ids: [member] },
      })
      expect(result).toEqual({ ok: false, error: 'Not authorized' })
    })
  })

  describe('overview', () => {
    it('lists only the subdivisions a leader leads', async () => {
      const { leader, subdivision } = await setupLeader()
      await createSubdivision()

      const { result } = await callHandler(getLeadership, { token: leader.token })
      expect(result.ok).toBe(true)
      expect(result.subdivisions.map((entry: any) => entry.id)).toEqual([subdivision])
      expect(result.subdivisions[0].members[0].is_self).toBe(true)
    })

    it('lists every active subdivision with subdivisions.leadership.view, without granting edit rights', async () => {
      const viewer = await signIn({ permissions: ['subdivisions.leadership.view'] })
      const first = await createSubdivision()
      const second = await createSubdivision()
      await createSubdivision({ isActive: false })

      const { result } = await callHandler(getLeadership, { token: viewer.token })
      expect(result.subdivisions.map((entry: any) => entry.id).sort()).toEqual([first, second].sort())
      expect(result.subdivisions.every((entry: any) => entry.permissions.length === 0)).toBe(true)

      const member = await createMember()
      const add = await callHandler(addMember, { token: viewer.token, body: { subdivision_id: first, member_id: member } })
      expect(add.result).toEqual({ ok: false, error: 'Not authorized' })
    })

    it('is refused to users who lead nothing', async () => {
      const user = await signIn({ permissions: ['members.view', 'settings.subdivisions.manage'] })
      await createSubdivision()
      const { result } = await callHandler(getLeadership, { token: user.token })
      expect(result).toEqual({ ok: false, error: 'Not authorized' })
    })
  })

  describe('viewing members', () => {
    async function leaderWith(permissions: Array<'subdivision.members.view' | 'subdivision.history.view'>) {
      const leader = await signIn()
      const leaderMember = await createMember({ accountId: leader.id })
      const subdivision = await createSubdivision()
      const position = await createPosition({ subdivisionBound: true, subdivisionPermissions: permissions })
      await addSubdivisionMember(subdivision, leaderMember)
      await assignPosition(leaderMember, position, { subdivisionId: subdivision })
      return { leader, subdivision }
    }

    it('sends no member list without subdivision.members.view', async () => {
      const { leader } = await leaderWith(['subdivision.history.view'])
      const { result } = await callHandler(getLeadership, { token: leader.token })
      expect(result.subdivisions).toHaveLength(1)
      expect(result.subdivisions[0].members).toEqual([])
    })

    it('shows the members read-only with subdivision.members.view', async () => {
      const { leader, subdivision } = await leaderWith(['subdivision.members.view'])
      const { result } = await callHandler(getLeadership, { token: leader.token })
      expect(result.subdivisions[0].members).toHaveLength(1)

      const member = await createMember()
      const add = await callHandler(addMember, { token: leader.token, body: { subdivision_id: subdivision, member_id: member } })
      expect(add.result).toEqual({ ok: false, error: 'Not authorized' })
    })
  })

  describe('membership', () => {
    it('lets a leader add a member and notifies the member and the subdivision admins', async () => {
      await enableNotifications()
      const { leader, subdivision } = await setupLeader()
      await signIn({ permissions: ['settings.subdivisions.manage'] })
      const member = await createMember()

      const { result } = await callHandler(addMember, { token: leader.token, body: { subdivision_id: subdivision, member_id: member } })

      expect(result).toEqual({ ok: true })
      expect(await isMember(subdivision, member)).toBe(true)
      expect(await notificationTypes()).toEqual(['subdivision.member_added', 'subdivision.leader_change'])
    })

    it('sends no admin notice when the association switched that type off', async () => {
      await enableNotifications({ notifications_type_settings: JSON.stringify({ 'subdivision.leader_change': { enabled: false } }) })
      const { leader, subdivision } = await setupLeader()
      await signIn({ permissions: ['settings.subdivisions.manage'] })
      const member = await createMember()

      await callHandler(addMember, { token: leader.token, body: { subdivision_id: subdivision, member_id: member } })
      expect(await notificationTypes()).toEqual(['subdivision.member_added'])
    })

    it('refuses changes to a subdivision the user does not lead', async () => {
      const { leader } = await setupLeader()
      const foreign = await createSubdivision()
      const member = await createMember()

      const { result } = await callHandler(addMember, { token: leader.token, body: { subdivision_id: foreign, member_id: member } })
      expect(result).toEqual({ ok: false, error: 'Not authorized' })
      expect(await isMember(foreign, member)).toBe(false)
    })

    it('does not let a leader remove themselves', async () => {
      const { leader, leaderMember, subdivision } = await setupLeader()
      const { result } = await callHandler(removeMember, { token: leader.token, body: { subdivision_id: subdivision, member_id: leaderMember } })
      expect(result).toEqual({ ok: false, error: LEADERSHIP_SELF_FORBIDDEN })
      expect(await isMember(subdivision, leaderMember)).toBe(true)
    })

    it('does not let a leader push out a co-leader', async () => {
      const { leader, subdivision, leadPosition } = await setupLeader()
      const coLeader = await createMember()
      await addSubdivisionMember(subdivision, coLeader)
      await assignPosition(coLeader, leadPosition, { subdivisionId: subdivision })

      const { result } = await callHandler(removeMember, { token: leader.token, body: { subdivision_id: subdivision, member_id: coLeader } })
      expect(result).toEqual({ ok: false, error: LEADERSHIP_ERRORS.protectedPosition })
      expect(await isMember(subdivision, coLeader)).toBe(true)
    })

    it('ends the member\'s positions in the subdivision when they are removed', async () => {
      const { leader, subdivision } = await setupLeader()
      const deputy = await createPosition({ subdivisionBound: true, assignableByLeaders: true })
      const member = await createMember()
      await addSubdivisionMember(subdivision, member)
      const running = await assignPosition(member, deputy, { subdivisionId: subdivision, since: '2024-01-01' })
      const today = await appTodayLocalDate()
      const upcoming = await assignPosition(member, deputy, { subdivisionId: subdivision, since: addDaysToLocalDate(today, 30) })

      const { result } = await callHandler(removeMember, { token: leader.token, body: { subdivision_id: subdivision, member_id: member } })

      expect(result).toEqual({ ok: true })
      expect(await isMember(subdivision, member)).toBe(false)
      const rows = await query<any[]>('SELECT id, until FROM member_positions WHERE member_id = ?', [member])
      expect(rows.map(row => Number(row.id))).toEqual([running])
      expect(String(rows[0].until).slice(0, 10)).toBe(addDaysToLocalDate(today, -1))
      expect(rows.some(row => Number(row.id) === upcoming)).toBe(false)
    })
  })

  describe('position assignments', () => {
    it('lets a leader hand out a released position to a member of the subdivision', async () => {
      await enableNotifications()
      const { leader, subdivision } = await setupLeader()
      const deputy = await createPosition({ subdivisionBound: true, assignableByLeaders: true })
      const member = await createMember()
      await addSubdivisionMember(subdivision, member)

      const { result } = await callHandler(saveAssignment, {
        token: leader.token,
        body: { subdivision_id: subdivision, member_id: member, position_id: deputy, since: '2026-01-01', until: null },
      })

      expect(result).toEqual({ ok: true })
      const rows = await query<any[]>('SELECT subdivision_id FROM member_positions WHERE member_id = ? AND position_id = ?', [member, deputy])
      expect(rows.map(row => Number(row.subdivision_id))).toEqual([subdivision])
      expect(await notificationTypes()).toContain('subdivision.position_assigned')
    })

    it('refuses positions that are not released to leaders, e.g. the leadership itself', async () => {
      const { leader, subdivision, leadPosition } = await setupLeader()
      const member = await createMember()
      await addSubdivisionMember(subdivision, member)

      const { result } = await callHandler(saveAssignment, {
        token: leader.token,
        body: { subdivision_id: subdivision, member_id: member, position_id: leadPosition, since: '2026-01-01', until: null },
      })
      expect(result).toEqual({ ok: false, error: LEADERSHIP_ERRORS.positionNotAssignable })
    })

    it('refuses a position whose permissions go beyond the leader\'s own', async () => {
      const { leader, subdivision } = await setupLeader()
      const treasurer = await createPosition({ subdivisionBound: true, assignableByLeaders: true, permissions: ['receipts.edit'] })
      const member = await createMember()
      await addSubdivisionMember(subdivision, member)

      const { result } = await callHandler(saveAssignment, {
        token: leader.token,
        body: { subdivision_id: subdivision, member_id: member, position_id: treasurer, since: '2026-01-01', until: null },
      })
      expect(result).toEqual({ ok: false, error: LEADERSHIP_ERRORS.exceedsOwn })
    })

    it('refuses members outside the subdivision and the leader themselves', async () => {
      const { leader, leaderMember, subdivision } = await setupLeader()
      const deputy = await createPosition({ subdivisionBound: true, assignableByLeaders: true })
      const outsider = await createMember()

      const outside = await callHandler(saveAssignment, {
        token: leader.token,
        body: { subdivision_id: subdivision, member_id: outsider, position_id: deputy, since: '2026-01-01', until: null },
      })
      expect(outside.result).toEqual({ ok: false, error: LEADERSHIP_ERRORS.notMember })

      const self = await callHandler(saveAssignment, {
        token: leader.token,
        body: { subdivision_id: subdivision, member_id: leaderMember, position_id: deputy, since: '2026-01-01', until: null },
      })
      expect(self.result).toEqual({ ok: false, error: LEADERSHIP_SELF_FORBIDDEN })
    })

    it('ends a running assignment with yesterday', async () => {
      const { leader, subdivision } = await setupLeader()
      const deputy = await createPosition({ subdivisionBound: true, assignableByLeaders: true })
      const member = await createMember()
      await addSubdivisionMember(subdivision, member)
      const assignment = await assignPosition(member, deputy, { subdivisionId: subdivision, since: '2024-01-01' })

      const { result } = await callHandler(endAssignment, { token: leader.token, body: { subdivision_id: subdivision, id: assignment } })

      expect(result).toEqual({ ok: true })
      const [row] = await query<any[]>('SELECT until FROM member_positions WHERE id = ?', [assignment])
      expect(String(row.until).slice(0, 10)).toBe(addDaysToLocalDate(await appTodayLocalDate(), -1))
    })

    it('cannot end the leadership position of a co-leader', async () => {
      const { leader, subdivision, leadPosition } = await setupLeader()
      const coLeader = await createMember()
      await addSubdivisionMember(subdivision, coLeader)
      const assignment = await assignPosition(coLeader, leadPosition, { subdivisionId: subdivision })

      const { result } = await callHandler(endAssignment, { token: leader.token, body: { subdivision_id: subdivision, id: assignment } })
      expect(result).toEqual({ ok: false, error: LEADERSHIP_ERRORS.positionNotAssignable })
    })
  })

  describe('subdivisions.leadership.edit', () => {
    it('grants every scoped permission in every subdivision', async () => {
      const editor = await signIn({ permissions: ['subdivisions.leadership.edit'] })
      const subdivision = await createSubdivision()
      const member = await createMember()

      const { result } = await callHandler(addMember, { token: editor.token, body: { subdivision_id: subdivision, member_id: member } })
      expect(result).toEqual({ ok: true })
    })
  })

  describe('history', () => {
    it('shows a leader the membership history of their subdivision without audit.view', async () => {
      const { leader, subdivision } = await setupLeader()
      const member = await createMember()
      await callHandler(addMember, { token: leader.token, body: { subdivision_id: subdivision, member_id: member } })

      const { result } = await callHandler(leadershipHistory, { token: leader.token, path: `/api/subdivision-leadership/history?parentId=${subdivision}` })
      expect(result.ok).toBe(true)
      const tables = result.groups.flatMap((group: any) => group.entries.map((entry: any) => entry.table))
      expect(tables).toContain('subdivision_members')
    })

    it('is refused for a subdivision the user does not lead', async () => {
      const { leader } = await setupLeader()
      const foreign = await createSubdivision()
      const { result } = await callHandler(leadershipHistory, { token: leader.token, path: `/api/subdivision-leadership/history?parentId=${foreign}` })
      expect(result).toEqual({ ok: false, error: 'Not authorized' })
    })
  })

  describe('administration (Settings / member form)', () => {
    it('requires a subdivision for a subdivision-bound position and adds the membership', async () => {
      const admin = await signIn({ permissions: ['settings.positions.manage', 'positions.assign', 'permissions.manage'] })
      const subdivision = await createSubdivision()
      const member = await createMember()
      const lead = await createPosition({ code: 'LEAD', subdivisionBound: true, subdivisionPermissions: ['subdivision.members.manage'] })

      const missing = await callHandler(savePosition, {
        token: admin.token,
        body: { id: lead, code: 'LEAD', name: 'Leitung', subdivision_bound: true, assignments: [{ member_id: member, since: '2024-01-01', until: null }] },
      })
      expect(missing.result.ok).toBe(false)

      const saved = await callHandler(savePosition, {
        token: admin.token,
        body: { id: lead, code: 'LEAD', name: 'Leitung', subdivision_bound: true, assignments: [{ member_id: member, since: '2024-01-01', until: null, subdivision_id: subdivision }] },
      })
      expect(saved.result).toEqual({ ok: true, id: lead })
      expect(await isMember(subdivision, member)).toBe(true)
    })

    it('treats scoped permissions as rights when assigning without permissions.manage', async () => {
      const assigner = await signIn({ permissions: ['settings.positions.manage', 'positions.assign'] })
      const subdivision = await createSubdivision()
      const member = await createMember()
      const lead = await createPosition({ code: 'LEAD', subdivisionBound: true, subdivisionPermissions: ['subdivision.members.manage'] })

      const { result } = await callHandler(savePosition, {
        token: assigner.token,
        body: { id: lead, code: 'LEAD', name: 'Leitung', subdivision_bound: true, assignments: [{ member_id: member, since: '2024-01-01', until: null, subdivision_id: subdivision }] },
      })
      expect(result).toEqual({ ok: false, error: POSITION_ASSIGN_EXCEEDS_OWN })
    })

    it('lets an assigner whose global permissions cover the scoped ones appoint a leader', async () => {
      // settings.subdivisions.manage already allows membership changes in every subdivision and
      // members.view shows every member, so handing out members.manage (which includes viewing the
      // members) is no escalation (coveredBy).
      const assigner = await signIn({ permissions: ['settings.positions.manage', 'positions.assign', 'settings.subdivisions.manage', 'members.view'] })
      const subdivision = await createSubdivision()
      const member = await createMember()
      const lead = await createPosition({ code: 'LEAD', subdivisionBound: true, subdivisionPermissions: ['subdivision.members.manage', 'subdivision.positions.assign'] })

      const { result } = await callHandler(savePosition, {
        token: assigner.token,
        body: { id: lead, code: 'LEAD', name: 'Leitung', subdivision_bound: true, assignments: [{ member_id: member, since: '2024-01-01', until: null, subdivision_id: subdivision }] },
      })
      expect(result).toEqual({ ok: true, id: lead })
    })

    it('needs every covering permission, e.g. both audit.view and subdivisions.view for the history', async () => {
      const assigner = await signIn({ permissions: ['settings.positions.manage', 'positions.assign', 'audit.view'] })
      const subdivision = await createSubdivision()
      const member = await createMember()
      const lead = await createPosition({ code: 'LEAD', subdivisionBound: true, subdivisionPermissions: ['subdivision.history.view'] })

      const { result } = await callHandler(savePosition, {
        token: assigner.token,
        body: { id: lead, code: 'LEAD', name: 'Leitung', subdivision_bound: true, assignments: [{ member_id: member, since: '2024-01-01', until: null, subdivision_id: subdivision }] },
      })
      expect(result).toEqual({ ok: false, error: POSITION_ASSIGN_EXCEEDS_OWN })
    })

    it('lets the same position be held in two subdivisions at once', async () => {
      const admin = await signIn({ permissions: ['settings.positions.manage', 'positions.assign', 'permissions.manage'] })
      const first = await createSubdivision()
      const second = await createSubdivision()
      const member = await createMember()
      const lead = await createPosition({ code: 'LEAD', subdivisionBound: true })

      const { result } = await callHandler(savePosition, {
        token: admin.token,
        body: {
          id: lead,
          code: 'LEAD',
          name: 'Leitung',
          subdivision_bound: true,
          assignments: [
            { member_id: member, since: '2024-01-01', until: null, subdivision_id: first },
            { member_id: member, since: '2024-01-01', until: null, subdivision_id: second },
          ],
        },
      })
      expect(result).toEqual({ ok: true, id: lead })
    })

    it('locks the subdivision binding once the position has assignments', async () => {
      const admin = await signIn({ permissions: ['settings.positions.manage', 'positions.assign', 'permissions.manage'] })
      const member = await createMember()
      const position = await createPosition({ code: 'P' })
      const assignment = await assignPosition(member, position)

      const { result } = await callHandler(savePosition, {
        token: admin.token,
        body: { id: position, code: 'P', name: 'P', subdivision_bound: true, assignments: [{ id: assignment, member_id: member, since: '2024-01-01', until: null }] },
      })
      expect(result.ok).toBe(false)
    })

    it('ends positions when an admin removes the member in Settings → Subdivisions', async () => {
      const admin = await signIn({ permissions: ['settings.subdivisions.manage'] })
      const { subdivision, leaderMember } = await setupLeader()

      const { result } = await callHandler(saveSubdivision, {
        token: admin.token,
        body: { id: subdivision, code: 'S', name: 'S', member_ids: [] },
      })
      expect(result).toEqual({ ok: true, id: subdivision })
      const [row] = await query<any[]>('SELECT until FROM member_positions WHERE member_id = ?', [leaderMember])
      expect(String(row.until).slice(0, 10)).toBe(addDaysToLocalDate(await appTodayLocalDate(), -1))
    })
  })
})
