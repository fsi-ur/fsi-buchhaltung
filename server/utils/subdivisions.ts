import type * as mariadb from 'mariadb'
import { query } from '~/server/utils/db'
import { syncScalarCollection } from '~/server/utils/syncScalarCollection'

interface NamedRow {
  id: number
  label: string
}

interface SubdivisionStateRow {
  id: number
  code: string
  name: string
  is_active: number
}

interface SyncSubdivisionAssignmentsOptions {
  existingIds: number[]
  nextIds: number[]
  getAssignment: (id: number) => {
    subdivisionId: number
    memberId: number
    memberLabel: string
  }
  userId: number
  conn: mariadb.PoolConnection
}

export function normalizeRelationIds(value: unknown): number[] | null {
  if (!Array.isArray(value)) return null

  const normalized: number[] = []
  const seen = new Set<number>()

  for (const entry of value) {
    const id = Number(entry)
    if (!Number.isInteger(id) || id <= 0) return null
    if (seen.has(id)) continue
    seen.add(id)
    normalized.push(id)
  }

  return normalized
}

export async function getSubdivisionLabels(
  subdivisionIds: number[],
  conn: mariadb.PoolConnection,
) {
  if (!subdivisionIds.length) return new Map<number, string>()

  const rows = await query<NamedRow[]>(
    `SELECT id, TRIM(CONCAT(code, ' - ', name)) AS label
     FROM subdivisions
     WHERE id IN (${subdivisionIds.map(() => '?').join(',')})`,
    subdivisionIds,
    conn,
  )

  return new Map(rows.map(row => [Number(row.id), String(row.label)]))
}

export async function validateSubdivisionSelection(
  subdivisionIds: number[],
  allowedExistingSubdivisionIds: Iterable<number> = [],
  conn: mariadb.PoolConnection,
) {
  const normalizedSubdivisionIds = Array.from(new Set(
    subdivisionIds
      .map(value => Number(value))
      .filter(value => Number.isInteger(value) && value > 0),
  ))

  if (!normalizedSubdivisionIds.length) return null

  const rows = await query<SubdivisionStateRow[]>(
    `SELECT id, code, name, is_active
     FROM subdivisions
     WHERE id IN (${normalizedSubdivisionIds.map(() => '?').join(',')})`,
    normalizedSubdivisionIds,
    conn,
  )

  if (rows.length !== normalizedSubdivisionIds.length) {
    return 'One or more selected subdivisions do not exist'
  }

  const allowedIds = new Set(
    Array.from(allowedExistingSubdivisionIds)
      .map(value => Number(value))
      .filter(value => Number.isInteger(value) && value > 0),
  )

  const disallowedSubdivision = rows.find((row) => {
    if (Boolean(row.is_active)) return false
    return !allowedIds.has(Number(row.id))
  })

  if (!disallowedSubdivision) return null

  return `${disallowedSubdivision.code} - ${disallowedSubdivision.name}: inactive subdivisions cannot be newly selected`
}

export async function getMemberLabels(
  memberIds: number[],
  conn: mariadb.PoolConnection,
) {
  if (!memberIds.length) return new Map<number, string>()

  const rows = await query<NamedRow[]>(
    `SELECT id, TRIM(CONCAT(first_name, ' ', last_name)) AS label
     FROM members
     WHERE id IN (${memberIds.map(() => '?').join(',')})`,
    memberIds,
    conn,
  )

  return new Map(rows.map(row => [Number(row.id), String(row.label)]))
}

export async function syncSubdivisionAssignments(
  options: SyncSubdivisionAssignmentsOptions,
) {
  const { existingIds, nextIds, getAssignment, userId, conn } = options

  await syncScalarCollection({
    existing: existingIds,
    incoming: nextIds,
    onRemove: async (id) => {
      const { subdivisionId, memberId } = getAssignment(id)

      await query(
        `DELETE FROM subdivision_members
         WHERE subdivision_id = ? AND member_id = ?`,
        [subdivisionId, memberId],
        conn,
      )
    },
    onAdd: async (id) => {
      const { subdivisionId, memberId } = getAssignment(id)

      await query(
        `INSERT INTO subdivision_members (subdivision_id, member_id)
         VALUES (?, ?)`,
        [subdivisionId, memberId],
        conn,
      )
    },
  })
}
