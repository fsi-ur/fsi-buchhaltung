import { defineEventHandler } from 'h3'
import type { PositionRow } from '~/types/position'
import { normalizeBigInt } from '~/server/utils/normalize'
import { query } from '~/server/utils/db'
import { requirePermission } from '~/server/utils/api/guards'

interface GetPositionsSuccess {
  ok: true
  positions: PositionRow[]
}

interface GetPositionsError {
  ok: false
  error: string
}

type GetPositionsResponse = GetPositionsSuccess | GetPositionsError

export default defineEventHandler(async (event): Promise<GetPositionsResponse> => {
  const current = await requirePermission(event, 'positions.view')
  if (!current.ok) return current

  type RawPositionRow = Omit<PositionRow, 'subdivision_bound' | 'assignable_by_leaders'> & { subdivision_bound: number, assignable_by_leaders: number }
  const rows: RawPositionRow[] = normalizeBigInt(await query<RawPositionRow[]>(`
    SELECT id, code, name, is_active, description, subdivision_bound, assignable_by_leaders
    FROM positions
    ORDER BY code ASC
  `))

  return {
    ok: true,
    positions: rows.map(row => ({
      ...row,
      subdivision_bound: Boolean(row.subdivision_bound),
      assignable_by_leaders: Boolean(row.assignable_by_leaders),
    })),
  }
})
