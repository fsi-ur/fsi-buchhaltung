import { defineEventHandler } from 'h3'
import { query } from '~/server/utils/db'
import { requirePermission } from '~/server/utils/api/guards'
import { getWikiAccess } from '~/server/utils/wiki/access'
import { loadGlossaryRows, toGlossaryViews, type GlossaryTermView } from '~/server/utils/wiki/glossary'
import type { WikiArticleStatus } from '~/types/wiki'
import { internalError } from '~/server/utils/api/errors'

export interface WikiGlossaryArticleOption {
  id: number
  title: string
  spaceTitle: string
  status: WikiArticleStatus
}

export type WikiGlossaryResponse =
  | { ok: true, terms: GlossaryTermView[], canManage: boolean, articles: WikiGlossaryArticleOption[] }
  | { ok: false, error: string }

export default defineEventHandler(async (event): Promise<WikiGlossaryResponse> => {
  const current = await requirePermission(event, 'wiki.view')
  if (!current.ok) return current

  try {
    const { index, subjects } = await getWikiAccess(event, current.user)
    const { terms, aliasesByTerm } = await loadGlossaryRows()

    const articles = subjects.canManage
      ? await query<Array<{ id: number, title: string, status: WikiArticleStatus, space_title: string }>>(
        `SELECT a.id, a.title, a.status, s.title AS space_title
         FROM wiki_articles a
         JOIN wiki_spaces s ON s.id = a.space_id
         WHERE a.status <> 'archived'
         ORDER BY s.position, s.title, a.title`,
      )
      : []

    return {
      ok: true,
      terms: toGlossaryViews(terms, aliasesByTerm, index, subjects),
      canManage: subjects.canManage,
      articles: articles.map(row => ({
        id: Number(row.id),
        title: row.title,
        spaceTitle: row.space_title,
        status: row.status,
      })),
    }
  } catch (err: any) {
    return internalError('Failed to load the wiki glossary', err)
  }
})
