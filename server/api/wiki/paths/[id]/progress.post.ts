import { defineEventHandler, readBody } from 'h3'
import { query } from '~/server/utils/db'
import { requirePermission } from '~/server/utils/api/guards'
import { canReadArticle, getWikiAccess } from '~/server/utils/wiki/access'
import { internalError } from '~/server/utils/api/errors'

interface PathProgressBody {
  itemId?: number
  done?: boolean
}

export type WikiPathProgressResponse = { ok: true } | { ok: false, error: string }

const NOT_FOUND = 'Der Schritt wurde nicht gefunden.'

export default defineEventHandler(async (event): Promise<WikiPathProgressResponse> => {
  const current = await requirePermission(event, 'wiki.view')
  if (!current.ok) return current

  const pathId = Number(event.context.params?.id)
  if (!Number.isInteger(pathId) || pathId <= 0) return { ok: false, error: NOT_FOUND }

  const body = await readBody<PathProgressBody>(event)
  const itemId = Number(body?.itemId)
  if (!Number.isInteger(itemId) || itemId <= 0) return { ok: false, error: NOT_FOUND }

  const rows = await query<Array<{ article_id: number }>>(
    'SELECT article_id FROM wiki_path_items WHERE id = ? AND path_id = ? LIMIT 1',
    [itemId, pathId],
  )
  const item = rows[0]
  if (!item) return { ok: false, error: NOT_FOUND }

  const { index, subjects } = await getWikiAccess(event, current.user)
  if (!canReadArticle(index, subjects, Number(item.article_id))) return { ok: false, error: NOT_FOUND }

  try {
    if (body?.done === false) {
      await query(
        'DELETE FROM wiki_path_progress WHERE user_id = ? AND path_item_id = ?',
        [current.user.id, itemId],
      )
    } else {
      await query(
        `INSERT INTO wiki_path_progress (user_id, path_item_id)
         VALUES (?, ?)
         ON DUPLICATE KEY UPDATE completed_at = CURRENT_TIMESTAMP`,
        [current.user.id, itemId],
      )
    }

    return { ok: true }
  } catch (err: any) {
    return internalError('Failed to save the wiki learning path progress', err)
  }
})
