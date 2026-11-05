import { defineEventHandler } from 'h3'
import { query } from '~/server/utils/db'
import { requirePermission } from '~/server/utils/api/guards'
import { loadPageHelpRows, normalizeSectionKey } from '~/server/utils/wiki/pageHelp'
import type { WikiArticleStatus } from '~/types/wiki'
import { internalError } from '~/server/utils/api/errors'

export interface WikiPageHelpAdminEntry {
  id: number
  pageName: string
  sectionKey: string
  articleId: number
  title: string
  spaceTitle: string
  status: WikiArticleStatus
}

export interface WikiPageHelpAdminArticle {
  id: number
  title: string
  spaceTitle: string
  status: WikiArticleStatus
}

export type WikiPageHelpAdminResponse =
  | { ok: true, entries: WikiPageHelpAdminEntry[], articles: WikiPageHelpAdminArticle[] }
  | { ok: false, error: string }

export default defineEventHandler(async (event): Promise<WikiPageHelpAdminResponse> => {
  const current = await requirePermission(event, 'wiki.manage')
  if (!current.ok) return current

  try {
    const rows = await loadPageHelpRows(null)

    const articleRows = await query<Array<{ id: number, title: string, status: WikiArticleStatus, space_title: string }>>(
      `SELECT a.id, a.title, a.status, s.title AS space_title
       FROM wiki_articles a
       JOIN wiki_spaces s ON s.id = a.space_id
       WHERE a.status <> 'archived'
       ORDER BY s.position, s.title, a.title`,
    )

    return {
      ok: true,
      entries: rows.map(row => ({
        id: Number(row.id),
        pageName: row.page_name,
        sectionKey: normalizeSectionKey(row.section_key),
        articleId: Number(row.article_id),
        title: row.title,
        spaceTitle: row.space_title,
        status: row.status as WikiArticleStatus,
      })),
      articles: articleRows.map(row => ({
        id: Number(row.id),
        title: row.title,
        spaceTitle: row.space_title,
        status: row.status,
      })),
    }
  } catch (err: any) {
    return internalError('Failed to load the page help mapping', err)
  }
})
