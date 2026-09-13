import { defineEventHandler, readBody } from 'h3'
import type { SaveMemberBody } from '~/types/member'
import { query, withAuditTransaction } from '~/server/utils/db'
import { requirePermission } from '~/server/utils/api/guards'
import { createUserAccount, DuplicateUsernameError } from '~/server/utils/userAccounts'
import { ensureSubjectId, validateMemberPayload } from '~/server/utils/members'
import { getSubdivisionLabels, normalizeRelationIds, syncSubdivisionAssignments, validateSubdivisionSelection } from '~/server/utils/subdivisions'
import { normalizePositionAssignments, syncPositionAssignments } from '~/server/utils/positions'
import { scheduleMemberWelcome } from '~/server/utils/memberWelcome'

interface CreateMemberSuccess {
  ok: true
  id: number
}

interface CreateMemberError {
  ok: false
  error: string
}

type CreateMemberResponse = CreateMemberSuccess | CreateMemberError

export default defineEventHandler(async (event): Promise<CreateMemberResponse> => {
  const current = await requirePermission(event, 'members.edit', { touch: false })
  if (!current.ok) return current

  const body = await readBody<SaveMemberBody>(event)
  const validationError = validateMemberPayload(body)
  if (validationError) return { ok: false, error: validationError }

  const canManageSubdivisions = current.user.permissions.includes('settings.subdivisions.manage')
  const subdivisionIds = body.subdivision_ids === undefined ? [] : normalizeRelationIds(body.subdivision_ids)
  if (subdivisionIds === null) return { ok: false, error: 'Invalid subdivision list' }
  if (!canManageSubdivisions && subdivisionIds.length > 0) {
    return { ok: false, error: 'Not authorized to manage subdivisions' }
  }

  const positionAssignments = normalizePositionAssignments(body.positions)
  if (positionAssignments === null) return { ok: false, error: 'Invalid position list' }

  try {
    return await withAuditTransaction(current.user, async (conn) => {
      const subjectId = await ensureSubjectId(body.subject_name, conn)
      let accountId = body.account ?? null

      if (body.new_account) {
        if (!current.user.permissions.includes('users.manage')) {
          return { ok: false, error: 'Not authorized to create accounts' }
        }

        accountId = await createUserAccount(body.new_account, conn)
      }

      const insertMemberRes = await query<any>(
        `INSERT INTO members
          (account, last_name, first_name, birthdate, street, street_number, postal_code, city, subject, phone, email, notes, status, honorary, applied_at, joined_at, left_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          accountId,
          body.last_name,
          body.first_name,
          body.birthdate,
          body.street,
          body.street_number,
          body.postal_code,
          body.city,
          subjectId,
          body.phone,
          body.email,
          body.notes ?? null,
          body.status,
          body.honorary ? 1 : 0,
          body.applied_at,
          body.joined_at,
          body.left_at || null,
        ],
        conn
      )

      const memberId = Number(insertMemberRes.insertId)

      const syncedPositions = await syncPositionAssignments({
        scope: 'member',
        ownerId: memberId,
        existingAssignments: [],
        incomingAssignments: (positionAssignments ?? []).map(assignment => ({
          ...assignment,
          member_id: memberId,
        })),
        userId: current.user.id,
        conn,
      })
      if (!syncedPositions.ok) return { ok: false, error: syncedPositions.error }

      if (canManageSubdivisions && subdivisionIds.length) {
        const subdivisionValidationError = await validateSubdivisionSelection(subdivisionIds, [], conn)
        if (subdivisionValidationError) {
          return { ok: false, error: subdivisionValidationError }
        }

        const subdivisionLabels = await getSubdivisionLabels(subdivisionIds, conn)
        if (subdivisionLabels.size !== subdivisionIds.length) {
          return { ok: false, error: 'One or more selected subdivisions do not exist' }
        }

        await syncSubdivisionAssignments({
          existingIds: [],
          nextIds: subdivisionIds,
          getAssignment: (subdivisionId) => ({
            subdivisionId,
            memberId,
            memberLabel: `${body.first_name} ${body.last_name}`.trim(),
          }),
          userId: current.user.id,
          conn,
        })
      }

      if (body.send_welcome_mail) {
        const welcome = await scheduleMemberWelcome({ memberId, createdByUserId: current.user.id }, conn)
        if (!welcome.ok) console.error(`members: welcome mail for member ${memberId} could not be queued: ${welcome.error}`)
      }

      return { ok: true, id: memberId }
    })
  } catch (err: any) {
    if (err instanceof DuplicateUsernameError) {
      return { ok: false, error: 'Username already exists' }
    }
    return { ok: false, error: `Failed to create member: ${err?.code || err}` }
  }
})
