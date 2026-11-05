import { defineEventHandler, getQuery } from 'h3'
import { requirePermission } from '~/server/utils/api/guards'
import { filterVisibleArticles, getWikiAccess } from '~/server/utils/wiki/access'
import { loadPageHelpRows, normalizeSectionKey, validatePageHelpInput } from '~/server/utils/wiki/pageHelp'
import { internalError } from '~/server/utils/api/errors'

export interface WikiPageHelpArticle {
  id: number
  sectionKey: string
  articleId: number
  title: string
  summary: string
  spaceTitle: string
}

export type WikiPageHelpResponse =
  | { ok: true, entries: WikiPageHelpArticle[] }
  | { ok: false, error: string }

export default defineEventHandler(async (event): Promise<WikiPageHelpResponse> => {
  const current = await requirePermission(event, 'wiki.view')
  if (!current.ok) return current

  const pageName = String(getQuery(event).page ?? '').trim()
  const invalid = validatePageHelpInput(pageName, '')
  if (invalid) return { ok: false, error: invalid }

  try {
    const rows = await loadPageHelpRows(pageName)
    const { index, subjects } = await getWikiAccess(event, current.user)

    return {
      ok: true,
      entries: filterVisibleArticles(index, subjects, rows).map(row => ({
        id: Number(row.id),
        sectionKey: normalizeSectionKey(row.section_key),
        articleId: Number(row.article_id),
        title: row.title,
        summary: row.summary,
        spaceTitle: row.space_title,
      })),
    }
  } catch (err: any) {
    return internalError('Failed to load the page help mapping', err)
  }
})
