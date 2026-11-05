import { defineEventHandler, readBody } from 'h3'
import { query, withAuditTransaction } from '~/server/utils/db'
import { requirePermission } from '~/server/utils/api/guards'
import { toDbBoolean } from '~/server/utils/api/request'
import { getMemberLabels, normalizeRelationIds, syncSubdivisionAssignments } from '~/server/utils/subdivisions'
import type { SaveSubdivisionBody } from '~/types/subdivision'
import { internalError } from '~/server/utils/api/errors'

interface SubdivisionRow {
  id: number
  code: string
  name: string
  is_active: boolean
  description: string | null
}

interface SubdivisionMemberRow {
  member_id: number
}

interface SaveSubdivisionSuccess {
  ok: true
  id: number
}

interface SaveSubdivisionError {
  ok: false
  error: string
}

type SaveSubdivisionResponse = SaveSubdivisionSuccess | SaveSubdivisionError

interface MysqlError extends Error {
  code?: string
}

export default defineEventHandler(async (event): Promise<SaveSubdivisionResponse> => {
  const current = await requirePermission(event, 'settings.subdivisions.manage', { touch: false })
  if (!current.ok) return current

  const body = await readBody<SaveSubdivisionBody>(event)
  if (!body.code || !body.name) return { ok: false, error: 'Missing fields' }

  const memberIds = normalizeRelationIds(body.member_ids ?? [])
  if (memberIds === null) return { ok: false, error: 'Invalid member list' }

  const updated: SaveSubdivisionBody = {
    ...body,
    member_ids: memberIds,
  }

  if (updated.is_active === undefined || updated.is_active === null) updated.is_active = true
  const active = toDbBoolean(updated.is_active)

  try {
    return await withAuditTransaction(current.user, async (conn) => {
      const memberLabels = await getMemberLabels(updated.member_ids ?? [], conn)
      if (memberLabels.size !== (updated.member_ids?.length ?? 0)) {
        return { ok: false, error: 'One or more selected members do not exist' }
      }

      if (updated.id && updated.id > 0) {
        const subdivisionId = updated.id

        const existingRows = await query<SubdivisionRow[]>(
          `SELECT id, code, name, is_active, description
           FROM subdivisions
           WHERE id = ?
           LIMIT 1`,
          [updated.id],
          conn,
        )

        if (!existingRows.length) return { ok: false, error: 'No matching subdivisions in database' }

        await query(
          `UPDATE subdivisions
           SET code = ?, name = ?, description = ?
           WHERE id = ?`,
          [updated.code, updated.name, updated.description ?? null, subdivisionId],
          conn,
        )

        const existingMemberRows = await query<SubdivisionMemberRow[]>(
          `SELECT member_id
           FROM subdivision_members
           WHERE subdivision_id = ?`,
          [subdivisionId],
          conn,
        )

        const existingMemberIds = existingMemberRows.map(row => Number(row.member_id))
        const allMemberIds = Array.from(new Set([...existingMemberIds, ...(updated.member_ids ?? [])]))
        const labelsForSync = await getMemberLabels(allMemberIds, conn)

        await syncSubdivisionAssignments({
          existingIds: existingMemberIds,
          nextIds: updated.member_ids ?? [],
          getAssignment: (memberId) => ({
            subdivisionId,
            memberId,
            memberLabel: labelsForSync.get(memberId) ?? String(memberId),
          }),
          userId: current.user.id,
          conn,
        })

        return { ok: true, id: subdivisionId }
      }

      const res = await query(
        `INSERT INTO subdivisions (code, name, is_active, description)
         VALUES (?, ?, ?, ?)`,
        [updated.code, updated.name, active, updated.description ?? null],
        conn,
      )

      const subdivisionId = Number(res.insertId)

      await syncSubdivisionAssignments({
        existingIds: [],
        nextIds: updated.member_ids ?? [],
        getAssignment: (memberId) => ({
          subdivisionId,
          memberId,
          memberLabel: memberLabels.get(memberId) ?? String(memberId),
        }),
        userId: current.user.id,
        conn,
      })

      return { ok: true, id: subdivisionId }
    })
  } catch (err: unknown) {
    const error = err as MysqlError
    return internalError('An error occured while saving the subdivision', err)
  }
})
