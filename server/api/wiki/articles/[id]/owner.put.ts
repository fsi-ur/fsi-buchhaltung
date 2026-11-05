import { defineEventHandler, readBody } from 'h3'
import { query, withAuditTransaction } from '~/server/utils/db'
import { requirePermission } from '~/server/utils/api/guards'
import { requireArticleWrite } from '~/server/utils/wiki/access'
import { applyOwnerGrants } from '~/server/utils/wiki/grants'
import { internalError } from '~/server/utils/api/errors'

export type SetWikiOwnerResponse = { ok: true } | { ok: false, error: string }

async function exists(table: string, id: number) {
  const rows = await query<Array<{ id: number }>>(`SELECT id FROM ${table} WHERE id = ? LIMIT 1`, [id])
  return rows.length > 0
}

export default defineEventHandler(async (event): Promise<SetWikiOwnerResponse> => {
  const current = await requirePermission(event, 'wiki.view')
  if (!current.ok) return current

  const articleId = Number(event.context.params?.id)
  if (!Number.isInteger(articleId) || articleId <= 0) return { ok: false, error: 'Der Artikel wurde nicht gefunden.' }

  const access = await requireArticleWrite(event, current.user, articleId)
  if (!access.ok) return access

  const body = await readBody(event)
  const positionId = body?.ownerPositionId ? Number(body.ownerPositionId) : null
  const subdivisionId = body?.ownerSubdivisionId ? Number(body.ownerSubdivisionId) : null
  const createGrant = body?.createGrant === true

  if (positionId !== null && !(await exists('positions', positionId))) {
    return { ok: false, error: 'Dieses Amt wurde nicht gefunden.' }
  }
  if (subdivisionId !== null && !(await exists('subdivisions', subdivisionId))) {
    return { ok: false, error: 'Diese Untergliederung wurde nicht gefunden.' }
  }

  try {
    await withAuditTransaction(current.user, async (conn) => {
      await query(
        'UPDATE wiki_articles SET owner_position_id = ?, owner_subdivision_id = ? WHERE id = ?',
        [positionId, subdivisionId, articleId],
        conn,
      )

      if (!createGrant) return

      await applyOwnerGrants(
        'article',
        articleId,
        { ownerPositionId: positionId, ownerSubdivisionId: subdivisionId },
        Number(current.user.id),
        conn,
      )
    })

    return { ok: true }
  } catch (err: any) {
    return internalError('Failed to set the wiki article owner', err)
  }
})
