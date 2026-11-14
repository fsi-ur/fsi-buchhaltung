import { defineEventHandler } from 'h3'
import type { PositionMemberAssignment, PositionRow } from '~/types/position'
import { normalizeBigInt } from '~/server/utils/normalize'
import { query } from '~/server/utils/db'
import { requirePermission } from '~/server/utils/api/guards'

interface PositionManageRow {
  id: number
  code: string
  name: string
  is_active: boolean
  description: string | null
  subdivision_bound: number
  assignable_by_leaders: number
  assignment_id: number | null
  member_id: number | null
  full_name: string | null
  since: string | null
  until: string | null
  subdivision_id: number | null
  subdivision_name: string | null
}

interface GetManagedPositionsSuccess {
  ok: true
  positions: PositionRow[]
}

interface GetManagedPositionsError {
  ok: false
  error: string
}

type GetManagedPositionsResponse = GetManagedPositionsSuccess | GetManagedPositionsError

export default defineEventHandler(async (event): Promise<GetManagedPositionsResponse> => {
  const current = await requirePermission(event, 'settings.positions.manage')
  if (!current.ok) return current

  const rows = normalizeBigInt(await query<PositionManageRow[]>(`
    SELECT
      p.id,
      p.code,
      p.name,
      p.is_active,
      p.description,
      p.subdivision_bound,
      p.assignable_by_leaders,
      mp.id AS assignment_id,
      mp.member_id,
      TRIM(CONCAT(m.first_name, ' ', m.last_name)) AS full_name,
      mp.since,
      mp.until,
      mp.subdivision_id,
      sd.name AS subdivision_name
    FROM positions p
    LEFT JOIN member_positions mp ON mp.position_id = p.id
    LEFT JOIN members m ON m.id = mp.member_id
    LEFT JOIN subdivisions sd ON sd.id = mp.subdivision_id
    ORDER BY p.code ASC, mp.since ASC, m.last_name ASC, m.first_name ASC
  `)) as PositionManageRow[]

  const positions = new Map<number, PositionRow>()

  for (const row of rows) {
    const positionId = Number(row.id)
    if (!positions.has(positionId)) {
      positions.set(positionId, {
        id: positionId,
        code: String(row.code),
        name: String(row.name),
        is_active: Boolean(row.is_active),
        description: row.description ? String(row.description) : '',
        subdivision_bound: Boolean(row.subdivision_bound),
        assignable_by_leaders: Boolean(row.assignable_by_leaders),
        assignments: [],
      })
    }

    if (!row.assignment_id || !row.member_id || !row.full_name || !row.since) continue

    positions.get(positionId)!.assignments!.push({
      id: Number(row.assignment_id),
      member_id: Number(row.member_id),
      full_name: String(row.full_name),
      since: String(row.since),
      until: row.until ? String(row.until) : null,
      subdivision_id: row.subdivision_id ? Number(row.subdivision_id) : null,
      subdivision_name: row.subdivision_name ? String(row.subdivision_name) : null,
    } satisfies PositionMemberAssignment)
  }

  return { ok: true, positions: Array.from(positions.values()) }
})
