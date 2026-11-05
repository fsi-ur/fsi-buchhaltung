import { defineEventHandler, readBody } from 'h3'
import { query, withAuditTransaction } from '~/server/utils/db'
import { requirePermission } from '~/server/utils/api/guards'
import { invalidateWikiAccess } from '~/server/utils/wiki/access'
import { slugifyTitle } from '~/server/utils/wiki/articles'
import { applyOwnerGrants } from '~/server/utils/wiki/grants'
import { DEFAULT_SPACE_ICON, isSpaceSlugTaken, validateSpaceFields } from '~/server/utils/wiki/spaces'
import { internalError } from '~/server/utils/api/errors'

export type CreateWikiSpaceResponse =
  | { ok: true, spaceId: number }
  | { ok: false, error: string }

async function exists(table: string, id: number) {
  const rows = await query<Array<{ id: number }>>(`SELECT id FROM ${table} WHERE id = ? LIMIT 1`, [id])
  return rows.length > 0
}

export default defineEventHandler(async (event): Promise<CreateWikiSpaceResponse> => {
  const current = await requirePermission(event, 'wiki.manage')
  if (!current.ok) return current

  const body = await readBody(event)
  const title = String(body?.title ?? '').trim()
  const slug = String(body?.slug ?? '').trim() || slugifyTitle(title)
  const description = String(body?.description ?? '').trim()
  const icon = String(body?.icon ?? '').trim() || DEFAULT_SPACE_ICON
  const requiresReview = body?.requiresReview ? 1 : 0
  const ownerPositionId = body?.ownerPositionId ? Number(body.ownerPositionId) : null
  const ownerSubdivisionId = body?.ownerSubdivisionId ? Number(body.ownerSubdivisionId) : null
  const createGrant = body?.createGrant === true

  const invalid = validateSpaceFields({ title, slug, description, icon })
  if (invalid) return { ok: false, error: invalid }

  if (await isSpaceSlugTaken(slug, null)) {
    return { ok: false, error: 'Es gibt bereits einen Bereich mit diesem Kurznamen.' }
  }

  if (ownerPositionId !== null && !(await exists('positions', ownerPositionId))) {
    return { ok: false, error: 'Dieses Amt wurde nicht gefunden.' }
  }
  if (ownerSubdivisionId !== null && !(await exists('subdivisions', ownerSubdivisionId))) {
    return { ok: false, error: 'Diese Untergliederung wurde nicht gefunden.' }
  }

  try {
    const spaceId = await withAuditTransaction(current.user, async (conn) => {
      const positionRows = await query<Array<{ next_position: number }>>(
        'SELECT COALESCE(MAX(position), 0) + 10 AS next_position FROM wiki_spaces',
        [],
        conn,
      )

      const result: any = await query(
        `INSERT INTO wiki_spaces
           (slug, title, description, icon, position, requires_review, owner_position_id, owner_subdivision_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          slug,
          title,
          description,
          icon,
          Number(positionRows[0]?.next_position ?? 10),
          requiresReview,
          ownerPositionId,
          ownerSubdivisionId,
        ],
        conn,
      )

      const newSpaceId = Number(result.insertId)

      if (createGrant) {
        await applyOwnerGrants('space', newSpaceId, { ownerPositionId, ownerSubdivisionId }, Number(current.user.id), conn)
      }

      return newSpaceId
    })

    invalidateWikiAccess(event)
    return { ok: true, spaceId }
  } catch (err: any) {
    return internalError('Failed to create wiki space', err)
  }
})
