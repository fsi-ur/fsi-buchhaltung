import { defineEventHandler, readBody } from 'h3'
import type { MemberStatusActionSummary, SaveMemberBody } from '~/types/member'
import { query, withAuditTransaction } from '~/server/utils/db'
import { requirePermission } from '~/server/utils/api/guards'
import { getNumericRouteParam } from '~/server/utils/api/request'
import { ensureSubjectId, validateMemberPayload, applyMemberStatusActions } from '~/server/utils/members'
import { getSubdivisionLabels, normalizeRelationIds, syncSubdivisionAssignments, validateSubdivisionSelection } from '~/server/utils/subdivisions'
import { normalizePositionAssignments, syncPositionAssignments, type PositionAssignmentRow } from '~/server/utils/positions'
import { clearPendingChangeForField } from '~/server/utils/memberSelfEdit'
import { retargetPendingMemberWelcome } from '~/server/utils/memberWelcome'
import { SELF_EDIT_ELIGIBLE_FIELDS } from '~/config/memberSelfEdit'

interface UpdateMemberSuccess {
  ok: true
  id: number
  status_actions: MemberStatusActionSummary | null
}

interface UpdateMemberError {
  ok: false
  error: string
}

type UpdateMemberResponse = UpdateMemberSuccess | UpdateMemberError

export default defineEventHandler(async (event): Promise<UpdateMemberResponse> => {
  const current = await requirePermission(event, 'members.edit', { touch: false })
  if (!current.ok) return current

  const memberId = getNumericRouteParam(event)
  if (!memberId) return { ok: false, error: 'Missing member id' }

  const body = await readBody<SaveMemberBody>(event)
  const validationError = validateMemberPayload(body)
  if (validationError) return { ok: false, error: validationError }

  const canManageSubdivisions = current.user.permissions.includes('settings.subdivisions.manage')
  const subdivisionIds = body.subdivision_ids === undefined ? undefined : normalizeRelationIds(body.subdivision_ids)
  if (subdivisionIds === null) return { ok: false, error: 'Invalid subdivision list' }
  if (!canManageSubdivisions && subdivisionIds !== undefined && subdivisionIds.length > 0) {
    return { ok: false, error: 'Not authorized to manage subdivisions' }
  }

  const positionAssignments = normalizePositionAssignments(body.positions, { member_id: memberId })
  if (positionAssignments === null) return { ok: false, error: 'Invalid position list' }

  try {
    return await withAuditTransaction(current.user, async (conn) => {
      const existingRows = await query<any[]>(`SELECT * FROM members WHERE id = ? LIMIT 1`, [memberId], conn)
      const existing = existingRows[0]
      if (!existing) return { ok: false, error: 'Member not found' }

      const subjectId = await ensureSubjectId(body.subject_name, conn)

      const updatedFields = {
        account: body.account ?? null,
        last_name: body.last_name,
        first_name: body.first_name,
        birthdate: body.birthdate,
        street: body.street,
        street_number: body.street_number,
        postal_code: body.postal_code,
        city: body.city,
        subject: subjectId,
        phone: body.phone,
        email: body.email,
        notes: body.notes ?? null,
        status: body.status,
        honorary: body.honorary ? 1 : 0,
        applied_at: body.applied_at,
        joined_at: body.joined_at,
        left_at: body.left_at || null,
      }

      await query(
        `UPDATE members
         SET account = ?, last_name = ?, first_name = ?, birthdate = ?, street = ?, street_number = ?, postal_code = ?, city = ?, subject = ?, phone = ?, email = ?, notes = ?, status = ?, honorary = ?, applied_at = ?, joined_at = ?, left_at = ?
         WHERE id = ?`,
        [
          updatedFields.account,
          updatedFields.last_name,
          updatedFields.first_name,
          updatedFields.birthdate,
          updatedFields.street,
          updatedFields.street_number,
          updatedFields.postal_code,
          updatedFields.city,
          updatedFields.subject,
          updatedFields.phone,
          updatedFields.email,
          updatedFields.notes,
          updatedFields.status,
          updatedFields.honorary,
          updatedFields.applied_at,
          updatedFields.joined_at,
          updatedFields.left_at,
          memberId,
        ],
        conn
      )

      await Promise.all(
        SELF_EDIT_ELIGIBLE_FIELDS.map(field => clearPendingChangeForField(memberId, field, conn)),
      )

      const existingPositionRows = await query<PositionAssignmentRow[]>(
        `SELECT id, member_id, position_id, since, until
         FROM member_positions
         WHERE member_id = ?`,
        [memberId],
        conn,
      )

      const syncedPositions = await syncPositionAssignments({
        scope: 'member',
        ownerId: memberId,
        existingAssignments: existingPositionRows,
        incomingAssignments: positionAssignments ?? [],
        userId: current.user.id,
        conn,
      })
      if (!syncedPositions.ok) return { ok: false, error: syncedPositions.error }

      if (canManageSubdivisions && subdivisionIds !== undefined) {
        const existingSubdivisionRows = await query<{ subdivision_id: number }[]>(
          `SELECT subdivision_id
           FROM subdivision_members
           WHERE member_id = ?`,
          [memberId],
          conn,
        )

        const existingSubdivisionIds = existingSubdivisionRows.map(row => Number(row.subdivision_id))
        const allSubdivisionIds = Array.from(new Set([...existingSubdivisionIds, ...subdivisionIds]))
        const subdivisionValidationError = await validateSubdivisionSelection(
          subdivisionIds,
          existingSubdivisionIds,
          conn,
        )
        if (subdivisionValidationError) {
          return { ok: false, error: subdivisionValidationError }
        }

        const subdivisionLabels = await getSubdivisionLabels(allSubdivisionIds, conn)
        if (subdivisionLabels.size !== allSubdivisionIds.length) {
          return { ok: false, error: 'One or more selected subdivisions do not exist' }
        }

        await syncSubdivisionAssignments({
          existingIds: existingSubdivisionIds,
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

      const memberAccountId = body.account ?? (existing.account === null || existing.account === undefined
        ? null
        : Number(existing.account))

      const statusActions = await applyMemberStatusActions({
        memberId,
        accountId: memberAccountId,
        previousStatus: existing.status,
        nextStatus: body.status,
        leftAt: body.left_at || null,
        memberLabel: `${body.first_name} ${body.last_name}`.trim(),
        userId: current.user.id,
        conn,
      })

     await retargetPendingMemberWelcome(memberId, conn)

      return { ok: true, id: memberId, status_actions: statusActions }
    })
  } catch (err: any) {
    return { ok: false, error: `Failed to update member: ${err?.code || err}` }
  }
})
