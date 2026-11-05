import { defineEventHandler } from 'h3'
import { query, withAuditTransaction } from '~/server/utils/db'
import { requirePermission } from '~/server/utils/api/guards'
import { internalError } from '~/server/utils/api/errors'

export type DeleteWikiTagResponse = { ok: true } | { ok: false, error: string }

const NOT_FOUND = 'Das Schlagwort wurde nicht gefunden.'

export default defineEventHandler(async (event): Promise<DeleteWikiTagResponse> => {
  const current = await requirePermission(event, 'wiki.manage')
  if (!current.ok) return current

  const tagId = Number(event.context.params?.id)
  if (!Number.isInteger(tagId) || tagId <= 0) return { ok: false, error: NOT_FOUND }

  const rows = await query<Array<{ id: number }>>('SELECT id FROM wiki_tags WHERE id = ? LIMIT 1', [tagId])
  if (!rows.length) return { ok: false, error: NOT_FOUND }

  try {
    await withAuditTransaction(current.user, async (conn) => {
      await query('DELETE FROM wiki_article_tags WHERE tag_id = ?', [tagId], conn)
      await query('DELETE FROM wiki_tags WHERE id = ?', [tagId], conn)
    })

    return { ok: true }
  } catch (err: any) {
    return internalError('Failed to delete the wiki tag', err)
  }
})
