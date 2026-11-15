import { defineEventHandler } from 'h3'
import { query, withAuditTransaction } from '~/server/utils/db'
import { requirePermission } from '~/server/utils/api/guards'
import { requireArticleWrite } from '~/server/utils/wiki/access'
import { internalError } from '~/server/utils/api/errors'

export type UnarchiveWikiArticleResponse =
  | { ok: true, status: 'published' | 'draft' }
  | { ok: false, error: string }

/**
 * Takes an article out of the archive with the same right that archived it (write). It returns to
 * the state its content allows: an article that had been published shows its last published version
 * again (that version was already reviewed, so no review is needed); one that never was becomes a
 * draft. A pending draft stays a draft either way.
 */
export default defineEventHandler(async (event): Promise<UnarchiveWikiArticleResponse> => {
  const current = await requirePermission(event, 'wiki.view')
  if (!current.ok) return current

  const articleId = Number(event.context.params?.id)
  if (!Number.isInteger(articleId) || articleId <= 0) return { ok: false, error: 'Der Artikel wurde nicht gefunden.' }

  const access = await requireArticleWrite(event, current.user, articleId)
  if (!access.ok) return access

  const rows = await query<Array<{ status: string, content_md: string | null, published_at: string | null }>>(
    'SELECT status, content_md, published_at FROM wiki_articles WHERE id = ? LIMIT 1',
    [articleId],
  )
  const article = rows[0]
  if (!article) return { ok: false, error: 'Der Artikel wurde nicht gefunden.' }
  if (article.status !== 'archived') return { ok: false, error: 'Der Artikel ist nicht archiviert.' }

  const status = article.published_at && (article.content_md ?? '').trim() ? 'published' : 'draft'

  try {
    await withAuditTransaction(current.user, async (conn) => {
      await query('UPDATE wiki_articles SET status = ? WHERE id = ?', [status, articleId], conn)
    })
    return { ok: true, status }
  } catch (err: any) {
    return internalError('Failed to restore wiki article from the archive', err)
  }
})
