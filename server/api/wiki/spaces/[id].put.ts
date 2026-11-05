import { defineEventHandler, readBody } from 'h3'
import { query, withAuditTransaction } from '~/server/utils/db'
import { requirePermission } from '~/server/utils/api/guards'
import { invalidateWikiAccess } from '~/server/utils/wiki/access'
import { slugifyTitle } from '~/server/utils/wiki/articles'
import { applyOwnerGrants } from '~/server/utils/wiki/grants'
import { DEFAULT_SPACE_ICON, isSpaceSlugTaken, validateSpaceFields } from '~/server/utils/wiki/spaces'
import { internalError } from '~/server/utils/api/errors'

export type UpdateWikiSpaceResponse = { ok: true } | { ok: false, error: string }

const NOT_FOUND = 'Der Bereich wurde nicht gefunden.'

async function exists(table: string, id: number) {
  const rows = await query<Array<{ id: number }>>(`SELECT id FROM ${table} WHERE id = ? LIMIT 1`, [id])
  return rows.length > 0
}

export default defineEventHandler(async (event): Promise<UpdateWikiSpaceResponse> => {
  const current = await requirePermission(event, 'wiki.manage')
  if (!current.ok) return current

  const spaceId = Number(event.context.params?.id)
  if (!Number.isInteger(spaceId) || spaceId <= 0) return { ok: false, error: NOT_FOUND }

  const spaceRows = await query<Array<{ id: number }>>('SELECT id FROM wiki_spaces WHERE id = ? LIMIT 1', [spaceId])
  if (!spaceRows.length) return { ok: false, error: NOT_FOUND }

  const body = await readBody(event)
  const title = String(body?.title ?? '').trim()
  const slug = String(body?.slug ?? '').trim() || slugifyTitle(title)
  const description = String(body?.description ?? '').trim()
  const icon = String(body?.icon ?? '').trim() || DEFAULT_SPACE_ICON
  const requiresReview = body?.requiresReview ? 1 : 0
  const isArchived = body?.isArchived ? 1 : 0
  const ownerPositionId = body?.ownerPositionId ? Number(body.ownerPositionId) : null
  const ownerSubdivisionId = body?.ownerSubdivisionId ? Number(body.ownerSubdivisionId) : null
  const createGrant = body?.createGrant === true

  const invalid = validateSpaceFields({ title, slug, description, icon })
  if (invalid) return { ok: false, error: invalid }

  if (await isSpaceSlugTaken(slug, spaceId)) {
    return { ok: false, error: 'Es gibt bereits einen Bereich mit diesem Kurznamen.' }
  }

  if (ownerPositionId !== null && !(await exists('positions', ownerPositionId))) {
    return { ok: false, error: 'Dieses Amt wurde nicht gefunden.' }
  }
  if (ownerSubdivisionId !== null && !(await exists('subdivisions', ownerSubdivisionId))) {
    return { ok: false, error: 'Diese Untergliederung wurde nicht gefunden.' }
  }

  try {
    await withAuditTransaction(current.user, async (conn) => {
      await query(
        `UPDATE wiki_spaces
         SET slug = ?, title = ?, description = ?, icon = ?, requires_review = ?, is_archived = ?,
             owner_position_id = ?, owner_subdivision_id = ?
         WHERE id = ?`,
        [slug, title, description, icon, requiresReview, isArchived, ownerPositionId, ownerSubdivisionId, spaceId],
        conn,
      )

      if (!createGrant) return

      await applyOwnerGrants(
        'space',
        spaceId,
        { ownerPositionId, ownerSubdivisionId },
        Number(current.user.id),
        conn,
      )
    })

    invalidateWikiAccess(event)
    return { ok: true }
  } catch (err: any) {
    return internalError('Failed to update the wiki space', err)
  }
})
