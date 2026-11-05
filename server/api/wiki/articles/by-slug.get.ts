import { defineEventHandler, getQuery } from 'h3'
import { requirePermission } from '~/server/utils/api/guards'
import { loadArticleDetail, resolveArticleIdBySlug, type WikiArticleDetailResult } from '~/server/utils/wiki/detail'
import { internalError } from '~/server/utils/api/errors'

export default defineEventHandler(async (event): Promise<WikiArticleDetailResult> => {
  const current = await requirePermission(event, 'wiki.view')
  if (!current.ok) return current

  const raw = String(getQuery(event).slug ?? '').trim().toLowerCase()
  const [spaceSlug, slug] = raw.split('/')
  if (!spaceSlug || !slug) return { ok: false, error: 'Der Artikel wurde nicht gefunden.' }

  try {
    const articleId = await resolveArticleIdBySlug(spaceSlug, slug)
    if (!articleId) return { ok: false, error: 'Der Artikel wurde nicht gefunden.' }
    return await loadArticleDetail(event, current.user, articleId)
  } catch (err: any) {
    return internalError('Failed to load wiki article', err)
  }
})
