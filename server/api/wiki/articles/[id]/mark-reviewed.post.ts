import { defineEventHandler } from 'h3'
import { query, withAuditTransaction } from '~/server/utils/db'
import { requirePermission } from '~/server/utils/api/guards'
import { levelAtLeast, requireArticleWrite } from '~/server/utils/wiki/access'
import { internalError } from '~/server/utils/api/errors'

export type MarkReviewedResponse = { ok: true } | { ok: false, error: string }

export default defineEventHandler(async (event): Promise<MarkReviewedResponse> => {
  const current = await requirePermission(event, 'wiki.view')
  if (!current.ok) return current

  const articleId = Number(event.context.params?.id)
  if (!Number.isInteger(articleId) || articleId <= 0) return { ok: false, error: 'Der Artikel wurde nicht gefunden.' }

  const access = await requireArticleWrite(event, current.user, articleId)
  if (!access.ok) return access

  if (!access.subjects.canReview && !levelAtLeast(access.level, 'admin')) {
    return { ok: false, error: 'Nur Personen mit Prüfrecht können einen Artikel als geprüft markieren.' }
  }

  try {
    await withAuditTransaction(current.user, async (conn) => {
      await query(
        'UPDATE wiki_articles SET reviewed_at = CURRENT_TIMESTAMP, reviewed_by = ? WHERE id = ?',
        [current.user.id, articleId],
        conn,
      )
    })
    return { ok: true }
  } catch (err: any) {
    return internalError('Failed to mark wiki article as reviewed', err)
  }
})
