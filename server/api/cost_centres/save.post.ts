import { defineEventHandler, readBody } from 'h3'
import type mariadb from 'mariadb'
import { query, withAuditTransaction } from '~/server/utils/db'
import { requirePermission } from '~/server/utils/api/guards'
import { toDbBoolean } from '~/server/utils/api/request'
import type { CostCentreRow, SaveCostCentreBody } from '~/types/costCentre'
import { internalError } from '~/server/utils/api/errors'

interface SaveCostCentreSuccess {
  ok: true
  id: number
}

interface SaveCostCentreError {
  ok: false
  error: string
}

type SaveCostCentreResponse = SaveCostCentreSuccess | SaveCostCentreError

interface MysqlError extends Error {
  code?: string
}

interface CostCentreParentRow {
  id: number
  parent_id: number | null
}

function normalizeParentId(value: unknown): number | null | 'invalid' {
  if (value === undefined || value === null || value === '') return null

  if (typeof value === 'number') {
    return Number.isInteger(value) && value > 0 ? value : 'invalid'
  }

  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (!trimmed) return null
    if (!/^\d+$/.test(trimmed)) return 'invalid'

    const parsed = Number(trimmed)
    return Number.isInteger(parsed) && parsed > 0 ? parsed : 'invalid'
  }

  return 'invalid'
}

async function validateParentHierarchy(
  id: number | undefined,
  parentId: number | null,
  conn: mariadb.PoolConnection,
) {
  if (parentId === null) {
    return { ok: true as const, parentId: null }
  }

  if (id && parentId === id) {
    return { ok: false as const, error: 'A cost centre cannot be its own parent' }
  }

  const seen = new Set<number>()
  let currentId: number | null = parentId

  while (currentId !== null) {
    if (seen.has(currentId)) {
      return { ok: false as const, error: 'Invalid cost centre hierarchy' }
    }

    seen.add(currentId)

    const rows: CostCentreParentRow[] = await query<CostCentreParentRow[]>(
      `SELECT id, parent_id FROM cost_centres WHERE id = ? LIMIT 1`,
      [currentId],
      conn,
    )

    if (!rows.length) {
      return { ok: false as const, error: 'Selected parent cost centre does not exist' }
    }

    const currentRow: CostCentreParentRow = rows[0]!
    if (id && currentRow.id === id) {
      return { ok: false as const, error: 'A cost centre cannot be assigned to one of its descendants' }
    }

    currentId = currentRow.parent_id ?? null
  }

  return { ok: true as const, parentId }
}

export default defineEventHandler(async (event): Promise<SaveCostCentreResponse> => {
  const current = await requirePermission(event, 'settings.cost_centres.manage', { touch: false })
  if (!current.ok) return current

  const body = await readBody<SaveCostCentreBody>(event)
  if (!body.code || !body.name) return { ok: false, error: 'Missing fields' }
  const updated = body
  const parentId = normalizeParentId(updated.parent_id)

  if (parentId === 'invalid') return { ok: false, error: 'Invalid parent cost centre' }
  updated.parent_id = parentId

  if (updated.is_active === undefined || updated.is_active === null) updated.is_active = true
  const active = toDbBoolean(updated.is_active)

  try {
    return await withAuditTransaction(current.user, async (conn) => {
      const parentValidation = await validateParentHierarchy(updated.id, updated.parent_id ?? null, conn)
      if (!parentValidation.ok) return parentValidation

      if (updated.id && updated.id > 0) {
        const existingRows: CostCentreRow[] = await query(
          `SELECT * FROM cost_centres WHERE id = ? LIMIT 1`,
          [updated.id],
          conn
        )
      
        if (!existingRows.length) return { ok: false, error: 'No matching cost centres in database' }
        await query(
          `UPDATE cost_centres
          SET code = ?, name = ?, description = ?, parent_id = ?
          WHERE id = ?`,
          [updated.code, updated.name, updated.description, updated.parent_id ?? null, updated.id],
          conn
        )

        return { ok: true, id: updated.id }
      }

      const res = await query(
        `INSERT INTO cost_centres (code, name, is_active, description, parent_id)
        VALUES (?, ?, ?, ?, ?)`,
        [updated.code, updated.name, active, updated.description, updated.parent_id ?? null],
        conn
      )

      return { ok: true, id: res.insertId }
    })
  } catch (err: unknown) {
    const error = err as MysqlError
    return internalError('An error occured while saving the cost centre', err)
  }
})
