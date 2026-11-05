import { defineEventHandler, readBody } from 'h3'
import { requirePermission } from '~/server/utils/api/guards'
import { toDbBoolean } from '~/server/utils/api/request'
import { query, withAuditTransaction } from '~/server/utils/db'
import type { ActivateResponse } from '~/types/activate'
import type { CostCentreRow } from '~/types/costCentre'
import { internalError } from '~/server/utils/api/errors'

interface ActivateCostCentreBody {
  id: number
  is_active: boolean
  clear_child_parent_links?: boolean
}

export default defineEventHandler(async (event): Promise<ActivateResponse> => {
  const current = await requirePermission(event, 'settings.cost_centres.manage')
  if (!current.ok) return current

  const {
    id,
    is_active,
    clear_child_parent_links,
  } = await readBody<ActivateCostCentreBody>(event)

  if (id === undefined || id === null || is_active === undefined || is_active === null) {
    return { ok: false, error: 'Missing fields' }
  }

  try {
    return await withAuditTransaction(current.user, async (conn) => {
      const existingRows = await query<CostCentreRow[]>(
        `SELECT * FROM cost_centres WHERE id = ? LIMIT 1`,
        [id],
        conn,
      )

      if (!existingRows.length) {
        return { ok: false, error: 'No matching cost centres in database' }
      }

      const active = toDbBoolean(is_active)

      await query(
        `UPDATE cost_centres
         SET is_active = ?
         WHERE id = ?`,
        [active, id],
        conn,
      )

      if (is_active || !clear_child_parent_links) {
        return { ok: true }
      }

      const childRows = await query<CostCentreRow[]>(
        `SELECT * FROM cost_centres WHERE parent_id = ?`,
        [id],
        conn,
      )

      if (childRows.length) {
        await query(
          `UPDATE cost_centres
           SET parent_id = NULL
           WHERE parent_id = ?`,
          [id],
          conn,
        )
      }

      return { ok: true }
    })
  } catch (err: any) {
    return internalError('An error occured while activating/deactivating the cost centre', err)
  }
})
