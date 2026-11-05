import { defineEventHandler } from 'h3'
import { requirePermission } from '~/server/utils/api/guards'
import { loadArticleDetail, type WikiArticleDetailResult } from '~/server/utils/wiki/detail'
import { internalError } from '~/server/utils/api/errors'

export default defineEventHandler(async (event): Promise<WikiArticleDetailResult> => {
  const current = await requirePermission(event, 'wiki.view')
  if (!current.ok) return current

  const idParam = event.context.params?.id
  const articleId = Number(idParam)
  if (!idParam || !Number.isInteger(articleId) || articleId <= 0) {
    return { ok: false, error: 'Der Artikel wurde nicht gefunden.' }
  }

  try {
    return await loadArticleDetail(event, current.user, articleId)
  } catch (err: any) {
    return internalError('Failed to load wiki article', err)
  }
})
