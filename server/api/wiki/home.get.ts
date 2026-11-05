import { defineEventHandler } from 'h3'
import { query } from '~/server/utils/db'
import { requirePermission } from '~/server/utils/api/guards'
import { filterVisibleArticles, getEffectiveLevel, getWikiAccess, levelAtLeast } from '~/server/utils/wiki/access'
import { buildVisibleTree, isStale, loadSpaceRows, loadTreeArticleRows } from '~/server/utils/wiki/articles'
import { loadPathViews } from '~/server/utils/wiki/paths'
import type { WikiPathView, WikiTreeSpace } from '~/types/wiki'
import { internalError } from '~/server/utils/api/errors'

export interface WikiHomeArticle {
  id: number
  title: string
  summary: string
  spaceSlug: string
  spaceTitle: string
  slug: string
  changedAt: string | null
}

export type WikiHomeResponse =
  | {
      ok: true
      spaces: WikiTreeSpace[]
      paths: WikiPathView[]
      recentlyUpdated: WikiHomeArticle[]
      recentlyRead: WikiHomeArticle[]
      staleCount: number
      canEditSomewhere: boolean
    }
  | { ok: false, error: string }

interface HomeRow {
  id: number
  title: string
  summary: string
  slug: string
  space_slug: string
  space_title: string
  changed_at: string | null
}

function toHomeArticle(row: HomeRow): WikiHomeArticle {
  return {
    id: Number(row.id),
    title: row.title,
    summary: row.summary,
    slug: row.slug,
    spaceSlug: row.space_slug,
    spaceTitle: row.space_title,
    changedAt: row.changed_at ? String(row.changed_at) : null,
  }
}

export default defineEventHandler(async (event): Promise<WikiHomeResponse> => {
  const current = await requirePermission(event, 'wiki.view')
  if (!current.ok) return current

  try {
    const { index, subjects } = await getWikiAccess(event, current.user)
    const [spaceRows, treeRows, paths] = await Promise.all([
      loadSpaceRows(),
      loadTreeArticleRows(),
      loadPathViews(index, subjects, { includeUnpublished: subjects.canManage }),
    ])

    const canEditSomewhere = levelAtLeast(subjects.globalLevel, 'write')
      || treeRows.some(row => levelAtLeast(getEffectiveLevel(index, subjects, Number(row.id)), 'write'))

    const spaces = buildVisibleTree(spaceRows, treeRows, index, subjects, { includeDrafts: canEditSomewhere })

    const updatedRows = await query<HomeRow[]>(
      `SELECT a.id, a.title, a.summary, a.slug, s.slug AS space_slug, s.title AS space_title,
              COALESCE(a.published_at, a.updated_at) AS changed_at
       FROM wiki_articles a
       JOIN wiki_spaces s ON s.id = a.space_id
       WHERE a.status = 'published'
       ORDER BY changed_at DESC
       LIMIT 60`,
    )

    const readRows = await query<HomeRow[]>(
      `SELECT a.id, a.title, a.summary, a.slug, s.slug AS space_slug, s.title AS space_title,
              v.last_viewed_at AS changed_at
       FROM wiki_article_views v
       JOIN wiki_articles a ON a.id = v.article_id
       JOIN wiki_spaces s ON s.id = a.space_id
       WHERE v.user_id = ?
       ORDER BY v.last_viewed_at DESC
       LIMIT 40`,
      [subjects.userId],
    )

    let staleCount = 0
    if (canEditSomewhere) {
      const staleRows = await query<Array<{ id: number, review_interval_days: number | null, reviewed_at: string | null, published_at: string | null }>>(
        `SELECT id, review_interval_days, reviewed_at, published_at
         FROM wiki_articles
         WHERE status = 'published' AND review_interval_days IS NOT NULL`,
      )
      staleCount = filterVisibleArticles(index, subjects, staleRows)
        .filter(row => levelAtLeast(getEffectiveLevel(index, subjects, Number(row.id)), 'write'))
        .filter(row => isStale(row as any))
        .length
    }

    return {
      ok: true,
      spaces,
      paths: paths.filter(path => path.totalCount > 0),
      recentlyUpdated: filterVisibleArticles(index, subjects, updatedRows).slice(0, 6).map(toHomeArticle),
      recentlyRead: filterVisibleArticles(index, subjects, readRows).slice(0, 6).map(toHomeArticle),
      staleCount,
      canEditSomewhere,
    }
  } catch (err: any) {
    return internalError('Failed to load the wiki home page', err)
  }
})
