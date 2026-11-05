import { defineEventHandler } from 'h3'
import { query, withAuditTransaction } from '~/server/utils/db'
import { requirePermission } from '~/server/utils/api/guards'
import { requireArticleWrite } from '~/server/utils/wiki/access'
import { internalError } from '~/server/utils/api/errors'

export type SubmitReviewResponse = { ok: true } | { ok: false, error: string }

export default defineEventHandler(async (event): Promise<SubmitReviewResponse> => {
  const current = await requirePermission(event, 'wiki.view')
  if (!current.ok) return current

  const articleId = Number(event.context.params?.id)
  if (!Number.isInteger(articleId) || articleId <= 0) return { ok: false, error: 'Der Artikel wurde nicht gefunden.' }

  const access = await requireArticleWrite(event, current.user, articleId)
  if (!access.ok) return access

  const rows = await query<Array<{ draft_md: string | null, content_md: string | null }>>(
    'SELECT draft_md, content_md FROM wiki_articles WHERE id = ? LIMIT 1',
    [articleId],
  )
  const article = rows[0]
  if (!article) return { ok: false, error: 'Der Artikel wurde nicht gefunden.' }
  if (!(article.draft_md ?? article.content_md ?? '').trim()) {
    return { ok: false, error: 'Ein leerer Artikel kann nicht zur Prüfung eingereicht werden.' }
  }

  try {
    await withAuditTransaction(current.user, async (conn) => {
      await query("UPDATE wiki_articles SET status = 'in_review' WHERE id = ?", [articleId], conn)
    })
    return { ok: true }
  } catch (err: any) {
    return internalError('Failed to submit wiki article for review', err)
  }
})
