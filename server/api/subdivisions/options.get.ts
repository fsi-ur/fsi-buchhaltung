import { defineEventHandler } from 'h3'
import { query } from '~/server/utils/db'
import { requirePermission } from '~/server/utils/api/guards'
import { normalizeBigInt } from '~/server/utils/normalize'
import type { SubdivisionOption } from '~/types/subdivision'

interface SubdivisionOptionRow {
  id: number
  code: string
  name: string
  is_active: boolean
}

interface GetSubdivisionOptionsSuccess {
  ok: true
  subdivisions: SubdivisionOption[]
}

interface GetSubdivisionOptionsError {
  ok: false
  error: string
}

type GetSubdivisionOptionsResponse = GetSubdivisionOptionsSuccess | GetSubdivisionOptionsError

export default defineEventHandler(async (event): Promise<GetSubdivisionOptionsResponse> => {
  const current = await requirePermission(event, ['settings.subdivisions.manage', 'subdivisions.view', 'positions.assign', 'settings.positions.manage'])
  if (!current.ok) return current

  const rows = normalizeBigInt(await query<SubdivisionOptionRow[]>(`
    SELECT id, code, name, is_active
    FROM subdivisions
    ORDER BY is_active DESC, code ASC, name ASC
  `)) as SubdivisionOptionRow[]

  return {
    ok: true,
    subdivisions: rows.map(row => ({
      id: Number(row.id),
      code: String(row.code),
      name: String(row.name),
      is_active: Boolean(row.is_active),
    })),
  }
})
