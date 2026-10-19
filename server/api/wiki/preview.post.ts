import { defineEventHandler, readBody } from 'h3'
import { requirePermission } from '~/server/utils/api/guards'
import { renderArticle } from '~/server/utils/wiki/render'
import { canReadArticle, getWikiAccess } from '~/server/utils/wiki/access'
import { loadArticleImageIds } from '~/server/utils/wiki/images'
import type { WikiHeading } from '~/server/utils/wiki/render'

interface PreviewBody {
  markdown?: string
  knownChecklists?: string[]
  /** The article being edited; its uploaded images are the only ones `bild:<id>` may reference. */
  articleId?: number
}

export type PreviewResponse =
  | { ok: true, html: string, headings: WikiHeading[] }
  | { ok: false, error: string }

export default defineEventHandler(async (event): Promise<PreviewResponse> => {
  const current = await requirePermission(event, 'wiki.view')
  if (!current.ok) return current

  const body = await readBody<PreviewBody>(event)
  const markdown = typeof body?.markdown === 'string' ? body.markdown : ''

  const knownChecklists = Array.isArray(body?.knownChecklists)
    ? body.knownChecklists.filter((entry): entry is string => typeof entry === 'string')
    : undefined

  const articleId = Number(body?.articleId)
  let knownImages: number[] = []
  if (Number.isInteger(articleId) && articleId > 0) {
    const { index, subjects } = await getWikiAccess(event, current.user)
    if (canReadArticle(index, subjects, articleId)) knownImages = await loadArticleImageIds(articleId)
  }

  const rendered = renderArticle(markdown, { knownChecklists, knownImages })
  if (!rendered.ok) return rendered

  return { ok: true, html: rendered.html, headings: rendered.headings }
})
