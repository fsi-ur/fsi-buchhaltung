import { defineEventHandler, getQuery } from 'h3'
import { query, withAuditTransaction } from '~/server/utils/db'
import { requirePermission } from '~/server/utils/api/guards'
import { requireArticleAdmin, requireArticleWrite } from '~/server/utils/wiki/access'
import { collectSubtreeIds, deleteScopeGrants } from '~/server/utils/wiki/grants'
import { internalError } from '~/server/utils/api/errors'

export type DeleteWikiArticleResponse = { ok: true, archived: boolean } | { ok: false, error: string }

export default defineEventHandler(async (event): Promise<DeleteWikiArticleResponse> => {
  const current = await requirePermission(event, 'wiki.view')
  if (!current.ok) return current

  const articleId = Number(event.context.params?.id)
  if (!Number.isInteger(articleId) || articleId <= 0) return { ok: false, error: 'Der Artikel wurde nicht gefunden.' }

  const hard = String(getQuery(event).hard ?? '') === '1'

  const access = hard
    ? await requireArticleAdmin(event, current.user, articleId)
    : await requireArticleWrite(event, current.user, articleId)
  if (!access.ok) return access

  if (hard && !access.subjects.canManage) {
    return { ok: false, error: 'Endgültiges Löschen ist nur mit der Berechtigung „Wiki verwalten" möglich.' }
  }

  try {
    await withAuditTransaction(current.user, async (conn) => {
      if (!hard) {
        await query("UPDATE wiki_articles SET status = 'archived' WHERE id = ?", [articleId], conn)
        return
      }

      const subtree = collectSubtreeIds(access.index, articleId)
      await deleteScopeGrants('article', subtree, conn)
      await query('DELETE FROM wiki_articles WHERE id = ?', [articleId], conn)
    })

    return { ok: true, archived: !hard }
  } catch (err: any) {
    return internalError('Failed to delete wiki article', err)
  }
})
