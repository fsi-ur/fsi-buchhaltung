import { defineEventHandler, readBody } from 'h3'
import { query, withAuditTransaction } from '~/server/utils/db'
import { requirePermission } from '~/server/utils/api/guards'
import { requireArticleWrite } from '~/server/utils/wiki/access'
import { internalError } from '~/server/utils/api/errors'

export type RestoreRevisionResponse = { ok: true } | { ok: false, error: string }

export default defineEventHandler(async (event): Promise<RestoreRevisionResponse> => {
  const current = await requirePermission(event, 'wiki.view')
  if (!current.ok) return current

  const articleId = Number(event.context.params?.id)
  if (!Number.isInteger(articleId) || articleId <= 0) return { ok: false, error: 'Der Artikel wurde nicht gefunden.' }

  const access = await requireArticleWrite(event, current.user, articleId)
  if (!access.ok) return access

  const revisionId = Number((await readBody(event))?.revisionId)
  if (!Number.isInteger(revisionId) || revisionId <= 0) return { ok: false, error: 'Diese Version wurde nicht gefunden.' }

  const rows = await query<Array<{ content_md: string }>>(
    'SELECT content_md FROM wiki_article_revisions WHERE id = ? AND article_id = ? LIMIT 1',
    [revisionId, articleId],
  )
  const revision = rows[0]
  if (!revision) return { ok: false, error: 'Diese Version wurde nicht gefunden.' }

  try {
    await withAuditTransaction(current.user, async (conn) => {
      await query(
        `UPDATE wiki_articles
         SET draft_md = ?, draft_updated_at = CURRENT_TIMESTAMP, draft_updated_by = ?
         WHERE id = ?`,
        [revision.content_md, current.user.id, articleId],
        conn,
      )
    })
    return { ok: true }
  } catch (err: any) {
    return internalError('Failed to restore wiki revision', err)
  }
})
